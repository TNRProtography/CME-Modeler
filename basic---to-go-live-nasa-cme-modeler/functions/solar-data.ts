interface SolarActivityResponse {
  xrayData: { timestamp: number; flux: number }[];
  protonData: { timestamp: number; flux: number; energy: string }[];
  flareData: any[];
  error?: string;
}

declare interface Env {
  SECRET_NASA_API_KEY: string;
}

const parseNoaaDate = (dateString: string): number | null => {
  if (typeof dateString !== 'string' || dateString.trim() === '') return null;
  const isoString = dateString.replace(' ', 'T') + 'Z';
  const timestamp = new Date(isoString).getTime();
  return isNaN(timestamp) ? null : timestamp;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.SECRET_NASA_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: SECRET_NASA_API_KEY not found.' }), { status: 500 });
  }

  // Using the exact URLs you provided
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

    // --- Correctly process X-Ray data on the server ---
    let processedXray = [];
    if (xrayRes.status === 'fulfilled' && xrayRes.value.ok) {
        const rawXrayData = await xrayRes.value.json();
        if (Array.isArray(rawXrayData)) {
            processedXray = rawXrayData
                .filter(d => d.energy === '0.1-0.8nm' && d.flux > 0)
                .map(d => ({
                    timestamp: parseNoaaDate(d.time_tag),
                    flux: d.flux,
                }))
                .filter(d => d.timestamp !== null);
        }
    }

    // --- Correctly process Proton data on the server ---
    let processedProton = [];
    if (protonRes.status === 'fulfilled' && protonRes.value.ok) {
        const rawProtonData = await protonRes.value.json();
        if (Array.isArray(rawProtonData)) {
            // This data format has NO header row, so we do NOT use .slice(1)
            processedProton = rawProtonData
                .map(d => ({
                    timestamp: parseNoaaDate(d.time_tag),
                    flux: d.flux,
                    energy: d.energy,
                }))
                .filter(d => d.timestamp !== null && d.flux > 0 && d.energy);
        }
    }
    
    let flareData = [];
    if (flareRes.status === 'fulfilled' && flareRes.value.ok) {
        flareData = await flareRes.value.json();
    }

    return new Response(JSON.stringify({ xrayData: processedXray, protonData: processedProton, flareData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch or process data from external APIs.' }), { status: 502 });
  }
};