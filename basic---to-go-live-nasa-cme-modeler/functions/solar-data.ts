declare interface Env {
  SECRET_NASA_API_KEY: string;
}

// This function ONLY fetches the protected NASA flare data.
// All other data is fetched from the client.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.SECRET_NASA_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: SECRET_NASA_API_KEY not found.' }), { status: 500 });
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 7);
  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const flareUrl = `https://api.nasa.gov/DONKI/FLR?startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}&api_key=${apiKey}`;

  try {
    const response = await fetch(flareUrl);
    if (!response.ok) {
        const errorText = await response.text();
        return new Response(JSON.stringify({ error: `NASA API Error: ${errorText}`}), { status: response.status });
    }
    const flareData = await response.json();
    
    return new Response(JSON.stringify(flareData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Failed to fetch data from the NASA API.' }), { status: 502 });
  }
};