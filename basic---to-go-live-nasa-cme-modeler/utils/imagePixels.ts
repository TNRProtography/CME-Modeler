// Getting at the pixels of an image the browser will not let you read.
//
// Anything drawn onto a canvas from a cross-origin image taints it, and
// reading a tainted canvas throws. That is the whole problem: the app needs
// the actual numbers out of SUVI frames and HMI magnetograms, and the servers
// holding them do not send CORS headers.
//
// The way round it is to fetch the bytes rather than point an <img> at the
// URL. The app's own worker proxies an allow-list of science hosts from the
// same origin as the page, so the response is same-origin, the blob made from
// it is same-origin, and a canvas drawn from that blob is readable. Setting
// `crossOrigin` on an <img> does the opposite of what it looks like here: with
// no CORS header on the response the image fails to load at all.
//
// This is the only place that plumbing lives. It used to exist once inside the
// coronal hole detector, which is why every other feature that needed pixels
// quietly got a tainted canvas and an empty panel instead.

const PROXY_IMAGE_PATH = '/api/proxy/image';
const DEFAULT_TTL_SECONDS = 90;

export interface RasterImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** The image's own size, which differs from width/height when resized. */
  natural: { width: number; height: number };
  /**
   * How the image was placed in the raster: the scale applied and where its
   * top-left corner landed. Anything measured in raster pixels goes back to
   * the image's own pixels through these, which is the only way a measurement
   * taken here can be drawn over the image at any other size.
   */
  placement: { scale: number; offsetX: number; offsetY: number };
}

export function proxyImageUrl(targetUrl: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): string {
  return `${PROXY_IMAGE_PATH}?url=${encodeURIComponent(targetUrl)}&ttl=${ttlSeconds}`;
}

async function blobUrlFrom(res: Response, what: string): Promise<string> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status}`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`Expected an image, got ${blob.type}`);
  return URL.createObjectURL(blob);
}

/**
 * A same-origin blob URL for a remote image.
 *
 * Tries the proxy first, because that is the path that works for the hosts
 * the app actually uses. The direct fetch behind it is for the handful that
 * do send CORS headers, and for local development where the proxy route is
 * not running.
 */
export async function fetchImageAsBlobUrl(url: string, ttlSeconds?: number): Promise<string> {
  // Already same-origin or already a blob: nothing to route.
  if (url.startsWith('blob:') || url.startsWith('data:')
      || (typeof window !== 'undefined' && url.startsWith(window.location.origin))) {
    return url;
  }
  try {
    return await blobUrlFrom(await fetch(proxyImageUrl(url, ttlSeconds)), 'Proxy fetch');
  } catch (proxyErr) {
    try {
      return await blobUrlFrom(await fetch(url, { mode: 'cors', credentials: 'omit' }), 'Direct fetch');
    } catch {
      const msg = proxyErr instanceof Error ? proxyErr.message : String(proxyErr);
      throw new Error(`Image fetch failed (proxy and direct): ${msg}`);
    }
  }
}

/**
 * Decode a blob URL to pixels.
 *
 * `size` renders into a square of that many pixels. Leaving it out keeps the
 * image's own resolution, which matters for anything summing signed values -
 * downscaling a magnetogram averages neighbouring positive and negative
 * patches into each other and erodes exactly the signal being measured.
 */
export function imageDataFromBlobUrl(
  blobUrl: string,
  size?: number,
  fit: 'stretch' | 'contain' = 'stretch',
): Promise<RasterImage> {
  return new Promise<RasterImage>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = size ?? img.naturalWidth;
      const h = size ?? img.naturalHeight;
      if (!w || !h) { reject(new Error('Image decoded with no dimensions')); return; }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) { reject(new Error('No 2d canvas context')); return; }
      if (fit === 'contain') {
        // The Sun is a circle. Squeezing a frame that is not square into a
        // square canvas turns it into an ellipse, and every measurement taken
        // off it afterwards - radius, width, the position of anything on the
        // disk - is then wrong by the frame's aspect ratio. SUVI frames carry
        // a caption band, so this is not hypothetical.
        const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const dw = img.naturalWidth * scale;
        const dh = img.naturalHeight * scale;
        ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } else {
        ctx.drawImage(img, 0, 0, w, h);
      }
      try {
        const id = ctx.getImageData(0, 0, w, h);
        const scale = fit === 'contain'
          ? Math.min(w / img.naturalWidth, h / img.naturalHeight)
          : 1;
        resolve({
          data: id.data, width: w, height: h,
          natural: { width: img.naturalWidth, height: img.naturalHeight },
          placement: fit === 'contain'
            ? { scale, offsetX: (w - img.naturalWidth * scale) / 2, offsetY: (h - img.naturalHeight * scale) / 2 }
            : { scale: 1, offsetX: 0, offsetY: 0 },
        });
      } catch (e) {
        reject(new Error(`getImageData failed, so the canvas was tainted after all: ${e}`));
      }
    };
    img.onerror = () => reject(new Error('Blob image failed to decode'));
    img.src = blobUrl;
  });
}

/** Fetch and decode in one go, cleaning up the blob URL either way. */
export async function readImagePixels(
  url: string,
  size?: number,
  fit: 'stretch' | 'contain' = 'stretch',
  ttlSeconds?: number,
): Promise<RasterImage> {
  const blobUrl = await fetchImageAsBlobUrl(url, ttlSeconds);
  const madeHere = blobUrl !== url;
  try {
    return await imageDataFromBlobUrl(blobUrl, size, fit);
  } finally {
    if (madeHere) URL.revokeObjectURL(blobUrl);
  }
}
