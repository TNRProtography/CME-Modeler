// --- START OF FILE src/utils/shockDetection.ts ---
//
// Single shared interplanetary-shock detector.
//
// This is THE one source of truth for client-side shock detection. It is used
// by SolarWindQuickView (the solar-wind summary carousel + the global shock
// banner via App.tsx) and by EPAMPanel (the dashed shock markers on the
// particle charts). Before this existed there were two near-duplicate
// detectors with different thresholds, so the summary and the EPAM markers
// could disagree - and did.
//
// v2 TIGHTENING (false-positive reduction)
// ----------------------------------------
// 1. "IMF Enhancement / Discontinuity" REMOVED ENTIRELY. Magnetic steps with
//    no plasma jump (sector boundaries, embedded structure) were the main
//    false-positive source and carry little arrival-forecast value.
// 2. SHARPNESS GATE. A true shock is a step, not a ramp. Wide-window medians
//    (18/12 min) can register a "jump" across a perfectly gradual SIR ramp,
//    which was the second false-positive source. We now also compare narrow
//    ±6-minute windows around the candidate time and require the narrow-window
//    speed jump to carry at least half of the wide-window jump (and ≥10 km/s
//    on its own). Gradual ramps fail this; genuine shocks pass easily.
// 3. DYNAMIC-PRESSURE CONFIRMATION. Forward shocks must compress (Pdyn ratio
//    ≥ 1.4); reverse shocks must rarefy (≤ 0.75).
// 4. Raised per-parameter thresholds (ΔV ≥ 20 km/s, density ratio ≥ 1.3, temp
//    ratio ≥ 1.25, |B| ratio ≥ 1.15 or ≥ 1.5 nT) and minimum sample counts
//    (≥4 points per window).
//
// The four classic IPS classes are kept, with their spacecraft-frame
// signatures:
//   Fast Forward  (FF): V↑ N↑ T↑ B↑  - classic CME/SIR front. The big one.
//   Slow Forward  (SF): V↑ N↑ T↑ B↓
//   Fast Reverse  (FR): V↑ N↓ T↓ B↓  - trailing edge / rear of HSS
//   Slow Reverse  (SR): V↑ N↓ T↓ B↑

export interface DetectedShock {
  t: number;       // ms timestamp of the shock crossing
  score: number;
  label: string;
  spdJ: number;    // speed delta (km/s)
  denR: number;    // density ratio
  tmpR: number;    // temp ratio
  btJ:  number;    // Bt delta (nT)
  bzJ:  number;    // Bz swing (nT)
  ageMin: number;
  ageStr: string;
}

export const SHOCK_DETECT_CONFIG = {
  LOOK_BACK_MS: 6 * 3600_000,     // only surface very recent structure
  CANDIDATE_STEP_MS: 3 * 60_000,
  PRE_WIN_MS: 18 * 60_000,        // wide windows: robust medians
  POST_WIN_MS: 12 * 60_000,
  NARROW_WIN_MS: 6 * 60_000,      // narrow windows: sharpness gate
  MIN_PTS: 4,                     // minimum samples per wide window

  V_UP: 20,                       // km/s
  N_UP: 1.3,
  N_DOWN: 0.77,
  T_UP: 1.25,
  T_DOWN: 0.8,
  B_UP_RATIO: 1.15,
  B_UP_DELTA: 1.5,                // nT
  B_DOWN_RATIO: 0.87,
  B_DOWN_DELTA: -1.5,
  PDYN_FWD: 1.4,                  // forward shocks must compress
  PDYN_REV: 0.75,                 // reverse shocks must rarefy

  SHARP_MIN_DV: 10,               // km/s - narrow-window jump floor
  SHARP_FRACTION: 0.5,            // narrow jump must carry ≥ this × wide jump

  DEDUPE_MS: 30 * 60_000,
  MAX_EVENTS: 4,
  MAX_AGE_MIN: 360,
} as const;

type XY = { x: number; y: number };
type MagPoint = { time: number; bt: number; bz: number };

function median(vals: number[]): number {
  if (!vals.length) return NaN;
  const v = [...vals].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function detectShocks(
  speedData: XY[],
  densityData: XY[],
  tempData: XY[],
  magneticData: MagPoint[],
): DetectedShock[] {
  const cfg = SHOCK_DETECT_CONFIG;
  const now = Date.now();

  const spdSorted = [...speedData].sort((a, b) => a.x - b.x);
  const denSorted = [...densityData].sort((a, b) => a.x - b.x);
  const tmpSorted = [...tempData].sort((a, b) => a.x - b.x);
  const magSorted = [...magneticData].sort((a, b) => a.time - b.time);
  if (spdSorted.length < 10 || denSorted.length < 10 || magSorted.length < 10) return [];

  const sample = (arr: XY[], a: number, b: number): number[] =>
    arr.filter(p => p.x >= a && p.x < b).map(p => p.y).filter(n => Number.isFinite(n));
  const sampleMag = (a: number, b: number): { bt: number[]; bz: number[] } => ({
    bt: magSorted.filter(p => p.time >= a && p.time < b).map(p => p.bt).filter(n => Number.isFinite(n)),
    bz: magSorted.filter(p => p.time >= a && p.time < b).map(p => p.bz).filter(n => Number.isFinite(n)),
  });

  const events: DetectedShock[] = [];
  const tStart = Math.max(now - cfg.LOOK_BACK_MS, spdSorted[0].x + cfg.PRE_WIN_MS);

  for (let t = tStart; t <= now - cfg.POST_WIN_MS; t += cfg.CANDIDATE_STEP_MS) {
    const preSpd = sample(spdSorted, t - cfg.PRE_WIN_MS, t);
    const postSpd = sample(spdSorted, t, t + cfg.POST_WIN_MS);
    const preDen = sample(denSorted, t - cfg.PRE_WIN_MS, t);
    const postDen = sample(denSorted, t, t + cfg.POST_WIN_MS);
    const preTmp = sample(tmpSorted, t - cfg.PRE_WIN_MS, t);
    const postTmp = sample(tmpSorted, t, t + cfg.POST_WIN_MS);
    const preMag = sampleMag(t - cfg.PRE_WIN_MS, t);
    const postMag = sampleMag(t, t + cfg.POST_WIN_MS);
    if (
      preSpd.length < cfg.MIN_PTS || postSpd.length < cfg.MIN_PTS ||
      preDen.length < cfg.MIN_PTS || postDen.length < cfg.MIN_PTS ||
      preMag.bt.length < cfg.MIN_PTS || postMag.bt.length < cfg.MIN_PTS
    ) continue;

    const spd1 = median(preSpd), spd2 = median(postSpd);
    const den1 = median(preDen), den2 = median(postDen);
    const tmp1 = median(preTmp), tmp2 = median(postTmp);
    const bt1 = median(preMag.bt), bt2 = median(postMag.bt);
    const bz1 = median(preMag.bz), bz2 = median(postMag.bz);
    if (![spd1, spd2, den1, den2, bt1, bt2, bz1, bz2].every(Number.isFinite)) continue;

    const pDyn1 = den1 > 0 ? den1 * spd1 * spd1 : NaN;
    const pDyn2 = den2 > 0 ? den2 * spd2 * spd2 : NaN;
    const spdDelta = spd2 - spd1;
    const denRatio = den1 > 0 ? den2 / den1 : NaN;
    const tmpRatio = tmp1 > 0 ? tmp2 / tmp1 : NaN;
    const btDelta = bt2 - bt1;
    const btRatio = bt1 > 0 ? bt2 / bt1 : NaN;
    const bzDelta = bz2 - bz1;
    const pDynRatio = pDyn1 > 0 ? pDyn2 / pDyn1 : NaN;
    if (![denRatio, tmpRatio, btRatio, pDynRatio].every(Number.isFinite)) continue;

    // ── Sharpness gate ────────────────────────────────────────────────────────
    // A genuine shock crossing concentrates its jump at the crossing; a SIR
    // ramp spreads it across the whole window. Require the narrow ±6-min jump
    // to carry at least half the wide jump, and ≥10 km/s outright.
    const preSpdN = sample(spdSorted, t - cfg.NARROW_WIN_MS, t);
    const postSpdN = sample(spdSorted, t, t + cfg.NARROW_WIN_MS);
    if (preSpdN.length < 2 || postSpdN.length < 2) continue;
    const dvNarrow = median(postSpdN) - median(preSpdN);
    if (!Number.isFinite(dvNarrow)) continue;
    const sharp = dvNarrow >= Math.max(cfg.SHARP_MIN_DV, cfg.SHARP_FRACTION * spdDelta);

    const vUp = spdDelta >= cfg.V_UP;
    const nUp = denRatio >= cfg.N_UP;
    const nDown = denRatio <= cfg.N_DOWN;
    const tUp = tmpRatio >= cfg.T_UP;
    const tDown = tmpRatio <= cfg.T_DOWN;
    const bUp = btRatio >= cfg.B_UP_RATIO || btDelta >= cfg.B_UP_DELTA;
    const bDown = btRatio <= cfg.B_DOWN_RATIO || btDelta <= cfg.B_DOWN_DELTA;
    const compresses = pDynRatio >= cfg.PDYN_FWD;
    const rarefies = pDynRatio <= cfg.PDYN_REV;

    let label = '';
    let score = 0;
    if (vUp && sharp && nUp && tUp && bUp && compresses) {
      label = 'Fast Forward Shock (FF)';
      score = 8 + Number(pDynRatio >= 1.8) + Number(btRatio >= 1.3);
    } else if (vUp && sharp && nUp && tUp && bDown && compresses) {
      label = 'Slow Forward Shock (SF)';
      score = 7 + Number(pDynRatio >= 1.6);
    } else if (vUp && sharp && nDown && tDown && bDown && rarefies) {
      label = 'Fast Reverse Shock (FR)';
      score = 7 + Number(pDynRatio <= 0.65);
    } else if (vUp && sharp && nDown && tDown && bUp && rarefies) {
      label = 'Slow Reverse Shock (SR)';
      score = 6 + Number(pDynRatio <= 0.7);
    } else {
      continue;
    }

    const ageMin = Math.round((now - t) / 60_000);
    if (ageMin > cfg.MAX_AGE_MIN) continue;
    const ageStr = ageMin < 2 ? 'just now'
      : ageMin < 60 ? `~${ageMin} min ago`
      : `~${Math.floor(ageMin / 60)}h${ageMin % 60 > 0 ? ` ${ageMin % 60}min` : ''} ago`;

    events.push({
      t, score, label,
      spdJ: Math.round(spdDelta),
      denR: +denRatio.toFixed(2),
      tmpR: +tmpRatio.toFixed(2),
      btJ: +btDelta.toFixed(1),
      bzJ: +bzDelta.toFixed(1),
      ageMin, ageStr,
    });
  }

  if (!events.length) return [];
  // Keep strongest non-overlapping events, then order chronologically.
  return events
    .sort((a, b) => b.score - a.score || b.t - a.t)
    .reduce<DetectedShock[]>((acc, ev) => {
      if (!acc.some((s) => Math.abs(s.t - ev.t) < SHOCK_DETECT_CONFIG.DEDUPE_MS)) acc.push(ev);
      return acc;
    }, [])
    .slice(0, SHOCK_DETECT_CONFIG.MAX_EVENTS)
    .sort((a, b) => a.t - b.t);
}
// --- END OF FILE src/utils/shockDetection.ts ---