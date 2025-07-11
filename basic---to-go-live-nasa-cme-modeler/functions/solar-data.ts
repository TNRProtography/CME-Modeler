interface SolarActivityResponse {
  xrayData: { timestamp: number; flux: number }[];
  protonData: { timestamp: number; flux: number; energy: string }[];
  flareData: any[];
  error?: string;
}

declare interface Env {
  SECRET_NASA_API_KEY: string;
}

/**
 * A robust, bulletproof date parser that runs on the server.
 * It correctly handles both "YYYY-MM-DD HH:mm:ss" and "YYYY-MM-DDTHH:mm:ssZ" formats from NOAA.
 * @param dateString The ambiguous date string from NOAA.
 * @returns A numeric timestamp (milliseconds since epoch) or null if invalid.
 */
const parseNoaaDate = (dateString: string): number | null => {
  if (typeof dateString !== 'string' || dateString.trim() === '') return null;
  
  let parsableString = dateString;
  // If the string doesn't already end with 'Z' (for Zulu/UTC time), add it for ISO compatibility
  if (!parsableString.endsWith('Z')) {
    // Replace first space with 'T' to create an ISO-like string, then add 'Z'
    parsableString = parsableString.replace(' ', 'T') + 'Z';
  }

  const timestamp = new Date(parsableString).getTime();
  return isNaN(timestamp) ? null : timestamp;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.SECRET_NASA_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: SECRET_NASA_API_KEY not found.' }), { status: 500 });
  }

  // --- MODIFIED ENDPOINTS TO 6-HOUR DATA ---
  const xrayUrl = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json';
  const protonUrl = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-6-hour.json';
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 7); // Keep 7 days for flares for broader context
  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const flareUrl = `https://api.nasa.gov/DONKI/FLR?startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}&api_key=${apiKey}`;

  try {
    const [xrayRes, protonRes, flareRes] = await Promise.allSettled([
      fetch(xrayUrl),
      fetch(protonUrl),
      fetch(flareUrl),
    ]);

    let processedXray = [];
    if (xrayRes.status === 'fulfilled' && xrayRes.value.ok) {
        const rawXrayData = await xrayRes.value.json();
        if (Array.isArray(rawXrayData)) {
            // Filter for the 0.1-0.8nm energy band and positive flux
            processedXray = rawXrayData
                .filter(d => d.energy === '0.1-0.8nm' && d.flux > 0)
                .map(d => ({
                    timestamp: parseNoaaDate(d.time_tag),
                    flux: d.flux,
                }))
                .filter(d => d.timestamp !== null); // Remove any points where timestamp parsing failed
        }
    }

    let processedProton = [];
    if (protonRes.status === 'fulfilled' && protonRes.value.ok) {
        const rawProtonData = await protonRes.value.json();
        if (Array.isArray(rawProtonData)) {
            processedProton = rawProtonData
                .map(d => ({
                    timestamp: parseNoaaDate(d.time_tag),
                    flux: d.flux,
                    energy: d.energy,
                }))
                .filter(d => d.timestamp !== null && d.flux > 0 && d.energy); // Ensure timestamp, flux, and energy are valid
        }
    }
    
    let flareData = [];
    if (flareRes.status === 'fulfilled' && flareRes.value.ok) {
        const rawFlareData = await flareRes.value.json();
        if (Array.isArray(rawFlareData)) {
            // Basic validation for flare data
            flareData = rawFlareData.filter(flare => 
                flare && typeof flare.flrID === 'string' &&
                typeof flare.beginTime === 'string' &&
                typeof flare.classType === 'string'
            );
        }
    }

    return new Response(JSON.stringify({ xrayData: processedXray, protonData: processedProton, flareData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    console.error("Error in server function:", err);
    return new Response(JSON.stringify({ error: 'Failed to fetch or process data from external APIs.' }), { status: 502 });
  }
};