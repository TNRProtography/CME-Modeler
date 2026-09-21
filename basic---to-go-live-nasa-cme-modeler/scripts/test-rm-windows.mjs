#!/usr/bin/env node
// When a stream's field is actually geoeffective, hour by hour.
//
//   npm run test:rm-windows
//
// A coronal hole's polarity fixes the sign of By for the days its stream takes
// to pass. How much of that By the Earth feels as SOUTHWARD field does not
// hold still: the geomagnetic dipole is tilted and that tilt sweeps round once
// a day, on top of the annual cycle that makes the equinoxes stormy. So a
// stream is geoeffective at particular hours of particular nights.
//
// The direction of all this is the thing worth pinning down. Backwards, it
// sends people out on the wrong nights with total confidence - which is worse
// than saying nothing, and it is a mistake this codebase has already made once.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'rmw-'));

async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
const E = await load('utils/rmEffect.ts');
const R = await load('utils/rmWindows.ts');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const HOUR = 3600000, DAY = 86400000;
const MARCH = Date.UTC(2026, 2, 20);
const SEPT  = Date.UTC(2026, 8, 22);
const JUNE  = Date.UTC(2026, 5, 21);

// ── the direction ──────────────────────────────────────────────────────────
console.log('\nWhich sector is geoeffective, and when');
{
  // Russell & McPherron 1973 and everything since: the away sector (By > 0)
  // is the geoeffective one around the MARCH equinox, the toward sector around
  // SEPTEMBER. The trap is that "away favours spring" is right and easy to
  // remember, and then spring gets read as September by anybody thinking about
  // New Zealand. It is not a hemisphere property - March is March wherever you
  // are standing.
  const awayMarch = R.rmDailyPeak(1, new Date(MARCH));
  const towardMarch = R.rmDailyPeak(-1, new Date(MARCH));
  check(awayMarch > towardMarch,
        `away beats toward at the March equinox (${awayMarch.toFixed(2)} vs ${towardMarch.toFixed(2)})`,
        `${awayMarch} vs ${towardMarch}`);

  const awaySept = R.rmDailyPeak(1, new Date(SEPT));
  const towardSept = R.rmDailyPeak(-1, new Date(SEPT));
  check(towardSept > awaySept,
        `and toward beats away in September (${towardSept.toFixed(2)} vs ${awaySept.toFixed(2)})`,
        `${towardSept} vs ${awaySept}`);

  // The two peaks are half a year apart, which is the whole semiannual story.
  let awayBest = { peak: -1, month: -1 }, towardBest = { peak: -1, month: -1 };
  for (let m = 0; m < 12; m++) {
    const at = new Date(Date.UTC(2026, m, 15));
    const a = R.rmDailyPeak(1, at, 20), t = R.rmDailyPeak(-1, at, 20);
    if (a > awayBest.peak) awayBest = { peak: a, month: m };
    if (t > towardBest.peak) towardBest = { peak: t, month: m };
  }
  check(awayBest.month >= 1 && awayBest.month <= 4,
        `an away sector peaks in month ${awayBest.month + 1}, in the February-to-May half`, String(awayBest.month + 1));
  check(towardBest.month >= 7 && towardBest.month <= 10,
        `a toward sector peaks in month ${towardBest.month + 1}, in the August-to-November half`, String(towardBest.month + 1));
  check(Math.abs(Math.abs(awayBest.month - towardBest.month) - 6) <= 1,
        'and the two peaks are about six months apart');

  // A wrong-signed By does not produce a small southward field. It produces a
  // northward one, which is not the same thing and must not be averaged in.
  check(R.rmSouthwardPerNt(1, new Date(SEPT + 11 * HOUR)) === 0,
        'the wrong sector contributes exactly nothing, not a little');
  check(R.rmSouthwardPerNt(-1, new Date(SEPT + 11 * HOUR)) > 0.4,
        'while the right one contributes strongly');
}

// ── the daily rhythm ───────────────────────────────────────────────────────
console.log('\nThe window comes round every day');
{
  // Sampled across three days at the September equinox for a toward sector.
  const windows = R.rmWindows(-1, SEPT, SEPT + 3 * DAY);
  check(windows.length >= 3, `three days give ${windows.length} windows`, String(windows.length));
  check(windows.every(w => w.endMs > w.startMs), 'each window has a positive duration');
  check(windows.every(w => w.peakMs >= w.startMs && w.peakMs <= w.endMs), 'and its peak inside it');

  // Consecutive peaks are about 24 hours apart: this is a daily rhythm, not a
  // single event, which is what lets good NIGHTS be named without knowing the
  // arrival to the hour.
  for (let i = 1; i < windows.length; i++) {
    const gap = (windows[i].peakMs - windows[i - 1].peakMs) / HOUR;
    check(Math.abs(gap - 24) < 2, `peaks ${i} and ${i + 1} are ${gap.toFixed(1)} hours apart`, String(gap));
  }

  const durations = windows.map(w => (w.endMs - w.startMs) / HOUR);
  check(durations.every(d => d > 1 && d < 16),
        `each window is a usable few hours (${durations.map(d => d.toFixed(1)).join(', ')})`,
        String(durations));

  // At the equinox the peak lands in the evening in New Zealand, which is the
  // entire point of computing this rather than quoting a date.
  const peakUtcHour = new Date(windows[0].peakMs).getUTCHours();
  check(peakUtcHour >= 8 && peakUtcHour <= 14,
        `the September peak is around ${String(peakUtcHour).padStart(2, '0')}:00 UT, which is evening in NZ`,
        String(peakUtcHour));

  // The wrong sector at the same time of year yields nothing at all.
  check(R.rmWindows(1, SEPT, SEPT + 3 * DAY).length === 0,
        'the wrong sector produces no windows rather than weak ones');
}

// ── turning it into nT ─────────────────────────────────────────────────────
console.log('\nFrom a coefficient to a number of nT');
{
  const plain = R.rmWindows(-1, SEPT, SEPT + DAY);
  check(plain[0].peakSouthwardNt === null, 'with no field strength given, no nT is claimed');

  const withBy = R.rmWindows(-1, SEPT, SEPT + DAY, { byMagnitudeNt: 8 });
  check(withBy[0].peakSouthwardNt > 0, 'given a By, the window carries an expected southward field');
  check(Math.abs(withBy[0].peakSouthwardNt - 8 * withBy[0].peakPerNt) < 1e-9,
        `8 nT of By becomes ${withBy[0].peakSouthwardNt.toFixed(1)} nT southward at the peak`);
  check(withBy[0].peakSouthwardNt < 8, 'which is less than the By itself, since it is a projection');

  // Sign of the supplied magnitude must not matter - it is a magnitude.
  const negative = R.rmWindows(-1, SEPT, SEPT + DAY, { byMagnitudeNt: -8 });
  check(negative[0].peakSouthwardNt === withBy[0].peakSouthwardNt,
        'and it is read as a magnitude, whichever sign it arrives with');
}

// ── agreement with the frame transform it comes from ───────────────────────
console.log('\nAgreeing with the transform it is derived from');
{
  // rmSouthwardPerNt must be exactly the By term of effectiveBz. If these ever
  // drift the windows would point at the wrong hours while still looking fine.
  let worst = 0;
  for (let h = 0; h < 48; h++) {
    const when = new Date(SEPT + h * HOUR);
    for (const by of [-8, -3, 3, 8]) {
      const sign = by > 0 ? 1 : -1;
      const predicted = -Math.abs(by) * R.rmSouthwardPerNt(sign, when);
      const actual = E.effectiveBz(by, 0, when).bzEff;
      // Only where the projection is southward; elsewhere the floor at zero
      // deliberately differs from the raw transform.
      if (actual <= 0) worst = Math.max(worst, Math.abs(predicted - actual));
    }
  }
  check(worst < 1e-9, `the two agree to ${worst.toExponential(1)} nT wherever the field is southward`, String(worst));
}

// ── refusing to answer ─────────────────────────────────────────────────────
console.log('\nNot answering when there is nothing to say');
{
  check(R.rmWindows(-1, SEPT, SEPT).length === 0, 'an empty range gives no windows');
  check(R.rmWindows(-1, SEPT + DAY, SEPT).length === 0, 'nor does a backwards one');
  check(R.rmWindows(-1, SEPT, SEPT + 400 * DAY).length === 0,
        'and an absurd range is refused rather than ground through');

  check(R.bySignForPolarity('positive') === 1, 'a positive hole sends an away sector');
  check(R.bySignForPolarity('negative') === -1, 'a negative hole a toward sector');
  check(R.bySignForPolarity('mixed') === null, 'and mixed polarity gives no sign to work with');
  check(R.bySignForPolarity('unknown') === null, 'nor does an unmeasured one');

  // June: neither sector is strongly favoured, so the day-relative threshold
  // has to stop it inventing a window out of the best of a bad lot.
  const june = R.rmWindows(1, JUNE, JUNE + DAY, { minPerNt: 0.25 });
  check(june.length === 0, 'a solstice day with a weak projection yields nothing at that threshold');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
