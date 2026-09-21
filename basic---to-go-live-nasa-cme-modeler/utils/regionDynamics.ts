// What a sunspot region is about to do, and what it did.
//
// The disk is a clock. A region appears at the east limb, takes about a
// fortnight to cross, and is only aimed at Earth for part of that. Everything
// here is arithmetic on that rotation - when a region faces us, how long it
// stays facing us, and how much of a chance it has to do something while it
// does - plus a read on whether it is still growing.
//
// None of this is a published index. The numbers below are NOAA's own daily
// flare probabilities compounded over the time a region stays pointed at us,
// which is an honest thing to compute and an easy thing to explain. It is not
// a forecast model and does not pretend to be one.

import { SOLAR_SYNODIC_DEG_PER_DAY, longitudeAt } from './solarDisk';
import { EARTH_DIRECTED_MAX_LONGITUDE } from './cmeAnalysis';

/** Longitude of the west limb. East is the negative of this. */
const LIMB = 90;

export interface RegionTiming {
  /** Longitude right now, rotated from wherever NOAA last measured it. */
  longitude: number;
  /** Negative once it is past the meridian. */
  daysToCentralMeridian: number;
  /** Negative once it has gone round the back. */
  daysToWestLimb: number;
  /** How long since it came over the east limb. */
  daysSinceEastLimb: number;
  /** Whether it is aimed close enough at Earth for a CME to reach us. */
  inStrikeZone: boolean;
  /** Days until it enters. Zero if it already has. */
  daysToStrikeZone: number;
  /** Days until it leaves. Zero once it has. */
  daysLeftInStrikeZone: number;
  /** True once it has crossed the far edge of the zone. */
  strikeZonePassed: boolean;
}

/**
 * Where a region is in its trip across the disk.
 *
 * The strike zone is the same +-45 degrees of central meridian that decides
 * whether a CME counts as Earth-directed, so the tracker and the CME alert can
 * never disagree about whether something was aimed at us.
 */
export function regionTiming(
  longitudeWhenObserved: number,
  observedAtMs: number,
  atMs: number,
): RegionTiming {
  const longitude = longitudeAt(longitudeWhenObserved, observedAtMs, atMs);
  const daysTo = (target: number) => (target - longitude) / SOLAR_SYNODIC_DEG_PER_DAY;
  const edge = EARTH_DIRECTED_MAX_LONGITUDE;

  const inStrikeZone = Math.abs(longitude) <= edge;
  const strikeZonePassed = longitude > edge;

  return {
    longitude,
    daysToCentralMeridian: daysTo(0),
    daysToWestLimb: daysTo(LIMB),
    daysSinceEastLimb: (longitude - -LIMB) / SOLAR_SYNODIC_DEG_PER_DAY,
    inStrikeZone,
    daysToStrikeZone: longitude < -edge ? daysTo(-edge) : 0,
    daysLeftInStrikeZone: strikeZonePassed ? 0 : daysTo(edge),
    strikeZonePassed,
  };
}

/**
 * Heliographic positions along a region's path, for drawing its track.
 *
 * Returns the points rather than pixels, because the caller owns the disk
 * geometry and the projection. Points beyond the limb are included and flagged
 * so a track can fade out rather than stopping dead at the edge.
 */
export function rotationTrack(
  latitude: number,
  longitudeWhenObserved: number,
  observedAtMs: number,
  fromMs: number,
  toMs: number,
  stepHours = 6,
): { atMs: number; latitude: number; longitude: number; visible: boolean }[] {
  const out: { atMs: number; latitude: number; longitude: number; visible: boolean }[] = [];
  const step = stepHours * 3600000;
  if (step <= 0 || toMs < fromMs) return out;

  for (let t = fromMs; t <= toMs; t += step) {
    const longitude = longitudeAt(longitudeWhenObserved, observedAtMs, t);
    out.push({ atMs: t, latitude, longitude, visible: Math.abs(longitude) < LIMB });
  }
  return out;
}

export interface EarthDirectedRisk {
  /** Days the region still has pointed at us. */
  daysLeft: number;
  /** Chance of at least one M-class flare before it rotates out, percent. */
  mChance: number | null;
  /** Same for X-class. */
  xChance: number | null;
  level: 'none' | 'low' | 'moderate' | 'high' | 'severe';
  label: string;
  /** Beta-gamma-delta and friends: the configurations that actually flare. */
  complexField: boolean;
  /** Plain-English reasoning, for a tooltip. */
  note: string;
}

const pct = (n: number) => Math.round(n * 10) / 10;

/**
 * How much chance a region has to fire something at us before it turns away.
 *
 * NOAA publishes a daily probability of an M or X flare from each region. If
 * that probability held steady, the chance of at least one over N days is
 * 1 - (1 - p)^N. That is the number here. It genuinely does not hold steady -
 * regions grow and decay - so this is a way of reading NOAA's own figure over
 * the window that matters, not a forecast of its own.
 */
export function earthDirectedRisk(
  timing: RegionTiming,
  mProbability: number | null | undefined,
  xProbability: number | null | undefined,
  magneticClass?: string | null,
): EarthDirectedRisk {
  const cls = String(magneticClass ?? '').toUpperCase();
  const complexField = cls.includes('DELTA') || cls.includes('GAMMA');

  // Only the time still spent aimed at us counts.
  const daysLeft = Math.max(0, timing.inStrikeZone ? timing.daysLeftInStrikeZone : 0);

  if (timing.strikeZonePassed) {
    return {
      daysLeft: 0, mChance: null, xChance: null, level: 'none',
      label: 'Rotated past the strike zone',
      complexField,
      note: 'A CME from here would now be launched too far west to reach Earth head-on.',
    };
  }

  if (!timing.inStrikeZone) {
    return {
      daysLeft: 0, mChance: null, xChance: null, level: 'none',
      label: `Enters the strike zone in ${timing.daysToStrikeZone.toFixed(1)} days`,
      complexField,
      note: 'Still too far east for anything it launches to be aimed at us.',
    };
  }

  const chance = (daily: number | null | undefined) => {
    if (daily == null || !isFinite(daily) || daily <= 0) return null;
    const p = Math.min(1, daily / 100);
    return pct((1 - Math.pow(1 - p, daysLeft)) * 100);
  };

  const mChance = chance(mProbability);
  const xChance = chance(xProbability);

  // Driven by the X chance where there is one, since that is the class that
  // actually drives a big Earth-directed event.
  const driver = Math.max(xChance ?? 0, (mChance ?? 0) / 4);
  let level: EarthDirectedRisk['level'] = 'low';
  if (driver >= 40) level = 'severe';
  else if (driver >= 20) level = 'high';
  else if (driver >= 8) level = 'moderate';
  if (driver < 2 && !complexField) level = 'none';

  const label = level === 'none'
    ? 'Aimed at us, but quiet'
    : `${level[0].toUpperCase()}${level.slice(1)} chance while aimed at us`;

  const bits: string[] = [];
  if (mChance != null) bits.push(`${mChance}% chance of an M-class flare`);
  if (xChance != null) bits.push(`${xChance}% of an X-class`);
  const note = bits.length
    ? `${bits.join(' and ')} in the ${daysLeft.toFixed(1)} days it stays aimed at Earth, `
      + "compounded from NOAA's daily probability for this region."
      + (complexField ? ' Its magnetic field is complex, which is what usually does the flaring.' : '')
    : 'NOAA has not published flare probabilities for this region.';

  return { daysLeft, mChance, xChance, level, label, complexField, note };
}

// ── Growth ─────────────────────────────────────────────────────────────────

export interface RegionSnapshot {
  /** Day the snapshot describes, as an epoch ms. */
  atMs: number;
  area: number | null;
  spotCount: number | null;
  magneticClass?: string | null;
}

export interface GrowthSummary {
  /** Change in millionths of a hemisphere per day, over the window. */
  areaPerDay: number | null;
  spotsPerDay: number | null;
  /** Newest minus oldest. */
  areaChange: number | null;
  spotChange: number | null;
  days: number;
  phase: 'emerging' | 'growing fast' | 'growing' | 'steady' | 'decaying' | 'unknown';
  label: string;
  /** True when the magnetic class has changed over the window. */
  classChanged: boolean;
}

/**
 * Whether a region is still building or settling down.
 *
 * Rapid growth is one of the few genuinely useful flare precursors - a region
 * that doubled overnight is a different proposition from one the same size
 * that has sat there for a week - and NOAA's own three-state trend field does
 * not distinguish them. This needs day-to-day history, which no single NOAA
 * response carries, so it works off snapshots the worker keeps.
 */
export function growthSummary(history: RegionSnapshot[]): GrowthSummary {
  const points = [...history]
    .filter((h) => Number.isFinite(h.atMs))
    .sort((a, b) => a.atMs - b.atMs);

  const empty: GrowthSummary = {
    areaPerDay: null, spotsPerDay: null, areaChange: null, spotChange: null,
    days: 0, phase: 'unknown', label: 'Not enough history yet', classChanged: false,
  };
  if (points.length < 2) return empty;

  const first = points[0];
  const last = points[points.length - 1];
  const days = (last.atMs - first.atMs) / 86400000;
  if (days <= 0) return empty;

  const areaChange = first.area != null && last.area != null ? last.area - first.area : null;
  const spotChange = first.spotCount != null && last.spotCount != null
    ? last.spotCount - first.spotCount : null;
  const areaPerDay = areaChange != null ? areaChange / days : null;
  const spotsPerDay = spotChange != null ? spotChange / days : null;

  const classChanged = points.some(
    (p) => String(p.magneticClass ?? '').toUpperCase() !== String(last.magneticClass ?? '').toUpperCase(),
  );

  let phase: GrowthSummary['phase'] = 'unknown';
  let label = 'Holding steady';

  if (areaPerDay == null) {
    phase = 'unknown';
    label = 'No area history';
  } else if (points.length <= 2 && (first.area ?? 0) === 0 && (last.area ?? 0) > 0) {
    phase = 'emerging';
    label = 'Newly emerged';
  } else {
    // Relative to where it started, so a 20 MSH gain means something very
    // different on a 10 MSH region than on a 400 MSH one.
    const base = Math.max(10, first.area ?? 0);
    const rate = areaPerDay / base;
    if (rate >= 0.5) { phase = 'growing fast'; label = 'Growing fast'; }
    else if (rate >= 0.12) { phase = 'growing'; label = 'Growing'; }
    else if (rate <= -0.12) { phase = 'decaying'; label = 'Decaying'; }
    else { phase = 'steady'; label = 'Holding steady'; }
  }

  return { areaPerDay, spotsPerDay, areaChange, spotChange, days, phase, label, classChanged };
}

/** Which third of the disk something happened on. */
export type DiskZone = 'east limb' | 'earth strike zone' | 'west limb';

export interface DiskZoneReading {
  zone: DiskZone;
  /** The longitude it was read from, west positive. */
  longitude: number;
  /** A word for a badge. */
  label: string;
  /** What it means for us. */
  note: string;
}

/**
 * Where on the disk a flare went off, and whether that matters to us.
 *
 * A flare's X-rays arrive in eight minutes wherever it happened - the Sun does
 * not aim those. What the longitude decides is whether anything the flare
 * throws off comes our way. The same plus or minus 45 degrees the CME alert
 * uses is the strike zone here, so a flare described as being in the zone and
 * a CME described as Earth-directed always mean the same stretch of disk.
 *
 * West of the zone is not nothing: the Parker spiral connects Earth back to
 * around W60, so western flares are the ones that put protons here fastest
 * even when their CME misses. East of it is the other way round - whatever it
 * launches goes wide, but the region is turning toward us.
 */
export function diskZoneFor(longitude: number | null | undefined): DiskZoneReading | null {
  if (longitude == null || !Number.isFinite(longitude)) return null;
  const edge = EARTH_DIRECTED_MAX_LONGITUDE;

  if (longitude < -edge) {
    return {
      zone: 'east limb', longitude, label: 'East limb',
      note: 'Too far east for anything it launched to reach us, but the region is turning toward Earth.',
    };
  }
  if (longitude > edge) {
    return {
      zone: 'west limb', longitude, label: 'West limb',
      note: 'Past the strike zone, so a CME from here goes wide. Western flares are still the best connected '
          + 'to Earth along the Parker spiral, which is why they deliver protons fastest.',
    };
  }
  return {
    zone: 'earth strike zone', longitude, label: 'Earth strike zone',
    note: 'Aimed closely enough at Earth that a CME from this flare can reach us.',
  };
}
