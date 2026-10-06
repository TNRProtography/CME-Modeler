// What is happening right now, for the what's-new tour to talk about.
//
// Each piece is fetched on its own with a short timeout and is optional: a
// tour step whose data did not arrive says what the feature does instead of
// what it shows today.

import { getChState } from './chDetectionStore';
import { startChLifecycleSync } from './chLifecycleSync';
import type { ProcessedCME } from '../types';

export interface ReleaseTourLive {
  substorm: { score: number; level: string } | null;
  regions: { count: number; biggest: { id: string; area: number; mChance: number | null; spots: number | null } | null } | null;
  holes: number | null;
  cmes: { total: number; earthDirected: number; fastest: { id: string; speed: number; arrivalMs: number | null } | null } | null;
}

const SUBSTORM_URL = 'https://aurora-index-sta.thenamesrock.workers.dev/api/substorm?resolution=5m';
const REGIONS_SOURCE = 'https://services.swpc.noaa.gov/json/solar_regions.json';
const PROXIES = ['/api/proxy/data', 'https://spottheaurora.co.nz/api/proxy/data'];

async function json(url: string, timeoutMs = 6000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function substorm(): Promise<ReleaseTourLive['substorm']> {
  try {
    const d = await json(SUBSTORM_URL);
    const score = Number(d?.current?.score);
    return Number.isFinite(score) ? { score: Math.round(score), level: String(d?.current?.level ?? '') } : null;
  } catch { return null; }
}

// NOAA's dates come with no zone; they are UTC.
const parseDay = (v: unknown): number => {
  const s = String(v ?? '');
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.length <= 10 ? `${s}T00:00:00` : s}Z`);
};

async function regions(): Promise<ReleaseTourLive['regions']> {
  for (const base of PROXIES) {
    try {
      const rows = await json(`${base}?url=${encodeURIComponent(REGIONS_SOURCE)}&ttl=900`);
      if (!Array.isArray(rows)) continue;
      // The newest report of each region, from the last two days.
      const newest = new Map<string, any>();
      for (const r of rows) {
        const id = String(r?.region ?? '').trim();
        const at = parseDay(r?.observed_date);
        if (!id || !Number.isFinite(at) || Date.now() - at > 2 * 86400000) continue;
        if (!newest.has(id) || at > parseDay(newest.get(id).observed_date)) newest.set(id, r);
      }
      const list = [...newest.values()];
      const big = list.sort((a, b) => (Number(b.area) || 0) - (Number(a.area) || 0))[0];
      const m = Number(big?.m_flare_probability ?? big?.m_class_1_day ?? big?.mflare_probability);
      return {
        count: list.length,
        biggest: big ? {
          id: String(big.region), area: Number(big.area) || 0,
          mChance: Number.isFinite(m) ? m : null,
          spots: Number.isFinite(Number(big.number_spots)) ? Number(big.number_spots) : null,
        } : null,
      };
    } catch { /* try the next */ }
  }
  return null;
}

function holes(): number | null {
  const latest = getChState().history.at(-1);
  if (!latest || Date.now() - latest.atMs > 36 * 3600000) return null;
  return latest.holes.length;
}

function cmes(list: ProcessedCME[]): ReleaseTourLive['cmes'] {
  if (!list.length) return null;
  const earth = list.filter((c) => c.isEarthDirected);
  const pool = earth.length ? earth : [];
  const fastest = pool.slice().sort((a, b) => b.speed - a.speed)[0];
  return {
    total: list.length,
    earthDirected: earth.length,
    fastest: fastest ? { id: fastest.id, speed: Math.round(fastest.speed), arrivalMs: fastest.predictedArrivalTime?.getTime() ?? null } : null,
  };
}

export async function gatherReleaseTourLive(cmeList: ProcessedCME[]): Promise<ReleaseTourLive> {
  startChLifecycleSync();
  const [s, r] = await Promise.all([substorm(), regions()]);
  return { substorm: s, regions: r, holes: holes(), cmes: cmes(cmeList) };
}
