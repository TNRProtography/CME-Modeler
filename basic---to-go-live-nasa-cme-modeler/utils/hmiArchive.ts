// Past HMI frames, for scrubbing the sunspot tracker back through time.
//
// The tracker's live image is JSOC's "latest", which by definition has no
// past. SDO keeps a browse archive of the same products, a directory per UTC
// day:
//
//   https://sdo.gsfc.nasa.gov/assets/img/browse/2026/09/22/
//     20260922_001500_1024_HMIBC.jpg   colorised magnetogram
//     20260922_001500_1024_HMIB.jpg    magnetogram
//     20260922_001500_1024_HMIIF.jpg   flattened intensitygram
//
// The seconds in those names are not on a fixed grid, so the frames are read
// from the directory listing rather than guessed. The listing is HTML and
// only the file names are used, matched by pattern, so a change to the page
// around them does not matter.

export type HmiMode = 'colorized' | 'magnetogram' | 'intensity';

/**
 * Archive product names to try for each view, best first.
 *
 * The live "latest" directory serves HMIBC, HMIB and HMIIF, but a real day's
 * browse listing showed HMII (intensitygram) and HMID (Dopplergram) at the
 * times it covered, so the browse archive does not necessarily carry the same
 * set. Each view therefore takes the first of its candidates the listing
 * actually has. The colorised view falls back to the plain magnetogram, the
 * same measurement drawn in grey; the intensity view to the unflattened
 * intensitygram, which only differs by limb darkening.
 */
const PRODUCTS: Record<HmiMode, string[]> = {
  colorized: ['HMIBC', 'HMIB'],
  magnetogram: ['HMIB', 'HMIBC'],
  intensity: ['HMIIF', 'HMII', 'HMIIC'],
};

const BROWSE = 'https://sdo.gsfc.nasa.gov/assets/img/browse';

export interface HmiFrame {
  atMs: number;
  /** The archive file itself. */
  url: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function browseDirUrl(dayMs: number): string {
  const d = new Date(dayMs);
  return `${BROWSE}/${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/`;
}

/** The products to try for a view, best first. */
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
 * Anchored on the product suffix followed by ".jpg", so HMIB does not also
 * pick up HMIBC files - the colorised name contains the plain one.
 */
export function parseBrowseListing(html: string, product: string, dirUrl: string): HmiFrame[] {
  const re = new RegExp(`(\\d{8})_(\\d{6})_1024_${product}\\.jpg`, 'g');
  const seen = new Set<string>();
  const out: HmiFrame[] = [];
  for (const m of String(html ?? '').matchAll(re)) {
    const name = m[0];
    if (seen.has(name)) continue;   // listings repeat each name in href and text
    seen.add(name);
    const [date, time] = [m[1], m[2]];
    const atMs = Date.UTC(+date.slice(0, 4), +date.slice(4, 6) - 1, +date.slice(6, 8),
      +time.slice(0, 2), +time.slice(2, 4), +time.slice(4, 6));
    if (!Number.isFinite(atMs)) continue;
    out.push({ atMs, url: `${dirUrl}${name}` });
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/**
 * At most one frame per interval, keeping the newest end.
 *
 * The archive has a frame every few minutes; a day of them is several hundred
 * 1024px downloads for a scrubber whose regions only move half a degree an
 * hour. Fifteen minutes keeps playback smooth without that cost.
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

// ── Fetching ────────────────────────────────────────────────────────────────

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

/**
 * The archive frames covering a window, thinned, oldest first.
 *
 * Never throws; an unreachable archive is an empty list, and the tracker then
 * shows only the live frame, which is how it worked before any of this.
 */
export async function fetchHmiFrames(
  mode: HmiMode,
  fromMs: number,
  toMs: number,
  intervalMs = 15 * 60000,
): Promise<HmiFrame[]> {
  const todayKey = browseDirUrl(Date.now());
  const days: number[] = [];
  for (let d = Date.UTC(new Date(fromMs).getUTCFullYear(), new Date(fromMs).getUTCMonth(), new Date(fromMs).getUTCDate());
       d <= toMs; d += 86400000) {
    days.push(d);
  }

  const listings = await Promise.all(days.map(async (d) => {
    const dir = browseDirUrl(d);
    return { dir, html: await fetchListing(dir, dir === todayKey) };
  }));

  const product = chooseProduct(listings.map((l) => l.html ?? ''), mode);
  if (!product) return [];

  const inWindow = listings
    .flatMap(({ dir, html }) => (html ? parseBrowseListing(html, product, dir) : []))
    .filter((f) => f.atMs >= fromMs && f.atMs <= toMs);
  return thinFrames(inWindow, intervalMs);
}
