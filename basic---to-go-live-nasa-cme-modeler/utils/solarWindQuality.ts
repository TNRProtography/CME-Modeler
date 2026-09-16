// --- START OF FILE src/utils/solarWindQuality.ts ---
//
// Quality control for the merged L1 solar wind feed.
//
// WHY THIS EXISTS
// ---------------
// The worker merges several spacecraft (ACE, DSCOVR, IMAP, SOLAR1, NOAA RTSW)
// and picks a value per *field* per *minute*. That means the source backing
// "density" can change from one sample to the next, independently of the source
// backing "speed". Each instrument has its own calibration, and several of them
// drop out regularly, so the merged series contains step discontinuities that
// are instrumental rather than physical. Observed in one real 24h window:
//
//   11:49  density 44.94 (IMAP)  with SOLAR1 neighbours reading ~1.8
//   19:41  density 0.10  (ACE)
//   03:47  speed 469 (IMAP) vs 358 (SOLAR1) in the same minute
//   13:36  speed 584/639 against a ~390 km/s background
//
// A 25x density jump for a single sample reads as a shock to any threshold
// test, and it wrecks plasma beta and the Tp/Tex ratio the structure
// classifier depends on. So this has to be cleaned before anything downstream
// looks at it.
//
// THE APPROACH
// ------------
// We deliberately do NOT pin to a single "trusted" spacecraft. Every source
// here drops out, so a pinned series would be full of holes, and none of them
// is reliable enough to be the reference anyway.
//
// Instead the test is physical continuity, with the source used only as a
// tiebreaker:
//
//   A real change in the solar wind persists. An instrument glitch does not.
//
// So a sample is rejected when it disagrees with the local median BOTH before
// and after it. A shock ramp disagrees with the past but agrees with the
// future, so it survives untouched - which matters, because losing real shocks
// to an over-eager filter would be worse than the glitches. A lone spike
// disagrees with both and goes.
//
// Where a sample's source differs from the surrounding majority, the rejection
// threshold tightens, because that is the known failure mode. It tightens
// rather than rejecting outright: a genuine sustained handover (one satellite
// taking over from another for hours) still passes, because the run
// establishes its own local median.

export interface QualitySample {
  time: number;
  value: number;
  source?: string | null;
}

export interface QualityField {
  /** Values outside this range are non-physical at L1 and always rejected. */
  min: number;
  max: number;
  /**
   * Floor on the comparison scale, as a fraction of the local median. Stops a
   * very quiet stretch (say density pinned near 0.5) from making ordinary
   * jitter look like an outlier.
   */
  relFloor: number;
  /** Absolute floor on the comparison scale, in the field's own units. */
  absFloor: number;
  /**
   * Compare in log space. Density and temperature vary over orders of
   * magnitude, so a proportional test is the meaningful one; speed and field
   * magnitude are better judged linearly.
   */
  log?: boolean;
}

export const QUALITY_FIELDS: Record<'speed' | 'density' | 'temp' | 'bt', QualityField> = {
  // Bulk speed at 1 AU: slowest observed streams sit near 250, the fastest
  // recorded events near 1000-1200.
  speed: { min: 180, max: 1400, relFloor: 0.06, absFloor: 18 },
  // Proton density spans ~0.1 to ~100 in extremes; judged proportionally.
  density: { min: 0.05, max: 200, relFloor: 0.35, absFloor: 0.3, log: true },
  // Proton temperature, K.
  temp: { min: 2e3, max: 3e7, relFloor: 0.45, absFloor: 5e3, log: true },
  // Field magnitude, nT.
  bt: { min: 0, max: 120, relFloor: 0.25, absFloor: 0.8 },
};

/** How far either side of a sample we look for context. */
const CONTEXT_MIN = 12;
/** Minimum neighbours on a side before that side's opinion counts. */
const MIN_CONTEXT = 3;
/** Deviation, in units of local scale, that counts as disagreement. */
const REJECT_SIGMA = 4.5;
/** Tighter threshold applied when the sample's source differs from its neighbours'. */
const HANDOVER_SIGMA = 2.6;
/**
 * One-sided threshold for the newest samples, where there is no "after" yet.
 * Deliberately loose: a real event must not be suppressed just because it is
 * recent, and at a 30s poll the two-sided test will catch a glitch on the very
 * next refresh anyway.
 */
const TRAILING_SIGMA = 9;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Median absolute deviation, scaled to be comparable with a standard
 * deviation. Used instead of the standard deviation precisely because the
 * outliers we are hunting would inflate the latter and hide themselves.
 */
const madScale = (xs: number[], med: number): number => {
  const devs = xs.map((v) => Math.abs(v - med));
  const mad = median(devs) ?? 0;
  return mad * 1.4826;
};

const dominantSource = (samples: QualitySample[]): string | null => {
  const counts = new Map<string, number>();
  for (const s of samples) {
    const key = typeof s.source === 'string' ? s.source.trim() : '';
    if (!key || key === '-' || key === ' - ') continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let bestKey: string | null = null;
  let bestCount = 0;
  counts.forEach((count, key) => {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  });
  return bestKey;
};

/**
 * Longest run of samples from an interloping source that we are willing to
 * treat as an artefact. A genuine handover means that spacecraft is now the
 * primary and stays that way; dipping to another source and straight back is
 * the glitch shape.
 */
const MAX_ISLAND_MIN = 25;
/**
 * How far the island must sit from its brackets to be rejected.
 *
 * Lower than the per-sample threshold on purpose. The two gates below - the
 * source changed and changed back, and the values returned to where they were
 * - are already strong evidence on their own, so this only has to clear the
 * scale of real instrument disagreement. Published cross-calibration offsets
 * between L1 monitors run to roughly 5-20% in density and 10-40 km/s in speed,
 * which is about 1.5-2x the configured scale floors, so that is where the bar
 * sits.
 */
const ISLAND_SIGMA = 1.8;
/**
 * Safety valve. If this pass wants to remove a large share of the series, the
 * "islands" are the feed's normal behaviour rather than an anomaly, and
 * silently discarding a quarter of the data would be worse than the offsets.
 * In that case we stand down and leave it to the per-sample test.
 */
const MAX_ISLAND_FRACTION = 0.25;
/** How closely the brackets must agree before we trust them as a pair. */
const BRACKET_TOL = 1.5;

interface Run {
  source: string;
  start: number;
  end: number;
  indices: number[];
}

const groupBySource = (samples: QualitySample[]): Run[] => {
  const runs: Run[] = [];
  for (let i = 0; i < samples.length; i++) {
    const key = (typeof samples[i].source === 'string' ? samples[i].source!.trim() : '') || '';
    const last = runs[runs.length - 1];
    if (last && last.source === key) {
      last.end = samples[i].time;
      last.indices.push(i);
    } else {
      runs.push({ source: key, start: samples[i].time, end: samples[i].time, indices: [i] });
    }
  }
  return runs;
};

/**
 * Reject short "source islands": a brief run from a different spacecraft,
 * bracketed on both sides by the same source, whose values disagree with both
 * brackets while the brackets agree with each other.
 *
 * The per-sample continuity test cannot catch these. A coherent 8-minute block
 * where speed, density, temperature and |B| all step together looks exactly
 * like a fast forward shock, and every sample inside it is perfectly
 * consistent with its immediate neighbours - which are also part of the block.
 * It has to be judged as a unit.
 *
 * The bracket-agreement requirement is what keeps real events safe: after a
 * genuine shock the wind does NOT return to its previous state, so the two
 * brackets disagree and nothing is rejected.
 */
const rejectSourceIslands = (
  samples: QualitySample[],
  field: QualityField,
): { kept: QualitySample[]; rejected: number } => {
  const runs = groupBySource(samples);
  if (runs.length < 3) return { kept: samples, rejected: 0 };

  const tx = (v: number) => (field.log ? Math.log(Math.max(v, 1e-6)) : v);
  const drop = new Set<number>();
  let rejected = 0;

  for (let r = 1; r < runs.length - 1; r++) {
    const run = runs[r];
    const prev = runs[r - 1];
    const next = runs[r + 1];

    // Only the handover-and-back shape, and only when it is brief.
    if (!run.source || !prev.source) continue;
    if (prev.source !== next.source) continue;
    if (run.source === prev.source) continue;
    if (run.end - run.start > MAX_ISLAND_MIN * 60_000) continue;

    const ctxMs = CONTEXT_MIN * 60_000;
    const before = prev.indices.filter((i) => run.start - samples[i].time <= ctxMs).map((i) => tx(samples[i].value));
    const after = next.indices.filter((i) => samples[i].time - run.end <= ctxMs).map((i) => tx(samples[i].value));
    if (before.length < MIN_CONTEXT || after.length < MIN_CONTEXT) continue;

    const medBefore = median(before)!;
    const medAfter = median(after)!;
    const medRun = median(run.indices.map((i) => tx(samples[i].value)))!;

    const bracket = [...before, ...after];
    const medBracket = median(bracket)!;
    const relFloorTx = field.log ? Math.log(1 + field.relFloor) : Math.abs(medBracket) * field.relFloor;
    const absFloorTx = field.log
      ? Math.log(1 + field.absFloor / Math.max(Math.exp(medBracket), 1e-6))
      : field.absFloor;
    const scale = Math.max(madScale(bracket, medBracket), relFloorTx, absFloorTx, 1e-9);

    // The wind came back to where it was, so nothing physical happened.
    if (Math.abs(medBefore - medAfter) / scale >= BRACKET_TOL) continue;

    if (Math.abs(medRun - medBefore) / scale > ISLAND_SIGMA && Math.abs(medRun - medAfter) / scale > ISLAND_SIGMA) {
      for (const i of run.indices) drop.add(i);
      rejected += run.indices.length;
    }
  }

  if (drop.size > samples.length * MAX_ISLAND_FRACTION) {
    return { kept: samples, rejected: 0 };
  }

  return { kept: samples.filter((_, i) => !drop.has(i)), rejected };
};

export interface QualityReport {
  /** Samples that survived, in time order. */
  clean: QualitySample[];
  /** Count rejected, split by why - surfaced in dev logging, not the UI. */
  rejected: { range: number; spike: number; handover: number };
}

/**
 * Drop instrumental spikes from a single time-ordered series.
 *
 * Input must be sorted by time. Gaps are fine and expected: context windows are
 * measured in wall-clock minutes and simply carry fewer neighbours across a
 * dropout, which makes the filter more permissive there rather than less - the
 * right way round, since we know less at those moments.
 */
export const despikeSeries = (samples: QualitySample[], field: QualityField): QualityReport => {
  const rejected = { range: 0, spike: 0, handover: 0 };
  if (samples.length < MIN_CONTEXT * 2) {
    // Too short to have an opinion about continuity; apply the range gate only.
    const clean = samples.filter((s) => {
      const ok = Number.isFinite(s.value) && s.value >= field.min && s.value <= field.max;
      if (!ok) rejected.range++;
      return ok;
    });
    return { clean, rejected };
  }

  const windowMs = CONTEXT_MIN * 60_000;
  const tx = (v: number) => (field.log ? Math.log(Math.max(v, 1e-6)) : v);

  // Range gate first, so a wild value cannot poison the context it is judged
  // against.
  const ranged = samples.filter((s) => {
    const ok = Number.isFinite(s.value) && s.value >= field.min && s.value <= field.max;
    if (!ok) rejected.range++;
    return ok;
  });

  // Run-level pass first: coherent blocks must be judged as a unit, before the
  // per-sample test, which they would pass by being internally consistent.
  const island = rejectSourceIslands(ranged, field);
  rejected.handover += island.rejected;
  const survivors = island.kept;

  const clean: QualitySample[] = [];

  for (let i = 0; i < survivors.length; i++) {
    const s = survivors[i];
    const t = s.time;

    const before: QualitySample[] = [];
    for (let j = i - 1; j >= 0 && t - survivors[j].time <= windowMs; j--) before.push(survivors[j]);
    const after: QualitySample[] = [];
    for (let j = i + 1; j < survivors.length && survivors[j].time - t <= windowMs; j++) after.push(survivors[j]);

    const judge = (ctx: QualitySample[]): { dev: number; sigma: number } | null => {
      if (ctx.length < MIN_CONTEXT) return null;
      const vals = ctx.map((c) => tx(c.value));
      const med = median(vals)!;
      // Scale = the larger of the observed spread and the configured floors, so
      // a pathologically steady stretch cannot make the test hair-trigger.
      const relFloorTx = field.log
        ? Math.log(1 + field.relFloor)
        : Math.abs(med) * field.relFloor;
      const absFloorTx = field.log
        ? Math.log(1 + field.absFloor / Math.max(Math.exp(med), 1e-6))
        : field.absFloor;
      const scale = Math.max(madScale(vals, med), relFloorTx, absFloorTx, 1e-9);
      const sourceDiffers = !!dominantSource(ctx) && !!s.source && dominantSource(ctx) !== s.source;
      return {
        dev: Math.abs(tx(s.value) - med) / scale,
        sigma: sourceDiffers ? HANDOVER_SIGMA : REJECT_SIGMA,
      };
    };

    const past = judge(before);
    const future = judge(after);

    let keep = true;
    let reason: 'spike' | 'handover' = 'spike';

    if (past && future) {
      // The core test. Disagreeing with the past alone is a transition, which
      // is exactly what we are here to preserve. Disagreeing with both sides
      // means the sample stands alone in time - instrumental.
      if (past.dev > past.sigma && future.dev > future.sigma) {
        keep = false;
        reason = past.sigma === HANDOVER_SIGMA || future.sigma === HANDOVER_SIGMA ? 'handover' : 'spike';
      }
    } else if (past && !future) {
      // Newest samples: no forward confirmation available yet.
      if (past.dev > TRAILING_SIGMA) {
        keep = false;
        reason = 'spike';
      }
    }

    if (keep) clean.push(s);
    else rejected[reason]++;
  }

  return { clean, rejected };
};

/**
 * Convenience wrapper for the `{ time, value, source }` point lists built in
 * useForecastData. Returns the surviving points plus a one-line summary for
 * dev logging.
 */
export const cleanSolarWindSeries = (
  points: QualitySample[],
  fieldKey: keyof typeof QUALITY_FIELDS,
): QualityReport => despikeSeries(points, QUALITY_FIELDS[fieldKey]);

export const summariseRejections = (label: string, report: QualityReport): string | null => {
  const { range, spike, handover } = report.rejected;
  const total = range + spike + handover;
  if (!total) return null;
  return `[solar-wind-qc] ${label}: dropped ${total} (${range} out of range, ${spike} spikes, ${handover} handover)`;
};
