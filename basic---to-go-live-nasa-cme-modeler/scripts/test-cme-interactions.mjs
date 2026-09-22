#!/usr/bin/env node
// CME–CME interactions (experimental): two storms that meet share the squeeze.
//
// Neither is a wall. Side by side they share one boundary; one catching the
// other meets it at an interface. The stronger (faster, wider) gives less
// ground, equals meet halfway, and a leader is pushed on only a little -
// compression is most of what happens.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'cmei-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};
const deg = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/cmeInteractions.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'i.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const { resolveCmeInteractions, interactionNotes, shortCmeLabel, PUSH_LIMIT } =
    await import(pathToFileURL(join(out, 'i.mjs')).href);

  const body = (id, azDeg, halfDeg, speed, rBack, rFront, latDeg = 0) =>
    ({ id, az: deg(azDeg), lat: deg(latDeg), halfAngle: deg(halfDeg), speed, rBack, rFront });

  console.log('\nSide by side: one shared boundary');
  // 40° apart, 30° half-widths: 20° of overlap, same distances.
  let m = resolveCmeInteractions([body('A', 0, 30, 800, 1, 1.5), body('B', 40, 30, 800, 1, 1.5)]);
  let a = m.get('A'), b = m.get('B');
  check(near(toDeg(a.westCap), 20) && near(toDeg(b.eastCap), 20), `equals meet halfway: ${toDeg(a.westCap)}°, ${toDeg(b.eastCap)}°`);
  check(near(toDeg(a.westCap) + toDeg(b.eastCap), 40), 'and the flanks meet exactly, no gap and no overlap');
  check(a.eastCap == null && b.westCap == null, 'the far flanks are free');
  check(a.westBy === 'B' && b.eastBy === 'A', 'each knows who is pressing it');
  check(a.shift === 0 && b.shift === 0 && a.frontCap == null, 'side by side moves nobody along');

  // Twice the speed: the fast one gives a third, the slow one two thirds.
  m = resolveCmeInteractions([body('A', 0, 30, 1600, 1, 1.5), body('B', 40, 30, 800, 1, 1.5)]);
  a = m.get('A'); b = m.get('B');
  check(near(30 - toDeg(a.westCap), 20 / 3, 1e-6) && near(30 - toDeg(b.eastCap), 40 / 3, 1e-6),
    `the stronger gives less: fast gives ${(30 - toDeg(a.westCap)).toFixed(2)}°, slow ${(30 - toDeg(b.eastCap)).toFixed(2)}°`);
  check(near(toDeg(a.westCap) + toDeg(b.eastCap), 40, 1e-6), 'still meeting at one boundary');

  console.log('\nNo contact, no effect');
  m = resolveCmeInteractions([body('A', 0, 30, 800, 1, 1.5), body('B', 70, 30, 800, 1, 1.5)]);
  check(m.get('A').westCap == null, 'apart in azimuth');
  m = resolveCmeInteractions([body('A', 0, 30, 800, 1, 1.5), body('B', 40, 30, 800, 2, 2.5)]);
  check(m.get('A').westCap == null && m.get('B').backCap == null, 'apart in distance');
  m = resolveCmeInteractions([body('A', 0, 20, 800, 1, 1.5, -30), body('B', 10, 20, 800, 1, 1.5, 30)]);
  check(m.get('A').westCap == null, 'apart in latitude');

  console.log('\nCatch-up: compression at an interface');
  // Same direction; B (behind, fast) reaches 0.3 into A.
  m = resolveCmeInteractions([body('A', 0, 30, 500, 1.0, 1.6), body('B', 2, 30, 500, 0.5, 1.3)]);
  a = m.get('A'); b = m.get('B');
  check(near(a.backCap, 1.15) && near(b.frontCap, 1.15), `equals meet halfway through the overlap: ${a.backCap}, ${b.frontCap}`);
  check(a.backBy === 'B' && b.frontBy === 'A', 'each knows who it is pressed against');
  check(a.shift > 0 && a.shift <= PUSH_LIMIT * 1.0 + 1e-12, `the leader is nudged on, a little (${a.shift.toFixed(3)})`);
  check(b.shift === 0, 'the chaser is not pushed forward');
  check(a.westCap == null && b.westCap == null, 'and nobody is squeezed sideways');

  // A strong chaser drives the interface further into the leader.
  m = resolveCmeInteractions([body('A', 0, 30, 400, 1.0, 1.6), body('B', 2, 30, 1600, 0.5, 1.3)]);
  check(m.get('A').backCap > 1.15, `a strong chaser pushes the interface into the leader (${m.get('A').backCap.toFixed(3)})`);

  // The push is capped: most of it is compression.
  m = resolveCmeInteractions([body('A', 0, 30, 300, 1.0, 1.6), body('B', 2, 30, 3000, 0.4, 1.55)]);
  check(near(m.get('A').shift, PUSH_LIMIT * 1.0), `the push stops at ${PUSH_LIMIT * 100}% however hard the chaser`);

  console.log('\nNotes');
  m = resolveCmeInteractions([body('2026-09-20T12:36:00-CME-001', 0, 30, 800, 1, 1.5), body('2026-09-21T03:05:00-CME-001', 40, 30, 800, 1, 1.5)]);
  check(interactionNotes(m.get('2026-09-20T12:36:00-CME-001'))[0] === 'West flank pressed by CME 21 Sep 03:05',
    `note: ${interactionNotes(m.get('2026-09-20T12:36:00-CME-001'))[0]}`);
  check(shortCmeLabel('odd-id') === 'odd-id', 'an unusual id is left as it is');
} catch (err) {
  fail++;
  console.error(err);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
