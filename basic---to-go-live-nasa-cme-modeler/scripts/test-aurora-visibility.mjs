#!/usr/bin/env node
// The one visibility model: magnetic latitude, magnetic local time, the
// viewline, the strength scale, and the solar wind that is actually on its
// way from L1.
//
//   npm run test:aurora-visibility
//
// The magnetic latitudes and magnetic local times below come from the
// aacgmv2 Python package (AACGM-v2, 110 km, 2026), not from this code, so they
// check the table and the MLT approximation against the real thing.
//
// The scenario checks are the other half. The model has hand-set constants,
// and nothing here has been fitted to logged sightings yet, so what these pin
// down is that typical New Zealand nights come out the way chasers know them.
// A change to a constant that moves a Kp 5 storm to "go outside now" from
// Auckland fails here rather than in somebody's car.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'avis-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const TOWNS = {
  Invercargill: [-46.41, 168.35],
  Christchurch: [-43.53, 172.63],
  Greymouth: [-42.45, 171.21],
  Wellington: [-41.29, 174.78],
  Auckland: [-36.85, 174.76],
};

try {
  const bundle = (entry, name) => {
    execFileSync('npx', ['esbuild', join(root, entry), '--bundle', '--format=esm',
      `--outfile=${join(out, name)}`, '--log-level=error'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    return import(pathToFileURL(join(out, name)).href);
  };
  const A = await bundle('utils/auroraVisibility.ts', 'a.mjs');
  const O = await bundle('utils/ovalPhysics.ts', 'o.mjs');
  const S = await bundle('utils/skyConditions.ts', 's.mjs');

  console.log('\nMagnetic latitude is AACGM, not the dipole');
  const AACGM = {            // aacgmv2.get_aacgm_coord(lat, lon, 110, 2026-07-01)
    Invercargill: -54.034, Greymouth: -49.475, Auckland: -43.113,
  };
  for (const [town, want] of Object.entries(AACGM)) {
    const got = A.magneticLatitude(...TOWNS[town]);
    check(Math.abs(got - want) < 0.01, `${town} ${got.toFixed(3)} (AACGM ${want})`);
  }
  check(Math.abs(A.magneticLatitude(-42.88, 147.33) - -53.714) < 0.01, 'Hobart too, the table covers Australia');
  const gap = A.magneticLatitude(...TOWNS.Greymouth) - A.dipoleLatitude(...TOWNS.Greymouth);
  check(gap < -3 && gap > -4, `about 3.5 degrees poleward of the dipole over NZ (${gap.toFixed(2)})`);

  console.log('\nContinuous across the edges of the table');
  const jump = (a, b) => Math.abs(A.magneticLatitude(...a) - A.magneticLatitude(...b));
  check(jump([-40, 189.95], [-40, 190.05]) < 0.1, 'east edge');
  check(jump([-40, 109.95], [-40, 110.05]) < 0.1, 'west edge');
  check(jump([-24.95, 172], [-25.05, 172]) < 0.3, 'north edge');
  check(jump([-71.95, 172], [-72.05, 172]) < 0.3, 'south edge');
  check(Math.abs(A.geographicLatitudeFor(A.magneticLatitude(-42.45, 171.21), 171.21) - -42.45) < 0.01,
    'the map inverse lands back where it started');

  console.log('\nMagnetic local time');
  // aacgmv2 MLT for Greymouth, 110 km.
  const MLT = [
    [Date.UTC(2026, 8, 24, 12, 0), 0.32],   // local midnight NZST
    [Date.UTC(2026, 5, 21, 8, 30), 20.63],
    [Date.UTC(2026, 11, 21, 14, 30), 3.07],
  ];
  for (const [t, want] of MLT) {
    const got = A.magneticLocalTime(t, ...TOWNS.Greymouth);
    const d = ((got - want + 36) % 24) - 12;
    check(Math.abs(d) < 0.6, `${new Date(t).toISOString().slice(0, 16)} ${got.toFixed(2)} h (AACGM ${want})`);
  }
  check(A.mltPolewardShiftDeg(23.5) < 1e-9, 'no shift at the widest point of the oval');
  check(Math.abs(A.mltPolewardShiftDeg(11.5) - A.NOON_POLEWARD_SHIFT_DEG) < 1e-9, 'the full shift at noon');
  check(A.mltPolewardShiftDeg(21) < 0.5 && A.mltPolewardShiftDeg(19) > 1,
    'a third of a degree at 9pm, over a degree at 7pm');

  console.log('\nTypical New Zealand nights come out as chasers know them');
  const midnight = Date.UTC(2026, 8, 24, 12, 0);
  const boundaryFor = (newell) => O.computeOvalBoundary(
    { newell_avg_60m: newell, newell_avg_30m: newell }, false, new Date(midnight));
  const at = (newell, town) => A.auroraGeometryAt(boundaryFor(newell), midnight, ...TOWNS[town]).strength;
  const tier = (s) => S.tierForStrength(s);
  const NIGHTS = [
    // name, Newell, { town: [min, max] }
    ['a quiet night', 3200, {
      Invercargill: [20, 34], Christchurch: [0, 19], Wellington: [0, 19], Auckland: [0, 19] }],
    ['a moderate stream (Kp 3)', 9800, {
      Invercargill: [35, 55], Christchurch: [20, 34], Auckland: [0, 19] }],
    ['a G1 storm (Kp 5)', 18000, {
      Invercargill: [65, 80], Christchurch: [50, 64], Wellington: [35, 49], Auckland: [20, 34] }],
    ['a G3 storm (Kp 7)', 26000, {
      Invercargill: [80, 100], Christchurch: [75, 90], Wellington: [60, 79], Auckland: [40, 60] }],
    ['May 2024', 114000, {
      Invercargill: [95, 100], Wellington: [90, 100], Auckland: [80, 100] }],
  ];
  for (const [name, newell, expect] of NIGHTS) {
    for (const [town, [lo, hi]] of Object.entries(expect)) {
      const s = at(newell, town);
      check(s >= lo && s <= hi, `${name}: ${town} ${s.toFixed(0)} (${tier(s)})`, `wanted ${lo}-${hi}`);
    }
  }
  check(at(18000, 'Auckland') < at(18000, 'Wellington') && at(18000, 'Wellington') < at(18000, 'Invercargill'),
    'further from the pole is always weaker');

  console.log('\nThe viewline grows with activity');
  check(Math.abs(A.viewlineReachDeg(A.QUIET_BOUNDARY) - 9) < 1e-9, 'nine degrees when quiet');
  check(Math.abs(A.viewlineReachDeg(A.STORM_BOUNDARY) - 25) < 1e-9, 'twenty five at the storm limit');

  console.log('\nThe time of night matters');
  const eveningStrength = A.auroraGeometryAt(boundaryFor(18000), Date.UTC(2026, 8, 24, 7, 30), ...TOWNS.Christchurch).strength;
  check(eveningStrength < at(18000, 'Christchurch'), `7:30pm is weaker than midnight for the same wind (${eveningStrength.toFixed(0)})`);

  console.log('\nOne tier scale');
  check(tier(19.9) === 'none' && tier(20) === 'camera' && tier(35) === 'phone' && tier(50) === 'eye',
    'none, camera, phone, eye at 20, 35 and 50');
  const dark = S.skyConditionsAt(midnight - 14 * 86400000, ...TOWNS.Christchurch); // new moon on 10 Sep
  check(S.visibilityOutlook(55, dark).tier === 'eye' || dark.washout > 0.05,
    'the three-day card and the hourly card read the same scale');

  console.log('\nThe solar wind already on its way');
  const now = Date.UTC(2026, 8, 24, 11, 0);
  // Two hours of readings, one a minute, quiet then a sharp southward turn
  // forty minutes ago - due at Earth in about fifteen at 450 km/s.
  const readings = [];
  for (let m = 120; m >= 0; m--) {
    const t = now - m * 60000;
    const turned = m <= 40;
    readings.push({ x: t, speed: 450, newell: turned ? 20000 : 3000, bz: turned ? -15 : 1, by: 2 });
  }
  const samples = A.mergeL1Series({
    speed: readings.map((r) => ({ x: r.x, y: r.speed })),
    newell: readings.map((r) => ({ x: r.x, y: r.newell })),
    magnetic: readings.map((r) => ({ time: r.x, by: r.by, bz: r.bz })),
  });
  check(samples.length === readings.length, 'every reading becomes a sample');
  const travelMin = (A.L1_DISTANCE_KM / 450) / 60;
  check(Math.abs(travelMin - 55.6) < 0.5, `450 km/s takes ${travelMin.toFixed(1)} min from L1`);
  const b0 = A.realWindBoundary(samples, now);
  const b30 = A.realWindBoundary(samples, now + 30 * 60000);
  const b60 = A.realWindBoundary(samples, now + 60 * 60000);
  check(b0 && Math.abs(b0.wind.newell30 - 3000) < 1, 'now: the quiet wind measured an hour ago');
  check(b30 && b30.wind.newell30 > 3000 && b30.wind.coverage === 1,
    `in 30 min: the turn has started to arrive (${b30 && b30.wind.newell30.toFixed(0)})`);
  check(b30 && b0 && b30.boundary > b0.boundary, 'and the oval moves toward the equator because of it');
  check(b60 && b60.wind.coverage < 1, 'past the newest reading, the coverage says so');
  check(A.realWindBoundary(samples, now + 3 * 3600000) === null, 'and far past it there is no real wind at all');

  const fast = A.mergeL1Series({ speed: [{ x: now, y: 900 }], newell: [{ x: now, y: 8000 }] });
  check(Math.abs((A.arrivalMs(fast[0]) - now) / 60000 - 27.8) < 0.5, 'fast wind arrives sooner (900 km/s in 28 min)');
} catch (err) {
  fail++;
  console.error(err);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
