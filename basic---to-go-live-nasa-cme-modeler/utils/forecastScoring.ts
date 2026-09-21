// Marking our own homework, against what actually turned up.
//
// Every number this app forecasts carries a confidence that I chose. The
// ensemble derives its spread from the inputs, which is better than asserting
// one, but it still rests on my guesses about how uncertain those inputs are.
// The only way to replace a guess with a fact is to write the forecast down,
// wait, and compare.
//
// So each forecast is stored when it is made, and scored once the arrival
// window has passed. That gives three things nothing else can:
//
//   - a real error bar, measured rather than assumed;
//   - a check on whether the 80% band actually contains 80% of arrivals,
//     which is the difference between an honest interval and a decorative one;
//   - grounds to change the model, since a bias shows up as a median error
//     that is not zero.
//
// It is also worth showing people. "Our last twenty arrivals: median error
// 5.2 hours" earns more trust than any interval asserted up front, and it is
// the one claim here that cannot be talked up.

export interface StoredForecast {
  id: string;
  /** When the forecast was made - not when it was for. */
  issuedAtMs: number;
  /** Which hole or CME it came from. */
  sourceId: string;
  kind: 'HSS' | 'CME';
  predictedArrivalMs: number;
  /** The ensemble's 80% band. */
  p10Ms: number;
  p90Ms: number;
  predictedSpeedKms: number;
}

export interface WindSample {
  atMs: number;
  speedKms: number | null;
}

export interface DetectedArrival {
  atMs: number;
  peakSpeedKms: number;
  baselineSpeedKms: number;
}

/**
 * Find a stream arriving in real L1 data.
 *
 * A high speed stream shows up as a sustained rise, not a spike: the speed
 * climbs over several hours and stays up for a day or more. Looking for the
 * single fastest sample would catch every bit of noise in the feed, so this
 * wants a running mean to clear a baseline and then stay clear.
 *
 * Deliberately conservative. A missed arrival leaves a forecast unscored,
 * which costs a data point. A false one scores a forecast against something
 * that never happened, which corrupts the record - and a corrupted track
 * record is worse than no track record, because it is believed.
 */
export function detectArrival(
  samples: WindSample[],
  searchFromMs: number,
  searchToMs: number,
  options: { riseKms?: number; meanHours?: number; sustainHours?: number } = {},
): DetectedArrival | null {
  const { riseKms = 80, meanHours = 3, sustainHours = 8 } = options;

  const usable = samples
    .filter((s) => Number.isFinite(s.atMs) && s.speedKms != null && Number.isFinite(s.speedKms))
    .sort((a, b) => a.atMs - b.atMs) as { atMs: number; speedKms: number }[];
  if (usable.length < 8) return null;

  const meanMs = meanHours * 3600000;
  const runningMean = (atMs: number): number | null => {
    const window = usable.filter((s) => s.atMs > atMs - meanMs && s.atMs <= atMs);
    if (window.length === 0) return null;
    return window.reduce((sum, s) => sum + s.speedKms, 0) / window.length;
  };

  // Baseline: the quietest stretch in the day before the search window, which
  // is what the stream has to rise above.
  const before = usable.filter((s) => s.atMs >= searchFromMs - 86400000 && s.atMs < searchFromMs);
  const baselinePool = before.length > 0 ? before : usable.slice(0, Math.max(1, Math.floor(usable.length / 4)));
  const baseline = baselinePool.reduce((min, s) => Math.min(min, s.speedKms), Infinity);
  if (!Number.isFinite(baseline)) return null;

  const threshold = baseline + riseKms;

  for (const sample of usable) {
    if (sample.atMs < searchFromMs || sample.atMs > searchToMs) continue;
    const mean = runningMean(sample.atMs);
    if (mean == null || mean < threshold) continue;

    // It has to stay up. A single excursion is not an arrival.
    const sustainUntil = sample.atMs + sustainHours * 3600000;
    const later = usable.filter((s) => s.atMs > sample.atMs && s.atMs <= sustainUntil);
    if (later.length < 3) continue;
    const heldUp = later.filter((s) => s.speedKms >= baseline + riseKms * 0.6).length / later.length;
    if (heldUp < 0.7) continue;

    const afterward = usable.filter((s) => s.atMs >= sample.atMs && s.atMs <= sample.atMs + 3 * 86400000);
    return {
      atMs: sample.atMs,
      peakSpeedKms: Math.max(...afterward.map((s) => s.speedKms)),
      baselineSpeedKms: baseline,
    };
  }

  return null;
}

export interface ForecastScore {
  forecastId: string;
  sourceId: string;
  kind: StoredForecast['kind'];
  /** Positive means it arrived later than forecast. */
  arrivalErrorHours: number;
  /** Positive means it was faster than forecast. */
  speedErrorKms: number;
  /** Whether the truth landed inside the 80% band. */
  insideBand: boolean;
  observedArrivalMs: number;
  observedPeakSpeedKms: number;
}

export function scoreForecast(forecast: StoredForecast, observed: DetectedArrival): ForecastScore {
  return {
    forecastId: forecast.id,
    sourceId: forecast.sourceId,
    kind: forecast.kind,
    arrivalErrorHours: (observed.atMs - forecast.predictedArrivalMs) / 3600000,
    speedErrorKms: observed.peakSpeedKms - forecast.predictedSpeedKms,
    insideBand: observed.atMs >= forecast.p10Ms && observed.atMs <= forecast.p90Ms,
    observedArrivalMs: observed.atMs,
    observedPeakSpeedKms: observed.peakSpeedKms,
  };
}

export interface TrackRecord {
  scored: number;
  /** Typical error regardless of direction. */
  medianAbsErrorHours: number;
  /** Signed, so a consistent bias is visible rather than averaged away. */
  medianErrorHours: number;
  medianAbsSpeedErrorKms: number;
  /**
   * How often the truth fell inside the 80% band.
   *
   * This is the honest one. Far below 0.8 and the bands are too narrow and
   * should not be trusted; far above and they are padded, which is its own
   * kind of dishonesty.
   */
  bandHitRate: number;
  /** What the numbers actually support saying. */
  summary: string;
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

export function buildTrackRecord(scores: ForecastScore[]): TrackRecord {
  if (scores.length === 0) {
    return {
      scored: 0, medianAbsErrorHours: 0, medianErrorHours: 0,
      medianAbsSpeedErrorKms: 0, bandHitRate: 0,
      summary: 'No forecasts have been scored yet. This fills in as streams arrive and are compared '
             + 'against what the spacecraft at L1 actually measured.',
    };
  }

  const absErrors = scores.map((s) => Math.abs(s.arrivalErrorHours));
  const signedErrors = scores.map((s) => s.arrivalErrorHours);
  const hitRate = scores.filter((s) => s.insideBand).length / scores.length;
  const medianAbs = median(absErrors);
  const medianSigned = median(signedErrors);

  const bias = Math.abs(medianSigned) < 2 ? ''
    : medianSigned > 0
      ? ` Streams have been arriving about ${medianSigned.toFixed(1)} hours later than forecast, which is a bias worth correcting rather than noise.`
      : ` Streams have been arriving about ${Math.abs(medianSigned).toFixed(1)} hours earlier than forecast, which is a bias worth correcting rather than noise.`;

  // Only comment on the band once there is enough to comment on. A hit rate
  // from four forecasts says nothing, and saying it anyway is the sort of
  // false precision this whole exercise exists to avoid.
  const bandNote = scores.length < 8
    ? ' Too few so far to say whether the uncertainty band is the right width.'
    : hitRate < 0.6
      ? ` Only ${Math.round(hitRate * 100)}% landed inside the 80% band, so the bands are too narrow and should be read as optimistic.`
      : hitRate > 0.95
        ? ` ${Math.round(hitRate * 100)}% landed inside the 80% band, which means the bands are wider than they need to be.`
        : ` ${Math.round(hitRate * 100)}% landed inside the 80% band, which is about right.`;

  return {
    scored: scores.length,
    medianAbsErrorHours: medianAbs,
    medianErrorHours: medianSigned,
    medianAbsSpeedErrorKms: median(scores.map((s) => Math.abs(s.speedErrorKms))),
    bandHitRate: hitRate,
    summary: `Last ${scores.length} arrival${scores.length === 1 ? '' : 's'}: `
           + `median error ${medianAbs.toFixed(1)} hours.${bias}${bandNote}`,
  };
}

/** Forecasts whose window has passed and which are therefore ready to mark. */
export function dueForScoring(forecasts: StoredForecast[], nowMs = Date.now()): StoredForecast[] {
  return forecasts.filter((f) => nowMs > f.p90Ms + 12 * 3600000);
}
