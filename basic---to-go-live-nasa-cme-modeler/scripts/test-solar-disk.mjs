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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
