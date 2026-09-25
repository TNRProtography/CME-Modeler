// Time series that are kept between visits and topped up, not re-downloaded.
//
// Many of the app's sources publish the same series at several lengths -
// NOAA's GOES X-ray file comes as 6 hours, 1 day, 3 days and 7 days - and the
// app used to fetch the longest one on every refresh, megabytes each time,
// when all but the last few minutes were already on the device.
//
// So each series is stored (utils/localCache) for as long as it is useful -
// a week for a week-long chart - and a refresh asks only for the shortest
// variant that reaches back past the newest reading already held, with a
// little overlap. The new rows are merged in by identity, replacing any the
// source has since revised; anything older than the series is useful for is
// dropped. The network request itself is never served from a cache, so what
// is shown is always the latest the source has.

import { cacheGet, cacheSet } from './localCache';

export interface SeriesVariant {
  /** How far back this file reaches. */
  spanMs: number;
  url: string;
}

interface Stored<T> {
  rows: T[];
  /** When the longest variant was last fetched in full. */
  fullAtMs: number;
}

export interface IncrementalSeriesOptions<T> {
  /** Storage key: one per series. */
  key: string;
  /** Shortest first. The last is the full window. */
  variants: SeriesVariant[];
  /** How long rows are worth keeping. */
  retentionMs: number;
  timeOf: (row: T) => number;
  /** What makes two rows the same reading - usually time plus channel. */
  idOf: (row: T) => string;
  /** Fetches and parses one variant. Should bypass HTTP caches. */
  fetchRows: (url: string) => Promise<T[]>;
  /** Re-read so much before the newest held row, to pick up revisions. */
  overlapMs?: number;
  nowMs?: number;
  /**
   * Only what is newer than what is held - the shortest file that covers
   * it, and the shortest of all when nothing is held. For a caller that wants
   * the latest reading, like the X-ray banner, which should not pull a week
   * of history on a first visit just to read one number. Whatever it fetches
   * is kept, and the next full caller fills in the rest.
   */
  recentOnly?: boolean;
}

const HOUR = 3600000;
/** Do not keep re-fetching the full window when the source itself is short. */
const FULL_REFETCH_MIN_GAP_MS = 6 * HOUR;

/** Which variant a refresh should ask for, given what is already held. */
export function chooseVariant(
  variants: SeriesVariant[],
  held: { newestMs: number | null; oldestMs: number | null; fullAtMs: number },
  retentionMs: number,
  nowMs: number,
  overlapMs: number,
): number {
  const full = variants.length - 1;
  if (held.newestMs == null || held.oldestMs == null) return full;
  // Held rows do not reach back as far as the series should, and the full
  // window has not been tried lately: fill it in.
  const reach = nowMs - held.oldestMs;
  if (reach < retentionMs * 0.9 && nowMs - held.fullAtMs > FULL_REFETCH_MIN_GAP_MS) return full;
  const needed = nowMs - held.newestMs + overlapMs;
  const i = variants.findIndex((v) => v.spanMs >= needed);
  return i === -1 ? full : i;
}

/** Stored and new rows together: new ones win, old ones age out, sorted by time. */
export function mergeRows<T>(
  held: T[],
  fresh: T[],
  timeOf: (row: T) => number,
  idOf: (row: T) => string,
  cutoffMs: number,
): T[] {
  const byId = new Map<string, T>();
  for (const r of held) byId.set(idOf(r), r);
  for (const r of fresh) byId.set(idOf(r), r);
  return [...byId.values()]
    .filter((r) => { const t = timeOf(r); return Number.isFinite(t) && t >= cutoffMs; })
    .sort((a, b) => timeOf(a) - timeOf(b));
}

// Callers asking for the same series the same way at the same moment share
// one top-up, and one that finished a few seconds ago - the banner and a
// dashboard opening together both want the X-ray series, for instance. A
// full top-up answers a recent-only caller too, not the other way round.
//
// Top-ups of one series run one after another, never side by side: each
// merges into what the last one stored, so two at once could each write
// back only their own rows.
const running = new Map<string, Promise<unknown>>();
const tails = new Map<string, Promise<unknown>>();
const recent = new Map<string, { atMs: number; rows: unknown[]; full: boolean }>();
const REUSE_MS = 10000;

export function fetchIncrementalSeries<T>(o: IncrementalSeriesOptions<T>): Promise<T[]> {
  const full = !o.recentOnly;
  const runKey = `${o.key}|${full ? 'full' : 'recent'}`;
  const existing = running.get(runKey) ?? (full ? undefined : running.get(`${o.key}|full`));
  if (existing) return existing as Promise<T[]>;
  const nowMs = o.nowMs ?? Date.now();
  const last = recent.get(o.key);
  if (last && (last.full || !full) && nowMs - last.atMs >= 0 && nowMs - last.atMs < REUSE_MS) {
    return Promise.resolve(last.rows as T[]);
  }
  const before = tails.get(o.key) ?? Promise.resolve();
  const p: Promise<T[]> = before.catch(() => {}).then(() => topUp(o))
    .then((rows) => {
      // A recent-only top-up onto a week already held is as good as a full one.
      const covers = rows.length > 0 && nowMs - o.timeOf(rows[0]) >= o.retentionMs * 0.9;
      recent.set(o.key, { atMs: nowMs, rows, full: full || covers });
      return rows;
    })
    .finally(() => {
      running.delete(runKey);
      if (tails.get(o.key) === p) tails.delete(o.key);
    });
  running.set(runKey, p);
  tails.set(o.key, p);
  return p;
}

async function topUp<T>(o: IncrementalSeriesOptions<T>): Promise<T[]> {
  const nowMs = o.nowMs ?? Date.now();
  const overlapMs = o.overlapMs ?? 30 * 60000;
  const stored = (await cacheGet<Stored<T>>(`series:${o.key}`)) ?? { rows: [], fullAtMs: 0 };
  const cutoff = nowMs - o.retentionMs;
  const held = stored.rows.filter((r) => o.timeOf(r) >= cutoff);

  const newestMs = held.length ? o.timeOf(held[held.length - 1]) : null;
  let start = chooseVariant(o.variants, {
    newestMs,
    oldestMs: held.length ? o.timeOf(held[0]) : null,
    fullAtMs: stored.fullAtMs,
  }, o.retentionMs, nowMs, overlapMs);
  if (o.recentOnly) {
    // Just past what is held: never the fill-in of the whole window.
    const needed = newestMs == null ? 0 : nowMs - newestMs + overlapMs;
    const i = o.variants.findIndex((v) => v.spanMs >= needed);
    start = Math.min(start, i === -1 ? o.variants.length - 1 : i);
  }

  // The chosen variant, then longer ones if it fails.
  let fresh: T[] | null = null;
  let used = -1;
  let lastError: unknown = null;
  for (let i = start; i < o.variants.length; i++) {
    try {
      fresh = await o.fetchRows(o.variants[i].url);
      used = i;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (!fresh) {
    // Nothing reachable. What is held is still true, just not topped up.
    if (held.length) return held;
    throw lastError instanceof Error ? lastError : new Error(`No variant of ${o.key} could be fetched`);
  }

  const rows = mergeRows(held, fresh, o.timeOf, o.idOf, cutoff);
  void cacheSet<Stored<T>>(`series:${o.key}`, {
    rows,
    fullAtMs: used === o.variants.length - 1 ? nowMs : stored.fullAtMs,
  });
  return rows;
}

/** NOAA SWPC publishes its GOES files at these four lengths. */
export function goesVariants(base: string, name: string, upTo: '1-day' | '3-day' | '7-day' = '7-day'): SeriesVariant[] {
  const all: SeriesVariant[] = [
    { spanMs: 6 * HOUR, url: `${base}/${name}-6-hour.json` },
    { spanMs: 24 * HOUR, url: `${base}/${name}-1-day.json` },
    { spanMs: 72 * HOUR, url: `${base}/${name}-3-day.json` },
    { spanMs: 168 * HOUR, url: `${base}/${name}-7-day.json` },
  ];
  const last = { '1-day': 1, '3-day': 2, '7-day': 3 }[upTo];
  return all.slice(0, last + 1);
}
