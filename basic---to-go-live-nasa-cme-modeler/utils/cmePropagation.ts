// --- START OF FILE src/utils/cmePropagation.ts ---
//
// How far a CME has travelled, and when it gets here.
//
// This lives on its own because two places need the same answer: the 3D scene,
// which decides where to draw the cloud, and anything that states an arrival
// time in words. When each had its own copy of the maths they disagreed, and
// the cloud sailed past Earth while the caption still said it was on its way.
//
// The model is the one the visualisation has always used. A CME leaves at its
// launch speed and decelerates at a constant rate that depends on that speed,
// a = 1.41 - 0.0035u in m/s², so a slow one is nudged along and a fast one is
// dragged back hard. It stops decelerating once it is down to the ambient wind
// and coasts from there.

import { AU_IN_KM } from '../constants';

export const MIN_CME_SPEED_KMS = 300;

/** Distance travelled, in AU, after this many seconds. */
export function cmeDistanceAU(speedKms: number, timeSinceEventSeconds: number): number {
  const u_kms = speedKms;
  const t_s = Math.max(0, timeSinceEventSeconds);

  if (u_kms <= MIN_CME_SPEED_KMS) return (u_kms * t_s) / AU_IN_KM;

  const a_kms2 = (1.41 - 0.0035 * u_kms) / 1000.0;

  if (a_kms2 >= 0) return ((u_kms * t_s) + (0.5 * a_kms2 * t_s * t_s)) / AU_IN_KM;

  // Decelerating: it slows to the floor speed and then coasts.
  const time_to_floor_s = (MIN_CME_SPEED_KMS - u_kms) / a_kms2;
  if (t_s < time_to_floor_s) {
    return ((u_kms * t_s) + (0.5 * a_kms2 * t_s * t_s)) / AU_IN_KM;
  }
  const dist_decel = (u_kms * time_to_floor_s) + (0.5 * a_kms2 * time_to_floor_s * time_to_floor_s);
  const dist_coast = MIN_CME_SPEED_KMS * (t_s - time_to_floor_s);
  return (dist_decel + dist_coast) / AU_IN_KM;
}

/** How fast it is going after this many seconds. */
export function cmeSpeedAt(speedKms: number, timeSinceEventSeconds: number): number {
  const u_kms = speedKms;
  if (u_kms <= MIN_CME_SPEED_KMS) return u_kms;
  const a_kms2 = (1.41 - 0.0035 * u_kms) / 1000.0;
  if (a_kms2 >= 0) return u_kms + a_kms2 * Math.max(0, timeSinceEventSeconds);
  return Math.max(MIN_CME_SPEED_KMS, u_kms + a_kms2 * Math.max(0, timeSinceEventSeconds));
}

/**
 * When the front reaches a given distance, in seconds. Returns null if it never
 * gets there inside a fortnight. Same bisection the scene uses to work out its
 * own arrival times, so the two cannot drift apart.
 */
export function cmeTransitSeconds(speedKms: number, targetAU: number): number | null {
  let lo = 0, hi = 14 * 24 * 3600;
  if (cmeDistanceAU(speedKms, hi) < targetAU) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (cmeDistanceAU(speedKms, mid) < targetAU) lo = mid; else hi = mid;
  }
  return hi;
}
// --- END OF FILE src/utils/cmePropagation.ts ---
