#!/usr/bin/env node
// utils/cmeOrientation: the arc is turned to exactly the analysed tilt in any
// direction, and without a result (or a worker) nothing changes.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'orient-app-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => { if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); } };
try {
  execFileSync('npx', ['esbuild', join(root, 'utils/cmeOrientation.ts'), '--bundle', '--format=esm', `--outfile=${join(out, 'o.mjs')}`, '--log-level=error'], { cwd: root });
  const O = await import(pathToFileURL(join(out, 'o.mjs')).href);
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const n = Math.hypot(...a); return a.map((x) => x / n); };
  const rotate = (v, k, ang) => { // Rodrigues
    const c = Math.cos(ang), s = Math.sin(ang), kv = cross(k, v), kd = dot(k, v);
    return v.map((x, i) => x * c + kv[i] * s + k[i] * kd * (1 - c));
  };
  // Scene: +y north; a direction from spherical coords like three.js.
  const sph = (lat, theta) => { const p = (90 - lat) * Math.PI / 180; return [Math.sin(p) * Math.sin(theta), Math.cos(p), Math.sin(p) * Math.cos(theta)]; };
  // The shortest rotation taking +y to d, applied to +x (what setFromUnitVectors does).
  const arcAfterShortest = (d) => {
    const y = [0, 1, 0]; const axis = cross(y, d); const s = Math.hypot(...axis);
    if (s < 1e-9) return [1, 0, 0];
    return rotate([1, 0, 0], norm(axis), Math.atan2(s, dot(y, d)));
  };
  console.log('\nThe arc lands at the analysed tilt');
  let worst = 0;
  for (const lat of [-40, -10, 0, 15, 35]) for (const theta of [0, 1, 2.5, 4, 5.5]) for (const tilt of [-80, -45, 0, 30, 70, 90]) {
    const d = sph(lat, theta);
    const arc = arcAfterShortest(d);
    const ang = O.tiltRotationAngle(d, arc, tilt);
    const res = rotate(arc, norm(d), ang);
    const h = norm(cross([0, 1, 0], d)), v = norm(cross(d, h));
    const got = Math.atan2(dot(res, v), dot(res, h)) * 180 / Math.PI;
    const err = Math.abs(((got - tilt + 90) % 180 + 180) % 180 - 90);
    worst = Math.max(worst, err);
  }
  check(worst < 1e-6, `every direction and tilt, to within ${worst.toExponential(1)} degrees`);
  const d = sph(10, 1.3); const arc = arcAfterShortest(d);
  const res = rotate(arc, norm(d), O.tiltRotationAngle(d, arc, 30));
  check(Math.abs(dot(res, d)) < 1e-9, 'turning about the direction keeps the arc across it (the direction is unchanged)');

  console.log('\nWithout a result nothing changes');
  const base = { longitude: 29, latitude: 15 };
  check(JSON.stringify(O.modelDirection(base)) === JSON.stringify({ lon: 29, lat: 15, ours: false }), "no analysis: NASA's direction");
  const weak = { ...base, orientation: { direction: { lon: 40, lat: 5, useInModel: false } } };
  check(O.modelDirection(weak).lon === 29, "ours not confident: still NASA's");
  const strong = { ...base, orientation: { direction: { lon: 40, lat: 5, useInModel: true } } };
  check(O.modelDirection(strong).lon === 40 && O.modelDirection(strong).ours, 'ours confident: ours');
  check(O.modelTilt(null) === null && O.modelTilt({ status: 'unknown', tilt: 20 }) === null, 'no tilt, or not determined: the default drawing');
  check(O.modelTilt({ status: 'estimated', tilt: 20, confidence: 15 }) === 20, 'a low-confidence estimate is still drawn (and flagged in the panel)');
  globalThis.fetch = async () => { throw new Error('offline'); };
  check(JSON.stringify(await O.fetchCmeOrientations()) === '{}', 'worker unreachable: an empty set, no error');
  globalThis.fetch = async () => new Response('nope', { status: 503 });
  check(JSON.stringify(await O.fetchCmeOrientations()) === '{}', 'worker failing: an empty set');
  globalThis.fetch = async () => new Response(JSON.stringify({ cmes: { a: { id: 'a', status: 'confirmed', tilt: 12, confidence: 70 } } }));
  check((await O.fetchCmeOrientations()).a?.tilt === 12, 'worker up: results by CME id');
  check(O.orientationSummary({ status: 'confirmed', tilt: 45 }).includes('west side') && O.orientationSummary(undefined) === 'Not analysed yet',
    'the panel line reads the tilt the right way round');
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
