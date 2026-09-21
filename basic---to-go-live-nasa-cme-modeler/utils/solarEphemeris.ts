// Where the Sun's rotation axis is pointing, as seen from Earth.
//
// Two angles decide how a heliographic coordinate lands on a picture of the
// Sun, and the sunspot tracker was using neither:
//
//   B0  the heliographic latitude of the point at disk centre. Earth's orbit
//       is tilted 7.25 degrees to the solar equator, so over a year we see up
//       to 7.25 degrees "over the top" of the Sun and then the same under the
//       bottom. At the September maximum this shifts a spot's apparent
//       position by up to 12% of the solar radius - tens of pixels, and more
//       than the width of the spot itself.
//
//   P   the position angle of the north pole, up to 26.3 degrees either way.
//       SDO rolls to keep solar north up, so its images already have P removed
//       and the tracker should not apply it. It is computed here anyway, both
//       because it costs nothing alongside B0 and because any imagery that is
//       not north-up needs it.
//
// Algorithm: Meeus, Astronomical Algorithms, ch. 29 (Ephemeris for Physical
// Observations of the Sun). Accurate to well under a tenth of a degree, which
// is far finer than a sunspot is wide.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** Julian Day for a JS date. */
export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}

export interface SolarDiskOrientation {
  /** Heliographic latitude of disk centre, degrees. Positive tips north toward us. */
  b0: number;
  /** Position angle of the rotation axis, degrees, measured east from north. */
  p: number;
  /** Carrington longitude of the disk centre, degrees. */
  l0: number;
}

export function solarDiskOrientation(date: Date): SolarDiskOrientation {
  const jd = julianDay(date);
  const T = (jd - 2451545.0) / 36525;

  // Rotation of the Carrington grid since its epoch.
  const theta = norm360((jd - 2398220.0) * (360 / 25.38));
  // Inclination of the solar equator to the ecliptic, and the longitude of its
  // ascending node.
  const I = 7.25;
  const K = 73.6667 + 1.3958333 * ((jd - 2396758.0) / 36525);

  // The Sun's apparent longitude (Meeus ch. 25).
  const L0deg = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = (357.52911 + 35999.05029 * T - 0.0001537 * T * T) * D2R;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * Math.sin(M)
          + (0.019993 - 0.000101 * T) * Math.sin(2 * M)
          + 0.000289 * Math.sin(3 * M);
  const trueLon = L0deg + C;
  const omega = (125.04 - 1934.136 * T) * D2R;
  const lambda = (trueLon - 0.00569 - 0.00478 * Math.sin(omega)) * D2R;

  // Obliquity, with the nutation term Meeus applies for this calculation.
  const eps0 = 23.43929111 - 0.013004167 * T - 1.6389e-7 * T * T + 5.036e-7 * T * T * T;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * D2R;

  const lambdaMinusK = lambda - K * D2R;

  const x = Math.atan(-Math.cos(lambda) * Math.tan(eps));
  const y = Math.atan(-Math.cos(lambdaMinusK) * Math.tan(I * D2R));
  const p = (x + y) * R2D;

  const b0 = Math.asin(Math.sin(lambdaMinusK) * Math.sin(I * D2R)) * R2D;

  const eta = Math.atan2(
    -Math.sin(lambdaMinusK) * Math.cos(I * D2R),
    -Math.cos(lambdaMinusK),
  ) * R2D;
  const l0 = norm360(eta - theta);

  return { b0, p, l0 };
}
