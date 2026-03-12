// --- START OF FILE utils/solarWindModel.ts ---
//
// Solar wind / High-Speed Stream speed model derived from coronal hole width.
//
// Reference: Wang-Sheeley-Arge (WSA) model concept — wider open-field regions
// (coronal holes) produce faster solar wind streams because the flux tubes
// expand less and the wind accelerates more efficiently.
//
// TUNING GUIDE
// ─────────────
//  HSS_SPEED_MIN  : minimum stream speed at vanishingly narrow CH (km/s)
//  HSS_SPEED_MAX  : maximum stream speed for a very wide CH (km/s)
//  HSS_CH_WIDTH_MIN_DEG : CH width (degrees) that maps to HSS_SPEED_MIN
//  HSS_CH_WIDTH_MAX_DEG : CH width (degrees) that maps to HSS_SPEED_MAX
//
// The mapping is linear between these bounds then clamped.  To make the
// speed curve non-linear, replace the lerp with a pow() or sqrt() call.

const HSS_SPEED_MIN      = 350;   // km/s  — narrow CH slow stream floor
const HSS_SPEED_MAX      = 800;   // km/s  — wide CH fast stream ceiling
const HSS_CH_WIDTH_MIN_DEG = 5;   // degrees CH width -> speed floor
const HSS_CH_WIDTH_MAX_DEG = 60;  // degrees CH width -> speed ceiling

/**
 * Estimate the HSS solar-wind speed (km/s) from the coronal-hole angular width.
 *
 * @param widthDeg  The east-west angular width of the coronal hole in degrees.
 * @returns         Estimated solar wind speed in km/s, clamped [HSS_SPEED_MIN, HSS_SPEED_MAX].
 */
export function estimateHssSpeedFromChWidth(widthDeg: number): number {
  const t = (widthDeg - HSS_CH_WIDTH_MIN_DEG) / (HSS_CH_WIDTH_MAX_DEG - HSS_CH_WIDTH_MIN_DEG);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.round(HSS_SPEED_MIN + clamped * (HSS_SPEED_MAX - HSS_SPEED_MIN));
}

// --- END OF FILE utils/solarWindModel.ts ---
