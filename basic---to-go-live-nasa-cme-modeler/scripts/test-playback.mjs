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

  console.log('\nWhere sharpness starts');
  check(Q.initialPixelRatio(3, 390) === 1.5, 'a phone at 3x starts at 1.5, not 3');
  check(Q.initialPixelRatio(2, 1440) === 2, 'a Retina laptop keeps 2');
  check(Q.initialPixelRatio(1, 1920) === 1, 'an ordinary screen stays at 1');
  check(Q.initialPixelRatio(NaN, 800) === 1, 'no reading is taken as 1');

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
