// What the sky will be doing when the stream gets here.
//
// A coronal hole's arrival is forecast days ahead, and by then the Sun and the
// Moon will be somewhere else. Knowing a fast stream lands at 5am is not much
// use on its own: 5am might be broad daylight, or a full Moon sitting
// overhead, either of which costs more than the difference between a moderate
// stream and a fast one.
//
// So the arrival needs a sky to arrive into. Everything here is computed from
// first principles for an arbitrary future moment, because the app's existing
// celestial data comes from the server for tonight only and a stream two and a
// half days out is not tonight.
//
// ACCURACY
// ────────
// Low-precision Meeus: the Moon's longitude is good to roughly a third of a
// degree and the Sun's to about a hundredth. That is far better than this
// needs. Nothing here depends on knowing an altitude to better than a degree -
// the questions are "is it up", "how bright is it" and "is the sky dark", and
// all three have answers that change over tens of degrees.
//
// It is deliberately not a rise/set table. Publishing moonrise to the minute
// from a third-of-a-degree model would be claiming a precision the model does
// not have.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

const norm360 = (deg: number): number => ((deg % 360) + 360) % 360;

/** Julian centuries from J2000.0. */
function julianCenturies(date: Date): number {
  return (date.getTime() / 86400000 + 2440587.5 - 2451545.0) / 36525;
}

export interface EquatorialPosition {
  /** Right ascension, degrees. */
  ra: number;
  /** Declination, degrees. */
  dec: number;
  /** Ecliptic longitude, degrees - the phase calculation needs it. */
  eclipticLon: number;
  /** Ecliptic latitude, degrees. */
  eclipticLat: number;
}

/** The obliquity of the ecliptic, which is what tilts the seasons. */
function obliquity(T: number): number {
  return 23.439291 - 0.0130042 * T;
}

function eclipticToEquatorial(lon: number, lat: number, T: number): EquatorialPosition {
  const eps = obliquity(T) * D2R;
  const l = lon * D2R;
  const b = lat * D2R;
  const ra = Math.atan2(
    Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps),
    Math.cos(l),
  ) * R2D;
  const dec = Math.asin(
    Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l),
  ) * R2D;
  return { ra: norm360(ra), dec, eclipticLon: norm360(lon), eclipticLat: lat };
}

export function sunPosition(date: Date): EquatorialPosition {
  const T = julianCenturies(date);
  // Mean longitude and mean anomaly, then the equation of centre.
  const L0 = 280.46646 + 36000.76983 * T;
  const M = (357.52911 + 35999.05029 * T) * D2R;
  const C = 1.914602 * Math.sin(M) + 0.019993 * Math.sin(2 * M) + 0.000289 * Math.sin(3 * M);
  return eclipticToEquatorial(L0 + C, 0, T);
}

export function moonPosition(date: Date): EquatorialPosition {
  const T = julianCenturies(date);
  // Mean elements. The four largest periodic terms below are enough for a
  // third of a degree, which is well inside what any of this needs.
  const Lp = 218.316 + 481267.8813 * T;          // mean longitude
  const Mp = (134.963 + 477198.8676 * T) * D2R;  // mean anomaly
  const M = (357.529 + 35999.0503 * T) * D2R;    // Sun's mean anomaly
  const D = (297.850 + 445267.1115 * T) * D2R;   // mean elongation
  const F = (93.272 + 483202.0175 * T) * D2R;    // argument of latitude

  const lon = Lp
    + 6.289 * Math.sin(Mp)
    + 1.274 * Math.sin(2 * D - Mp)
    + 0.658 * Math.sin(2 * D)
    + 0.214 * Math.sin(2 * Mp)
    - 0.186 * Math.sin(M)
    - 0.114 * Math.sin(2 * F);
  const lat = 5.128 * Math.sin(F)
    + 0.281 * Math.sin(Mp + F)
    - 0.278 * Math.sin(F - Mp);

  return eclipticToEquatorial(lon, lat, T);
}

/** Greenwich mean sidereal time in degrees. */
export function greenwichSiderealDegrees(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  return norm360(
    280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T - (T * T * T) / 38710000,
  );
}

/** How high something is above the horizon, in degrees. Negative is below. */
export function altitudeDegrees(
  position: EquatorialPosition,
  latitude: number,
  longitude: number,
  date: Date,
): number {
  const lst = greenwichSiderealDegrees(date) + longitude;
  const hourAngle = norm360(lst - position.ra) * D2R;
  const phi = latitude * D2R;
  const dec = position.dec * D2R;
  return Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hourAngle),
  ) * R2D;
}

export interface MoonPhase {
  /** Lit fraction of the disc, 0 new to 1 full. */
  illumination: number;
  /** Angle between Sun and Moon as seen from Earth, degrees. */
  elongation: number;
  waxing: boolean;
  /** A plain name for the phase. */
  name: string;
}

export function moonPhase(date: Date): MoonPhase {
  const moon = moonPosition(date);
  const sun = sunPosition(date);
  const dLon = (moon.eclipticLon - sun.eclipticLon) * D2R;
  const lat = moon.eclipticLat * D2R;
  const elongation = Math.acos(Math.cos(lat) * Math.cos(dLon)) * R2D;
  // New moon is zero elongation and unlit; full is 180 and fully lit.
  const illumination = (1 - Math.cos(elongation * D2R)) / 2;
  const waxing = Math.sin(dLon) > 0;

  let name = 'Full moon';
  if (illumination < 0.04) name = 'New moon';
  else if (illumination < 0.35) name = waxing ? 'Waxing crescent' : 'Waning crescent';
  else if (illumination < 0.65) name = waxing ? 'First quarter' : 'Last quarter';
  else if (illumination < 0.96) name = waxing ? 'Waxing gibbous' : 'Waning gibbous';

  return { illumination, elongation, waxing, name };
}

export type Darkness = 'daylight' | 'civil twilight' | 'nautical twilight' | 'astronomical twilight' | 'dark';

export interface SkyConditions {
  atMs: number;
  sunAltitude: number;
  moonAltitude: number;
  phase: MoonPhase;
  darkness: Darkness;
  /**
   * How much the sky is washed out, 0 perfectly dark to 1 hopeless.
   *
   * Twilight and moonlight combined. A full Moon high in a properly dark sky
   * lands around 0.55: it costs you the faint stuff and the colour in a phone
   * photo, but a real display still gets through, which is why this is not
   * allowed to reach 1 on moonlight alone.
   */
  washout: number;
}

export function skyConditionsAt(atMs: number, latitude: number, longitude: number): SkyConditions {
  const date = new Date(atMs);
  const sunAlt = altitudeDegrees(sunPosition(date), latitude, longitude, date);
  const moonAlt = altitudeDegrees(moonPosition(date), latitude, longitude, date);
  const phase = moonPhase(date);

  let darkness: Darkness = 'dark';
  if (sunAlt > -0.833) darkness = 'daylight';
  else if (sunAlt > -6) darkness = 'civil twilight';
  else if (sunAlt > -12) darkness = 'nautical twilight';
  else if (sunAlt > -18) darkness = 'astronomical twilight';

  // Twilight runs from nothing at -18 degrees to total at the horizon.
  const twilight = Math.max(0, Math.min(1, (sunAlt + 18) / 18));
  // Moonlight scales with how lit it is and how high it sits. Below the
  // horizon it costs nothing at all, which is the whole reason a late-rising
  // moon can leave a perfectly good window earlier in the night.
  const moonHeight = Math.max(0, Math.sin(moonAlt * D2R));
  const moonlight = phase.illumination * moonHeight * 0.55;

  return {
    atMs,
    sunAltitude: sunAlt,
    moonAltitude: moonAlt,
    phase,
    darkness,
    washout: Math.min(1, twilight + moonlight * (1 - twilight)),
  };
}

export type VisibilityTier = 'none' | 'camera' | 'phone' | 'eye';

export interface VisibilityOutlook {
  tier: VisibilityTier;
  label: string;
  /** The strength that survived the sky, 0-100. */
  effectiveStrength: number;
  note: string;
}

/**
 * What you could expect to see, given how strong the display should be and
 * what the sky is doing.
 *
 * The thresholds are the app's existing three tiers - camera, phone, naked eye
 * - and they are judgement calls rather than measured quantities. The ordering
 * is not: a long exposure always beats a phone, which always beats an eye, and
 * that is what the bands encode.
 */
export function visibilityOutlook(strength0to100: number, sky: SkyConditions): VisibilityOutlook {
  const strength = Math.max(0, Math.min(100, strength0to100));
  const effective = strength * (1 - sky.washout);

  if (sky.darkness === 'daylight') {
    return {
      tier: 'none', label: 'Daylight', effectiveStrength: 0,
      note: 'The Sun is up at this point. Nothing is visible however strong the stream is - '
          + 'though a stream lasts days, so look at the following night.',
    };
  }

  let tier: VisibilityTier = 'none';
  if (effective >= 50) tier = 'eye';
  else if (effective >= 28) tier = 'phone';
  else if (effective >= 11) tier = 'camera';

  const moonNote = sky.moonAltitude > 0 && sky.phase.illumination > 0.3
    ? ` The Moon is up and ${Math.round(sky.phase.illumination * 100)}% lit, which is washing out some of it.`
    : sky.moonAltitude <= 0
      ? ' The Moon is below the horizon, so the sky is as dark as it gets.'
      : '';
  const twilightNote = sky.darkness !== 'dark' ? ` Still ${sky.darkness} at this point.` : '';

  const label = tier === 'eye' ? 'Visible to the naked eye'
    : tier === 'phone' ? 'Phone camera should catch it'
    : tier === 'camera' ? 'Long exposure only'
    : 'Unlikely to be visible';

  return { tier, label, effectiveStrength: effective, note: `${label}.${moonNote}${twilightNote}` };
}

/**
 * The best sky in a window, and when.
 *
 * An arrival is a window, not an instant, and the Moon sets and twilight ends
 * inside it. Naming the best moment is more useful than describing the middle
 * of the window, which may well be the worst part of it.
 */
export function bestSkyWithin(
  fromMs: number,
  toMs: number,
  latitude: number,
  longitude: number,
  stepMinutes = 20,
): SkyConditions | null {
  if (!(toMs > fromMs)) return null;
  const step = stepMinutes * 60000;
  if ((toMs - fromMs) / step > 5000) return null;

  let best: SkyConditions | null = null;
  for (let t = fromMs; t <= toMs; t += step) {
    const sky = skyConditionsAt(t, latitude, longitude);
    if (!best || sky.washout < best.washout) best = sky;
  }
  return best;
}
