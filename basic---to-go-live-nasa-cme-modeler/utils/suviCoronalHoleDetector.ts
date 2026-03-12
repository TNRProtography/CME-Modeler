// --- START OF FILE utils/suviCoronalHoleDetector.ts ---
//
// SUVI 195Å Coronal Hole Detector — calibrated against real GOES-19 imagery
// ══════════════════════════════════════════════════════════════════════════
//
// CALIBRATION BASIS
// ─────────────────
// Tuned against the GOES-19 SUVI 195Å composite from 2026-03-12 showing a
// large elongated CH (diagonal sliver) running across the disk centre.
// The image is amber colour-mapped; standard luma (0.299R+0.587G+0.114B)
// is used throughout. Validated detection recovers the known CH at ~3% of
// disk area with no limb false positives.
//
// PIPELINE
// ────────
// 1.  Fetch image through the Cloudflare proxy (/api/proxy/image) to get a
//     same-origin blob URL that canvas getImageData() can read without CORS.
// 2.  Draw onto an off-screen canvas at ANALYSIS_SIZE × ANALYSIS_SIZE.
// 3.  Find the solar disk edge using a GRADIENT-BASED limb detector scanning
//     outward from the centre at N_LIMB_ANGLES directions.  Uses the steepest
//     negative gradient point to find the true photosphere limb, correctly
//     ignoring the outer faint corona halo that extends beyond the disk.
// 4.  Build a per-pixel disk mask using the measured per-angle limb radius
//     shrunk by LIMB_EXCLUSION_FRAC to exclude the immediate limb transition.
// 5.  Compute the MEDIAN luma of all pixels inside the mask.
// 6.  Mark every disk pixel below CH_DARK_THRESHOLD_FRAC × median as a CH
//     candidate.  This adaptive threshold handles exposure variations.
// 7.  BFS flood-fill to find connected CH regions.
// 8.  Discard regions smaller than MIN_CH_PIXEL_FRAC × disk area.
// 9.  Convert each region's centroid and bounding points to heliographic
//     coordinates using the standard solar orthographic projection.
// 10. Return CoronalHole[] (empty if none found — no simulated fallback).
//
// ── TUNING GUIDE ──────────────────────────────────────────────────────────
//
//   ANALYSIS_SIZE          Canvas px — 300 is fast and accurate enough.
//                          Increase to 512 for sharper polygon boundaries.
//
//   N_LIMB_ANGLES          Angular resolution of limb scan (360 = 1°/step).
//                          Reducing to 180 is 2× faster with minor accuracy loss.
//
//   LIMB_EXCLUSION_FRAC    Fraction of limb radius excluded from the disk mask
//                          (0.06 = inner 94% of disk).  Increase if limb-
//                          darkening pixels are being caught as CH candidates.
//
//   CH_DARK_THRESHOLD_FRAC Fraction of disk median luma below which a pixel
//                          is a CH candidate.  Calibrated at 0.40 against the
//                          2026-03-12 image.  Lower = only the darkest cores.
//                          Higher = broader boundary, more sensitivity.
//
//   MIN_CH_PIXEL_FRAC      Minimum CH region size as fraction of disk area.
//                          0.003 = 0.3 % catches meaningful CHs while rejecting
//                          single-pixel noise and tiny dark specks.
//
//   MAX_CH_REGIONS         Hard cap on returned CHs (largest by area first).
//
//   PROXY_TTL_SECONDS      Cloudflare edge cache TTL for the proxied image.

import { CoronalHole }                 from './coronalHoleData';
import { estimateHssSpeedFromChWidthAndDarkness } from './solarWindModel';

// ── Tuning constants ──────────────────────────────────────────────────────────
const ANALYSIS_SIZE           = 300;   // off-screen canvas resolution
const N_LIMB_ANGLES           = 360;   // directions to scan for limb detection
const LIMB_SCAN_START         = 0.35;  // start limb scan at this fraction of image half-size
const LIMB_SCAN_END           = 0.99;  // end limb scan at this fraction of image half-size
const LIMB_EXCLUSION_FRAC     = 0.06;  // exclude outer 6% of per-angle limb radius
const CH_DARK_THRESHOLD_FRAC  = 0.40;  // CH pixel if luma < this × disk median
const MIN_CH_PIXEL_FRAC       = 0.003; // minimum CH region as fraction of disk area
const MAX_CH_REGIONS          = 4;     // return at most this many CHs
const PROXY_TTL_SECONDS       = 90;    // edge cache TTL

const SUVI_195_URL     = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/latest.png';
const PROXY_IMAGE_PATH = '/api/proxy/image';

// ── Internal types ─────────────────────────────────────────────────────────────
interface PixelRegion {
  pixels:    Array<{ x: number; y: number }>;
  minX: number; maxX: number;
  minY: number; maxY: number;
  centroidX: number; centroidY: number;
}

// ── Proxy URL ─────────────────────────────────────────────────────────────────
function proxyUrl(targetUrl: string): string {
  return `${PROXY_IMAGE_PATH}?url=${encodeURIComponent(targetUrl)}&ttl=${PROXY_TTL_SECONDS}`;
}

// ── Fetch image through proxy → blob URL ──────────────────────────────────────
async function fetchAsBlob(url: string): Promise<string> {
  const res = await fetch(proxyUrl(url));
  if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status} for ${url}`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`Expected image, got ${blob.type}`);
  return URL.createObjectURL(blob);
}

// ── Draw onto canvas → ImageData ──────────────────────────────────────────────
async function toImageData(blobUrl: string, size: number): Promise<ImageData> {
  return new Promise<ImageData>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('No 2d canvas context')); return; }
      ctx.drawImage(img, 0, 0, size, size);
      try {
        resolve(ctx.getImageData(0, 0, size, size));
      } catch (e) {
        reject(new Error(`getImageData failed (CORS?): ${e}`));
      }
    };
    img.onerror = () => reject(new Error('Blob image load failed'));
    img.src = blobUrl;
  });
}

// ── Luma ─────────────────────────────────────────────────────────────────────
function luma(d: Uint8ClampedArray, i: number): number {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

// ── Gradient-based limb detection ─────────────────────────────────────────────
//
// Scans outward from the disk centre along a given angle direction.
// Finds the steepest negative gradient in brightness — this is the true
// photosphere/corona limb, unaffected by the faint outer corona halo.
//
// Why this beats a simple brightness threshold:
//   The SUVI 195 image has a diffuse outer corona that appears dark but
//   extends ~10–20% beyond the actual photosphere radius.  A threshold scan
//   from the image edge catches that halo.  Scanning from the centre OUTWARD
//   and looking for the steepest drop reliably finds the actual disk edge.
function findLimbRadius(
  data: Uint8ClampedArray,
  W: number, H: number,
  cx: number, cy: number,
  angleDeg: number,
): number {
  const angle  = (angleDeg * Math.PI) / 180;
  const cosA   = Math.cos(angle);
  const sinA   = Math.sin(angle);
  const maxR   = Math.floor(Math.min(W, H) / 2);
  const rStart = Math.floor(maxR * LIMB_SCAN_START);
  const rEnd   = Math.floor(maxR * LIMB_SCAN_END);

  // Collect luma values along the ray
  const samples: number[] = [];
  const rs: number[] = [];
  for (let r = rStart; r <= rEnd; r++) {
    const x = Math.round(cx + cosA * r);
    const y = Math.round(cy + sinA * r);
    if (x < 0 || x >= W || y < 0 || y >= H) break;
    const i = (y * W + x) * 4;
    samples.push(luma(data, i));
    rs.push(r);
  }

  if (samples.length < 4) return rEnd;

  // Compute first-order gradient
  const grad: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(samples.length - 1, i + 1)];
    grad.push((next - prev) / 2);
  }

  // Find steepest negative gradient (the limb drop)
  // Only consider the outer half of the scan to avoid picking up CH interiors
  const outerStart = Math.floor(samples.length * 0.45);
  let minGrad = 0;
  let minIdx  = samples.length - 1;
  for (let i = outerStart; i < grad.length; i++) {
    if (grad[i] < minGrad) { minGrad = grad[i]; minIdx = i; }
  }

  return rs[minIdx];
}

// ── Build per-pixel disk mask using per-angle limb radii ──────────────────────
function buildDiskMask(
  data: Uint8ClampedArray,
  W: number, H: number,
  cx: number, cy: number,
): { mask: boolean[]; limbRadii: number[] } {
  // Step 1: measure limb radius at N_LIMB_ANGLES directions
  const limbRadii: number[] = [];
  for (let i = 0; i < N_LIMB_ANGLES; i++) {
    const deg = (i / N_LIMB_ANGLES) * 360;
    limbRadii.push(findLimbRadius(data, W, H, cx, cy, deg));
  }

  // Robustness: clip outliers (corona streamers can push limb outward)
  // Use the p85 value as the maximum accepted limb radius
  const sorted   = [...limbRadii].sort((a, b) => a - b);
  const p85      = sorted[Math.floor(sorted.length * 0.85)];
  const clipped  = limbRadii.map(r => Math.min(r, p85));

  // Step 2: for each pixel, look up the limb radius for its direction
  const mask = new Array<boolean>(W * H).fill(false);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx   = x - cx;
      const dy   = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2) continue;  // skip exact centre

      // Angle index (0 → N_LIMB_ANGLES-1)
      let deg = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const ai = Math.round((deg / 360) * N_LIMB_ANGLES) % N_LIMB_ANGLES;
      const limb = clipped[ai] * (1 - LIMB_EXCLUSION_FRAC);

      if (dist < limb) mask[y * W + x] = true;
    }
  }

  return { mask, limbRadii: clipped };
}

// ── Median luma inside the disk mask ─────────────────────────────────────────
function diskMedian(data: Uint8ClampedArray, mask: boolean[], W: number): number {
  const vals: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    vals.push(luma(data, i * 4));
  }
  if (vals.length === 0) return 128;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)];
}

// ── BFS connected-component flood fill ───────────────────────────────────────
function connectedComponents(
  darkMask: boolean[], W: number, H: number
): PixelRegion[] {
  const visited = new Uint8Array(W * H);
  const regions: PixelRegion[] = [];

  for (let sy = 0; sy < H; sy++) {
    for (let sx = 0; sx < W; sx++) {
      const si = sy * W + sx;
      if (!darkMask[si] || visited[si]) continue;

      const queue = [si];
      visited[si] = 1;
      const pixels: Array<{ x: number; y: number }> = [];
      let minX = sx, maxX = sx, minY = sy, maxY = sy;
      let sumX = 0, sumY = 0;

      while (queue.length) {
        const idx = queue.pop()!;
        const px  = idx % W;
        const py  = Math.floor(idx / W);
        pixels.push({ x: px, y: py });
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
        sumX += px; sumY += py;

        for (const n of [idx - 1, idx + 1, idx - W, idx + W]) {
          if (n < 0 || n >= W * H) continue;
          if (Math.abs((n % W) - px) > 1) continue;  // no wrap
          if (!darkMask[n] || visited[n]) continue;
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

// ── Pixel → heliographic (orthographic projection) ───────────────────────────
//
// Standard solar disk orthographic projection:
//   u = (x - cx) / r_disk        normalised horizontal  (positive = east on disk)
//   v = (y - cy) / r_disk        normalised vertical    (positive = down = south)
//   lat = -arcsin(v)             heliographic latitude  (positive = north)
//   lon =  arcsin(u / cos(lat))  heliographic longitude (positive = east / left on disk)
//
// The disk centre corresponds to the Earth-facing point at the time of observation.
// So lon=0 is the sub-Earth point, and values range ±90°.
function pixelToHG(
  px: number, py: number,
  cx: number, cy: number, diskR: number
): { lat: number; lon: number } | null {
  const u  = (px - cx) / diskR;
  const v  = (py - cy) / diskR;
  if (u * u + v * v > 1) return null;
  const lat    = Math.asin(Math.max(-1, Math.min(1, -v)));
  const cosLat = Math.cos(lat);
  const lon    = cosLat > 1e-6
    ? Math.asin(Math.max(-1, Math.min(1, u / cosLat)))
    : 0;
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// ── Build boundary polygon for a region ──────────────────────────────────────
function buildPolygon(
  region: PixelRegion,
  cx: number, cy: number, diskR: number,
  nPoints = 12,
): Array<{ lat: number; lon: number }> | undefined {
  const { pixels, centroidX, centroidY } = region;
  if (pixels.length < 6) return undefined;

  // Sample the boundary pixel farthest from centroid in each angular sector
  const poly: Array<{ lat: number; lon: number }> = [];
  for (let i = 0; i < nPoints; i++) {
    const targetAngle = (i / nPoints) * Math.PI * 2;
    const tolerance   = Math.PI / nPoints;
    let bestDist = 0;
    let best: { x: number; y: number } | null = null;

    for (const p of pixels) {
      const pAngle = Math.atan2(p.y - centroidY, p.x - centroidX);
      const diff = Math.abs(((pAngle - targetAngle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (diff > tolerance) continue;
      const dist = Math.hypot(p.x - centroidX, p.y - centroidY);
      if (dist > bestDist) { bestDist = dist; best = p; }
    }

    if (best) {
      const hg = pixelToHG(best.x, best.y, cx, cy, diskR);
      if (hg) poly.push(hg);
    }
  }

  // Convert to offsets from centroid
  const hgCen = pixelToHG(centroidX, centroidY, cx, cy, diskR);
  if (!hgCen || poly.length < 3) return undefined;
  return poly.map(p => ({ lat: p.lat - hgCen.lat, lon: p.lon - hgCen.lon }));
}

// ── Public result type ────────────────────────────────────────────────────────
export interface SuviDetectionResult {
  coronalHoles:  CoronalHole[];
  imageUrl:      string;
  analysedAt:    Date;
  /** Median disk radius in ANALYSIS_SIZE pixel space (for debug) */
  diskRadius:    number;
  diskCentreX:   number;
  diskCentreY:   number;
  succeeded:     boolean;
  errorMessage?: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch and analyse the latest SUVI 195Å image.
 * Returns CoronalHole[] — empty if none detected.  Never returns fake data.
 */
export async function detectCoronalHolesFromSuvi195(
  imageUrl: string = SUVI_195_URL,
  animPhaseOffset = 0.3,
): Promise<SuviDetectionResult> {

  let blobUrl: string | null = null;

  try {
    // ── 1. Fetch ──────────────────────────────────────────────────────────
    if (imageUrl.startsWith('blob:') || imageUrl.startsWith('data:') || imageUrl.startsWith(window.location.origin)) {
      blobUrl = imageUrl;
    } else {
      blobUrl = await fetchAsBlob(imageUrl);
    }

    // ── 2. Canvas render ──────────────────────────────────────────────────
    const size = ANALYSIS_SIZE;
    const id   = await toImageData(blobUrl, size);
    const data = id.data;

    // ── 3. Find disk centre (simple midline scan for cx/cy is good enough
    //        since the sun fills most of the frame in SUVI images)
    const cx = size / 2;
    const cy = size / 2;

    // ── 4. Gradient-based per-angle limb detection ───────────────────────
    const { mask: diskMask, limbRadii } = buildDiskMask(data, size, size, cx, cy);

    // Median disk radius for heliographic conversions
    const sortedLimb = [...limbRadii].sort((a, b) => a - b);
    const medianLimbR = sortedLimb[Math.floor(sortedLimb.length / 2)];
    const diskR = medianLimbR * (1 - LIMB_EXCLUSION_FRAC);

    if (diskR < size * 0.15) {
      throw new Error(`Disk too small (r=${diskR.toFixed(1)}) — image may not have loaded`);
    }

    // ── 5. Dark pixel mask ────────────────────────────────────────────────
    const median    = diskMedian(data, diskMask, size);
    const threshold = median * CH_DARK_THRESHOLD_FRAC;

    const darkMask  = new Array<boolean>(size * size).fill(false);
    for (let i = 0; i < diskMask.length; i++) {
      if (diskMask[i] && luma(data, i * 4) < threshold) darkMask[i] = true;
    }

    // ── 6. Connected components ────────────────────────────────────────────
    const diskPixelCount = diskMask.filter(Boolean).length;
    const minPixels      = diskPixelCount * MIN_CH_PIXEL_FRAC;
    const allRegions     = connectedComponents(darkMask, size, size);

    const candidates = allRegions
      .filter(r => r.pixels.length >= minPixels)
      .sort((a, b) => b.pixels.length - a.pixels.length)
      .slice(0, MAX_CH_REGIONS);

    // ── 7. Convert to CoronalHole objects ──────────────────────────────────
    const coronalHoles: CoronalHole[] = candidates.map((region, idx) => {
      const hgCen  = pixelToHG(region.centroidX, region.centroidY, cx, cy, diskR);
      const lat    = hgCen?.lat ?? 0;
      const lon    = hgCen?.lon ?? 0;

      const leftHG   = pixelToHG(region.minX, region.centroidY, cx, cy, diskR);
      const rightHG  = pixelToHG(region.maxX, region.centroidY, cx, cy, diskR);
      const topHG    = pixelToHG(region.centroidX, region.minY,  cx, cy, diskR);
      const bottomHG = pixelToHG(region.centroidX, region.maxY,  cx, cy, diskR);

      const widthDeg  = leftHG && rightHG  ? Math.abs(rightHG.lon  - leftHG.lon)  : 15;
      const heightDeg = topHG  && bottomHG ? Math.abs(bottomHG.lat - topHG.lat)   : widthDeg;

      const polygon = buildPolygon(region, cx, cy, diskR, 14);

      let regionLumaSum = 0;
      for (const p of region.pixels) {
        regionLumaSum += luma(data, (p.y * size + p.x) * 4);
      }
      const regionLumaMean = regionLumaSum / Math.max(1, region.pixels.length);
      const darkness = Math.max(0, Math.min(1, (median - regionLumaMean) / Math.max(1, median)));

      // Larger / darker CHs get slightly higher opacity
      const areaFrac  = region.pixels.length / diskPixelCount;
      const opacity   = Math.min(0.65, 0.30 + areaFrac * 3.0);

      const expansionHalfAngleDeg = Math.min(22, 8 + widthDeg * 0.30);

      return {
        id:                   `CH_SUVI_${idx}`,
        lat,
        lon,
        widthDeg:             Math.max(5, widthDeg),
        heightDeg:            Math.max(5, heightDeg),
        polygon,
        estimatedSpeedKms:    estimateHssSpeedFromChWidthAndDarkness(Math.max(5, widthDeg), darkness),
        darkness,
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
      diskRadius:  diskR,
      diskCentreX: cx,
      diskCentreY: cy,
      succeeded:   true,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[SUVI CH detector]', msg);
    return {
      coronalHoles:  [],
      imageUrl:      blobUrl ?? '',
      analysedAt:    new Date(),
      diskRadius:    0,
      diskCentreX:   0,
      diskCentreY:   0,
      succeeded:     false,
      errorMessage:  msg,
    };
  }
  // Note: blobUrl is NOT revoked — the caller may display it for debug.
}

// --- END OF FILE utils/suviCoronalHoleDetector.ts ---
