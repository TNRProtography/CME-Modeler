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
interface Entry { t: number; stem: string; sizes: number[] }

export interface Manifest {
  version: 1;
  /** Per product, oldest first. */
  products: Record<string, Entry[]>;
  /** UTC days (YYYYMMDD) whose frames are all stored; never listed again. */
  completeDays: string[];
  /** The newest 4096 px image of each view. */
  latest?: Partial<Record<HmiMode, LatestInfo>>;
  lastRun?: { atMs: number; downloaded: number; latestDownloaded: number; pruned: number; listings: number; errors: string[] };
}

const emptyManifest = (): Manifest => ({ version: 1, products: {}, completeDays: [] });

const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
};
const objectKey = (product: string, stem: string, size: number) => `hmi/${product}/${stem}_${size}.jpg`;

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
      else for (const s of e.sizes) keys.push(objectKey(product, e.stem, s));
    }
    if (keep.length) m.products[product] = keep;
    else delete m.products[product];
  }
  const oldestDay = dayKey(cutoff);
  m.completeDays = m.completeDays.filter((d) => d >= oldestDay);
  return keys;
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

// ── The scheduled run ───────────────────────────────────────────────────────

interface Job { product: string; moment: ListedMoment; dayMs: number }

export async function runOnce(env: Env, nowMs = Date.now()) {
  const manifest = await readManifest(env);
  const errors: string[] = [];

  // The live 4K images first: they are what the tracker shows right now.
  const latestDownloaded = await refreshLatest(env, manifest, nowMs, errors);

  const toDelete = pruneManifest(manifest, nowMs);
  for (let i = 0; i < toDelete.length; i += 1000) {
    try { await env.SDO_BUCKET.delete(toDelete.slice(i, i + 1000)); } catch (e) { errors.push(`prune: ${(e as Error).message}`); }
  }

  // Newest day first, so today is always served before any backfill.
  const days = daysCovering(nowMs - RETENTION_MS, nowMs).reverse();
  const complete = new Set(manifest.completeDays);
  const stored = new Map<string, Set<string>>();
  for (const [p, list] of Object.entries(manifest.products)) stored.set(p, new Set(list.map((e) => e.stem)));

  let listings = 0;
  const jobs: Job[] = [];
  for (const dayMs of days) {
    const key = dayKey(dayMs);
    if (complete.has(key)) continue;
    if (jobs.length >= DOWNLOADS_PER_RUN) break;
    const html = await fetchListing(dayMs, nowMs - dayMs < 2 * DAY);
    listings++;
    if (!html) { errors.push(`listing ${key} unavailable`); continue; }
    const listed = parseListing(html);
    const missing: Job[] = [];
    for (const product of productsToStore(listed)) {
      const have = stored.get(product) ?? new Set<string>();
      for (const moment of wantedMoments(listed.get(product) ?? [])) {
        if (moment.t < nowMs - RETENTION_MS) continue;
        if (!have.has(moment.stem)) missing.push({ product, moment, dayMs });
      }
    }
    const settled = dayMs + DAY + DAY_SETTLE_MS < nowMs;
    if (!missing.length && settled) {
      complete.add(key);
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

  manifest.completeDays = [...complete].sort();
  manifest.lastRun = { atMs: nowMs, downloaded, latestDownloaded, pruned: toDelete.length, listings, errors: errors.slice(0, 20) };
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
  const list = product ? manifest.products[product] : [];
  const storedFrom = list.length ? list[0].t : null;

  const stored: HmiFrame[] = list
    .filter((e) => e.t >= from && e.t <= to)
    .map((e) => {
      const f: HmiFrame = { atMs: e.t, url: `${origin}/img/${product}/${e.stem}_1024.jpg` };
      if (e.sizes.includes(512)) f.preview = `${origin}/img/${product}/${e.stem}_512.jpg`;
      if (e.sizes.includes(2048)) f.detail = `${origin}/img/${product}/${e.stem}_2048.jpg`;
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
      older = res.frames;
      olderProduct = res.product;
    }
  }

  const frames = thinFrames([...older, ...stored].sort((a, b) => a.atMs - b.atMs), intervalForWindow(to - from));
  return { product: product ?? olderProduct, frames, storedFromMs: storedFrom };
}

async function serveImage(env: Env, path: string): Promise<Response> {
  // /img/<product>/<stem>_<size>.jpg, nothing else.
  const m = path.match(/^\/img\/(HMI[A-Z]+)\/(\d{8}_\d{6}_(?:512|1024|2048)\.jpg)$/);
  if (!m) return new Response('Not found', { status: 404, headers: CORS });
  const obj = await env.SDO_BUCKET.get(`hmi/${m[1]}/${m[2]}`);
  if (!obj) return new Response('Not found', { status: 404, headers: { ...CORS, 'Cache-Control': 'no-store' } });
  return new Response(obj.body, {
    headers: {
      ...CORS,
      'Content-Type': 'image/jpeg',
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
    latest: Object.fromEntries(Object.entries(m.latest ?? {}).map(([mode, l]) => [mode, l && {
      source: l.source,
      bytes: l.bytes,
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
