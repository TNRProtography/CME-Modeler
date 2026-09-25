import { fetchGoesProtons, fetchGoesXrays } from './goesSeries';
import { startImageryPreload } from './imageryPreload';
import { sharedFetchJson } from './sharedFetch';

/**
 * How long one read of an imagery worker's state serves everyone who asks.
 * Under the solar page's 30-second refresh, so each refresh still reads it.
 */
export const WORKER_STATE_SHARE_MS = 25000;

// Worker base URLs - must match SolarActivityDashboard constants exactly
const CORONAGRAPHY_WORKER_BASE = 'https://coronagraphy-processing.thenamesrock.workers.dev';
const SUVI_DIFF_WORKER_BASE = 'https://suvi-difference-imagery.thenamesrock.workers.dev';

let started = false;

const preloadBundles = [
  () => import('../components/game/AuroraGame'),
  () => import('../components/ImpactGraphModal'),
];

// The imagery workers' state, read once the app is up, for the imagery
// preload. Panels read it through the shared fetch, not from here, so they
// never show a read older than a few seconds.
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

  // The week-long GOES series: topped up from what an earlier visit left,
  // and shared with the panels that ask for them while this is in flight.
  fetchGoesXrays('primary').catch(() => undefined);
  fetchGoesProtons('primary').catch(() => undefined);

  // The imagery workers' state, which the imagery preload below reads.
  // Shared (utils/sharedFetch), so the solar page, the coronal hole outlook
  // and the imagery preload asking at the same moment make one request.
  workerStatePreload.coronagraph = sharedFetchJson(`${CORONAGRAPHY_WORKER_BASE}/api/state`, { maxAgeMs: WORKER_STATE_SHARE_MS })
    .catch(() => null);

  workerStatePreload.suvi = sharedFetchJson(`${SUVI_DIFF_WORKER_BASE}/api/state`, { maxAgeMs: WORKER_STATE_SHARE_MS })
    .catch(() => null);

  // Then the solar imagery - sunspot week, SUVI, coronagraphs - in the
  // background, once the first screen has had its turn at the network.
  const imageryState = { coronagraph: workerStatePreload.coronagraph, suvi: workerStatePreload.suvi };
  window.setTimeout(() => startImageryPreload(imageryState), 2000);

  if (import.meta.env.DEV) console.info('[preload] app preload queued');
};
