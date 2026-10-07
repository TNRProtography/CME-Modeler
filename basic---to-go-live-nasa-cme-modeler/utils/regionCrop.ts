// A sunspot region's part of a 4096 px HMI frame, for the close-up.
//
// The close-up shows a sixth of the image across. From a 1024 px frame that
// is 170 pixels blown up to fill the box, which is why playback looked soft.
// The 4096 px frames hold four times the detail, but decoded whole each one
// is 64 MB of memory, and playback wants several at once: enough to make a
// phone's browser throw the page away.
//
// So a 4K frame is decoded once, off the main thread, and only the third of
// it across around the region is kept - about 7 MB - with the full image
// let go straight away. Regions move a few pixels between frames, so one crop
// serves for many frames of playback; a new one is cut only when the region
// has moved out of the part kept. Decodes run one at a time, so there is
// never more than one whole 4K image in memory.

export interface RegionCrop {
  /** The kept part, in the full image's own pixels from (sx, sy). */
  bitmap: ImageBitmap;
  fullW: number;
  fullH: number;
  sx: number;
  sy: number;
}

/** A third of the image across: the close-up's sixth, plus room for the region to move. */
const CROP_FRACTION = 1 / 3;
/** Half of what the close-up shows across, as a fraction of the image (it shows 1/6). */
const VIEW_HALF = 1 / 12;
/** Crops held: about 7 MB each. */
const KEEP = 10;

const crops = new Map<string, RegionCrop>();
const pending = new Map<string, Promise<RegionCrop | null>>();
const failed = new Set<string>();
let queue: Promise<unknown> = Promise.resolve();

/** A frame the close-up should draw from a crop rather than whole. */
export const isHdUrl = (url: string | null | undefined): boolean => !!url && /_4096\.(?:jpe?g|gif|png)(?:[?#]|$)/i.test(url);

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Whether the crop holds everything the close-up shows around (x, y), as fractions of the image. */
function covers(c: RegionCrop, x: number, y: number): boolean {
  const x0 = Math.max(0, clamp01(x) - VIEW_HALF) * c.fullW, x1 = Math.min(1, clamp01(x) + VIEW_HALF) * c.fullW;
  const y0 = Math.max(0, clamp01(y) - VIEW_HALF) * c.fullH, y1 = Math.min(1, clamp01(y) + VIEW_HALF) * c.fullH;
  return x0 >= c.sx - 1 && x1 <= c.sx + c.bitmap.width + 1 && y0 >= c.sy - 1 && y1 <= c.sy + c.bitmap.height + 1;
}

function hold(url: string, c: RegionCrop) {
  const old = crops.get(url);
  if (old && old !== c) old.bitmap.close?.();
  crops.delete(url);
  crops.set(url, c);
  while (crops.size > KEEP) {
    const oldest = crops.keys().next().value as string;
    crops.get(oldest)?.bitmap.close?.();
    crops.delete(oldest);
  }
}

/** The crop for this frame around (x, y), if it is cut and holds the view. */
export function cropFor(url: string, x: number, y: number): RegionCrop | undefined {
  const c = crops.get(url);
  return c && covers(c, x, y) ? c : undefined;
}

/** Whether this frame could not be fetched or decoded, so waiting on it is pointless. */
export const cropFailed = (url: string): boolean => failed.has(url);

async function cut(url: string, x: number, y: number): Promise<RegionCrop | null> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const full = await createImageBitmap(await res.blob());
  try {
    const W = full.width, H = full.height;
    const sw = Math.min(W, Math.round(W * CROP_FRACTION));
    const sh = Math.min(H, Math.round(H * CROP_FRACTION));
    const sx = Math.max(0, Math.min(W - sw, Math.round(clamp01(x) * W - sw / 2)));
    const sy = Math.max(0, Math.min(H - sh, Math.round(clamp01(y) * H - sh / 2)));
    const bitmap = await createImageBitmap(full, sx, sy, sw, sh);
    return { bitmap, fullW: W, fullH: H, sx, sy };
  } finally {
    full.close?.();
  }
}

/**
 * The crop of this frame around (x, y), fractions of the image, cutting it if
 * need be. Null if the frame cannot be had, so the caller can use its 1024 px
 * copy instead.
 */
export function loadCrop(url: string, x: number, y: number): Promise<RegionCrop | null> {
  const ready = cropFor(url, x, y);
  if (ready) { hold(url, ready); return Promise.resolve(ready); }
  if (failed.has(url) || typeof createImageBitmap !== 'function') return Promise.resolve(null);
  const inFlight = pending.get(url);
  if (inFlight) {
    return inFlight.then((c) => (c && covers(c, x, y) ? c : c ? loadCrop(url, x, y) : null));
  }
  const p = (queue = queue.catch(() => {}).then(() => cut(url, x, y)))
    .then((c) => { if (c) hold(url, c as RegionCrop); return c as RegionCrop | null; })
    .catch(() => { failed.add(url); return null; })
    .finally(() => { pending.delete(url); });
  pending.set(url, p);
  return p;
}
