// --- START OF FILE utils/solarWindModel.ts ---
//
// Solar wind / High-Speed Stream speed model derived from coronal hole width.
//
// Reference: Wang-Sheeley-Arge (WSA) model concept — wider open-field regions
// (coronal holes) produce faster solar wind streams because the flux tubes
// expand less and the wind accelerates more efficiently.
//
// ═══════════════════════════════════════════════════════════════════════
// IMPORTANT DISTINCTION: SOURCE SPEED vs SPEED AT 1 AU
// ═══════════════════════════════════════════════════════════════════════
//
// Source speeds (near the Sun, <0.1 AU) can be very high (600–1200 km/s)
// because the wind hasn't yet interacted much with the ambient medium.
//
// Speeds measured at 1 AU (DSCOVR/ACE at L1) are lower:
//   Slow wind:  300–450 km/s  (from streamer belt / closed-field regions)
//   Fast wind:  500–800 km/s  (from coronal holes)
//   Extreme:    800–900 km/s  (rare, very large equatorial CH at solar min)
//
// This model now estimates the SPEED AT 1 AU, which is what matters for
// forecasting CME transit times and geomagnetic storm intensity.
//
// The previous version used source speeds (800–1400 km/s) which were
// far too high for 1 AU forecasting. Those have been replaced with
// empirically calibrated values consistent with OMNI/Wind observations.
//
// TUNING GUIDE
// ─────────────
//  HSS_SPEED_MIN_1AU     : minimum HSS speed at 1 AU for a narrow CH (km/s)
//  HSS_SPEED_MAX_1AU     : maximum HSS speed at 1 AU for a very wide/dark CH
//  HSS_CH_WIDTH_MIN_DEG  : CH width (degrees) that maps to speed floor
//  HSS_CH_WIDTH_MAX_DEG  : CH width (degrees) that maps to speed ceiling
//
// The mapping uses a square-root curve (not linear) to match the
// observed sublinear relationship between CH area and wind speed
// (Rotter et al. 2012; Reiss et al. 2016).

const HSS_SPEED_MIN_1AU    = 450;   // km/s — narrow CH at 1 AU
const HSS_SPEED_MAX_1AU    = 780;   // km/s — very dark, wide CH at 1 AU
const HSS_CH_WIDTH_MIN_DEG = 5;     // degrees CH width -> speed floor
const HSS_CH_WIDTH_MAX_DEG = 60;    // degrees CH width -> speed ceiling

// Coronal source speed range (used only by the propagation engine's
// inner boundary at 21.5 R☉, NOT for forecasting at 1 AU)
const HSS_SOURCE_SPEED_MIN = 600;
const HSS_SOURCE_SPEED_MAX = 1200;

/**
 * Estimate the HSS solar-wind speed AT 1 AU from the coronal-hole
 * angular width. Uses a square-root relationship consistent with
 * WSA empirical fits (wider CH → faster wind, but sublinear).
 *
 * @param widthDeg  The east-west angular width of the coronal hole in degrees.
 * @returns         Estimated solar wind speed at 1 AU in km/s.
 */
export function estimateHssSpeedFromChWidth(widthDeg: number): number {
  const t = (widthDeg - HSS_CH_WIDTH_MIN_DEG) / (HSS_CH_WIDTH_MAX_DEG - HSS_CH_WIDTH_MIN_DEG);
  const clamped = Math.max(0, Math.min(1, t));
  // Square-root: rapid rise for small CHs, diminishing returns for large
  const factor = Math.sqrt(clamped);
  return Math.round(HSS_SPEED_MIN_1AU + factor * (HSS_SPEED_MAX_1AU - HSS_SPEED_MIN_1AU));
}

/**
 * Estimate HSS speed at 1 AU from CH width and relative darkness.
 * Darker coronal holes have stronger open magnetic flux and drive
 * faster wind (Heinemann et al. 2020).
 *
 * @param widthDeg         CH angular width in degrees.
 * @param darknessFraction 0..1 where 1 = much darker than the disk median.
 */
export function estimateHssSpeedFromChWidthAndDarkness(widthDeg: number, darknessFraction: number): number {
  const widthSpeed = estimateHssSpeedFromChWidth(widthDeg);
  const darkness = Math.max(0, Math.min(1, darknessFraction));
  // Max boost ~80 km/s for the darkest holes (calibrated against OMNI data)
  const boostKms = 80 * darkness;
  return Math.round(Math.max(HSS_SPEED_MIN_1AU, Math.min(HSS_SPEED_MAX_1AU, widthSpeed + boostKms)));
}

/**
 * Estimate the CORONAL SOURCE speed (near the Sun) from CH width.
 * This is used for the heliospheric propagation engine's inner
 * boundary condition at 21.5 R☉, NOT for forecasting at Earth.
 *
 * @param widthDeg  CH angular width in degrees.
 * @returns         Source wind speed in km/s (higher than 1 AU speed).
 */
export function estimateSourceSpeed(widthDeg: number): number {
  const t = (widthDeg - HSS_CH_WIDTH_MIN_DEG) / (HSS_CH_WIDTH_MAX_DEG - HSS_CH_WIDTH_MIN_DEG);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(HSS_SOURCE_SPEED_MIN + clamped * (HSS_SOURCE_SPEED_MAX - HSS_SOURCE_SPEED_MIN));
}

// --- END OF FILE utils/solarWindModel.ts ---