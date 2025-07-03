
import { CMEData, ProcessedCME } from '../types';
import { NASA_API_KEY } from '../constants';

const formatDateForAPI = (date: Date): string => date.toISOString().split('T')[0];

export const fetchCMEData = async (days: number): Promise<ProcessedCME[]> => {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - days);

  const url = `https://api.nasa.gov/DONKI/CME?startDate=${formatDateForAPI(startDate)}&endDate=${formatDateForAPI(endDate)}&api_key=${NASA_API_KEY}`;

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
  // Example: "2024-03-17T12:34:00-GST-001"
  const shockEvent = cme.linkedEvents.find(e => e.activityID.includes("-GST"));
  if (shockEvent) {
    try {
      // Extract date-time part before "-GST"
      const dateTimeString = shockEvent.activityID.substring(0, shockEvent.activityID.indexOf("-GST"));
      return new Date(dateTimeString + "Z"); // Append Z to indicate UTC
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
        
        // Normalize longitude: NASA API sometimes gives values > 180 or < -180.
        // We typically want it in -180 to 180, or 0 to 360.
        // For Earth direction check, 0 longitude is Earth-facing from Sun's perspective in Stonyhurst Heliographic Coordinates.
        // CMEs propagate from the Sun. A CME with longitude 0 is directed towards Earth.
        // A CME with longitude 180 originates from the far side of the Sun relative to Earth.
        let cmeLongitude = analysis.longitude;
        // The interpretation of 'Earth-directed' can vary.
        // If analysis.longitude is Stonyhurst, then 0 is Earth-center.
        // If it's Carrington, it's more complex. DONKI usually provides Stonyhurst for analyses.
        // Assuming Stonyhurst: Earth is at 0 degrees longitude.
        // A CME is Earth-directed if its source longitude is close to 0.
        // +/- 45 degrees latitude and longitude is a common window.
        const isEarthDirected = Math.abs(cmeLongitude) < 45 && Math.abs(analysis.latitude) < 30;

        modelableCMEs.push({
          id: cme.activityID,
          startTime: new Date(cme.startTime),
          speed: analysis.speed,
          longitude: analysis.longitude, // Store original for display/shader
          latitude: analysis.latitude,   // Store original for display/shader
          isEarthDirected,
          note: cme.note || 'No additional details.',
          predictedArrivalTime: getPredictedArrivalTime(cme),
          link: cme.link,
          instruments: cme.instruments?.map(inst => inst.displayName).join(', ') || 'N/A',
          sourceLocation: cme.sourceLocation || 'N/A',
          halfAngle: analysis.halfAngle || 30 // Default halfAngle if not available
        });
      }
    }
  });
  return modelableCMEs.sort((a,b) => b.startTime.getTime() - a.startTime.getTime());
};
