/**
 * SDO imagery store: the sunspot tracker's HMI frames, kept for a week.
 *
 * The tracker scrubs back through SDO's browse archive. Reading that archive
 * straight from the browser works, but every frame is a trip to NASA through
 * the image proxy, and on a bad day for sdo.gsfc.nasa.gov the scrubber is
 * empty. This worker copies the frames into R2 (sdo-imagery) as they appear,
 * so the app reads them from Cloudflare instead.
 *
 * What is stored is exactly what the app would have asked for: for each view
 * (colorised, magnetogram, intensity), the product utils/hmiArchive picks,
 * one frame per quarter-hour, at 512, 1024 and 2048 px. Eight days are kept,
 * so a seven-day window is always full.
 *
 *   GET /api/frames?mode=&from=&to=   the same answer as /api/hmi-frames,
 *                                     with URLs into this worker
 *   GET /img/<product>/<file>.jpg      a stored frame
 *   GET /latest/<view>_4096            the newest 4096 px image of a view
 *                                      (colorized, magnetogram, intensity)
 *   GET /api/status                    what is stored and how the last run went
 *
 * SDO's browse archive can run days behind (it did in September 2026, stopping
 * four days short of now while JSOC's live images kept updating). So the live
 * 1024 px image of each view is also saved as it changes, as its own product
 * (HMILBC, HMILB, HMILIF). Recent hours come from those; the archive fills in
 * everything before them.
 *
 * Each new 4096 px image from JSOC is kept too, for the same eight days, as
 * the 4K product of its view (HMIXBC, HMIXB, HMIXIF). The live frame nearest
 * in time gets it as its sharp copy (HmiFrame.detail), so the tracker's region
 * close-up plays back at full HMI resolution instead of a 1024 px frame blown
 * up six times. Only JSOC's: it is the same quick-look series as the 1024 px
 * live frames, framed identically, so the close-up lands on the same spot.
 * Archive frames get SDO's own 4096 px copy (HmiFrame.hd), read through the
 * app's image proxy rather than stored, so the close-up is full resolution
 * at SDO's quarter-hour cadence wherever the archive reaches.
 *
 * The live images only change when JSOC posts, which in September 2026 was
 * about every hour and a half, and they cannot fill the days before the store
 * began. So for the two views Helioviewer carries (magnetogram, intensity),
 * each quarter-hour the archive does not cover is filled from Helioviewer's
 * HMI images, rendered at the same scale as SDO's 1024 px frames (HMIHVB,
 * HMIHVI). Colorized has no Helioviewer equivalent.
 *
 * A new store fills itself: each run downloads the newest missing frames first
 * and works backwards, so a week is there within about a day. Until then,
 * /api/frames fills the part of a window it does not hold yet from SDO's own
 * listings, exactly as the Pages route does, so the app never sees a gap.
 */

import {
  browseDirUrl, daysCovering, framesFromListings, HMI_MODES, intervalForWindow, productsFor,
  thinFrames, type HmiFrame, type HmiMode,
} from '../utils/hmiArchive';

interface R2Object { body: ReadableStream; httpEtag: string; size: number; httpMetadata?: { contentType?: string } }
interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(key: string, value: ArrayBuffer | string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
}
interface Env { SDO_BUCKET: R2Bucket }
interface Ctx { waitUntil(p: Promise<unknown>): void }

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Kept a day past the week, so "the last seven days" never loses its oldest hours. */
export const RETENTION_MS = 8 * DAY;
/** One frame per quarter-hour: the tracker's finest spacing. */
export const STEP_MS = 15 * MINUTE;
export const SIZES = [512, 1024, 2048] as const;
/**
 * Images one run may download. Steady state needs about nine per run; the
 * rest goes to filling the week backwards. Kept under the free plan's 50
 * subrequests, which the day listings and the 4K images (up to six) share.
 */
export const DOWNLOADS_PER_RUN = 30;
/** A day is only closed once SDO has had time to post its last frames. */
const DAY_SETTLE_MS = 6 * HOUR;
const MAX_WINDOW_MS = 8 * DAY;
const MANIFEST_KEY = 'manifest.json';
const FETCH_TIMEOUT_MS = 20000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/**
 * The live 4096 px image of each view, best source first: JSOC posts it
 * soonest, SDO's own "latest" is the fallback. The magnetogram comes from
 * JSOC as a GIF, so what is served keeps whatever type it arrived as.
 */
const JSOC_LATEST = 'https://jsoc1.stanford.edu/data/hmi/images/latest';
const SDO_LATEST = 'https://sdo.gsfc.nasa.gov/assets/img/latest';
export const LATEST_SOURCES: Record<HmiMode, string[]> = {
  colorized: [`${JSOC_LATEST}/HMI_latest_color_Mag_4096x4096.jpg`, `${SDO_LATEST}/latest_4096_HMIBC.jpg`],
  magnetogram: [`${JSOC_LATEST}/HMI_latest_Mag_4096x4096.gif`, `${SDO_LATEST}/latest_4096_HMIB.jpg`],
  intensity: [`${JSOC_LATEST}/HMI_latest_colInt_4096x4096.jpg`, `${SDO_LATEST}/latest_4096_HMII.jpg`],
};
/**
 * How often each 4K image is checked. HMI posts a new one about every
 * quarter-hour and each is several megabytes, so checking every run would
 * mostly re-download the same picture if the host ignores If-Modified-Since.
 */
export const LATEST_CHECK_MS = 10 * MINUTE;
const latestKey = (mode: HmiMode) => `latest/${mode}_4096`;

/** The live 1024 px image of each view, saved as it changes. */
export const LIVE_SOURCES: Record<HmiMode, { product: string; url: string }> = {
  colorized: { product: 'HMILBC', url: `${JSOC_LATEST}/HMI_latest_color_Mag_1024x1024.jpg` },
  magnetogram: { product: 'HMILB', url: `${JSOC_LATEST}/HMI_latest_Mag_1024x1024.gif` },
  intensity: { product: 'HMILIF', url: `${JSOC_LATEST}/HMI_latest_colInt_1024x1024.jpg` },
};
const LIVE_PRODUCTS = new Set(Object.values(LIVE_SOURCES).map((s) => s.product));

/** Where each view's 4K history is kept: JSOC's 4096 px image, as it changes. */
export const HD_PRODUCTS: Record<HmiMode, string> = { colorized: 'HMIXBC', magnetogram: 'HMIXB', intensity: 'HMIXIF' };
/** A live frame takes the 4K image nearest it in time, if one is this close. */
export const HD_MATCH_MS = 20 * MINUTE;

/**
 * Helioviewer's HMI images, for the quarter-hours SDO's browse archive does
 * not hold. It is current when that archive lags, and posts every few
 * minutes. Rendered full-disk at 2.016"/px (HMI's native 0.504"/px, four to a
 * pixel), the scale of SDO's 1024 px browse frames, so the disk is the same
 * size; the app still measures each product's disk itself.
 */
const HV_API = 'https://api.helioviewer.org/v2';
export const HV_SCALE = 2.016;
export const HV_SOURCES: Partial<Record<HmiMode, { product: string; sourceId: number; layers: string[] }>> = {
  magnetogram: { product: 'HMIHVB', sourceId: 19, layers: ['[SDO,HMI,HMI,magnetogram,1,100]', '[19,1,100]'] },
  intensity: { product: 'HMIHVI', sourceId: 18, layers: ['[SDO,HMI,HMI,continuum,1,100]', '[18,1,100]'] },
};
/**
 * Helioviewer frames one run may fetch, two requests each: a week's gap
 * fills in a few hours. Up to 48 more requests a run, which needs the Workers
 * paid plan (the free plan allows 50 in all).
 */
export const HV_FRAMES_PER_RUN = 24;
/** A quarter-hour with no Helioviewer image this long after it ended is written off. */
const HV_GIVE_UP_MS = 3 * HOUR;
export const isLiveProduct = (product: string) => LIVE_PRODUCTS.has(product);

/**
 * A past day is only closed once each view has close to a full day of
 * archive frames (96 quarter-hours). A day SDO has not posted yet has none,
 * and must be looked at again, not written off.
 */
export const FULL_DAY_FRAMES = 80;
/** How often a past day that is not yet complete is listed again. */
const DAY_RECHECK_MS = HOUR;

interface DayCheck { atMs: number; missing: number; found: Record<string, number> }
interface LiveInfo { lastModified?: string; etag?: string; checkedAtMs: number }

interface LatestInfo {
  source: string;
  checkedAtMs: number;
  storedAtMs: number;
  contentType: string;
  bytes: number;
  etag?: string;
  lastModified?: string;
}

/** One stored moment of one product. */
interface Entry { t: number; stem: string; sizes: number[]; ext?: 'gif' | 'png' }

export interface Manifest {
  version: 1;
  /** Per product, oldest first. */
  products: Record<string, Entry[]>;
  /** UTC days (YYYYMMDD) whose frames are all stored; never listed again. */
  completeDays: string[];
  /** The newest 4096 px image of each view. */
  latest?: Partial<Record<HmiMode, LatestInfo>>;
  /** The live 1024 px source of each view, for conditional requests. */
  live?: Partial<Record<HmiMode, LiveInfo>>;
  /** When each incomplete day was last listed, and what it held. */
  dayChecks?: Record<string, DayCheck>;
  /** Per Helioviewer product, quarter-hours (slot numbers) Helioviewer had nothing for. */
  hvEmpty?: Record<string, number[]>;
  lastRun?: { atMs: number; downloaded: number; latestDownloaded: number; liveSaved: number; hvSaved?: number; pruned: number; listings: number; errors: string[] };
}

const emptyManifest = (): Manifest => ({ version: 1, products: {}, completeDays: [] });

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
};
const objectKey = (product: string, stem: string, size: number, ext = 'jpg') => `hmi/${product}/${stem}_${size}.${ext}`;
const stemOf = (ms: number) => {
  const d = new Date(ms);
  return `${dayKey(ms)}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
};

// ── Listings ────────────────────────────────────────────────────────────────

export interface ListedMoment { t: number; stem: string; sizes: number[] }

/**
 * Every HMI frame in a day's listing, by product, in one pass.
 *
 * The listing is about a megabyte, mostly AIA. hmiArchive's parser searches
 * the whole text once per frame for the other sizes, which is fine for one
 * request but too slow for a cron with a CPU budget; this reads it once.
 */
export function parseListing(html: string): Map<string, ListedMoment[]> {
  const byProduct = new Map<string, Map<string, ListedMoment>>();
  // Jumps from one "_HMI" to the next and reads the name around it, rather
  // than running a regex over every AIA name too: about a quarter of the CPU,
  // which matters under the free plan's 10 ms per cron run.
  const before = /(\d{8})_(\d{6})_(512|1024|2048)$/;
  const after = /^_(HMI[A-Z]+)\.jpg/;
  for (let i = html.indexOf('_HMI'); i >= 0; i = html.indexOf('_HMI', i + 4)) {
    const b = before.exec(html.slice(Math.max(0, i - 21), i));
    const a = b && after.exec(html.slice(i, i + 16));
    if (!b || !a) continue;
    const [, date, time, size] = b;
    const product = a[1];
    const stem = `${date}_${time}`;
    let moments = byProduct.get(product);
    if (!moments) byProduct.set(product, (moments = new Map()));
    let entry = moments.get(stem);
    if (!entry) {
      const t = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8),
        +time.slice(0, 2), +time.slice(2, 4), +time.slice(4, 6));
      if (!Number.isFinite(t)) continue;
      moments.set(stem, (entry = { t, stem, sizes: [] }));
    }
    const s = Number(size);
    if (!entry.sizes.includes(s)) entry.sizes.push(s);
  }
  const out = new Map<string, ListedMoment[]>();
  for (const [product, moments] of byProduct) {
    out.set(product, [...moments.values()].sort((a, b) => a.t - b.t));
  }
  return out;
}

/** The product each view would show, from what the listing holds. */
export function productsToStore(listed: Map<string, ListedMoment[]>): string[] {
  const chosen = new Set<string>();
  for (const mode of HMI_MODES) {
    const pick = productsFor(mode).find((p) => listed.get(p)?.some((m) => m.sizes.includes(1024)));
    if (pick) chosen.add(pick);
  }
  return [...chosen];
}

/**
 * The moments worth keeping: the first frame in each UTC quarter-hour, and
 * only those with a 1024 px copy.
 *
 * Fixed slots rather than "fifteen minutes apart counting back from the
 * newest": that choice shifts every time a new frame lands, and would mark
 * the whole week as missing on every run.
 */
export function wantedMoments(moments: ListedMoment[]): ListedMoment[] {
  const bySlot = new Map<number, ListedMoment>();
  for (const m of moments) {
    if (!m.sizes.includes(1024)) continue;
    const slot = Math.floor(m.t / STEP_MS);
    const have = bySlot.get(slot);
    if (!have || m.t < have.t) bySlot.set(slot, m);
  }
  return [...bySlot.values()].sort((a, b) => a.t - b.t);
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchListing(dayMs: number, isRecent: boolean): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(browseDirUrl(dayMs), {
      headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html' },
      cf: { cacheTtl: isRecent ? 240 : 3600, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return null;
    const html = await res.text();
    return /_1024_HMI/.test(html) ? html : null;
  } catch {
    return null;
  }
}

// ── Manifest ────────────────────────────────────────────────────────────────

async function readManifest(env: Env): Promise<Manifest> {
  try {
    const obj = await env.SDO_BUCKET.get(MANIFEST_KEY);
    if (!obj) return emptyManifest();
    const parsed = JSON.parse(await new Response(obj.body).text());
    return parsed?.version === 1 ? parsed : emptyManifest();
  } catch {
    return emptyManifest();
  }
}

const writeManifest = (env: Env, m: Manifest) =>
  env.SDO_BUCKET.put(MANIFEST_KEY, JSON.stringify(m), { httpMetadata: { contentType: 'application/json' } });

function addEntry(m: Manifest, product: string, entry: Entry) {
  const list = (m.products[product] ??= []);
  const i = list.findIndex((e) => e.stem === entry.stem);
  if (i >= 0) list[i] = entry;
  else list.push(entry);
  list.sort((a, b) => a.t - b.t);
}

/** Drops everything past retention from the manifest; returns the R2 keys to delete. */
export function pruneManifest(m: Manifest, nowMs: number): string[] {
  const cutoff = nowMs - RETENTION_MS;
  const keys: string[] = [];
  for (const [product, list] of Object.entries(m.products)) {
    const keep: Entry[] = [];
    for (const e of list) {
      if (e.t >= cutoff) keep.push(e);
      else for (const s of e.sizes) keys.push(objectKey(product, e.stem, s, e.ext));
    }
    if (keep.length) m.products[product] = keep;
    else delete m.products[product];
  }
  const oldestDay = dayKey(cutoff);
  m.completeDays = m.completeDays.filter((d) => d >= oldestDay);
  for (const d of Object.keys(m.dayChecks ?? {})) if (d < oldestDay) delete m.dayChecks![d];
  const oldestSlot = Math.floor(cutoff / STEP_MS);
  for (const [p, slots] of Object.entries(m.hvEmpty ?? {})) m.hvEmpty![p] = slots.filter((n) => n >= oldestSlot);
  return keys;
}

/**
 * Whether the store holds a full day of archive frames for every view.
 * Also repairs stores written before this rule, which closed days SDO had
 * not posted yet.
 */
export function dayIsFull(m: Manifest, key: string): boolean {
  let views = 0;
  for (const mode of HMI_MODES) {
    const counts = productsFor(mode).map((p) => (m.products[p] ?? []).filter((e) => e.stem.startsWith(key)).length);
    if (Math.max(0, ...counts) >= FULL_DAY_FRAMES) views++;
  }
  return views === HMI_MODES.length;
}

// ── The newest 4K images ────────────────────────────────────────────────────

/**
 * Refreshes each view's 4096 px image when it is due. Asks conditionally, so
 * an unchanged image costs a 304 rather than megabytes; falls to the next
 * source only when one fails. Returns how many images were downloaded.
 */
export async function refreshLatest(env: Env, manifest: Manifest, nowMs: number, errors: string[]): Promise<number> {
  const latest = (manifest.latest ??= {});
  let downloaded = 0;
  for (const mode of HMI_MODES) {
    const have = latest[mode];
    if (have && nowMs - have.checkedAtMs < LATEST_CHECK_MS) continue;
    for (const source of LATEST_SOURCES[mode]) {
      const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
      if (have?.source === source) {
        if (have.etag) headers['If-None-Match'] = have.etag;
        if (have.lastModified) headers['If-Modified-Since'] = have.lastModified;
      }
      try {
        const res = await fetchWithTimeout(source, { headers });
        if (res.status === 304 && have) {
          have.checkedAtMs = nowMs;
          break;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const contentType = res.headers.get('content-type') ?? '';
        if (!contentType.startsWith('image/')) throw new Error(`got ${contentType || 'nothing'}`);
        const bytes = await res.arrayBuffer();
        // A truncated or placeholder file is worse than the last good one.
        if (bytes.byteLength < 100_000) throw new Error(`only ${bytes.byteLength} bytes`);
        downloaded++;
        await env.SDO_BUCKET.put(latestKey(mode), bytes, { httpMetadata: { contentType } });
        // Kept as history as well, when it is JSOC's (see HD_PRODUCTS).
        if (source === LATEST_SOURCES[mode][0]) {
          try {
            await keepHd(env, manifest, mode, bytes, contentType, res.headers.get('last-modified'), nowMs);
          } catch (e) {
            errors.push(`4K history ${mode}: ${(e as Error).message}`);
          }
        }
        latest[mode] = {
          source,
          checkedAtMs: nowMs,
          storedAtMs: nowMs,
          contentType,
          bytes: bytes.byteLength,
          etag: res.headers.get('etag') ?? undefined,
          lastModified: res.headers.get('last-modified') ?? undefined,
        };
        break;
      } catch (e) {
        errors.push(`latest ${mode} from ${new URL(source).hostname}: ${(e as Error).message}`);
      }
    }
  }
  return downloaded;
}

/**
 * Keeps one 4096 px image as its view's 4K history, stamped like the live
 * 1024 px frames: by the file's Last-Modified time, falling back to now.
 */
export async function keepHd(
  env: Env, manifest: Manifest, mode: HmiMode, bytes: ArrayBuffer, contentType: string,
  lastModified: string | null, nowMs: number,
): Promise<boolean> {
  const product = HD_PRODUCTS[mode];
  const stamped = lastModified ? Date.parse(lastModified) : NaN;
  const t = Number.isFinite(stamped) && stamped <= nowMs + MINUTE ? stamped : nowMs;
  const stem = stemOf(t);
  if (manifest.products[product]?.some((e) => e.stem === stem)) return false;
  const ext = contentType.includes('gif') ? 'gif' : contentType.includes('png') ? 'png' : undefined;
  await env.SDO_BUCKET.put(objectKey(product, stem, 4096, ext), bytes, { httpMetadata: { contentType } });
  addEntry(manifest, product, { t, stem, sizes: [4096], ...(ext ? { ext } : {}) });
  return true;
}

/** The 4K image nearest `t`, within HD_MATCH_MS, as a URL, else undefined. */
export function hdUrlFor(m: Manifest, origin: string, mode: HmiMode, t: number): string | undefined {
  const product = HD_PRODUCTS[mode];
  let best: Entry | null = null;
  for (const e of m.products[product] ?? []) {
    if (Math.abs(e.t - t) > HD_MATCH_MS) continue;
    if (!best || Math.abs(e.t - t) < Math.abs(best.t - t)) best = e;
  }
  return best ? `${origin}/img/${product}/${best.stem}_4096.${best.ext ?? 'jpg'}` : undefined;
}

// ── The live 1024 px images, saved as history ───────────────────────────────

/**
 * Saves each view's live image when it has changed since the last run.
 * Stamped with the file's Last-Modified time, which JSOC sets when it posts
 * the image, falling back to now. Returns how many were saved.
 */
export async function saveLive(env: Env, manifest: Manifest, nowMs: number, errors: string[]): Promise<number> {
  const live = (manifest.live ??= {});
  let saved = 0;
  for (const mode of HMI_MODES) {
    const { product, url } = LIVE_SOURCES[mode];
    const have = live[mode];
    const headers: Record<string, string> = { 'User-Agent': BROWSER_UA };
    if (have?.etag) headers['If-None-Match'] = have.etag;
    if (have?.lastModified) headers['If-Modified-Since'] = have.lastModified;
    try {
      const res = await fetchWithTimeout(url, { headers });
      if (res.status === 304) { if (have) have.checkedAtMs = nowMs; continue; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.startsWith('image/')) throw new Error(`got ${contentType || 'nothing'}`);
      const lastModified = res.headers.get('last-modified') ?? undefined;
      live[mode] = { lastModified, etag: res.headers.get('etag') ?? undefined, checkedAtMs: nowMs };
      // A host that ignores If-Modified-Since sends the same file again.
      if (have?.lastModified && lastModified === have.lastModified) continue;
      const stamped = lastModified ? Date.parse(lastModified) : NaN;
      const t = Number.isFinite(stamped) && stamped <= nowMs + MINUTE ? stamped : nowMs;
      const stem = stemOf(t);
      if (manifest.products[product]?.some((e) => e.stem === stem)) continue;
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength < 20_000) throw new Error(`only ${bytes.byteLength} bytes`);
      const ext = contentType.includes('gif') ? 'gif' : undefined;
      await env.SDO_BUCKET.put(objectKey(product, stem, 1024, ext), bytes, { httpMetadata: { contentType } });
      addEntry(manifest, product, { t, stem, sizes: [1024], ...(ext ? { ext } : {}) });
      saved++;
    } catch (e) {
      errors.push(`live ${mode}: ${(e as Error).message}`);
    }
  }
  return saved;
}

// ── The scheduled run ───────────────────────────────────────────────────────

interface Job { product: string; moment: ListedMoment; dayMs: number }

export async function runOnce(env: Env, nowMs = Date.now()) {
  const manifest = await readManifest(env);
  const errors: string[] = [];

  // The live 4K images first: they are what the tracker shows right now.
  const latestDownloaded = await refreshLatest(env, manifest, nowMs, errors);
  const liveSaved = await saveLive(env, manifest, nowMs, errors);

  const toDelete = pruneManifest(manifest, nowMs);
  for (let i = 0; i < toDelete.length; i += 1000) {
    try { await env.SDO_BUCKET.delete(toDelete.slice(i, i + 1000)); } catch (e) { errors.push(`prune: ${(e as Error).message}`); }
  }

  // Newest day first, so today is always served before any backfill.
  const days = daysCovering(nowMs - RETENTION_MS, nowMs).reverse();
  const complete = new Set(manifest.completeDays.filter((d) => dayIsFull(manifest, d)));
  const dayChecks = (manifest.dayChecks ??= {});
  const stored = new Map<string, Set<string>>();
  for (const [p, list] of Object.entries(manifest.products)) stored.set(p, new Set(list.map((e) => e.stem)));

  let listings = 0;
  const jobs: Job[] = [];
  for (const dayMs of days) {
    const key = dayKey(dayMs);
    if (complete.has(key)) continue;
    if (jobs.length >= DOWNLOADS_PER_RUN) break;
    // A past day with nothing left to fetch is looked at hourly, in case SDO
    // has posted more; today and yesterday every run.
    const check = dayChecks[key];
    const recent = nowMs - dayMs < 2 * DAY;
    if (!recent && check && check.missing === 0 && nowMs - check.atMs < DAY_RECHECK_MS) continue;
    const html = await fetchListing(dayMs, nowMs - dayMs < 2 * DAY);
    listings++;
    if (!html) {
      dayChecks[key] = { atMs: nowMs, missing: 0, found: {} };
      errors.push(`listing ${key} has no HMI frames`);
      continue;
    }
    const listed = parseListing(html);
    const missing: Job[] = [];
    for (const product of productsToStore(listed)) {
      const have = stored.get(product) ?? new Set<string>();
      for (const moment of wantedMoments(listed.get(product) ?? [])) {
        if (moment.t < nowMs - RETENTION_MS) continue;
        if (!have.has(moment.stem)) missing.push({ product, moment, dayMs });
      }
    }
    const found: Record<string, number> = {};
    for (const [p, list] of listed) found[p] = wantedMoments(list).length;
    dayChecks[key] = { atMs: nowMs, missing: missing.length, found };
    const settled = dayMs + DAY + DAY_SETTLE_MS < nowMs;
    if (!missing.length && settled) {
      if (dayIsFull(manifest, key)) {
        complete.add(key);
        delete dayChecks[key];
      }
      continue;
    }
    // Newest first, alternating products, so each view fills at the same pace.
    missing.sort((a, b) => b.moment.t - a.moment.t);
    jobs.push(...missing);
  }

  let downloaded = 0;
  for (const job of jobs) {
    // Each moment costs one download per size; the budget is in downloads.
    if (downloaded + job.moment.sizes.length > DOWNLOADS_PER_RUN) break;
    const dir = browseDirUrl(job.dayMs);
    const sizes: number[] = [];
    for (const size of SIZES) {
      if (!job.moment.sizes.includes(size)) continue;
      downloaded++;
      try {
        const res = await fetchWithTimeout(`${dir}${job.moment.stem}_${size}_${job.product}.jpg`, {
          headers: { 'User-Agent': BROWSER_UA },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = res.headers.get('content-type') ?? '';
        if (type && !type.startsWith('image/')) throw new Error(`got ${type}`);
        const bytes = await res.arrayBuffer();
        await env.SDO_BUCKET.put(objectKey(job.product, job.moment.stem, size), bytes,
          { httpMetadata: { contentType: 'image/jpeg' } });
        sizes.push(size);
      } catch (e) {
        errors.push(`${job.moment.stem}_${size}_${job.product}: ${(e as Error).message}`);
      }
    }
    // Stored only if the frame the tracker actually shows made it.
    if (sizes.includes(1024)) addEntry(manifest, job.product, { t: job.moment.t, stem: job.moment.stem, sizes });
  }

  const hvSaved = await saveHelioviewer(env, manifest, nowMs, errors);

  manifest.completeDays = [...complete].sort();
  manifest.lastRun = { atMs: nowMs, downloaded, latestDownloaded, liveSaved, hvSaved, pruned: toDelete.length, listings, errors: errors.slice(0, 20) };
  await writeManifest(env, manifest);
  return manifest.lastRun;
}

// ── Serving ─────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (body: unknown, status = 200, maxAge = 60) => new Response(JSON.stringify(body), {
  status,
  headers: {
    ...CORS,
    'Content-Type': 'application/json',
    'Cache-Control': status === 200 ? `public, max-age=${maxAge}` : 'no-store',
  },
});

// ── Helioviewer, for the quarter-hours the archive does not hold ───────────

/** Quarter-hours (slot numbers) that archive frames of a view already cover. */
function archiveSlots(m: Manifest, mode: HmiMode): Set<number> {
  const slots = new Set<number>();
  for (const p of productsFor(mode)) for (const e of m.products[p] ?? []) slots.add(Math.floor(e.t / STEP_MS));
  return slots;
}

/**
 * The quarter-hours a Helioviewer product should fill, newest first: within
 * retention, begun at least five minutes ago (the image kept is the one
 * nearest the quarter-hour, and Helioviewer lags HMI a little), not held by
 * the archive or already stored, and not written off. One Helioviewer has not
 * reached yet is asked again next run.
 */
export function hvSlotsWanted(m: Manifest, mode: HmiMode, nowMs: number): number[] {
  const hv = HV_SOURCES[mode];
  if (!hv) return [];
  const have = archiveSlots(m, mode);
  for (const e of m.products[hv.product] ?? []) have.add(Math.floor(e.t / STEP_MS));
  for (const n of m.hvEmpty?.[hv.product] ?? []) have.add(n);
  const out: number[] = [];
  const first = Math.ceil((nowMs - RETENTION_MS) / STEP_MS);
  for (let n = Math.floor((nowMs - 5 * MINUTE) / STEP_MS); n >= first; n--) {
    if (!have.has(n)) out.push(n);
  }
  return out;
}

const hvIso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Helioviewer's image nearest a moment: its time, or null. */
async function hvClosest(sourceId: number, atMs: number): Promise<number | null> {
  const res = await fetchWithTimeout(`${HV_API}/getClosestImage/?date=${hvIso(atMs)}&sourceId=${sourceId}`,
    { headers: { 'User-Agent': BROWSER_UA } });
  if (!res.ok) throw new Error(`getClosestImage HTTP ${res.status}`);
  const body = await res.json() as { date?: string };
  const t = body?.date ? Date.parse(body.date.replace(' ', 'T').replace(/Z?$/, 'Z')) : NaN;
  return Number.isFinite(t) ? t : null;
}

/** A full-disk 1024 px render of one Helioviewer image, as its layer names allow. */
async function hvRender(layers: string[], atMs: number): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  let last = '';
  for (const layer of layers) {
    const q = `date=${hvIso(atMs)}&imageScale=${HV_SCALE}&layers=${encodeURIComponent(layer)}`
      + '&x0=0&y0=0&width=1024&height=1024&display=true&watermark=false';
    try {
      const res = await fetchWithTimeout(`${HV_API}/takeScreenshot/?${q}`, { headers: { 'User-Agent': BROWSER_UA } });
      const contentType = res.headers.get('content-type') ?? '';
      if (!res.ok) { last = `HTTP ${res.status}`; continue; }
      if (!contentType.startsWith('image/')) { last = `got ${contentType || 'nothing'}`; continue; }
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength < 20_000) { last = `only ${bytes.byteLength} bytes`; continue; }
      return { bytes, contentType };
    } catch (e) {
      last = (e as Error).message;
    }
  }
  throw new Error(`takeScreenshot: ${last}`);
}

/**
 * Fills the quarter-hours the archive does not hold, for the views
 * Helioviewer carries, newest first and the views in turn. A quarter-hour
 * Helioviewer has nothing in is written off once it is a few hours old.
 * Returns how many frames were saved.
 */
export async function saveHelioviewer(env: Env, manifest: Manifest, nowMs: number, errors: string[]): Promise<number> {
  const queues = HMI_MODES
    .filter((mode) => HV_SOURCES[mode])
    .map((mode) => ({ mode, slots: hvSlotsWanted(manifest, mode, nowMs) }));
  let saved = 0, tried = 0, failures = 0;
  for (let i = 0; tried < HV_FRAMES_PER_RUN && failures < 3; i++) {
    const q = queues.filter((x) => x.slots.length);
    if (!q.length) break;
    const { mode, slots } = q[i % q.length];
    const n = slots.shift()!;
    const hv = HV_SOURCES[mode]!;
    tried++;
    try {
      const start = n * STEP_MS;
      // Nearest the quarter-hour itself, as the archive keeps the first frame
      // in each: evenly spaced, so thinning to 15 minutes drops none.
      const t = await hvClosest(hv.sourceId, start);
      if (t == null || Math.floor(t / STEP_MS) !== n) {
        // Nothing in this quarter-hour. Older than a few hours, it never will be.
        if (nowMs - (start + STEP_MS) > HV_GIVE_UP_MS) ((manifest.hvEmpty ??= {})[hv.product] ??= []).push(n);
        continue;
      }
      const { bytes, contentType } = await hvRender(hv.layers, t);
      const ext = contentType.includes('png') ? 'png' : contentType.includes('gif') ? 'gif' : undefined;
      const stem = stemOf(t);
      await env.SDO_BUCKET.put(objectKey(hv.product, stem, 1024, ext), bytes, { httpMetadata: { contentType } });
      addEntry(manifest, hv.product, { t, stem, sizes: [1024], ...(ext ? { ext } : {}) });
      saved++;
    } catch (e) {
      failures++;
      errors.push(`helioviewer ${mode}: ${(e as Error).message}`);
    }
  }
  return saved;
}

/** Manifests are read on every frame-list request; one per isolate per minute is plenty. */
let manifestCache: { atMs: number; m: Manifest } | null = null;
async function cachedManifest(env: Env): Promise<Manifest> {
  if (manifestCache && Date.now() - manifestCache.atMs < MINUTE) return manifestCache.m;
  const m = await readManifest(env);
  manifestCache = { atMs: Date.now(), m };
  return m;
}

/** Frames for a window: stored where held, SDO's archive for anything older. */
export async function framesFor(
  env: Env, origin: string, mode: HmiMode, from: number, to: number, nowMs = Date.now(),
): Promise<{ product: string | null; frames: HmiFrame[]; storedFromMs: number | null }> {
  const manifest = await cachedManifest(env);
  const product = productsFor(mode).find((p) => manifest.products[p]?.length) ?? null;
  // productsFor only names archive products; the live one is merged below.
  const list = product ? manifest.products[product] : [];
  const storedFrom = list.length ? list[0].t : null;

  const stored: HmiFrame[] = list
    .filter((e) => e.t >= from && e.t <= to)
    .map((e) => {
      const f: HmiFrame = { atMs: e.t, url: `${origin}/img/${product}/${e.stem}_1024.jpg`, product: product! };
      if (e.sizes.includes(512)) f.preview = `${origin}/img/${product}/${e.stem}_512.jpg`;
      if (e.sizes.includes(2048)) {
        f.detail = `${origin}/img/${product}/${e.stem}_2048.jpg`;
        // SDO keeps a 4096px copy beside every 2048px one. Not stored here -
        // a week of them would fill the bucket - but read through the app's
        // image proxy, which caches archive frames for a week. The app falls
        // back to the 2048px copy if one is ever missing.
        f.hd = `${browseDirUrl(e.t)}${e.stem}_4096_${product}.jpg`;
      }
      return f;
    });

  // The part of the window older than the store, while it is still filling.
  let older: HmiFrame[] = [];
  let olderProduct: string | null = null;
  const gapEnd = storedFrom ?? to;
  if (from < gapEnd - STEP_MS) {
    const todayDir = browseDirUrl(nowMs);
    const listings = await Promise.all(daysCovering(from, gapEnd).map(async (d) => ({
      dir: browseDirUrl(d),
      html: await fetchListing(d, browseDirUrl(d) === todayDir),
    })));
    const res = framesFromListings(listings, mode, from, gapEnd - 1);
    // Mixed only when both sides are the same product, so a scrub never
    // flips between a colour frame and a grey one.
    if (!product || res.product === product) {
      older = res.frames.map((f) => ({ ...f, product: res.product ?? undefined }));
      olderProduct = res.product;
    }
  }

  // Helioviewer, for the quarter-hours the archive does not hold; then the
  // live images, for whatever neither reaches yet.
  const archive = [...older, ...stored];
  const archiveEnd = archive.reduce((m, f) => Math.max(m, f.atMs), -Infinity);
  const taken = new Set(archive.map((f) => Math.floor(f.atMs / STEP_MS)));
  const hv = HV_SOURCES[mode];
  const hvFrames: HmiFrame[] = hv ? (manifest.products[hv.product] ?? [])
    .filter((e) => e.t >= from && e.t <= to && !taken.has(Math.floor(e.t / STEP_MS)))
    .map((e) => ({ atMs: e.t, url: `${origin}/img/${hv.product}/${e.stem}_1024.${e.ext ?? 'jpg'}`, product: hv.product })) : [];
  for (const f of hvFrames) taken.add(Math.floor(f.atMs / STEP_MS));
  const liveProduct = LIVE_SOURCES[mode].product;
  const live: HmiFrame[] = (manifest.products[liveProduct] ?? [])
    .filter((e) => e.t >= from && e.t <= to && e.t > archiveEnd + STEP_MS / 2 && !taken.has(Math.floor(e.t / STEP_MS)))
    .map((e) => {
      const f: HmiFrame = { atMs: e.t, url: `${origin}/img/${liveProduct}/${e.stem}_1024.${e.ext ?? 'jpg'}`, product: liveProduct };
      // Its 4K copy, for the region close-up (see HD_PRODUCTS).
      const hd = hdUrlFor(manifest, origin, mode, e.t);
      if (hd) f.hd = hd;
      return f;
    });

  const frames = thinFrames([...archive, ...hvFrames, ...live].sort((a, b) => a.atMs - b.atMs), intervalForWindow(to - from));
  return { product: product ?? olderProduct ?? (hvFrames.length ? hv!.product : live.length ? liveProduct : null), frames, storedFromMs: storedFrom };
}

async function serveImage(env: Env, path: string): Promise<Response> {
  // /img/<product>/<stem>_<size>.jpg, nothing else.
  const m = path.match(/^\/img\/(HMI[A-Z]+)\/(\d{8}_\d{6}_(?:512|1024|2048|4096)\.(?:jpg|gif|png))$/);
  if (!m) return new Response('Not found', { status: 404, headers: CORS });
  const obj = await env.SDO_BUCKET.get(`hmi/${m[1]}/${m[2]}`);
  if (!obj) return new Response('Not found', { status: 404, headers: { ...CORS, 'Cache-Control': 'no-store' } });
  return new Response(obj.body, {
    headers: {
      ...CORS,
      'Content-Type': obj.httpMetadata?.contentType
        ?? (m[2].endsWith('.gif') ? 'image/gif' : m[2].endsWith('.png') ? 'image/png' : 'image/jpeg'),
      // A stored frame never changes.
      'Cache-Control': 'public, max-age=604800, immutable',
      ETag: obj.httpEtag,
    },
  });
}

async function serveLatest(env: Env, path: string): Promise<Response> {
  const m = path.match(/^\/latest\/(colorized|magnetogram|intensity)_4096$/);
  if (!m) return new Response('Not found', { status: 404, headers: CORS });
  const obj = await env.SDO_BUCKET.get(latestKey(m[1] as HmiMode));
  if (!obj) return new Response('Not stored yet', { status: 404, headers: { ...CORS, 'Cache-Control': 'no-store' } });
  return new Response(obj.body, {
    headers: {
      ...CORS,
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // Replaced about every quarter-hour.
      'Cache-Control': 'public, max-age=300',
      ETag: obj.httpEtag,
    },
  });
}

function status(m: Manifest, nowMs = Date.now()) {
  const products: Record<string, unknown> = {};
  for (const [p, list] of Object.entries(m.products)) {
    products[p] = {
      frames: list.length,
      oldest: list.length ? new Date(list[0].t).toISOString() : null,
      newest: list.length ? new Date(list[list.length - 1].t).toISOString() : null,
      daysHeld: list.length ? +((nowMs - list[0].t) / DAY).toFixed(1) : 0,
    };
  }
  return {
    ok: true,
    products,
    completeDays: m.completeDays,
    // Quarter-hours Helioviewer had nothing for, per product.
    helioviewerEmpty: Object.fromEntries(Object.entries(m.hvEmpty ?? {}).map(([p, s]) => [p, s.length])),
    // Days still waiting on SDO: when last looked at, and the frames it had.
    waitingOnSdo: Object.fromEntries(Object.entries(m.dayChecks ?? {}).sort().map(([d, c]) => [d, {
      checked: new Date(c.atMs).toISOString(), missing: c.missing, found: c.found,
    }])),
    latest: Object.fromEntries(Object.entries(m.latest ?? {}).map(([mode, l]) => [mode, l && {
      source: l.source,
      bytes: l.bytes,
      lastModified: l.lastModified ?? null,
      stored: new Date(l.storedAtMs).toISOString(),
      checked: new Date(l.checkedAtMs).toISOString(),
    }])),
    lastRun: m.lastRun ? { ...m.lastRun, at: new Date(m.lastRun.atMs).toISOString() } : null,
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: CORS });
    }

    try {
      if (url.pathname.startsWith('/img/')) return await serveImage(env, url.pathname);
      if (url.pathname.startsWith('/latest/')) return await serveLatest(env, url.pathname);

      if (url.pathname === '/api/status') return json(status(await readManifest(env)), 200, 0);

      if (url.pathname === '/api/frames') {
        const mode = url.searchParams.get('mode') as HmiMode;
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        if (!HMI_MODES.includes(mode)) return json({ error: 'mode must be colorized, magnetogram or intensity' }, 400);
        if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return json({ error: 'from and to are epoch ms, from < to' }, 400);
        if (to - from > MAX_WINDOW_MS) return json({ error: 'window is at most eight days' }, 400);
        if (to > Date.now() + DAY) return json({ error: 'to is in the future' }, 400);
        const result = await framesFor(env, url.origin, mode, from, to);
        const maxAge = to < Date.now() - DAY ? 3600 : 120;
        return json({ mode, ...result }, 200, maxAge);
      }

      return json({ error: 'not found', routes: ['/api/frames', '/api/status', '/img/<product>/<file>', '/latest/<view>_4096'] }, 404);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  },

  async scheduled(_event: unknown, env: Env, ctx: Ctx) {
    ctx.waitUntil(runOnce(env).then((r) => console.log('[sdo-imagery]', JSON.stringify(r))));
  },
};
