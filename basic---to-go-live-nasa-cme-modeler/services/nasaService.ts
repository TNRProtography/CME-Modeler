import { CMEData, ProcessedCME } from '../types';

const formatDateForAPI = (date: Date): string => date.toISOString().split('T')[0];

export const fetchCMEData = async (days: number, apiKey: string): Promise<ProcessedCME[]> => {
  if (!apiKey) {
    throw new Error("NASA API Key was not provided to fetchCMEData function.");
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

// --- SOLAR ACTIVITY SECTION ---

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

// Fetches X-Ray data directly from NOAA
export const fetchGoesXrayData = async (): Promise<any[]> => {
  const url = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch GOES X-ray data');
  return response.json();
};

// Fetches Proton data directly from NOAA
export const fetchGoesProtonData = async (): Promise<any[]> => {
  const url = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-1-day.json';
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch GOES proton data');
  return response.json();
};

// Fetches Flare data via our secure server proxy to handle the API key and CORS
export const fetchSolarFlareData = async (): Promise<SolarFlareData[]> => {
  const response = await fetch('/solar-data'); // Calls our server function
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: 'Failed to fetch solar flare data from proxy.' }));
    throw new Error(errorBody.error || `Server responded with status ${response.status}`);
  }
  const data = await response.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data.filter((flare: any) => flare.activeRegionNum);
};