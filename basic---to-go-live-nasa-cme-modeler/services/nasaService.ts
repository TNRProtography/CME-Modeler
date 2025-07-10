import { CMEData, ProcessedCME } from '../types';

const formatDateForAPI = (date: Date): string => date.toISOString().split('T')[0];

export const fetchCMEData = async (days: number): Promise<ProcessedCME[]> => {
  const apiKey = import.meta.env.VITE_NASA_API_KEY;
  if (!apiKey) {
    throw new Error("NASA API Key is not defined in the application's environment.");
  }
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

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

// --- THIS SECTION IS NOW CORRECTED ---

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

// Helper to parse NOAA JSON format, needed by proton fetcher
const parseNoaaJson = <T>(jsonData: any[], valueColumn: string): T[] => {
  if (!jsonData || jsonData.length < 2) return [];
  const headers = jsonData[0]; // NOAA format uses an object for headers
  const timeKey = Object.keys(headers).find(k => k.toLowerCase().includes('time_tag')) || 'time_tag';
  const valueKey = Object.keys(headers).find(k => headers[k] === valueColumn) || valueColumn;
  
  return jsonData.slice(1).map((row: any) => ({
    time_tag: row[timeKey],
    flux: row[valueKey],
  } as unknown as T));
};

// Re-add and export the proton fetcher
export const fetchGoesProtonData = async (): Promise<GoesProtonData[]> => {
  const response = await fetch('https://services.swpc.noaa.gov/json/goes/primary/protons-5-minute.json');
  if (!response.ok) throw new Error('Failed to fetch GOES proton data');
  const jsonData = await response.json();
  return parseNoaaJson<GoesProtonData>(jsonData, 'flux');
};

// No changes to fetchSolarFlareData, it uses the proxy
export const fetchSolarActivityData = async () => {
  const response = await fetch('/solar-data');
  if (!response.ok) {
    throw new Error('Failed to fetch solar activity data from proxy.');
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }

  // The proxy now returns pre-fetched X-ray data, proton data is fetched separately by client
  const flares = data.flareData.filter((flare: any) => flare.activeRegionNum);
  
  return { xray: data.xrayData, flares }; // Only return what the proxy provides now
};