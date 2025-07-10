// functions/solar-data.ts

// Define the shape of the data we will send to the client app
interface SolarActivityResponse {
  xrayData: { timestamp: number; flux: number }[];
  protonData: { timestamp: number; flux: number; energy: string }[];
  flareData: any[];
  error?: string;
}

// Define the environment variables the function expects from Cloudflare
declare interface Env {
  SECRET_NASA_API_KEY: string;
}

/**
 * A robust, server-side function to parse ambiguous NOAA date strings.
 * This function is the key to fixing the mobile browser bug. It converts
 * "YYYY-MM-DD HH:mm:ss" into a reliable Unix timestamp (a number) that
 * all browsers understand perfectly.
 * @param dateString The ambiguous date string from NOAA.
 * @returns A numeric timestamp (milliseconds since epoch) or null if invalid.
 */
const parseNoaaDate = (dateString: string): number | null => {
  if (typeof dateString !== 'string' || dateString.trim() === '') return null;
  // This creates a universally compatible ISO 8601 string: "2024-07-11T22:05:00Z"
  const isoString = dateString.replace(' ', 'T') + 'Z';
  const timestamp = new Date(isoString).getTime();
  // Return the number, or null if the date was invalid
  return isNaN(timestamp) ? null : timestamp;
};

// This is the main server-side function that runs when your app calls `/solar-data`
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.SECRET_NASA_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: SECRET_NASA_API_KEY not found.' }), { status: 500 });
  }

  // The correct URLs you provided
  const xrayUrl = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
  const protonUrl = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-1-day.json';
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 7);
  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const flareUrl = `https://api.nasa.gov/DONKI/FLR?startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}&api_key=${apiKey}`;

  try {
    const [xrayRes, protonRes, flareRes] = await Promise.allSettled([
      fetch(xrayUrl),
      fetch(protonUrl),
      fetch(flareUrl),
    ]);

    // --- Process X-Ray Data ---
    let processedXray = [];
    if (xrayRes.status === 'fulfilled' && xrayRes.value.ok) {
        const rawXrayData = await xrayRes.value.json();
        if (Array.isArray(rawXrayData)) {
            processedXray = rawXrayData
                // 1. Filter to keep ONLY the correct energy band for the A,B,C,M,X scale
                .filter(d => d.energy === '0.1-0.8nm' && d.flux > 0)
                // 2. Map the data into a clean, simple format
                .map(d => ({
                    timestamp: parseNoaaDate(d.time_tag),
                    flux: d.flux,
                }))
                // 3. Remove any data points where the date could not be parsed
                .filter(d => d.timestamp !== null);
        }
    }

    // --- Process Proton Data ---
    let processedProton = [];
    if (protonRes.status === 'fulfilled' && protonRes.value.ok) {
        const rawProtonData = await protonRes.value.json();
        if (Array.isArray(rawProtonData)) {
            // This specific proton data format has no header row, so we process every item.
            processedProton = rawProtonData
                .map(d => ({
                    timestamp: parseNoaaDate(d.time_tag),
                    flux: d.flux,
                    energy: d.energy,
                }))
                .filter(d => d.timestamp !== null && d.flux > 0 && d.energy);
        }
    }
    
    // --- Process Flare Data ---
    let flareData = [];
    if (flareRes.status === 'fulfilled' && flareRes.value.ok) {
        flareData = await flareRes.value.json();
    }

    // --- Send the clean, processed data back to the app ---
    return new Response(JSON.stringify({ xrayData: processedXray, protonData: processedProton, flareData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error("Error in server function:", err);
    return new Response(JSON.stringify({ error: 'Failed to fetch or process data from external APIs.' }), { status: 502 });
  }
};