// solar-data.ts

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
  let parsableString = dateString;
  if (!parsableString.endsWith('Z')) {
    parsableString = parsableString.replace(' ', 'T') + 'Z';
  }
  const timestamp = new Date(parsableString).getTime();
  return isNaN(timestamp) ? null : timestamp;
};

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const apiKey = context.env.SECRET_NASA_API_KEY;

  console.log('Worker: onRequestGet invoked.'); // Log invocation

  if (!apiKey) {
    console.error('Worker Error: SECRET_NASA_API_KEY not found in environment.');
    return new Response(JSON.stringify({ error: 'Server configuration error: SECRET_NASA_API_KEY not found.' }), { status: 500 });
  }
  console.log('Worker: NASA API Key found. Proceeding with external API calls.');

  const xrayUrl = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-6-hour.json';
  const protonUrl = 'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-6-hour.json';
  
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 7);
  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const flareUrl = `https://api.nasa.gov/DONKI/FLR?startDate=${formatDate(startDate)}&endDate=${formatDate(endDate)}&api_key=${apiKey}`;

  console.log('Worker: Fetching from URLs:', { xrayUrl, protonUrl, flareUrl });

  try {
    const [xrayRes, protonRes, flareRes] = await Promise.allSettled([
      fetch(xrayUrl),
      fetch(protonUrl),
      fetch(flareUrl),
    ]);

    // --- Logging results of each fetch ---
    console.log('Worker: All fetches settled.');
    console.log('Worker: X-ray fetch status:', xrayRes.status);
    console.log('Worker: Proton fetch status:', protonRes.status);
    console.log('Worker: Flare fetch status:', flareRes.status);

    let processedXray = [];
    if (xrayRes.status === 'fulfilled') {
        if (xrayRes.value.ok) {
            const rawXrayData = await xrayRes.value.json();
            console.log('Worker: X-ray data fetched successfully, first few items:', rawXrayData ? rawXrayData.slice(0, 5) : 'empty/null');
            if (Array.isArray(rawXrayData)) {
                processedXray = rawXrayData
                    .filter(d => d.energy === '0.1-0.8nm' && d.flux > 0)
                    .map(d => ({
                        timestamp: parseNoaaDate(d.time_tag),
                        flux: d.flux,
                    }))
                    .filter(d => d.timestamp !== null);
                console.log('Worker: X-ray data processed, valid points:', processedXray.length);
            } else {
                console.warn('Worker: X-ray response was not an array:', rawXrayData);
            }
        } else {
            console.error('Worker Error: X-ray fetch not OK, status:', xrayRes.value.status, 'text:', await xrayRes.value.text());
        }
    } else {
        console.error('Worker Error: X-ray fetch rejected:', xrayRes.reason);
    }

    let processedProton = [];
    if (protonRes.status === 'fulfilled') {
        if (protonRes.value.ok) {
            const rawProtonData = await protonRes.value.json();
            console.log('Worker: Proton data fetched successfully, first few items:', rawProtonData ? rawProtonData.slice(0, 5) : 'empty/null');
            if (Array.isArray(rawProtonData)) {
                processedProton = rawProtonData
                    .map(d => ({
                        timestamp: parseNoaaDate(d.time_tag),
                        flux: d.flux,
                        energy: d.energy,
                    }))
                    .filter(d => d.timestamp !== null && d.flux > 0 && d.energy);
                console.log('Worker: Proton data processed, valid points:', processedProton.length);
            } else {
                 console.warn('Worker: Proton response was not an array:', rawProtonData);
            }
        } else {
            console.error('Worker Error: Proton fetch not OK, status:', protonRes.value.status, 'text:', await protonRes.value.text());
        }
    } else {
        console.error('Worker Error: Proton fetch rejected:', protonRes.reason);
    }
    
    let flareData = [];
    if (flareRes.status === 'fulfilled') {
        if (flareRes.value.ok) {
            const rawFlareData = await flareRes.value.json();
            console.log('Worker: Flare data fetched successfully, first few items:', rawFlareData ? rawFlareData.slice(0, 5) : 'empty/null');
            if (Array.isArray(rawFlareData)) {
                flareData = rawFlareData.filter(flare => 
                    flare && typeof flare.flrID === 'string' &&
                    typeof flare.beginTime === 'string' &&
                    typeof flare.classType === 'string'
                );
                console.log('Worker: Flare data processed, valid points:', flareData.length);
            } else {
                console.warn('Worker: Flare response was not an array:', rawFlareData);
            }
        } else {
            console.error('Worker Error: Flare fetch not OK, status:', flareRes.value.status, 'text:', await flareRes.value.text());
        }
    } else {
        console.error('Worker Error: Flare fetch rejected:', flareRes.reason);
    }

    console.log('Worker: Returning final processed data.');
    return new Response(JSON.stringify({ xrayData: processedXray, protonData: processedProton, flareData }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const errorMessage = (err instanceof Error) ? err.message : String(err);
    console.error('Worker Fatal Error: Uncaught exception during data fetching/processing:', errorMessage, err);
    return new Response(JSON.stringify({ error: `Failed to fetch or process data from external APIs. Internal worker error: ${errorMessage}` }), { status: 502 });
  }
};