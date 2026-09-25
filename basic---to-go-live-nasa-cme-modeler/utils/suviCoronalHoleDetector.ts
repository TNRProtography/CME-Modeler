// --- START OF FILE utils/suviCoronalHoleDetector.ts ---
//
// SUVI 195Å Coronal Hole Detector - calibrated against real GOES-19 imagery
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
// 10. Return CoronalHole[] (empty if none found - no simulated fallback).
//
// ── TUNING GUIDE ──────────────────────────────────────────────────────────
//
//   ANALYSIS_SIZE          Canvas px - 300 is fast and accurate enough.
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

import type { CoronalHole }            from './coronalHoleData';
import { estimateHssSpeedFromChWidthAndDarkness } from './solarWindModel';
import { readImagePixels } from './imagePixels';
import { solarDiskOrientation } from './solarEphemeris';

// ── Tuning constants ──────────────────────────────────────────────────────────
/**
 * Off-screen canvas resolution. 400 gives sharper polygon boundaries.
 *
 * Exported because `diskRadius`, `diskCentreX` and `diskCentreY` on the result
 * are in this space, and anything drawing the detected holes back over the
 * imagery has to scale them out of it. Taking the disk from the detector this
 * way rather than measuring it again is also the only way to be sure the
 * outlines land where the detector thought they were.
 */
export const ANALYSIS_SIZE    = 400;
const N_LIMB_ANGLES           = 360;   // directions to scan for limb detection
const LIMB_SCAN_START         = 0.35;  // start limb scan at this fraction of image half-size
const LIMB_SCAN_END           = 0.99;  // end limb scan at this fraction of image half-size
const LIMB_EXCLUSION_FRAC     = 0.06;  // exclude outer 6% of per-angle limb radius
const CH_DARK_THRESHOLD_FRAC  = 0.52;  // CH pixel if luma < this × disk median (raised from 0.40 to catch full CH extent)
const MIN_CH_PIXEL_FRAC       = 0.003; // minimum CH region as fraction of disk area
const MAX_CH_REGIONS          = 4;     // return at most this many CHs

// ── Sunspot rejection filters ─────────────────────────────────────────────────
//
// Sunspots appear as near-perfect dark circles in EUV 195Å imagery and must be
// excluded from coronal hole detection.  Two independent tests are applied:
//
// 1. CIRCULARITY: 4π·area / perimeter²  (1.0 = perfect circle, lower = elongated)
//    Real CHs are irregular and elongated; sunspots score close to 1.0.
//    Reject any region with circularity > MAX_CH_CIRCULARITY.
//    Note: only applied to SMALL regions - large CHs are exempt because
//    a high-threshold darkMask may only capture the most irregular cores.
//
// 2. ASPECT RATIO: bounding-box height / width (or width / height, whichever > 1)
//    Sunspots are compact (ratio ≈ 1); most CHs are elongated (ratio > 1.2).
//    Only applied to small regions; large CHs (like CH31) can be square in bbox.
//
const MAX_CH_CIRCULARITY = 0.80;  // reject if 4π·area/perimeter² > this (sunspot = ~0.95+)
const MIN_CH_ASPECT      = 1.20;  // reject if bounding-box long/short < this
const SUNSPOT_MAX_FRAC   = 0.025; // only apply shape filters to regions below this size

const SUVI_195_URL     = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/latest.png';

// ── Internal types ─────────────────────────────────────────────────────────────
export interface PixelRegion {
  pixels:    Array<{ x: number; y: number }>;
  minX: number; maxX: number;
  minY: number; maxY: number;
  centroidX: number; centroidY: number;
}

// Fetching and decoding now live in utils/imagePixels.ts. They used to be
// here, which meant every other feature that needed to read pixels off a
// science image either reinvented the proxy hop or quietly got a tainted
// canvas and an empty panel.

// ── Luma ─────────────────────────────────────────────────────────────────────
function luma(d: Uint8ClampedArray, i: number): number {
  return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
}

// ── Gradient-based limb detection ─────────────────────────────────────────────
//
// Scans outward from the disk centre along a given angle direction.
// Finds the steepest negative gradient in brightness - this is the true
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

/**
 * Re-fit the disk centre from the limb distances measured around it.
 *
 * If the guessed centre is off by (dx, dy), the measured radius at angle theta
 * is longer on one side and shorter on the other by dx*cos(theta) + dy*sin(theta).
 * Averaging the limb points therefore lands on the true centre, and two passes
 * are plenty because the correction is nearly linear for the small offsets a
 * caption band produces.
 *
 * Streamers make individual radii too long, so the longest sixth are dropped
 * before averaging rather than being allowed to drag the centre toward them.
 */
function limbCentre(limbRadii: number[], cx: number, cy: number): { cx: number; cy: number } | null {
  if (limbRadii.length < 8) return null;
  const sorted = [...limbRadii].sort((a, b) => a - b);
  const cap = sorted[Math.floor(sorted.length * 0.85)];
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < limbRadii.length; i++) {
    const r = limbRadii[i];
    if (!Number.isFinite(r) || r <= 0 || r > cap) continue;
    const a = (i / limbRadii.length) * 2 * Math.PI;
    sx += cx + r * Math.cos(a);
    sy += cy + r * Math.sin(a);
    n++;
  }
  if (n < 8) return null;
  return { cx: sx / n, cy: sy / n };
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

// ── Joining holes across slivers ─────────────────────────────────────────────
/**
 * How far apart two dark patches can be and still be one coronal hole, in
 * analysis pixels (a morphological closing radius). A bright filament or a
 * thin band of brighter plasma often runs across a hole and cut it in two;
 * two patches nearly touching are, on the Sun, one open-field region. At the
 * analysis size a degree near disk centre is about three pixels, so this
 * bridges gaps up to about two degrees.
 */
export const CH_JOIN_RADIUS_PX = 3;

/**
 * The dark mask with gaps up to twice `radius` closed: dilate, then erode,
 * both by a disk of that radius, and never outside the solar disk. A gap
 * narrower than the disk fills in and stays filled; the outer edge of a hole
 * comes back to where it was.
 */
export function closeMask(mask: boolean[], within: boolean[], W: number, H: number, radius: number): boolean[] {
  if (radius <= 0) return mask;
  const offsets: [number, number][] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) if (dx * dx + dy * dy <= radius * radius) offsets.push([dx, dy]);
  }
  const pass = (src: boolean[], dilate: boolean): boolean[] => {
    const out = new Array<boolean>(W * H).fill(false);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!within[i]) continue;
        let hit = !dilate;
        for (const [dx, dy] of offsets) {
          const xx = x + dx, yy = y + dy;
          // Off the image or the disk counts as dark when eroding, so the
          // limb does not eat the edge of a hole that touches it.
          const v = xx < 0 || yy < 0 || xx >= W || yy >= H || !within[yy * W + xx] ? !dilate : src[yy * W + xx];
          if (dilate ? v : !v) { hit = dilate; break; }
        }
        out[i] = hit;
      }
    }
    return out;
  };
  return pass(pass(mask, true), false);
}

/** A joined region cut back to the pixels that were dark to begin with. */
function ownPixels(region: PixelRegion, darkMask: boolean[], W: number): PixelRegion {
  const pixels = region.pixels.filter((p) => darkMask[p.y * W + p.x]);
  if (pixels.length === 0 || pixels.length === region.pixels.length) return region;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, sumX = 0, sumY = 0;
  for (const p of pixels) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    sumX += p.x; sumY += p.y;
  }
  return { pixels, minX, maxX, minY, maxY, centroidX: sumX / pixels.length, centroidY: sumY / pixels.length };
}

/**
 * The dark regions that are coronal holes: joined across slivers, big
 * enough, and not shaped like a sunspot. Biggest first.
 */
export function holeRegions(darkMask: boolean[], diskMask: boolean[], size: number): PixelRegion[] {
  const diskPixelCount = diskMask.filter(Boolean).length;
  const minPixels = diskPixelCount * MIN_CH_PIXEL_FRAC;
  // Holes cut by a sliver of brighter sky, or nearly touching, are one hole.
  const joinedMask = closeMask(darkMask, diskMask, size, size, CH_JOIN_RADIUS_PX);
  // The sunspot test looks at the shape of the region, and a sunspot is
  // round and smooth-edged. Joining smooths every edge, so the test is run on
  // the region's own dark pixels - its real, ragged outline - or nearly every
  // hole under the size limit would be taken for a sunspot and dropped.
  return connectedComponents(joinedMask, size, size)
    .filter(r => r.pixels.length >= minPixels)
    .filter(r => isCoronalHoleCandidate(ownPixels(r, darkMask, size), diskPixelCount))
    .sort((a, b) => b.pixels.length - a.pixels.length)
    .slice(0, MAX_CH_REGIONS);
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

// ── Sunspot rejection helpers ─────────────────────────────────────────────────

/**
 * Circularity = 4π · area / perimeter²
 * Perfect circle → 1.0; elongated / irregular shapes → lower values.
 * The perimeter is approximated as the count of border pixels (pixels that
 * have at least one 4-connected non-region neighbour).
 */
function regionCircularity(region: PixelRegion): number {
  const pixelSet = new Set<number>();
  region.pixels.forEach(p => pixelSet.add((p.y << 16) | p.x));

  let borderCount = 0;
  for (const p of region.pixels) {
    const { x, y } = p;
    if (
      !pixelSet.has(((y - 1) << 16) | x) ||
      !pixelSet.has(((y + 1) << 16) | x) ||
      !pixelSet.has((y << 16) | (x - 1)) ||
      !pixelSet.has((y << 16) | (x + 1))
    ) {
      borderCount++;
    }
  }
  if (borderCount < 4) return 1;
  return (4 * Math.PI * region.pixels.length) / (borderCount * borderCount);
}

/**
 * Aspect ratio = long-side / short-side of the bounding box.
 * Returns ≥ 1.0; sunspots score close to 1, elongated CHs score > 1.5.
 */
function regionAspectRatio(region: PixelRegion): number {
  const w = region.maxX - region.minX + 1;
  const h = region.maxY - region.minY + 1;
  return w > h ? w / h : h / w;
}

/**
 * Returns true if the region should be kept as a coronal hole candidate.
 * Rejects near-circular compact regions (sunspots / active-region cores).
 * Shape filters are ONLY applied to small regions - large CHs like CH31
 * can be nearly square in their bounding box and still be genuine coronal holes.
 */
function isCoronalHoleCandidate(region: PixelRegion, diskPixelCount: number): boolean {
  const areaFrac = region.pixels.length / diskPixelCount;

  // Large regions pass unconditionally - they can't be sunspots
  if (areaFrac >= SUNSPOT_MAX_FRAC) return true;

  // Small regions: apply circularity and aspect ratio filters
  const circularity = regionCircularity(region);
  if (circularity > MAX_CH_CIRCULARITY) return false;

  const aspect = regionAspectRatio(region);
  if (aspect < MIN_CH_ASPECT) return false;

  return true;
}

// ── Pixel → heliographic (orthographic projection) ───────────────────────────
//
// Standard solar disk orthographic projection:
//   u = (x - cx) / r_disk        normalised horizontal  (positive = right = WEST)
//   v = (y - cy) / r_disk        normalised vertical    (positive = down = south)
//   lat = -arcsin(v)             heliographic latitude  (positive = north)
//   lon =  arcsin(u / cos(lat))  heliographic longitude (positive = west)
//
// West is positive, the same way NOAA writes a sunspot's location. The comment
// here used to say east, which is the opposite of what the arithmetic does:
// with solar north up, right on the image is west on the Sun.
//
// The disk centre corresponds to the Earth-facing point at the time of observation.
// So lon=0 is the sub-Earth point, and values range ±90°.
/**
 * Exported so it can be tested against the forward projection in solarDisk.ts.
 * The two are inverses of each other and nothing else guarantees they stay
 * that way: they live in different files, were written months apart, and a
 * disagreement between them is invisible in the code and obvious only as
 * outlines drawn beside the holes they came from.
 */
export function pixelToHG(
  px: number, py: number,
  cx: number, cy: number, diskR: number,
  b0Deg = 0,
): { lat: number; lon: number } | null {
  const u = (px - cx) / diskR;
  // Screen y grows downward, heliographic north is up.
  const w = -(py - cy) / diskR;
  const r2 = u * u + w * w;
  if (r2 > 1) return null;
  // Toward the observer. Only the front of the Sun is visible, so the
  // positive root is the only one.
  const z = Math.sqrt(Math.max(0, 1 - r2));

  // Undo the tilt of the rotation axis. This is the exact inverse of the
  // forward projection in solarDisk.ts - the two have to agree, because an
  // outline measured here is drawn back onto the image with that one, and any
  // disagreement between them shows up as holes sitting beside the dark
  // patches they were traced from.
  const B = b0Deg * Math.PI / 180;
  const sinB = Math.sin(B), cosB = Math.cos(B);

  const sinLat = cosB * w + sinB * z;
  const lat = Math.asin(Math.max(-1, Math.min(1, sinLat)));
  // atan2 rather than asin: it keeps the sign of the longitude right all the
  // way to the limb instead of folding it back at 90 degrees.
  const lon = Math.atan2(u, -sinB * w + cosB * z);

  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// ── Build boundary polygon for a region ──────────────────────────────────────
//
// Uses Moore neighbourhood contour tracing (Jacob's stopping criterion) to
// walk the TRUE boundary of the region in order.  This correctly represents
// concave shapes (diagonal slashes, L-shapes, etc.) that angle-sort sampling
// cannot reproduce - angle-sort forces a convex/radial ordering that loses
// the actual morphology.
//
// After tracing, the ordered boundary is downsampled to ~nPoints vertices and
// converted to heliographic coordinate offsets from the centroid.
function buildPolygon(
  region: PixelRegion,
  cx: number, cy: number, diskR: number,
  b0Deg = 0,
  nPoints = 64,
): Array<{ lat: number; lon: number }> | undefined {
  const { pixels, centroidX, centroidY } = region;
  if (pixels.length < 6) return undefined;

  // Build fast lookup set
  const pixelSet = new Set<number>();
  pixels.forEach(p => pixelSet.add(p.y * 2048 + p.x)); // use stride 2048 (> ANALYSIS_SIZE)
  const has = (x: number, y: number) => pixelSet.has(y * 2048 + x);

  // ── Step 1: find a guaranteed boundary start pixel (topmost, then leftmost)
  let startX = pixels[0].x, startY = pixels[0].y;
  for (const p of pixels) {
    if (p.y < startY || (p.y === startY && p.x < startX)) {
      startX = p.x; startY = p.y;
    }
  }

  // ── Step 2: Moore neighbourhood trace (8-connected boundary walk)
  // Directions: E=0, NE=1, N=2, NW=3, W=4, SW=5, S=6, SE=7
  const DX = [1, 1, 0,-1,-1,-1, 0, 1];
  const DY = [0,-1,-1,-1, 0, 1, 1, 1];

  const boundary: Array<{ x: number; y: number }> = [];
  const MAX_TRACE = Math.min(8000, pixels.length * 4);

  // Entry direction is from the west (we come from a non-region pixel to the left)
  let cx0 = startX, cy0 = startY;
  let dir = 4; // came from West (outside), so next to check is W direction = 4, backtrack = dir+4 mod 8

  // For Moore tracing: start direction is the "backtrack" direction into non-region
  dir = 6; // start pixel found from above, so "previous" position was from South (dir=6 goes S)
  
  let traced = 0;
  let x = cx0, y = cy0;
  const startKey = y * 2048 + x;

  do {
    boundary.push({ x, y });

    // Scan 8-neighbours CCW starting from backtrack direction
    const backDir = (dir + 4) % 8;
    let found = false;
    for (let i = 1; i <= 8; i++) {
      const d = (backDir + i) % 8;
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (has(nx, ny)) {
        dir = d;
        x = nx; y = ny;
        found = true;
        break;
      }
    }
    if (!found) break; // isolated pixel
    traced++;
  } while (traced < MAX_TRACE && !(x === cx0 && y === cy0 && traced > 2));

  if (boundary.length < 6) return undefined;

  // ── Step 3: Downsample ordered boundary to nPoints vertices
  const poly: Array<{ lat: number; lon: number }> = [];
  const step = Math.max(1, Math.floor(boundary.length / nPoints));
  for (let i = 0; i < boundary.length; i += step) {
    const p = boundary[i];
    const hg = pixelToHG(p.x, p.y, cx, cy, diskR, b0Deg);
    if (hg) poly.push(hg);
  }

  const hgCen = pixelToHG(centroidX, centroidY, cx, cy, diskR, b0Deg);
  if (!hgCen || poly.length < 3) return undefined;

  // Return as offsets from centroid (same convention as before)
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
  /**
   * The same disk as fractions of the SOURCE frame, which is what anything
   * drawing these holes back over the imagery needs. Null when detection
   * failed.
   */
  diskFraction:  { cx: number; cy: number; r: number } | null;
  /** The axis tilt used for the projection, so a caller can invert it exactly. */
  b0Deg:         number;
  succeeded:     boolean;
  errorMessage?: string;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Fetch and analyse the latest SUVI 195Å image.
 * Returns CoronalHole[] - empty if none detected.  Never returns fake data.
 */
export async function detectCoronalHolesFromSuvi195(
  imageUrl: string = SUVI_195_URL,
  animPhaseOffset = 0.3,
  observedAt: Date = new Date(),
): Promise<SuviDetectionResult> {

  try {
    // ── 1. Fetch and render ───────────────────────────────────────────────
    // 'contain' rather than a straight stretch: a SUVI frame carries a
    // caption band, so it is not square, and squeezing it into a square
    // canvas turns the Sun into an ellipse. Everything measured afterwards
    // then inherits that distortion.
    const size = ANALYSIS_SIZE;
    const raster = await readImagePixels(imageUrl, size, 'contain');
    const data = raster.data;

    // ── 2. Find the disk ──────────────────────────────────────────────────
    // The centre used to be assumed to be the centre of the frame. It is not:
    // the caption band pushes the Sun upward, and any error here moves every
    // hole on the disk by the same amount in the same direction. So the limb
    // is measured from a first guess and the centre re-fitted to it.
    let cx = size / 2;
    let cy = size / 2;
    for (let pass = 0; pass < 2; pass++) {
      const probe = buildDiskMask(data, size, size, cx, cy);
      const fitted = limbCentre(probe.limbRadii, cx, cy);
      if (!fitted) break;
      const moved = Math.hypot(fitted.cx - cx, fitted.cy - cy);
      cx = fitted.cx;
      cy = fitted.cy;
      if (moved < 0.5) break;
    }

    // ── 3. Gradient-based per-angle limb detection ───────────────────────
    const { mask: diskMask, limbRadii } = buildDiskMask(data, size, size, cx, cy);

    // Median disk radius for heliographic conversions
    const sortedLimb = [...limbRadii].sort((a, b) => a - b);
    const medianLimbR = sortedLimb[Math.floor(sortedLimb.length / 2)];
    const diskR = medianLimbR * (1 - LIMB_EXCLUSION_FRAC);

    if (diskR < size * 0.15) {
      throw new Error(`Disk too small (r=${diskR.toFixed(1)}) - image may not have loaded`);
    }

    // The tilt of the rotation axis toward or away from us on this date. It
    // reaches about seven degrees twice a year, and leaving it out shifts
    // everything on the disk in latitude by up to that much - which is
    // exactly what made the outlines sit beside their holes rather than on
    // them once they were drawn back onto the image.
    const { b0 } = solarDiskOrientation(observedAt);

    // ── 5. Dark pixel mask ────────────────────────────────────────────────
    const median    = diskMedian(data, diskMask, size);
    const threshold = median * CH_DARK_THRESHOLD_FRAC;

    const darkMask  = new Array<boolean>(size * size).fill(false);
    for (let i = 0; i < diskMask.length; i++) {
      if (diskMask[i] && luma(data, i * 4) < threshold) darkMask[i] = true;
    }

    // ── 6. Connected components ────────────────────────────────────────────
    const diskPixelCount = diskMask.filter(Boolean).length;
    const candidates     = holeRegions(darkMask, diskMask, size);

    // ── 7. Convert to CoronalHole objects ──────────────────────────────────
    const coronalHoles: CoronalHole[] = candidates.flatMap((region, idx) => {
      const hgCen  = pixelToHG(region.centroidX, region.centroidY, cx, cy, diskR, b0);

      // If the centroid maps outside the disk (null), this region is invalid - skip it.
      // This catches noise clusters whose centroid lands at the very edge or outside.
      if (!hgCen) return [];

      const lat    = hgCen.lat;
      const lon    = hgCen.lon;

      const leftHG   = pixelToHG(region.minX, region.centroidY, cx, cy, diskR, b0);
      const rightHG  = pixelToHG(region.maxX, region.centroidY, cx, cy, diskR, b0);
      const topHG    = pixelToHG(region.centroidX, region.minY,  cx, cy, diskR, b0);
      const bottomHG = pixelToHG(region.centroidX, region.maxY,  cx, cy, diskR, b0);

      const widthDeg  = leftHG && rightHG  ? Math.abs(rightHG.lon  - leftHG.lon)  : 15;
      const heightDeg = topHG  && bottomHG ? Math.abs(bottomHG.lat - topHG.lat)   : widthDeg;

      const polygon = buildPolygon(region, cx, cy, diskR, b0, 96);

      // Reject regions that have no usable polygon AND no meaningful size.
      // These are typically sunspot fragments or noise that slipped past the shape filter.
      const areaFrac = region.pixels.length / diskPixelCount;
      if (!polygon && areaFrac < SUNSPOT_MAX_FRAC) return [];

      // Darkness from the hole's own dark pixels, not the slivers joined across.
      let regionLumaSum = 0, regionDarkCount = 0;
      for (const p of region.pixels) {
        const i = p.y * size + p.x;
        if (!darkMask[i]) continue;
        regionLumaSum += luma(data, i * 4);
        regionDarkCount++;
      }
      const regionLumaMean = regionLumaSum / Math.max(1, regionDarkCount);
      const darkness = Math.max(0, Math.min(1, (median - regionLumaMean) / Math.max(1, median)));

      const opacity   = Math.min(0.65, 0.30 + areaFrac * 3.0);
      const expansionHalfAngleDeg = Math.min(22, 8 + widthDeg * 0.30);

      return [{
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
      }];
    });

    // Debug: log what was detected so shape issues can be diagnosed
    console.log('[SUVI CH detector] detected', coronalHoles.length, 'coronal holes:',
      coronalHoles.map(ch => ({
        id: ch.id, lat: ch.lat.toFixed(1), lon: ch.lon.toFixed(1),
        widthDeg: ch.widthDeg.toFixed(1), heightDeg: ch.heightDeg?.toFixed(1),
        polygonPts: ch.polygon?.length ?? 'ellipse-fallback',
        darkness: ch.darkness.toFixed(2),
      }))
    );

    // The disk, expressed as fractions of the SOURCE frame rather than of the
    // analysis canvas. That is what lets a caller draw these holes over the
    // same image at any display size: analysis pixels mean nothing outside
    // this function, whereas "43% of the way across the frame" survives every
    // resize.
    const { scale, offsetX, offsetY } = raster.placement;
    const nat = raster.natural;
    const diskFraction = {
      cx: ((cx - offsetX) / scale) / nat.width,
      cy: ((cy - offsetY) / scale) / nat.height,
      r:  (diskR / scale) / Math.min(nat.width, nat.height),
    };

    return {
      coronalHoles,
      imageUrl,
      analysedAt:  observedAt,
      diskRadius:  diskR,
      diskCentreX: cx,
      diskCentreY: cy,
      diskFraction,
      b0Deg:       b0,
      succeeded:   true,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[SUVI CH detector]', msg);
    return {
      coronalHoles:  [],
      imageUrl,
      analysedAt:    observedAt,
      diskRadius:    0,
      diskCentreX:   0,
      diskCentreY:   0,
      diskFraction:  null,
      b0Deg:         0,
      succeeded:     false,
      errorMessage:  msg,
    };
  }
}

// --- END OF FILE utils/suviCoronalHoleDetector.ts ---