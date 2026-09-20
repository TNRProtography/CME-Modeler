// --- START OF FILE src/components/game/stormModel.ts ---
//
// The physics behind Storm Builder.
//
// The player only ever touches the Sun end: where the eruption happens on the
// disk, how fast it leaves, how wide it is, and how the flux rope inside it is
// twisted. Everything after that is derived here, because the whole point of
// the game is that the Sun end decides the Earth end. If you could reach in and
// adjust what arrives at L1 there would be no lesson in it.
//
// The chain, in order:
//   eruption on the disk -> is it even pointed at us, and how squarely
//   -> drag through the solar wind, which sets the transit time
//   -> a shock, a sheath and then the rope itself passing L1
//   -> coupling into the magnetosphere
//   -> how far north the aurora oval pushes, and who in New Zealand sees it.

export type FlareClass = 'C' | 'M' | 'X';

export interface StormInput {
  flareClass: FlareClass;
  flareMag:   number;    // 1 - 9.9 within the class
  lonDeg:     number;    // Stonyhurst longitude, 0 is facing Earth
  latDeg:     number;    // Stonyhurst latitude
  speedKms:   number;    // launch speed
  halfWidthDeg: number;  // angular half width of the cloud
  // The flux rope. axialDeg is the orientation of the field as the rope's
  // leading edge reaches us, measured clockwise from north in the GSM Y-Z
  // plane, so 180 is fully southward. rotationDeg is how far the field turns
  // as the rope passes, signed by the rope's handedness.
  axialDeg:   number;
  rotationDeg: number;
  ropeHours:  number;    // how long the rope itself takes to pass
  launchMs:   number;    // when it left the Sun
}

export interface L1Point {
  tMs:  number;
  bt:   number;
  bz:   number;
  by:   number;
  bx:   number;
  speed: number;
  density: number;
  tempK: number;
  region: 'ambient' | 'sheath' | 'rope';
}

export interface StormResult {
  hits:          boolean;
  missReason:    string | null;
  separationDeg: number;   // angle between the cloud's nose and the Sun-Earth line
  impact:        number;   // 0 at the edge of the cloud, 1 straight down the middle
  transitHours:  number;
  arrivalMs:     number;   // when the shock reaches L1
  arrivalSpeed:  number;
  peakBt:        number;
  minBz:         number;
  series:        L1Point[];
  // Everything the Earth end does, sampled on the same series
  peakScore:     number;   // 0 - 100, the app's own kind of aurora score
  peakKp:        number;
  peakBoundaryLat: number; // equatorward edge of the oval, degrees south
  peakAtMs:      number;
  /** The best moment that actually fell in darkness over New Zealand. */
  bestVisibleAtMs: number;
  bestVisibleScore: number;
  bestVisibleBoundaryLat: number;
  substorm:      boolean;
}

const AU_KM        = 149_597_870;
const L1_KM        = AU_KM * 0.99;
const AMBIENT_WIND = 400;      // km/s
const HOUR_MS      = 3_600_000;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Flare energy on a single scale, so a C1 and an X9 can be compared. Each class
// is ten times the one below it, which is what the letters mean.
export function flareEnergy(cls: FlareClass, mag: number): number {
  const base = cls === 'X' ? 100 : cls === 'M' ? 10 : 1;
  return base * clamp(mag, 1, 9.9);
}

// Angle between where the cloud is pointed and where we are. A cloud erupting
// from the limb can still clip us if it is wide enough, but it arrives late and
// weak because we only catch its flank.
export function separationDeg(lonDeg: number, latDeg: number): number {
  const a = (lonDeg * Math.PI) / 180, b = (latDeg * Math.PI) / 180;
  const cos = Math.cos(a) * Math.cos(b);
  return (Math.acos(clamp(cos, -1, 1)) * 180) / Math.PI;
}

// Drag based propagation, in the spirit of the model the app uses for real
// CMEs: a cloud faster than the wind around it is dragged back, a slow one is
// pushed along, and both tend toward the ambient speed on the way out.
// Returns transit time to L1 and the speed on arrival.
export function propagate(speedKms: number, halfWidthDeg: number): { hours: number; arrivalSpeed: number } {
  // Wider clouds sweep up more wind, so they are dragged harder. The range here
  // is set so the transit times land where real ones do: roughly 18 hours for
  // the very fastest events, two days for a middling one, and the better part
  // of four days for something barely quicker than the wind itself.
  const gamma = (0.18 + 0.30 * (halfWidthDeg / 70)) * 1e-8; // per km
  let v = speedKms, x = 0;
  const dt = 60; // seconds
  let t = 0;
  // Guard the loop: even a very slow cloud is at L1 inside a fortnight.
  const maxT = 14 * 24 * 3600;
  while (x < L1_KM && t < maxT) {
    const dv = -gamma * (v - AMBIENT_WIND) * Math.abs(v - AMBIENT_WIND);
    v += dv * dt;
    x += v * dt;
    t += dt;
  }
  return { hours: t / 3600, arrivalSpeed: Math.max(280, v) };
}

// How strong the field in the cloud is when it gets here. Energy sets how much
// flux was launched, speed compresses it, and hitting us off centre means we
// only sample the weaker flank.
function arrivalBt(input: StormInput, impact: number, arrivalSpeed: number): number {
  const e = flareEnergy(input.flareClass, input.flareMag);
  const fromEnergy = 7 * Math.pow(e / 10, 0.24);
  const fromSpeed  = Math.pow(arrivalSpeed / 600, 0.80);
  // Wide clouds have spread their flux over more sky by the time they arrive.
  const spread = Math.pow(35 / Math.max(15, input.halfWidthDeg), 0.35);
  return clamp(fromEnergy * fromSpeed * spread * (0.35 + 0.65 * impact), 2, 75);
}

// The Newell coupling function, the same one the app uses on real data. It is
// the best single number for how hard the solar wind is driving the
// magnetosphere, and it is why southward field matters so much more than speed.
export function newellCoupling(bz: number, by: number, speed: number): number {
  const bt = Math.hypot(by, bz);
  if (bt <= 0) return 0;
  const clock = Math.atan2(Math.abs(by), bz === 0 ? 1e-9 : bz);
  const theta = bz >= 0 ? clock : Math.PI - Math.atan2(Math.abs(by), -bz);
  const sinHalf = Math.abs(Math.sin(theta / 2));
  return Math.pow(Math.max(speed, 0), 4 / 3) * Math.pow(bt, 2 / 3) * Math.pow(sinHalf, 8 / 3);
}

// A minute by minute record of what a spacecraft at L1 would have seen. This is
// deliberately the same shape the app's own analysers expect, so the real
// panels can be pointed straight at it.
export function buildSeries(input: StormInput, res: {
  impact: number; arrivalMs: number; arrivalSpeed: number;
}): L1Point[] {
  const out: L1Point[] = [];
  const bt0 = arrivalBt(input, res.impact, res.arrivalSpeed);
  // A faster cloud drives a thicker, more violent sheath ahead of itself.
  const sheathHours = sheathHoursFor(res.arrivalSpeed);
  const ropeHours   = input.ropeHours;
  const preHours    = 6;
  const postHours   = 6;
  const startMs = res.arrivalMs - preHours * HOUR_MS;
  const totalMin = Math.round((preHours + sheathHours + ropeHours + postHours) * 60);

  // Deterministic wobble, so replaying the same storm gives the same series.
  let seed = Math.round(input.axialDeg * 7 + input.speedKms + input.lonDeg * 13) || 1;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };

  for (let m = 0; m < totalMin; m++) {
    const tMs = startMs + m * 60_000;
    const hoursFromShock = (tMs - res.arrivalMs) / HOUR_MS;
    let bt: number, bz: number, by: number, bx: number;
    let speed: number, density: number, tempK: number;
    let region: L1Point['region'];

    if (hoursFromShock < 0) {
      // Quiet wind ahead of the shock.
      region = 'ambient';
      bt = 4.5 + noise() * 1.6;
      const ang = noise() * Math.PI * 2;
      bz = bt * 0.55 * Math.sin(ang); by = bt * 0.55 * Math.cos(ang); bx = bt * 0.5;
      speed = AMBIENT_WIND + noise() * 25;
      density = 5 + noise() * 2;
      tempK = 90_000 + noise() * 20_000;
    } else if (hoursFromShock < sheathHours) {
      // The sheath: compressed, shocked wind piled up ahead of the cloud. Hot,
      // dense and turbulent, and its field swings about at random. This is the
      // part people mistake for the storm proper.
      region = 'sheath';
      const f = hoursFromShock / sheathHours;
      // Sheath field is gusty minute to minute, not just variable in direction.
      // That variability is exactly what tells a sheath apart from a cloud, so
      // getting it wrong here makes the whole structure unreadable.
      const gust = 1 + 0.42 * Math.sin(hoursFromShock * 31.7)
                     + 0.30 * Math.sin(hoursFromShock * 11.3 + 1.7)
                     + noise() * 0.85;
      bt = bt0 * (0.70 + 0.30 * Math.sin(f * Math.PI)) * clamp(gust, 0.22, 2.1);
      // The sheath field is ambient wind draped around the nose of the cloud,
      // so it leans the way the rope's leading edge does, with turbulence piled
      // on top. It swings far too quickly to load the tail the way the rope
      // itself can, which is why a violent sheath often disappoints.
      const lean = (input.axialDeg * Math.PI) / 180;
      const turb = noise() * 2.4 + Math.sin(hoursFromShock * 5.1) * 0.9;
      bz = bt * (0.42 * Math.cos(lean) + 0.55 * Math.sin(turb));
      by = bt * (0.42 * Math.sin(lean) + 0.55 * Math.cos(turb));
      bx = bt * 0.3 * Math.sin(turb * 0.7);
      speed = res.arrivalSpeed * (1 - 0.05 * f) + noise() * 30;
      density = (14 + 16 * Math.sin(f * Math.PI)) * (0.6 + 0.4 * res.impact) + noise() * 4;
      tempK = 400_000 + 350_000 * Math.sin(f * Math.PI);
    } else if (hoursFromShock < sheathHours + ropeHours) {
      // The rope. Smooth, strong field that turns steadily as the structure
      // passes, plasma that is cold and thin. That coldness is the giveaway
      // that you are inside a magnetic cloud and not still in the sheath.
      region = 'rope';
      const f = (hoursFromShock - sheathHours) / ropeHours;
      // Field is strongest through the middle of the rope.
      const envelope = 0.62 + 0.38 * Math.sin(Math.PI * clamp(f, 0, 1));
      bt = bt0 * 1.18 * envelope + noise() * 0.5;
      // The field turns from where it started, by however much the rope is
      // twisted. Off centre hits sample less of that turn.
      const theta = ((input.axialDeg + input.rotationDeg * f * (0.55 + 0.45 * res.impact)) * Math.PI) / 180;
      // theta is measured from north, so cos is the northward part.
      bz = bt * Math.cos(theta);
      by = bt * Math.sin(theta);
      bx = bt * 0.16 * Math.sin(f * Math.PI);
      speed = res.arrivalSpeed * (1 - 0.14 * f) + noise() * 10;
      density = (4.5 - 1.8 * f) * (0.7 + 0.3 * res.impact) + noise() * 0.7;
      tempK = 28_000 + 12_000 * f;    // cold, the magnetic cloud signature
    } else {
      // Behind the cloud, back to ordinary wind, though faster than before.
      region = 'ambient';
      const f = (hoursFromShock - sheathHours - ropeHours) / postHours;
      bt = 5.5 - 1.2 * f + noise() * 1.4;
      const ang = noise() * Math.PI * 2;
      bz = bt * 0.5 * Math.sin(ang); by = bt * 0.5 * Math.cos(ang); bx = bt * 0.5;
      speed = res.arrivalSpeed * (0.82 - 0.12 * f) + noise() * 20;
      density = 4 + noise() * 1.5;
      tempK = 110_000 + noise() * 30_000;
    }

    out.push({
      tMs,
      bt: +Math.max(0.2, bt).toFixed(2),
      bz: +bz.toFixed(2), by: +by.toFixed(2), bx: +bx.toFixed(2),
      speed: +Math.max(250, speed).toFixed(1),
      density: +Math.max(0.3, density).toFixed(2),
      tempK: Math.round(Math.max(8000, tempK)),
      region,
    });
  }
  return out;
}

// The Earth end. Coupling drives a score on the same 0 - 100 scale the app
// shows, and that score decides how far the aurora oval reaches toward the
// equator, which is what actually determines who gets to see anything.
// The magnetosphere does not respond to a single minute of data, it integrates.
// That matters a great deal here: a sheath whose field thrashes north and south
// every few minutes never gets to load the tail, while a rope sitting quietly
// southward for hours does. Scoring on a trailing average rather than on the
// instantaneous reading is what makes that difference show up, and it is the
// honest way round, not a thumb on the scale.
export function scoreAt(smoothBz: number, smoothBy: number, smoothSpeed: number,
                        smoothDensity: number, runningSouthMin: number): number {
  const newell = newellCoupling(smoothBz, smoothBy, smoothSpeed);
  const newellScore = clamp((newell / 22000) * 100, 0, 100);
  const bzScore     = clamp((-smoothBz / 30) * 100, 0, 100);
  const speedScore  = clamp(((smoothSpeed - 380) / 620) * 100, 0, 100);
  const pressure    = 1.6726e-6 * smoothDensity * smoothSpeed * smoothSpeed;
  const pressScore  = clamp(((pressure - 1.5) / 18) * 100, 0, 100);
  // Southward field has to persist to do much. A one minute dip does nothing,
  // half an hour of it loads the tail.
  const persist     = clamp((runningSouthMin / 60) * 100, 0, 100);
  const raw = newellScore * 0.30 + bzScore * 0.26 + speedScore * 0.12
            + pressScore * 0.08 + persist * 0.24;
  // Nothing happens at all without southward field, however fast the wind is.
  // This is the single thing the game most wants people to walk away with, so
  // the model should not quietly hand out a decent score without it.
  const gate = clamp((-smoothBz - 1) / 7, 0, 1);
  return clamp(raw * gate, 0, 100);
}

// Where the equatorward edge of the auroral oval sits, in degrees of latitude.
// Quiet nights it hugs 67 degrees and only Antarctica is under it. A severe
// storm drags it up past 45, which is when Christchurch and further north
// start to see colour rather than a glow on the horizon.
export function boundaryLatFromScore(score: number): number {
  return 67 - 24 * Math.pow(clamp(score, 0, 100) / 100, 0.82);
}

export function kpFromScore(score: number): number {
  return +clamp(score / 11.5, 0, 9).toFixed(1);
}

// Where in the rope the field is most southward, as a fraction of the way
// through it. The build screen uses this to tell the player when the good part
// of their storm will arrive, which is the whole timing puzzle: it is no use
// landing the shock at 10pm if the field does not turn south until lunchtime.
export function peakFraction(axialDeg: number, rotationDeg: number): number {
  let best = 0, bestSouth = -Infinity;
  for (let i = 0; i <= 40; i++) {
    const f = i / 40;
    const th = ((axialDeg + rotationDeg * f) * Math.PI) / 180;
    const south = -Math.cos(th);
    if (south > bestSouth) { bestSouth = south; best = f; }
  }
  return best;
}

export function sheathHoursFor(arrivalSpeed: number): number {
  // Capped at seven hours. A faster cloud does drive a thicker sheath, but the
  // analyser only looks for the cloud within eight hours of the shock, so a
  // longer one here would mean it never finds the rope on exactly the big
  // storms people most want to build. Seven is well inside the real range.
  return clamp(2 + (arrivalSpeed - 400) / 220, 1.5, 7);
}

export function runStorm(input: StormInput): StormResult {
  const sep = separationDeg(input.lonDeg, input.latDeg);
  const hits = sep < input.halfWidthDeg;
  // Straight down the middle is a full hit, the very edge is a graze.
  const impact = hits ? clamp(Math.cos((sep / Math.max(1, input.halfWidthDeg)) * (Math.PI / 2)), 0, 1) : 0;

  const { hours, arrivalSpeed } = propagate(input.speedKms, input.halfWidthDeg);
  // A glancing blow takes longer to reach us, because we are catching the flank
  // rather than the nose.
  const transitHours = hours * (1 + 0.22 * (1 - impact));
  const arrivalMs = input.launchMs + transitHours * HOUR_MS;

  const base = {
    hits,
    missReason: hits ? null
      : `Erupted ${Math.round(sep)}° from the Sun-Earth line, and the cloud is only ${Math.round(input.halfWidthDeg)}° wide. It went past us.`,
    separationDeg: sep,
    impact,
    transitHours,
    arrivalMs,
    arrivalSpeed,
  };

  if (!hits) {
    return { ...base, series: [], peakBt: 0, minBz: 0, peakScore: 0, peakKp: 0,
             peakBoundaryLat: 67, peakAtMs: arrivalMs, bestVisibleAtMs: arrivalMs,
             bestVisibleScore: 0, bestVisibleBoundaryLat: 67, substorm: false };
  }

  const series = buildSeries(input, base);

  let peakScore = 0, peakAtMs = arrivalMs, minBz = 0, peakBt = 0;
  // Tracked separately: the strongest moment that actually fell in darkness.
  // A storm that peaks at one in the afternoon did not happen as far as anyone
  // standing in a paddock is concerned, and the brief is graded on this.
  let bestVisible = -1, bestVisibleAtMs = arrivalMs, bestVisibleScore = 0;
  let southMin = 0;
  const WIN = 20;   // minutes the magnetosphere is taken to average over
  for (let i = 0; i < series.length; i++) {
    const p = series[i];
    if (p.bz < -1) southMin += 1; else southMin = Math.max(0, southMin - 4);
    const from = Math.max(0, i - WIN + 1);
    let sBz = 0, sBy = 0, sV = 0, sN = 0;
    for (let k = from; k <= i; k++) {
      sBz += series[k].bz; sBy += series[k].by; sV += series[k].speed; sN += series[k].density;
    }
    const n = i - from + 1;
    const s = scoreAt(sBz / n, sBy / n, sV / n, sN / n, southMin);
    if (s > peakScore) { peakScore = s; peakAtMs = p.tMs; }
    const visible = s * darknessAt(p.tMs);
    if (visible > bestVisible) { bestVisible = visible; bestVisibleAtMs = p.tMs; bestVisibleScore = s; }
    if (p.bz < minBz) minBz = p.bz;
    if (p.bt > peakBt) peakBt = p.bt;
  }

  return {
    ...base,
    series,
    peakBt: +peakBt.toFixed(1),
    minBz: +minBz.toFixed(1),
    peakScore: +peakScore.toFixed(1),
    peakKp: kpFromScore(peakScore),
    peakBoundaryLat: +boundaryLatFromScore(peakScore).toFixed(1),
    peakAtMs,
    bestVisibleAtMs,
    bestVisibleScore: +bestVisibleScore.toFixed(1),
    bestVisibleBoundaryLat: +boundaryLatFromScore(bestVisibleScore).toFixed(1),
    // A long southward stretch loads the tail until it lets go.
    substorm: peakScore > 45 && minBz < -8,
  };
}
// --- END OF FILE src/components/game/stormModel.ts ---

// ── What New Zealand actually sees ─────────────────────────────────────────
// A score means nothing to anyone standing in a paddock. What matters is
// whether you can see it from where you live, and with what.

export type Tier = 'nothing' | 'camera' | 'phone' | 'eye';

export interface Place { name: string; lat: number; island: 'S' | 'N'; }

// South to north, because that is the order they light up in.
export const NZ_PLACES: Place[] = [
  { name: 'Invercargill', lat: -46.41, island: 'S' },
  { name: 'Dunedin',      lat: -45.87, island: 'S' },
  { name: 'Queenstown',   lat: -45.03, island: 'S' },
  { name: 'Christchurch', lat: -43.53, island: 'S' },
  { name: 'Greymouth',    lat: -42.45, island: 'S' },
  { name: 'Wellington',   lat: -41.29, island: 'N' },
  { name: 'Napier',       lat: -39.49, island: 'N' },
  { name: 'Auckland',     lat: -36.85, island: 'N' },
];

export interface MoonState { illumination: number; up: boolean; }

// How much of the sky the Moon washes out. A full Moon high in the sky will
// take a camera-only aurora and leave you with nothing at all, which is the
// part people forget when they drive three hours to the coast.
export function moonPenalty(moon: MoonState): number {
  if (!moon.up) return 0;
  return Math.pow(clamp(moon.illumination, 0, 100) / 100, 1.35) * 22;
}

// Aurora sits above the oval, so you can see it from well equatorward of the
// boundary, just lower down the sky and fainter. The gap between where you are
// and where the oval has reached is what decides whether it is a naked eye
// show, a phone photo, or a long exposure of a faint grey smudge.
export function tierFor(placeLat: number, boundaryLat: number, moon: MoonState): Tier {
  // Degrees of latitude between the site and the equatorward edge of the oval.
  const gap = boundaryLat - Math.abs(placeLat);
  const effective = gap - moonPenalty(moon) * 0.28;
  if (effective <= -1.5) return 'eye';      // the oval is overhead or past you
  if (effective <= 3.5)  return 'eye';
  if (effective <= 8)    return 'phone';
  if (effective <= 14)   return 'camera';
  return 'nothing';
}

export const TIER_LABEL: Record<Tier, string> = {
  nothing: 'Nothing to see',
  camera:  'A long exposure would pick it up',
  phone:   'A phone on night mode would get it',
  eye:     'Visible to the naked eye',
};

export const TIER_RANK: Record<Tier, number> = { nothing: 0, camera: 1, phone: 2, eye: 3 };

export function visibilityAcrossNZ(boundaryLat: number, moon: MoonState): { place: Place; tier: Tier }[] {
  return NZ_PLACES.map(place => ({ place, tier: tierFor(place.lat, boundaryLat, moon) }));
}

// ── Time of day ────────────────────────────────────────────────────────────
// None of it counts if it arrives in daylight. This is the lesson that catches
// people out: you can build a perfect storm and waste it on a Tuesday lunchtime.

export function nzHourAt(ms: number): number {
  // New Zealand runs UTC+12, or UTC+13 on daylight saving. Close enough for a
  // game, and it keeps the arithmetic obvious.
  const d = new Date(ms);
  const month = d.getUTCMonth();
  const offset = month >= 8 || month <= 2 ? 13 : 12;
  return (d.getUTCHours() + offset + d.getUTCMinutes() / 60) % 24;
}

// Fraction of the aurora you actually get to see, given how dark it is.
// Astronomical dark is roughly 10pm to 4am in summer, longer in winter, and
// twilight either side is a partial write off.
export function darknessAt(ms: number): number {
  const h = nzHourAt(ms);
  if (h >= 22 || h < 4) return 1;
  if (h >= 21 || h < 5) return 0.55;
  if (h >= 20 || h < 6) return 0.2;
  return 0;
}

export function darknessLabel(ms: number): string {
  const d = darknessAt(ms);
  if (d >= 1)    return 'full dark';
  if (d >= 0.55) return 'twilight';
  if (d > 0)     return 'not yet dark';
  return 'broad daylight';
}

export function formatNZ(ms: number): string {
  const h = nzHourAt(ms);
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
  const ampm = hh < 12 ? 'am' : 'pm';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm % 60).padStart(2, '0')}${ampm}`;
}

// The boundary the sky is effectively at once darkness is taken into account.
// A storm at noon may as well not have happened.
export function effectiveBoundary(boundaryLat: number, atMs: number): number {
  const dark = darknessAt(atMs);
  if (dark <= 0) return 90;      // nothing is visible at all
  return boundaryLat + (1 - dark) * 9;
}
