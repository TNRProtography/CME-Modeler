// --- START OF FILE src/components/epamWarning.ts ---
//
// Robust client-side ACE EPAM early-warning engine for CME-shock arrival.
//
// WHY THIS EXISTS
// ---------------
// The server worker (epam.thenamesrock.workers.dev/epam/analysis) historically
// based its "elevated" decision on a short ~4-hour window (see
// `log_spread_4h_trend`). A 4-hour window is fragile: it has no stable concept
// of "quiet", so a slow stream-interaction-region rise looks the same as a
// genuine CME shock, and a brief glitch can trip an alert. This module instead
// looks at the FULL WEEK of ACE EPAM to build a robust quiet-time baseline, then
// asks whether the most recent readings genuinely depart from that baseline.
//
// DESIGN GOALS (the "hard ask")
// -----------------------------
//   * Sensitive — do not miss a real shock onset.
//   * Specific — do not fire on glitches, single spikes, or gentle SIR rises.
//   * Honest — every level comes with the concrete reasons that produced it,
//     so the UI can explain itself and a forecaster can sanity-check it.
//
// EPAM is genuinely not cut-and-dry, so the engine never relies on a single
// number. A high warning level requires AGREEMENT across several independent
// signatures (magnitude above baseline, sustained over time, multiple energy
// channels rising together, and a sharp positive rate of change). Any one of
// those alone is downgraded; only their coincidence is treated as a real
// shock-arrival signal. That coincidence requirement is what suppresses false
// positives without blunting sensitivity to the real thing.
//
// All math is done in log10 space because EPAM flux spans many orders of
// magnitude; additive statistics in log space behave like multiplicative
// statistics in linear space, which is the physically correct frame for flux.

// ── Public types ──────────────────────────────────────────────────────────────

export interface EpamSample {
  /** epoch ms (UTC) */
  t: number;
  /** geometric-mean flux across the proton channels supplied, or null if no valid channel */
  flux: number | null;
  /** per-channel log10 flux, null where channel missing/non-positive */
  logCh: (number | null)[];
}

export type WarnLevel =
  | 'QUIET'        // nothing of note
  | 'WATCH'        // baseline departure beginning, not yet confirmed
  | 'ELEVATED'     // sustained, multi-channel departure from quiet baseline
  | 'ONSET'        // sharp coincident rise — shock front likely arriving
  | 'SHOCK';       // extreme, fast, broadband jump — shock passage in progress

export interface WarnReason {
  key: string;
  label: string;
  /** true when this condition is currently contributing to the level */
  active: boolean;
  /** human-readable current value, for tooltips / debugging */
  detail: string;
}

export interface EpamWarning {
  level: WarnLevel;
  levelLabel: string;
  /** 0..100 — a continuous confidence score, useful for sparkline/threshold tuning */
  score: number;
  /** plain-language one-liner suitable for a banner headline */
  headline: string;
  /** technical one-liner (σ vs baseline, slope, channels) shown beneath the headline */
  detail: string;
  /** the individual signatures and whether each fired */
  reasons: WarnReason[];
  /** diagnostics so the engine is transparent and tunable */
  diagnostics: {
    baselineLogMedian: number | null;   // quiet-time log10 flux over the week
    baselineLogMad: number | null;      // robust spread (MAD) of the quiet baseline
    recentLogMedian: number | null;     // log10 flux over the recent window
    sigmaAboveBaseline: number | null;  // (recent - baseline) / MAD, robust z-score
    sustainedMinutes: number;           // how long the recent elevation has persisted
    channelsRising: number;             // # of energy channels rising together
    channelsTotal: number;
    maxSlopePer15m: number | null;      // steepest +log10 slope over any 15-min step
    usableHours: number;                // span of history actually available
  };
}

// ── Tunables ────────────────────────────────────────────────────────────────
// These are deliberately surfaced as named constants so the system can be
// calibrated against historical events without hunting through logic.

export const EPAM_WARN_CONFIG = {
  // How much history we try to use to define "quiet". A full week gives the
  // baseline enough quiet hours to be stable even if the last day or two were
  // active. If less is available we degrade gracefully.
  BASELINE_HOURS: 168,            // 7 days — the "full week" the analysis is built on

  // The recent window we judge against the baseline. Short enough to react,
  // long enough that a single bad reading cannot define it.
  RECENT_WINDOW_MIN: 45,          // ~3 ACE cadence steps

  // Quiet baseline is computed from the LOWER part of the week's distribution,
  // so that a few active days do not inflate "normal". We take the median of the
  // lowest `BASELINE_QUANTILE` fraction of log-flux samples.
  BASELINE_QUANTILE: 0.6,

  // Robust z-score thresholds (recent vs baseline, in MAD units).
  SIGMA_WATCH: 3,
  SIGMA_ELEVATED: 5,
  SIGMA_ONSET: 8,
  SIGMA_SHOCK: 12,

  // A departure must persist at least this long to count as "sustained" — this
  // is the single biggest false-positive killer for glitches and lone spikes.
  SUSTAINED_MIN: 30,

  // Rate-of-change (log10 flux per 15 minutes) thresholds. EPAM shock fronts
  // produce steep, near-vertical rises; SIRs and noise do not.
  SLOPE_ONSET: 0.30,              // ~2x in 15 min
  SLOPE_SHOCK: 0.60,              // ~4x in 15 min

  // How many of the supplied channels must be rising together to call it
  // "broadband". Cross-channel coincidence separates real particle events from
  // single-channel instrument artifacts.
  MIN_CHANNELS_RISING: 2,

  // MAD floor so that an unrealistically tight quiet period cannot make tiny
  // wiggles look like enormous sigma departures.
  MIN_LOG_MAD: 0.05,
} as const;

// ── Small numeric helpers ─────────────────────────────────────────────────────

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation, scaled to be comparable to a standard deviation. */
function mad(xs: number[], center: number): number | null {
  if (!xs.length) return null;
  const dev = xs.map((x) => Math.abs(x - center));
  const m = median(dev);
  return m === null ? null : m * 1.4826; // consistency constant for normal data
}

function quantile(xsSorted: number[], q: number): number | null {
  if (!xsSorted.length) return null;
  const idx = Math.min(xsSorted.length - 1, Math.max(0, Math.round((xsSorted.length - 1) * q)));
  return xsSorted[idx];
}

const LEVEL_LABELS: Record<WarnLevel, string> = {
  QUIET: 'Quiet',
  WATCH: 'Watch',
  ELEVATED: 'Elevated',
  ONSET: 'Storm Arrival Incoming',
  SHOCK: 'Shock',
};

const LEVEL_RANK: Record<WarnLevel, number> = {
  QUIET: 0, WATCH: 1, ELEVATED: 2, ONSET: 3, SHOCK: 4,
};

// ── Core: build samples from raw EPAM rows ────────────────────────────────────
// Caller passes raw rows + the channel keys to use (ACE protons by default).

export function toEpamSamples(
  rows: Array<Record<string, unknown>>,
  channelKeys: string[],
  parseTime: (s: string) => number,
): EpamSample[] {
  const out: EpamSample[] = [];
  for (const r of rows) {
    const t = parseTime(String(r['time_tag'] ?? ''));
    if (!Number.isFinite(t)) continue;
    const logCh = channelKeys.map((k) => {
      const v = r[k];
      return typeof v === 'number' && v > 0 ? Math.log10(v) : null;
    });
    const valid = logCh.filter((v): v is number => v !== null);
    const flux = valid.length ? Math.pow(10, valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    out.push({ t, flux, logCh });
  }
  // ascending time
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ── Core: compute the warning ─────────────────────────────────────────────────

export function computeEpamWarning(samples: EpamSample[]): EpamWarning {
  const cfg = EPAM_WARN_CONFIG;
  const now = samples.length ? samples[samples.length - 1].t : Date.now();

  const emptyDiag = {
    baselineLogMedian: null, baselineLogMad: null, recentLogMedian: null,
    sigmaAboveBaseline: null, sustainedMinutes: 0, channelsRising: 0,
    channelsTotal: samples[0]?.logCh.length ?? 0, maxSlopePer15m: null, usableHours: 0,
  };

  if (samples.length < 5) {
    return {
      level: 'QUIET', levelLabel: LEVEL_LABELS.QUIET, score: 0,
      headline: 'Not enough ACE EPAM data yet to assess.',
      detail: 'Waiting on more readings from the upstream satellite.',
      reasons: [], diagnostics: emptyDiag,
    };
  }

  const usableHours = (now - samples[0].t) / 3_600_000;

  // ── Baseline over the week (quiet-biased) ──────────────────────────────────
  const baseStart = now - cfg.BASELINE_HOURS * 3_600_000;
  const baseLogs = samples
    .filter((s) => s.t >= baseStart && s.flux !== null && s.flux > 0)
    .map((s) => Math.log10(s.flux as number))
    .sort((a, b) => a - b);

  // Use the lower fraction of the week to represent "quiet" so active days
  // don't inflate normal. Median + MAD of that quiet subset.
  const quietCut = quantile(baseLogs, cfg.BASELINE_QUANTILE);
  const quietLogs = quietCut === null ? baseLogs : baseLogs.filter((v) => v <= quietCut);
  const baselineLogMedian = median(quietLogs.length ? quietLogs : baseLogs);
  let baselineLogMad = baselineLogMedian === null
    ? null
    : mad(quietLogs.length ? quietLogs : baseLogs, baselineLogMedian);
  if (baselineLogMad !== null) baselineLogMad = Math.max(baselineLogMad, cfg.MIN_LOG_MAD);

  // ── Recent window ──────────────────────────────────────────────────────────
  const recentStart = now - cfg.RECENT_WINDOW_MIN * 60_000;
  const recent = samples.filter((s) => s.t >= recentStart);
  const recentLogs = recent
    .filter((s) => s.flux !== null && s.flux > 0)
    .map((s) => Math.log10(s.flux as number));
  const recentLogMedian = median(recentLogs);

  const sigmaAboveBaseline =
    baselineLogMedian !== null && baselineLogMad && recentLogMedian !== null
      ? (recentLogMedian - baselineLogMedian) / baselineLogMad
      : null;

  // ── Sustained elevation: how long has flux stayed above (baseline + WATCH σ)? ─
  let sustainedMinutes = 0;
  if (baselineLogMedian !== null && baselineLogMad) {
    const elevatedThresh = baselineLogMedian + cfg.SIGMA_WATCH * baselineLogMad;
    // Walk backwards from the latest sample while it stays above threshold.
    let earliest = now;
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i];
      if (s.flux === null || s.flux <= 0) continue;
      if (Math.log10(s.flux) >= elevatedThresh) earliest = s.t;
      else break;
    }
    sustainedMinutes = Math.max(0, (now - earliest) / 60_000);
  }

  // ── Rate of change: steepest +log10 slope per 15 min over the recent window ──
  const maxSlopePer15m = maxLogSlopePer15m(recent);

  // ── Cross-channel agreement: how many channels are rising right now? ─────────
  const channelsTotal = samples[0]?.logCh.length ?? 0;
  const channelsRising = countChannelsRising(samples, cfg.RECENT_WINDOW_MIN, cfg.BASELINE_HOURS, now);

  // ── Build reasons ────────────────────────────────────────────────────────────
  const reasons: WarnReason[] = [
    {
      key: 'magnitude',
      label: 'Above quiet baseline',
      active: sigmaAboveBaseline !== null && sigmaAboveBaseline >= cfg.SIGMA_WATCH,
      detail: sigmaAboveBaseline === null ? 'n/a' : `${sigmaAboveBaseline.toFixed(1)}σ vs 7-day quiet`,
    },
    {
      key: 'sustained',
      label: 'Sustained, not a glitch',
      active: sustainedMinutes >= cfg.SUSTAINED_MIN,
      detail: `${Math.round(sustainedMinutes)} min elevated`,
    },
    {
      key: 'broadband',
      label: 'Multiple channels rising',
      active: channelsRising >= cfg.MIN_CHANNELS_RISING,
      detail: `${channelsRising}/${channelsTotal} channels`,
    },
    {
      key: 'slope',
      label: 'Sharp rate of climb',
      active: maxSlopePer15m !== null && maxSlopePer15m >= cfg.SLOPE_ONSET,
      detail: maxSlopePer15m === null ? 'n/a' : `${maxSlopePer15m >= 0 ? '+' : ''}${maxSlopePer15m.toFixed(2)} log/15m`,
    },
  ];

  // ── Decide level via coincidence, not any single number ──────────────────────
  const sig = sigmaAboveBaseline ?? -Infinity;
  const slope = maxSlopePer15m ?? -Infinity;
  const sustained = sustainedMinutes >= cfg.SUSTAINED_MIN;
  const broadband = channelsRising >= cfg.MIN_CHANNELS_RISING;

  let level: WarnLevel = 'QUIET';

  // SHOCK: extreme magnitude AND a near-vertical broadband jump. This is the
  // unambiguous "it's here" case and is allowed to fire fast (no sustain needed,
  // because shock fronts are sudden by nature) — but still requires broadband
  // agreement so a single-channel spike cannot trigger it.
  if (sig >= cfg.SIGMA_SHOCK && slope >= cfg.SLOPE_SHOCK && broadband) {
    level = 'SHOCK';
  }
  // ONSET: a strong, fast, broadband rise that is beginning — the early-warning
  // sweet spot. Requires magnitude + steep slope + cross-channel agreement.
  else if (sig >= cfg.SIGMA_ONSET && slope >= cfg.SLOPE_ONSET && broadband) {
    level = 'ONSET';
  }
  // ELEVATED: clearly above baseline AND sustained AND broadband. No steep slope
  // required — this is the "something real is going on" steady state.
  else if (sig >= cfg.SIGMA_ELEVATED && sustained && broadband) {
    level = 'ELEVATED';
  }
  // WATCH: a departure has started but has not yet met the confirmation bar.
  // Either a modest magnitude departure, OR a steep slope that isn't yet
  // broadband/sustained. Deliberately easy to enter and easy to leave.
  else if (sig >= cfg.SIGMA_WATCH || (slope >= cfg.SLOPE_ONSET && sig >= cfg.SIGMA_WATCH * 0.7)) {
    level = 'WATCH';
  }

  // ── Continuous score (for sparklines / tuning), 0..100 ───────────────────────
  const sigScore = clamp01((sig - cfg.SIGMA_WATCH) / (cfg.SIGMA_SHOCK - cfg.SIGMA_WATCH)) * 45;
  const slopeScore = clamp01(slope / cfg.SLOPE_SHOCK) * 30;
  const sustainScore = clamp01(sustainedMinutes / 120) * 15;
  const bandScore = channelsTotal ? (channelsRising / channelsTotal) * 10 : 0;
  const score = Math.round(Math.min(100, sigScore + slopeScore + sustainScore + bandScore));

  return {
    level,
    levelLabel: LEVEL_LABELS[level],
    score: LEVEL_RANK[level] === 0 ? Math.min(score, 15) : score,
    headline: buildHeadline(level),
    detail: buildDetail(level, { sig, slope, sustainedMinutes, channelsRising, channelsTotal }),
    reasons,
    diagnostics: {
      baselineLogMedian, baselineLogMad, recentLogMedian, sigmaAboveBaseline,
      sustainedMinutes, channelsRising, channelsTotal, maxSlopePer15m, usableHours,
    },
  };
}

// ── Rate-of-change series for the "Rate of Change" chart view ──────────────────
// Returns log10(flux) slope per 15 minutes, evaluated at each sample using the
// nearest sample ~15 min earlier. This is the series the new ACE view plots.

export interface RocPoint { x: number; y: number | null; }

export function epamRateOfChange15m(samples: EpamSample[]): RocPoint[] {
  const WINDOW_MS = 15 * 60_000;
  const out: RocPoint[] = [];
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i];
    if (cur.flux === null || cur.flux <= 0) { out.push({ x: cur.t, y: null }); continue; }
    // find the sample closest to 15 min before cur.t
    const target = cur.t - WINDOW_MS;
    let best: EpamSample | null = null;
    let bestErr = Infinity;
    for (let j = i - 1; j >= 0; j--) {
      const s = samples[j];
      if (s.flux === null || s.flux <= 0) continue;
      const err = Math.abs(s.t - target);
      if (err < bestErr) { bestErr = err; best = s; }
      if (s.t < target - WINDOW_MS) break; // gone too far back
    }
    if (!best || bestErr > WINDOW_MS) { out.push({ x: cur.t, y: null }); continue; }
    const dtMin = (cur.t - best.t) / 60_000;
    if (dtMin <= 0) { out.push({ x: cur.t, y: null }); continue; }
    const dLog = Math.log10(cur.flux) - Math.log10(best.flux as number);
    // normalise to a per-15-minute slope
    out.push({ x: cur.t, y: (dLog / dtMin) * 15 });
  }
  return out;
}

// ── internal helpers ──────────────────────────────────────────────────────────

function maxLogSlopePer15m(recent: EpamSample[]): number | null {
  const roc = epamRateOfChange15m(recent).filter((p) => p.y !== null) as { x: number; y: number }[];
  if (!roc.length) return null;
  return roc.reduce((mx, p) => (p.y > mx ? p.y : mx), -Infinity);
}

function countChannelsRising(
  samples: EpamSample[],
  recentMin: number,
  baselineHours: number,
  now: number,
): number {
  const nCh = samples[0]?.logCh.length ?? 0;
  if (!nCh) return 0;
  const recentStart = now - recentMin * 60_000;
  const baseStart = now - baselineHours * 3_600_000;
  let rising = 0;
  for (let c = 0; c < nCh; c++) {
    const base: number[] = [];
    const rec: number[] = [];
    for (const s of samples) {
      const v = s.logCh[c];
      if (v === null) continue;
      if (s.t >= recentStart) rec.push(v);
      else if (s.t >= baseStart) base.push(v);
    }
    if (rec.length < 1 || base.length < 5) continue;
    const bSorted = [...base].sort((a, b) => a - b);
    const bMed = median(bSorted) ?? 0;
    let bMad = mad(base, bMed) ?? EPAM_WARN_CONFIG.MIN_LOG_MAD;
    bMad = Math.max(bMad, EPAM_WARN_CONFIG.MIN_LOG_MAD);
    const rMed = median(rec) ?? 0;
    if ((rMed - bMed) / bMad >= EPAM_WARN_CONFIG.SIGMA_WATCH) rising++;
  }
  return rising;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

// Plain-English headline — the big line a non-technical reader sees first.
// Says what it means and what to do, no numbers or jargon.
function buildHeadline(level: WarnLevel): string {
  switch (level) {
    case 'SHOCK':
      return 'A solar storm shock is hitting now. The disturbance is passing the upstream satellite — Earth-side effects are expected within the hour. Watch the magnetic field (Bz) and get ready if you are aurora hunting.';
    case 'ONSET':
      return 'A solar storm looks to be arriving. Particle levels are climbing fast and together — the classic lead-in to a CME shock reaching Earth. This is the time to start watching closely.';
    case 'ELEVATED':
      return 'Particle levels are up and staying up. Something real is happening upstream, but it has not turned into a sudden arrival yet. Worth keeping an eye on.';
    case 'WATCH':
      return 'Early signs of activity. Particle levels are just starting to lift above their normal background. It may be the front edge of an event, or it may settle back down — too soon to tell.';
    default:
      return 'All quiet. Particle levels are sitting at their normal background, with no sign of an incoming solar storm.';
  }
}

// Technical one-liner shown in smaller text beneath the headline — for the
// forecaster / power-user who wants the actual numbers behind the call.
function buildDetail(
  level: WarnLevel,
  m: { sig: number; slope: number; sustainedMinutes: number; channelsRising: number; channelsTotal: number },
): string {
  const sigTxt = Number.isFinite(m.sig) ? `${m.sig.toFixed(1)}σ above 7-day quiet baseline` : 'baseline still forming';
  const slopeTxt = Number.isFinite(m.slope) ? `${m.slope >= 0 ? '+' : ''}${m.slope.toFixed(2)} log/15m` : 'no slope';
  const chanTxt = `${m.channelsRising}/${m.channelsTotal} channels rising`;
  const sustTxt = `${Math.round(m.sustainedMinutes)} min elevated`;
  switch (level) {
    case 'SHOCK':
      return `Technical: ${sigTxt}, climbing ${slopeTxt} across ${chanTxt}.`;
    case 'ONSET':
      return `Technical: ${sigTxt}, ${slopeTxt}, ${chanTxt}.`;
    case 'ELEVATED':
      return `Technical: ${sigTxt}, ${sustTxt}, ${chanTxt}.`;
    case 'WATCH':
      return `Technical: ${sigTxt}, ${chanTxt} — not yet sustained or broadband enough to confirm.`;
    default:
      return `Technical: ${sigTxt}.`;
  }
}

export const EPAM_WARN_LEVEL_RANK = LEVEL_RANK;
// --- END OF FILE src/components/epamWarning.ts ---