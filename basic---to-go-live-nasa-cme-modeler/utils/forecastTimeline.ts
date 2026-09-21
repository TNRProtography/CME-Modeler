// One timeline of what the solar wind is doing at Earth, past and future.
//
// The app already turns observed L1 data into an aurora nowcast. Everything
// needed for a forecast is the same chain with modelled numbers fed into it
// instead of measured ones - so rather than build a forecast beside the
// nowcast, this builds one array spanning both and lets every view read it.
// Past entries are observation, future entries are model, and each one says
// which it is.
//
// WHAT IS ACTUALLY FORECASTABLE
// ─────────────────────────────
// Ranked by how much of it is worth believing:
//
//   Speed     - good. Drag for CMEs, width and darkness for streams.
//   Density   - the SHAPE is good, the magnitude is not. This is the
//               counterintuitive one: density DROPS inside a fast stream and
//               SPIKES in the compression ahead of it. Getting that ordering
//               right matters more than any particular number of protons.
//   Bt        - fair. In a compression it rises roughly with the speed
//               gradient, which is something we are already computing.
//   Bz        - not forecastable, and this module does not pretend. What it
//               gives is the Russell-McPherron projection of the sector's By,
//               which is a real, computable expectation - and separately the
//               fluctuation amplitude, which is not predictable in sign at
//               all. They are kept in different fields for that reason.
//
// A forecast that quoted a single Bz would be the most useful-looking and
// least honest number on the screen.

import { rmSouthwardPerNt, type BySign } from './rmWindows';

const AU_KM = 149597870.7;
const HOUR = 3600000;
export const SOLAR_SYNODIC_DEG_PER_DAY = 360 / 27.2753;

export type DisturbanceKind = 'ambient' | 'SIR' | 'HSS' | 'CME sheath' | 'CME ejecta';

export interface L1State {
  atMs: number;
  speedKms: number;
  densityCm3: number;
  /** Total field strength. */
  btNt: number;
  /**
   * The southward field the sector geometry actually implies, which is a
   * computable expectation rather than a guess at Bz.
   */
  bzFromSectorNt: number;
  /**
   * How much the field is expected to swing about, in nT. The SIGN of those
   * swings is not forecastable at any useful range, which is exactly why this
   * is an amplitude and not a value.
   */
  bzFluctuationNt: number;
  source: 'observed' | 'modelled';
  disturbance: DisturbanceKind;
  disturbanceId?: string;
}

export interface ObservedSample {
  atMs: number;
  speedKms: number | null;
  densityCm3: number | null;
  btNt: number | null;
  bzNt: number | null;
}

export interface StreamSource {
  id: string;
  /** When the hole's centre crossed the middle of the disk. */
  centralMeridianMs: number;
  /** Peak speed the stream should reach at 1 AU. */
  peakSpeedKms: number;
  /** The hole's angular width, which sets how long it blows at us. */
  widthDeg: number;
  /** Sector sign from the hole's polarity, when it could be measured. */
  bySign?: BySign | null;
  /**
   * How much of this stream is aimed at Earth's latitude, 0 to 1.
   *
   * A hole over a pole can cross the middle of the disk and still send its
   * wind over the top of us. See chEarthConnection - without this, polar
   * holes, which are the Sun's normal state for most of the cycle, forecast a
   * near-permanent stream that never arrives.
   */
  earthConnection?: number;
}

export interface TimelineOptions {
  fromMs: number;
  toMs: number;
  stepMs?: number;
  /** Background wind when nothing else is happening. */
  ambientSpeedKms?: number;
  ambientDensityCm3?: number;
  ambientBtNt?: number;
}

const AMBIENT_SPEED = 380;
const AMBIENT_DENSITY = 5;
const AMBIENT_BT = 5;

/**
 * How long a hole blows at Earth.
 *
 * Not an instant. A fifty degree hole is pointed at us for nearly four days
 * as it crosses, which is why streams have a long rise, a plateau and a slow
 * decay instead of a front. Treating emission as a moment is what makes a
 * modelled stream look like a CME.
 */
export function emissionWindowMs(widthDeg: number): number {
  const days = Math.max(6, widthDeg) / SOLAR_SYNODIC_DEG_PER_DAY;
  return days * 86400000;
}

/** The state a stream contributes at a moment, or null if it is not there yet. */
export function streamStateAt(stream: StreamSource, atMs: number, ambientSpeed: number): {
  speedKms: number; densityCm3: number; btNt: number; kind: DisturbanceKind;
} | null {
  const transitMs = (AU_KM / Math.max(200, stream.peakSpeedKms)) * 1000;
  const onset = stream.centralMeridianMs + transitMs;
  const blowing = emissionWindowMs(stream.widthDeg);

  // The compression rides ahead of the stream: slow wind piled up by fast
  // wind catching it. Density peaks HERE, not in the stream itself.
  const sirLeadMs = 16 * HOUR;
  const since = atMs - onset;

  if (since < -sirLeadMs || since > blowing + 48 * HOUR) return null;

  const gradient = Math.max(0, stream.peakSpeedKms - ambientSpeed);

  if (since < 0) {
    // Stream interaction region. Speed climbing, density and field both
    // enhanced by the compression.
    const phase = (since + sirLeadMs) / sirLeadMs;          // 0 -> 1
    const compression = 1 + 2.4 * Math.sin(phase * Math.PI / 2) * (gradient / 250);
    return {
      speedKms: ambientSpeed + gradient * 0.35 * phase,
      densityCm3: AMBIENT_DENSITY * Math.max(1, compression),
      btNt: AMBIENT_BT * Math.max(1, compression),
      kind: 'SIR',
    };
  }

  if (since <= blowing) {
    // The stream proper: fast, rarefied, field back to something ordinary.
    const phase = since / Math.max(1, blowing);
    const speed = stream.peakSpeedKms - gradient * 0.35 * phase * phase;
    return {
      speedKms: speed,
      // The counterintuitive part. Fast wind is THIN.
      densityCm3: AMBIENT_DENSITY * (0.35 + 0.25 * phase),
      btNt: AMBIENT_BT * (1.5 - 0.4 * phase),
      kind: 'HSS',
    };
  }

  // Rarefaction behind it, decaying back to ambient.
  const decay = (since - blowing) / (48 * HOUR);
  return {
    speedKms: stream.peakSpeedKms - gradient * (0.65 + 0.35 * decay),
    densityCm3: AMBIENT_DENSITY * (0.6 + 0.4 * decay),
    btNt: AMBIENT_BT * (1.1 - 0.1 * decay),
    kind: 'HSS',
  };
}

function resample(observed: ObservedSample[], atMs: number, toleranceMs: number): ObservedSample | null {
  let best: ObservedSample | null = null;
  let bestGap = toleranceMs;
  for (const sample of observed) {
    const gap = Math.abs(sample.atMs - atMs);
    if (gap <= bestGap) { bestGap = gap; best = sample; }
  }
  return best;
}

/**
 * The whole timeline: observation where it exists, model where it does not.
 *
 * Observation always wins. A modelled value for a moment already measured is
 * not a forecast, it is a worse copy of the truth.
 */
export function buildForecastTimeline(
  observed: ObservedSample[],
  streams: StreamSource[],
  options: TimelineOptions,
): L1State[] {
  const {
    fromMs, toMs,
    stepMs = HOUR,
    ambientSpeedKms = AMBIENT_SPEED,
    ambientDensityCm3 = AMBIENT_DENSITY,
    ambientBtNt = AMBIENT_BT,
  } = options;

  if (!(toMs > fromMs) || !(stepMs > 0)) return [];
  if ((toMs - fromMs) / stepMs > 5000) return [];

  const nowMs = Date.now();
  const out: L1State[] = [];

  for (let t = fromMs; t <= toMs; t += stepMs) {
    const measurement = t <= nowMs ? resample(observed, t, stepMs) : null;

    if (measurement && measurement.speedKms != null) {
      out.push({
        atMs: t,
        speedKms: measurement.speedKms,
        densityCm3: measurement.densityCm3 ?? ambientDensityCm3,
        btNt: measurement.btNt ?? ambientBtNt,
        // Measured Bz is a fact, so it goes in as one with no fluctuation
        // band around it.
        bzFromSectorNt: measurement.bzNt ?? 0,
        bzFluctuationNt: 0,
        source: 'observed',
        disturbance: 'ambient',
      });
      continue;
    }

    let speed = ambientSpeedKms;
    let density = ambientDensityCm3;
    let bt = ambientBtNt;
    let kind: DisturbanceKind = 'ambient';
    let id: string | undefined;
    let bySign: BySign | null = null;
    let strongest = 0;

    for (const stream of streams) {
      const connection = stream.earthConnection ?? 1;
      if (connection <= 0.01) continue;
      const raw = streamStateAt(stream, t, ambientSpeedKms);
      if (!raw) continue;
      // A glancing stream delivers a weaker version of the same structure.
      const contribution = connection >= 0.99 ? raw : {
        ...raw,
        speedKms: ambientSpeedKms + (raw.speedKms - ambientSpeedKms) * connection,
        densityCm3: ambientDensityCm3 + (raw.densityCm3 - ambientDensityCm3) * connection,
        btNt: ambientBtNt + (raw.btNt - ambientBtNt) * connection,
      };
      // The fastest thing present wins the point. Two streams overlapping is
      // real, but adding their speeds together is not.
      const excess = contribution.speedKms - ambientSpeedKms;
      if (excess <= strongest) continue;
      strongest = excess;
      speed = contribution.speedKms;
      density = contribution.densityCm3;
      bt = contribution.btNt;
      kind = contribution.kind;
      id = stream.id;
      bySign = stream.bySign ?? null;
    }

    // The sector's contribution to southward field, which IS computable: the
    // tilt of Earth's field decides how much of By it feels, and that tilt is
    // known for any moment. By itself is roughly the field's transverse part.
    const byMagnitude = bt * 0.6;
    const bzFromSector = bySign
      ? -byMagnitude * rmSouthwardPerNt(bySign, new Date(t))
      : 0;

    out.push({
      atMs: t,
      speedKms: speed,
      densityCm3: density,
      btNt: bt,
      bzFromSectorNt: bzFromSector,
      // Alfvenic swings scale with the field. Their sign is not forecastable,
      // so only the size is offered.
      // Alfvenic swings scale with the field, but only a fraction of the
      // amplitude is southward at any moment and less of it stays southward
      // long enough to matter. Taking the full swing as an upper bound made
      // every ordinary night look like a possible display.
      bzFluctuationNt: bt * (kind === 'HSS' ? 0.4 : 0.25),
      source: 'modelled',
      disturbance: kind,
      disturbanceId: id,
    });
  }

  return out;
}

/** Stretches where something other than ambient wind is expected. */
export interface DisturbanceSpan {
  kind: DisturbanceKind;
  id?: string;
  startMs: number;
  endMs: number;
  peakSpeedKms: number;
}

export function disturbanceSpans(timeline: L1State[]): DisturbanceSpan[] {
  const spans: DisturbanceSpan[] = [];
  let open: DisturbanceSpan | null = null;

  for (const point of timeline) {
    if (point.disturbance === 'ambient') {
      if (open) { spans.push(open); open = null; }
      continue;
    }
    if (open && open.kind === point.disturbance && open.id === point.disturbanceId) {
      open.endMs = point.atMs;
      open.peakSpeedKms = Math.max(open.peakSpeedKms, point.speedKms);
    } else {
      if (open) spans.push(open);
      open = {
        kind: point.disturbance,
        id: point.disturbanceId,
        startMs: point.atMs,
        endMs: point.atMs,
        peakSpeedKms: point.speedKms,
      };
    }
  }
  if (open) spans.push(open);
  return spans;
}
