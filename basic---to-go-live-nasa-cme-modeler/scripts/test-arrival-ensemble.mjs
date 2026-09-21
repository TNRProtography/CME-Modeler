#!/usr/bin/env node
// How wrong the arrival could be, worked out rather than asserted.
//
//   npm run test:arrival-ensemble
//
// The panel used to say "plus or minus 7 hours" for every hole, whether it had
// been measured fifty times across the disk or glimpsed once near the limb.
// That is the tell for a made-up number: a real uncertainty responds to what
// is known. These tests are mostly about that responsiveness, plus the
// asymmetry - a stream can be held up by slower wind ahead of it far more
// easily than it can arrive early, so a symmetric band is the wrong shape.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'ens-'));

async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
const E = await load('utils/arrivalEnsemble.ts');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const HOUR = 3600000, DAY = 86400000;
const T0 = Date.UTC(2026, 8, 21, 12);
const run = (speedKms, confidence, members = 400) =>
  E.hssArrivalEnsemble({ centralMeridianMs: T0, speedKms, confidence }, members);

// ── the middle of it ───────────────────────────────────────────────────────
console.log('\nThe arrival itself');
{
  const fast = run(700, 0.8);
  const slow = run(400, 0.8);
  check(fast != null && slow != null, 'both produce an ensemble');
  check((fast.medianMs - T0) / DAY > 2 && (fast.medianMs - T0) / DAY < 3.2,
        `700 km/s lands ${((fast.medianMs - T0) / DAY).toFixed(2)} days out`);
  check((slow.medianMs - T0) / DAY > 4 && (slow.medianMs - T0) / DAY < 5.5,
        `400 km/s lands ${((slow.medianMs - T0) / DAY).toFixed(2)} days out`);
  check(slow.medianMs > fast.medianMs, 'and slower wind always arrives later');
  check(Math.abs(fast.medianSpeedKms - 700) < 40,
        `the median member keeps the input speed (${fast.medianSpeedKms})`);

  check(run(0, 0.8) === null, 'a zero speed has no ensemble rather than an infinite one');
  check(run(-100, 0.8) === null, 'nor a negative one');
  check(E.hssArrivalEnsemble({ centralMeridianMs: NaN, speedKms: 500, confidence: 1 }) === null,
        'nor an unmeasurable crossing');
  check(run(500, 0.8, 4) === null, 'too few members is refused rather than reported as a distribution');
}

// ── the band responds to what is known ─────────────────────────────────────
console.log('\nThe band narrows as the hole is better measured');
{
  const poor = run(600, 0.05);
  const good = run(600, 0.95);
  const poorWidth = (poor.p90Ms - poor.p10Ms) / HOUR;
  const goodWidth = (good.p90Ms - good.p10Ms) / HOUR;

  check(goodWidth < poorWidth,
        `a well-measured hole is tighter: ${goodWidth.toFixed(1)}h vs ${poorWidth.toFixed(1)}h`,
        `${goodWidth} vs ${poorWidth}`);
  check(poorWidth / goodWidth > 1.5, 'and by a margin worth showing, not a rounding difference');
  check(goodWidth > 4, 'but never collapses to nothing, because the speed model itself scatters',
        String(goodWidth));
  check(poorWidth < 60, 'and never becomes uselessly wide either', String(poorWidth));

  // Monotonic: more confidence can only narrow it.
  let monotonic = true;
  let previous = Infinity;
  for (let c = 0; c <= 1.0001; c += 0.1) {
    const width = (run(600, c).p90Ms - run(600, c).p10Ms) / HOUR;
    if (width > previous + 0.5) monotonic = false;
    previous = width;
  }
  check(monotonic, 'and it narrows steadily as confidence rises, never widening');
}

// ── lopsided on purpose ────────────────────────────────────────────────────
console.log('\nThe band is asymmetric, because the physics is');
{
  const e = run(600, 0.6);
  check(e.lateHours > e.earlyHours,
        `late by ${e.lateHours.toFixed(1)}h beats early by ${e.earlyHours.toFixed(1)}h`,
        `${e.earlyHours} / ${e.lateHours}`);
  check(e.lateHours - e.earlyHours > 0.5,
        'by enough to be a real feature rather than noise in the sampling');

  const description = E.describeSpread(e);
  check(/early/.test(description) && /late/.test(description),
        'and it is described as lopsided rather than as a plus-or-minus', description);

  // A symmetric one should still read naturally.
  const symmetric = E.describeSpread({ ...e, earlyHours: 5.1, lateHours: 5.4 });
  check(/give or take/.test(symmetric), 'a near-symmetric band reads as give or take', symmetric);
}

// ── the same forecast twice ────────────────────────────────────────────────
console.log('\nThe same inputs give the same answer');
{
  const a = E.hssArrivalEnsemble({ centralMeridianMs: T0, speedKms: 600, confidence: 0.5 }, 200, 42);
  const b = E.hssArrivalEnsemble({ centralMeridianMs: T0, speedKms: 600, confidence: 0.5 }, 200, 42);
  check(a.medianMs === b.medianMs && a.p10Ms === b.p10Ms && a.p90Ms === b.p90Ms,
        'a forecast computed twice is the same forecast');
  const c = E.hssArrivalEnsemble({ centralMeridianMs: T0, speedKms: 600, confidence: 0.5 }, 200, 43);
  check(c.medianMs !== a.medianMs, 'while a different seed genuinely re-rolls it');
  check(Math.abs(c.medianMs - a.medianMs) < 4 * HOUR,
        'though not so differently that the seed is doing the forecasting',
        String(Math.abs(c.medianMs - a.medianMs) / HOUR));

  const random = E.makeRandom(1);
  const draws = Array.from({ length: 4000 }, random);
  const mean = draws.reduce((x, y) => x + y, 0) / draws.length;
  check(Math.abs(mean - 0.5) < 0.03, `the generator is flat (mean ${mean.toFixed(3)})`);
  check(Math.min(...draws) >= 0 && Math.max(...draws) < 1, 'and stays inside zero to one');
}

// ── judging how well a hole is measured ────────────────────────────────────
console.log('\nHow much to trust a hole');
{
  const best = E.measurementConfidence(50, 48, 2);
  const worst = E.measurementConfidence(1, 0, 80);
  check(best > 0.9, `a hole seen fifty times over two days near centre scores ${best.toFixed(2)}`);
  check(worst < 0.15, `one glimpsed once at the limb scores ${worst.toFixed(2)}`);
  check(best > worst, 'and more evidence always beats less');

  check(E.measurementConfidence(50, 48, 80) < best,
        'a hole only ever seen near the limb is trusted less, however often');
  check(E.measurementConfidence(2, 1, 2) < best,
        'and so is one seen twice, however well placed');

  for (const [n, h, d] of [[0, 0, 0], [1000, 1000, 0], [-5, -5, 200]]) {
    const c = E.measurementConfidence(n, h, d);
    check(c >= 0 && c <= 1, `confidence stays in range for (${n}, ${h}, ${d})`, String(c));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
