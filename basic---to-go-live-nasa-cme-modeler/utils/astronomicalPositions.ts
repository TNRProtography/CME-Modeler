/**
 * utils/astronomicalPositions.ts
 *
 * Analytical heliocentric ephemeris — planets, Earth rotation, Moon.
 *
 * Accuracy:
 *   Planets  : < 1° (1900–2100), Meeus "Astronomical Algorithms" 2nd ed. Table 31.a
 *   GMST     : < 0.1°,  IAU 1982 formula (Meeus §12)
 *   Moon     : ~0.3°,   ELP-2000/82 abridgement first 9 terms (Meeus §47)
 *
 * Scene ↔ J2000 ecliptic frame (Three.js Y = ecliptic north, XZ = ecliptic plane):
 *   scene_x = r · sin(λ)   scene_z = r · cos(λ)   scene_y ≈ 0
 * where λ is the heliocentric ecliptic longitude in radians.
 */

/** Earth's axial obliquity at J2000 in radians (23.4392811°) */
export const EARTH_TILT_RAD = 23.4392811 * (Math.PI / 180);

// J2000.0 epoch as Unix timestamp (ms) — 2000-Jan-1 12:00 UTC
const J2000_MS = 946728000000;
const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;

function daysJ2000(dateMs: number): number {
  return (dateMs - J2000_MS) / 86_400_000;
}

function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

function normRad(r: number): number {
  return ((r % TWO_PI) + TWO_PI) % TWO_PI;
}

// ---------------------------------------------------------------------------
// Heliocentric orbital elements at J2000.0
// L0    = mean longitude (deg)      n = mean daily motion (deg/day)
// e     = eccentricity              omega = longitude of perihelion (deg)
// a     = semi-major axis (AU)
// ---------------------------------------------------------------------------
interface OrbitalElements {
  L0: number; n: number; e: number; omega: number; a: number;
}

const ELEMENTS: Record<string, OrbitalElements> = {
  MERCURY: { L0: 252.250906, n: 4.092338,  e: 0.20563069, omega:  77.456119, a: 0.387098 },
  VENUS:   { L0: 181.979801, n: 1.602136,  e: 0.00677323, omega: 131.563707, a: 0.723330 },
  EARTH:   { L0: 100.464572, n: 0.985647,  e: 0.01671022, omega: 102.937348, a: 1.000001 },
  MARS:    { L0: 355.433275, n: 0.524033,  e: 0.09341233, omega: 336.060234, a: 1.523679 },
  JUPITER: { L0:  34.351484, n: 0.083091,  e: 0.04839266, omega:  14.331312, a: 5.202887 },
  SATURN:  { L0:  50.077444, n: 0.033460,  e: 0.05415060, omega:  93.057177, a: 9.536676 },
  URANUS:  { L0: 314.055005, n: 0.011699,  e: 0.04716771, omega: 173.005159, a: 19.189165 },
  NEPTUNE: { L0: 304.348665, n: 0.005965,  e: 0.00858587, omega:  48.123691, a: 30.069923 },
};

/**
 * Heliocentric ecliptic longitude of a planet in radians [0, 2pi).
 *
 * Includes equation of center (3-term series, Meeus §25) — corrects
 * for eccentricity. Adds up to +/-2.4° for Mars, +/-1.3° for Earth.
 */
export function computeEclipticLongitude(planetKey: string, dateMs: number): number {
  const el = ELEMENTS[planetKey.toUpperCase()];
  if (!el) return 0;

  const D = daysJ2000(dateMs);
  const L_deg = normDeg(el.L0 + el.n * D);        // mean longitude
  const M_rad = normDeg(L_deg - el.omega) * DEG;   // mean anomaly (rad)

  // Equation of center — Meeus §25
  const e = el.e;
  const C_deg =
    (2 * e - e * e * e / 4) * (180 / Math.PI) * Math.sin(M_rad) +
    (5 * e * e / 4)          * (180 / Math.PI) * Math.sin(2 * M_rad) +
    (13 * e * e * e / 12)    * (180 / Math.PI) * Math.sin(3 * M_rad);

  return normDeg(L_deg + C_deg) * DEG;
}

/**
 * Greenwich Mean Sidereal Time in radians [0, 2pi).
 * IAU 1982 formula — drives Earth rotation.y so prime meridian
 * faces the correct heliocentric direction at any timestamp.
 */
export function computeGMST(dateMs: number): number {
  const D = daysJ2000(dateMs);
  const gmst_deg = normDeg(280.46061837 + 360.98564736629 * D);
  return gmst_deg * DEG;
}

/**
 * Moon's geocentric ecliptic longitude in radians [0, 2pi).
 * ELP-2000/82 abridgement, first 9 terms (Meeus §47). Accurate ~0.3°.
 */
function computeMoonLongitude(dateMs: number): number {
  const D = daysJ2000(dateMs);

  const L  = normDeg(218.316446 + 13.176396 * D);   // mean longitude
  const M  = normDeg(134.963396 + 13.064993 * D);   // Moon mean anomaly
  const Dm = normDeg(297.850195 + 12.190749 * D);   // mean elongation
  const F  = normDeg( 93.272095 + 13.229255 * D);   // argument of latitude
  const M0 = normDeg(357.529109 +  0.985600 * D);   // Sun mean anomaly

  const dL =
     6.2886 * Math.sin(M  * DEG)
   - 1.2740 * Math.sin((2 * Dm - M)     * DEG)
   + 0.6583 * Math.sin(2 * Dm           * DEG)
   - 0.2136 * Math.sin(2 * M            * DEG)
   - 0.1098 * Math.sin(Dm               * DEG)
   + 0.1008 * Math.sin(2 * F            * DEG)
   - 0.0755 * Math.sin((2 * Dm + M)     * DEG)
   - 0.0529 * Math.sin(M0               * DEG)
   + 0.0403 * Math.sin((2 * Dm - 2 * M) * DEG);

  return normDeg(L + dL) * DEG;
}

/**
 * Moon's orbital angle relative to Earth in the Three.js scene
 * ecliptic XZ plane, in radians [0, 2pi).
 *
 * Use as Moon mesh position angle:
 *   moonMesh.position.set(r * sin(angle), 0, r * cos(angle))
 */
export function computeMoonSceneAngle(dateMs: number): number {
  const moonLon  = computeMoonLongitude(dateMs);
  const earthLon = computeEclipticLongitude('EARTH', dateMs);
  return normRad(moonLon - earthLon);
}