// Which way a coronal hole's field points, read off an HMI magnetogram.
//
// WHY IT MATTERS
// ──────────────
// A coronal hole is a patch of open field: the same polarity everywhere,
// stretching out into the solar system instead of looping back down. Which
// polarity that is decides the direction of the interplanetary field the
// hole's stream drags past Earth, and that in turn decides how much of the
// stream's energy gets into the magnetosphere.
//
// Positive polarity - field pointing out of the Sun - gives an "away" sector,
// where the field at Earth has By > 0. Negative gives a "toward" sector, By < 0.
// The Russell-McPherron effect makes one of those far better for aurora
// depending on the time of year: near the MARCH equinox an away sector (By > 0)
// projects a southward component onto the geomagnetic field, and near
// SEPTEMBER it is a toward sector that does. Around the solstices neither does
// much. So the same hole, with the same width and the same wind speed, is a
// better or worse prospect depending on the month - and that is worth saying
// out loud rather than leaving people to wonder why one stream lit up and an
// identical-looking one did not.
//
// This file previously had those two the wrong way round. The trap is that
// "away favours spring" is correct and easy to remember, and then spring gets
// read as September by anyone thinking about New Zealand. It is not a
// hemisphere property: the effect is set by the tilt of the geomagnetic dipole
// relative to the Sun on a given date, so March is March wherever you are
// standing. Nothing below decides it by month any more - the season note is
// computed from the same projection the hourly windows use, so the two cannot
// disagree again.
//
// HOW IT IS MEASURED
// ──────────────────
// From the greyscale HMI line-of-sight magnetogram, not the colourised one.
// The greyscale convention is unambiguous and has not changed: mid-grey is
// zero field, white is field coming toward the observer (positive), black is
// field going away (negative). A colour map is a rendering choice that can be
// re-tuned upstream without warning, and getting it backwards would invert
// every answer here silently.
//
// The hole's own footprint is sampled, because that is where the open flux is.
// The field inside a hole is not uniform - it is concentrated into network
// elements, the same bright points that show as plage in chromospheric
// imagery, with quiet dark lanes between them - so this sums the signed
// contribution of every pixel rather than counting a majority. A ring around
// the hole is sampled as well: quiet Sun outside a hole is balanced, so an
// outside that is mixed while the inside is one-sided is a good sign the
// boundary is where the detector thinks it is.
//
// WHERE IT STOPS WORKING
// ──────────────────────
// A line-of-sight magnetogram measures the component pointing at us. Near disk
// centre that is nearly the full radial field. Near the limb the radial field
// is almost perpendicular to the line of sight and the signal collapses into
// noise, so a hole within about 30 degrees of the limb cannot be called this
// way. The answer is reported as unknown there rather than guessed, which is
// the same constraint the width measurement has for the same geometric reason.

import { heliographicToPixel, type SolarDiskGeometry } from './solarDisk';
import { rmDailyPeak, type BySign } from './rmWindows';

/** Mid-grey either way by this much is treated as no measurable field. */
export const NEUTRAL_TOLERANCE = 12;

/** Beyond this much of a tilt the line of sight barely sees the radial field. */
export const MAX_RELIABLE_LONGITUDE = 60;

/** A hole has to be this one-sided before it is called unipolar. */
export const UNIPOLAR_IMBALANCE = 0.34;

/** And this many pixels have to carry any field at all. */
export const MIN_SIGNAL_FRACTION = 0.04;

/** How much of a hole's outline has to be on the visible disk to sample it. */
export const MIN_VISIBLE_FRACTION = 0.7;

export type ChPolarity = 'positive' | 'negative' | 'mixed' | 'unknown';

/** Which way the interplanetary field points relative to the Sun. */
export type ImfSector = 'away' | 'toward' | 'unknown';

export interface PolaritySample {
  /** Pixels read inside the region. */
  total: number;
  /** Pixels brighter than mid-grey by more than the tolerance. */
  positive: number;
  /** Pixels darker than it by more than the tolerance. */
  negative: number;
  /** Sum of the signed deviation from mid-grey, -1..1 per pixel. */
  signedSum: number;
  /** Sum of its magnitude, so the two divide into an imbalance. */
  absSum: number;
}

export const EMPTY_SAMPLE: PolaritySample = { total: 0, positive: 0, negative: 0, signedSum: 0, absSum: 0 };

/**
 * One pixel of a greyscale magnetogram, as a signed field strength in -1..1.
 *
 * The GIF is greyscale, so the three channels agree and averaging them is
 * just noise reduction. Anything within the tolerance of mid-grey reads as
 * zero: the quiet Sun is full of weak mixed flux that would otherwise swamp
 * the network elements that actually carry a hole's open field.
 */
export function magnetogramPixelField(
  r: number, g: number, b: number,
  neutralTolerance: number = NEUTRAL_TOLERANCE,
): number {
  const luma = (r + g + b) / 3;
  const deviation = luma - 127.5;
  if (Math.abs(deviation) <= neutralTolerance) return 0;
  const signed = deviation > 0 ? deviation - neutralTolerance : deviation + neutralTolerance;
  return Math.max(-1, Math.min(1, signed / (127.5 - neutralTolerance)));
}

/**
 * Sum the field over a polygon drawn in heliographic degrees.
 *
 * The polygon is projected to pixels first and then filled by even-odd
 * crossing, which handles the concave shapes real holes have. `scale` grows
 * the outline about its centroid, which is how the surrounding ring is taken.
 */
export function samplePolygonField(
  image: { data: Uint8ClampedArray | number[]; width: number; height: number },
  polygon: { lat: number; lon: number }[],
  geometry: SolarDiskGeometry,
  opts: { b0?: number; p?: number; scale?: number; exclude?: number; neutralTolerance?: number } = {},
): PolaritySample {
  if (!polygon || polygon.length < 3) return { ...EMPTY_SAMPLE };

  const { b0 = 0, p = 0, scale = 1, exclude = 0, neutralTolerance = NEUTRAL_TOLERANCE } = opts;

  const cLat = polygon.reduce((a, q) => a + q.lat, 0) / polygon.length;
  const cLon = polygon.reduce((a, q) => a + q.lon, 0) / polygon.length;

  const project = (factor: number) => polygon
    .map((q) => heliographicToPixel(cLat + (q.lat - cLat) * factor, cLon + (q.lon - cLon) * factor, geometry, b0, p))
    .filter((q) => q.onDisk)
    .map((q) => ({ x: q.x, y: q.y }));

  const outer = project(scale);
  // A hole that runs over the limb loses the vertices that went round the
  // back, and what is left is the visible part of it - which is the only part
  // a magnetogram could tell us anything about anyway.
  //
  // This used to demand that every vertex project onto the disk. That is the
  // wrong test: a large hole is easily fifty degrees wide, so one sitting
  // anywhere but dead centre has an edge past the limb and was refused
  // outright - the bigger the hole, the more likely it went unread, which is
  // precisely backwards. What matters is that enough of it is visible for the
  // remaining outline to still describe the hole rather than a sliver of it.
  const visibleFraction = polygon.length > 0 ? outer.length / polygon.length : 0;
  if (visibleFraction < MIN_VISIBLE_FRACTION || outer.length < 3) return { ...EMPTY_SAMPLE };
  const inner = exclude > 0 ? project(exclude) : null;

  const xs = outer.map((q) => q.x), ys = outer.map((q) => q.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(image.width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(image.height - 1, Math.ceil(Math.max(...ys)));

  const out: PolaritySample = { ...EMPTY_SAMPLE };

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!pointInPolygon(x + 0.5, y + 0.5, outer)) continue;
      if (inner && pointInPolygon(x + 0.5, y + 0.5, inner)) continue;
      const i = (y * image.width + x) * 4;
      const field = magnetogramPixelField(image.data[i], image.data[i + 1], image.data[i + 2], neutralTolerance);
      out.total++;
      if (field > 0) out.positive++;
      else if (field < 0) out.negative++;
      out.signedSum += field;
      out.absSum += Math.abs(field);
    }
  }

  return out;
}

function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export interface ChPolarityResult {
  polarity: ChPolarity;
  /** -1 all negative, +1 all positive, 0 balanced. */
  imbalance: number;
  /** Fraction of sampled pixels carrying measurable field. */
  signalFraction: number;
  /** What the surrounding ring came out as, when one was sampled. */
  surroundImbalance: number | null;
  sector: ImfSector;
  confidence: 'good' | 'fair' | 'poor' | 'none';
  /** One line for the panel. */
  summary: string;
  /** Why it says what it says. */
  detail: string;
}

const NO_READING = (summary: string, detail: string): ChPolarityResult => ({
  polarity: 'unknown', imbalance: 0, signalFraction: 0, surroundImbalance: null,
  sector: 'unknown', confidence: 'none', summary, detail,
});

/**
 * Turn the sampled flux into a polarity, a sector, and something readable.
 *
 * @param inside     The hole's own footprint.
 * @param surround   A ring outside it, if one was taken.
 * @param longitude  Where the hole is now, west positive. Decides reliability.
 */
export function classifyChPolarity(
  inside: PolaritySample,
  surround: PolaritySample | null,
  longitude: number,
): ChPolarityResult {
  if (!inside || inside.total < 30) {
    return NO_READING('Polarity not measured',
      'Too little of the magnetogram falls inside this hole to read anything from it.');
  }

  if (Math.abs(longitude) > MAX_RELIABLE_LONGITUDE) {
    return NO_READING('Polarity not measurable yet',
      `The magnetogram measures the part of the field pointing at us, and at ${Math.abs(longitude).toFixed(0)} degrees `
      + `from the middle of the disk there is almost none of it left to measure. This will firm up as the hole turns `
      + `${longitude < 0 ? 'toward us' : 'away, though by then the reading is historical'}.`);
  }

  const signalFraction = inside.total > 0 ? (inside.positive + inside.negative) / inside.total : 0;
  const imbalance = inside.absSum > 0 ? inside.signedSum / inside.absSum : 0;
  const surroundImbalance = surround && surround.absSum > 0 ? surround.signedSum / surround.absSum : null;

  if (signalFraction < MIN_SIGNAL_FRACTION) {
    return NO_READING('Polarity not measured',
      'Almost every pixel inside this hole reads as zero field, which usually means the magnetogram '
      + 'and the hole outline are not lined up, or the frame is too faint to work with.');
  }

  if (Math.abs(imbalance) < UNIPOLAR_IMBALANCE) {
    return {
      polarity: 'mixed', imbalance, signalFraction, surroundImbalance, sector: 'unknown', confidence: 'poor',
      summary: 'Mixed polarity',
      detail: 'The field inside this region is about as much one way as the other. A real coronal hole is '
            + 'open field and so is one-sided, so a mixed reading more often means the dark patch is a '
            + 'filament channel or a shadow than that the hole itself is unusual.',
    };
  }

  const positive = imbalance > 0;
  const polarity: ChPolarity = positive ? 'positive' : 'negative';
  const sector: ImfSector = positive ? 'away' : 'toward';

  // Near the limb the reading survives but is worth less; a surrounding ring
  // that leans the same way as the inside means the boundary is questionable.
  let confidence: ChPolarityResult['confidence'] = 'good';
  if (Math.abs(longitude) > 40 || Math.abs(imbalance) < 0.5 || signalFraction < 0.12) confidence = 'fair';
  if (surroundImbalance !== null && Math.sign(surroundImbalance) === Math.sign(imbalance)
      && Math.abs(surroundImbalance) > Math.abs(imbalance) * 0.8) confidence = 'fair';

  const pct = Math.round(Math.abs(imbalance) * 100);
  return {
    polarity, imbalance, signalFraction, surroundImbalance, sector, confidence,
    summary: positive ? 'Positive polarity, away sector' : 'Negative polarity, toward sector',
    detail: `${pct} percent of the measurable flux inside this hole points the same way, `
          + `${positive ? 'out of the Sun' : 'back into it'}. Open field of that sign drags `
          + `${positive ? 'an away sector past Earth, with By pointing east' : 'a toward sector past Earth, with By pointing west'}.`,
  };
}

/**
 * What that sector is worth at a given time of year.
 *
 * Derived, not tabulated. It asks the same projection that drives the hourly
 * windows how much of this sector's By becomes southward field on the best
 * part of this day, and compares that against the opposite sector. Hard-coding
 * equinox dates here is what let this get stated backwards in the first place.
 */
export function sectorSeasonNote(sector: ImfSector, at: Date): { favourable: boolean | null; note: string } {
  if (sector === 'unknown') return { favourable: null, note: '' };

  const bySign: BySign = sector === 'away' ? 1 : -1;
  const mine = rmDailyPeak(bySign, at);
  const theirs = rmDailyPeak(bySign === 1 ? -1 : 1, at);
  const name = sector === 'away' ? 'away' : 'toward';
  const best = bestMonthFor(bySign);

  if (mine > 0.22 && mine > theirs * 1.4) {
    return {
      favourable: true,
      note: `This is the good part of the year for an ${name} sector. The tilt of Earth's field currently turns `
          + `an ${name} sector southward, so this stream has a better chance of producing aurora than its speed `
          + `alone suggests - and it does so at particular hours each night rather than steadily.`,
    };
  }

  if (theirs > 0.22 && theirs > mine * 1.4) {
    return {
      favourable: false,
      note: `This is the wrong part of the year for an ${name} sector. The tilt works against it now and favours `
          + `it around ${best}, so expect less from this stream than the same hole would give six months from now.`,
    };
  }

  return {
    favourable: null,
    note: `Between the two peaks, the seasonal tilt does little either way, so the sector matters less than the `
        + `speed and whatever the field happens to be doing when the stream arrives. An ${name} sector is `
        + `strongest around ${best}.`,
  };
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

/** The month in which this sector's projection is strongest. */
function bestMonthFor(bySign: BySign): string {
  let bestPeak = -1;
  let bestMonth = 0;
  for (let m = 0; m < 12; m++) {
    const peak = rmDailyPeak(bySign, new Date(Date.UTC(2001, m, 15)), 30);
    if (peak > bestPeak) { bestPeak = peak; bestMonth = m; }
  }
  return MONTHS[bestMonth];
}
