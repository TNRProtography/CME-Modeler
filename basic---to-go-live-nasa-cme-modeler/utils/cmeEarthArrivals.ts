// Which CMEs the CME Visualization has reaching Earth, when, and how big a
// storm each would be - for the 3-day forecast and the days card.
//
// "Reaching Earth" is the visualization's own picture: a CME counts if any of
// its particles would touch Earth. The scene draws each CME as a cloud around
// its launch direction whose widest reach, along its arc, is a fixed multiple
// of its cone (see CME_PARTICLE_REACH, from the same shape constants the
// scene builds the cloud with). So a CME can touch Earth if, when its front
// gets to 1 AU, Earth's direction - Earth having moved on along its orbit
// since the eruption - lies inside that widened cone.
//
// When: the moment the scene's own propagation (utils/cmePropagation) puts
// the front at 1 AU. How big: purely its speed, as the scene's aurora effect
// is - the launch speed DONKI gives, mapped onto a storm size.

import { cmeTransitSeconds } from './cmePropagation';
import { newellForKp } from './kpVisibility';
import { computeOvalBoundary } from './ovalPhysics';
import type { OutlookPoint } from './auroraOutlook';
import type { ProcessedCME } from '../types';

// ── The scene's CME shape, shared with components/SimulationCanvas ─────────
export const GCS_ARC_RADIUS_FRAC  = 0.55;
export const GCS_ARC_SPAN         = Math.PI * 0.85;
export const GCS_TUBE_RADIUS_FRAC = 0.52; // thicker cross-section for a bolder CME shape
export const GCS_AXIAL_DEPTH_FRAC = 0.38; // slightly deeper than before for teardrop body

/**
 * How far the particle cloud reaches from the CME's axis, as a multiple of
 * the cone's own half-width. The front arc spans GCS_ARC_SPAN at radius
 * GCS_ARC_RADIUS_FRAC, scaled so the cone's edge sits at the arc radius, and
 * each point of the arc carries a tube of particles that tapers towards the
 * arc's ends; the widest point of arc plus tube, over the arc radius, is it.
 */
export const CME_PARTICLE_REACH = (() => {
  const arcR = GCS_ARC_RADIUS_FRAC, tube = GCS_TUBE_RADIUS_FRAC * arcR, hs = GCS_ARC_SPAN / 2;
  let best = 0;
  for (let i = 0; i <= 1000; i++) {
    const t = (i / 1000) * hs;
    const taper = 0.25 + 0.75 * Math.pow(1 - t / hs, 1.9);
    best = Math.max(best, (arcR * Math.sin(t) + tube * taper) / arcR);
  }
  return best;
})();

const DAY = 86400000;
const HOUR = 3600000;
const EARTH_ORBIT_DEG_PER_DAY = 360 / 365.256;

/** How long a CME's storm lasts at Earth: full strength, then easing off. */
export const CME_FULL_MS = 12 * HOUR;
export const CME_EASE_MS = 12 * HOUR;

export interface CmeEarthArrival {
  id: string;
  launchMs: number;
  arrivalMs: number;
  /** Launch speed, km/s - what sets the storm's size. */
  speedKms: number;
  /** Angle between the CME's axis and Earth when it arrives, degrees. */
  offsetDeg: number;
  /** How far its particles reach from the axis, degrees. */
  reachDeg: number;
}

const toRad = (d: number) => d * Math.PI / 180;
const toDeg = (r: number) => r * 180 / Math.PI;

/** When and whether the visualization's CME touches Earth. Null if it never does. */
export function cmeEarthArrival(cme: Pick<ProcessedCME, 'id' | 'startTime' | 'speed' | 'longitude' | 'latitude' | 'halfAngle'>): CmeEarthArrival | null {
  const launchMs = cme.startTime.getTime();
  if (!Number.isFinite(launchMs) || !(cme.speed > 0)) return null;
  const transitSec = cmeTransitSeconds(cme.speed, 1);
  if (transitSec == null) return null;
  const arrivalMs = launchMs + transitSec * 1000;

  // Earth has moved on along its orbit, the same way the scene's longitudes run.
  const earthMovedDeg = EARTH_ORBIT_DEG_PER_DAY * (arrivalMs - launchMs) / DAY;
  const lat = toRad(Number.isFinite(cme.latitude) ? cme.latitude : 0);
  const lon = toRad((Number.isFinite(cme.longitude) ? cme.longitude : 0) - earthMovedDeg);
  const offsetDeg = toDeg(Math.acos(Math.max(-1, Math.min(1, Math.cos(lat) * Math.cos(lon)))));
  const half = Math.max(1, Math.min(89, Number.isFinite(cme.halfAngle) ? cme.halfAngle : 30));
  const reachDeg = toDeg(Math.atan(CME_PARTICLE_REACH * Math.tan(toRad(half))));
  if (offsetDeg > reachDeg) return null;
  return { id: cme.id, launchMs, arrivalMs, speedKms: cme.speed, offsetDeg, reachDeg };
}

/**
 * How big a storm a CME of this speed makes, as the coupling that drives the
 * oval - on the same scale as everything else (utils/kpVisibility). A 400
 * km/s CME is a minor storm, 650 a G1, 900 a G2, 1150 a G3, 1400 a G4 and
 * 1650 and up the largest.
 */
export function stormNewellForSpeed(speedKms: number): number {
  const level = Math.max(4, Math.min(9, 4 + (speedKms - 400) / 250));
  return newellForKp(level);
}

/** The storm's strength at a moment, 0 to 1: full for a while, then easing off. */
export function cmeStormFraction(a: CmeEarthArrival, atMs: number): number {
  const since = atMs - a.arrivalMs;
  if (since < 0 || since > CME_FULL_MS + CME_EASE_MS) return 0;
  if (since <= CME_FULL_MS) return 1;
  return 1 - (since - CME_FULL_MS) / CME_EASE_MS;
}

/** Hour by hour, the oval the arriving CMEs would drive - the strongest at each hour. */
export function cmeOutlook(arrivals: CmeEarthArrival[], fromMs: number, toMs: number): OutlookPoint[] {
  const out: OutlookPoint[] = [];
  for (let t = fromMs; t <= toMs; t += HOUR) {
    let newell = 0;
    for (const a of arrivals) newell = Math.max(newell, stormNewellForSpeed(a.speedKms) * cmeStormFraction(a, t));
    if (newell <= 0) continue;
    const boundary = computeOvalBoundary({ newell_avg_60m: newell, newell_avg_30m: newell }, false, new Date(t));
    out.push({
      atMs: t, boundaryLikely: boundary, boundaryBest: boundary,
      couplingLikely: newell, couplingBest: newell, source: 'modelled', disturbance: 'CME sheath',
    });
  }
  return out;
}
