// Putting a sunspot where it actually is on a picture of the Sun.
//
// NOAA publishes an active region's position as a heliographic coordinate -
// "S14E64" means 14 degrees south of the solar equator, 64 degrees east of the
// central meridian. Turning that into a pixel needs two things the tracker was
// getting wrong.
//
// First the projection. Mapping lat/lon straight onto the disk assumes we are
// looking square at the solar equator, and we never are: Earth's orbit is
// tilted 7.25 degrees to it, so the disk centre drifts between 7.25 degrees
// north and south over a year. That angle is B0, and leaving it out moves a
// spot by up to 12% of the solar radius - in September, when B0 is at its
// maximum, tens of pixels.
//
// Second the disk itself. The Sun does not fill an HMI frame edge to edge and
// the margin differs between products, so the radius has to be measured from
// the image rather than assumed. Measuring it by taking the bounding box of
// everything non-black does not work either, because these frames carry a
// caption ("SDO/HMI Quick-Look Continuum 20260921_014500") that sits outside
// the disk and drags the box with it.

import { solarDiskOrientation } from './solarEphemeris';

const D2R = Math.PI / 180;

export interface SolarDiskGeometry {
  width: number;
  height: number;
  cx: number;
  cy: number;
  radius: number;
}

export interface DiskPosition {
  x: number;
  y: number;
  /** False when the region is round the back, or projects outside the limb. */
  onDisk: boolean;
}

/**
 * Heliographic (Stonyhurst) latitude and longitude to a pixel on the disk.
 *
 * `b0` is the heliographic latitude of disk centre and `p` the position angle
 * of the rotation axis. SDO imagery is rolled so solar north is up, so `p` is
 * zero for it; it is a parameter rather than an assumption because imagery
 * that is not north-up needs it.
 */
export function heliographicToPixel(
  latitude: number,
  longitude: number,
  geometry: SolarDiskGeometry,
  b0 = 0,
  p = 0,
): DiskPosition {
  const lat = latitude * D2R;
  const lon = longitude * D2R;
  const B = b0 * D2R;
  const P = p * D2R;

  // Orthographic projection onto the sky plane, in units of the solar radius.
  // The z term points at the observer, so it is what decides whether the
  // region is on the near side at all.
  const xr = Math.cos(lat) * Math.sin(lon);
  const yr = Math.sin(lat) * Math.cos(B) - Math.cos(lat) * Math.cos(lon) * Math.sin(B);
  const zr = Math.sin(lat) * Math.sin(B) + Math.cos(lat) * Math.cos(lon) * Math.cos(B);

  // Then roll by the position angle, if the imagery is not north-up.
  const xp = xr * Math.cos(P) - yr * Math.sin(P);
  const yp = xr * Math.sin(P) + yr * Math.cos(P);

  return {
    x: geometry.cx + geometry.radius * xp,
    // Screen y grows downward; heliographic north is up.
    y: geometry.cy - geometry.radius * yp,
    onDisk: zr > 0 && (xp * xp + yp * yp) <= 1,
  };
}

/** The same, reading B0 off the clock for the moment the image was taken. */
export function heliographicToPixelAt(
  latitude: number,
  longitude: number,
  geometry: SolarDiskGeometry,
  when: Date,
  northUp = true,
): DiskPosition {
  const { b0, p } = solarDiskOrientation(when);
  return heliographicToPixel(latitude, longitude, geometry, b0, northUp ? 0 : p);
}

/**
 * Find the solar disk in an image.
 *
 * Works on the longest unbroken run of lit pixels in each row rather than on a
 * bounding box. The disk produces one long run per row; a caption, a colour
 * bar or a stray bright speck produces short ones, so they never compete and
 * do not have to be identified or masked. Returns null when what it finds is
 * not disk-shaped, so a caller can fall back rather than draw on a bad guess.
 */
export function detectSolarDiskGeometry(
  data: Uint8ClampedArray | number[],
  width: number,
  height: number,
): SolarDiskGeometry | null {
  if (width < 16 || height < 16) return null;

  // Off-disk is black in every HMI product, so a low fixed cut separates the
  // disk from the background without needing to know its colour.
  const LIT = 40;
  const step = Math.max(1, Math.floor(Math.min(width, height) / 512));

  const rows: { y: number; len: number; mid: number }[] = [];
  for (let y = 0; y < height; y += step) {
    let best = 0, bestStart = 0;
    let run = 0, runStart = 0;
    const base = y * width;
    for (let x = 0; x < width; x++) {
      const i = (base + x) * 4;
      const lit = data[i + 3] > 0
        && (data[i] > LIT || data[i + 1] > LIT || data[i + 2] > LIT);
      if (lit) {
        if (run === 0) runStart = x;
        run++;
        if (run > best) { best = run; bestStart = runStart; }
      } else {
        run = 0;
      }
    }
    if (best > 0) rows.push({ y, len: best, mid: bestStart + best / 2 });
  }
  if (rows.length === 0) return null;

  const maxRun = rows.reduce((m, r) => Math.max(m, r.len), 0);
  // A disk should span a good part of the frame. Anything less and we are
  // probably looking at a caption on an otherwise blank image.
  if (maxRun < width * 0.25) return null;

  // Rows belonging to the disk. The cut is low enough to catch the rows near
  // the poles, where the chord is short, but far above any line of text.
  const diskRows = rows.filter(r => r.len >= maxRun * 0.12);
  const top = diskRows[0].y;
  const bottom = diskRows[diskRows.length - 1].y;

  // Centre from the widest rows only, where the chord midpoint is least
  // sensitive to a pixel of noise at either end.
  const widest = rows.filter(r => r.len >= maxRun * 0.98).map(r => r.mid).sort((a, b) => a - b);
  const cx = widest[Math.floor(widest.length / 2)];
  const cy = (top + bottom) / 2;

  const radiusFromWidth = maxRun / 2;
  const radiusFromHeight = (bottom - top) / 2 + step / 2;

  // The Sun is round. If the two measurements disagree the lit region is not
  // the disk - a colour ramp down one edge, say - and a fallback is safer than
  // a confident wrong answer.
  const ratio = radiusFromWidth / radiusFromHeight;
  if (!isFinite(ratio) || ratio < 0.9 || ratio > 1.1) return null;

  return {
    width,
    height,
    cx,
    cy,
    radius: (radiusFromWidth + radiusFromHeight) / 2,
  };
}
