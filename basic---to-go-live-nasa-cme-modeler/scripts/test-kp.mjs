#!/usr/bin/env node
// Checks that a Kp forecast lands in the storm band NOAA puts it in.
//
//   npm run test:kp
//
// NOAA publishes Kp in thirds and names them around the integer: 5.667 is
// "Kp 6-", not "Kp 5 and a bit". Comparing the raw number against `>= 6` put
// every .667 value one band too low, so a 5.67 forecast - a G2 storm - was
// shown as G1, with the visibility wording and the aurora colour one band out
// to match. Every third on the grid is checked here rather than the few that
// were noticed, because the bug was uniform and so is the fix.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');

// The util is plain TypeScript with no types to strip beyond the signatures.
const src = readFileSync(join(APP, 'utils', 'kpScale.ts'), 'utf8')
  .replace(/\(kp: number\): (number|string)/g, '(kp)');
const dir = mkdtempSync(join(tmpdir(), 'kp-'));
const copy = join(dir, 'kp.mjs');
writeFileSync(copy, src);
const { kpIndex, kpLabel, gScale, gColor } = await import(pathToFileURL(copy).href);

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

console.log('\nThe values that were wrong');
{
  // The report: "5.67 should be G2, it shows G1", and the same for every .67.
  const cases = [
    [4.67, 'G1'], [5.67, 'G2'], [6.67, 'G3'], [7.67, 'G4'], [8.67, 'G5'],
  ];
  for (const [kp, want] of cases) {
    const got = gScale(kp);
    check(got === want, `Kp ${kp} (${kpLabel(kp)}) is ${want}`, `got ${got || 'no band'}`);
  }
}

console.log('\nEvery third on the grid, G1 upward');
{
  // Kp n- is n-0.333, n o is n, n+ is n+0.333. All three belong to band n.
  const wrong = [];
  for (let n = 5; n <= 9; n++) {
    for (const [offset, mark] of [[-1 / 3, '-'], [0, 'o'], [1 / 3, '+']]) {
      if (n === 9 && offset > 0) continue;      // Kp caps at 9
      const kp = Math.round((n + offset) * 100) / 100;
      const want = `G${Math.min(5, n - 4)}`;
      const got = gScale(kp);
      if (got !== want) wrong.push(`Kp ${kp} (${n}${mark}) -> ${got || 'none'}, want ${want}`);
    }
  }
  check(wrong.length === 0, 'all three thirds of each index share its band',
        wrong.join('\n        '));
}

console.log('\nAnd below G1 it stays blank');
{
  const quiet = [0, 1, 2, 3, 4, 4.33];
  const noisy = quiet.filter(kp => gScale(kp) !== '');
  check(noisy.length === 0,
        'nothing up to Kp 4+ (4.33) is given a storm band',
        noisy.map(k => `${k} -> ${gScale(k)}`).join(', '));

  // 4.67 is "Kp 5-", which is G1 and is above the app's NZ minimum. It must
  // not fall in with the quiet values just because it reads as "4 point".
  check(gScale(4.67) === 'G1', 'but Kp 5- (4.67) is a G1 storm, not a quiet day');
  check(gColor(4.67) === gColor(5.0),
        'and it is coloured like the rest of G1', `${gColor(4.67)} vs ${gColor(5.0)}`);
}

console.log('\nThe label matches NOAA notation');
{
  const cases = [[4.67, '5-'], [5, '5o'], [5.33, '5+'], [5.67, '6-'], [9, '9o']];
  const wrong = cases.filter(([kp, want]) => kpLabel(kp) !== want)
                     .map(([kp, want]) => `${kp} -> ${kpLabel(kp)}, want ${want}`);
  check(wrong.length === 0, 'a value renders as the index and third NOAA would write',
        wrong.join(', '));
}

console.log('\nThe band and the colour never disagree');
{
  // They are separate lookups, so they can drift. A G2 badge over a G1 colour
  // is exactly the kind of thing nobody reports but everybody notices.
  const wrong = [];
  for (let kp = 0; kp <= 9.001; kp += 1 / 3) {
    const v = Math.round(kp * 100) / 100;
    const banded = gScale(v) !== '';
    const coloured = gColor(v) !== '#888';
    if (banded !== coloured) wrong.push(`Kp ${v}: band ${gScale(v) || 'none'}, colour ${gColor(v)}`);
  }
  check(wrong.length === 0, 'a value has a colour exactly when it has a band',
        wrong.join('\n        '));
}

console.log('\nThe 3-day forecast shows visibility, not Kp');
{
  // It used to draw NOAA's Kp and had to use this shared scale to band it.
  // It now shows only what can be seen - camera, phone, eye - from the app's
  // own forecast, so it has no Kp to band, and must not grow a copy of the
  // band table or a raw comparison back.
  const tsx = readFileSync(join(APP, 'components', 'KpForecastTimeline.tsx'), 'utf8');
  check(!/>\s*≈?\s*Kp\b|`Kp |'Kp /.test(tsx), 'no Kp is shown in it');

  const raw = [...tsx.matchAll(/\bkp\s*>=\s*\d/g)].map(m => m[0]);
  check(raw.length === 0,
        'and nothing compares a raw Kp value against a whole number any more',
        raw.join(', ') + ' - use kpIndex(kp) so .667 lands in the right band');

  check(!/function gScale|function gColor/.test(tsx),
        'with no second copy of the band table left in the component');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
