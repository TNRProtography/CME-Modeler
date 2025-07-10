// Define the structure of the data we'll return to the app
interface SolarActivityResponse {
  xrayData: any[];
  protonData: any[];
  flareData: any[];
  error?: string;
}

// Declare the PagesFunction type and Env for Cloudflare
declare interface Env {
    SECRET_NASA_API_KEY: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  // Get the secret NASA API key from Cloudflare's environment variables
  const apiKey = context.env.SECRET_NASA_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'NASA API key is not configured on the server.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // API endpoints
  const xrayUrl = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-5-minute.json';
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

    const response: SolarActivityResponse = {
      xrayData: xrayRes.status === 'fulfilled' && xrayRes.value.ok ? await xrayRes.value.json() : [],
      protonData: protonRes.status === 'fulfilled' && protonRes.value.ok ? await protonRes.value.json() : [],
      flareData: flareRes.status === 'fulfilled' && flareRes.value.ok ? await flareRes.value.json() : [],
    };
    
    return new Response(JSON.stringify(response), {
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