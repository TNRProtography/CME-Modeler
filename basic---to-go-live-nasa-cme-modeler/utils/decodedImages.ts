// Frame images, downloaded and decoded before they are needed.
//
// Playback draws a frame the moment it is due. If the image were still being
// decoded then, the frame would arrive late, or half-drawn, and the motion
// would stutter. So frames are decoded ahead and the most recent few are held
// on to, which also keeps the browser from throwing their bitmaps away.
//
// Only a few are held, by the memory they take rather than by count: a
// decoded 1024px frame is about 4 MB, a 2048px one 16 MB and a 4096px one 64
// MB. A frame that has dropped out is still in the HTTP cache, so asking for
// it again costs a decode, not a download.

const KEEP = 24;
// About what a phone browser gives a page's images before it starts throwing
// them away itself: 6 close-up frames at 2048px and 16 disk frames at 1024px.
const KEEP_BYTES = 176 * 1024 * 1024;
// The newest few always stay, however large, so the frame on screen and the
// next one are never what gets dropped.
const KEEP_AT_LEAST = 3;

const loading = new Map<string, Promise<HTMLImageElement | null>>();
const held = new Map<string, HTMLImageElement>();

const bytesOf = (img: HTMLImageElement) => (img.naturalWidth || 0) * (img.naturalHeight || 0) * 4;
let heldBytes = 0;

function hold(url: string, img: HTMLImageElement) {
  const before = held.get(url);
  if (before) { held.delete(url); heldBytes -= bytesOf(before); }
  held.set(url, img);
  heldBytes += bytesOf(img);
  while (held.size > KEEP_AT_LEAST && (held.size > KEEP || heldBytes > KEEP_BYTES)) {
    const oldest = held.keys().next().value as string;
    const gone = held.get(oldest);
    held.delete(oldest);
    loading.delete(oldest);
    if (gone) heldBytes -= bytesOf(gone);
  }
}

/** The image if it is decoded and held right now, else undefined. */
export function decodedImage(url: string): HTMLImageElement | undefined {
  const img = held.get(url);
  if (img) hold(url, img);
  return img;
}

/**
 * The image, downloaded and decoded. Null if it failed, so a caller stepping
 * through frames can move past a bad one rather than wait on it.
 */
export function loadDecodedImage(url: string): Promise<HTMLImageElement | null> {
  const ready = decodedImage(url);
  if (ready) return Promise.resolve(ready);
  const known = loading.get(url);
  if (known) return known;
  const p = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      (img.decode ? img.decode() : Promise.resolve())
        .catch(() => {})
        .then(() => { hold(url, img); resolve(img); });
    };
    img.onerror = () => { loading.delete(url); resolve(null); };
    img.src = url;
  });
  loading.set(url, p);
  return p;
}

/** Whether the image is decoded and held, without counting as a use. */
export const hasDecodedImage = (url: string): boolean => held.has(url);

/**
 * Downloads an image into the browser's cache without decoding or holding
 * it: for frames that may be wanted later, so they cost no memory until then.
 */
export function prefetchImage(url: string): Promise<void> {
  if (held.has(url)) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}
