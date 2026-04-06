// Worker base URLs — must match SolarActivityDashboard constants exactly
const CORONAGRAPHY_WORKER_BASE = 'https://coronagraphy-processing.thenamesrock.workers.dev';
const SUVI_DIFF_WORKER_BASE = 'https://suvi-difference-imagery.thenamesrock.workers.dev';

let started = false;

const preloadRequests = [
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-7-day.json',
  'https://services.swpc.noaa.gov/json/sunspot_report.json',
  'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png',
  '/api/proxy/image?url=https%3A%2F%2Fsdo.gsfc.nasa.gov%2Fassets%2Fimg%2Flatest%2Flatest_1024_HMIBC.jpg&ttl=60',
];

const preloadBundles = [
  () => import('../components/SolarSurferGame'),
  () => import('../components/ImpactGraphModal'),
];

// Module-level cache for worker state — fetches start at app init (during the
// loading screen) so SolarActivityDashboard can await an already-in-flight
// promise instead of starting a cold fetch after the loader dismisses.
export const workerStatePreload: {
  coronagraph: Promise<any> | null;
  suvi: Promise<any> | null;
} = { coronagraph: null, suvi: null };

export const startAppPreload = () => {
  if (started) return;
  started = true;
  if (import.meta.env.DEV) console.info('[preload] app preload start');

  preloadBundles.forEach((load) => {
    load().catch(() => undefined);
  });

  preloadRequests.forEach((url) => {
    fetch(url, { method: 'GET', cache: 'force-cache' }).catch(() => undefined);
  });

  // Kick off worker state fetches immediately — fire and forget, but store the
  // promise so SolarActivityDashboard can consume it without a duplicate request.
  // These do NOT block the loading screen; they run in parallel with everything else.
  workerStatePreload.coronagraph = fetch(`${CORONAGRAPHY_WORKER_BASE}/api/state`, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .catch(() => null);

  workerStatePreload.suvi = fetch(`${SUVI_DIFF_WORKER_BASE}/api/state`, { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .catch(() => null);

  if (import.meta.env.DEV) console.info('[preload] app preload queued');
};
