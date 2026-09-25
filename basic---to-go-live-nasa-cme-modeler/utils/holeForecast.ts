// What the Coronal Hole Tracker forecasts for one hole: its speed at Earth,
// whether its stream reaches us at all, when, and what the sky will make of
// it. One function, used by the tracker and by "What to expect in the next
// couple of days", so the two cannot disagree about which holes are coming.
//
// They used to. The days card read the combined forecast timeline, which
// only counts an arrival when the modelled wind rises a set amount above
// where it is now, and is built on the server from whatever detection was
// last published - so a hole the tracker had arriving tomorrow could be
// missing from it. The tracker is the one that looks at each hole, so it is
// the one that decides.

import { estimateHssSpeedFromChWidthAndDarkness } from './solarWindModel';
import {
  chEarthConnection, chGrowth, chSpeedForEarth, chTiming, hssArrivalMs, type ChSample,
} from './coronalHoleDynamics';
import { sectorSeasonNote, type ChPolarityResult } from './coronalHolePolarity';
import { buildChTracks, chDisappearance, type ChTrack, type TrackedHole } from './chTracking';
import { framesForTracking, type ChStoreState } from './chDetectionStore';
import { solarDiskOrientation } from './solarEphemeris';
import { bestSkyWithin, skyConditionsAt, visibilityOutlook } from './skyConditions';
import { buildOutlook } from './auroraOutlook';
import { auroraGeometryAt } from './auroraVisibility';
import { buildForecastTimeline } from './forecastTimeline';
import { hssArrivalEnsemble, measurementConfidence } from './arrivalEnsemble';
import { bySignForPolarity, rmWindows, windowsDuring } from './rmWindows';

const DAY_MS = 86400000;

export interface HoleForecastOptions {
  nowMs: number;
  /** The newest detection frame, for telling a hole that has gone from one missed once. */
  latestFrameMs: number;
  /** Read from the magnetogram, when it has been. */
  polarity: ChPolarityResult | null;
  latitude: number;
  longitude: number;
}

export function forecastHole(track: ChTrack<TrackedHole>, o: HoleForecastOptions) {
  const now = o.nowMs;
  const latest = track.latest;

  const samples: ChSample[] = track.points.map((p) => ({
    atMs: p.atMs, widthDeg: p.hole.widthDeg, darkness: p.hole.darkness, longitude: p.hole.lon,
  }));

  const timing = chTiming(latest.lon, track.lastSeenMs, now);
  const choice = chSpeedForEarth(samples, estimateHssSpeedFromChWidthAndDarkness);
  const growth = chGrowth(samples);

  const centralMeridianMs = now + timing.daysToCentralMeridian * DAY_MS;

  // How well this hole is actually measured, which is what the spread
  // should respond to. A hole seen fifty times while it crossed the middle
  // of the disk is a different proposition from one glimpsed once near the
  // limb, and a fixed plus-or-minus cannot say so.
  const closestToMeridian = samples.length > 0
    ? samples.reduce((a, b) => (Math.abs(a) <= Math.abs(b.longitude) ? a : b.longitude), 180)
    : 90;
  const spanHours = samples.length > 1
    ? (samples[samples.length - 1].atMs - samples[0].atMs) / 3600000
    : 0;
  const confidence = measurementConfidence(samples.length, spanHours, closestToMeridian);

  // Whether the stream can reach Earth at all. A hole over a pole crosses
  // the middle of the disk exactly like an equatorial one and sends its wind
  // straight over the top of us; forecasting an arrival for it would mean a
  // near-permanent stream that never comes, since polar holes are the Sun's
  // normal state for most of the cycle.
  const { b0 } = solarDiskOrientation(new Date(now));
  const connection = chEarthConnection(latest.lat, b0);

  const ensemble = choice.speedKms != null && connection.reachesEarth
    ? hssArrivalEnsemble({ centralMeridianMs, speedKms: choice.speedKms, confidence })
    : null;
  const arrival = !connection.reachesEarth ? null
    : ensemble ? ensemble.medianMs
    : (choice.speedKms != null ? hssArrivalMs(choice.speedKms, centralMeridianMs) : null);

  const pol = o.polarity;
  const season = pol ? sectorSeasonNote(pol.sector, new Date(now)) : null;
  const gone = chDisappearance(track, now, o.latestFrameMs || track.lastSeenMs);

  // The whole arrival window, not the nominal moment: the Moon sets and
  // twilight ends inside seven hours, so the best part of it is often not
  // the middle.
  const windowFromMs = arrival == null ? null : ensemble ? ensemble.p10Ms : arrival - 7 * 3600000;
  const windowToMs = arrival == null ? null : ensemble ? ensemble.p90Ms : arrival + 7 * 3600000;

  // A stream arrives into a sky, and the sky costs more than the difference
  // between a moderate stream and a fast one. A full Moon overhead, or the
  // Sun already up, and there is nothing to see however good the wind is.
  let arrivalSky: ReturnType<typeof skyConditionsAt> | null = null;
  let outlook: ReturnType<typeof visibilityOutlook> | null = null;
  let bestCaseOutlook: ReturnType<typeof visibilityOutlook> | null = null;
  let windows: ReturnType<typeof rmWindows> = [];
  if (arrival != null && windowFromMs != null && windowToMs != null) {
    const from = windowFromMs;
    const to = windowToMs;
    const sky = bestSkyWithin(from, to, o.latitude, o.longitude)
      ?? skyConditionsAt(arrival, o.latitude, o.longitude);
    arrivalSky = sky;

    // Through the real chain - stream, coupling, oval boundary, latitude -
    // rather than a formula of its own. Speed alone does not make a display:
    // without southward field a fast stream is a bright patch on a camera and
    // nothing to the eye.
    const bySign = pol ? bySignForPolarity(pol.polarity) : null;
    if (bySign) {
      windows = windowsDuring(
        rmWindows(bySign, from - 12 * 3600000, to + 2 * DAY_MS, { byMagnitudeNt: 6 }),
        from, to + 2 * DAY_MS,
      );
    }

    const streamTimeline = buildForecastTimeline([], [{
      id: track.key,
      centralMeridianMs,
      peakSpeedKms: choice.speedKms ?? 400,
      widthDeg: latest.widthDeg,
      bySign,
      earthConnection: connection.factor,
    }], { fromMs: from - 6 * 3600000, toMs: to + 3 * DAY_MS, stepMs: 3600000 });

    const chainOutlook = buildOutlook(streamTimeline);
    const atArrival = chainOutlook.reduce((a, b) =>
      (Math.abs(a.atMs - sky.atMs) <= Math.abs(b.atMs - sky.atMs) ? a : b));

    const strengthOf = (boundary: number) =>
      auroraGeometryAt(boundary, sky.atMs, o.latitude, o.longitude).strength;
    outlook = visibilityOutlook(strengthOf(atArrival.boundaryLikely), sky);
    bestCaseOutlook = visibilityOutlook(strengthOf(atArrival.boundaryBest), sky);
  }

  return {
    timing, choice, growth, centralMeridianMs, arrival, windowFromMs, windowToMs, samples, pol, season, gone,
    latest, arrivalSky, outlook, bestCaseOutlook, windows, ensemble, confidence, connection,
  };
}

export type HoleForecast = ReturnType<typeof forecastHole>;

// ── polarity, shared ──────────────────────────────────────────────────────
// Polarity is read from the magnetogram's pixels by the tracker, which is
// real work. The days card reuses the tracker's reading rather than doing it
// again, and grades a hole without it - as the tracker does before its
// reading is in - when there is none.

const POLARITY_KEY = 'sta_ch_polarity_v1';
/** A reading older than this is for a disk that has turned too far. */
const POLARITY_MAX_AGE_MS = 12 * 3600000;

interface SharedPolarity { atMs: number; byHoleId: Record<string, ChPolarityResult> }
let sharedPolarity: SharedPolarity | null = null;

export function publishHolePolarity(atMs: number, byHoleId: Record<string, ChPolarityResult>): void {
  sharedPolarity = { atMs, byHoleId };
  try { localStorage.setItem(POLARITY_KEY, JSON.stringify(sharedPolarity)); } catch { /* memory copy only */ }
}

export function readHolePolarity(nowMs = Date.now()): SharedPolarity | null {
  if (!sharedPolarity) {
    try {
      const raw = localStorage.getItem(POLARITY_KEY);
      if (raw) sharedPolarity = JSON.parse(raw) as SharedPolarity;
    } catch { /* none */ }
  }
  return sharedPolarity && nowMs - sharedPolarity.atMs < POLARITY_MAX_AGE_MS ? sharedPolarity : null;
}

/**
 * A track's polarity from a reading of one detection. Only if the track was
 * in that detection: hole ids are numbered afresh in every frame, so an id
 * alone would hand a hole that has gone the polarity of whichever hole now
 * has its number.
 */
export function polarityForTrack(
  track: ChTrack<TrackedHole>,
  byHoleId: Record<string, ChPolarityResult>,
  atMs: number | null,
): ChPolarityResult | null {
  const last = track.points[track.points.length - 1];
  if (atMs == null || !last || last.atMs !== atMs) return null;
  return byHoleId[track.latest.id] ?? null;
}

/** The tracker's tracks, from the shared detection store. */
export const tracksFromStore = (state: ChStoreState) => buildChTracks(framesForTracking(state));

/**
 * Every hole the tracker has reaching Earth within the horizon - live, or
 * gone round the limb or closed with its stream already on the way, exactly
 * as the tracker shows them. "Within" means its arrival window overlaps the
 * horizon, so a stream landing now still counts. Soonest first.
 */
export function holesDueWithin(
  tracks: ChTrack<TrackedHole>[],
  o: Omit<HoleForecastOptions, 'polarity'> & {
    horizonMs: number;
    polarityOf: (track: ChTrack<TrackedHole>) => ChPolarityResult | null;
  },
): { track: ChTrack<TrackedHole>; forecast: HoleForecast }[] {
  return tracks
    .map((track) => ({ track, forecast: forecastHole(track, { ...o, polarity: o.polarityOf(track) }) }))
    .filter(({ forecast: f }) => f.arrival != null && f.windowFromMs != null && f.windowToMs != null
      && f.windowToMs >= o.nowMs && f.windowFromMs <= o.nowMs + o.horizonMs)
    .sort((a, b) => (a.forecast.arrival as number) - (b.forecast.arrival as number));
}
