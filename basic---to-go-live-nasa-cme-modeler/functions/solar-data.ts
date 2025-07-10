interface SolarActivityResponse {
  xrayData: any[];
  protonData: any[];
  flareData: any[];
  error?: string;
}

declare interface Env {
  SECRET_NASA_API_KEY: string;
}

// --- NEW: Bulletproof date parser that runs on the server ---
const parseNoaaDate = (dateString: string): number | null => {
  if (!dateString) return null;
  // This format "YYYY-MM-DD HH:mm:ss" is not a valid ISO string.
  // We must replace the space with a 'T' and add a 'Z' to make it explicitly UTC.
  // Input:  "2024-07-11 12:34:56"
  // Output: "2024-07-11T12:34:56Z"
  const isoString = dateString.replace(' ', 'T') + 'Z';
  const timestamp = new Date(isoString).getTime();
  return isNaN(timestamp) ? null : timestamp;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.SECRET_NASA_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: SECRET_NASA_API_KEY not found.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
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

    // Process data on the server before sending to the client
    const xrayData = xrayRes.status === 'fulfilled' && xrayRes.value.ok ? await xrayRes.value.json() : [];
    const processedXray = Array.isArray(xrayData) ? xrayData.map(d => ({ ...d, timestamp: parseNoaaDate(d.time_tag) })) : [];

    const protonData = protonRes.status === 'fulfilled' && protonRes.value.ok ? await protonRes.value.json() : [];
    const processedProton = Array.isArray(protonData) ? protonData.map(d => ({ ...d, timestamp: parseNoaaDate(d.time_tag) })) : [];

    const flareData = flareRes.status === 'fulfilled' && flareRes.value.ok ? await flareRes.value.json() : [];

    return new Response(JSON.stringify({ xrayData: processedXray, protonData: processedProton, flareData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data from external APIs.' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};