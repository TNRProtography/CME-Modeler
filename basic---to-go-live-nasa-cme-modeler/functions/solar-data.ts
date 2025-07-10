interface SolarActivityResponse {
  xrayData: any[];
  protonData: any[];
  flareData: any[];
  error?: string;
}

declare interface Env {
  SECRET_NASA_API_KEY: string;
}

// This is a robust, server-side function to parse ambiguous NOAA date strings
// It converts "YYYY-MM-DD HH:mm:ss" into a reliable Unix timestamp (number)
const parseNoaaDate = (dateString: string): number | null => {
  if (!dateString) return null;
  const isoString = dateString.replace(' ', 'T') + 'Z';
  const timestamp = new Date(isoString).getTime();
  return isNaN(timestamp) ? null : timestamp;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.SECRET_NASA_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: SECRET_NASA_API_KEY not found.' }), { status: 500 });
  }

  const xrayUrl = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
  const protonUrl = 'https://services.swpc.noaa.gov/json/goes/primary/protons-5-minute.json';
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

    // --- Correctly process X-Ray data on the server ---
    const rawXrayData = xrayRes.status === 'fulfilled' && xrayRes.value.ok ? await xrayRes.value.json() : [];
    const processedXray = Array.isArray(rawXrayData)
      ? rawXrayData
          .filter(d => d.energy === '0.1-0.8nm') // 1. Keep only the flare classification band
          .map(d => ({
            timestamp: parseNoaaDate(d.time_tag), // 2. Create reliable numeric timestamp
            flux: d.flux,                         // 3. Use the correct "flux" field
          }))
          .filter(d => d.timestamp !== null)      // 4. Remove any entries that couldn't be parsed
      : [];

    // Correctly process Proton data on the server
    const rawProtonData = protonRes.status === 'fulfilled' && protonRes.value.ok ? await protonRes.value.json() : [];
    const processedProton = Array.isArray(rawProtonData) && rawProtonData.length > 1
      ? rawProtonData
          .slice(1) // Skip header row
          .map(d => ({
            timestamp: parseNoaaDate(d.time_tag),
            flux: d.flux,
          }))
          .filter(d => d.timestamp !== null)
      : [];
    
    const flareData = flareRes.status === 'fulfilled' && flareRes.value.ok ? await flareRes.value.json() : [];

    return new Response(JSON.stringify({ xrayData: processedXray, protonData: processedProton, flareData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data from external APIs.' }), { status: 502 });
  }
};