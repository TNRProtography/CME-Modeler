// Past HMI frames, for scrubbing the sunspot tracker back through time.
//
// The tracker's live image is JSOC's "latest", which by definition has no
// past. SDO keeps a browse archive, a directory per UTC day:
//
//   https://sdo.gsfc.nasa.gov/assets/img/browse/2026/09/22/
//     20260922_001038_512_HMII.jpg
//     20260922_001038_1024_HMII.jpg
//     20260922_001038_2048_HMII.jpg
//     ...every AIA channel alongside, at every size
//
// The seconds in those names are not on a fixed grid, so frames are read from
// the directory listing rather than guessed. Only the file names are used,
// matched by pattern, so the page around them does not matter.
//
// A day's listing is close to a megabyte of HTML, nearly all of it AIA, so a
// week of it is not something to make a phone download. The parsing here is
// therefore shared with a Pages Function (functions/api/hmi-frames.ts) that
// reads the listings at the edge and returns only the frames. The browser
// reads the listings itself only when that route is not there.

export type HmiMode = 'colorized' | 'magnetogram' | 'intensity';

/**
 * Archive product names to try for each view, best first.
 *
 * The live "latest" directory serves HMIBC, HMIB and HMIIF, but a real day's
 * browse listing showed HMII and HMID at the times it covered, so the archive
 * does not necessarily carry the same set. Each view takes the first of its
 * candidates the listing actually has. The Dopplergram (HMID) is never a
 * stand-in: it measures velocity, not field or brightness.
 */
const PRODUCTS: Record<HmiMode, string[]> = {
  colorized: ['HMIBC', 'HMIB'],
  magnetogram: ['HMIB', 'HMIBC'],
  intensity: ['HMIIF', 'HMII', 'HMIIC'],
};

export const HMI_MODES: HmiMode[] = ['colorized', 'magnetogram', 'intensity'];

const BROWSE = 'https://sdo.gsfc.nasa.gov/assets/img/browse';

export interface HmiFrame {
  atMs: number;
  /** The 1024px file - what a settled frame shows. */
  url: string;
  /**
   * The 512px copy, about a fifth of the size, when the archive has one.
   * Dragging the scrubber shows these: a frame the finger has already passed
   * does not need to be sharp, it needs to be there.
   */
  preview?: string;
  /** The 2048px copy, for the region close-up, which zooms hard. */
  detail?: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function browseDirUrl(dayMs: number): string {
  const d = new Date(dayMs);
  return `${BROWSE}/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/`;
}

/** The UTC days a window touches, as midnight epochs. */
export function daysCovering(fromMs: number, toMs: number): number[] {
  const f = new Date(fromMs);
  const days: number[] = [];
  for (let d = Date.UTC(f.getUTCFullYear(), f.getUTCMonth(), f.getUTCDate()); d <= toMs; d += 86400000) {
    days.push(d);
  }
  return days;
}

export const productsFor = (mode: HmiMode): string[] => PRODUCTS[mode];

/**
 * Which of a view's candidate products these listings actually hold.
 *
 * Chosen once for the whole window, not per day, so a scrub across midnight
 * does not flip between a colorised frame and a grey one.
 */
export function chooseProduct(listings: string[], mode: HmiMode): string | null {
  for (const product of PRODUCTS[mode]) {
    const re = new RegExp(`_1024_${product}\\.jpg`);
    if (listings.some((html) => re.test(html))) return product;
  }
  return null;
}

/**
 * Frames of one product from one day's listing, oldest first.
 *
 * Anchored on the product followed by ".jpg", so HMIB does not also pick up
 * HMIBC, and HMII does not pick up HMIIF - each name contains the shorter one.
 */
export function parseBrowseListing(html: string, product: string, dirUrl: string): HmiFrame[] {
  const text = String(html ?? '');
  const re = new RegExp(`(\\d{8})_(\\d{6})_1024_${product}\\.jpg`, 'g');
  const seen = new Set<string>();
  const out: HmiFrame[] = [];
  for (const m of text.matchAll(re)) {
    const name = m[0];
    if (seen.has(name)) continue;   // listings repeat each name in href and text
    seen.add(name);
    const [date, time] = [m[1], m[2]];
    const atMs = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8),
      +time.slice(0, 2), +time.slice(2, 4), +time.slice(4, 6));
    if (!Number.isFinite(atMs)) continue;

    // The other sizes of the same moment, only if this listing has them - a
    // guessed URL that 404s is worse than no preview at all.
    const stem = `${date}_${time}`;
    const frame: HmiFrame = { atMs, url: `${dirUrl}${name}` };
    const small = `${stem}_512_${product}.jpg`;
    const large = `${stem}_2048_${product}.jpg`;
    if (text.includes(small)) frame.preview = `${dirUrl}${small}`;
    if (text.includes(large)) frame.detail = `${dirUrl}${large}`;
    out.push(frame);
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/**
 * At most one frame per interval, keeping the newest end.
 *
 * The archive has a frame every few minutes; a day of them is hundreds of
 * downloads for a scrubber whose regions move half a degree an hour.
 */
export function thinFrames(frames: HmiFrame[], intervalMs: number): HmiFrame[] {
  const out: HmiFrame[] = [];
  let lastKept = Infinity;
  for (let i = frames.length - 1; i >= 0; i--) {
    if (lastKept - frames[i].atMs >= intervalMs) {
      out.push(frames[i]);
      lastKept = frames[i].atMs;
    }
  }
  return out.reverse();
}

/**
 * The spacing for a window, so every window has about the same number of
 * frames.
 *
 * A quarter-hour for anything up to a day; wider windows space out so a week
 * is not seven hundred frames. About a hundred is enough to watch regions
 * cross the disk and few enough to preload.
 */
export function intervalForWindow(windowMs: number): number {
  const QUARTER = 15 * 60000;
  return Math.max(QUARTER, Math.ceil(windowMs / 96 / QUARTER) * QUARTER);
}

/** Everything between the listings and the frame list, shared by both callers. */
export function framesFromListings(
  listings: { dir: string; html: string | null }[],
  mode: HmiMode,
  fromMs: number,
  toMs: number,
): { product: string | null; frames: HmiFrame[] } {
  const product = chooseProduct(listings.map((l) => l.html ?? ''), mode);
  if (!product) return { product: null, frames: [] };
  const inWindow = listings
    .flatMap(({ dir, html }) => (html ? parseBrowseListing(html, product, dir) : []))
    .filter((f) => f.atMs >= fromMs && f.atMs <= toMs);
  return { product, frames: thinFrames(inWindow, intervalForWindow(toMs - fromMs)) };
}

// ── Fetching, in the browser ────────────────────────────────────────────────

/** Past days do not change, so they are kept for the session. */
const dayCache = new Map<string, { atMs: number; html: string }>();

async function fetchListing(dirUrl: string, isToday: boolean): Promise<string | null> {
  const cached = dayCache.get(dirUrl);
  if (cached && (!isToday || Date.now() - cached.atMs < 10 * 60000)) return cached.html;

  for (const base of ['/api/proxy/data', 'https://spottheaurora.co.nz/api/proxy/data']) {
    try {
      const res = await fetch(`${base}?url=${encodeURIComponent(dirUrl)}&ttl=${isToday ? 600 : 900}`);
      if (!res.ok) continue;
      const html = await res.text();
      // The SPA's own index.html also arrives with a 200; it has none of the
      // file names, so it is recognised by that rather than by its headers.
      if (!/_1024_HMI/.test(html)) continue;
      dayCache.set(dirUrl, { atMs: Date.now(), html });
      return html;
    } catch {
      // Next route.
    }
  }
  return cached?.html ?? null;
}

/** The frames straight from the listings - the fallback when the edge route is absent. */
async function framesInBrowser(mode: HmiMode, fromMs: number, toMs: number): Promise<HmiFrame[]> {
  const todayKey = browseDirUrl(Date.now());
  const listings = await Promise.all(daysCovering(fromMs, toMs).map(async (d) => {
    const dir = browseDirUrl(d);
    return { dir, html: await fetchListing(dir, dir === todayKey) };
  }));
  return framesFromListings(listings, mode, fromMs, toMs).frames;
}

/**
 * The archive frames covering a window, thinned, oldest first.
 *
 * Asks the edge route first, which reads the megabyte listings next to SDO
 * and returns a few kilobytes of frames. Never throws: an unreachable archive
 * is an empty list, and the tracker then shows only the live frame.
 */
export async function fetchHmiFrames(mode: HmiMode, fromMs: number, toMs: number): Promise<HmiFrame[]> {
  // Rounded so everyone in the same quarter-hour asks the same question and
  // the edge cache answers all but the first.
  const q = 15 * 60000;
  const to = Math.floor(toMs / q) * q;
  const from = Math.floor(fromMs / q) * q;
  for (const base of ['', 'https://spottheaurora.co.nz']) {
    try {
      const res = await fetch(`${base}/api/hmi-frames?mode=${mode}&from=${from}&to=${to}`);
      if (!res.ok) continue;
      const text = await res.text();
      if (!text.trimStart().startsWith('{')) continue;   // the SPA, not the route
      const body = JSON.parse(text);
      if (Array.isArray(body?.frames)) return body.frames as HmiFrame[];
    } catch {
      // Next route.
    }
  }
  return framesInBrowser(mode, fromMs, toMs);
}
