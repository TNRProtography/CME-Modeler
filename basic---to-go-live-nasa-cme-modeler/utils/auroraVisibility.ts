// Where the aurora is, and what somebody standing at a given place can see of
// it. One model, used by every surface that answers that question: the next
// couple of hours card, the next couple of days card, the sightings map and
// its forecast frames, the coronal hole tracker, and the push notifications
// (which get a generated copy - see scripts/sync-visibility.mjs).
//
// THE CHAIN
// ─────────
//   1. The oval's equatorward edge near magnetic midnight, from the solar
//      wind (computeOvalBoundary in ovalPhysics). Its base law,
//      -(65.5 - newell/1800), matches the published midnight-sector fits
//      (about 66 degrees quiet, moving roughly two degrees per Kp).
//   2. Where that edge sits at the viewer's magnetic local time. The oval is
//      furthest from the pole around magnetic midnight and pulls back toward
//      it through the evening and morning.
//   3. How far away aurora can still be seen: the viewline. It grows with
//      activity, because a stronger display is brighter and reaches higher
//      into the atmosphere, where it can be seen from further off.
//   4. The viewer's own magnetic latitude, in the same corrected geomagnetic
//      coordinates the oval relations are fitted in (AACGM), not the tilted
//      dipole. Over New Zealand the two differ by about 3.5 degrees.
//   5. A strength on the app's published 0-100 scale, which the sky (moon,
//      twilight) then cuts down: see visibilityOutlook in skyConditions.
//
// All latitudes here are southern and negative.

import { AACGM_GRID } from './aacgmGrid';
import { computeOvalBoundary } from './ovalPhysics';
import { sunPosition, greenwichSiderealDegrees } from './skyConditions';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ─── Magnetic latitude ──────────────────────────────────────────────────────

/** IGRF-13 north dipole pole, geographic. */
const POLE_LAT = 80.65;
const POLE_LON = -72.68;

/** Magnetic latitude from the tilted dipole alone. */
export function dipoleLatitude(latitude: number, longitude: number): number {
  const pl = POLE_LAT * D2R;
  const sin = Math.sin(latitude * D2R) * Math.sin(pl)
    + Math.cos(latitude * D2R) * Math.cos(pl) * Math.cos((longitude - POLE_LON) * D2R);
  return Math.asin(Math.max(-1, Math.min(1, sin))) * R2D;
}

const G = AACGM_GRID;
const LAT_MAX = G.lat0 + G.rows - 1;
const LON_MAX = G.lon0 + G.cols - 1;

/** Degrees east in [0, 360). */
const east = (lon: number) => ((lon % 360) + 360) % 360;

function gridAt(latitude: number, lonEast: number): number {
  const fi = latitude - G.lat0;
  const fj = lonEast - G.lon0;
  const i0 = Math.max(0, Math.min(G.rows - 2, Math.floor(fi)));
  const j0 = Math.max(0, Math.min(G.cols - 2, Math.floor(fj)));
  const ti = Math.max(0, Math.min(1, fi - i0));
  const tj = Math.max(0, Math.min(1, fj - j0));
  const v = (i: number, j: number) => G.values[i * G.cols + j];
  return ((v(i0, j0) * (1 - ti) + v(i0 + 1, j0) * ti) * (1 - tj)
    + (v(i0, j0 + 1) * (1 - ti) + v(i0 + 1, j0 + 1) * ti) * tj) / 100;
}

/**
 * Magnetic latitude in corrected geomagnetic coordinates (AACGM-v2, at the
 * 110 km height the aurora is seen at).
 *
 * Exact to a few thousandths of a degree over Australia and New Zealand,
 * where the table is. Outside it, the dipole plus the table's correction at
 * its nearest edge, fading out over twenty degrees, so a map line drawn
 * across the edge stays continuous rather than jumping.
 */
export function magneticLatitude(latitude: number, longitude: number): number {
  const lonE = east(longitude);
  const insideLon = lonE >= G.lon0 && lonE <= LON_MAX;
  if (insideLon && latitude >= G.lat0 && latitude <= LAT_MAX) return gridAt(latitude, lonE);

  const edgeLat = Math.max(G.lat0, Math.min(LAT_MAX, latitude));
  let edgeLon = lonE;
  let lonOutside = 0;
  if (!insideLon) {
    const below = (G.lon0 - lonE + 360) % 360;
    const above = (lonE - LON_MAX + 360) % 360;
    if (below < above) { edgeLon = G.lon0; lonOutside = below; } else { edgeLon = LON_MAX; lonOutside = above; }
  }
  const latOutside = latitude > LAT_MAX ? latitude - LAT_MAX : 0;
  const fade = Math.max(0, 1 - lonOutside / 20) * Math.max(0, 1 - latOutside / 20);
  const correction = gridAt(edgeLat, edgeLon) - dipoleLatitude(edgeLat, edgeLon);
  return dipoleLatitude(latitude, longitude) + correction * fade;
}

/**
 * The geographic latitude along a meridian where the magnetic latitude is
 * `mlat`, for drawing magnetic lines on a map. Southern hemisphere only.
 */
export function geographicLatitudeFor(mlat: number, longitude: number): number {
  let lo = -89.5;
  let hi = -0.5;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (magneticLatitude(mid, longitude) < mlat) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

// ─── Magnetic local time ────────────────────────────────────────────────────

/** Longitude of a point about the dipole axis, degrees. */
function dipoleLongitude(latitude: number, longitude: number): number {
  const pl = POLE_LAT * D2R;
  const plo = POLE_LON * D2R;
  const z = [Math.cos(pl) * Math.cos(plo), Math.cos(pl) * Math.sin(plo), Math.sin(pl)];
  const yLen = Math.hypot(z[1], z[0]);
  const y = [-z[1] / yLen, z[0] / yLen, 0];
  const x = [y[1] * z[2] - y[2] * z[1], y[2] * z[0] - y[0] * z[2], y[0] * z[1] - y[1] * z[0]];
  const p = [
    Math.cos(latitude * D2R) * Math.cos(longitude * D2R),
    Math.cos(latitude * D2R) * Math.sin(longitude * D2R),
    Math.sin(latitude * D2R),
  ];
  const px = p[0] * x[0] + p[1] * x[1] + p[2] * x[2];
  const py = p[0] * y[0] + p[1] * y[1] + p[2] * y[2];
  return Math.atan2(py, px) * R2D;
}

/**
 * Magnetic local time, hours: the viewer's magnetic longitude measured from
 * the Sun's, so 0 is magnetic midnight. Dipole-based, which agrees with
 * AACGM to within half an hour over New Zealand in every season - well
 * inside how broad the oval's day-night shape is.
 */
export function magneticLocalTime(atMs: number, latitude: number, longitude: number): number {
  const date = new Date(atMs);
  const sun = sunPosition(date);
  const subsolarLon = sun.ra - greenwichSiderealDegrees(date);
  const diff = dipoleLongitude(latitude, longitude) - dipoleLongitude(sun.dec, subsolarLon);
  return (((12 + diff / 15) % 24) + 24) % 24;
}

// ─── The oval ───────────────────────────────────────────────────────────────

/** Where the oval reaches furthest from the pole, hours MLT. */
export const MLT_OF_WIDEST_OVAL = 23.5;
/** How much further poleward the edge sits at noon than at midnight. */
export const NOON_POLEWARD_SHIFT_DEG = 4;

/**
 * How far poleward of its midnight position the equatorward edge sits at a
 * given magnetic local time. Zero near magnetic midnight, about a third of a
 * degree at 9pm, one to two degrees at dusk and dawn.
 */
export function mltPolewardShiftDeg(mlt: number): number {
  const phase = ((mlt - MLT_OF_WIDEST_OVAL) / 24) * 2 * Math.PI;
  return NOON_POLEWARD_SHIFT_DEG * (1 - Math.cos(phase)) / 2;
}

/** The equatorward edge at a given MLT, from its midnight-sector position. */
export function boundaryAtMlt(boundaryMidnight: number, mlt: number): number {
  return boundaryMidnight - mltPolewardShiftDeg(mlt);
}

/** The quiet-time edge and the furthest the oval physics lets it come. */
export const QUIET_BOUNDARY = -65.5;
export const STORM_BOUNDARY = -44;

/**
 * How active the oval is, 0 quiet to 1 as far as it goes, read from how far
 * its midnight edge has moved. One measure for every surface, so none of
 * them needs a separate score to decide how far aurora can be seen.
 */
export function activityFromBoundary(boundaryMidnight: number): number {
  return Math.max(0, Math.min(1,
    (Math.abs(QUIET_BOUNDARY) - Math.abs(boundaryMidnight)) / (Math.abs(QUIET_BOUNDARY) - Math.abs(STORM_BOUNDARY))));
}

/**
 * The viewline: how many degrees equatorward of the oval's edge aurora can
 * still be seen low on the horizon. Nine degrees on a quiet night - ordinary
 * green aurora at 110 km drops below the horizon about ten degrees away -
 * rising to twenty five in the strongest storms, when tall red aurora
 * reaches 400 km and can be seen from much further off.
 */
export function viewlineReachDeg(boundaryMidnight: number): number {
  return 9 + 16 * activityFromBoundary(boundaryMidnight);
}

/**
 * How strong the aurora is for a viewer, on the app's published scale:
 * 80+ go outside now, 65 naked eye, 50 a faint glow to the eye from a dark
 * spot, 35 phone night mode, 20 long exposure only, below that nothing.
 *
 * The oval's equatorward edge is the faint outer limit of the aurora, not
 * where the bright display is - that sits poleward of it. So having the edge
 * straight overhead is a distinct naked-eye display rather than the best
 * there is: 75 on a quiet night, rising to 90 in the strongest storms, when
 * the same geometry comes with far more energy behind it. The edge well
 * past you, toward the equator, takes it the rest of the way to 100 over
 * four degrees.
 *
 * Between the edge and the viewline it falls to 20 along a power of 1.5,
 * and past the viewline to nothing over two degrees. The shape is set so
 * that typical New Zealand nights come out as chasers know them: a Kp 5
 * storm a naked-eye display from Southland and a faint glow from
 * Canterbury, a Kp 7 storm reaching the North Island, a quiet night a long
 * exposure from the far south and nothing elsewhere.
 *
 * This is the strength before the sky: moonlight and twilight come off it in
 * visibilityOutlook.
 */
export function strengthFromGeometry(
  boundaryHere: number,
  viewerMlat: number,
  reachDeg: number,
  activity: number,
): number {
  const peak = 75 + 15 * Math.max(0, Math.min(1, activity));
  const distance = Math.abs(boundaryHere) - Math.abs(viewerMlat);
  if (distance <= 0) return peak + (100 - peak) * Math.min(1, -distance / 4);
  if (distance >= reachDeg) return Math.max(0, 20 * (1 - (distance - reachDeg) / 2));
  const inside = 1 - distance / reachDeg;
  return 20 + (peak - 20) * Math.pow(inside, 1.5);
}

/** Everything a surface needs to know about one place at one moment. */
export interface AuroraGeometry {
  mlt: number;
  viewerMlat: number;
  /** The oval's equatorward edge at this MLT. */
  boundary: number;
  /** The viewline's magnetic latitude at this MLT. */
  viewline: number;
  reachDeg: number;
  /** 0-100, before the sky. */
  strength: number;
}

export function auroraGeometryAt(
  boundaryMidnight: number,
  atMs: number,
  latitude: number,
  longitude: number,
  viewerMlat: number = magneticLatitude(latitude, longitude),
): AuroraGeometry {
  const mlt = magneticLocalTime(atMs, latitude, longitude);
  const boundary = boundaryAtMlt(boundaryMidnight, mlt);
  const reachDeg = viewlineReachDeg(boundaryMidnight);
  return {
    mlt,
    viewerMlat,
    boundary,
    viewline: boundary + reachDeg,
    reachDeg,
    strength: strengthFromGeometry(boundary, viewerMlat, reachDeg, activityFromBoundary(boundaryMidnight)),
  };
}

/**
 * A score that was worked out without knowing where the viewer is - the
 * Spot The Aurora score - brought down for somebody beyond the viewline, by
 * the same geometry everything else uses. Inside the viewline it stands.
 */
export function scoreAtLocation(
  score: number,
  boundaryMidnight: number,
  atMs: number,
  latitude: number,
  longitude: number,
): number {
  const g = auroraGeometryAt(boundaryMidnight, atMs, latitude, longitude);
  const beyond = Math.abs(g.boundary) - Math.abs(g.viewerMlat) - g.reachDeg;
  if (beyond <= 0) return score;
  return score * Math.max(0, 1 - beyond / 2);
}

// ─── The solar wind that is actually on its way ─────────────────────────────

/** Sun-Earth L1 to the bow shock, near enough, km. */
export const L1_DISTANCE_KM = 1.5e6;

/** One solar wind reading at L1, at the time it was measured there. */
export interface L1Sample {
  atMs: number;
  speedKms: number;
  /** Newell coupling, raw units (a few thousand when quiet). */
  newell: number | null;
  pressureNPa: number | null;
  by: number | null;
  bz: number | null;
}

/** When a reading measured at L1 gets to Earth, at its own speed. */
export const arrivalMs = (s: L1Sample): number => s.atMs + (L1_DISTANCE_KM / s.speedKms) * 1000;

/**
 * Merge the app's separate L1 series into readings. Every reading needs a
 * speed to know when it arrives; a reading without one borrows the last
 * speed measured before it.
 */
export function mergeL1Series(series: {
  speed: { x: number; y: number }[];
  newell?: { x: number; y: number }[];
  pressure?: { x: number; y: number }[];
  magnetic?: { time: number; by?: number | null; bz?: number | null }[];
}): L1Sample[] {
  const byTime = new Map<number, L1Sample>();
  const get = (t: number) => {
    let s = byTime.get(t);
    if (!s) { s = { atMs: t, speedKms: NaN, newell: null, pressureNPa: null, by: null, bz: null }; byTime.set(t, s); }
    return s;
  };
  for (const p of series.speed) if (p.y > 0) get(p.x).speedKms = p.y;
  for (const p of series.newell ?? []) if (Number.isFinite(p.y)) get(p.x).newell = p.y;
  for (const p of series.pressure ?? []) if (Number.isFinite(p.y)) get(p.x).pressureNPa = p.y;
  for (const p of series.magnetic ?? []) {
    const s = get(p.time);
    if (p.by != null && Number.isFinite(p.by)) s.by = p.by;
    if (p.bz != null && Number.isFinite(p.bz)) s.bz = p.bz;
  }
  const out = [...byTime.values()].sort((a, b) => a.atMs - b.atMs);
  let lastSpeed = NaN;
  for (const s of out) {
    if (Number.isFinite(s.speedKms)) lastSpeed = s.speedKms; else s.speedKms = lastSpeed;
  }
  return out.filter((s) => Number.isFinite(s.speedKms) && s.speedKms > 0);
}

/** The solar wind driving the oval at one moment, from readings already taken. */
export interface WindAtEarth {
  newell60: number;
  newell30: number;
  pressure30: number | null;
  by30: number | null;
  bz: number | null;
  /**
   * How much of the last half hour before the moment has actually been
   * measured, 0-1. Under 1 when the moment is so far ahead that the newest
   * reading will not have arrived by then.
   */
  coverage: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * The wind reaching Earth up to `atMs`, shifted from L1 by each reading's own
 * travel time. The oval responds to the coupling over the preceding hour, so
 * that is the window. Null when nothing measured reaches Earth in the last
 * half hour before the moment - there is no real wind to speak of then.
 */
export function windAtEarth(samples: L1Sample[], atMs: number): WindAtEarth | null {
  const arrived = samples.map((s) => ({ s, t: arrivalMs(s) }));
  const in60 = arrived.filter((a) => a.t > atMs - 3600000 && a.t <= atMs);
  const in30 = in60.filter((a) => a.t > atMs - 1800000);
  const newell30 = mean(in30.map((a) => a.s.newell).filter((v): v is number => v != null));
  if (newell30 == null) return null;
  const newell60 = mean(in60.map((a) => a.s.newell).filter((v): v is number => v != null)) ?? newell30;
  // Measured all the way to the moment if anything arrives at or after it.
  const newestArrival = arrived.reduce((m, a) => Math.max(m, a.t), -Infinity);
  const span = newestArrival - (atMs - 1800000);
  const latest = in30.reduce((a, b) => (b.t > a.t ? b : a));
  return {
    newell60,
    newell30,
    pressure30: mean(in30.map((a) => a.s.pressureNPa).filter((v): v is number => v != null)),
    by30: mean(in30.map((a) => a.s.by).filter((v): v is number => v != null)),
    bz: latest.s.bz,
    coverage: Math.max(0, Math.min(1, span / 1800000)),
  };
}

/**
 * The oval's midnight-sector edge at `atMs`, from the wind measured at L1
 * that has reached, or will have reached, Earth by then. Null past the point
 * the measurements reach.
 */
export function realWindBoundary(
  samples: L1Sample[],
  atMs: number,
  bayOnset = false,
): { boundary: number; wind: WindAtEarth } | null {
  const wind = windAtEarth(samples, atMs);
  if (!wind) return null;
  const boundary = computeOvalBoundary({
    newell_avg_60m: wind.newell60,
    newell_avg_30m: wind.newell30,
    avg_30m_pressure_nPa: wind.pressure30,
    by: wind.by30,
    bz: wind.bz,
  }, bayOnset, new Date(atMs));
  return { boundary, wind };
}
