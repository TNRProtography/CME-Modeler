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
const T = await load('utils/chTracking.ts');
await load('utils/chRegistry.ts');
const St = await load('utils/chDetectionStore.ts');

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

// ── following one hole across frames ───────────────────────────
console.log('\nFollowing one hole across frames');
{
  const hole = (id, lat, lon, widthDeg = 25) => ({ id, lat, lon, widthDeg, darkness: 0.6 });
  const frame = (hoursAgo, holes) => ({ atMs: T0 - hoursAgo * 3600000, holes });
  // How far the Sun turns in an hour.
  const perHour = RATE / 24;

  // One hole, seen four times, rotating. The detector renumbers from zero
  // every frame, so ordering alone cannot connect them.
  const rotating = T.buildChTracks([
    frame(6, [hole('CH_SUVI_0', 10, -6 * perHour)]),
    frame(4, [hole('CH_SUVI_0', 10, -4 * perHour)]),
    frame(2, [hole('CH_SUVI_0', 10, -2 * perHour)]),
    frame(0, [hole('CH_SUVI_0', 10, 0)]),
  ]);
  check(rotating.length === 1, 'four sightings of a rotating hole are one track', String(rotating.length));
  check(rotating[0].points.length === 4, 'with all four measurements kept');
  check(rotating[0].present, 'and it is present in the newest frame');
  check(rotating[0].firstSeenMs === T0 - 6 * 3600000, 'first seen six hours ago');
  check(rotating[0].lastSeenMs === T0, 'and last seen now');

  // Two holes that never move near each other stay separate.
  const two = T.buildChTracks([
    frame(2, [hole('a', 30, -10), hole('b', -40, 30)]),
    frame(0, [hole('a', 30, -10 + 2 * perHour), hole('b', -40, 30 + 2 * perHour)]),
  ]);
  check(two.length === 2, 'two separate holes stay two tracks', String(two.length));
  check(two.every(t => t.points.length === 2), 'each with its own history');

  // The detector reversing its ordering between frames must not swap them.
  const swapped = T.buildChTracks([
    frame(2, [hole('CH_SUVI_0', 30, -10), hole('CH_SUVI_1', -40, 30)]),
    frame(0, [hole('CH_SUVI_0', -40, 30 + 2 * perHour), hole('CH_SUVI_1', 30, -10 + 2 * perHour)]),
  ]);
  check(swapped.length === 2, 'reordered detections do not create new tracks', String(swapped.length));
  check(swapped.every(t => t.points.every(p => Math.abs(p.hole.lat - t.latest.lat) < 1)),
        'and each track keeps a consistent latitude, so they were not crossed over');

  // A hole that stops being detected is still a track, just not present.
  const vanished = T.buildChTracks([
    frame(6, [hole('a', 0, -6 * perHour), hole('b', 50, 20)]),
    frame(0, [hole('a', 0, 0)]),
  ]);
  check(vanished.length === 2, 'a hole that disappeared is still a track', String(vanished.length));
  const goneTrack = vanished.find(t => !t.present);
  check(goneTrack != null, 'and is marked as not present');
  check(goneTrack.lastSeenMs === T0 - 6 * 3600000, 'with the time it was last seen');
  check(vanished[0].present, 'the live one sorts first');

  // Two holes drifting close together cannot both claim one detection.
  const merged = T.buildChTracks([
    frame(2, [hole('a', 0, 0), hole('b', 12, 6)]),
    frame(0, [hole('only', 6, 3 + 2 * perHour)]),
  ]);
  check(merged.length === 2, 'when two holes merge into one, both tracks survive', String(merged.length));
  check(merged.filter(t => t.present).length === 1,
        'but only one of them claims the surviving detection');
  check(merged.filter(t => !t.present).length === 1, 'and the other is marked gone');

  check(T.buildChTracks([]).length === 0, 'no frames, no tracks');
  check(T.buildChTracks([frame(0, [])]).length === 0, 'an empty frame gives nothing');

  // Order the frames arrive in does not matter.
  const shuffled = T.buildChTracks([
    frame(0, [hole('a', 10, 0)]),
    frame(4, [hole('a', 10, -4 * perHour)]),
    frame(2, [hole('a', 10, -2 * perHour)]),
  ]);
  check(shuffled.length === 1 && shuffled[0].points.length === 3,
        'frames can arrive in any order');
  check(shuffled[0].points[0].atMs < shuffled[0].points[2].atMs, 'and come out oldest first');

  // Rotation is the whole reason this cannot be a plain distance check. A
  // hole moves 13.2 degrees a day, so over two days it has moved further than
  // the match radius and a raw comparison loses it entirely.
  const twoDaysApart = T.buildChTracks([
    { atMs: T0 - 2 * DAY, holes: [hole('a', 0, -2 * RATE)] },
    { atMs: T0, holes: [hole('a', 0, 0)] },
  ]);
  check(twoDaysApart.length === 1, 'a hole tracked across two days is one hole');
  check(twoDaysApart[0].points.length === 2, 'with both measurements');

  // And the converse: something sitting at the same longitude two days later
  // has NOT rotated with the Sun, so it is not the same hole.
  const stationary = T.buildChTracks([
    { atMs: T0 - 2 * DAY, holes: [hole('a', 0, 0)] },
    { atMs: T0, holes: [hole('a', 0, 0)] },
  ]);
  check(stationary.length === 2,
        'something that stayed at the same longitude for two days is not the same hole',
        String(stationary.length));
}

// ── why a hole is gone ────────────────────────────────────
console.log('\nSaying why a hole is no longer there');
{
  const track = (lon, lastSeenHoursAgo, present = false) => ({
    key: 'k', present, latest: { id: 'a', lat: 0, lon, widthDeg: 20, darkness: 0.5 },
    points: [], firstSeenMs: T0 - DAY, lastSeenMs: T0 - lastSeenHoursAgo * 3600000,
  });

  check(T.chDisappearance(track(0, 0, true), T0, T0).gone === false,
        'a hole in the latest frame has not gone anywhere');

  // Past the west limb: still there, still sending wind, just not visible.
  const rotated = T.chDisappearance(track(85, 1), T0, T0);
  check(rotated.reason === 'rotated-off', 'one past the west limb has rotated off', rotated.reason);
  check(/still arrives|still on its way/.test(rotated.note),
        'and its stream is still described as coming', rotated.note);

  // On the disk and missing for hours: it closed up.
  const closed = T.chDisappearance(track(10, 6), T0, T0);
  check(closed.reason === 'closed', 'one missing for six hours mid-disk has closed', closed.reason);
  check(/open field has closed/.test(closed.note), 'and says what that means');

  // On the disk and missing from one frame: probably us, not the Sun.
  const lost = T.chDisappearance(track(10, 1), T0, T0);
  check(lost.reason === 'lost', 'one missing from a single frame is just missed', lost.reason);
  check(/faint or partial/.test(lost.note),
        'and is honest that this is our problem rather than the hole closing', lost.note);
  check(lost.label !== closed.label && closed.label !== rotated.label,
        'the three cases read differently on the badge');
}

// ── which frames get measured ────────────────────────────────
console.log('\nChoosing which frames to run the detector on');
{
  // SUVI publishes every four minutes. Running a canvas decode and a flood
  // fill on all of them would be hundreds of passes for a shape that does not
  // meaningfully change inside two hours.
  const every4Min = [];
  for (let i = 0; i < 360; i++) {
    every4Min.push({ url: `f${i}`, atMs: T0 - (360 - i) * 4 * 60000 });
  }

  const picked = St.spacedFrames(every4Min);
  check(picked.length > 0 && picked.length <= 16,
        `a day of four-minute frames comes down to ${picked.length} detections`, String(picked.length));
  check(picked[picked.length - 1].url === 'f359', 'and the newest frame is always one of them');

  let minGap = Infinity;
  for (let i = 1; i < picked.length - 1; i++) {
    minGap = Math.min(minGap, picked[i].atMs - picked[i - 1].atMs);
  }
  check(minGap >= St.DETECT_SPACING_MS,
        'the chosen frames are at least two hours apart', `${minGap / 3600000}h`);

  // A week of imagery, measured a pass at a time, must eventually cover the
  // week. The pass limit used to be applied before the already-measured
  // frames were dropped, so every pass reconsidered the same newest sixteen:
  // once those were done no pass had anything left to do, and tracking
  // stopped at MAX_PER_PASS * DETECT_SPACING_MS - about thirty-two hours -
  // no matter how much imagery the worker offered.
  {
    const week = [];
    for (let i = 0; i < 7 * 24 * 15; i++) {          // a week at four minutes
      week.push({ url: `w${i}`, atMs: T0 - (7 * 24 * 15 - i) * 4 * 60000 });
    }

    const measured = new Set();
    let passes = 0;
    for (; passes < 40; passes++) {
      const wanted = St.spacedFrames(week, St.DETECT_SPACING_MS, Infinity)
        .filter((f) => !measured.has(f.url))
        .slice(-16);
      if (wanted.length === 0) break;
      check(wanted.length <= 16, 'no pass takes more than sixteen frames', String(wanted.length));
      for (const f of wanted) measured.add(f.url);
    }

    const spanHours = (T0 - Math.min(...[...measured].map(
      (u) => week.find((f) => f.url === u).atMs))) / 3600000;
    check(spanHours > 160, `successive passes reach back ${spanHours.toFixed(0)}h, not 32`,
          `${spanHours.toFixed(0)}h`);
    check(passes < 40, `and get there in ${passes} passes rather than never`, String(passes));

    // The default is unchanged: one pass on its own is still bounded.
    check(St.spacedFrames(week).length <= 16, 'a single default pass is still capped at sixteen');
  }

  check(St.spacedFrames([]).length === 0, 'no frames, nothing to measure');
  const one = St.spacedFrames([{ url: 'a', atMs: T0 }]);
  check(one.length === 1 && one[0].url === 'a', 'a single frame is measured');

  // Junk in the list does not become a detection attempt.
  check(St.spacedFrames([{ url: '', atMs: T0 }, { url: 'b', atMs: NaN }]).length === 0,
        'frames with no url or no time are dropped');

  // Order in does not matter.
  const shuffled = St.spacedFrames([
    { url: 'c', atMs: T0 },
    { url: 'a', atMs: T0 - 6 * 3600000 },
    { url: 'b', atMs: T0 - 3 * 3600000 },
  ]);
  check(shuffled.map(f => f.url).join(',') === 'a,b,c', 'frames come back oldest first', String(shuffled.map(f => f.url)));
}

// ── a week of memory ──────────────────────────────────────
console.log('\nCombining a week of records with this session\'s detections');
{
  const hole = (id, lon) => ({ id, lat: 0, lon, widthDeg: 20, darkness: 0.5 });
  const state = {
    history: [
      { atMs: T0 - 3 * DAY, holes: [hole('a', -40)] },
      { atMs: T0 - DAY, holes: [hole('a', -13)] },
      // Same moment as a full detection below, to prove which one wins.
      { atMs: T0, holes: [hole('stale', 99)] },
    ],
    detections: [
      { atMs: T0, holes: [{ ...hole('fresh', 0), polygon: [], heightDeg: 18 }], disk: {}, b0Deg: 7, frameUrl: 'u' },
    ],
    progress: null, error: null,
  };

  const frames = St.framesForTracking(state);
  check(frames.length === 3, 'three distinct moments, not four', String(frames.length));
  check(frames[0].atMs < frames[2].atMs, 'oldest first');
  check(frames[2].holes[0].id === 'fresh',
        'where both exist for a moment, this session\'s full detection wins over the stored record',
        frames[2].holes[0].id);
  check(frames[0].holes[0].widthDeg === 20, 'and the older records keep their measurements');

  // The point of keeping a week: a hole seen three days ago is still followed.
  const tracks = T.buildChTracks(frames);
  check(tracks.length >= 1, 'the week of records builds tracks');
  const longest = tracks.reduce((a, b) => (a.points.length >= b.points.length ? a : b));
  check(longest.points.length === 3,
        'and one hole is followed across all three days', String(longest.points.length));

  check(St.framesForTracking({ history: [], detections: [], progress: null, error: null }).length === 0,
        'nothing remembered and nothing detected gives nothing');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
