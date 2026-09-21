#!/usr/bin/env node
// What a coronal hole is about to do to the wind at Earth.
//
//   npm run test:coronal-holes
//
// A hole matters for a different reason than a sunspot region does. Nothing
// has to happen for it to affect us - the wind is already leaving it - so the
// questions are when that stream gets here and how fast it will be going. Both
// answers hang off the same rotation arithmetic, and both are shown to people
// deciding which night to go out, so they are worth pinning down.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'ch-'));

async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
await load('utils/solarEphemeris.ts');
const W = await load('utils/solarWindModel.ts');
await load('utils/coronalHoleData.ts');
await load('utils/imagePixels.ts');
const S = await load('utils/suviCoronalHoleDetector.ts');
const D = await load('utils/solarDisk.ts');
const C = await load('utils/coronalHoleDynamics.ts');
const H = await load('utils/coronalHoleHistory.ts');

// The real model the panel uses, not a mirror of it: a mirror drifts the
// moment the model is retuned, and then the tests agree with nothing.
const estimate = W.estimateHssSpeedFromChWidthAndDarkness;

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const DAY = 86400000;
const HOUR = 3600000;
const T0 = Date.UTC(2026, 8, 21, 12);
const RATE = D.SOLAR_SYNODIC_DEG_PER_DAY;

// ── where the hole is ──────────────────────────────────────────────────────
console.log('\nWhere a hole is in its trip across the disk');
{
  const now = C.chTiming(0, T0, T0);
  check(Math.abs(now.daysToCentralMeridian) < 1e-9, 'a hole on the meridian is there now');
  check(now.facingEarthOrPast, 'and counts as facing us');
  check(now.onDisk, 'and is on the disk');

  const east = C.chTiming(-40, T0, T0);
  check(!east.facingEarthOrPast, 'one still east of centre has not faced us yet');
  check(Math.abs(east.daysToCentralMeridian - 40 / RATE) < 1e-9,
        `and gets there in ${(40 / RATE).toFixed(1)} days`, String(east.daysToCentralMeridian));

  const west = C.chTiming(60, T0, T0);
  check(west.facingEarthOrPast && west.daysToCentralMeridian < 0,
        'one past centre faced us in the past');

  // A measurement ages: the hole has turned since it was taken.
  const stale = C.chTiming(0, T0 - 2 * DAY, T0);
  check(Math.abs(stale.longitude - 2 * RATE) < 1e-9,
        'a two-day-old measurement is carried forward before anything else', String(stale.longitude));
  check(!C.chTiming(10, T0, T0 + 8 * DAY).onDisk, 'and eventually rotates off the disk');
}

// ── when the stream arrives ────────────────────────────────────────────────
console.log('\nWhen the stream gets to Earth');
{
  // 1 AU is 149.6 million km. The textbook rule of thumb is two to four days
  // after the hole crosses the middle of the disk; the arithmetic has to land
  // inside that or the number on screen is wrong for a reason nobody can see.
  const slow = C.hssArrivalMs(400, T0);
  const fast = C.hssArrivalMs(700, T0);
  const slowDays = (slow - T0) / DAY;
  const fastDays = (fast - T0) / DAY;
  check(Math.abs(slowDays - 4.33) < 0.05, `400 km/s takes ${slowDays.toFixed(2)} days`, String(slowDays));
  check(Math.abs(fastDays - 2.47) < 0.05, `700 km/s takes ${fastDays.toFixed(2)} days`, String(fastDays));
  check(slowDays > fastDays, 'and slower wind always arrives later');

  check(C.hssArrivalMs(0, T0) === null, 'a zero speed has no arrival rather than an infinite one');
  check(C.hssArrivalMs(-100, T0) === null, 'nor does a negative one');
  check(C.hssArrivalMs(NaN, T0) === null, 'nor an unmeasurable one');

  // Every speed the width model can produce has to land somewhere sensible.
  // The band was toned down 25% to match observed arrival speeds rather than
  // peak ones, which pushes the slowest holes past four days - so the check is
  // that nothing falls outside two to six, not that everything fits the
  // textbook two-to-four.
  let slowest = 0, fastest = Infinity;
  for (let w = 1; w <= 90; w += 1) {
    for (const dark of [0, 0.5, 1]) {
      const d = (C.hssArrivalMs(estimate(w, dark), T0) - T0) / DAY;
      slowest = Math.max(slowest, d);
      fastest = Math.min(fastest, d);
    }
  }
  check(fastest >= 2 && slowest <= 6,
        `the model's whole range arrives between ${fastest.toFixed(1)} and ${slowest.toFixed(1)} days`,
        `${fastest} .. ${slowest}`);
  check(estimate(60, 1) <= 675 && estimate(1, 0) >= 330,
        `and the speeds themselves stay inside the toned-down band: ${estimate(1, 0)} to ${estimate(60, 1)}`,
        `${estimate(1, 0)} .. ${estimate(60, 1)}`);
}

// ── which measurement to believe ───────────────────────────────────────────
console.log('\nWhich measurement of a hole the speed comes from');
{
  const sample = (days, widthDeg, longitude, darkness = 0.5) =>
    ({ atMs: T0 + days * DAY, widthDeg, longitude, darkness });

  // A hole that has crossed the meridian: the sample taken near centre is the
  // honest one, because a hole near the limb measures narrower than it is.
  const crossed = C.chSpeedForEarth([
    sample(-4, 20, -50),
    sample(-1, 34, -3),     // near centre: truest width
    sample(0, 22, 10),
  ], estimate);
  check(crossed.basis === 'earth-facing', 'once a hole has faced us, that is the sample used', crossed.basis);
  check(crossed.usedAtMs === T0 - 1 * DAY,
        'and it is the one closest to dead centre, not the most recent',
        new Date(crossed.usedAtMs).toISOString());
  check(crossed.speedKms === Math.round(estimate(34, 0.5)),
        'so the speed comes off the un-foreshortened width', String(crossed.speedKms));

  // The same hole measured only while still east of centre has no such sample.
  const approaching = C.chSpeedForEarth([
    sample(-2, 14, -60),
    sample(0, 19, -35),
  ], estimate);
  check(approaching.basis === 'latest', 'before it faces us, the latest measurement is used', approaching.basis);
  check(approaching.usedAtMs === T0, 'which is the most recent one');
  check(/east of facing us/.test(approaching.note),
        'and the note says so rather than presenting it as settled', approaching.note);
  check(/35/.test(approaching.note), 'naming how far off it still is');

  check(C.chSpeedForEarth([], estimate).basis === 'none', 'no measurements gives no speed');
  check(C.chSpeedForEarth([], estimate).speedKms === null, 'and a null rather than a guess');
  check(C.chSpeedForEarth([sample(0, 0, 5)], estimate).basis === 'none',
        'a zero-width detection is not a measurement');
  check(C.chSpeedForEarth([sample(0, NaN, 5)], estimate).basis === 'none',
        'nor is an unmeasurable one');

  // Exactly on the meridian counts as facing us.
  const dead = C.chSpeedForEarth([sample(-1, 30, 0), sample(0, 12, 13)], estimate);
  check(dead.basis === 'earth-facing' && dead.usedAtMs === T0 - DAY,
        'a hole sitting exactly on the meridian counts as facing us');

  // A hole can cross the meridian between two frames. The best measurement is
  // then the last one before the crossing, not the first one after it.
  const straddled = C.chSpeedForEarth([sample(-1, 33, -4), sample(0, 24, 9)], estimate);
  check(straddled.basis === 'earth-facing', 'a hole that crossed between frames has still faced us');
  check(straddled.usedAtMs === T0 - DAY,
        'and the closest frame to centre is used even though it is on the east side',
        new Date(straddled.usedAtMs).toISOString());

  // Order in should not matter.
  const shuffled = C.chSpeedForEarth([sample(0, 22, 10), sample(-4, 20, -50), sample(-1, 34, -3)], estimate);
  check(shuffled.speedKms === crossed.speedKms, 'the samples can arrive in any order');
}

// ── opening or closing ─────────────────────────────────────────────────────
console.log('\nWhether a hole is opening or closing');
{
  const s = (days, widthDeg) => ({ atMs: T0 + days * DAY, widthDeg, longitude: 0, darkness: 0.5 });

  check(C.chGrowth([]).phase === 'unknown', 'nothing to say from no measurements');
  check(C.chGrowth([s(0, 20)]).phase === 'unknown', 'nor from a single one');
  check(C.chGrowth([s(0, 20), s(0, 30)]).phase === 'unknown', 'nor from two at the same moment');

  const fast = C.chGrowth([s(-2, 20), s(0, 40)]);
  check(fast.phase === 'opening fast', 'twenty degrees in two days is opening fast', fast.phase);
  check(Math.abs(fast.widthPerDay - 10) < 1e-9, 'at ten degrees a day', String(fast.widthPerDay));
  check(fast.days === 2 && fast.widthChange === 20, 'over the span actually measured');

  check(C.chGrowth([s(-3, 30), s(0, 39)]).phase === 'opening', 'a slower gain is just opening');
  // The line between the two sits at 8% of its own width per day.
  check(C.chGrowth([s(-3, 30), s(0, 37.3)]).phase === 'opening', 'just over the line is opening');
  check(C.chGrowth([s(-3, 30), s(0, 36.9)]).phase === 'steady', 'just under it is steady');
  check(C.chGrowth([s(-3, 30), s(0, 31)]).phase === 'steady', 'a degree in three days is steady');
  check(C.chGrowth([s(-3, 40), s(0, 28)]).phase === 'closing', 'and shrinking reads as closing');

  // Rate is judged against the hole's own size: the same absolute gain means
  // more on a small hole than on one already spanning a third of the disk.
  const small = C.chGrowth([s(-2, 6), s(0, 12)]);
  const big = C.chGrowth([s(-2, 60), s(0, 66)]);
  check(small.widthPerDay === big.widthPerDay, 'two holes can gain at the same rate');
  check(small.phase === 'opening fast' && big.phase === 'steady',
        'but six degrees is a lot on a small hole and nothing on a huge one',
        `${small.phase} / ${big.phase}`);
}

// ── drawing it at another moment ───────────────────────────────────────────
console.log('\nDrawing a hole where it is now');
{
  const hole = {
    lat: -20, lon: 10, widthDeg: 30, heightDeg: 20,
    polygon: [{ lat: 5, lon: -10 }, { lat: 5, lon: 10 }, { lat: -5, lon: 10 }, { lat: -5, lon: -10 }],
  };

  const same = C.chOutlineAt(hole, T0, T0);
  check(same.length === 4, 'the polygon keeps its shape');
  check(same[0].lon === 0 && same[0].lat === -15, 'offsets are laid onto the centroid', JSON.stringify(same[0]));

  const later = C.chOutlineAt(hole, T0, T0 + DAY);
  const shift = later[0].lon - same[0].lon;
  check(Math.abs(shift - RATE) < 1e-9, 'a day later the whole outline has turned with the Sun', String(shift));
  check(later.every((p, i) => p.lat === same[i].lat), 'latitude does not change as it rotates');
  check(later.every((p, i) => Math.abs((p.lon - same[i].lon) - RATE) < 1e-9),
        'and every vertex moves by the same amount, so the shape is not sheared');

  // No polygon: an ellipse from the width and height.
  const ellipse = C.chOutlineAt({ lat: 0, lon: 0, widthDeg: 30, heightDeg: 20 }, T0, T0);
  check(ellipse.length === 36, 'a hole with no outline falls back to an ellipse');
  const lons = ellipse.map(p => p.lon), lats = ellipse.map(p => p.lat);
  check(Math.abs(Math.max(...lons) - 15) < 1e-9 && Math.abs(Math.min(...lons) + 15) < 1e-9,
        'spanning the measured width');
  check(Math.abs(Math.max(...lats) - 10) < 1e-9, 'and the measured height');
  check(C.chOutlineAt({ lat: 0, lon: 0, widthDeg: 30, polygon: [{ lat: 1, lon: 1 }] }, T0, T0).length === 36,
        'a degenerate two-point outline falls back too rather than drawing a line');
}

// ── matching a hole to its earlier self ────────────────────────────────────
console.log('\nMatching a hole to its own earlier measurements');
{
  // This is the bug the de-rotation fixes. A hole sitting at 0 today was at
  // -13.2 a day ago and -26.4 two days ago. Matching raw longitudes against a
  // 25 degree threshold, the two-day-old measurement of the SAME hole cannot
  // match itself - and a different hole 20 degrees to its west can match
  // better than its own earlier self.
  const now = Date.now();
  const snapAt = (daysAgo, holes) => ({
    timestampMs: now - daysAgo * DAY,
    coronalHoles: holes,
  });
  const at = (id, lat, lon, widthDeg = 25) => ({
    id, lat, lon, widthDeg, heightDeg: 20, darkness: 0.6,
    estimatedSpeedKms: 600, areaFraction: 0.02,
  });

  const current = [{
    id: 'CH_SUVI_0', lat: 0, lon: 0, widthDeg: 25, heightDeg: 20, darkness: 0.6,
    estimatedSpeedKms: 600, sourceDirectionDeg: { lat: 0, lon: 0 },
    expansionHalfAngleDeg: 20, opacity: 0.5,
  }];

  const history = {
    snapshots: [
      snapAt(3, [at('a', 0, -3 * RATE)]),
      snapAt(2, [at('a', 0, -2 * RATE)]),
      snapAt(1, [at('a', 0, -1 * RATE)]),
    ],
    count: 3, oldestMs: now - 3 * DAY, newestMs: now - DAY,
  };

  const tracks = H.buildEvolutionTracks(history, current);
  const matched = tracks[0].snapshots.filter(s => s.ch !== null).length;
  check(tracks.length === 1, 'one hole in gives one track out');
  check(matched === 4, `all three historical snapshots match, plus today: ${matched}/4`, String(matched));

  // And it still refuses a hole that genuinely is somewhere else.
  const elsewhere = {
    snapshots: [snapAt(1, [at('b', 55, -1 * RATE)])],
    count: 1, oldestMs: now - DAY, newestMs: now - DAY,
  };
  const noMatch = H.buildEvolutionTracks(elsewhere, current);
  check(noMatch[0].snapshots.filter(s => s.ch !== null).length === 1,
        'a hole 55 degrees away in latitude is still not a match');

  // The failure the old code had: given a real earlier self AND a decoy that
  // happens to sit where the raw comparison would look, it must pick the self.
  const withDecoy = {
    snapshots: [snapAt(2, [at('self', 0, -2 * RATE), at('decoy', 8, 5)])],
    count: 1, oldestMs: now - 2 * DAY, newestMs: now - 2 * DAY,
  };
  const picked = H.buildEvolutionTracks(withDecoy, current)[0].snapshots.find(s => s.hoursAgo > 1)?.ch;
  check(picked != null, 'a two-day-old measurement of a hole can match itself at all');
  check(picked && Math.abs(picked.lon + 2 * RATE) < 1e-6,
        'and it matches its own earlier self rather than a nearer-looking neighbour',
        picked ? String(picked.lon) : 'null');
}

// ── the two projections are inverses ────────────────────────────
console.log('\nPixels to heliographic and back again');
{
  // The detector traces a hole in pixels and converts to lat/lon. The panel
  // takes that lat/lon and converts back to pixels to draw it. The two
  // conversions live in different files and were written months apart, so
  // nothing but this makes them agree - and when they disagree the outlines
  // are drawn next to the holes rather than on them, which is exactly what
  // happened when one of them carried the axis tilt and the other did not.
  const geom = { width: 400, height: 400, cx: 197.5, cy: 193.25, radius: 168.4 };

  for (const b0 of [0, 7.25, -7.25, 3.1]) {
    let worst = 0;
    let checked = 0;
    for (let px = 40; px <= 360; px += 11) {
      for (let py = 40; py <= 360; py += 11) {
        const hg = S.pixelToHG(px, py, geom.cx, geom.cy, geom.radius, b0);
        if (!hg) continue;
        const back = D.heliographicToPixel(hg.lat, hg.lon, geom, b0, 0);
        if (!back.onDisk) continue;
        worst = Math.max(worst, Math.hypot(back.x - px, back.y - py));
        checked++;
      }
    }
    check(checked > 300, `B0 ${b0}: ${checked} points on the disk to check`, String(checked));
    check(worst < 0.001,
          `B0 ${b0}: every one of them comes back to within ${worst.toExponential(1)} pixels`,
          String(worst));
  }

  // And the tilt actually does something, so a test passing at B0=0 is not
  // quietly passing for every tilt.
  const flat = S.pixelToHG(200, 150, geom.cx, geom.cy, geom.radius, 0);
  const tilted = S.pixelToHG(200, 150, geom.cx, geom.cy, geom.radius, 7.25);
  check(Math.abs(tilted.lat - flat.lat) > 3,
        `a 7.25 degree tilt moves this point ${(tilted.lat - flat.lat).toFixed(1)} degrees in latitude`,
        `${flat.lat} vs ${tilted.lat}`);

  // Disk centre is the sub-Earth point whatever the tilt, by definition.
  for (const b0 of [0, 7.25, -7.25]) {
    const centre = S.pixelToHG(geom.cx, geom.cy, geom.cx, geom.cy, geom.radius, b0);
    check(Math.abs(centre.lon) < 1e-9 && Math.abs(centre.lat - b0) < 1e-9,
          `B0 ${b0}: the middle of the disk is longitude zero, latitude ${b0}`,
          JSON.stringify(centre));
  }

  // Off the disk is nothing, not a clamped guess at the nearest edge.
  check(S.pixelToHG(10, 10, geom.cx, geom.cy, geom.radius, 0) === null,
        'a pixel in the corner of the frame is not on the Sun');

  // Longitude keeps its sign right out to the limb. The old asin form folded
  // back past 90 degrees, so two very different places read the same.
  const west = S.pixelToHG(geom.cx + geom.radius * 0.97, geom.cy, geom.cx, geom.cy, geom.radius, 0);
  const east = S.pixelToHG(geom.cx - geom.radius * 0.97, geom.cy, geom.cx, geom.cy, geom.radius, 0);
  check(west.lon > 70 && east.lon < -70, 'near the limbs the longitudes are opposite and large',
        `${west.lon.toFixed(1)} / ${east.lon.toFixed(1)}`);
  check(Math.abs(west.lon + east.lon) < 1e-9, 'and symmetric about the middle');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
