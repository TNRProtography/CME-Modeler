// What counts as an Earth-directed CME, in one place.
//
// The app decides this in services/nasaService.ts to colour the CME list and
// aim the 3D model, and the push worker now decides it too, to send an alert.
// Two copies of a rule like "longitude within 45 degrees" drift the moment
// somebody tunes one of them, and the symptom would be an alert for a CME the
// app draws as a miss - or worse, silence for one it draws as a hit.
//
// The worker is pasted into the Cloudflare dashboard and cannot import this,
// so it carries its own copy and `npm run test:cme` fails if the two disagree.

/**
 * How far off the Sun-Earth line a CME can be launched and still be treated as
 * coming at us. DONKI reports longitude in degrees from central meridian, so
 * 0 is dead-on and +-45 is the usual working limit for "some of this will hit".
 */
export const EARTH_DIRECTED_MAX_LONGITUDE = 45;

export interface CmeAnalysisLike {
  speed?: number | null;
  longitude?: number | null;
  latitude?: number | null;
  halfAngle?: number | null;
  isMostAccurate?: boolean;
}

/**
 * The analysis to believe for a CME.
 *
 * DONKI publishes several analyses per event as the measurement is refined and
 * flags one as the most accurate. Take that one; fall back to the first only
 * when nothing is flagged, which happens on very fresh events.
 */
export function pickAnalysis<T extends CmeAnalysisLike>(analyses: T[] | null | undefined): T | null {
  if (!analyses || analyses.length === 0) return null;
  return analyses.find(a => a.isMostAccurate) ?? analyses[0];
}

/** Whether an analysis has the fields any of this depends on. */
export function isUsableAnalysis(a: CmeAnalysisLike | null): boolean {
  return !!a && a.speed != null && a.longitude != null && a.latitude != null;
}

/** Whether a CME analysis points close enough to Earth to matter. */
export function isEarthDirected(a: CmeAnalysisLike | null): boolean {
  if (!isUsableAnalysis(a)) return false;
  return Math.abs(a!.longitude as number) < EARTH_DIRECTED_MAX_LONGITUDE;
}

// ── The speed floor a subscriber sets ──────────────────────────────────────
// A CME is only worth waking someone for if it is fast enough to be worth
// their attention, and where that line sits is a matter of taste - a chaser
// who will drive two hours wants a lower bar than someone who only wants to
// hear about the big ones. So it is theirs to set.

export const CME_SPEED_MIN = 300;
export const CME_SPEED_MAX = 3000;
export const CME_SPEED_STEP = 50;
/** Roughly the point where a CME is fast enough to be interesting for aurora. */
export const CME_SPEED_DEFAULT = 700;

// ── Speed bands ────────────────────────────────────────────────────────────
// Plain words for a number, so a notification can say what 640 km/s actually
// means without the reader having to know the scale. The boundaries are the
// app's, and the worker carries the same ones - test:cme checks they match.

export const CME_SLOW_MAX   = 500;   // below this: slow
export const CME_MEDIUM_MAX = 800;   // below this: medium. At or above: fast.

export type CmeSpeedBand = 'slow' | 'medium' | 'fast';

export interface CmeSpeedBandInfo {
  band: CmeSpeedBand;
  label: string;
  /** One line for the notification body. */
  meaning: string;
  /** Longer wording for the settings screen. */
  detail: string;
}

export const CME_SPEED_BANDS: Record<CmeSpeedBand, CmeSpeedBandInfo> = {
  slow: {
    band: 'slow',
    label: 'Slow',
    meaning: 'Slow - below 500 km/s. Usually a glancing effect at most.',
    detail: 'Below 500 km/s. These arrive late and gently, and rarely amount to much on their own.',
  },
  medium: {
    band: 'medium',
    label: 'Medium',
    meaning: 'Medium - 500 to 800 km/s. Can still cause a good storm.',
    detail: '500 to 800 km/s. Not spectacular on paper, but these can still cause a good storm, especially if the field arrives southward.',
  },
  fast: {
    band: 'fast',
    label: 'Fast',
    meaning: 'Fast - above 800 km/s. The kind worth clearing an evening for.',
    detail: 'Above 800 km/s. The kind worth clearing an evening for.',
  },
};

/** Which band a CME speed falls into. */
export function cmeSpeedBand(speed: number): CmeSpeedBand {
  if (speed < CME_SLOW_MAX) return 'slow';
  if (speed < CME_MEDIUM_MAX) return 'medium';
  return 'fast';
}

/** Preset floors offered alongside the free-text box, one per band. */
export const CME_SPEED_PRESETS: { speed: number; label: string; note: string }[] = [
  { speed: CME_SPEED_MIN,   label: 'Everything', note: 'Every Earth-directed CME, including the slow ones.' },
  { speed: CME_SLOW_MAX,    label: 'Medium and up', note: CME_SPEED_BANDS.medium.detail },
  { speed: CME_MEDIUM_MAX,  label: 'Fast only',    note: CME_SPEED_BANDS.fast.detail },
  { speed: 1500,            label: 'Extreme only', note: 'Above 1500 km/s - the rare ones that make the news.' },
];

/** Clamp whatever a user typed into something the worker can rely on. */
export function clampCmeSpeed(value: unknown): number {
  // null and '' mean "never chose", not "as low as possible" - Number(null) is
  // 0, which would otherwise clamp to the minimum and opt someone in to
  // everything.
  if (value == null || value === '') return CME_SPEED_DEFAULT;
  const n = Math.round(Number(value));
  if (!isFinite(n)) return CME_SPEED_DEFAULT;
  return Math.min(CME_SPEED_MAX, Math.max(CME_SPEED_MIN, n));
}
