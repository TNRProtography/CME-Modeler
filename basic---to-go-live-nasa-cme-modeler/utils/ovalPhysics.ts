// --- START OF FILE src/utils/ovalPhysics.ts ---
//
// Shared auroral oval boundary physics used by the visibility forecast
// panel (and mirrored in the push-notification worker so app and
// notifications always agree).
//
// Upgrades over the plain Newell-driven boundary:
//
//   1. DYNAMIC PRESSURE EXPANSION (#3)
//      The oval expands equatorward under high solar wind dynamic
//      pressure independent of magnetic coupling. Magnetopause standoff
//      scales as Pdyn^(-1/6); empirically the equatorward auroral
//      boundary shifts roughly 1-2 degrees for a strong (8-15 nPa)
//      compression vs the ~2 nPa nominal. We use a log2 law:
//        shift = PDYN_DEG_PER_DOUBLING * log2(Pdyn / 2 nPa)
//      capped so quiet rarefactions can't contract the oval more than
//      1 degree and extreme sheaths can't expand it more than 3.
//
//   2. RUSSELL-McPHERRON SEASONAL WEIGHTING (#5)
//      Around the equinoxes, IMF By in the GSEQ frame projects onto
//      GSM Bz, so identical solar wind couples more (or less)
//      efficiently depending on By sign and time of year. Uses the
//      Hapgood (1992) angles already validated in the app's
//      RussellMcPherron panel. Returns a multiplier applied to the
//      Newell coupling before it drives the boundary, capped to
//      [0.90, 1.15] so it can only fine-tune, never dominate.
//
// The base relation  boundary = -(65.5 - newell / 1800)  and its clamps
// are unchanged, so with quiet pressure (~2 nPa) and no RM projection
// the output is identical to the previous behaviour.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Russell-McPherron factor
// ---------------------------------------------------------------------------

/** Hapgood (1992) angles needed for the GSM->GSEQ By projection. */
function rmBeta(date: Date): number {
  const MJD = date.getTime() / 86400000 + 40587;
  const T0 = (MJD - 51544.5) / 36525.0;
  const H = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const M = (357.528 + 35999.050 * T0 + 0.04107 * H) * D2R;
  const Lam = 280.460 + 36000.772 * T0 + 0.04107 * H;
  const lambdaSun = (Lam + (1.915 - 0.0048 * T0) * Math.sin(M) + 0.020 * Math.sin(2 * M)) * D2R;
  const eps = (23.439 - 0.013 * T0) * D2R;
  const theta = ((100.461 + 36000.770 * T0 + 15.04107 * H) % 360) * D2R;
  // IGRF-13 dipole pole
  const phi = 80.65 * D2R, lam = -72.68 * D2R;
  const Qg = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const ct = Math.cos(theta), st = Math.sin(theta);
  const Qei = [ct * Qg[0] - st * Qg[1], st * Qg[0] + ct * Qg[1], Qg[2]];
  const ce = Math.cos(eps), se = Math.sin(eps);
  const a = [Qei[0], ce * Qei[1] + se * Qei[2], -se * Qei[1] + ce * Qei[2]];
  const cl = Math.cos(lambdaSun), sl = Math.sin(lambdaSun);
  const Qgse = [cl * a[0] + sl * a[1], -sl * a[0] + cl * a[1], a[2]];
  const xe = Qgse[0], ye = Qgse[1], ze = Qgse[2];
  const psi = Math.atan2(ye, ze) * R2D;
  const i_s = 7.25 * D2R, Omega = 75.76 * D2R;
  const delta = Math.atan(Math.tan(i_s) * Math.sin(lambdaSun - Omega)) * R2D;
  return psi + delta; // beta, degrees
}

/**
 * Russell-McPherron coupling multiplier.
 *
 * Physically: a fraction of GSEQ By projects onto GSM Bz with magnitude
 * sin(beta). When that projection is southward (adds to reconnection)
 * coupling is enhanced; when northward it is suppressed. Effect peaks
 * near the equinoxes (|sin(beta)| large at the favourable UT hours) and
 * vanishes near the solstices.
 *
 * Returns a multiplier in [0.90, 1.15]. With missing By it returns 1.
 *
 * TIMESCALE: pass By AVERAGED over ~30 min, not an instantaneous sample.
 * The factor multiplies 30/60-min Newell averages, and the RM projection
 * physically operates on sustained By over the coupling timescale; a
 * single 1-min sample makes the factor jitter with By sign flips.
 * The beta angle itself is evaluated at `date` and varies slowly
 * (seasonal + UT-diurnal), so "now" is fine for that part.
 */
export function russellMcPherronFactor(
  date: Date,
  byGsm: number | null | undefined,
  bzGsm: number | null | undefined,
): number {
  if (byGsm == null || !Number.isFinite(byGsm)) return 1;

  const beta = rmBeta(date);
  const sinB = Math.sin(beta * D2R);

  // Southward projection of By onto GSM z (negative = adds southward flux).
  // By * sin(beta): sign convention per Russell & McPherron (1973) - a
  // positive product means the projection is northward (suppressing),
  // negative means southward (enhancing).
  const projection = byGsm * sinB; // nT

  // Scale: a full +/-5 nT effective projection maps to the cap.
  // Weight down when Bz is already strongly southward (the projection
  // matters most when Bz is near zero and coupling is marginal).
  const bzMag = Math.abs(bzGsm ?? 0);
  const marginality = 1 / (1 + bzMag / 5); // 1 when Bz~0, ~0.5 at |Bz|=5

  const raw = 1 - 0.03 * projection * marginality; // -proj (southward) raises
  return Math.min(1.15, Math.max(0.90, raw));
}

// ---------------------------------------------------------------------------
// Dynamic pressure expansion
// ---------------------------------------------------------------------------

const PDYN_NOMINAL_NPA = 2.0;
const PDYN_DEG_PER_DOUBLING = 0.9;
const PDYN_SHIFT_MIN = -1.0; // rarefaction can contract at most 1 deg
const PDYN_SHIFT_MAX = 3.0;  // extreme sheath expands at most 3 deg

/**
 * Equatorward shift (degrees, positive = oval moves toward the equator)
 * from solar wind dynamic pressure. 2 nPa nominal -> 0 shift;
 * 4 nPa -> +0.9 deg; 8 nPa -> +1.8 deg; 16 nPa -> +2.7 deg.
 */
export function pressureShiftDegrees(pdynNPa: number | null | undefined): number {
  if (pdynNPa == null || !Number.isFinite(pdynNPa) || pdynNPa <= 0) return 0;
  const shift = PDYN_DEG_PER_DOUBLING * Math.log2(Math.max(pdynNPa, 0.25) / PDYN_NOMINAL_NPA);
  return Math.min(PDYN_SHIFT_MAX, Math.max(PDYN_SHIFT_MIN, shift));
}

// ---------------------------------------------------------------------------
// Combined oval boundary
// ---------------------------------------------------------------------------

/**
 * 30-minute average of IMF By from RTSW mag samples, for the RM factor.
 * Falls back to the newest sample if the 30-min window is empty; null if
 * nothing usable.
 */
export function avgBy30m(
  magneticData: { time: number; by?: number | null }[] | null | undefined,
  nowMs: number = Date.now(),
): number | null {
  if (!magneticData || magneticData.length === 0) return null;
  const cutoff = nowMs - 30 * 60000;
  const vals = magneticData
    .filter(p => p.time >= cutoff && p.by != null && Number.isFinite(p.by))
    .map(p => p.by as number);
  if (vals.length === 0) {
    const last = magneticData[magneticData.length - 1].by;
    return last != null && Number.isFinite(last) ? last : null;
  }
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

export interface OvalBoundaryInputs {
  newell_avg_60m?: number | null;
  newell_avg_30m?: number | null;
  /** Instantaneous or 30m-average dynamic pressure in nPa. */
  dynamic_pressure_nPa?: number | null;
  avg_30m_pressure_nPa?: number | null;
  /** IMF for the RM projection. by should be a ~30-min average (see
   *  russellMcPherronFactor); bz can be current. */
  by?: number | null;
  bz?: number | null;
}

/**
 * Southern-hemisphere equatorward oval boundary in geomagnetic latitude
 * (negative degrees). Same base law and clamps as before, now with
 * pressure expansion and RM-weighted coupling.
 */
export function computeOvalBoundary(
  inputs: OvalBoundaryInputs,
  bayOnset: boolean,
  now: Date = new Date(),
): number {
  const newell60 = inputs.newell_avg_60m ?? 0;
  const newell30 = inputs.newell_avg_30m ?? 0;
  let newell = Math.max(newell60, newell30 * 0.85);

  // #5 Russell-McPherron seasonal weighting of the coupling term
  newell *= russellMcPherronFactor(now, inputs.by, inputs.bz);

  let boundary = -(65.5 - newell / 1800);

  // #3 Dynamic pressure expansion (prefer 30m average - less noisy)
  const pdyn = inputs.avg_30m_pressure_nPa ?? inputs.dynamic_pressure_nPa ?? null;
  boundary += pressureShiftDegrees(pdyn);

  boundary = Math.max(boundary, -76);
  boundary = Math.min(boundary, -44);
  if (bayOnset) boundary = Math.min(boundary, -47.2);
  return boundary;
}

// ---------------------------------------------------------------------------
// Magnetotail loading duration (deterministic)
// ---------------------------------------------------------------------------

export const LOADING_NEWELL_MIN = 2500;

/**
 * Minutes of continuously elevated coupling, scanned backward from the
 * newest sample. Sub-threshold dips of up to `gapToleranceMin` are
 * bridged; a longer sustained drop ends the loading interval.
 *
 * Deterministic - the app panel and the push worker compute the same
 * number from the same RTSW-derived Newell series, so "loading for 55
 * minutes" in a notification matches the Magnetotail panel.
 *
 * points: { x: epoch ms, y: newell } sorted ascending (the app's
 * allNewellData shape). Returns 0 if the series is empty or the newest
 * stretch is below threshold beyond tolerance.
 */
export function loadingMinutesFromSeries(
  points: { x: number; y: number }[] | null | undefined,
  threshold: number = LOADING_NEWELL_MIN,
  gapToleranceMin: number = 10,
): number {
  if (!points || points.length === 0) return 0;

  const newestTs = points[points.length - 1].x;
  let loadingStart: number | null = null; // earliest above-threshold sample of the current run

  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    if (p == null || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;

    if (p.y >= threshold) {
      loadingStart = p.x;
    } else {
      // Below threshold: how big is the dip between this sample and the
      // start of the run (or the newest sample if the run hasn't begun)?
      const ref = loadingStart ?? newestTs;
      const dipMin = (ref - p.x) / 60000;
      if (dipMin > gapToleranceMin) break; // sustained drop ends the scan
    }
  }

  if (loadingStart == null) return 0;
  return Math.max(0, Math.round((newestTs - loadingStart) / 60000));
}

// --- END OF FILE src/utils/ovalPhysics.ts ---
