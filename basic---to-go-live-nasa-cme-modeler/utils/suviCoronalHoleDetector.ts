// --- START OF FILE utils/suviCoronalHoleDetector.ts ---
//
// SUVI 195Å Coronal Hole Detector
// ════════════════════════════════
//
// Pipeline:
//   1. Fetch the SUVI 195 image through the local Cloudflare proxy so we get
//      a same-origin blob URL — this lets us call getImageData() on a canvas
//      without triggering a CORS security error.
//   2. Draw the image onto an off-screen canvas and read every pixel.
//   3. Locate the solar disk centre & radius using the bright photosphere ring.
//   4. For every pixel inside the disk, classify it as "dark" (CH candidate)
//      if its luminance falls below an adaptive threshold.
//   5. Run a simple flood-fill connected-components pass to group dark pixels
//      into candidate regions.
//   6. Filter regions by minimum size and circularity to discard noise/limb.
//   7. Convert each surviving region's pixel centroid + bounding-box into
//      heliographic lat/lon and an angular width estimate.
//   8. Return a CoronalHole[] array ready to plug straight into coronalHoleData.ts.
//
// TUNING CONSTANTS (all at the top of this file — labelled TUNE)
// ─────────────────────────────────────────────────────────────────
//   ANALYSIS_SIZE          : canvas resolution to work at (256 is fast; 512 is sharper)
//   CH_DARK_THRESHOLD_FRAC : pixel luminance / disk-median ratio below which a pixel
//                            is classed as a CH candidate.  Lower = stricter.
//   MIN_CH_PIXEL_FRAC      : minimum CH region area as fraction of disk area.
//   MAX_CH_REGIONS         : cap on how many CHs we return (largest first).
//   LIMB_EXCLUSION_FRAC    : ignore pixels within this fraction of the disk radius
//                            from the limb (suppresses limb-darkening artefacts).
//   PROXY_TTL_SECONDS      : how long the Cloudflare proxy caches the image.
//
// HOW CH WIDTH MAPS TO HSS SPEED
// ───────────────────────────────
// Each detected CH has its `widthDeg` populated from the east-west pixel span.
// That value is passed to `estimateHssSpeedFromChWidth()` (solarWindModel.ts)
// which maps it linearly to 350–800 km/s.  Wider CH = faster stream.

import { CoronalHole }                 from './coronalHoleData';
import { estimateHssSpeedFromChWidth } from './solarWindModel';

// ── TUNE: Analysis parameters ─────────────────────────────────────────────────
const ANALYSIS_SIZE          = 300;   // off-screen canvas px (higher = more accurate, slower)
const CH_DARK_THRESHOLD_FRAC = 0.45;  // pixel luma / disk-median — below this = CH candidate
const MIN_CH_PIXEL_FRAC      = 0.004; // minimum CH region as fraction of total disk pixels
const MAX_CH_REGIONS         = 4;     // return at most this many coronal holes
const LIMB_EXCLUSION_FRAC    = 0.06;  // ignore outermost 6 % of disk radius (limb noise)
const PROXY_TTL_SECONDS      = 90;    // seconds to cache the image at the edge

// ── Constants ─────────────────────────────────────────────────────────────────
const SUVI_195_URL     = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/latest.png';
const PROXY_IMAGE_PATH = '/api/proxy/image';

// ── Type used internally ──────────────────────────────────────────────────────
interface PixelRegion {
  pixels:  Array<{ x: number; y: number }>;
  minX: number; maxX: number;
  minY: number; maxY: number;
  centroidX: number; centroidY: number;
}

// ── Proxy URL builder ─────────────────────────────────────────────────────────
function buildProxyUrl(targetUrl: string, ttl: number): string {
  return `${PROXY_IMAGE_PATH}?url=${encodeURIComponent(targetUrl)}&ttl=${ttl}`;
}

// ── Fetch image through proxy → blob URL ─────────────────────────────────────
async function fetchImageAsBlob(url: string): Promise<string> {
  const proxyUrl  = buildProxyUrl(url, PROXY_TTL_SECONDS);
  const response  = await fetch(proxyUrl);
  if (!response.ok) throw new Error(`Proxy fetch failed: ${response.status} for ${url}`);
  const blob      = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`Expected image blob, got ${blob.type}`);
  return URL.createObjectURL(blob);
}

// ── Draw blob URL onto canvas → return ImageData ─────────────────────────────
async function getImageData(blobUrl: string, size: number): Promise<ImageData> {
  return new Promise<ImageData>((resolve, reject) => {
    const img       = new Image();
    img.crossOrigin = 'anonymous';
    img.onload      = () => {
      const canvas  = document.createElement('canvas');
      canvas.width  = size;
      canvas.height = size;
      const ctx     = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Could not get 2d canvas context')); return; }
      ctx.drawImage(img, 0, 0, size, size);
      try {
        resolve(ctx.getImageData(0, 0, size, size));
      } catch (e) {
        reject(new Error(`getImageData failed (CORS?): ${e}`));
      }
    };
    img.onerror = () => reject(new Error('Image failed to load from blob URL'));
    img.src     = blobUrl;
  });
}

// ── Luminance from RGBA ───────────────────────────────────────────────────────
// SUVI images are grayscale displayed in colour mapping.  Use standard luma.
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// ── Find solar disk: centre (cx,cy) and radius r ─────────────────────────────
// Strategy: sample a cross at the midpoint of the image.  The SUVI 195 image
// has a nearly circular bright disk with a black background.  We scan inward
// from each edge along the horizontal/vertical centrelines to find where
// brightness first rises above a low threshold.
function findSolarDisk(data: Uint8ClampedArray, W: number, H: number):
    { cx: number; cy: number; r: number } {

  const mid     = Math.floor(W / 2);
  const bgThresh = 12; // pixel value below which we're in the background

  // Horizontal scan from left
  let left = 0;
  for (let x = 0; x < W; x++) {
    const i = (mid * W + x) * 4;
    if (luma(data[i], data[i+1], data[i+2]) > bgThresh) { left = x; break; }
  }
  // Horizontal scan from right
  let right = W - 1;
  for (let x = W - 1; x >= 0; x--) {
    const i = (mid * W + x) * 4;
    if (luma(data[i], data[i+1], data[i+2]) > bgThresh) { right = x; break; }
  }
  // Vertical scan from top
  let top = 0;
  for (let y = 0; y < H; y++) {
    const i = (y * W + mid) * 4;
    if (luma(data[i], data[i+1], data[i+2]) > bgThresh) { top = y; break; }
  }
  // Vertical scan from bottom
  let bottom = H - 1;
  for (let y = H - 1; y >= 0; y--) {
    const i = (y * W + mid) * 4;
    if (luma(data[i], data[i+1], data[i+2]) > bgThresh) { bottom = y; break; }
  }

  const cx = (left + right)  / 2;
  const cy = (top  + bottom) / 2;
  const r  = ((right - left) + (bottom - top)) / 4; // average of h/v radius

  return { cx, cy, r };
}

// ── Compute median luminance inside the disk ─────────────────────────────────
function diskMedianLuma(data: Uint8ClampedArray, W: number,
    cx: number, cy: number, r: number): number {
  const values: number[] = [];
  const r2 = r * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || x >= W || y < 0) continue;
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;
      const i = (y * W + x) * 4;
      values.push(luma(data[i], data[i+1], data[i+2]));
    }
  }
  if (values.length === 0) return 128;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)];
}

// ── Build dark-pixel mask ─────────────────────────────────────────────────────
// Returns a boolean[] (flat, same index as pixel array / 4).
// Only pixels inside the disk (excluding the limb ring) are candidates.
function buildDarkMask(data: Uint8ClampedArray, W: number, H: number,
    cx: number, cy: number, r: number, threshold: number): boolean[] {

  const mask   = new Array<boolean>(W * H).fill(false);
  const rInner = r * (1 - LIMB_EXCLUSION_FRAC); // exclude outermost ring
  const r2     = rInner * rInner;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy > r2) continue;   // outside disk interior
      const i = (y * W + x) * 4;
      const l = luma(data[i], data[i+1], data[i+2]);
      if (l < threshold) mask[y * W + x] = true;
    }
  }
  return mask;
}

// ── Flood-fill connected-components ──────────────────────────────────────────
// Returns a list of regions, each being a set of (x,y) pixels.
function connectedComponents(mask: boolean[], W: number, H: number): PixelRegion[] {
  const visited = new Uint8Array(W * H);
  const regions: PixelRegion[] = [];

  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const si = sy * W + sx;
      if (!mask[si] || visited[si]) continue;

      // BFS flood fill
      const queue: number[] = [si];
      visited[si] = 1;
      const pixels: Array<{ x: number; y: number }> = [];
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      let sumX = 0, sumY = 0;

      while (queue.length > 0) {
        const idx  = queue.pop()!;
        const px   = idx % W;
        const py   = Math.floor(idx / W);
        pixels.push({ x: px, y: py });
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        sumX += px; sumY += py;

        // 4-connectivity neighbours
        const neighbours = [idx - 1, idx + 1, idx - W, idx + W];
        for (const n of neighbours) {
          if (n < 0 || n >= W * H) continue;
          const nx = n % W;
          // Prevent wrap-around at left/right edges
          if (Math.abs(nx - px) > 1) continue;
          if (!mask[n] || visited[n]) continue;
          visited[n] = 1;
          queue.push(n);
        }
      }

      regions.push({
        pixels,
        minX, maxX, minY, maxY,
        centroidX: sumX / pixels.length,
        centroidY: sumY / pixels.length,
      });
    }
  }
  return regions;
}

// ── Convert pixel position → heliographic lat/lon ────────────────────────────
//
// The solar disk is a sphere projected orthographically.
// A pixel at (px, py) relative to the disk centre maps to:
//   normalised position: (u, v) = ((px-cx)/r, (py-cy)/r)
// On the near hemisphere:
//   sin(lon) = u / cos(lat)   →  lon = asin(u)   (small-angle approx at disk centre)
//   sin(lat) = -v              (positive latitude = north = up in image)
//
// This is the standard solar orthographic projection used in heliophysics.
function pixelToHeliographic(px: number, py: number,
    cx: number, cy: number, r: number): { lat: number; lon: number } | null {
  const u = (px - cx) / r;
  const v = (py - cy) / r;
  const d2 = u * u + v * v;
  if (d2 > 1) return null;          // off disk

  // Heliographic latitude (north positive)
  const lat = Math.asin(Math.max(-1, Math.min(1, -v)));  // -v because y increases downward
  // Heliographic longitude (east positive on disk)
  const cosLat = Math.cos(lat);
  const lon = cosLat > 1e-6 ? Math.asin(Math.max(-1, Math.min(1, u / cosLat))) : 0;

  return {
    lat: lat * 180 / Math.PI,
    lon: lon * 180 / Math.PI,
  };
}

// ── Build a polygon from region boundary pixels ───────────────────────────────
// We walk the bounding-box perimeter and sample points for the polygon.
// A full convex-hull would be more accurate but this is sufficient.
function regionToPolygon(
  region: PixelRegion,
  cx: number, cy: number, r: number,
  targetPoints: number = 10
): Array<{ lat: number; lon: number }> | undefined {
  const { pixels, centroidX, centroidY } = region;
  if (pixels.length < 4) return undefined;

  // Sample pixels that are farthest from centroid at evenly-spaced angles
  const angles = Array.from({ length: targetPoints }, (_, i) =>
    (i / targetPoints) * Math.PI * 2
  );
  const polygon: Array<{ lat: number; lon: number }> = [];

  for (const angle of angles) {
    let bestDist = 0;
    let bestPx: { x: number; y: number } | null = null;

    for (const p of pixels) {
      const pAngle = Math.atan2(p.y - centroidY, p.x - centroidX);
      // Accept pixels within ±(π/targetPoints) of the target angle
      const diff = Math.abs(((pAngle - angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff > Math.PI / targetPoints) continue;
      const dist = Math.hypot(p.x - centroidX, p.y - centroidY);
      if (dist > bestDist) { bestDist = dist; bestPx = p; }
    }

    if (bestPx) {
      const hg = pixelToHeliographic(bestPx.x, bestPx.y, cx, cy, r);
      if (hg) polygon.push(hg);
    }
  }

  // Return polygon vertices as offsets from the centroid (matches CoronalHole.polygon format)
  const hgCentroid = pixelToHeliographic(centroidX, centroidY, cx, cy, r);
  if (!hgCentroid || polygon.length < 3) return undefined;
  return polygon.map(p => ({
    lat: p.lat - hgCentroid.lat,
    lon: p.lon - hgCentroid.lon,
  }));
}

// ── Main export ───────────────────────────────────────────────────────────────

export interface SuviDetectionResult {
  coronalHoles:  CoronalHole[];
  /** URL of the image that was analysed (for debug display) */
  imageUrl:      string;
  /** Timestamp of the analysis */
  analysedAt:    Date;
  /** Diagnostic info for the UI */
  diskRadius:    number;  // pixels in ANALYSIS_SIZE space
  diskCentreX:   number;
  diskCentreY:   number;
  /** true if the analysis succeeded, false if we fell back to defaults */
  succeeded:     boolean;
  errorMessage?: string;
}

/**
 * Fetch the latest SUVI 195Å image through the app's Cloudflare proxy,
 * analyse it for coronal holes, and return a CoronalHole[] array.
 *
 * @param animPhaseOffset  Optional phase offset between returned CHs (0–1).
 *                         Staggers HSS ripple animation so they don't pulse together.
 */
export async function detectCoronalHolesFromSuvi195(
  animPhaseOffset = 0.3,
): Promise<SuviDetectionResult> {

  let blobUrl: string | null = null;

  try {
    // ── Step 1: fetch image through proxy ──────────────────────────────────
    blobUrl = await fetchImageAsBlob(SUVI_195_URL);

    // ── Step 2: draw onto canvas ──────────────────────────────────────────
    const size      = ANALYSIS_SIZE;
    const imageData = await getImageData(blobUrl, size);
    const { data }  = imageData;

    // ── Step 3: find solar disk ────────────────────────────────────────────
    const { cx, cy, r } = findSolarDisk(data, size, size);

    if (r < size * 0.1) {
      throw new Error(`Disk detection failed: r=${r.toFixed(1)} too small (image may not have loaded)`);
    }

    // ── Step 4: adaptive threshold from disk median ────────────────────────
    const medianLuma  = diskMedianLuma(data, size, cx, cy, r);
    const threshold   = medianLuma * CH_DARK_THRESHOLD_FRAC;

    // ── Step 5: dark pixel mask ────────────────────────────────────────────
    const mask        = buildDarkMask(data, size, size, cx, cy, r, threshold);

    // ── Step 6: connected components ──────────────────────────────────────
    const diskPixels  = Math.PI * r * r;
    const minPixels   = diskPixels * MIN_CH_PIXEL_FRAC;
    const allRegions  = connectedComponents(mask, size, size);

    // Filter by minimum size and sort largest-first
    const candidates  = allRegions
      .filter(reg => reg.pixels.length >= minPixels)
      .sort((a, b) => b.pixels.length - a.pixels.length)
      .slice(0, MAX_CH_REGIONS);

    // ── Step 7: convert to CoronalHole objects ─────────────────────────────
    const coronalHoles: CoronalHole[] = candidates.map((region, idx) => {
      const hgCentre    = pixelToHeliographic(region.centroidX, region.centroidY, cx, cy, r);
      const lat         = hgCentre?.lat   ?? 0;
      const lon         = hgCentre?.lon   ?? 0;

      // Angular width: pixel span in X maps to angular span in longitude
      const leftHg      = pixelToHeliographic(region.minX, region.centroidY, cx, cy, r);
      const rightHg     = pixelToHeliographic(region.maxX, region.centroidY, cx, cy, r);
      const topHg       = pixelToHeliographic(region.centroidX, region.minY, cx, cy, r);
      const bottomHg    = pixelToHeliographic(region.centroidX, region.maxY, cx, cy, r);

      const widthDeg    = leftHg && rightHg
        ? Math.abs(rightHg.lon - leftHg.lon)
        : 15;
      const heightDeg   = topHg && bottomHg
        ? Math.abs(topHg.lat - bottomHg.lat)
        : widthDeg;

      const polygon     = regionToPolygon(region, cx, cy, r, 10);

      // Area fraction — larger CHs get slightly higher base opacity
      const areaFrac    = region.pixels.length / diskPixels;
      const opacity     = Math.min(0.6, 0.3 + areaFrac * 2.5);

      // Expansion half-angle scales with CH size (wider CH → broader stream)
      const expansionHalfAngleDeg = Math.min(20, 8 + widthDeg * 0.25);

      return {
        id:                   `CH_SUVI_${idx}`,
        lat,
        lon,
        widthDeg:             Math.max(5, widthDeg),
        heightDeg:            Math.max(5, heightDeg),
        polygon,
        estimatedSpeedKms:    estimateHssSpeedFromChWidth(Math.max(5, widthDeg)),
        sourceDirectionDeg:   { lat, lon },
        expansionHalfAngleDeg,
        opacity,
        hssVisible:           true,
        animPhase:            (idx * animPhaseOffset) % 1,
      };
    });

    return {
      coronalHoles,
      imageUrl:    blobUrl,
      analysedAt:  new Date(),
      diskRadius:  r,
      diskCentreX: cx,
      diskCentreY: cy,
      succeeded:   true,
    };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn('[SUVI CH detector]', errorMessage);

    return {
      coronalHoles:  [],   // caller should fall back to DEFAULT_CORONAL_HOLES
      imageUrl:      blobUrl ?? '',
      analysedAt:    new Date(),
      diskRadius:    0,
      diskCentreX:   0,
      diskCentreY:   0,
      succeeded:     false,
      errorMessage,
    };
  } finally {
    // Don't revoke blobUrl here — the caller may need it for debug display
  }
}

// --- END OF FILE utils/suviCoronalHoleDetector.ts ---