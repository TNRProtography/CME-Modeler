// --- START OF FILE utils/rmEffect.ts ---
//
// Russell-McPherron geometry, shared.
//
// Extracted from RussellMcPherron.tsx so the flux rope analyser can apply the
// same correction rather than carrying a second copy of the maths. Geometry is
// Hapgood (1992) with the IGRF-13 dipole.
//
// Why this matters for a flux rope: a rope's field is measured in GSM, but the
// aurora-driving component is what Earth's dipole actually sees. Because the
// dipole is tilted, a By component projects partly onto the GSM Bz axis. The
// same By can therefore help or hinder depending on the time of year and time
// of day, which is the Russell-McPherron effect, and it is why equinox aurora
// runs better.

const D2R = Math.PI / 180, R2D = 180 / Math.PI;
const POLE_LAT = 80.65, POLE_LON = -72.68; // IGRF-13, matches AuroraSightings

export interface RMAngles { psi: number; mu: number; delta: number; beta: number }

export function rmAngles(date: Date): RMAngles {
  const MJD = date.getTime() / 86400000 + 40587;
  const T0 = (MJD - 51544.5) / 36525.0;
  const H = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const M = (357.528 + 35999.050 * T0 + 0.04107 * H) * D2R;
  const Lam = 280.460 + 36000.772 * T0 + 0.04107 * H;
  const lambdaSun = (Lam + (1.915 - 0.0048 * T0) * Math.sin(M) + 0.020 * Math.sin(2 * M)) * D2R;
  const eps = (23.439 - 0.013 * T0) * D2R;
  const theta = ((100.461 + 36000.770 * T0 + 15.04107 * H) % 360) * D2R;
  const phi = POLE_LAT * D2R, lam = POLE_LON * D2R;
  const Qg = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
  const ct = Math.cos(theta), st = Math.sin(theta);
  const Qei = [ct * Qg[0] - st * Qg[1], st * Qg[0] + ct * Qg[1], Qg[2]];
  const ce = Math.cos(eps), se = Math.sin(eps);
  const a = [Qei[0], ce * Qei[1] + se * Qei[2], -se * Qei[1] + ce * Qei[2]];
  const cl = Math.cos(lambdaSun), sl = Math.sin(lambdaSun);
  const Qgse = [cl * a[0] + sl * a[1], -sl * a[0] + cl * a[1], a[2]];
  const xe = Qgse[0], ye = Qgse[1], ze = Qgse[2];
  const psi = Math.atan2(ye, ze) * R2D;
  const mu = Math.atan2(xe, Math.sqrt(ye * ye + ze * ze)) * R2D;
  const i_s = 7.25 * D2R, Omega = 75.76 * D2R;
  const delta = Math.atan(Math.tan(i_s) * Math.sin(lambdaSun - Omega)) * R2D;
  return { psi, mu, delta, beta: psi + delta };
}

/** GSM By rotated back into the GSEQ frame, isolating the RM contribution. */
export function gsmToGseqBy(byGsm: number, bzGsm: number, betaDeg: number): number {
  const b = betaDeg * D2R;
  return byGsm * Math.cos(b) + bzGsm * Math.sin(b);
}

/**
 * The effective southward field Earth's dipole actually sees, given a measured
 * GSM By and Bz.
 *
 *   Bz_eff = Bz*cos(beta) - By*sin(beta)
 *
 * A By of the right sign for the season adds southward field and drives aurora
 * even when the measured Bz alone looks unremarkable. The wrong sign cancels
 * some of it. Returns the effective Bz plus how much of it came from By.
 */
export function effectiveBz(byGsm: number, bzGsm: number, when: Date = new Date()) {
  const beta = rmAngles(when).beta * D2R;
  const bzEff = bzGsm * Math.cos(beta) - byGsm * Math.sin(beta);
  return { bzEff, byContribution: bzEff - bzGsm, betaDeg: beta * R2D };
}
// --- END OF FILE utils/rmEffect.ts ---
