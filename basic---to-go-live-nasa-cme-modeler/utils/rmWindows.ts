// When a given interplanetary field direction is actually geoeffective.
//
// THE POINT
// ─────────
// A coronal hole's polarity fixes the sign of By in the stream it sends us:
// positive polarity gives an away sector with By pointing east, negative a
// toward sector with By pointing west. That sign does not change for the days
// the stream takes to pass.
//
// What does change, every single day, is how much of that By the Earth's
// field experiences as SOUTHWARD field. The geomagnetic dipole is tilted, and
// that tilt sweeps round once per rotation, so the projection of the Sun's
// equatorial field onto the dipole rises and falls on a 24-hour cycle - on top
// of the annual cycle that makes the equinoxes stormy.
//
// Which means a stream that is geoeffective at all is geoeffective at
// PARTICULAR HOURS of particular nights, and those hours can be worked out
// before it arrives. For somebody deciding whether to drive an hour to a dark
// site at 2am, that is a completely different product from "a stream arrives
// on Thursday".
//
// It also takes the sting out of an imprecise arrival. A stream lasts three to
// five days and the window comes round every night inside that, so the good
// nights can be named without knowing the arrival to the hour.
//
// THE ARITHMETIC
// ──────────────
// From rmEffect: Bz_eff = Bz·cos(beta) − By·sin(beta), where beta is the angle
// between the GSEQ and GSM frames and carries both the daily and the seasonal
// variation. The second term is the Russell-McPherron contribution. It is
// southward - which is what drives reconnection - when −By·sin(beta) < 0, so
// an away sector (By > 0) needs sin(beta) > 0 and a toward sector needs
// sin(beta) < 0. The two are half a year apart, which is exactly why away
// sectors favour September and toward sectors March.

import { rmAngles } from './rmEffect';

/** By sign: +1 away sector (positive polarity hole), -1 toward. */
export type BySign = 1 | -1;

/**
 * How many nT of southward field each nT of |By| contributes, right now.
 *
 * Zero when the projection is the wrong way round - a northward contribution
 * is not a small southward one, and averaging the two together would wash out
 * the whole effect.
 */
export function rmSouthwardPerNt(bySign: BySign, at: Date): number {
  const beta = rmAngles(at).beta * Math.PI / 180;
  // The By term in Bz_eff is -By*sin(beta), and southward means negative, so
  // the term helps when By*sin(beta) is positive. Per nT of |By| that is
  // bySign*sin(beta), floored at zero because a northward contribution is not
  // a small southward one.
  return Math.max(0, bySign * Math.sin(beta));
}

/**
 * The largest value rmSouthwardPerNt reaches on the day containing `at`.
 *
 * Used to judge a window against what is actually available that day rather
 * than against a fixed number: a mediocre peak in June is still that day's
 * best, and calling it "no window" would be wrong.
 */
export function rmDailyPeak(bySign: BySign, at: Date, stepMinutes = 15): number {
  const start = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  let peak = 0;
  for (let m = 0; m < 1440; m += stepMinutes) {
    peak = Math.max(peak, rmSouthwardPerNt(bySign, new Date(start + m * 60000)));
  }
  return peak;
}

export interface RmWindow {
  startMs: number;
  endMs: number;
  /** When the projection is strongest inside this window. */
  peakMs: number;
  /** Southward nT per nT of |By| at the peak. */
  peakPerNt: number;
  /** Expected southward nT at the peak, when a |By| is supplied. */
  peakSouthwardNt: number | null;
}

export interface RmWindowOptions {
  /** How much of |By| has to become southward to count. */
  minPerNt?: number;
  /**
   * Or, as a share of that day's own best. Whichever threshold is higher
   * wins, so a genuinely flat day yields nothing rather than a nominal window.
   */
  minShareOfDailyPeak?: number;
  stepMinutes?: number;
  /** A typical |By| in the stream, to turn the coefficient into nT. */
  byMagnitudeNt?: number | null;
}

/**
 * Every stretch in a range where the projection favours this By sign.
 *
 * Returned as absolute times. Turning them into "11pm to 3am on Thursday" is
 * the caller's business - this module has no opinion about time zones.
 */
export function rmWindows(
  bySign: BySign,
  fromMs: number,
  toMs: number,
  options: RmWindowOptions = {},
): RmWindow[] {
  const {
    minPerNt = 0.12,
    minShareOfDailyPeak = 0.6,
    stepMinutes = 10,
    byMagnitudeNt = null,
  } = options;

  if (!(toMs > fromMs)) return [];
  const step = stepMinutes * 60000;
  // A long range at a fine step is a lot of trigonometry for no extra
  // resolution; the window edges are soft to begin with.
  if ((toMs - fromMs) / step > 20000) return [];

  const windows: RmWindow[] = [];
  let open: { startMs: number; peakMs: number; peakPerNt: number } | null = null;
  const dailyPeaks = new Map<number, number>();

  for (let t = fromMs; t <= toMs; t += step) {
    const at = new Date(t);
    const dayKey = Math.floor(t / 86400000);
    if (!dailyPeaks.has(dayKey)) dailyPeaks.set(dayKey, rmDailyPeak(bySign, at));
    const threshold = Math.max(minPerNt, (dailyPeaks.get(dayKey) ?? 0) * minShareOfDailyPeak);

    const value = rmSouthwardPerNt(bySign, at);
    if (value >= threshold) {
      if (!open) open = { startMs: t, peakMs: t, peakPerNt: value };
      else if (value > open.peakPerNt) { open.peakMs = t; open.peakPerNt = value; }
    } else if (open) {
      windows.push(close(open, t - step, byMagnitudeNt));
      open = null;
    }
  }
  if (open) windows.push(close(open, toMs, byMagnitudeNt));

  return windows;
}

function close(
  open: { startMs: number; peakMs: number; peakPerNt: number },
  endMs: number,
  byMagnitudeNt: number | null,
): RmWindow {
  return {
    startMs: open.startMs,
    endMs,
    peakMs: open.peakMs,
    peakPerNt: open.peakPerNt,
    peakSouthwardNt: byMagnitudeNt != null && Number.isFinite(byMagnitudeNt)
      ? Math.abs(byMagnitudeNt) * open.peakPerNt
      : null,
  };
}

/** Which windows overlap a stream that is actually present. */
export function windowsDuring(windows: RmWindow[], fromMs: number, toMs: number): RmWindow[] {
  return windows.filter((w) => w.endMs >= fromMs && w.startMs <= toMs);
}

/**
 * The sign of By a coronal hole of a given polarity sends us.
 *
 * Positive polarity is field pointing out of the Sun, which is an away sector
 * and By east, so positive in GSM.
 */
export function bySignForPolarity(polarity: 'positive' | 'negative' | string): BySign | null {
  if (polarity === 'positive') return 1;
  if (polarity === 'negative') return -1;
  return null;
}
