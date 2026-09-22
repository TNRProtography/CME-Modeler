#!/usr/bin/env node
// What the structure panel says is coming.
//
// The panel classifies L1 and names what is passing us now. That is a
// different question from what is about to pass us, and it was answering the
// second with the first: "nothing in the current data suggests a change in
// the next few hours" was true of the current data and false of the app,
// which had CH96 arriving in two days at 675 km/s three panels away.
//
// expectedChange reads the same forecast timeline the chart is drawn from, so
// the two cannot disagree. These check it finds real arrivals, ignores noise,
// and reports the sector geometry honestly - including when the honest answer
// is that the polarity guarantees nothing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'expected-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const HOUR = 3600000;
const now = Date.UTC(2026, 8, 22, 3, 0, 0);

/** An hourly timeline: speed(hoursFromNow) and southward(hoursFromNow). */
const series = (hours, speed, southward = () => 0, id = null, kind = 'ambient') =>
  Array.from({ length: hours }, (_, h) => ({
    atMs: now + h * HOUR,
    speedKms: speed(h),
    densityCm3: 4,
    btNt: 5,
    bzFromSectorNt: southward(h),
    bzFluctuationNt: 3,
    source: h === 0 ? 'observed' : 'modelled',
    disturbance: speed(h) > speed(0) + 60 ? kind : 'ambient',
    disturbanceId: speed(h) > speed(0) + 60 ? id : undefined,
  }));

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/forecastTimeline.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 't.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const { expectedChange } = await import(pathToFileURL(join(out, 't.mjs')).href);

  console.log('\nA coronal hole stream two days out');
  {
    // Flat 320, rising from hour 48, peaking 675 at hour 56 - CH96 as it
    // actually stands today.
    const tl = series(96, (h) => (h < 48 ? 321 : Math.min(675, 321 + (h - 48) * 45)),
                      (h) => (h >= 48 && h <= 60 ? -2.6 : 0), 'CH96', 'hss');
    const e = expectedChange(tl, now);
    check(e !== null, 'is found at all');
    check(e.peakSpeedKms === 675, `peak speed is the stream's, not the ambient (${e.peakSpeedKms})`, String(e.peakSpeedKms));
    check(e.fromSpeedKms === 321, `compared against now, not against the minimum (${e.fromSpeedKms})`);
    check(e.sourceId === 'CH96', 'and it says which hole', String(e.sourceId));
    // The time given is when it starts to change, not when it is already best:
    // somebody planning a night needs the front edge.
    const startH = (e.atMs - now) / HOUR;
    const peakH = (e.peakMs - now) / HOUR;
    check(startH >= 46 && startH <= 50, `starts at the rise (${startH}h), not the peak (${peakH}h)`, `${startH}h`);
    check(e.peakSouthwardNt === -2.6, `carries the guaranteed southward field (${e.peakSouthwardNt} nT)`, String(e.peakSouthwardNt));
  }

  console.log('\nA stream whose polarity guarantees nothing');
  {
    const tl = series(96, (h) => (h < 48 ? 321 : Math.min(675, 321 + (h - 48) * 45)),
                      () => 0, 'CH97', 'hss');
    const e = expectedChange(tl, now);
    check(e.peakSouthwardNt === 0,
          'reports zero rather than omitting it - a positive-polarity hole in September really does project nothing southward',
          String(e.peakSouthwardNt));
    check(e.peakSpeedKms === 675, 'while still reporting the speed, which is real');
  }

  console.log('\nQuiet is quiet');
  {
    check(expectedChange(series(96, () => 321), now) === null,
          'flat ambient wind produces nothing to announce');
    // Model wobble is not an arrival. Without a floor the panel would promise
    // a change every time the ambient drifted a few km/s.
    check(expectedChange(series(96, (h) => 321 + Math.sin(h / 3) * 20), now) === null,
          'nor does a wobble of a few tens of km/s');
    check(expectedChange([], now) === null, 'an empty timeline is not a crash');
    check(expectedChange(series(1, () => 321), now) === null, 'nor is a single point');
  }

  console.log('\nThe horizon is respected');
  {
    const tl = series(24 * 10, (h) => (h < 200 ? 321 : 700), () => 0, 'CHX', 'hss');
    check(expectedChange(tl, now, 3 * 24 * HOUR) === null,
          'something eight days out is not "what is coming" on a three-day horizon');
    check(expectedChange(tl, now, 10 * 24 * HOUR) !== null, 'but is found when asked for ten');
  }

  console.log('\nAlready under way');
  {
    // Speed already high and falling: the change is behind us, not ahead.
    const tl = series(96, (h) => Math.max(320, 675 - h * 20));
    check(expectedChange(tl, now) === null,
          'a stream that has already peaked is not announced as coming');
  }

  console.log('\nThe NEXT arrival is reported, not the biggest');
  {
    // 450 km/s tomorrow, 675 in two days. Both real; somebody deciding about
    // tonight needs the first. Reporting the larger would also put the wrong
    // time on it, since the two are separated by a return to ambient.
    const tl = series(96, (h) => (h >= 12 && h < 20 ? 450 : h >= 48 ? 675 : 321),
                      () => 0, 'CH96', 'hss');
    const e = expectedChange(tl, now);
    const startH = (e.atMs - now) / HOUR;
    check(startH >= 10 && startH <= 12, `it starts at the nearer event (${startH}h)`, `${startH}h`);
    check(e.peakSpeedKms === 450,
          `and peaks with that event, not the one behind it (${e.peakSpeedKms})`, String(e.peakSpeedKms));
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
