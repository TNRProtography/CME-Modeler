#!/usr/bin/env node
// Marking our own homework against what actually turned up.
//
//   npm run test:forecast-scoring
//
// The point of scoring is to replace a guess with a fact, so the thing that
// matters most here is that it refuses to invent facts. A missed arrival costs
// one data point. A FALSE arrival scores a forecast against something that
// never happened, and a corrupted track record is worse than no track record,
// because people believe it. Most of these tests are about that asymmetry.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'score-'));

async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
const S = await load('utils/forecastScoring.ts');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const HOUR = 3600000, DAY = 86400000;
const T0 = Date.UTC(2026, 8, 21, 0);

/** A stretch of L1 data: quiet, then a stream arriving at `arrivesAt`. */
function wind({ arrivesAtHours = null, quiet = 380, peak = 620, hours = 120, noise = 0 } = {}) {
  const samples = [];
  for (let h = 0; h < hours; h++) {
    let speed = quiet;
    if (arrivesAtHours != null && h >= arrivesAtHours) {
      const since = h - arrivesAtHours;
      // Rises over about eight hours, then stays up and slowly decays.
      const rise = Math.min(1, since / 8);
      speed = quiet + (peak - quiet) * rise * Math.max(0.55, 1 - since / 90);
    }
    if (noise) speed += Math.sin(h * 2.1) * noise;
    samples.push({ atMs: T0 + h * HOUR, speedKms: speed });
  }
  return samples;
}

// ── finding a real arrival ─────────────────────────────────────────────────
console.log('\nFinding a stream in real data');
{
  const samples = wind({ arrivesAtHours: 48 });
  const found = S.detectArrival(samples, T0 + 24 * HOUR, T0 + 96 * HOUR);
  check(found != null, 'a clear stream is found');
  const foundHour = found ? (found.atMs - T0) / HOUR : -1;
  check(foundHour >= 48 && foundHour <= 56,
        `and at about the right time (hour ${foundHour})`, String(foundHour));
  check(found && Math.abs(found.peakSpeedKms - 620) < 40,
        `with roughly the right peak (${found ? found.peakSpeedKms.toFixed(0) : '?'})`);
  check(found && Math.abs(found.baselineSpeedKms - 380) < 20, 'and the right baseline');
}

// ── refusing to invent one ─────────────────────────────────────────────────
console.log('\nRefusing to find one that is not there');
{
  check(S.detectArrival(wind({ quiet: 380 }), T0, T0 + 120 * HOUR) === null,
        'flat quiet wind contains no arrival');
  check(S.detectArrival(wind({ quiet: 380, noise: 30 }), T0, T0 + 120 * HOUR) === null,
        'and nor does noisy quiet wind, which is where a naive detector fires');

  // A single spike is not an arrival. Real streams stay up for a day or more.
  const spiky = wind({ quiet: 380 });
  spiky[60].speedKms = 700;
  spiky[61].speedKms = 690;
  check(S.detectArrival(spiky, T0, T0 + 120 * HOUR) === null,
        'a two-hour spike is not a stream, however fast');

  check(S.detectArrival([], T0, T0 + DAY) === null, 'no data, no arrival');
  check(S.detectArrival(wind({ arrivesAtHours: 48 }).slice(0, 4), T0, T0 + DAY) === null,
        'nor from a handful of samples');
  check(S.detectArrival(
    wind({ arrivesAtHours: 48 }).map(s => ({ ...s, speedKms: null })), T0, T0 + 120 * HOUR) === null,
    'nor from samples with no speed in them');

  // Outside the search window it must not be claimed.
  check(S.detectArrival(wind({ arrivesAtHours: 48 }), T0 + 80 * HOUR, T0 + 110 * HOUR) === null,
        'an arrival outside the window searched is not reported');

  // A small rise is drift, not a stream.
  check(S.detectArrival(wind({ arrivesAtHours: 48, quiet: 380, peak: 420 }), T0, T0 + 120 * HOUR) === null,
        'a 40 km/s rise is drift rather than a stream');
}

// ── marking one forecast ───────────────────────────────────────────────────
console.log('\nMarking a single forecast');
{
  const forecast = {
    id: 'f1', issuedAtMs: T0, sourceId: 'CH96', kind: 'HSS',
    predictedArrivalMs: T0 + 48 * HOUR,
    p10Ms: T0 + 40 * HOUR, p90Ms: T0 + 60 * HOUR,
    predictedSpeedKms: 600,
  };

  const onTime = S.scoreForecast(forecast, { atMs: T0 + 48 * HOUR, peakSpeedKms: 600, baselineSpeedKms: 380 });
  check(onTime.arrivalErrorHours === 0, 'a perfect forecast scores zero error');
  check(onTime.speedErrorKms === 0, 'and zero speed error');
  check(onTime.insideBand, 'and lands inside its own band');

  const late = S.scoreForecast(forecast, { atMs: T0 + 54 * HOUR, peakSpeedKms: 650, baselineSpeedKms: 380 });
  check(late.arrivalErrorHours === 6, 'arriving six hours late scores +6, not 6');
  check(late.speedErrorKms === 50, 'and faster than forecast scores positive');
  check(late.insideBand, 'still inside an eighty percent band that wide');

  const early = S.scoreForecast(forecast, { atMs: T0 + 44 * HOUR, peakSpeedKms: 550, baselineSpeedKms: 380 });
  check(early.arrivalErrorHours === -4, 'arriving early scores negative, so bias is visible');
  check(early.speedErrorKms === -50, 'and slower than forecast likewise');

  const outside = S.scoreForecast(forecast, { atMs: T0 + 70 * HOUR, peakSpeedKms: 600, baselineSpeedKms: 380 });
  check(!outside.insideBand, 'and something well outside the band is marked as such');
}

// ── the track record ───────────────────────────────────────────────────────
console.log('\nThe track record, and what it is allowed to claim');
{
  const score = (errorHours, inside = true) => ({
    forecastId: 'x', sourceId: 'CH96', kind: 'HSS',
    arrivalErrorHours: errorHours, speedErrorKms: 20, insideBand: inside,
    observedArrivalMs: T0, observedPeakSpeedKms: 600,
  });

  const empty = S.buildTrackRecord([]);
  check(empty.scored === 0, 'nothing scored yet is nothing scored');
  check(/No forecasts have been scored/.test(empty.summary),
        'and it says so plainly rather than reporting a perfect record', empty.summary);

  // Eight of ten inside an eighty percent band is what "about right" means.
  // Ten of ten would NOT be - that is a padded band, and it is reported as
  // one, which is the point of measuring rather than asserting.
  const mixed = S.buildTrackRecord([score(2), score(-3), score(5), score(-1), score(4),
                                    score(-2), score(1), score(3), score(-4, false), score(2, false)]);
  check(mixed.scored === 10, 'ten scores counted');
  check(mixed.medianAbsErrorHours > 0, `median error ${mixed.medianAbsErrorHours.toFixed(1)} hours`);
  check(Math.abs(mixed.medianErrorHours) < 2, 'with no bias, since the errors go both ways');
  check(!/later than forecast|earlier than forecast/.test(mixed.summary),
        'so no bias is claimed', mixed.summary);
  check(/about right/.test(mixed.summary),
        'eight in ten inside an eighty percent band is about right', mixed.summary);
  check(Math.abs(mixed.bandHitRate - 0.8) < 1e-9, 'and the hit rate is measured exactly');

  // A consistent bias must be called out, not averaged into nothing.
  const biased = S.buildTrackRecord([score(6), score(7), score(5), score(8), score(6),
                                     score(7), score(9), score(5), score(6), score(7)]);
  check(biased.medianErrorHours > 5, 'a consistent lateness shows in the signed median');
  check(/later than forecast/.test(biased.summary),
        'and is called a bias worth correcting rather than noise', biased.summary);

  // Bands that are too narrow are the dishonest failure, and get named.
  const narrow = S.buildTrackRecord(Array.from({ length: 12 }, (_, i) => score(i - 6, i < 3)));
  check(narrow.bandHitRate < 0.4, 'a band that rarely contains the truth is measured as such');
  check(/too narrow/.test(narrow.summary) && /optimistic/.test(narrow.summary),
        'and the summary says the intervals should be read as optimistic', narrow.summary);

  // Bands that are too wide are also dishonest, just in the flattering way.
  const wide = S.buildTrackRecord(Array.from({ length: 12 }, () => score(1, true)));
  check(/wider than they need/.test(wide.summary), 'padded bands are called out too', wide.summary);

  // And with too few, nothing is claimed about the band at all.
  const few = S.buildTrackRecord([score(1), score(2), score(-1)]);
  check(/Too few so far/.test(few.summary),
        'three forecasts is not enough to judge the band, and it says so', few.summary);
  check(!/about right|too narrow|wider than/.test(few.summary),
        'rather than quoting a hit rate from three samples');
}

// ── knowing when to mark ───────────────────────────────────────────────────
console.log('\nOnly marking forecasts whose window has passed');
{
  const make = (p90OffsetHours) => ({
    id: `f${p90OffsetHours}`, issuedAtMs: T0, sourceId: 'CH96', kind: 'HSS',
    predictedArrivalMs: T0, p10Ms: T0, p90Ms: T0 + p90OffsetHours * HOUR, predictedSpeedKms: 600,
  });
  const due = S.dueForScoring([make(-24), make(-6), make(24)], T0);
  check(due.length === 1, 'only the one whose window closed long enough ago is due', String(due.length));
  check(due[0].id === 'f-24', 'and it is the right one');
  check(S.dueForScoring([], T0).length === 0, 'nothing stored, nothing due');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
