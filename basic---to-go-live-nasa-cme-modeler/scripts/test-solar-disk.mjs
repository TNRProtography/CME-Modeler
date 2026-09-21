#!/usr/bin/env node
// Putting a sunspot where it actually is.
//
//   npm run test:solar-disk
//
// The tracker drew each region by mapping its heliographic coordinate straight
// onto the disk, which quietly assumes we are looking square at the solar
// equator. We never are: Earth's orbit is tilted 7.25 degrees to it, so the
// latitude of disk centre - B0 - swings between -7.25 and +7.25 over a year.
// Leaving it out moves a region by up to 12% of the solar radius, which is
// several times the width of the spot being labelled, and it was being papered
// over with a fixed pixel nudge that by construction could not fix it: the
// error depends on where the region is, and a constant does not.
//
// The three things below are the ones that were wrong, and each is checked
// against something outside this codebase where possible - Meeus for the
// ephemeris, a synthetic image with a known disk for the geometry.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'solardisk-'));

/**
 * Load the TypeScript utils.
 *
 * Node strips the types itself; all this does is copy the files somewhere it
 * will and give the relative imports the explicit extension ESM wants. No
 * hand-rolled type stripping - a regex that rewrites source is one more thing
 * that can be wrong about the code it is meant to be testing.
 */
async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8')
    .replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}

await load('utils/solarEphemeris.ts');
const D = await load('utils/solarDisk.ts');
const E = await load('utils/solarEphemeris.ts');
const L = await load('utils/labelLayout.ts');
const P = await load('utils/framePlayback.ts');
const RL = await load('utils/regionLabels.ts');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// ── 1. the ephemeris, against Meeus ────────────────────────────────────────
console.log('\nThe solar axis, checked against a worked example');
{
  // Meeus, Astronomical Algorithms, example 29.a: 1992 October 13.0 TD.
  const dt = new Date(Date.UTC(1992, 9, 13));
  check(Math.abs(E.julianDay(dt) - 2448908.5) < 1e-6,
        'the Julian Day matches (2448908.5)', String(E.julianDay(dt)));

  const { p, b0, l0 } = E.solarDiskOrientation(dt);
  check(Math.abs(p - 26.27) < 0.05, `P is +26.27 (got ${p.toFixed(2)})`);
  check(Math.abs(b0 - 5.99) < 0.05, `B0 is +5.99 (got ${b0.toFixed(2)})`);
  check(Math.abs(l0 - 238.63) < 0.1, `L0 is 238.63 (got ${l0.toFixed(2)})`);
}

console.log('\nAnd it moves through the year the way it should');
{
  const b0On = (iso) => E.solarDiskOrientation(new Date(iso + 'T00:00:00Z')).b0;
  // B0 is at its southern extreme in early March, zero in early June, northern
  // extreme in early September, zero again in early December.
  check(Math.abs(b0On('2026-03-06') + 7.25) < 0.1, `early March is about -7.25 (${b0On('2026-03-06').toFixed(2)})`);
  check(Math.abs(b0On('2026-09-06') - 7.25) < 0.1, `early September is about +7.25 (${b0On('2026-09-06').toFixed(2)})`);
  check(Math.abs(b0On('2026-06-05')) < 0.4, `early June crosses zero (${b0On('2026-06-05').toFixed(2)})`);
  check(Math.abs(b0On('2026-12-07')) < 0.4, `early December crosses zero (${b0On('2026-12-07').toFixed(2)})`);

  let min = 99, max = -99;
  for (let d = 0; d < 366; d++) {
    const b = E.solarDiskOrientation(new Date(Date.UTC(2026, 0, 1) + d * 86400000)).b0;
    min = Math.min(min, b); max = Math.max(max, b);
  }
  check(max <= 7.3 && min >= -7.3 && max > 7.1 && min < -7.1,
        `it never leaves +-7.25 over a year (${min.toFixed(2)} to ${max.toFixed(2)})`);
}

// ── 2. the projection ──────────────────────────────────────────────────────
const GEOM = { width: 1000, height: 1000, cx: 500, cy: 500, radius: 310 };

console.log('\nThe projection puts a region where the picture shows it');
{
  // Disk centre is disk centre whatever B0 is doing, as long as the region is
  // at the sub-Earth point.
  const c = D.heliographicToPixel(0, 0, GEOM, 0);
  check(Math.abs(c.x - 500) < 1e-9 && Math.abs(c.y - 500) < 1e-9, 'lat 0, lon 0, B0 0 is dead centre');

  // With B0 north, the solar equator appears below centre.
  const eq = D.heliographicToPixel(0, 0, GEOM, 7.09);
  check(eq.y > 500, `a +7.09 tilt pushes the equator below centre (y=${eq.y.toFixed(1)})`);
  check(Math.abs(eq.x - 500) < 1e-9, 'and leaves the central meridian where it was');

  // East is left, west is right - the convention NOAA writes its codes in.
  check(D.heliographicToPixel(0, -60, GEOM, 0).x < 500, 'east longitudes fall left of centre');
  check(D.heliographicToPixel(0, 60, GEOM, 0).x > 500, 'west longitudes fall right of centre');
  check(D.heliographicToPixel(30, 0, GEOM, 0).y < 500, 'northern latitudes fall above centre');

  // Round the back is not drawn.
  check(D.heliographicToPixel(0, 120, GEOM, 0).onDisk === false, 'a region on the far side is off-disk');
  check(D.heliographicToPixel(0, 89.9, GEOM, 0).onDisk === true, 'one just inside the limb is on-disk');

  // A pole is only visible when the relevant hemisphere is tipped toward us.
  check(D.heliographicToPixel(89, 0, GEOM, 7.09).onDisk === true, 'the north pole shows when B0 is positive');
  check(D.heliographicToPixel(-89, 0, GEOM, 7.09).onDisk === false, 'and the south pole does not');
}

console.log('\nThe error that was being papered over');
{
  // The regions from the report, on the imagery from 21 September 2026, with
  // the disk geometry measured off that frame.
  const b0 = E.solarDiskOrientation(new Date('2026-09-21T01:45:00Z')).b0;
  check(Math.abs(b0 - 7.09) < 0.05, `B0 that day was +7.09 (got ${b0.toFixed(2)})`);

  const cases = [['AR4533 S14E64', -14, -64], ['AR4534 N11W08', 11, 8], ['AR4532 S06W54', -6, 54]];
  let worst = 0;
  for (const [name, lat, lon] of cases) {
    const without = D.heliographicToPixel(lat, lon, GEOM, 0);
    const withB0 = D.heliographicToPixel(lat, lon, GEOM, b0);
    const dy = withB0.y - without.y;
    worst = Math.max(worst, Math.abs(dy));
    console.log(`    ${name}: B0 moves it ${dy.toFixed(1)}px down a ${GEOM.radius}px radius`);
    check(dy > 0, `${name} sits lower once B0 is applied`);
  }
  check(worst > 15,
        `the shift is far bigger than a spot is wide (worst ${worst.toFixed(1)}px)`,
        'if this were small, the old code would have been close enough');

  // And the old fixed nudge could not have fixed it: it moved everything the
  // same way, while the real error differs per region.
  const shifts = cases.map(([, lat, lon]) =>
    D.heliographicToPixel(lat, lon, GEOM, b0).y - D.heliographicToPixel(lat, lon, GEOM, 0).y);
  const spread = Math.max(...shifts) - Math.min(...shifts);
  check(spread > 8,
        `the error varies by region, so no constant offset fixes it (spread ${spread.toFixed(1)}px)`);
}

// ── 3. finding the disk in the picture ─────────────────────────────────────
console.log('\nMeasuring the disk, with the caption in the way');
{
  const W = 512, H = 512;
  const make = (cx, cy, r, withCaption) => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        d[i + 3] = 255;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) { d[i] = 240; d[i + 1] = 170; d[i + 2] = 70; }
      }
    }
    if (withCaption) {
      // "SDO/HMI Quick-Look Continuum 20260921_014500" - a line of small bright
      // glyphs low on the left, well outside the disk. A bounding box of lit
      // pixels swallows this and drags the centre with it.
      for (let g = 0; g < 26; g++) {
        for (let y = H - 14; y < H - 8; y++) {
          for (let x = 8 + g * 7; x < 8 + g * 7 + 4; x++) {
            const i = (y * W + x) * 4;
            d[i] = d[i + 1] = d[i + 2] = 230; d[i + 3] = 255;
          }
        }
      }
    }
    return d;
  };

  for (const [cx, cy, r] of [[256, 256, 232], [256, 256, 180], [250, 262, 200]]) {
    const g = D.detectSolarDiskGeometry(make(cx, cy, r, true), W, H);
    const ok = g && Math.abs(g.cx - cx) <= 2 && Math.abs(g.cy - cy) <= 2 && Math.abs(g.radius - r) <= 2;
    check(ok, `a disk at (${cx},${cy}) r=${r} is measured through the caption`,
          g ? `got (${g.cx.toFixed(1)},${g.cy.toFixed(1)}) r=${g.radius.toFixed(1)}` : 'not found');
  }

  // Proof the caption is the thing that would have broken it.
  const naive = (() => {
    const d = make(256, 256, 232, true);
    let left = W, right = 0, top = H, bottom = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] > 24) {
        if (x < left) left = x; if (x > right) right = x;
        if (y < top) top = y; if (y > bottom) bottom = y;
      }
    }
    return { cx: (left + right) / 2, cy: (top + bottom) / 2, radius: Math.max(right - left, bottom - top) / 2 };
  })();
  check(Math.abs(naive.cy - 256) > 5 || Math.abs(naive.radius - 232) > 5,
        'while a bounding box of lit pixels is thrown off by it',
        `bounding box says (${naive.cx.toFixed(1)},${naive.cy.toFixed(1)}) r=${naive.radius.toFixed(1)}`);

  // Nothing disk-shaped means say so rather than guess.
  const blank = new Uint8ClampedArray(W * H * 4).fill(0);
  check(D.detectSolarDiskGeometry(blank, W, H) === null, 'an empty frame returns null so the caller can fall back');
}

console.log('\nAnd through the corona, on EUV imagery');
{
  // SUVI is not HMI: the disk is bright but so is the corona outside the limb,
  // and a fixed low threshold counts that as disk and reports a Sun bigger
  // than the one in the picture.
  const W = 400, H = 400;
  const cx = 200, cy = 200, r = 140, halo = 190;
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dist = Math.hypot(x - cx, y - cy);
      let v = 0;
      if (dist <= r) v = 210;
      else if (dist <= halo) v = 55;            // corona, well above a fixed 40
      d[i] = v; d[i + 1] = Math.round(v * 0.7); d[i + 2] = Math.round(v * 0.3); d[i + 3] = 255;
    }
  }
  const g = D.detectSolarDiskGeometry(d, W, H);
  check(g !== null, 'the disk is found at all');
  check(g && Math.abs(g.radius - r) <= 3,
        `the radius is the limb, not the corona (want ${r}, halo reaches ${halo})`,
        g ? `got ${g.radius.toFixed(1)}` : 'null');
  check(g && Math.abs(g.cx - cx) <= 2 && Math.abs(g.cy - cy) <= 2,
        'and the centre is right', g ? `(${g.cx.toFixed(1)},${g.cy.toFixed(1)})` : 'null');
}

console.log('\nA letterboxed image maps back to its panel');
{
  // The imagery panel is wider than it is tall and the Sun is square, so the
  // image does not fill it. Treating panel percentages as image percentages
  // puts every label off by half the letterbox.
  const rect = D.containedImageRect({ width: 1280, height: 1280 }, { width: 600, height: 400 });
  check(Math.abs(rect.height - 400) < 1e-9, 'it fills the short side');
  check(Math.abs(rect.width - 400) < 1e-9, 'and stays square');
  check(Math.abs(rect.x - 100) < 1e-9 && Math.abs(rect.y) < 1e-9,
        'centred, with the bars on the left and right', `x=${rect.x}, y=${rect.y}`);
  check(Math.abs(rect.scale - 400 / 1280) < 1e-9, 'and reports the scale to map through');

  // A disk centre in image pixels lands in the middle of the panel.
  const px = rect.x + 640 * rect.scale;
  check(Math.abs(px - 300) < 1e-9, 'the image centre maps to the panel centre', String(px));

  const tall = D.containedImageRect({ width: 1280, height: 1280 }, { width: 300, height: 500 });
  check(Math.abs(tall.width - 300) < 1e-9 && Math.abs(tall.y - 100) < 1e-9,
        'and the other way round when the panel is tall');
  check(D.containedImageRect({ width: 0, height: 0 }, { width: 10, height: 10 }).scale === 1,
        'an unloaded image does not divide by zero');
}

console.log('\nRegions are carried back to the frame being shown');
{
  // Scrub the timeline back and the Sun has turned since NOAA measured the
  // region, so the reported longitude belongs to a later frame than the one
  // on screen.
  const rate = D.SOLAR_SYNODIC_DEG_PER_DAY;
  check(Math.abs(rate - 13.1995) < 0.01, `the synodic rate is 13.2 deg/day (${rate.toFixed(4)})`);

  const observed = Date.UTC(2026, 8, 21, 12);
  check(D.longitudeAt(10, observed, observed) === 10, 'at the observation time it is unchanged');

  const dayLater = D.longitudeAt(10, observed, observed + 86400000);
  check(Math.abs(dayLater - (10 + rate)) < 1e-9,
        'a day later it has rotated one day west', String(dayLater));
  const sixHoursBefore = D.longitudeAt(10, observed, observed - 6 * 3600000);
  check(sixHoursBefore < 10, 'and six hours earlier it was further east', String(sixHoursBefore));
  check(Math.abs(sixHoursBefore - (10 - rate / 4)) < 1e-9, 'by exactly a quarter of a day');

  // What that is worth in pixels, which is the point of doing it at all.
  const geom = { width: 1000, height: 1000, cx: 500, cy: 500, radius: 310 };
  const now = D.heliographicToPixel(0, D.longitudeAt(10, observed, observed), geom, 0);
  const back = D.heliographicToPixel(0, D.longitudeAt(10, observed, observed - 6 * 3600000), geom, 0);
  const shift = Math.abs(now.x - back.x);
  console.log(`    six hours of rotation moves a disk-centre region ${shift.toFixed(1)}px of a ${geom.radius}px radius`);
  check(shift > 10, 'six hours of scrubbing is worth more than a spot width');
}

console.log('\nAcross the whole 24 hour window the imagery offers');
{
  // The imagery panel offers 3, 6, 12 and 24 hour windows. The longer ones are
  // where getting this wrong shows: a day of rotation is 13 degrees, which
  // near disk centre is most of the way across a sunspot group.
  const geom = { width: 1000, height: 1000, cx: 500, cy: 500, radius: 310 };
  const observed = Date.UTC(2026, 8, 21, 12);
  const rate = D.SOLAR_SYNODIC_DEG_PER_DAY;

  for (const hours of [3, 6, 12, 24]) {
    const frameMs = observed - hours * 3600000;
    const lon = D.longitudeAt(20, observed, frameMs);
    const drift = 20 - lon;
    const uncorrected = D.heliographicToPixel(0, 20, geom, 0);
    const corrected = D.heliographicToPixel(0, lon, geom, 0);
    const px = Math.abs(uncorrected.x - corrected.x);
    console.log(`    ${String(hours).padStart(2)}h back: ${drift.toFixed(2)} deg, ${px.toFixed(1)}px`);
    check(Math.abs(drift - rate * hours / 24) < 1e-9,
          `${hours}h back rotates by exactly ${(rate * hours / 24).toFixed(2)} degrees`);
    check(corrected.x < uncorrected.x, `and moves the region east, as the Sun turning backwards should`);
  }

  // Over the full day the shift is big enough to matter on any screen.
  const dayLon = D.longitudeAt(20, observed, observed - 86400000);
  const dayPx = Math.abs(D.heliographicToPixel(0, 20, geom, 0).x
                       - D.heliographicToPixel(0, dayLon, geom, 0).x);
  check(dayPx > 60, `a full day is worth ${dayPx.toFixed(0)}px on a ${geom.radius}px radius`);

  // A region near the east limb now was round the back a day ago, and must be
  // dropped rather than drawn squashed against the edge.
  const nearEastLimb = -84;
  const dayAgo = D.longitudeAt(nearEastLimb, observed, observed - 86400000);
  check(dayAgo < -90, `a region at E84 was behind the limb a day earlier (${dayAgo.toFixed(1)})`);
  check(D.heliographicToPixel(0, dayAgo, geom, 0).onDisk === false,
        'and is reported off-disk, so nothing is drawn for it');

  // B0 barely moves in a day, but it is taken from the frame time anyway.
  const b0Now = E.solarDiskOrientation(new Date(observed)).b0;
  const b0Then = E.solarDiskOrientation(new Date(observed - 86400000)).b0;
  check(Math.abs(b0Now - b0Then) < 0.2 && b0Now !== b0Then,
        `B0 drifts a little over the window (${b0Then.toFixed(3)} to ${b0Now.toFixed(3)})`);
}

// ── 4. labels that do not cover the spots ──────────────────────────────────
console.log('\nLabels stay off the regions they name');
{
  const bounds = { width: 700, height: 700 };
  // A deliberately awkward case: a tight cluster plus a couple of strays,
  // which is when labels used to land on top of each other and on the spots.
  const anchors = [
    { id: 'a', x: 300, y: 300, width: 82, height: 28, priority: 40 },
    { id: 'b', x: 316, y: 308, width: 82, height: 28, priority: 30 },
    { id: 'c', x: 330, y: 296, width: 82, height: 28, priority: 20 },
    { id: 'd', x: 305, y: 330, width: 82, height: 28, priority: 10 },
    { id: 'e', x: 120, y: 500, width: 82, height: 28, priority: 5 },
    { id: 'f', x: 600, y: 180, width: 82, height: 28, priority: 1 },
  ];
  const placed = L.layoutLabels(anchors, bounds, { minDistance: 30, padding: 4, anchorClearance: 8 });
  check(placed.length === anchors.length, 'every region still gets a label');

  const covers = [];
  for (const p of placed) {
    for (const a of anchors) {
      const inside = Math.abs(a.x - p.x) <= p.width / 2 && Math.abs(a.y - p.y) <= p.height / 2;
      if (inside) covers.push(`${p.id}'s label covers ${a.id}`);
    }
  }
  check(covers.length === 0, 'and no label sits on top of any region', covers.join(', '));

  // Touching is as bad as covering: the complaint was labels sitting on the
  // spots, and a box whose edge grazes one still hides it.
  const CLEAR = 8;
  const tooClose = [];
  for (const pl of placed) {
    for (const a of anchors) {
      const dx = Math.max(0, Math.abs(a.x - pl.x) - pl.width / 2);
      const dy = Math.max(0, Math.abs(a.y - pl.y) - pl.height / 2);
      if (Math.hypot(dx, dy) < CLEAR) {
        tooClose.push(`${pl.id}'s label is ${Math.hypot(dx, dy).toFixed(1)}px from ${a.id}`);
      }
    }
  }
  check(tooClose.length === 0,
        `every label keeps a ${CLEAR}px gap from every region, its own included`,
        tooClose.join('\n        '));

  const outside = placed.filter(p =>
    p.x - p.width / 2 < 0 || p.x + p.width / 2 > bounds.width
    || p.y - p.height / 2 < 0 || p.y + p.height / 2 > bounds.height);
  check(outside.length === 0, 'every label stays inside the frame', outside.map(p => p.id).join(', '));

  // Overlapping text is allowed as a last resort, but should not happen here.
  let overlaps = 0;
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    const dx = Math.min(a.x + a.width / 2, b.x + b.width / 2) - Math.max(a.x - a.width / 2, b.x - b.width / 2);
    const dy = Math.min(a.y + a.height / 2, b.y + b.height / 2) - Math.max(a.y - a.height / 2, b.y - b.height / 2);
    if (dx > 0 && dy > 0) overlaps++;
  }
  check(overlaps === 0, 'and no two labels overlap, even in the tight cluster', `${overlaps} overlapping pairs`);

  // The leader has to stop at the box, or it draws a line under the text.
  const strays = placed.filter(p => {
    const e = L.leaderEndpoint(p);
    const onEdge = Math.abs(Math.abs(e.x - p.x) - p.width / 2) < 1e-6
                || Math.abs(Math.abs(e.y - p.y) - p.height / 2) < 1e-6;
    return !onEdge;
  });
  check(strays.length === 0, 'and each leader meets its label on the edge', strays.map(p => p.id).join(', '));

  // Same input, same layout - no jitter between renders.
  const again = L.layoutLabels(anchors, bounds, { minDistance: 30, padding: 4, anchorClearance: 8 });
  check(JSON.stringify(placed) === JSON.stringify(again), 'the layout is deterministic');
}

// ── 5. the timeline keeps its place while the worker polls ────────────────
console.log('\nThe scrubber holds its place when frames arrive');
{
  // The imagery worker is polled every thirty seconds and hands back a new
  // array each time. The position is an index into that array, so it has to be
  // re-derived rather than trusted - and, crucially, playback must survive it.
  const frame = (mins) => ({ ts: new Date(Date.UTC(2026, 8, 21, 0, mins)).toISOString() });
  const frames = Array.from({ length: 10 }, (_, i) => frame(i * 4));

  const switched = P.nextFramePosition({ frames, previousTs: null, previousIndex: 0, switched: true });
  check(switched.index === 9 && switched.stopPlayback === true,
        'changing channel or window starts at the newest frame and stops playback');

  const empty = P.nextFramePosition({ frames: [], previousTs: null, previousIndex: 3, switched: false });
  check(empty.index === 0 && empty.stopPlayback === true, 'an empty timeline stops playback');

  // A poll that appends a frame: the moment on screen is still there, one
  // index earlier from the end. Playback must not stop.
  const grown = [...frames, frame(40)];
  const held = P.nextFramePosition({
    frames: grown, previousTs: frames[4].ts, previousIndex: 4, switched: false,
  });
  check(held.index === 4, 'a poll that adds a frame keeps the same moment on screen', String(held.index));
  check(held.stopPlayback === false,
        'and does not stop playback',
        'this is the bug: 24h takes over a minute to play, so two or three polls land during it');

  // A rolling window drops frames from the front, so the same moment is now at
  // a lower index.
  const rolled = grown.slice(2);
  const shifted = P.nextFramePosition({
    frames: rolled, previousTs: frames[4].ts, previousIndex: 4, switched: false,
  });
  check(shifted.index === 2, 'a window that rolls forward finds the same moment at its new index', String(shifted.index));
  check(rolled[shifted.index].ts === frames[4].ts, 'and it really is the same frame');

  // The frame being watched can roll off the back entirely.
  const wayPast = grown.slice(6);
  const gone = P.nextFramePosition({
    frames: wayPast, previousTs: frames[1].ts, previousIndex: 1, switched: false,
  });
  check(gone.stopPlayback === false, 'a frame rolling off the window does not stop playback');
  check(gone.index >= 0 && gone.index < wayPast.length,
        'and the position stays inside the list', String(gone.index));

  // Playing right through a poll: the index the interval set must survive.
  let idx = 200;
  const long = Array.from({ length: 360 }, (_, i) => frame(i * 4));
  const during = P.nextFramePosition({
    frames: long, previousTs: long[idx].ts, previousIndex: idx, switched: false,
  });
  check(during.index === idx && during.stopPlayback === false,
        'a 24h playback survives a poll landing halfway through', `${during.index} vs ${idx}`);
}

console.log('\nAnd the panel says how much data actually arrived');
{
  const frame = (h) => ({ ts: new Date(Date.UTC(2026, 8, 21, h)).toISOString() });
  check(P.frameSpanHours([]) === null, 'no frames spans nothing');
  check(P.frameSpanHours([frame(0)]) === null, 'one frame spans nothing measurable');
  check(P.frameSpanHours([frame(0), frame(12)]) === 12, 'twelve hours of frames reports 12');
  check(P.frameSpanHours([frame(0), frame(6), frame(24)]) === 24, 'and it is the full extent, not the gaps');
  check(P.frameSpanHours([{ ts: null }, frame(0), frame(3)]) === 3, 'frames without a timestamp are ignored');
}

// ── 6. one pipeline for every panel ────────────────────────────────────────
console.log('\nEvery panel builds its labels the same way');
{
  // Five surfaces draw these - the tracker overview, the raw SUVI frame, the
  // difference view, and the fullscreen viewer for each. They used to grow
  // their own copies of rotate, project, map, place; a label right in one and
  // wrong in another is worse than one wrong everywhere.
  const geometry = { width: 1280, height: 1280, cx: 640, cy: 640, radius: 600 };
  const imageNatural = { width: 1280, height: 1280 };
  const atMs = Date.UTC(2026, 8, 21, 1, 45);
  const regions = [
    { id: '4533', latitude: -14, longitude: -64, observedAtMs: atMs, magneticClass: 'alpha', spotCount: 1, area: 30, color: '#44dd88' },
    { id: '4534', latitude: 11, longitude: 8, observedAtMs: atMs, magneticClass: 'beta', spotCount: 8, area: 30, color: '#44dd88' },
    { id: '4532', latitude: -6, longitude: 54, observedAtMs: atMs, magneticClass: 'beta', spotCount: 4, area: 10, color: '#508cff' },
    { id: '9999', latitude: 0, longitude: 140, observedAtMs: atMs, color: '#888' },
  ];

  const panel = RL.buildRegionLabels(regions, { geometry, imageNatural, box: { width: 660, height: 660 }, atMs });
  check(panel.length === 3, 'the region round the back is dropped', `${panel.length} of 3 expected`);
  check(panel.every((l) => l.title.startsWith('AR ')), 'each label is titled with its region number');
  check(panel.find((l) => l.id === '4534')?.detail === 'BETA \u00b7 8 spots',
        'and carries class and spot count',
        panel.find((l) => l.id === '4534')?.detail);

  // The fullscreen viewer is the same disk several times larger. Positions
  // must scale with it rather than being reused from the panel.
  const big = RL.buildRegionLabels(regions, { geometry, imageNatural, box: { width: 1320, height: 1320 }, atMs });
  check(big.length === panel.length, 'the viewer shows the same regions');
  const pa = panel.find((l) => l.id === '4533');
  const ba = big.find((l) => l.id === '4533');
  check(Math.abs(ba.label.anchorX - pa.label.anchorX * 2) < 1.5
        && Math.abs(ba.label.anchorY - pa.label.anchorY * 2) < 1.5,
        'and each region sits at the same place on the disk, twice the size',
        `panel (${pa.label.anchorX.toFixed(1)},${pa.label.anchorY.toFixed(1)}) vs viewer (${ba.label.anchorX.toFixed(1)},${ba.label.anchorY.toFixed(1)})`);

  // Narrow panels drop the second line rather than covering the disk with it.
  const narrow = RL.buildRegionLabels(regions, { geometry, imageNatural, box: { width: 320, height: 320 }, atMs });
  check(narrow.every((l) => l.detail === ''), 'a narrow panel shows the region number only');
  check(panel.every((l) => l.detail !== ''), 'while a wide one shows the detail');

  // Letterboxing: the difference panel is wider than it is tall.
  const wide = RL.buildRegionLabels(regions, { geometry, imageNatural, box: { width: 900, height: 500 }, atMs });
  check(wide.every((l) => l.label.anchorX > 200 && l.label.anchorX < 700),
        'in a letterboxed panel the disk is inset, not stretched',
        wide.map((l) => l.label.anchorX.toFixed(0)).join(', '));

  // And the labels still keep off the spots at every one of those sizes.
  for (const [name, set, box] of [['panel', panel, 660], ['viewer', big, 1320], ['narrow', narrow, 320]]) {
    const covered = [];
    for (const l of set) {
      for (const other of set) {
        const dx = Math.max(0, Math.abs(other.label.anchorX - l.label.x) - l.label.width / 2);
        const dy = Math.max(0, Math.abs(other.label.anchorY - l.label.y) - l.label.height / 2);
        if (Math.hypot(dx, dy) < 4) covered.push(`${l.id} over ${other.id}`);
      }
    }
    check(covered.length === 0, `no label covers a region in the ${name} layout (${box}px)`, covered.join(', '));
  }

  check(RL.buildRegionLabels(regions, { geometry, imageNatural, box: { width: 0, height: 0 }, atMs }).length === 0,
        'an unmeasured panel produces nothing rather than NaN positions');
  check(RL.buildRegionLabels([], { geometry, imageNatural, box: { width: 660, height: 660 }, atMs }).length === 0,
        'and no regions produces no labels');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
