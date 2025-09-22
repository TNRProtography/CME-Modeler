// --- MODIFICATION: Moved type definitions to types.ts ---
import { 
    CMEData, 
    ProcessedCME,
    SolarFlare,
    InterplanetaryShock,
    WSAEnlilSimulation
} from '../types';

// --- DATA FETCHING FUNCTIONS ---
const PROXY_BASE_URL = 'https://nasa-donki-api.thenamesrock.workers.dev';

export const fetchCMEData = async (days: number, apiKey: string): Promise<ProcessedCME[]> => {
  const url = `${PROXY_BASE_URL}/CME`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      const errorData = await response.text();
      console.error("Proxy Worker API Error Response (CME):", errorData);
      throw new Error(`Proxy Worker API Error: ${response.status} ${response.statusText}`);
    }
    const data: CMEData[] = await response.json();
    return processCMEData(data);
  } catch (error) {
    console.error("Failed to fetch or process CME data from the proxy worker:", error);
    throw error;
  }
};

export const fetchFlareData = async (): Promise<SolarFlare[]> => {
  const url = `${PROXY_BASE_URL}/FLR`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Proxy Worker API Error (FLR): ${response.status}`);
    const data: SolarFlare[] = await response.json();
    return data.sort((a, b) => new Date(b.peakTime).getTime() - new Date(a.peakTime).getTime());
  } catch (error) {
    console.error("Failed to fetch flare data from the proxy worker:", error);
    throw error;
  }
};

export const fetchIPSData = async (): Promise<InterplanetaryShock[]> => {
  const url = `${PROXY_BASE_URL}/GST`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Proxy Worker API Error (GST/IPS): ${response.status}`);
    const data: InterplanetaryShock[] = await response.json();
    return data.sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime());
  } catch (error) {
    console.error("Failed to fetch IPS/GST data from the proxy worker:", error);
    throw error;
  }
};

export const fetchWSAEnlilSimulations = async (): Promise<WSAEnlilSimulation[]> => {
  const url = `${PROXY_BASE_URL}/WSAEnlilSimulations`;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Proxy Worker API Error (WSAEnlilSimulations): ${response.status}`);
    const data: WSAEnlilSimulation[] = await response.json();
    return data.sort((a, b) => new Date(b.modelCompletionTime).getTime() - new Date(a.modelCompletionTime).getTime());
  } catch (error) {
    console.error("Failed to fetch WSA-ENLIL data from the proxy worker:", error);
    throw error;
  }
};

// --- DATA PROCESSING (UNCHANGED) ---
const getPredictedArrivalTime = (cme: CMEData): Date | null => {
  if (!cme.linkedEvents) return null;
  const shockEvent = cme.linkedEvents.find(e => e.activityID.includes("-GST"));
  if (shockEvent) {
    try {
      const dateTimeString = shockEvent.activityID.substring(0, 13);
      const parsedDate = new Date(
        `${dateTimeString.substring(0,4)}-${dateTimeString.substring(4,6)}-${dateTimeString.substring(6,8)}T${dateTimeString.substring(9,11)}:${dateTimeString.substring(11,13)}:00Z`
      );
      if (isNaN(parsedDate.getTime())) return null;
      return parsedDate;
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
        const isEarthDirected = Math.abs(analysis.longitude) < 45;
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