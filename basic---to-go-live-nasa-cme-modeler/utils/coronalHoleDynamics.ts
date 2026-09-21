// What a coronal hole is about to do to the wind at Earth.
//
// A sunspot region matters because of what it might launch. A coronal hole
// matters because of what is already streaming out of it: open field lines let
// the wind escape fast, and a few days after the hole crosses the middle of
// the disk that stream arrives here. So the questions are different - not "will
// it go off" but "when does it get here, and how fast".
//
// The detector reports a hole's longitude in Stonyhurst, west positive, the
// same convention NOAA uses for sunspots. Zero means facing Earth now.

import { SOLAR_SYNODIC_DEG_PER_DAY, longitudeAt } from './solarDisk';
import type { CoronalHole } from './coronalHoleData';

/** One AU, in km. The distance the stream has to cover. */
const AU_KM = 149597870.7;

export interface ChTiming {
  /** Where it is now, west positive. */
  longitude: number;
  /** Negative once it has passed the middle of the disk. */
  daysToCentralMeridian: number;
  /** True while it is still on the visible disk. */
  onDisk: boolean;
  /** True once it has crossed the meridian: its stream is on the way. */
  facingEarthOrPast: boolean;
}

export function chTiming(
  longitudeWhenObserved: number,
  observedAtMs: number,
  atMs: number,
): ChTiming {
  const longitude = longitudeAt(longitudeWhenObserved, observedAtMs, atMs);
  return {
    longitude,
    daysToCentralMeridian: (0 - longitude) / SOLAR_SYNODIC_DEG_PER_DAY,
    onDisk: Math.abs(longitude) < 90,
    facingEarthOrPast: longitude >= 0,
  };
}

/**
 * When the stream from a hole reaches Earth.
 *
 * Treated as a straight run from the moment the hole crossed the middle of the
 * disk: that is the part of it pointing at us, and the wind leaving then is
 * the wind that arrives here. At 400 km/s that is about four and a half days,
 * at 700 about two and a half, which is where the usual "two to four days
 * after central meridian passage" rule of thumb comes from.
 *
 * It is a rough arrival, not a forecast. Real streams are broadened by the
 * hole's own width and slowed where they plough into slower wind ahead.
 */
export function hssArrivalMs(speedKms: number, centralMeridianMs: number): number | null {
  if (!isFinite(speedKms) || speedKms <= 0) return null;
  return centralMeridianMs + (AU_KM / speedKms) * 1000;
}

export interface ChSample {
  atMs: number;
  widthDeg: number;
  darkness: number;
  /** Longitude when this sample was taken, west positive. */
  longitude: number;
  areaDeg2?: number | null;
}

export interface ChSpeedChoice {
  speedKms: number | null;
  /** The sample the speed was taken from. */
  usedAtMs: number | null;
  basis: 'earth-facing' | 'latest' | 'none';
  note: string;
}

/**
 * Pick which measurement of a hole to believe for the speed at Earth.
 *
 * A hole is foreshortened near the limb - the same hole measures narrower at
 * 70 degrees west than it does head on - so its width is only honest near the
 * middle of the disk. And the wind that reaches Earth is the wind that left
 * while it was pointing at us.
 *
 * So: once a hole has reached or passed the middle of the disk, use the sample
 * taken closest to that crossing. Before it gets there, there is no such
 * sample yet, so use the most recent one and say that is what it is.
 */
export function chSpeedForEarth(
  samples: ChSample[],
  estimate: (widthDeg: number, darkness: number) => number,
): ChSpeedChoice {
  const usable = samples
    .filter((s) => Number.isFinite(s.atMs) && Number.isFinite(s.widthDeg) && s.widthDeg > 0)
    .sort((a, b) => a.atMs - b.atMs);

  if (usable.length === 0) {
    return { speedKms: null, usedAtMs: null, basis: 'none', note: 'No usable measurements of this hole yet.' };
  }

  const latest = usable[usable.length - 1];

  // Has it reached the middle of the disk at any point we have a measurement
  // for? Only the newest sample can answer that: if the latest one is still
  // east of centre the hole has not got there yet.
  if (latest.longitude >= 0) {
    // The measurement closest to dead centre, which is where the width is
    // truest - and that can be the last one taken just *before* the crossing
    // rather than the first one after it, so this looks at all of them.
    const best = usable.reduce((a, b) => (Math.abs(a.longitude) <= Math.abs(b.longitude) ? a : b));
    return {
      speedKms: Math.round(estimate(best.widthDeg, best.darkness)),
      usedAtMs: best.atMs,
      basis: 'earth-facing',
      note: `Measured ${best.widthDeg.toFixed(0)}° wide ${Math.abs(best.longitude) < 15 ? 'as it faced Earth' : 'near the middle of the disk'}, `
          + 'which is where a hole is least foreshortened and the wind that reaches us leaves from.',
    };
  }

  return {
    speedKms: Math.round(estimate(latest.widthDeg, latest.darkness)),
    usedAtMs: latest.atMs,
    basis: 'latest',
    note: `Still ${Math.abs(latest.longitude).toFixed(0)}° east of facing us, so this uses the latest `
        + 'measurement. It is foreshortened from here and will firm up as the hole turns toward us.',
  };
}

export interface ChGrowth {
  widthPerDay: number | null;
  widthChange: number | null;
  days: number;
  phase: 'opening' | 'opening fast' | 'steady' | 'closing' | 'unknown';
  label: string;
}

/** Whether a hole is opening up or closing over the samples we have. */
export function chGrowth(samples: ChSample[]): ChGrowth {
  const points = [...samples]
    .filter((s) => Number.isFinite(s.atMs) && Number.isFinite(s.widthDeg))
    .sort((a, b) => a.atMs - b.atMs);

  const none: ChGrowth = {
    widthPerDay: null, widthChange: null, days: 0, phase: 'unknown',
    label: 'Not enough measurements yet',
  };
  if (points.length < 2) return none;

  const first = points[0];
  const last = points[points.length - 1];
  const days = (last.atMs - first.atMs) / 86400000;
  if (days <= 0) return none;

  const widthChange = last.widthDeg - first.widthDeg;
  const widthPerDay = widthChange / days;
  // Relative to its own size, so a 5 degree gain reads differently on a small
  // hole than on one spanning a third of the disk.
  const rate = widthPerDay / Math.max(5, first.widthDeg);

  let phase: ChGrowth['phase'] = 'steady';
  let label = 'Holding steady';
  if (rate >= 0.25) { phase = 'opening fast'; label = 'Opening fast'; }
  else if (rate >= 0.08) { phase = 'opening'; label = 'Opening'; }
  else if (rate <= -0.08) { phase = 'closing'; label = 'Closing'; }

  return { widthPerDay, widthChange, days, phase, label };
}

/**
 * A hole's outline in Stonyhurst degrees at some other moment.
 *
 * The polygon the detector gives is relative to the centroid, so the whole
 * outline rotates with the hole and only the centroid's longitude has to move.
 */
export function chOutlineAt(
  hole: Pick<CoronalHole, 'lat' | 'lon' | 'polygon' | 'widthDeg' | 'heightDeg'>,
  observedAtMs: number,
  atMs: number,
): { lat: number; lon: number }[] {
  const lon = longitudeAt(hole.lon, observedAtMs, atMs);

  if (hole.polygon && hole.polygon.length >= 3) {
    return hole.polygon.map((p) => ({ lat: hole.lat + p.lat, lon: lon + p.lon }));
  }

  // No polygon: an ellipse from the width and height, which is what the 3D
  // scene falls back to as well.
  const a = (hole.widthDeg ?? 15) / 2;
  const b = (hole.heightDeg ?? hole.widthDeg ?? 15) / 2;
  const out: { lat: number; lon: number }[] = [];
  for (let i = 0; i < 36; i++) {
    const t = (i / 36) * Math.PI * 2;
    out.push({ lat: hole.lat + b * Math.sin(t), lon: lon + a * Math.cos(t) });
  }
  return out;
}
