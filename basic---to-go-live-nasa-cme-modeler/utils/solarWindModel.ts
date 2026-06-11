// --- START OF FILE utils/solarWindModel.ts ---
//
// Solar wind / High-Speed Stream speed model derived from coronal hole width.
//
// Reference: Wang-Sheeley-Arge (WSA) model concept — wider open-field regions
// (coronal holes) produce faster solar wind streams because the flux tubes
// expand less and the wind accelerates more efficiently.
//
// ═══════════════════════════════════════════════════════════════════════
// HSS SPEED PHYSICS — CORRECTED BASED ON PSP + L1 OBSERVATIONS
// ═══════════════════════════════════════════════════════════════════════
//
// KEY INSIGHT: HSS plasma barely decelerates between 0.2 AU and 1 AU.
// The A&A 2022 study (Hofmeister et al.) showed the total velocity
// increase from 0.2–1 AU is only ~15 km/s for a 650 km/s parcel.
// The fast wind is already fast when it leaves the low corona.
//
// Source speeds near the Sun (Parker Solar Probe, <0.1 AU):
//   Fast wind from CHs: 500–1000+ km/s (Berkeley/PSP data)
//   The original model's 800–1400 km/s source range was reasonable
//   for the acceleration region very close to the Sun (<10 R☉)
//
// Speeds measured at 1 AU (DSCOVR/ACE at L1):
//   Slow wind:     250–450 km/s  (streamer belt / closed-field regions)
//   Moderate HSS:  500–650 km/s  (small/mid equatorial CH)
//   Fast HSS:      650–800 km/s  (large equatorial or polar-extension CH)
//   Extreme HSS:   800–900+ km/s (very large CH, declining phase of cycle)
//
// Grandin et al. 2019 (JGR): "speed exceeds 500 km/s for 2–3 days
// and may reach a maximum above 800 km/s"
//
// Neugebauer 1993 (NASA): "polar CH flows usually 700–800 km/s;
// small equatorial CH flows generally lower, can be <400 km/s"
//
// The model estimates PEAK SPEED AT 1 AU. Since deceleration is
// minimal, this is close to the coronal source speed for fast streams.
// What matters is CH size, darkness, latitude, and flux-tube expansion.
//
// TUNING GUIDE
// ─────────────
//  HSS_SPEED_MIN_1AU     : floor for tiniest CHs at 1 AU
//  HSS_SPEED_MAX_1AU     : ceiling for monster polar-extension CHs
//  HSS_CH_WIDTH_MIN_DEG  : CH width → speed floor
//  HSS_CH_WIDTH_MAX_DEG  : CH width → speed ceiling

const HSS_SPEED_MIN_1AU    = 450;   // km/s — tiny equatorial CH at 1 AU
const HSS_SPEED_MAX_1AU    = 900;   // km/s — very large/dark CH at 1 AU
const HSS_CH_WIDTH_MIN_DEG = 5;     // degrees CH width -> speed floor
const HSS_CH_WIDTH_MAX_DEG = 60;    // degrees CH width -> speed ceiling

// Coronal source speed range — used ONLY by the propagation engine
// for the inner boundary condition at 21.5 R☉. These are higher
// because the wind is still accelerating in the low corona.
// PSP data shows fast wind at 500–1000+ km/s inside 0.1 AU,
// and MHD models place peak source speeds up to ~1200–1500 km/s
// at the base of open flux tubes in large dark coronal holes.
const HSS_SOURCE_SPEED_MIN = 600;
const HSS_SOURCE_SPEED_MAX = 1400;

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
  // Max boost ~120 km/s for the darkest holes (calibrated against OMNI data)
  // A very dark CH with strong open flux drives significantly faster wind
  const boostKms = 120 * darkness;
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