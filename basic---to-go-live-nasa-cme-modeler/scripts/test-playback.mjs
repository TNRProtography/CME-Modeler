#!/usr/bin/env node
// CME Visualization playback: one clock, and sharpness that follows what the
// device can keep up with.
//
//   npm run test:playback

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'playback-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};
const bundle = (entry, name) => {
  execFileSync('npx', ['esbuild', join(root, entry), '--bundle', '--format=esm',
    `--outfile=${join(out, name)}`, '--log-level=error'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  return import(pathToFileURL(join(out, name)).href);
};

try {
  const Q = await bundle('utils/renderQuality.ts', 'q.mjs');
  const C = await bundle('utils/timelineClock.ts', 'c.mjs');

  const HV = await bundle('utils/hvCrop.ts', 'hv.mjs');
  const RC = await bundle('utils/regionCrop.ts', 'rc.mjs');

  console.log('\nThe sunspot close-up\'s full-resolution copies');
  {
    // A region a quarter of the way across and three-fifths down a frame.
    const u = HV.hvCropUrl('magnetogram', Date.UTC(2026, 9, 6, 2, 30), 0.25, 0.6);
    const p = HV.parseHvCrop(u);
    const prox = new URL(p.url, 'https://app.example');
    const real = new URL(prox.searchParams.get('url'));
    const q = real.searchParams;
    check(p.full === 4096 && p.sx === 1024 - 512 && p.sy === 2432 - 512, `placed as a 1024px patch of a 4096px image (${p.sx}, ${p.sy})`);
    check(q.get('imageScale') === '0.504' && q.get('width') === '1024' && q.get('height') === '1024', 'at HMI\'s own 0.504"/px');
    check(Math.abs(+q.get('x0') - (1024 - 2048) * 0.504) < 0.01, `left of centre is negative x (${q.get('x0')})`);
    check(Math.abs(+q.get('y0') - (2432 - 2048) * 0.504) < 0.01, `below centre is positive y, as Helioviewer counts down from the top (${q.get('y0')})`);
    check(q.get('date') === '2026-10-06T02:30:00Z' && q.get('layers') === '[SDO,HMI,HMI,magnetogram,1,100]', 'at the frame\'s moment, of its view');
    check(prox.pathname.endsWith('/image') && real.hostname === 'api.helioviewer.org', 'fetched from Helioviewer through the image proxy');
    check(HV.hvCropUrl('magnetogram', 0, 0.2501, 0.6) === HV.hvCropUrl('magnetogram', 0, 0.2507, 0.6), 'a region moving a pixel asks for the same patch');
    check(HV.hvCropUrl('colorized', 0, 0.5, 0.5) === null, 'and colorized, which Helioviewer does not carry, gets none');
    const edge = HV.parseHvCrop(HV.hvCropUrl('intensity', 0, 0.02, 0.99));
    check(edge.sx === 0 && edge.sy === 4096 - 1024, 'a region at the edge keeps the patch inside the image');

    check(RC.isHdUrl('https://sdo-imagery.example/img/HMIXBC/20261006_023200_4096.jpg'), 'the worker\'s 4K copy is cropped');
    check(RC.isHdUrl('https://spottheaurora.co.nz/api/proxy/image?url=' + encodeURIComponent('https://sdo.gsfc.nasa.gov/assets/img/browse/2026/10/06/20261006_001038_4096_HMIBC.jpg') + '&ttl=604800'),
      'so is SDO\'s, through the proxy');
    check(RC.isHdUrl(u), 'and a Helioviewer patch');
    check(!RC.isHdUrl('https://sdo.gsfc.nasa.gov/assets/img/browse/2026/10/06/20261006_001038_2048_HMIBC.jpg'), 'but not a 2048px copy, decoded whole as before');
  }

  console.log('\nWhere sharpness starts');
  check(Q.initialPixelRatio(3, 390) === 1.5, 'a phone at 3x starts at 1.5, not 3');
  check(Q.initialPixelRatio(2, 1440) === 2, 'a Retina laptop keeps 2');
  check(Q.initialPixelRatio(1, 1920) === 1, 'an ordinary screen stays at 1');
  check(Q.initialPixelRatio(NaN, 800) === 1, 'no reading is taken as 1');
  check(Q.initialPixelRatio(2, 1512, undefined, 982) === 1.75, 'a 14" MacBook window keeps most of its sharpness within the pixel budget');
  check(Q.initialPixelRatio(2, 2560, undefined, 1400) === 1.25, 'a full screen 5K iMac is held to the pixel budget');
  check(Q.initialPixelRatio(1, 1920, undefined, 1000) === 1, 'an ordinary 1080p screen is untouched by the budget');
  check(Q.initialPixelRatio(3, 390, undefined, 750) === 1.5, 'a phone is untouched by the budget');
  check(Q.initialPixelRatio(2, 1440, undefined, 700) === 2, 'a smaller Retina window keeps full density');

  console.log('\nSharpness follows the frame rate');
  {
    const a = new Q.AdaptivePixelRatio(2);
    let t = 0, changes = [];
    const run = (ms, seconds) => { for (let i = 0; i < seconds * 1000 / ms; i++) { t += ms; const r = a.frame(t, ms); if (r != null) changes.push(r); } };
    run(40, 3);   // 25 fps
    check(changes.length >= 2 && a.ratio <= 1.5, 'slow frames step it down', JSON.stringify(changes));
    run(40, 10);
    check(a.ratio === Q.DEFAULT_QUALITY.minRatio, 'never below the floor', String(a.ratio));
    changes = [];
    run(16.7, 3);
    check(changes.length === 0, 'a few good seconds are not enough to climb straight back');
    run(16.7, 30);
    check(a.ratio === 2, 'a long smooth run brings it back to where it started', String(a.ratio));
    run(16.7, 30);
    check(a.ratio === 2, 'and never above it');
    const b = new Q.AdaptivePixelRatio(1.5);
    check(b.frame(0, 900) === null && b.ratio === 1.5, 'a background-tab gap is ignored');
  }

  console.log('\nOne clock');
  {
    const seen = [];
    const off = C.timelineClock.subscribe(() => seen.push(C.timelineClock.get()));
    C.timelineClock.set(10); C.timelineClock.set(10); C.timelineClock.set(20); C.timelineClock.set(NaN);
    check(JSON.stringify(seen) === '[10,20]', 'listeners hear each real change once', JSON.stringify(seen));
    off();
    C.timelineClock.set(30);
    check(seen.length === 2 && C.timelineClock.get() === 30, 'and nothing after unsubscribing');
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
