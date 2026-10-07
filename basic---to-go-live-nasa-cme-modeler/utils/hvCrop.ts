// Full-resolution HMI around a sunspot region, from Helioviewer.
//
// The tracker's recent hours of magnetogram and intensity come from
// Helioviewer (the imagery worker's HMIHVB / HMIHVI frames), rendered at
// 2.016"/px - SDO's 1024px scale - every quarter-hour. For the region
// close-up, Helioviewer is asked for just the patch around the region at
// HMI's own 0.504"/px: 1024 x 1024 pixels, a quarter of the disk image
// across, as sharp as a 4096px frame and a fraction of the download.
//
// The patch is placed as if it had been cut from a 4096px image of the same
// moment (utils/regionCrop), so the close-up draws it exactly as it draws a
// crop of a real 4096px frame. Helioviewer's y runs down the image, from the
// top edge, as pixel rows do (its x1/y1 is the top-left corner), so a spot on
// the frame converts to arcseconds directly.

import { proxyImageUrl } from './imagePixels';

/** Helioviewer's layer for each view it carries, as the imagery worker asks for it. */
const HV_LAYERS: Record<string, string> = {
  magnetogram: '[SDO,HMI,HMI,magnetogram,1,100]',
  intensity: '[SDO,HMI,HMI,continuum,1,100]',
};
/** The imagery worker's Helioviewer frames: their close-up comes from here. */
export const HV_FRAME_PRODUCTS = new Set(['HMIHVB', 'HMIHVI']);

/** The 4096px image the patch stands in for, and HMI's own scale. */
const FULL = 4096;
const NATIVE_ARCSEC_PX = 0.504;
/** The patch, in pixels at that scale. */
const SIZE = 1024;
/**
 * Where a patch may be centred, in 4096px pixels. Snapping to a grid means
 * a region moving a pixel or two asks for the same patch - one download that
 * serves many frames, and stays in the browser's and the proxy's caches.
 */
const GRID = 64;
const WEEK_S = 7 * 24 * 3600;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export interface HvPatch { url: string; sx: number; sy: number; full: number }

/**
 * The close-up's sharp copy of a Helioviewer frame: the patch around (fx, fy),
 * fractions of the frame, at the frame's moment. Null for a view Helioviewer
 * does not carry.
 */
export function hvCropUrl(mode: string, atMs: number, fx: number, fy: number): string | null {
  const layer = HV_LAYERS[mode];
  if (!layer || !Number.isFinite(atMs)) return null;
  const half = SIZE / 2;
  const cx = Math.max(half, Math.min(FULL - half, Math.round((clamp01(fx) * FULL) / GRID) * GRID));
  const cy = Math.max(half, Math.min(FULL - half, Math.round((clamp01(fy) * FULL) / GRID) * GRID));
  const x0 = (cx - FULL / 2) * NATIVE_ARCSEC_PX;
  const y0 = (cy - FULL / 2) * NATIVE_ARCSEC_PX;
  const date = new Date(atMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const real = 'https://api.helioviewer.org/v2/takeScreenshot/'
    + `?date=${date}&imageScale=${NATIVE_ARCSEC_PX}&layers=${encodeURIComponent(layer)}`
    + `&x0=${x0.toFixed(2)}&y0=${y0.toFixed(2)}&width=${SIZE}&height=${SIZE}&display=true&watermark=false`;
  // Helioviewer sends no CORS headers; the close-up reads the pixels.
  const via = proxyImageUrl(real, WEEK_S);
  return `hvcrop:${cx - half}:${cy - half}:${FULL}:${encodeURIComponent(via)}`;
}

/** The parts of an hvCropUrl: where the patch sits in the 4096px image, and what to fetch. */
export function parseHvCrop(url: string): HvPatch | null {
  const m = /^hvcrop:(\d+):(\d+):(\d+):(.+)$/.exec(url);
  if (!m) return null;
  return { sx: +m[1], sy: +m[2], full: +m[3], url: decodeURIComponent(m[4]) };
}
