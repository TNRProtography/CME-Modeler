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
