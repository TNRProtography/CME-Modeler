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

  const step = Math.max(1, Math.floor(Math.min(width, height) / 512));
  const sample = (x: number, y: number): number => {
    const i = (y * width + x) * 4;
    if (data[i + 3] === 0) return 0;
    return Math.max(data[i], data[i + 1], data[i + 2]);
  };

  // The cut between disk and sky, set from the disk's own brightness rather
  // than fixed. A fixed low threshold is fine for HMI, where off-limb is
  // genuinely black, but EUV imagery has corona and prominences outside the
  // limb; anything bright enough to cross a low bar would be counted as disk
  // and inflate the radius. The disk is always the middle of the frame, so
  // the middle of the frame is what sets the scale.
  const cxProbe = Math.floor(width / 2);
  const cyProbe = Math.floor(height / 2);
  const probe: number[] = [];
  for (let y = cyProbe - Math.floor(height * 0.1); y <= cyProbe + Math.floor(height * 0.1); y += step) {
    for (let x = cxProbe - Math.floor(width * 0.1); x <= cxProbe + Math.floor(width * 0.1); x += step) {
      if (x >= 0 && y >= 0 && x < width && y < height) probe.push(sample(x, y));
    }
  }
  if (probe.length === 0) return null;
  probe.sort((a, b) => a - b);
  const diskLevel = probe[Math.floor(probe.length / 2)];
  // Never go below the old fixed floor, so a dim frame cannot drive the cut
  // down into the noise.
  // Half the disk's own brightness. The corona in a 304 or 195 composite is
  // bright enough to clear a third of it in places, which would be counted as
  // disk and report a Sun larger than the one in the picture.
  const LIT = Math.max(40, diskLevel * 0.5);

  const rows: { y: number; len: number; mid: number }[] = [];
  for (let y = 0; y < height; y += step) {
    let best = 0, bestStart = 0;
    let run = 0, runStart = 0;
    for (let x = 0; x < width; x++) {
      if (sample(x, y) > LIT) {
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

// ── Carrying a region back in time ─────────────────────────────────────────
// NOAA reports where a region was when it was observed. Scrub a timeline back
// six hours and the Sun has turned since, so drawing the reported longitude on
// an older frame puts the label ahead of the spot - by about half a degree an
// hour, which near disk centre is a couple of pixels an hour and grows as the
// limb foreshortens.

/**
 * Degrees of longitude the disk turns through per day as seen from Earth.
 *
 * The synodic rate, from the Carrington rotation period of 27.2753 days: the
 * Sun's own sidereal turn minus the Earth's travel around it. Using the
 * sidereal rate here would drift by about a degree a day.
 */
export const SOLAR_SYNODIC_DEG_PER_DAY = 360 / 27.2753;

/** A region's Stonyhurst longitude at some other moment. */
export function longitudeAt(
  longitudeWhenObserved: number,
  observedAtMs: number,
  atMs: number,
): number {
  const days = (atMs - observedAtMs) / 86400000;
  return longitudeWhenObserved + SOLAR_SYNODIC_DEG_PER_DAY * days;
}

// ── Where a contained image actually sits in its box ───────────────────────

export interface ContainedRect {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Image pixels to box pixels. */
  scale: number;
}

/**
 * The rectangle an `object-contain` image occupies inside its element.
 *
 * A square Sun in a wider-than-tall panel is letterboxed, so a position in
 * image pixels is not a position in the panel until it has been through this.
 * Getting it wrong puts every label off by the width of the letterbox, which
 * is why this is computed from the image's own natural size rather than
 * assumed to be the panel.
 */
export function containedImageRect(
  natural: { width: number; height: number },
  box: { width: number; height: number },
): ContainedRect {
  if (!natural.width || !natural.height || !box.width || !box.height) {
    return { x: 0, y: 0, width: box.width, height: box.height, scale: 1 };
  }
  const scale = Math.min(box.width / natural.width, box.height / natural.height);
  const w = natural.width * scale;
  const h = natural.height * scale;
  return { x: (box.width - w) / 2, y: (box.height - h) / 2, width: w, height: h, scale };
}

// ── Reusing a measurement across frames of the same product ────────────────

export interface DiskFraction {
  /** Centre as a fraction of width and height, radius as a fraction of the short side. */
  cx: number;
  cy: number;
  r: number;
}

/** A measured disk expressed as fractions of its frame. */
export function diskAsFraction(
  geometry: SolarDiskGeometry,
  natural: { width: number; height: number },
): DiskFraction {
  return {
    cx: geometry.cx / natural.width,
    cy: geometry.cy / natural.height,
    r: geometry.radius / Math.min(natural.width, natural.height),
  };
}

/**
 * Turn remembered proportions back into pixels for a frame of any size.
 *
 * Every SUVI composite shares a plate scale whatever the channel, so a disk
 * measured on 131 describes 284 just as well. That matters because individual
 * frames are often unusable - the 284 channel frequently arrives nearly blank -
 * and without this a channel whose own frames all fail would show no labels at
 * all rather than borrowing a perfectly good measurement.
 */
export function diskFromFraction(
  fraction: DiskFraction,
  natural: { width: number; height: number },
): SolarDiskGeometry {
  return {
    width: natural.width,
    height: natural.height,
    cx: fraction.cx * natural.width,
    cy: fraction.cy * natural.height,
    radius: fraction.r * Math.min(natural.width, natural.height),
  };
}
