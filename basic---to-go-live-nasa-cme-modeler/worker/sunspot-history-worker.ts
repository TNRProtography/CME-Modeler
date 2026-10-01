// Sunspot history worker.
//
// Every 15 minutes: NOAA's region list and probabilities, HMI SHARP flux, and
// DONKI flares, merged into two weeks of every sunspot region with every
// change timestamped (utils/sunspotHistory does the work; this fetches and
// stores). The sunspot tracker reads it.
//
// Bindings (wrangler-sunspot-history.toml):
//   SUNSPOT_HISTORY  KV namespace, one key: "state"
//   DONKI            service binding to the nasa-donki-api worker (flares)
// No secrets.
//
// Routes:
//   GET /api/regions            every region of the last 14 days, with every change
//   GET /api/regions?sharp=1    ... and each one's hourly magnetic flux
//   GET /api/regions?active=1   only the regions NOAA still lists
//   GET /api/region/<number>    one region
//   GET /api/status             when it last ran and what it found
//   GET /api/run                run now (at most once a minute)

import {
  applyFlares, applyRegionJson, applySharp, applySrs, backfillFromRegionJson, emptyState, parseSrs, prune,
  type SunspotHistoryState,
} from '../utils/sunspotHistory';
import { parseSharpHistory, sharpHistoryUrl, regionKey } from '../utils/sharpPositions';

// The parts of the Workers runtime used here, declared rather than pulling
// in @cloudflare/workers-types for the whole app's typecheck.
interface KVNamespace {
  get(key: string, type: 'json'): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
}
interface Fetcher { fetch(request: Request): Promise<Response> }
interface ExecutionContext { waitUntil(p: Promise<unknown>): void }
type ScheduledEvent = unknown;

interface Env {
  SUNSPOT_HISTORY: KVNamespace;
  DONKI?: Fetcher;
}

const SRS_URL = 'https://services.swpc.noaa.gov/text/solar-regions.txt';
const REGIONS_JSON_URL = 'https://services.swpc.noaa.gov/json/solar_regions.json';
const STATE_KEY = 'state';
const STATUS_KEY = 'status';
// NOAA's bot protection answers 403 to anything it does not recognise.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data: unknown, status = 200, maxAge = 120) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}`, ...CORS },
});

async function getText(url: string, timeoutMs = 20000): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

async function getJson(url: string, timeoutMs = 20000): Promise<any | null> {
  const text = await getText(url, timeoutMs);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

async function getFlares(env: Env): Promise<any[] | null> {
  if (!env.DONKI) return null;
  try {
    const res = await env.DONKI.fetch(new Request('https://nasa-donki-api/FLR'));
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

async function loadState(env: Env): Promise<SunspotHistoryState> {
  const stored = await env.SUNSPOT_HISTORY.get(STATE_KEY, 'json') as SunspotHistoryState | null;
  return stored?.version === 1 ? stored : emptyState();
}

export async function run(env: Env, nowMs = Date.now()) {
  const state = await loadState(env);
  const [srs, regionRows, sharpJson, flares] = await Promise.all([
    getText(SRS_URL),
    getJson(REGIONS_JSON_URL),
    // A day of SHARPs, hourly: the series fills in whatever the last runs
    // missed, and anything already stored is skipped.
    getJson(sharpHistoryUrl(nowMs, 24, '1h'), 25000),
    getFlares(env),
  ]);

  const counts = {
    backfill: regionRows ? backfillFromRegionJson(state, regionRows, nowMs) : 0,
    srs: srs ? applySrs(state, srs, nowMs) : 0,
    noaaJson: regionRows ? applyRegionJson(state, regionRows, nowMs) : 0,
    sharp: sharpJson ? applySharp(state, parseSharpHistory(sharpJson), nowMs) : 0,
    flares: flares ? applyFlares(state, flares, nowMs) : 0,
  };
  prune(state, nowMs);
  await env.SUNSPOT_HISTORY.put(STATE_KEY, JSON.stringify(state));

  const status = {
    ranAt: new Date(nowMs).toISOString(),
    sources: { srs: !!srs, regionJson: !!regionRows, sharp: !!sharpJson, flares: !!flares },
    newEvents: counts,
    regions: Object.keys(state.regions).length,
    active: Object.values(state.regions).filter((r) => r.active).length,
    srsValidAt: state.srsValidMs ? new Date(state.srsValidMs).toISOString() : null,
    // NOAA's region rows as they came, so the columns can be checked by eye.
    srsRows: srs ? srs.split(/\r?\n/).filter((l) => /^\s*\d{4,5}\s/.test(l)).slice(0, 15) : null,
    // How many regions today's bulletin listed; if none, what it looked like.
    srsRegions: srs ? parseSrs(srs, nowMs).regions.size : null,
    ...(srs && parseSrs(srs, nowMs).regions.size === 0 ? { srsSample: srs.split(/\r?\n/).slice(0, 14) } : {}),
  };
  await env.SUNSPOT_HISTORY.put(STATUS_KEY, JSON.stringify(status));
  return status;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    // Paths are matched in lower case: /api/RUN is /api/run.
    const pathname = url.pathname.toLowerCase().replace(/\/+$/, "") || "/";
    const { searchParams } = url;

    if (pathname === '/api/status' || pathname === '/') {
      const status = await env.SUNSPOT_HISTORY.get(STATUS_KEY, 'json');
      return json(status ?? { ranAt: null, note: 'Not run yet. GET /api/run, or wait for the cron.' }, 200, 30);
    }

    if (pathname === '/api/run') {
      const last = await env.SUNSPOT_HISTORY.get(STATUS_KEY, 'json') as { ranAt?: string } | null;
      if (last?.ranAt && Date.now() - Date.parse(last.ranAt) < 60000) {
        return json({ ok: false, note: 'Ran less than a minute ago.', last }, 429, 0);
      }
      return json({ ok: true, ...(await run(env)) }, 200, 0);
    }

    if (pathname === '/api/regions') {
      const state = await loadState(env);
      const activeOnly = searchParams.get('active') === '1';
      // The hourly flux series is most of the size; only with ?sharp=1.
      const withSharp = searchParams.get('sharp') === '1';
      const regions = Object.values(state.regions)
        .filter((r) => !activeOnly || r.active)
        .map((r) => (withSharp ? r : { ...r, sharp: [] }))
        .sort((a, b) => Number(b.active) - Number(a.active) || (b.current.areaMsh ?? 0) - (a.current.areaMsh ?? 0));
      return json({ updatedMs: state.updatedMs, srsValidMs: state.srsValidMs, regions });
    }

    const one = pathname.match(/^\/api\/region\/(\d{1,5})$/);
    if (one) {
      const state = await loadState(env);
      const rec = state.regions[regionKey(one[1])];
      return rec ? json({ updatedMs: state.updatedMs, region: rec }) : json({ error: 'Unknown region' }, 404, 60);
    }

    return json({ error: 'Not found', routes: ['/api/regions', '/api/region/<number>', '/api/status', '/api/run'] }, 404, 300);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env).then(() => undefined));
  },
};
