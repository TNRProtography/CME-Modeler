import { CMEData, ProcessedCME } from '../types';

const formatDateForAPI = (date: Date): string => date.toISOString().split('T')[0];

// The API key is now passed into the functions that need it.
export const fetchCMEData = async (days: number, apiKey: string): Promise<ProcessedCME[]> => {
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

// --- NEW CODE STARTS HERE ---

// NEW: Interfaces for the new data types
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

// Helper to parse the standard NOAA JSON format
const parseNoaaJson = <T>(jsonData: any[], valueColumn: string): T[] => {
  if (!jsonData || jsonData.length < 2) return [];
  const headers = jsonData[0] as string[];
  const timeIndex = headers.indexOf('time_tag');
  const valueIndex = headers.indexOf(valueColumn);

  if (timeIndex === -1 || valueIndex === -1) return [];

  return jsonData.slice(1).map((row: any) => ({
    time_tag: row[timeIndex],
    [valueColumn]: row[valueIndex],
  } as T));
};

export const fetchGoesXrayData = async (): Promise<GoesXrayData[]> => {
  // Fetches the last 3 days of 5-min X-ray data
  const response = await fetch('https://services.swpc.noaa.gov/json/goes/primary/xrays-5-minute.json');
  if (!response.ok) throw new Error('Failed to fetch GOES X-ray data');
  const jsonData = await response.json();
  return parseNoaaJson<GoesXrayData>(jsonData, 'flux');
};

export const fetchGoesProtonData = async (): Promise<GoesProtonData[]> => {
  // Fetches the last 3 days of 5-min proton flux data
  const response = await fetch('https://services.swpc.noaa.gov/json/goes/primary/protons-5-minute.json');
  if (!response.ok) throw new Error('Failed to fetch GOES proton data');
  const jsonData = await response.json();
  return parseNoaaJson<GoesProtonData>(jsonData, 'flux');
};

export const fetchSolarFlareData = async (apiKey: string): Promise<SolarFlareData[]> => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 7); // Flares from the last 7 days

  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const url = `https://api.nasa.gov/DONKI/FLR?startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}&api_key=${apiKey}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch Solar Flare data');
  const jsonData = await response.json();
  return jsonData.filter((flare: any) => flare.activeRegionNum); // Only show flares with a numbered active region
};