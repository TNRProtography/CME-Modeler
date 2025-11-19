// --- START OF FILE nasaService.ts ---

import { CMEData, ProcessedCME, HSSData, ProcessedHSS, SolarFlare, InterplanetaryShock, WSAEnlilSimulation } from '../types';

const PROXY_BASE_URL = 'https://nasa-donki-api.thenamesrock.workers.dev';

// --- DATA FETCHING FUNCTIONS ---

export const fetchCMEData = async (days: number, apiKey: string): Promise<ProcessedCME[]> => {
  // apiKey is no longer used for the request but kept for function signature consistency.
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
    // Sort by peak time, newest first
    return data.sort((a, b) => new Date(b.peakTime).getTime() - new Date(a.peakTime).getTime());
  } catch (error) {
    console.error("Failed to fetch flare data from the proxy worker:", error);
    throw error; // Re-throw to be handled by the component
  }
};

export const fetchIPSData = async (): Promise<InterplanetaryShock[]> => {
  // Using the GST (Geomagnetic Storm) endpoint as the proxy for Interplanetary Shocks if IPS specific not available
  // Or specifically the IPS/Shocks endpoint if your worker supports it. 
  // Based on previous context, we mapped this to GST or specific IPS logic. 
  // Assuming GST for now as per previous file state, or if you have specific IPS data:
  const url = `${PROXY_BASE_URL}/GST`; 
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Proxy Worker API Error (GST/IPS): ${response.status}`);
    const data: InterplanetaryShock[] = await response.json();
     // Sort by event time, newest first
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
     // Sort by completion time, newest first
    return data.sort((a, b) => new Date(b.modelCompletionTime).getTime() - new Date(a.modelCompletionTime).getTime());
  } catch (error) {
    console.error("Failed to fetch WSA-ENLIL data from the proxy worker:", error);
    throw error;
  }
};

// --- NEW: FETCH HSS DATA ---
export const fetchHSSData = async (): Promise<ProcessedHSS[]> => {
    const url = `${PROXY_BASE_URL}/HSS`;
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Proxy Worker API Error (HSS): ${response.status}`);
        const data: HSSData[] = await response.json();
        return processHSSData(data);
    } catch (error) {
        console.error("Failed to fetch HSS data:", error);
        // Return empty array instead of throwing to prevent breaking the whole dashboard
        return []; 
    }
}

// --- DATA PROCESSING ---

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

const processHSSData = (data: HSSData[]): ProcessedHSS[] => {
    return data.map(hss => {
        let speed = 550; // Default average HSS speed in km/s if not found
        
        // Try to extract speed from the note (e.g., "speeds ... to 650km/s")
        // Regex looks for numbers followed closely by "km/s"
        if (hss.note) {
            const speedMatch = hss.note.match(/(\d+)\s*km\/s/g);
            if (speedMatch) {
                // Extract just the numbers
                const numbers = speedMatch.map(s => parseInt(s.replace(/\D/g, '')));
                if (numbers.length > 0) {
                    // If multiple speeds are mentioned (e.g., "300 to 600"), take the maximum 
                    // as it represents the peak influence of the stream
                    speed = Math.max(...numbers);
                }
            }
        }

        return {
            id: hss.hssID,
            eventTime: new Date(hss.eventTime),
            speed: speed,
            link: hss.link
        };
    }).sort((a,b) => b.eventTime.getTime() - a.eventTime.getTime());
};
// --- END OF FILE nasaService.ts ---