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

  if (import.meta.env.DEV) console.info('[preload] app preload queued');
};
