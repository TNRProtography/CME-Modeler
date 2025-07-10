interface SolarActivityResponse {
  xrayData: any[];
  protonData: any[];
  flareData: any[];
  error?: string;
}

declare interface Env {
  SECRET_NASA_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.SECRET_NASA_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: SECRET_NASA_API_KEY not found.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // --- All external URLs are defined here ---
  const xrayUrl = 'https://services.swpc.noaa.gov/json/goes/secondary/xrays-5-minute.json';
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

    const responseData: SolarActivityResponse = {
      xrayData: xrayRes.status === 'fulfilled' && xrayRes.value.ok ? await xrayRes.value.json() : [],
      protonData: protonRes.status === 'fulfilled' && protonRes.value.ok ? await protonRes.value.json() : [],
      flareData: flareRes.status === 'fulfilled' && flareRes.value.ok ? await flareRes.value.json() : [],
    };
    
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data from external APIs.' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};