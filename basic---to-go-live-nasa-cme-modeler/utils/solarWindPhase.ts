// --- START OF FILE src/utils/solarWindPhase.ts ---
//
// Solar-wind structure classifier.
//
// Answers "what kind of solar wind are we actually sitting in right now?" from
// the L1 plasma + magnetic field feed, and says how sure it is.
//
// The previous version of this lived as an if/else chain inside ForecastCharts
// and fell through to "Wake / Recovery Transition" whenever nothing matched,
// which is why that label appeared almost permanently. Real solar wind
// structures overlap and contradict each other, so this scores every candidate
// against its published signatures and reports the best fit plus a confidence,
// rather than taking the first branch that happens to be true.
//
// WHAT WE CAN AND CANNOT SEE
// --------------------------
// The feed gives speed, density, proton temperature, Bt/Bx/By/Bz, the field
// azimuth (`angle` = atan2(By,Bx)) and the clock angle. It does NOT give the
// alpha-to-proton ratio or suprathermal electron pitch angles, which are the
// two textbook ICME discriminators. Without them, CME-family calls rest on
// plasma beta, the temperature deficit and field rotation - good, but never
// certain. Confidence is capped accordingly so the UI never overclaims.
//
// Every threshold below is annotated with where it comes from.

export type SolarWindPhaseId =
  | 'shock'
  | 'icme-sheath'
  | 'magnetic-cloud'
  | 'icme-ejecta'
  | 'sir-compression'
  | 'stream-interface'
  | 'hss-plateau'
  | 'rarefaction'
  | 'hcs-crossing'
  | 'plasma-sheet'
  | 'slow-ambient'
  | 'fast-ambient'
  | 'unclassified';

export type PhaseConfidence = 'high' | 'moderate' | 'low';

export interface SolarWindSample {
  time: number;             // ms epoch
  speed: number | null;     // km/s
  density: number | null;   // cm^-3
  temp: number | null;      // K
  bt: number | null;        // nT
  bx: number | null;        // nT
  by: number | null;        // nT
  bz: number | null;        // nT
  angle: number | null;     // deg, atan2(By,Bx) - field azimuth / sector indicator
  /** Per-field source satellite, when the feed reports it. Used only to avoid
   *  reading an instrument handover as a physical discontinuity. */
  source?: string | null;
}

export interface PhaseDerived {
  speed: number | null;
  density: number | null;
  temp: number | null;
  bt: number | null;
  bz: number | null;
  /** Plasma beta - thermal vs magnetic pressure. Low beta is the single most
   *  useful ICME-ejecta indicator available to us. */
  beta: number | null;
  /** Observed proton temperature over the temperature expected for this speed.
   *  < 0.5 is the standard ICME criterion; > 1 says the wind is hot, which
   *  fits coronal-hole flow and rules ejecta out. */
  tempRatio: number | null;
  /** Fractional field variance over ~30 min. Smooth (low) = flux rope,
   *  turbulent (high) = sheath or compression. */
  fieldVariance: number | null;
  /** Net field rotation over the last few hours, degrees. */
  rotation: number | null;
  /** Whether that rotation is monotonic - a rope turns steadily, turbulence
   *  wanders back and forth. */
  rotationSmooth: boolean;
  /** Speed trend, km/s per hour. */
  speedTrend: number | null;
  /** Density and field relative to the last 24h background. */
  densityRatio: number | null;
  btRatio: number | null;
  /** True when the field azimuth has flipped sectors recently. */
  sectorFlip: boolean;
  /** How many minutes of usable data backed these numbers. */
  coverageMin: number;
}

export interface SolarWindPhaseResult {
  id: SolarWindPhaseId;
  /** Technical name, e.g. "Magnetic Cloud (flux rope)". */
  label: string;
  /** One sentence in plain English, framed for aurora watchers. */
  plain: string;
  /** Short qualifier under the headline - timing or embedding context. */
  context: string | null;
  confidence: PhaseConfidence;
  /** 0..1 raw score of the winning phase, for debugging and tie inspection. */
  score: number;
  /**
   * A competing explanation - a runner-up that scored close but is physically
   * INCOMPATIBLE with the primary, so only one of them can be true. This is a
   * statement of uncertainty.
   */
  alternative: { id: SolarWindPhaseId; label: string; score: number } | null;
  /**
   * Structures that are genuinely present *alongside* the primary, rather than
   * instead of it. Real solar wind layers: a CME ploughing into a coronal-hole
   * stream is both, at once, and reporting only the winner throws away the
   * half of the picture that explains why conditions are behaving oddly.
   * Empty when the interval is cleanly one thing.
   */
  layers: { id: SolarWindPhaseId; label: string; score: number }[];
  /** Primary plus any layers, e.g. "Coronal Hole High-Speed Stream + ICME Ejecta". */
  summaryLabel: string;
  derived: PhaseDerived;
}

// ── Physical constants ───────────────────────────────────────────────────────
const BOLTZMANN = 1.380649e-23;       // J/K
const MU_0 = 4 * Math.PI * 1e-7;      // H/m

// ── Windows ──────────────────────────────────────────────────────────────────
const RECENT_MIN = 30;     // "now" - smooths instrument noise without blurring events
const BASELINE_MIN = 24 * 60;
const ROTATION_MIN = 4 * 60;
const MIN_COVERAGE_MIN = 12;   // below this we decline to classify at all

// ── Layering thresholds ──────────────────────────────────────────────────────
/** A secondary structure must stand on its own feet, not merely out-score the floor. */
const LAYER_MIN_SCORE = 0.55;
/** ...and must be within reach of the primary, or it is a weak also-ran. */
const LAYER_MAX_GAP = 0.25;
/** Three structures at once is already a lot to put in front of someone. */
const MAX_LAYERS = 2;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

const within = (samples: SolarWindSample[], endTime: number, minutes: number) => {
  const cutoff = endTime - minutes * 60_000;
  return samples.filter((s) => s.time >= cutoff && s.time <= endTime);
};

const pick = (samples: SolarWindSample[], key: keyof SolarWindSample): number[] =>
  samples.map((s) => s[key]).filter(isNum) as number[];

/**
 * Expected proton temperature for a given speed (Lopez & Freeman 1986; Lopez
 * 1987). Comparing the observed temperature against this is the standard way
 * to spot ICME ejecta without composition data: ejecta expand as they travel
 * and arrive anomalously cold for their speed.
 */
export const expectedTemperature = (speedKms: number): number => {
  if (speedKms < 500) {
    const t = 0.031 * speedKms - 5.1;
    return Math.max(t * t * 1e3, 1e3);
  }
  return Math.max((0.77 * speedKms - 265) * 1e3, 1e3);
};

/** Plasma beta from density (cm^-3), temperature (K) and field magnitude (nT). */
export const plasmaBeta = (densityCm3: number, tempK: number, btNt: number): number | null => {
  if (btNt <= 0) return null;
  const n = densityCm3 * 1e6;          // m^-3
  const b = btNt * 1e-9;               // T
  const thermal = n * BOLTZMANN * tempK;
  const magnetic = (b * b) / (2 * MU_0);
  if (magnetic <= 0) return null;
  return thermal / magnetic;
};

/** Smallest absolute angular difference between two bearings, in degrees. */
const angleDelta = (a: number, b: number): number => {
  let d = ((b - a + 180) % 360) - 180;
  if (d < -180) d += 360;
  return d;
};

/**
 * Parker-spiral sector. At 1 AU the field lies near 135 deg (away from the
 * Sun) or 315 deg (toward it); a swap between the two is a heliospheric
 * current sheet crossing.
 */
const sectorOf = (angleDeg: number): 'toward' | 'away' => {
  const d135 = Math.abs(angleDelta(angleDeg, 135));
  const d315 = Math.abs(angleDelta(angleDeg, 315));
  return d315 < d135 ? 'toward' : 'away';
};

/**
 * How firmly a given azimuth sits inside its sector. Near the 45/225 boundary
 * the field is ambiguous and ordinary wandering can look like a reversal, so
 * a flip only counts when both ends were unambiguous.
 */
const sectorConfidence = (angleDeg: number): number => {
  const d = Math.min(Math.abs(angleDelta(angleDeg, 135)), Math.abs(angleDelta(angleDeg, 315)));
  return Math.max(0, Math.min(1, (90 - d) / 45));
};

const linearTrendPerHour = (points: { t: number; v: number }[]): number | null => {
  if (points.length < 4) return null;
  const t0 = points[0].t;
  const xs = points.map((p) => (p.t - t0) / 3_600_000);
  const ys = points.map((p) => p.v);
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
};

export const deriveSolarWindState = (samples: SolarWindSample[]): PhaseDerived => {
  const usable = samples
    .filter((s) => isNum(s.time))
    .sort((a, b) => a.time - b.time);

  const endTime = usable.length ? usable[usable.length - 1].time : Date.now();
  const recent = within(usable, endTime, RECENT_MIN);
  const baseline = within(usable, endTime, BASELINE_MIN);
  const rotationWin = within(usable, endTime, ROTATION_MIN);

  const speed = median(pick(recent, 'speed'));
  const density = median(pick(recent, 'density'));
  const temp = median(pick(recent, 'temp'));
  const bt = median(pick(recent, 'bt'));
  const bz = median(pick(recent, 'bz'));

  const coverageMin = recent.filter((s) => isNum(s.speed) || isNum(s.bt)).length;

  const beta = isNum(density) && isNum(temp) && isNum(bt) ? plasmaBeta(density, temp, bt) : null;
  const tempRatio = isNum(temp) && isNum(speed) ? temp / expectedTemperature(speed) : null;

  // Field variance: scatter of |B| about its own mean over the recent window.
  // A flux rope is famously smooth; a sheath is not.
  const btRecent = pick(recent, 'bt');
  let fieldVariance: number | null = null;
  if (btRecent.length >= 5) {
    const m = mean(btRecent)!;
    if (m > 0) {
      const variance = mean(btRecent.map((v) => (v - m) ** 2))!;
      fieldVariance = Math.sqrt(variance) / m;
    }
  }

  // Rotation: how far the field direction has turned across the window, and
  // whether it did so steadily. Uses the clock angle (By vs Bz), which is what
  // a rope rotation shows up in most clearly.
  let rotation: number | null = null;
  let rotationSmooth = false;
  const clockPts = rotationWin
    .filter((s) => isNum(s.by) && isNum(s.bz))
    .map((s) => ({
      t: s.time,
      a: (Math.atan2(s.by as number, s.bz as number) * 180) / Math.PI,
    }));
  if (clockPts.length >= 10) {
    let total = 0;
    let forward = 0;
    let steps = 0;
    for (let i = 1; i < clockPts.length; i++) {
      const d = angleDelta(clockPts[i - 1].a, clockPts[i].a);
      total += d;
      if (Math.abs(d) > 0.05) {
        steps++;
        if (d > 0) forward++;
      }
    }
    rotation = Math.abs(total);
    // Monotonic if the great majority of steps turn the same way.
    const frac = steps ? Math.max(forward, steps - forward) / steps : 0;
    rotationSmooth = frac >= 0.7 && rotation >= 30;
  }

  const speedTrend = linearTrendPerHour(
    within(usable, endTime, 180)
      .filter((s) => isNum(s.speed))
      .map((s) => ({ t: s.time, v: s.speed as number })),
  );

  const baseDensity = median(pick(baseline, 'density'));
  const baseBt = median(pick(baseline, 'bt'));
  const densityRatio = isNum(density) && isNum(baseDensity) && baseDensity > 0 ? density / baseDensity : null;
  const btRatio = isNum(bt) && isNum(baseBt) && baseBt > 0 ? bt / baseBt : null;

  // Sector flip: compare the field azimuth now against a few hours ago. Only
  // counts when both ends are well away from the boundary, so ordinary
  // wandering near 45/225 doesn't register.
  //
  // The feed publishes `angle` directly, but some call sites only carry Bx/By,
  // so fall back to deriving it - it is the same quantity either way.
  const azimuthOf = (window: SolarWindSample[]): number | null => {
    const direct = median(pick(window, 'angle'));
    if (direct != null) return direct;
    const pts = window.filter((s) => isNum(s.bx) && isNum(s.by));
    if (!pts.length) return null;
    const sx = mean(pts.map((s) => s.bx as number))!;
    const sy = mean(pts.map((s) => s.by as number))!;
    if (sx === 0 && sy === 0) return null;
    return ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  };

  let sectorFlip = false;
  const angleNow = azimuthOf(recent);
  const earlier = within(usable, endTime - 90 * 60_000, 60);
  const anglePrev = azimuthOf(earlier);
  if (isNum(angleNow) && isNum(anglePrev)) {
    sectorFlip =
      sectorOf(angleNow) !== sectorOf(anglePrev) &&
      sectorConfidence(angleNow) > 0.35 &&
      sectorConfidence(anglePrev) > 0.35;
  }

  return {
    speed, density, temp, bt, bz,
    beta, tempRatio, fieldVariance, rotation, rotationSmooth,
    speedTrend, densityRatio, btRatio, sectorFlip,
    coverageMin,
  };
};

// ── Scoring helpers ──────────────────────────────────────────────────────────
// Each test contributes a weighted 0..1. Missing inputs contribute nothing
// rather than counting against a phase, so a gappy feed degrades confidence
// instead of silently picking the wrong answer.

interface Scorer {
  weight: number;
  value: number | null;
}

const scoreOf = (tests: Scorer[]): { score: number; coverage: number } => {
  let total = 0;
  let used = 0;
  let possible = 0;
  for (const t of tests) {
    possible += t.weight;
    if (t.value == null) continue;
    total += t.weight * Math.max(0, Math.min(1, t.value));
    used += t.weight;
  }
  return {
    score: used > 0 ? total / used : 0,
    coverage: possible > 0 ? used / possible : 0,
  };
};

/** Ramp from 0 at `lo` to 1 at `hi` (or inverted when lo > hi). */
const ramp = (v: number | null, lo: number, hi: number): number | null => {
  if (v == null) return null;
  if (lo === hi) return v >= hi ? 1 : 0;
  const t = (v - lo) / (hi - lo);
  return Math.max(0, Math.min(1, t));
};

const PHASE_LABELS: Record<SolarWindPhaseId, string> = {
  'shock': 'Interplanetary Shock',
  'icme-sheath': 'ICME Sheath',
  'magnetic-cloud': 'Magnetic Cloud (flux rope)',
  'icme-ejecta': 'ICME Ejecta (non-cloud)',
  'sir-compression': 'Stream Interaction Region',
  'stream-interface': 'Stream Interface',
  'hss-plateau': 'Coronal Hole High-Speed Stream',
  'rarefaction': 'Rarefaction / Trailing Edge',
  'hcs-crossing': 'Heliospheric Current Sheet Crossing',
  'plasma-sheet': 'Heliospheric Plasma Sheet',
  'slow-ambient': 'Slow Ambient Solar Wind',
  'fast-ambient': 'Fast Ambient Solar Wind',
  'unclassified': 'Mixed / Transitional',
};

/**
 * Which structures can physically be present at the same time at L1.
 *
 * This is what makes a multi-label answer honest rather than just a list of
 * high scores. Some pairs are real and common - a CME embedded in or
 * overtaking a coronal-hole stream, a current sheet crossing inside a
 * compression region - and the aurora behaviour only makes sense if you name
 * both. Other pairs are contradictions: the wind cannot be slow ambient and a
 * high-speed stream, and the same plasma cannot be a tidy flux rope and
 * non-cloud ejecta.
 *
 * Declared as pairs and expanded symmetrically, so the table cannot drift into
 * saying A goes with B but B does not go with A.
 */
const COMPATIBLE_PAIRS: [SolarWindPhaseId, SolarWindPhaseId][] = [
  // A shock is the leading edge of whatever is driving it.
  ['shock', 'icme-sheath'],
  ['shock', 'sir-compression'],
  // A CME driving into slower wind compresses it: sheath and SIR coexist.
  ['icme-sheath', 'sir-compression'],
  ['icme-sheath', 'hcs-crossing'],
  // CME material embedded in, or being overtaken by, a fast stream. This is
  // the messy case that a single label handles worst.
  ['magnetic-cloud', 'hss-plateau'],
  ['magnetic-cloud', 'sir-compression'],
  ['magnetic-cloud', 'fast-ambient'],
  ['icme-ejecta', 'hss-plateau'],
  ['icme-ejecta', 'sir-compression'],
  ['icme-ejecta', 'fast-ambient'],
  ['icme-ejecta', 'stream-interface'],
  // The stream interface is a feature *inside* a compression region.
  ['sir-compression', 'stream-interface'],
  ['sir-compression', 'hcs-crossing'],
  ['sir-compression', 'plasma-sheet'],
  ['stream-interface', 'hss-plateau'],
  ['stream-interface', 'hcs-crossing'],
  ['hss-plateau', 'hcs-crossing'],
  ['rarefaction', 'hcs-crossing'],
  ['rarefaction', 'slow-ambient'],
  ['plasma-sheet', 'hcs-crossing'],
  ['plasma-sheet', 'slow-ambient'],
  // A current sheet crossing is a field-topology event and is close to
  // orthogonal to the bulk flow state, so it layers with almost anything.
  ['slow-ambient', 'hcs-crossing'],
  ['fast-ambient', 'hcs-crossing'],
];

const COMPATIBILITY: Record<string, Set<SolarWindPhaseId>> = {};
for (const [a, b] of COMPATIBLE_PAIRS) {
  (COMPATIBILITY[a] ??= new Set()).add(b);
  (COMPATIBILITY[b] ??= new Set()).add(a);
}

const canCoexist = (a: SolarWindPhaseId, b: SolarWindPhaseId): boolean =>
  a !== b && !!COMPATIBILITY[a]?.has(b);

/** Short noun phrase for use inside a combined sentence. */
const PHASE_SHORT: Record<SolarWindPhaseId, string> = {
  'shock': 'a shock front',
  'icme-sheath': 'CME sheath compression',
  'magnetic-cloud': 'a CME flux rope',
  'icme-ejecta': 'CME ejecta',
  'sir-compression': 'stream compression',
  'stream-interface': 'a stream interface',
  'hss-plateau': 'fast coronal-hole flow',
  'rarefaction': 'a rarefaction tail',
  'hcs-crossing': 'a current sheet crossing',
  'plasma-sheet': 'the heliospheric plasma sheet',
  'slow-ambient': 'slow background wind',
  'fast-ambient': 'elevated background flow',
  'unclassified': 'mixed signatures',
};

const PHASE_PLAIN: Record<SolarWindPhaseId, string> = {
  'shock': 'A shock front just passed - speed, density and field all jumped together. Aurora activity often picks up sharply in the hours after this.',
  'icme-sheath': 'Compressed, turbulent plasma piled up ahead of a CME. This is where many of the best aurora displays actually happen, because the field swings south hard and often.',
  'magnetic-cloud': 'The smooth, strongly magnetised core of a CME is passing. If the field is pointing south, this can drive long, steady aurora; if north, it can go quiet for hours.',
  'icme-ejecta': 'CME material is passing, without the clean rotating field of a textbook flux rope. Aurora potential depends on which way the field happens to be pointing.',
  'sir-compression': 'Fast wind is piling into slower wind ahead of it, compressing the field and density. A reliable, recurring source of moderate aurora activity.',
  'stream-interface': 'We are right at the boundary where slow wind gives way to fast wind. Conditions usually shift quickly through here.',
  'hss-plateau': 'Fast, hot, thin wind streaming from a coronal hole. Can sustain modest aurora for days, especially around local midnight.',
  'rarefaction': 'The tail end of a fast stream - the flow is easing off and thinning out. Aurora chances are winding down.',
  'hcs-crossing': 'We are crossing the heliospheric current sheet, where the Sun’s magnetic field flips direction. Often unsettled, and frequently followed by a stream.',
  'plasma-sheet': 'The dense, slow band of plasma that surrounds the current sheet. Usually quiet, but it often precedes more active wind.',
  'slow-ambient': 'Ordinary background solar wind - slow, thin and quiet. Aurora is unlikely unless something new arrives.',
  'fast-ambient': 'Steadily faster than background wind, but without a clear coronal-hole signature. Mildly supportive conditions.',
  'unclassified': 'The signatures are genuinely mixed right now and do not clearly match any one structure. Conditions are probably in transition.',
};

/**
 * Join the app's separate magnetic / speed / density / temperature series into
 * the single time-ordered sample list the classifier wants. Both panels feed
 * from the same upstream rows, so timestamps line up exactly; anything that
 * doesn't simply arrives as a partial sample, which the scorer tolerates.
 */
export const buildSolarWindSamples = (
  magneticData: { time: number; bt?: number | null; bx?: number | null; by?: number | null; bz?: number | null; angle?: number | null }[] | undefined,
  speedData: { x: number; y: number }[] | undefined,
  densityData: { x: number; y: number }[] | undefined,
  tempData: { x: number; y: number }[] | undefined,
): SolarWindSample[] => {
  const byTime = new Map<number, SolarWindSample>();

  const blank = (time: number): SolarWindSample => ({
    time, speed: null, density: null, temp: null,
    bt: null, bx: null, by: null, bz: null, angle: null,
  });

  for (const m of magneticData ?? []) {
    if (!isNum(m?.time)) continue;
    const s = byTime.get(m.time) ?? blank(m.time);
    s.bt = isNum(m.bt) ? m.bt : null;
    s.bx = isNum(m.bx) ? m.bx : null;
    s.by = isNum(m.by) ? m.by : null;
    s.bz = isNum(m.bz) ? m.bz : null;
    s.angle = isNum(m.angle) ? m.angle : null;
    byTime.set(m.time, s);
  }

  const merge = (series: { x: number; y: number }[] | undefined, key: 'speed' | 'density' | 'temp') => {
    for (const p of series ?? []) {
      if (!isNum(p?.x)) continue;
      const s = byTime.get(p.x) ?? blank(p.x);
      s[key] = isNum(p.y) ? p.y : null;
      byTime.set(p.x, s);
    }
  };
  merge(speedData, 'speed');
  merge(densityData, 'density');
  merge(tempData, 'temp');

  return [...byTime.values()].sort((a, b) => a.time - b.time);
};

export interface ClassifyOptions {
  /** Most recent detected shock, if any, from utils/shockDetection. Lets the
   *  classifier say "4h after a fast forward shock" and makes sheath/ejecta
   *  far more credible. */
  lastShock?: { t: number; label: string } | null;
  /** Treated as "now". Defaults to the newest sample. */
  now?: number;
}

export const classifySolarWindPhase = (
  samples: SolarWindSample[],
  options: ClassifyOptions = {},
): SolarWindPhaseResult => {
  const derived = deriveSolarWindState(samples);
  const now = options.now ?? (samples.length ? samples[samples.length - 1].time : Date.now());

  const unclassified = (reason: string): SolarWindPhaseResult => ({
    id: 'unclassified',
    label: PHASE_LABELS.unclassified,
    plain: reason,
    context: null,
    confidence: 'low',
    score: 0,
    alternative: null,
    layers: [],
    summaryLabel: PHASE_LABELS.unclassified,
    derived,
  });

  if (derived.coverageMin < MIN_COVERAGE_MIN) {
    return unclassified('Not enough recent solar wind data to say what we are in - waiting on the live feed.');
  }

  const {
    speed, density, beta, tempRatio, fieldVariance,
    rotation, rotationSmooth, speedTrend, densityRatio, btRatio, sectorFlip,
  } = derived;

  const hoursSinceShock = options.lastShock
    ? (now - options.lastShock.t) / 3_600_000
    : null;
  const shockVeryRecent = hoursSinceShock != null && hoursSinceShock <= 1.5;
  const shockRecent = hoursSinceShock != null && hoursSinceShock <= 12;

  // Cold ejecta signature: low beta AND a genuine temperature deficit. Both
  // must hold - low beta alone is just a strong field, which happens often.
  const coldEjecta = scoreOf([
    { weight: 2, value: ramp(beta, 0.5, 0.1) },
    { weight: 2, value: ramp(tempRatio, 0.8, 0.35) },
    { weight: 1, value: ramp(btRatio, 1.1, 1.8) },
  ]).score;

  const candidates: { id: SolarWindPhaseId; score: number; coverage: number }[] = [];
  const add = (id: SolarWindPhaseId, tests: Scorer[]) => {
    const { score, coverage } = scoreOf(tests);
    candidates.push({ id, score, coverage });
  };

  // Shock: we do not re-derive this - the shared detector already does it well.
  add('shock', [
    { weight: 1, value: shockVeryRecent ? 1 : 0 },
  ]);

  // Sheath: compressed AND turbulent AND hot, sitting behind a shock.
  add('icme-sheath', [
    { weight: 2, value: ramp(densityRatio, 1.2, 2.2) },
    { weight: 2, value: ramp(fieldVariance, 0.08, 0.25) },
    { weight: 2, value: ramp(btRatio, 1.2, 2.0) },
    { weight: 1, value: ramp(tempRatio, 0.6, 1.5) },
    { weight: 3, value: shockRecent ? 1 : 0.15 },
  ]);

  // Magnetic cloud: cold, low beta, strong, smooth, and rotating steadily.
  add('magnetic-cloud', [
    { weight: 3, value: coldEjecta },
    { weight: 2, value: ramp(fieldVariance, 0.18, 0.05) },
    { weight: 2, value: rotationSmooth ? 1 : 0 },
    { weight: 1, value: ramp(rotation, 25, 90) },
    { weight: 1, value: ramp(speedTrend, 5, -15) },
  ]);

  // Non-cloud ejecta: the cold, low-beta plasma without the tidy rotation.
  // Roughly two-thirds of ICMEs look like this, so it matters that it exists.
  add('icme-ejecta', [
    { weight: 3, value: coldEjecta },
    { weight: 1, value: rotationSmooth ? 0.2 : 1 },
    { weight: 1, value: ramp(btRatio, 1.0, 1.6) },
  ]);

  // SIR: compression without the cold ejecta signature, speed rising.
  add('sir-compression', [
    { weight: 2, value: ramp(densityRatio, 1.3, 2.5) },
    { weight: 2, value: ramp(btRatio, 1.2, 2.0) },
    { weight: 2, value: ramp(speedTrend, 5, 40) },
    { weight: 2, value: ramp(tempRatio, 0.7, 1.6) },
    { weight: 2, value: 1 - coldEjecta },
  ]);

  // Stream interface: the sharp step inside a SIR - speed climbing fast while
  // density falls away and the plasma heats.
  add('stream-interface', [
    { weight: 3, value: ramp(speedTrend, 15, 60) },
    { weight: 2, value: ramp(densityRatio, 1.2, 0.6) },
    { weight: 2, value: ramp(tempRatio, 0.9, 2.0) },
  ]);

  // Coronal hole stream: fast, thin, hot, settled.
  add('hss-plateau', [
    { weight: 3, value: ramp(speed, 450, 600) },
    { weight: 2, value: ramp(density, 8, 3) },
    { weight: 2, value: ramp(tempRatio, 0.9, 1.8) },
    { weight: 1, value: ramp(Math.abs(speedTrend ?? 0), 30, 5) },
    { weight: 1, value: 1 - coldEjecta },
  ]);

  // Rarefaction: still quickish but decaying, thin and weakly magnetised.
  add('rarefaction', [
    { weight: 3, value: ramp(speedTrend, -5, -25) },
    { weight: 2, value: ramp(density, 6, 2) },
    { weight: 1, value: ramp(btRatio, 1.0, 0.6) },
    { weight: 1, value: ramp(speed, 350, 550) },
  ]);

  // Current sheet crossing: the azimuth has flipped sector. A confirmed
  // reversal is a discrete, unambiguous event and nothing else explains it, so
  // it is weighted to win outright - a crossing happens *inside* slow wind, and
  // "we just crossed the current sheet" is the more useful of the two facts.
  add('hcs-crossing', [
    { weight: 10, value: sectorFlip ? 1 : 0 },
    { weight: 1, value: ramp(btRatio, 1.0, 0.6) },
    { weight: 1, value: ramp(beta, 0.5, 2.0) },
  ]);

  // Plasma sheet: dense, slow, high beta, weak field - the band around the HCS.
  add('plasma-sheet', [
    { weight: 2, value: ramp(densityRatio, 1.2, 2.2) },
    { weight: 2, value: ramp(beta, 1.0, 3.0) },
    { weight: 2, value: ramp(speed, 450, 330) },
    { weight: 1, value: ramp(btRatio, 1.1, 0.7) },
    { weight: 1, value: 1 - coldEjecta },
  ]);

  add('slow-ambient', [
    { weight: 3, value: ramp(speed, 450, 350) },
    { weight: 2, value: ramp(densityRatio, 1.6, 0.8) },
    { weight: 2, value: ramp(btRatio, 1.5, 0.9) },
    { weight: 2, value: ramp(Math.abs(speedTrend ?? 0), 25, 5) },
    { weight: 1, value: 1 - coldEjecta },
  ]);

  add('fast-ambient', [
    { weight: 2, value: ramp(speed, 400, 500) },
    { weight: 2, value: ramp(speed, 650, 520) },
    { weight: 2, value: ramp(btRatio, 1.5, 0.9) },
    { weight: 2, value: ramp(Math.abs(speedTrend ?? 0), 25, 5) },
    { weight: 1, value: 1 - coldEjecta },
  ]);

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const runnerUp = candidates[1];

  // Honest uncertainty: a weak winner, or a winner that barely beat the next
  // candidate, is reported as mixed rather than asserted.
  if (best.score < 0.45) {
    return {
      ...unclassified(PHASE_PLAIN.unclassified),
      score: best.score,
      alternative: runnerUp
        ? { id: runnerUp.id, label: PHASE_LABELS[runnerUp.id], score: runnerUp.score }
        : null,
    };
  }

  // ── Layering ───────────────────────────────────────────────────────────────
  // Everything below the winner already has a score; until now all of it was
  // thrown away. A close second is one of two quite different things, and the
  // difference matters:
  //
  //   incompatible  -> we are unsure which of the two it is  (alternative)
  //   compatible    -> both are true at once                 (layer)
  //
  // Telling them apart is what stops "CME tangled up with a high-speed stream"
  // from flickering between two labels that are each half right.
  const layers = candidates
    .slice(1)
    .filter((c) => c.id !== 'unclassified' && c.score >= LAYER_MIN_SCORE && best.score - c.score <= LAYER_MAX_GAP)
    .reduce<typeof candidates>((acc, c) => {
      // Must be consistent with the primary *and* with every layer already
      // accepted, so the reported set never contradicts itself.
      if (!canCoexist(best.id, c.id)) return acc;
      if (acc.some((existing) => !canCoexist(existing.id, c.id))) return acc;
      if (acc.length >= MAX_LAYERS) return acc;
      acc.push(c);
      return acc;
    }, []);

  const layeredIds = new Set([best.id, ...layers.map((l) => l.id)]);

  // The alternative is now strictly a competing explanation: the best-scoring
  // candidate that could NOT be true at the same time as what we reported.
  const competing = candidates
    .slice(1)
    .find((c) => !layeredIds.has(c.id) && !canCoexist(best.id, c.id) && c.score >= best.score - 0.12);

  // Margin is measured against that competitor, not against a layer. A high
  // scoring layer is corroboration, not doubt, and used to drag confidence
  // down for no reason.
  const margin = competing ? best.score - competing.score : best.score;

  // Margin matters when two phases are competing explanations, but a close
  // runner-up is often just a second true statement (a current sheet crossing
  // happens inside slow wind - both are real). So a strong absolute match
  // still earns moderate confidence even when something scored near it.
  let confidence: PhaseConfidence = 'low';
  if (best.score >= 0.7 && margin >= 0.15) confidence = 'high';
  else if (best.score >= 0.55 && margin >= 0.07) confidence = 'moderate';
  else if (best.score >= 0.85) confidence = 'moderate';

  // No composition data (no alpha ratio, no electron pitch angles), so never
  // claim high confidence on a CME-family call - including when CME material
  // is only the secondary layer, since that is the same unverifiable claim.
  const isCmeFamily = (id: SolarWindPhaseId) =>
    id === 'magnetic-cloud' || id === 'icme-ejecta' || id === 'icme-sheath';
  if (confidence === 'high' && [best.id, ...layers.map((l) => l.id)].some(isCmeFamily)) {
    confidence = 'moderate';
  }

  // Sparse data caps confidence too.
  if (derived.coverageMin < RECENT_MIN / 2 && confidence === 'high') confidence = 'moderate';

  const layerOut = layers.map((l) => ({ id: l.id, label: PHASE_LABELS[l.id], score: l.score }));
  const summaryLabel = [PHASE_LABELS[best.id], ...layerOut.map((l) => l.label)].join(' + ');

  return {
    id: best.id,
    label: PHASE_LABELS[best.id],
    plain: buildPlain(best.id, layers.map((l) => l.id)),
    context: buildContext(best.id, derived, hoursSinceShock, options.lastShock?.label ?? null),
    confidence,
    score: best.score,
    alternative: competing
      ? { id: competing.id, label: PHASE_LABELS[competing.id], score: competing.score }
      : null,
    layers: layerOut,
    summaryLabel,
    derived,
  };
};

/**
 * Plain-English sentence for the reported set. The primary carries the
 * description; layers are appended as a clause, because "there is also a fast
 * stream underneath this" is the part that explains why the aurora behaviour
 * is not matching the headline structure.
 */
const buildPlain = (id: SolarWindPhaseId, layerIds: SolarWindPhaseId[]): string => {
  const base = PHASE_PLAIN[id];
  if (!layerIds.length) return base;
  const shorts = layerIds.map((l) => PHASE_SHORT[l]);
  const joined = shorts.length === 1
    ? shorts[0]
    : `${shorts.slice(0, -1).join(', ')} and ${shorts[shorts.length - 1]}`;
  return `${base} It is layered with ${joined}, so conditions can shift faster than any one of them would suggest on its own.`;
};

const buildContext = (
  id: SolarWindPhaseId,
  d: PhaseDerived,
  hoursSinceShock: number | null,
  shockLabel: string | null,
): string | null => {
  const bits: string[] = [];

  if (hoursSinceShock != null && hoursSinceShock <= 24) {
    const hrs = hoursSinceShock < 1
      ? `${Math.round(hoursSinceShock * 60)} min`
      : `${hoursSinceShock.toFixed(1)} h`;
    bits.push(`${hrs} after ${shockLabel ?? 'a shock'}`);
  }

  if (id === 'hss-plateau' && d.speed != null) bits.push(`${Math.round(d.speed)} km/s stream`);
  if (id === 'magnetic-cloud' && d.rotation != null) bits.push(`field turned ${Math.round(d.rotation)}°`);
  if ((id === 'sir-compression' || id === 'stream-interface') && d.speedTrend != null && d.speedTrend > 0) {
    bits.push(`speed rising ${Math.round(d.speedTrend)} km/s per hour`);
  }
  if (id === 'rarefaction' && d.speedTrend != null) {
    bits.push(`easing ${Math.abs(Math.round(d.speedTrend))} km/s per hour`);
  }
  if (id === 'hcs-crossing') bits.push('field reversed sector');

  return bits.length ? bits.join(' · ') : null;
};
