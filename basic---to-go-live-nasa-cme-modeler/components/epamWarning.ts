// --- START OF FILE src/components/epamWarning.ts ---
//
// Robust client-side ACE EPAM early-warning engine for CME-shock arrival. (v2)
//
// WHY THIS EXISTS
// ---------------
// The server worker historically based its "elevated" decision on a short
// ~4-hour window. This module instead looks at the FULL WEEK of ACE EPAM to
// build a robust quiet-time baseline, then asks whether recent readings
// genuinely depart from it.
//
// V2: SEQUENCE-AWARE PATTERN RECOGNITION
// --------------------------------------
// A CME approach is a story told in stages, and EPAM forecasting is about the
// COMBINATION of behaviours, not isolated stats. The canonical sequence:
//
//   1. SEP onset with VELOCITY DISPERSION - high-energy channels (P7/P8) rise
//      before low-energy ones (P1/P3): fastest particles from a fresh solar
//      eruption arrive first. Earliest hint, hours to ~2 days out.
//   2. SUSTAINED ELEVATION - the plateau while the CME is in transit.
//   3. CHANNEL COMPRESSION - the spread between channels shrinks as the shock
//      approaches and accelerates low-energy particles locally ("the lines
//      converge").
//   4. PRE-ARRIVAL DEPRESSION - a temporary dip from the elevated plateau,
//      tens of minutes to a couple of hours before arrival. A dip from quiet
//      means nothing; a dip AFTER sustained elevation is a high-specificity
//      "brace" signal. (This is the EPAM-visible cousin of a Forbush
//      precursor; a TRUE Forbush decrease is a galactic-cosmic-ray drop and is
//      detected separately from neutron-monitor data below.)
//   5. ESP SPIKE - the sudden broadband jump at shock arrival.
//
// The engine runs a detector for each signature, then a SEQUENCE layer
// combines them: when earlier stages have fired, the thresholds for calling
// the next stage are lowered (balanced boost, capped). That is how the system
// gets EARLIER without more false positives - sensitivity is only granted
// when prior stages have earned it. The user's exact pattern (elevated → dip
// → sudden rise) is additionally encoded as an explicit fast-path to
// "Storm Arrival Incoming".
//
// V3: CROSS-SPACECRAFT CONFIRMATION (SOLAR-1 / IMAP)
// --------------------------------------------------
// computeEpamWarning now optionally accepts raw samples from INDEPENDENT L1
// particle sources (SOLAR-1 EPAM and IMAP EPAM via the worker's HAPI feeds).
// Each confirmation source is judged against ITS OWN 7-day quiet baseline -
// never against the primary source's - so a confirmation means two physically
// separate instruments independently agree that particles are elevated.
//
//   • Each independently-elevated spacecraft adds context units to the
//     sequence booster (same capped mechanism as dispersion/compression/FD),
//     so confirmed signals escalate earlier WITHOUT raising false positives:
//     a glitch on one spacecraft cannot be confirmed by another.
//   • Confirmation state is surfaced as chips, in the technical detail line,
//     and in diagnostics.confirmations for the UI.
//   • If confirmation feeds are unavailable, everything degrades gracefully
//     to single-spacecraft behaviour (the pre-v3 logic, unchanged).
//
// NEUTRON-MONITOR (FORBUSH) INPUT
// -------------------------------
// computeEpamWarning optionally accepts ground neutron-monitor count data
// (e.g. OULU via NMDB). A genuine Forbush decrease onset - counts dropping
// >~1.5% below their own 7-day baseline and still falling - confirms that a
// large magnetic structure is sweeping cosmic rays away near Earth, and feeds
// the sequence booster. If the feed is unavailable, everything else still
// works; the FD signature simply reports unavailable.
//
// All EPAM math is done in log10 space because flux spans many orders of
// magnitude.

// ── Public types ──────────────────────────────────────────────────────────────

export interface EpamSample {
  /** epoch ms (UTC) */
  t: number;
  /** geometric-mean flux across the proton channels supplied, or null */
  flux: number | null;
  /** per-channel log10 flux (ascending energy order), null where missing */
  logCh: (number | null)[];
}

/** Ground neutron-monitor sample (for true Forbush-decrease detection). */
export interface NmSample {
  /** epoch ms (UTC) */
  t: number;
  /** count rate (counts/s, efficiency-corrected) */
  counts: number;
}

export type WarnLevel = 'QUIET' | 'WATCH' | 'ELEVATED' | 'ONSET' | 'SHOCK';

/** Raw samples from an independent confirmation spacecraft (SOLAR-1, IMAP…). */
export interface EpamConfirmationInput {
  /** stable key, e.g. 'solar1' | 'imap' */
  key: string;
  /** display label, e.g. 'SOLAR-1' | 'IMAP' */
  label: string;
  samples: EpamSample[];
}

/** Result of judging one confirmation spacecraft against its own baseline. */
export interface SourceConfirmation {
  key: string;
  label: string;
  /** enough fresh data to judge */
  available: boolean;
  /** independently elevated vs its own 7-day quiet baseline */
  elevated: boolean;
  sigma: number | null;
  channelsRising: number;
}

export interface WarnReason {
  key: string;
  label: string;
  active: boolean;
  detail: string;
}

export interface EpamWarning {
  level: WarnLevel;
  levelLabel: string;
  /** 0..100 continuous confidence score */
  score: number;
  /** plain-language banner headline */
  headline: string;
  /** technical one-liner beneath the headline */
  detail: string;
  reasons: WarnReason[];
  diagnostics: {
    baselineLogMedian: number | null;
    baselineLogMad: number | null;
    recentLogMedian: number | null;
    sigmaAboveBaseline: number | null;
    sustainedMinutes: number;
    channelsRising: number;
    channelsTotal: number;
    maxSlopePer15m: number | null;
    usableHours: number;
    // v2 sequence diagnostics
    dispersionLeadMin: number | null;   // how far high channels led low ones
    spreadRecent: number | null;        // current inter-channel log spread
    spreadPast: number | null;          // spread 8–14h ago
    dipDepthLog: number | null;         // depth of pre-arrival depression
    fdPctNow: number | null;            // neutron monitor % vs its 7-day baseline
    nmAvailable: boolean;
    thresholdBoost: number;             // 0..0.35 - how much the sequence lowered the bars
    // v3 cross-spacecraft confirmation diagnostics
    confirmations: SourceConfirmation[];
    confirmedCount: number;             // sources that independently confirm elevation
  };
}

// ── Tunables ────────────────────────────────────────────────────────────────

export const EPAM_WARN_CONFIG = {
  BASELINE_HOURS: 168,          // 7 days - the full week the analysis is built on
  RECENT_WINDOW_MIN: 45,
  BASELINE_QUANTILE: 0.6,

  SIGMA_WATCH: 3,
  SIGMA_ELEVATED: 5,
  SIGMA_ONSET: 8,
  SIGMA_SHOCK: 12,

  SUSTAINED_MIN: 30,

  SLOPE_ONSET: 0.30,            // ~2x in 15 min
  SLOPE_SHOCK: 0.60,            // ~4x in 15 min

  MIN_CHANNELS_RISING: 2,
  MIN_LOG_MAD: 0.05,

  // ── v2: signature detectors ──
  // Velocity dispersion: high-energy onset must lead low-energy onset by this
  // much, within this lookback, to count.
  DISPERSION_LEAD_MIN: 30,
  DISPERSION_LOOKBACK_H: 48,
  ONSET_EPISODE_MIN: 15,        // a channel "onset" must persist this long

  // Channel compression: recent spread must shrink to this fraction of the
  // earlier spread, while flux is elevated.
  COMPRESSION_RATIO: 0.75,
  COMPRESSION_MIN_PAST_SPREAD: 0.4,   // channels must have been spread out before
  COMPRESSION_RECENT_H: 2,
  COMPRESSION_PAST_FROM_H: 14,
  COMPRESSION_PAST_TO_H: 8,

  // Pre-arrival depression: dip of at least this many log units from the
  // recent elevated plateau, while still above quiet (so it's a dip from
  // elevation, not ordinary decay back to background).
  DIP_DEPTH_LOG: 0.12,                // ≈ −24%
  DIP_PLATEAU_FROM_H: 8,
  DIP_PLATEAU_TO_H: 1.5,
  DIP_RECENT_MIN: 30,
  DIP_PLATEAU_MIN_SIGMA: 3,           // plateau must have been genuinely elevated
  DIP_FLOOR_SIGMA: 1.5,               // dip must stay above quiet by this much
  DIP_MEMORY_H: 2.5,                  // a dip within this window still arms the fast-path
  // Slope required for the dip→rise fast-path. Lower than SLOPE_ONSET because
  // a confirmed post-elevation dip already supplies the specificity - a climb
  // out of it does not need to be as steep as a cold-start spike to carry the
  // same meaning. ≈ +50% in 15 minutes.
  DIP_RISE_SLOPE: 0.18,

  // Forbush decrease (neutron monitor): % below its own 7-day baseline.
  FD_ONSET_PCT: -1.5,
  FD_PREDECREASE_PCT: -0.8,
  FD_DECLINE_PCT: 0.5,                // must be lower than ~3h ago by this much
  FD_BASELINE_EXCLUDE_H: 24,          // exclude last 24h from the NM baseline

  // ── v2: balanced sequence boost ──
  // Context units: compression +1, dispersion +1, depression +1.5,
  // FD onset +1.5 (pre-decrease +0.75). boost = min(CAP, RATE × units).
  BOOST_RATE: 0.10,
  BOOST_CAP: 0.35,

  // ── v3: cross-spacecraft confirmation (SOLAR-1 / IMAP EPAM) ──
  // Each independent spacecraft that is ALSO elevated (vs its own 7-day quiet
  // baseline) adds this many context units to the sequence booster (max 2
  // confirming sources counted).
  CONFIRM_UNIT: 1.0,
  CONFIRM_MIN_SAMPLES: 30,      // need this many samples to judge a source
  CONFIRM_MAX_AGE_MIN: 180,     // newest sample must be fresher than this
} as const;

// ── Small numeric helpers ─────────────────────────────────────────────────────

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mad(xs: number[], center: number): number | null {
  if (!xs.length) return null;
  const dev = xs.map((x) => Math.abs(x - center));
  const m = median(dev);
  return m === null ? null : m * 1.4826;
}

function quantile(xsSorted: number[], q: number): number | null {
  if (!xsSorted.length) return null;
  const idx = Math.min(xsSorted.length - 1, Math.max(0, Math.round((xsSorted.length - 1) * q)));
  return xsSorted[idx];
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

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

// ── Build samples from raw EPAM rows ──────────────────────────────────────────

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
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ── Core: compute the warning ─────────────────────────────────────────────────

export function computeEpamWarning(
  samples: EpamSample[],
  nm?: NmSample[] | null,
  confirmSources?: EpamConfirmationInput[] | null,
): EpamWarning {
  const cfg = EPAM_WARN_CONFIG;
  const now = samples.length ? samples[samples.length - 1].t : Date.now();

  const emptyDiag = {
    baselineLogMedian: null, baselineLogMad: null, recentLogMedian: null,
    sigmaAboveBaseline: null, sustainedMinutes: 0, channelsRising: 0,
    channelsTotal: samples[0]?.logCh.length ?? 0, maxSlopePer15m: null, usableHours: 0,
    dispersionLeadMin: null, spreadRecent: null, spreadPast: null,
    dipDepthLog: null, fdPctNow: null, nmAvailable: false, thresholdBoost: 0,
    confirmations: [] as SourceConfirmation[], confirmedCount: 0,
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

  // ── Baseline over the week (quiet-biased) ───────────────────────────────────
  const baseStart = now - cfg.BASELINE_HOURS * 3_600_000;
  const baseLogs = samples
    .filter((s) => s.t >= baseStart && s.flux !== null && s.flux > 0)
    .map((s) => Math.log10(s.flux as number))
    .sort((a, b) => a - b);

  const quietCut = quantile(baseLogs, cfg.BASELINE_QUANTILE);
  const quietLogs = quietCut === null ? baseLogs : baseLogs.filter((v) => v <= quietCut);
  const baselineLogMedian = median(quietLogs.length ? quietLogs : baseLogs);
  let baselineLogMad = baselineLogMedian === null
    ? null
    : mad(quietLogs.length ? quietLogs : baseLogs, baselineLogMedian);
  if (baselineLogMad !== null) baselineLogMad = Math.max(baselineLogMad, cfg.MIN_LOG_MAD);

  // ── Recent window ───────────────────────────────────────────────────────────
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

  // ── Sustained elevation ─────────────────────────────────────────────────────
  let sustainedMinutes = 0;
  if (baselineLogMedian !== null && baselineLogMad) {
    const elevatedThresh = baselineLogMedian + cfg.SIGMA_WATCH * baselineLogMad;
    let earliest = now;
    for (let i = samples.length - 1; i >= 0; i--) {
      const s = samples[i];
      if (s.flux === null || s.flux <= 0) continue;
      if (Math.log10(s.flux) >= elevatedThresh) earliest = s.t;
      else break;
    }
    sustainedMinutes = Math.max(0, (now - earliest) / 60_000);
  }

  // ── Rate of change ──────────────────────────────────────────────────────────
  const maxSlopePer15m = maxLogSlopePer15m(recent);

  // ── Cross-channel agreement ─────────────────────────────────────────────────
  const channelsTotal = samples[0]?.logCh.length ?? 0;
  const channelsRising = countChannelsRising(samples, cfg.RECENT_WINDOW_MIN, cfg.BASELINE_HOURS, now);

  // ════ v2 SIGNATURE DETECTORS ════════════════════════════════════════════════

  // 1. Velocity dispersion - high-energy channels rose before low-energy ones.
  const dispersion = detectDispersion(samples, now);

  // 3. Channel compression - inter-channel spread shrinking while elevated.
  const compression = detectCompression(samples, now, sigmaAboveBaseline);

  // 4. Pre-arrival depression - a dip from the elevated plateau (now, or
  //    recently enough that a rise out of it is still the user's dip→spike
  //    pattern).
  const dipNow = detectDepression(samples, now, baselineLogMedian, baselineLogMad);
  let dipRecent = dipNow.detected;
  if (!dipRecent) {
    // check half-hour steps back through DIP_MEMORY_H
    for (let back = 30; back <= cfg.DIP_MEMORY_H * 60; back += 30) {
      const ref = now - back * 60_000;
      const past = samples.filter((s) => s.t <= ref);
      if (past.length < 5) break;
      if (detectDepression(past, ref, baselineLogMedian, baselineLogMad).detected) { dipRecent = true; break; }
    }
  }

  // True Forbush decrease - neutron monitor counts vs their own 7-day baseline.
  const fd = detectForbush(nm ?? null, now);

  // ════ v3: CROSS-SPACECRAFT CONFIRMATION (SOLAR-1 / IMAP) ════════════════════
  // Each confirmation source is judged against ITS OWN 7-day quiet baseline at
  // the SAME reference time as the primary - simultaneous, independent
  // agreement is what makes a confirmation meaningful.
  const confirmations: SourceConfirmation[] = (confirmSources ?? []).map((src) =>
    assessConfirmationSource(src, now),
  );
  const confirmedCount = confirmations.filter((c) => c.available && c.elevated).length;
  const availableConfirmCount = confirmations.filter((c) => c.available).length;

  // ════ BALANCED SEQUENCE BOOST ═══════════════════════════════════════════════
  // Earlier stages lower the bars for later ones - capped, and only granted
  // when independent physics has actually fired.
  let contextUnits = 0;
  if (compression.detected) contextUnits += 1.0;
  if (dispersion.detected) contextUnits += 1.0;
  if (dipRecent) contextUnits += 1.5;
  if (fd.onset) contextUnits += 1.5;
  else if (fd.preDecrease) contextUnits += 0.75;
  // v3: independent spacecraft confirming elevation. A second (and third)
  // instrument agreeing is the cleanest false-positive killer there is, so it
  // earns the same kind of capped sensitivity bonus as the physics signatures.
  contextUnits += cfg.CONFIRM_UNIT * Math.min(2, confirmedCount);
  const boost = Math.min(cfg.BOOST_CAP, cfg.BOOST_RATE * contextUnits);

  const SIGMA_ONSET_EFF = cfg.SIGMA_ONSET * (1 - boost);
  const SLOPE_ONSET_EFF = cfg.SLOPE_ONSET * (1 - boost);
  const SIGMA_ELEVATED_EFF = cfg.SIGMA_ELEVATED * (1 - boost / 2);
  const SIGMA_SHOCK_EFF = cfg.SIGMA_SHOCK * (1 - boost / 2);
  const SLOPE_SHOCK_EFF = cfg.SLOPE_SHOCK * (1 - boost / 2);

  // ── Reasons (chips) ─────────────────────────────────────────────────────────
  const reasons: WarnReason[] = [
    {
      key: 'magnitude', label: 'Above quiet baseline',
      active: sigmaAboveBaseline !== null && sigmaAboveBaseline >= cfg.SIGMA_WATCH,
      detail: sigmaAboveBaseline === null ? 'n/a' : `${sigmaAboveBaseline.toFixed(1)}σ vs 7-day quiet`,
    },
    {
      key: 'sustained', label: 'Sustained, not a glitch',
      active: sustainedMinutes >= cfg.SUSTAINED_MIN,
      detail: `${Math.round(sustainedMinutes)} min elevated`,
    },
    {
      key: 'broadband', label: 'Multiple channels rising',
      active: channelsRising >= cfg.MIN_CHANNELS_RISING,
      detail: `${channelsRising}/${channelsTotal} channels`,
    },
    {
      key: 'slope', label: 'Sharp rate of climb',
      active: maxSlopePer15m !== null && maxSlopePer15m >= SLOPE_ONSET_EFF,
      detail: maxSlopePer15m === null ? 'n/a' : `${maxSlopePer15m >= 0 ? '+' : ''}${maxSlopePer15m.toFixed(2)} log/15m`,
    },
    {
      key: 'dispersion', label: 'Fast particles arrived first',
      active: dispersion.detected,
      detail: dispersion.leadMin === null ? 'not seen' : `high channels led by ${Math.round(dispersion.leadMin)} min`,
    },
    {
      key: 'compression', label: 'Channels converging',
      active: compression.detected,
      detail: compression.spreadRecent === null || compression.spreadPast === null
        ? 'n/a'
        : `spread ${compression.spreadPast.toFixed(2)}→${compression.spreadRecent.toFixed(2)} log`,
    },
    {
      key: 'depression', label: 'Dip after elevation',
      active: dipRecent,
      detail: dipNow.depthLog === null
        ? (dipRecent ? 'dip within last 2.5h' : 'not seen')
        : `−${dipNow.depthLog.toFixed(2)} log from plateau`,
    },
    {
      key: 'forbush', label: 'Cosmic-ray decrease (Forbush)',
      active: fd.onset,
      detail: !fd.available ? 'monitor feed unavailable'
        : fd.pctNow === null ? 'n/a'
        : `${fd.pctNow.toFixed(1)}% vs 7-day baseline${fd.preDecrease && !fd.onset ? ' (pre-decrease)' : ''}`,
    },
  ];

  // v3: one chip per confirmation spacecraft (SOLAR-1 / IMAP) - judged against
  // its own baseline, so "active" here means a genuinely independent vote.
  for (const c of confirmations) {
    reasons.push({
      key: `confirm_${c.key}`,
      label: `${c.label} confirms`,
      active: c.available && c.elevated,
      detail: !c.available
        ? 'no fresh data'
        : c.elevated
          ? `also elevated${c.sigma !== null ? ` (${c.sigma.toFixed(1)}σ)` : ''}, ${c.channelsRising} ch rising`
          : `quiet${c.sigma !== null ? ` (${c.sigma.toFixed(1)}σ)` : ''}`,
    });
  }

  // ── Decide level - coincidence plus sequence-armed fast paths ───────────────
  const sig = sigmaAboveBaseline ?? -Infinity;
  const slope = maxSlopePer15m ?? -Infinity;
  const sustained = sustainedMinutes >= cfg.SUSTAINED_MIN;
  const broadband = channelsRising >= cfg.MIN_CHANNELS_RISING;

  let level: WarnLevel = 'QUIET';

  if (sig >= SIGMA_SHOCK_EFF && slope >= SLOPE_SHOCK_EFF && broadband) {
    level = 'SHOCK';
  }
  else if (sig >= SIGMA_ONSET_EFF && slope >= SLOPE_ONSET_EFF && broadband) {
    level = 'ONSET';
  }
  // FAST PATH - the elevated → dip → sudden rise pattern. Climbing out of a
  // recent dip, sigma lags the physics (the recent-window median still
  // includes dip samples), so when a recent dip has armed the system, a
  // broadband climb of ≥ DIP_RISE_SLOPE from a previously-elevated state is
  // called ONSET even below the sigma/slope bars. This is the single
  // highest-specificity pre-arrival pattern EPAM offers.
  else if (dipRecent && slope >= cfg.DIP_RISE_SLOPE && broadband && sig >= cfg.SIGMA_WATCH) {
    level = 'ONSET';
  }
  else if (sig >= SIGMA_ELEVATED_EFF && sustained && broadband) {
    level = 'ELEVATED';
  }
  else if (sig >= cfg.SIGMA_WATCH || (slope >= SLOPE_ONSET_EFF && sig >= cfg.SIGMA_WATCH * 0.7)) {
    level = 'WATCH';
  }

  // ── Continuous score ────────────────────────────────────────────────────────
  const sigScore = clamp01((sig - cfg.SIGMA_WATCH) / (cfg.SIGMA_SHOCK - cfg.SIGMA_WATCH)) * 40;
  const slopeScore = clamp01(slope / cfg.SLOPE_SHOCK) * 25;
  const sustainScore = clamp01(sustainedMinutes / 120) * 12;
  const bandScore = channelsTotal ? (channelsRising / channelsTotal) * 8 : 0;
  const seqScore = clamp01(boost / cfg.BOOST_CAP) * 15;
  const score = Math.round(Math.min(100, sigScore + slopeScore + sustainScore + bandScore + seqScore));

  let detail = buildDetail(level, { sig, slope, sustainedMinutes, channelsRising, channelsTotal, boost, fdPct: fd.pctNow, dipRecent });
  if (availableConfirmCount > 0) {
    const names = confirmations.filter((c) => c.available && c.elevated).map((c) => c.label);
    if (names.length) {
      detail += ` Independently confirmed by ${names.join(' + ')}.`;
    } else if (LEVEL_RANK[level] >= LEVEL_RANK.ELEVATED) {
      detail += ' Other spacecraft are quiet - single-source signal, treat with some caution.';
    }
  }

  return {
    level,
    levelLabel: LEVEL_LABELS[level],
    score: LEVEL_RANK[level] === 0 ? Math.min(score, 15) : score,
    headline: buildHeadline(level),
    detail,
    reasons,
    diagnostics: {
      baselineLogMedian, baselineLogMad, recentLogMedian, sigmaAboveBaseline,
      sustainedMinutes, channelsRising, channelsTotal, maxSlopePer15m, usableHours,
      dispersionLeadMin: dispersion.leadMin,
      spreadRecent: compression.spreadRecent,
      spreadPast: compression.spreadPast,
      dipDepthLog: dipNow.depthLog,
      fdPctNow: fd.pctNow,
      nmAvailable: fd.available,
      thresholdBoost: boost,
      confirmations,
      confirmedCount,
    },
  };
}

// ── Rate-of-change series (chart view) ────────────────────────────────────────

export interface RocPoint { x: number; y: number | null; }

export function epamRateOfChange15m(samples: EpamSample[]): RocPoint[] {
  const WINDOW_MS = 15 * 60_000;
  const out: RocPoint[] = [];
  for (let i = 0; i < samples.length; i++) {
    const cur = samples[i];
    if (cur.flux === null || cur.flux <= 0) { out.push({ x: cur.t, y: null }); continue; }
    const target = cur.t - WINDOW_MS;
    let best: EpamSample | null = null;
    let bestErr = Infinity;
    for (let j = i - 1; j >= 0; j--) {
      const s = samples[j];
      if (s.flux === null || s.flux <= 0) continue;
      const err = Math.abs(s.t - target);
      if (err < bestErr) { bestErr = err; best = s; }
      if (s.t < target - WINDOW_MS) break;
    }
    if (!best || bestErr > WINDOW_MS) { out.push({ x: cur.t, y: null }); continue; }
    const dtMin = (cur.t - best.t) / 60_000;
    if (dtMin <= 0) { out.push({ x: cur.t, y: null }); continue; }
    const dLog = Math.log10(cur.flux) - Math.log10(best.flux as number);
    out.push({ x: cur.t, y: (dLog / dtMin) * 15 });
  }
  return out;
}

// ── Neutron-monitor parsing (NMDB NEST ascii output) ─────────────────────────
// Defensive: accepts lines of "YYYY-MM-DD HH:MM:SS;value", skips everything
// else. Exposed so the panel (and tests) can share one parser.

export function parseNmAscii(text: string): NmSample[] {
  const out: NmSample[] = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*;\s*([-\d.eE]+)/);
    if (!m) continue;
    const t = Date.parse(`${m[1]}T${m[2].length === 5 ? m[2] + ':00' : m[2]}Z`);
    const counts = parseFloat(m[3]);
    if (Number.isFinite(t) && Number.isFinite(counts) && counts > 0) out.push({ t, counts });
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

// ── v2 detectors ──────────────────────────────────────────────────────────────

function detectDispersion(
  samples: EpamSample[],
  now: number,
): { detected: boolean; leadMin: number | null } {
  const cfg = EPAM_WARN_CONFIG;
  const nCh = samples[0]?.logCh.length ?? 0;
  if (nCh < 4) return { detected: false, leadMin: null };
  const lookStart = now - cfg.DISPERSION_LOOKBACK_H * 3_600_000;

  // Per-channel quiet stats over the full week, then find the start of each
  // channel's most recent elevated episode within the lookback.
  const onsets: (number | null)[] = [];
  for (let c = 0; c < nCh; c++) {
    const weekVals: number[] = [];
    for (const s of samples) { const v = s.logCh[c]; if (v !== null) weekVals.push(v); }
    if (weekVals.length < 20) { onsets.push(null); continue; }
    const med = median(weekVals)!;
    const m = Math.max(mad(weekVals, med) ?? cfg.MIN_LOG_MAD, cfg.MIN_LOG_MAD);
    const thresh = med + 3 * m;

    // Walk backwards: find the contiguous elevated run that includes the most
    // recent elevated sample; onset = start of that run. Run must last long
    // enough to be real.
    let runEnd = -1;
    for (let i = samples.length - 1; i >= 0; i--) {
      const v = samples[i].logCh[c];
      if (v === null) continue;
      if (v >= thresh) { runEnd = i; break; }
      if (samples[i].t < lookStart) break;
    }
    if (runEnd < 0 || samples[runEnd].t < lookStart) { onsets.push(null); continue; }
    let runStart = runEnd;
    for (let i = runEnd; i >= 0; i--) {
      const v = samples[i].logCh[c];
      if (v === null) continue;
      if (v >= thresh) runStart = i; else break;
    }
    const durMin = (samples[runEnd].t - samples[runStart].t) / 60_000;
    onsets.push(durMin >= cfg.ONSET_EPISODE_MIN ? samples[runStart].t : null);
  }

  // Compare onset time of the high-energy half vs the low-energy half.
  const half = Math.floor(nCh / 2);
  const lowOnsets = onsets.slice(0, half).filter((v): v is number => v !== null);
  const highOnsets = onsets.slice(nCh - half).filter((v): v is number => v !== null);
  if (!lowOnsets.length || !highOnsets.length) return { detected: false, leadMin: null };
  const lowMean = lowOnsets.reduce((a, b) => a + b, 0) / lowOnsets.length;
  const highMean = highOnsets.reduce((a, b) => a + b, 0) / highOnsets.length;
  const leadMin = (lowMean - highMean) / 60_000; // positive = high channels led
  return { detected: leadMin >= cfg.DISPERSION_LEAD_MIN, leadMin };
}

function detectCompression(
  samples: EpamSample[],
  now: number,
  sigma: number | null,
): { detected: boolean; spreadRecent: number | null; spreadPast: number | null } {
  const cfg = EPAM_WARN_CONFIG;
  const spreadOver = (fromMs: number, toMs: number): number | null => {
    const vals: number[] = [];
    for (const s of samples) {
      if (s.t < fromMs || s.t > toMs) continue;
      const ch = s.logCh.filter((v): v is number => v !== null);
      if (ch.length < 3) continue;
      vals.push(Math.max(...ch) - Math.min(...ch));
    }
    return median(vals);
  };
  const spreadRecent = spreadOver(now - cfg.COMPRESSION_RECENT_H * 3_600_000, now);
  const spreadPast = spreadOver(now - cfg.COMPRESSION_PAST_FROM_H * 3_600_000, now - cfg.COMPRESSION_PAST_TO_H * 3_600_000);
  const elevated = sigma !== null && sigma >= 2;
  const detected =
    elevated &&
    spreadRecent !== null && spreadPast !== null &&
    spreadPast >= cfg.COMPRESSION_MIN_PAST_SPREAD &&
    spreadRecent <= spreadPast * cfg.COMPRESSION_RATIO;
  return { detected, spreadRecent, spreadPast };
}

function detectDepression(
  samples: EpamSample[],
  refNow: number,
  baseMed: number | null,
  baseMad: number | null,
): { detected: boolean; depthLog: number | null } {
  const cfg = EPAM_WARN_CONFIG;
  if (baseMed === null || !baseMad) return { detected: false, depthLog: null };
  const logsIn = (fromMs: number, toMs: number): number[] => {
    const out: number[] = [];
    for (const s of samples) {
      if (s.t < fromMs || s.t > toMs || s.flux === null || s.flux <= 0) continue;
      out.push(Math.log10(s.flux));
    }
    return out;
  };
  const plateauLogs = logsIn(refNow - cfg.DIP_PLATEAU_FROM_H * 3_600_000, refNow - cfg.DIP_PLATEAU_TO_H * 3_600_000);
  const recentLogs = logsIn(refNow - cfg.DIP_RECENT_MIN * 60_000, refNow);
  if (plateauLogs.length < 10 || recentLogs.length < 4) return { detected: false, depthLog: null };
  const plateau = median(plateauLogs)!;
  const recentMed = median(recentLogs)!;
  const plateauElevated = plateau >= baseMed + cfg.DIP_PLATEAU_MIN_SIGMA * baseMad;
  const stillAboveQuiet = recentMed >= baseMed + cfg.DIP_FLOOR_SIGMA * baseMad;
  const depth = plateau - recentMed;
  const detected = plateauElevated && stillAboveQuiet && depth >= cfg.DIP_DEPTH_LOG;
  return { detected, depthLog: detected ? depth : (depth > 0 ? depth : null) };
}

function detectForbush(
  nm: NmSample[] | null,
  now: number,
): { available: boolean; onset: boolean; preDecrease: boolean; pctNow: number | null } {
  const cfg = EPAM_WARN_CONFIG;
  if (!nm || nm.length < 100) return { available: false, onset: false, preDecrease: false, pctNow: null };
  const weekStart = now - cfg.BASELINE_HOURS * 3_600_000;
  const baseEnd = now - cfg.FD_BASELINE_EXCLUDE_H * 3_600_000;
  const baseCounts = nm.filter((s) => s.t >= weekStart && s.t <= baseEnd).map((s) => s.counts);
  if (baseCounts.length < 50) return { available: false, onset: false, preDecrease: false, pctNow: null };
  const base = median(baseCounts)!;
  if (!(base > 0)) return { available: false, onset: false, preDecrease: false, pctNow: null };

  const medIn = (fromMs: number, toMs: number): number | null =>
    median(nm.filter((s) => s.t >= fromMs && s.t <= toMs).map((s) => s.counts));

  const nowMed = medIn(now - 60 * 60_000, now);
  const agoMed = medIn(now - 4 * 3_600_000, now - 3 * 3_600_000);
  if (nowMed === null) return { available: true, onset: false, preDecrease: false, pctNow: null };

  const pctNow = ((nowMed - base) / base) * 100;
  const pctAgo = agoMed === null ? null : ((agoMed - base) / base) * 100;
  const declining = pctAgo === null ? true : pctNow <= pctAgo - cfg.FD_DECLINE_PCT;

  const onset = pctNow <= cfg.FD_ONSET_PCT && declining;
  const preDecrease = !onset && pctNow <= cfg.FD_PREDECREASE_PCT && declining;
  return { available: true, onset, preDecrease, pctNow };
}

// ── v3: cross-spacecraft confirmation ─────────────────────────────────────────
// Judges one independent spacecraft (SOLAR-1 EPAM, IMAP, …) against ITS OWN
// 7-day quiet-biased baseline at the primary feed's reference time `now`.
// A source "confirms" when its recent flux sits ≥ SIGMA_WATCH above its own
// baseline AND at least MIN_CHANNELS_RISING of its channels are rising - i.e.
// the same physics, measured by different hardware. Sources with too little or
// too stale data report unavailable and never count against confirmation.

function assessConfirmationSource(
  src: EpamConfirmationInput,
  now: number,
): SourceConfirmation {
  const cfg = EPAM_WARN_CONFIG;
  const unavailable: SourceConfirmation = {
    key: src.key, label: src.label,
    available: false, elevated: false, sigma: null, channelsRising: 0,
  };

  const samples = src.samples ?? [];
  if (samples.length < cfg.CONFIRM_MIN_SAMPLES) return unavailable;

  const newest = samples[samples.length - 1].t;
  if (now - newest > cfg.CONFIRM_MAX_AGE_MIN * 60_000) return unavailable;

  // Quiet-biased baseline over this source's own week of data.
  const baseStart = now - cfg.BASELINE_HOURS * 3_600_000;
  const baseLogs = samples
    .filter((s) => s.t >= baseStart && s.flux !== null && s.flux > 0)
    .map((s) => Math.log10(s.flux as number))
    .sort((a, b) => a - b);
  if (baseLogs.length < cfg.CONFIRM_MIN_SAMPLES) return unavailable;

  const quietCut = quantile(baseLogs, cfg.BASELINE_QUANTILE);
  const quietLogs = quietCut === null ? baseLogs : baseLogs.filter((v) => v <= quietCut);
  const baseMed = median(quietLogs.length ? quietLogs : baseLogs);
  let baseMad = baseMed === null ? null : mad(quietLogs.length ? quietLogs : baseLogs, baseMed);
  if (baseMad !== null) baseMad = Math.max(baseMad, cfg.MIN_LOG_MAD);

  // Recent window, same as the primary detector uses.
  const recentStart = now - cfg.RECENT_WINDOW_MIN * 60_000;
  const recentLogs = samples
    .filter((s) => s.t >= recentStart && s.flux !== null && s.flux > 0)
    .map((s) => Math.log10(s.flux as number));
  const recMed = median(recentLogs);

  const sigma =
    baseMed !== null && baseMad && recMed !== null
      ? (recMed - baseMed) / baseMad
      : null;

  const channelsRising = countChannelsRising(samples, cfg.RECENT_WINDOW_MIN, cfg.BASELINE_HOURS, now);

  const elevated =
    sigma !== null && sigma >= cfg.SIGMA_WATCH && channelsRising >= cfg.MIN_CHANNELS_RISING;

  return { key: src.key, label: src.label, available: true, elevated, sigma, channelsRising };
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
    const bMed = median(base) ?? 0;
    let bMad = mad(base, bMed) ?? EPAM_WARN_CONFIG.MIN_LOG_MAD;
    bMad = Math.max(bMad, EPAM_WARN_CONFIG.MIN_LOG_MAD);
    const rMed = median(rec) ?? 0;
    if ((rMed - bMed) / bMad >= EPAM_WARN_CONFIG.SIGMA_WATCH) rising++;
  }
  return rising;
}

// ── Wording ───────────────────────────────────────────────────────────────────
// Plain-English headline first; technical detail in a separate smaller line.

function buildHeadline(level: WarnLevel): string {
  switch (level) {
    case 'SHOCK':
      return 'A solar storm shock is hitting now. The disturbance is passing the upstream satellite - Earth-side effects are expected within the hour. Watch the magnetic field (Bz) and get ready if you are aurora hunting.';
    case 'ONSET':
      return 'A solar storm looks to be arriving. Particle levels are climbing fast and together - the classic lead-in to a CME shock reaching Earth. This is the time to start watching closely.';
    case 'ELEVATED':
      return 'Particle levels are up and staying up. Something real is happening upstream, but it has not turned into a sudden arrival yet. Worth keeping an eye on.';
    case 'WATCH':
      return 'Early signs of activity. Particle levels are just starting to lift above their normal background. It may be the front edge of an event, or it may settle back down - too soon to tell.';
    default:
      return 'All quiet. Particle levels are sitting at their normal background, with no sign of an incoming solar storm.';
  }
}

function buildDetail(
  level: WarnLevel,
  m: { sig: number; slope: number; sustainedMinutes: number; channelsRising: number; channelsTotal: number; boost: number; fdPct: number | null; dipRecent: boolean },
): string {
  const sigTxt = Number.isFinite(m.sig) ? `${m.sig.toFixed(1)}σ above 7-day quiet baseline` : 'baseline still forming';
  const slopeTxt = Number.isFinite(m.slope) ? `${m.slope >= 0 ? '+' : ''}${m.slope.toFixed(2)} log/15m` : 'no slope';
  const chanTxt = `${m.channelsRising}/${m.channelsTotal} channels rising`;
  const sustTxt = `${Math.round(m.sustainedMinutes)} min elevated`;
  const seqTxt = m.boost > 0 ? `, sequence boost −${Math.round(m.boost * 100)}% thresholds` : '';
  const fdTxt = m.fdPct !== null ? `, cosmic rays ${m.fdPct.toFixed(1)}%` : '';
  const dipTxt = m.dipRecent ? ', post-dip rise pattern' : '';
  switch (level) {
    case 'SHOCK':
      return `Technical: ${sigTxt}, climbing ${slopeTxt} across ${chanTxt}${fdTxt}${seqTxt}.`;
    case 'ONSET':
      return `Technical: ${sigTxt}, ${slopeTxt}, ${chanTxt}${dipTxt}${fdTxt}${seqTxt}.`;
    case 'ELEVATED':
      return `Technical: ${sigTxt}, ${sustTxt}, ${chanTxt}${fdTxt}${seqTxt}.`;
    case 'WATCH':
      return `Technical: ${sigTxt}, ${chanTxt} - not yet sustained or broadband enough to confirm${fdTxt}${seqTxt}.`;
    default:
      return `Technical: ${sigTxt}${fdTxt}.`;
  }
}

export const EPAM_WARN_LEVEL_RANK = LEVEL_RANK;
// --- END OF FILE src/components/epamWarning.ts ---