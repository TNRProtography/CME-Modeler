import { CMEData, ProcessedCME } from '../types';

const formatDateForAPI = (date: Date): string => date.toISOString().split('T')[0];

// MODIFIED: This function now correctly uses the VITE_NASA_API_KEY from the build environment.
export const fetchCMEData = async (days: number): Promise<ProcessedCME[]> => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  // This will use the key available on the client-side during build, as originally intended.
  const apiKey = import.meta.env.VITE_NASA_API_KEY;

  if (!apiKey) {
    throw new Error("NASA API Key is not defined in the application's environment.");
  }

  const url = `https://api.nasa.gov/DONKI/CME?startDate=${formatDateForAPI(startDate)}&endDate=${formatDateForAPI(endDate)}&api_key=${apiKey}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.text();
      console.error("NASA API Error Response:", errorData);
      throw new Error(`NASA API Error: ${response.status} ${response.statusText}`);
    }
    const data: CMEData[] = await response.json();
    return processCMEData(data);
  } catch (error) {
    console.error("Failed to fetch or process CME data:", error);
    throw error;
  }
};

const getPredictedArrivalTime = (cme: CMEData): Date | null => {
  if (!cme.linkedEvents) return null;
  const shockEvent = cme.linkedEvents.find(e => e.activityID.includes("-GST"));
  if (shockEvent) {
    try {
      const dateTimeString = shockEvent.activityID.substring(0, shockEvent.activityID.indexOf("-GST"));
      return new Date(dateTimeString + "Z");
    } catch (e) {
      console.warn(`Could not parse predicted arrival time from: ${shockEvent.activityID}`, e);
      return null;
    }
  }
  return null;
};

const processCMEData = (data: CMEData[]): ProcessedCME[] => {
  const modelableCMEs: ProcessedCME[] = [];
  data.forEach(cme => {
    if (cme.cmeAnalyses && cme.cmeAnalyses.length > 0) {
      const analysis = cme.cmeAnalyses.find(a => a.isMostAccurate) || cme.cmeAnalyses[0];
      if (analysis.speed != null && analysis.longitude != null && analysis.latitude != null) {
        const isEarthDirected = Math.abs(analysis.longitude) < 45 && Math.abs(analysis.latitude) < 30;
        modelableCMEs.push({
          id: cme.activityID,
          startTime: new Date(cme.startTime),
          speed: analysis.speed,
          longitude: analysis.longitude,
          latitude: analysis.latitude,
          isEarthDirected,
          note: cme.note || 'No additional details.',
          predictedArrivalTime: getPredictedArrivalTime(cme),
          link: cme.link,
          instruments: cme.instruments?.map(inst => inst.displayName).join(', ') || 'N/A',
          sourceLocation: cme.sourceLocation || 'N/A',
          halfAngle: analysis.halfAngle || 30
        });
      }
    }
  });
  return modelableCMEs.sort((a,b) => b.startTime.getTime() - a.startTime.getTime());
};

// --- SOLAR ACTIVITY SECTION (Uses the proxy) ---

export interface GoesXrayData {
  time_tag: string;
  flux: number;
}

export interface GoesProtonData {
  time_tag: string;
  flux: number;
}

export interface SolarFlareData {
  flrID: string;
  beginTime: string;
  peakTime: string;
  endTime: string | null;
  classType: string;
  sourceLocation: string;
  activeRegionNum: number;
  link: string;
}

export const fetchSolarActivityData = async () => {
  const response = await fetch('/functions/solar-data'); // This calls our secure messenger
  if (!response.ok) {
    throw new Error('Failed to fetch solar activity data from proxy.');
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }

  const xray = parseNoaaJson<GoesXrayData>(data.xrayData, 'flux');
  const proton = parseNoaaJson<GoesProtonData>(data.protonData, 'flux');
  const flares = data.flareData.filter((flare: any) => flare.activeRegionNum);

  return { xray, proton, flares };
};

const parseNoaaJson = <T>(jsonData: any[], valueColumn: string): T[] => {
  if (!jsonData || jsonData.length < 2) return [];
  const headers = jsonData[0] as string[];
  const timeIndex = headers.indexOf('time_tag');
  const valueIndex = headers.indexOf(valueColumn);

  if (timeIndex === -1 || valueIndex === -1) return [];

  return jsonData.slice(1).map((row: any) => ({
    time_tag: row[timeIndex],
    flux: row[valueIndex],
  }) as unknown as T);
};