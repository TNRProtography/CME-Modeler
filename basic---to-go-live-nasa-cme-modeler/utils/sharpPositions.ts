// Sunspot positions from SDO/HMI SHARPs, updated every twelve minutes.
//
// NOAA's Solar Region Summary is issued once a day from positions hand-
// measured at 2400Z, so by evening every region has turned nine or ten
// degrees since it was measured - and at the size of most groups that is more
// than the group. SHARPs (Space-weather HMI Active Region Patches) are
// computed by the HMI pipeline from the same magnetograms the tracker shows,
// every 720 seconds, with a near-real-time latency of an hour or two. Each
// patch carries the NOAA number it belongs to and its flux-weighted centre.
//
// So NOAA still says WHICH regions exist and what class they are; SHARPs say
// where they are now. A region SHARPs have not caught up with keeps its NOAA
// position, carried forward for rotation as before.
//
// The response shape, from a real query:
//   {"keywords":[{"name":"T_REC","values":[...]},{"name":"HARPNUM","values":[...]},
//                {"name":"NOAA_AR","values":[...]},{"name":"LAT_FWT","values":[...]},
//                {"name":"LON_FWT","values":[...]}]}
// Columns, not rows, and every value a string.

const JSOC_INFO = 'http://jsoc.stanford.edu/cgi-bin/ajax/jsoc_info';
const SERIES = 'hmi.sharp_720s_nrt';
const KEYS = 'T_REC,HARPNUM,NOAA_AR,LAT_FWT,LON_FWT';

/** TAI has run 37 seconds ahead of UTC since 2017. */
const TAI_MINUS_UTC_MS = 37000;

export interface SharpPosition {
  harp: number;
  /** NOAA's full number, e.g. 14538. */
  noaa: number;
  /** Stonyhurst degrees, west positive - flux-weighted over the patch. */
  latitude: number;
  longitude: number;
  /** When HMI measured it, UTC. */
  atMs: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The query for the last few hours of SHARPs.
 *
 * A window rather than "latest record" - JSOC rejected the [$] form outright
 * (status 6), and the window form is the one verified against the live server.
 * Six hours covers the pipeline's usual latency with room to spare.
 */
export function sharpQueryUrl(nowMs: number = Date.now(), hours = 6): string {
  // Rounded to the SHARP cadence, so every visitor inside the same twelve
  // minutes asks the identical question and the proxy's edge cache answers
  // all but the first. Unrounded, the URL changed every minute and the cache
  // never hit - every page load went to Stanford.
  const cadence = 12 * 60000;
  const rounded = Math.floor(nowMs / cadence) * cadence;
  const start = new Date(rounded - hours * 3600000 + TAI_MINUS_UTC_MS);
  const stamp = `${start.getUTCFullYear()}.${pad(start.getUTCMonth() + 1)}.${pad(start.getUTCDate())}`
    + `_${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}_TAI`;
  const ds = `${SERIES}[][${stamp}/${hours}h]`;
  return `${JSOC_INFO}?ds=${encodeURIComponent(ds)}&op=rs_list&key=${KEYS}`;
}

/** "2026.09.22_17:00:00_TAI" to UTC milliseconds. */
export function parseTRec(value: string): number | null {
  const m = String(value ?? '').match(/^(\d{4})\.(\d{2})\.(\d{2})_(\d{2}):(\d{2})(?::(\d{2}))?_TAI$/);
  if (!m) return null;
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0));
  return ms - TAI_MINUS_UTC_MS;
}

/**
 * The newest position of each numbered patch.
 *
 * Unnumbered patches (NOAA_AR "0") are dropped: there is no NOAA region to
 * attach them to, and a label with no number would be a new thing on the Sun
 * that nobody else can look up. Records whose centre is NaN - a patch with no
 * measurable flux in that frame - are skipped rather than drawn at 0,0.
 */
export function parseSharpResponse(json: any): SharpPosition[] {
  const columns = new Map<string, any[]>();
  for (const k of json?.keywords ?? []) {
    if (k?.name && Array.isArray(k.values)) columns.set(k.name, k.values);
  }
  const tRec = columns.get('T_REC'), harp = columns.get('HARPNUM'), noaa = columns.get('NOAA_AR');
  const lat = columns.get('LAT_FWT'), lon = columns.get('LON_FWT');
  if (!tRec || !harp || !noaa || !lat || !lon) return [];

  const newest = new Map<number, SharpPosition>();
  for (let i = 0; i < tRec.length; i++) {
    const noaaNum = Number(noaa[i]);
    if (!Number.isFinite(noaaNum) || noaaNum <= 0) continue;
    const latitude = Number(lat[i]);
    const longitude = Number(lon[i]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const atMs = parseTRec(tRec[i]);
    if (atMs == null) continue;
    const harpNum = Number(harp[i]);

    // Keyed by HARP, because one NOAA region can span two patches and the
    // newest record of each is what matters; they are merged per region below.
    const existing = newest.get(harpNum);
    if (!existing || atMs > existing.atMs) {
      newest.set(harpNum, { harp: harpNum, noaa: noaaNum, latitude, longitude, atMs });
    }
  }
  return [...newest.values()];
}

/**
 * The key NOAA's region lists use, which is the last four digits.
 *
 * SHARPs carry the full number (14538); the SRS and everyone who talks about
 * sunspots say 4538. Matching on the full number would find nothing.
 */
export const regionKey = (id: string | number): string =>
  String(Math.abs(Number(String(id).replace(/\D/g, ''))) % 10000);

/**
 * One position per NOAA region.
 *
 * When a region spans more than one patch the newest measurement wins, and
 * between two of the same age the one nearer the region's other patches is
 * no better than the other - so it simply takes the first. That is rare; the
 * common case is one patch per region.
 */
export function sharpByRegion(positions: SharpPosition[]): Map<string, SharpPosition> {
  const out = new Map<string, SharpPosition>();
  for (const p of positions) {
    const key = regionKey(p.noaa);
    const existing = out.get(key);
    if (!existing || p.atMs > existing.atMs) out.set(key, p);
  }
  return out;
}

/**
 * Where a NOAA region is, preferring a SHARP measurement when there is one.
 *
 * Returns the region unchanged when SHARPs have nothing for it - a region
 * NOAA numbered this morning may not have a patch yet, and it is better drawn
 * from its NOAA position than not drawn.
 */
export function withSharpPosition<T extends { latitude: number | null; longitude: number | null }>(
  region: T & { region?: string; id?: string },
  sharp: Map<string, SharpPosition>,
  timeField: keyof T,
): T & { positionSource?: 'sharp' | 'noaa' } {
  const key = regionKey(region.region ?? region.id ?? '');
  const hit = sharp.get(key);
  if (!hit) return { ...region, positionSource: 'noaa' };
  return {
    ...region,
    latitude: hit.latitude,
    longitude: hit.longitude,
    [timeField]: hit.atMs,
    positionSource: 'sharp',
  };
}

// ── Fetching ────────────────────────────────────────────────────────────────

let cache: { atMs: number; value: Map<string, SharpPosition> } | null = null;
let inFlight: Promise<Map<string, SharpPosition>> | null = null;

/** SHARPs arrive every twelve minutes; asking more often gains nothing. */
const CACHE_MS = 10 * 60000;

/**
 * SHARP positions by region, through the app's own data proxy.
 *
 * JSOC sends no CORS header, so the browser cannot read it directly. Shared
 * across callers, so the tracker and the 3D Sun opening together make one
 * request, not two. Never throws: no SHARPs means NOAA positions, which is
 * where the app was before this existed.
 */
export async function fetchSharpByRegion(): Promise<Map<string, SharpPosition>> {
  if (cache && Date.now() - cache.atMs < CACHE_MS) return cache.value;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const target = sharpQueryUrl();
    for (const base of ['/api/proxy/data', 'https://spottheaurora.co.nz/api/proxy/data']) {
      try {
        const res = await fetch(`${base}?url=${encodeURIComponent(target)}&ttl=600`);
        if (!res.ok) continue;
        const text = await res.text();
        // The SPA answers unknown routes with index.html and a 200, so check
        // it is JSON before believing it.
        if (!text.trimStart().startsWith('{')) continue;
        const value = sharpByRegion(parseSharpResponse(JSON.parse(text)));
        cache = { atMs: Date.now(), value };
        return value;
      } catch {
        // Next route.
      }
    }
    return cache?.value ?? new Map<string, SharpPosition>();
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

// ── History ─────────────────────────────────────────────────────────────────
//
// A region's position is the least interesting thing SHARPs record about it.
// Each record also carries its total unsigned magnetic flux (USFLUX) and the
// area of its strong-field pixels (AREA_ACR), and a region whose flux is
// climbing - new field emerging through the surface - is the kind that
// flares. NOAA's daily spot area cannot show that inside a day; an hourly
// flux series can.

export interface SharpHistoryPoint {
  atMs: number;
  /** Total unsigned flux, Maxwell. */
  usfluxMx: number;
  /**
   * Strong-field area, millionths of a hemisphere. Not the same quantity as
   * NOAA's sunspot area and usually several times larger - it counts all the
   * magnetised plage, not just the dark spots - so the two must never be
   * plotted on one axis.
   */
  areaMh: number;
}

const HISTORY_KEYS = 'T_REC,HARPNUM,NOAA_AR,USFLUX,AREA_ACR';

/**
 * Hourly SHARPs for the last few days.
 *
 * "@1h" asks JSOC for one record an hour rather than all five, which is a
 * fifth of the payload for a curve that looks identical. If the server
 * rejects the step, fetchSharpHistory falls back to an unstepped day.
 */
export function sharpHistoryUrl(nowMs: number = Date.now(), hours = 72, step: string | null = '1h'): string {
  // Rounded to the hour, so the proxy's edge cache is shared for an hour.
  const rounded = Math.floor(nowMs / 3600000) * 3600000;
  const start = new Date(rounded - hours * 3600000 + TAI_MINUS_UTC_MS);
  const stamp = `${start.getUTCFullYear()}.${pad(start.getUTCMonth() + 1)}.${pad(start.getUTCDate())}`
    + `_${pad(start.getUTCHours())}:${pad(start.getUTCMinutes())}_TAI`;
  const ds = `${SERIES}[][${stamp}/${hours}h${step ? `@${step}` : ''}]`;
  return `${JSOC_INFO}?ds=${encodeURIComponent(ds)}&op=rs_list&key=${HISTORY_KEYS}`;
}

/**
 * Flux and area over time, per NOAA region.
 *
 * A region that spans two patches is summed at each moment, because flux and
 * area are totals and both halves are the region. Thinned to one point an
 * hour so an unstepped response draws the same curve as a stepped one.
 */
export function parseSharpHistory(json: any): Map<string, SharpHistoryPoint[]> {
  const columns = new Map<string, any[]>();
  for (const k of json?.keywords ?? []) {
    if (k?.name && Array.isArray(k.values)) columns.set(k.name, k.values);
  }
  const tRec = columns.get('T_REC'), noaa = columns.get('NOAA_AR');
  const flux = columns.get('USFLUX'), area = columns.get('AREA_ACR');
  if (!tRec || !noaa || !flux || !area) return new Map();

  const harp = columns.get('HARPNUM');

  // region -> hour -> summed point
  const byRegion = new Map<string, Map<number, SharpHistoryPoint>>();
  // Several records in one hour from the SAME patch are one moment measured
  // again and must count once; from DIFFERENT patches they are two halves of
  // one region and must add. Hence tracking which patch filled which hour.
  const seen = new Set<string>();
  for (let i = 0; i < tRec.length; i++) {
    const noaaNum = Number(noaa[i]);
    if (!Number.isFinite(noaaNum) || noaaNum <= 0) continue;
    const f = Number(flux[i]);
    const a = Number(area[i]);
    if (!Number.isFinite(f) || !Number.isFinite(a)) continue;
    const atMs = parseTRec(tRec[i]);
    if (atMs == null) continue;

    const hour = Math.floor(atMs / 3600000) * 3600000;
    const key = regionKey(noaaNum);
    if (!byRegion.has(key)) byRegion.set(key, new Map());
    const hours = byRegion.get(key)!;
    const slot = `${hour}|${harp?.[i] ?? ''}`;
    if (seen.has(slot)) continue;
    seen.add(slot);

    const existing = hours.get(hour);
    if (existing) {
      existing.usfluxMx += f;
      existing.areaMh += a;
    } else {
      hours.set(hour, { atMs: hour, usfluxMx: f, areaMh: a });
    }
  }

  const out = new Map<string, SharpHistoryPoint[]>();
  for (const [key, hours] of byRegion) {
    out.set(key, [...hours.values()].sort((x, y) => x.atMs - y.atMs));
  }
  return out;
}

export interface FluxTrend {
  /** Percentage change over the last 24 hours, or null with too little data. */
  change24hPct: number | null;
  label: string;
  /** One sentence on what that means, for somebody who does not read Maxwells. */
  note: string;
}

/**
 * What the flux curve is doing, in words.
 *
 * Emerging flux is the best single precursor for flaring that a curve can
 * show, but it is a precursor, not a forecast - plenty of growing regions
 * never produce anything. The wording says "worth watching", not "will flare".
 */
export function fluxTrend(points: SharpHistoryPoint[]): FluxTrend {
  if (points.length < 2) {
    return { change24hPct: null, label: 'Not enough history', note: 'HMI has only just started tracking this region.' };
  }
  const last = points[points.length - 1];
  const target = last.atMs - 24 * 3600000;
  const then = points.reduce((best, p) =>
    Math.abs(p.atMs - target) < Math.abs(best.atMs - target) ? p : best, points[0]);
  const spanHours = (last.atMs - then.atMs) / 3600000;
  if (spanHours < 6 || then.usfluxMx <= 0) {
    return { change24hPct: null, label: 'Not enough history', note: 'Less than six hours of measurements so far.' };
  }
  const pct = ((last.usfluxMx - then.usfluxMx) / then.usfluxMx) * 100;
  const over = spanHours >= 20 ? 'the last day' : `the last ${Math.round(spanHours)} hours`;

  if (pct >= 20) {
    return { change24hPct: pct, label: 'Flux emerging fast',
      note: `Magnetic flux is up ${pct.toFixed(0)}% over ${over}. New field pushing through the surface is the classic setup for flares, so this one is worth watching - though many growing regions stay quiet.` };
  }
  if (pct >= 5) {
    return { change24hPct: pct, label: 'Growing',
      note: `Flux up ${pct.toFixed(0)}% over ${over}. Building, but not at a pace that stands out.` };
  }
  if (pct <= -10) {
    return { change24hPct: pct, label: 'Decaying',
      note: `Flux down ${Math.abs(pct).toFixed(0)}% over ${over}. Decaying regions can still flare, but it gets less likely as they break up.` };
  }
  return { change24hPct: pct, label: 'Stable',
    note: `Flux within a few percent of where it was ${over === 'the last day' ? 'a day ago' : spanHours.toFixed(0) + ' hours ago'}.` };
}

let historyCache: { atMs: number; value: Map<string, SharpHistoryPoint[]> } | null = null;
let historyInFlight: Promise<Map<string, SharpHistoryPoint[]>> | null = null;

async function fetchJsonThroughProxy(target: string): Promise<any | null> {
  for (const base of ['/api/proxy/data', 'https://spottheaurora.co.nz/api/proxy/data']) {
    try {
      const res = await fetch(`${base}?url=${encodeURIComponent(target)}&ttl=900`);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trimStart().startsWith('{')) continue;
      return JSON.parse(text);
    } catch {
      // Next route.
    }
  }
  return null;
}

/** Hourly flux and area per region, cached for half an hour. Never throws. */
export async function fetchSharpHistory(): Promise<Map<string, SharpHistoryPoint[]>> {
  if (historyCache && Date.now() - historyCache.atMs < 30 * 60000) return historyCache.value;
  if (historyInFlight) return historyInFlight;

  historyInFlight = (async () => {
    // Three days stepped hourly; if JSOC will not step, one day unstepped.
    let value = parseSharpHistory(await fetchJsonThroughProxy(sharpHistoryUrl(Date.now(), 72, '1h')));
    if (value.size === 0) {
      value = parseSharpHistory(await fetchJsonThroughProxy(sharpHistoryUrl(Date.now(), 24, null)));
    }
    if (value.size > 0) historyCache = { atMs: Date.now(), value };
    return value.size > 0 ? value : (historyCache?.value ?? value);
  })();

  try {
    return await historyInFlight;
  } finally {
    historyInFlight = null;
  }
}
