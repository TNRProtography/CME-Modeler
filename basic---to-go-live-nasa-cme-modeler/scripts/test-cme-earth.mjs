#!/usr/bin/env node
// Which CMEs the 3-day forecast counts: the ones whose particles the CME
// Visualization has touching Earth, arriving when the scene's propagation
// puts them at 1 AU, with a storm sized by speed alone.
//
//   npm run test:cme-earth

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'cmeearth-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/cmeEarthArrivals.ts'), '--bundle', '--format=esm', '--define:import.meta.env={}',
    `--outfile=${join(out, 'c.mjs')}`, '--log-level=error'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const C = await import(pathToFileURL(join(out, 'c.mjs')).href);
  const H = 3600000;
  const t0 = Date.UTC(2026, 8, 20, 0);
  const cme = (o) => ({ id: 'x', startTime: new Date(t0), speed: 800, longitude: 0, latitude: 0, halfAngle: 30, ...o });

  console.log('Whether its particles touch Earth');
  check(C.CME_PARTICLE_REACH > 1 && C.CME_PARTICLE_REACH < 1.3,
    `the cloud reaches a little past the cone (x${C.CME_PARTICLE_REACH.toFixed(3)})`);
  check(C.cmeEarthArrival(cme({})) != null, 'a head-on CME touches Earth');
  check(C.cmeEarthArrival(cme({ longitude: 30 })) != null, 'one 30 deg off, 30 deg wide, still does (particles reach past the cone)');
  check(C.cmeEarthArrival(cme({ longitude: 60 })) == null, 'one 60 deg off, 30 deg wide, misses');
  check(C.cmeEarthArrival(cme({ longitude: 60, halfAngle: 65 })) != null, 'a wide one 60 deg off reaches us');
  check(C.cmeEarthArrival(cme({ latitude: 45 })) == null, 'one aimed 45 deg north of Earth misses');
  check(C.cmeEarthArrival(cme({ longitude: 180, halfAngle: 60 })) == null, 'a far-side CME never does');
  const west = C.cmeEarthArrival(cme({ longitude: 33 })), east = C.cmeEarthArrival(cme({ longitude: -33 }));
  check(west && !east || (west && east && west.offsetDeg < east.offsetDeg),
    'Earth moving along its orbit meets one launched ahead of it, not one behind');

  console.log('\nWhen');
  const a = C.cmeEarthArrival(cme({ speed: 800 }));
  const hours = (a.arrivalMs - t0) / H;
  check(hours > 40 && hours < 90, `an 800 km/s CME takes ${hours.toFixed(0)} h, as the scene draws it`);
  const fast = C.cmeEarthArrival(cme({ speed: 2000 }));
  check(fast.arrivalMs < a.arrivalMs, 'a faster one gets here sooner');

  console.log('\nHow big: speed alone');
  let mono = true;
  for (let v = 300; v < 3000; v += 50) if (C.stormNewellForSpeed(v + 50) < C.stormNewellForSpeed(v)) mono = false;
  check(mono, 'faster is never smaller');
  check(C.stormNewellForSpeed(650) === 18000, 'a 650 km/s CME is a G1-sized storm on the shared scale');
  check(C.stormNewellForSpeed(3000) === C.stormNewellForSpeed(1650), 'it tops out at the largest storm');

  console.log('\nFor how long');
  check(C.cmeStormFraction(a, a.arrivalMs - H) === 0, 'nothing before it arrives');
  check(C.cmeStormFraction(a, a.arrivalMs + 6 * H) === 1, 'full strength for its first hours');
  check(C.cmeStormFraction(a, a.arrivalMs + 18 * H) === 0.5, 'easing off after');
  check(C.cmeStormFraction(a, a.arrivalMs + 30 * H) === 0, 'over within a day');
  const ol = C.cmeOutlook([a], a.arrivalMs - 3 * H, a.arrivalMs + 30 * H);
  check(ol.length > 0 && ol.every((p) => p.disturbance === 'CME sheath'), 'its hours go into the forecast as CME hours');

  console.log('\nThe scene and the forecast share the shape');
  const scene = readFileSync(join(root, 'components/SimulationCanvas.tsx'), 'utf8');
  check(/from '\.\.\/utils\/cmeEarthArrivals'/.test(scene) && !/const GCS_ARC_RADIUS_FRAC\s*=/.test(scene),
    'the 3D scene builds its CMEs from the same constants');
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
