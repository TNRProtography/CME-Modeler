// The part of a coronal hole's forecast that needs no sky and no browser:
// when it faces Earth, how fast its stream is, whether that stream can reach
// us at all, and when it arrives. The tracker builds on it (utils/holeForecast)
// and the forecast worker runs it on the shared 90-day record, so the app and
// the server forecast a hole the same way.

import { estimateHssSpeedFromChWidthAndDarkness } from './solarWindModel';
import { chEarthConnection, chSpeedForEarth, chTiming, type ChSample } from './coronalHoleDynamics';
import { solarDiskOrientation } from './solarEphemeris';
import { hssArrivalEnsemble, measurementConfidence } from './arrivalEnsemble';
import type { ChTrack, TrackedHole } from './chTracking';

const DAY_MS = 86400000;

export function holeStream(track: ChTrack<TrackedHole>, nowMs: number) {
  const latest = track.latest;
  const samples: ChSample[] = track.points.map((p) => ({
    atMs: p.atMs, widthDeg: p.hole.widthDeg, darkness: p.hole.darkness, longitude: p.hole.lon,
  }));
  const timing = chTiming(latest.lon, track.lastSeenMs, nowMs);
  const choice = chSpeedForEarth(samples, estimateHssSpeedFromChWidthAndDarkness);
  const centralMeridianMs = nowMs + timing.daysToCentralMeridian * DAY_MS;

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
  // straight over the top of us.
  const { b0 } = solarDiskOrientation(new Date(nowMs));
  const connection = chEarthConnection(latest.lat, b0);

  const ensemble = choice.speedKms != null && connection.reachesEarth
    ? hssArrivalEnsemble({ centralMeridianMs, speedKms: choice.speedKms, confidence })
    : null;

  return { latest, samples, timing, choice, centralMeridianMs, confidence, connection, ensemble };
}

export type HoleStream = ReturnType<typeof holeStream>;
