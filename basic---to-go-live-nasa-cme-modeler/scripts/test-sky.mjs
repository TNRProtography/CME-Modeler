#!/usr/bin/env node
// What the sky will be doing when the stream gets here.
//
//   npm run test:sky
//
// A stream arriving in two and a half days arrives into a sky, and the sky
// costs more than the difference between a moderate stream and a fast one: a
// full Moon overhead, or the Sun already up, and there is nothing to see
// however good the wind is.
//
// The checks below are mostly self-consistency rather than remembered
// almanac values, because a test that encodes a date I half-remember proves
// nothing about the model. Where the sky puts the Sun on the equinox, how
// long the Moon takes to go round, how far north the Moon can get - those
// fall out of the mean motions, and if the mean motions are wrong they come
// out wrong in a way that is obvious.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'sky-'));

async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
const S = await load('utils/skyConditions.ts');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const HOUR = 3600000, DAY = 86400000;
// Christchurch, since that is who this is for.
const LAT = -43.53, LON = 172.63;

// ── the Sun ────────────────────────────────────────────────────────────────
console.log('\nWhere the Sun is');
{
  // Declination through the year. If the mean longitude or the obliquity are
  // wrong these are wrong by degrees, and every twilight calculation with them.
  const decAt = (m, d) => S.sunPosition(new Date(Date.UTC(2026, m, d, 12))).dec;
  check(Math.abs(decAt(2, 20)) < 1, `March equinox declination ${decAt(2, 20).toFixed(2)} is near zero`);
  check(Math.abs(decAt(8, 22)) < 1.2, `September equinox ${decAt(8, 22).toFixed(2)} likewise`);
  check(Math.abs(decAt(5, 21) - 23.44) < 0.3, `June solstice ${decAt(5, 21).toFixed(2)} is the obliquity`);
  check(Math.abs(decAt(11, 21) + 23.44) < 0.3, `December solstice ${decAt(11, 21).toFixed(2)} is its negative`);

  // Find the equinox from the model rather than asserting a date: the moment
  // declination crosses zero going north should land on about 20 March.
  let crossing = null;
  for (let d = 70; d < 90; d++) {
    const a = S.sunPosition(new Date(Date.UTC(2026, 0, 1 + d))).dec;
    const b = S.sunPosition(new Date(Date.UTC(2026, 0, 2 + d))).dec;
    if (a < 0 && b >= 0) { crossing = d + 1; break; }
  }
  check(crossing !== null && crossing >= 77 && crossing <= 81,
        `the model puts the March equinox on day ${crossing} of the year`, String(crossing));

  // Solar noon altitude at home. On the equinox it is 90 minus the latitude.
  let peak = -90, peakMs = 0;
  const base = Date.UTC(2026, 2, 20);
  for (let m = 0; m < 1440; m += 5) {
    const t = base + m * 60000;
    const alt = S.altitudeDegrees(S.sunPosition(new Date(t)), LAT, LON, new Date(t));
    if (alt > peak) { peak = alt; peakMs = t; }
  }
  check(Math.abs(peak - (90 - Math.abs(LAT))) < 1.5,
        `equinox noon altitude at Christchurch is ${peak.toFixed(1)}, near ${(90 - Math.abs(LAT)).toFixed(1)}`,
        String(peak));
  const noonNz = new Date(peakMs).getUTCHours() + 12;
  check(noonNz % 24 >= 11 && noonNz % 24 <= 14,
        `and it peaks around ${(noonNz % 24).toFixed(0)}:00 local, which is midday`, String(noonNz % 24));

  // Southern winter sun is lower than southern summer sun. Getting the
  // hemisphere backwards would invert every twilight time in the app.
  const midday = (m, d) => {
    let best = -90;
    const day = Date.UTC(2026, m, d);
    for (let mm = 0; mm < 1440; mm += 10) {
      const t = day + mm * 60000;
      best = Math.max(best, S.altitudeDegrees(S.sunPosition(new Date(t)), LAT, LON, new Date(t)));
    }
    return best;
  };
  check(midday(11, 21) > midday(5, 21),
        'December midday sun is higher than June at a southern latitude',
        `${midday(11, 21).toFixed(1)} vs ${midday(5, 21).toFixed(1)}`);
}

// ── the Moon ───────────────────────────────────────────────────────────────
console.log('\nWhere the Moon is, and how much of it is lit');
{
  // The synodic month falls out of the difference between the Moon's and the
  // Sun's mean motions. If it comes out at 29.53 days the mean elements are
  // right; if it comes out at 27.3 the Sun's motion has been left out.
  const fulls = [];
  let previous = S.moonPhase(new Date(Date.UTC(2026, 0, 1))).illumination;
  let rising = true;
  for (let d = 1; d < 200; d++) {
    const at = Date.UTC(2026, 0, 1) + d * DAY;
    const illum = S.moonPhase(new Date(at)).illumination;
    if (rising && illum < previous) { fulls.push(at); rising = false; }
    if (!rising && illum > previous) rising = true;
    previous = illum;
  }
  check(fulls.length >= 5, `${fulls.length} full moons found in about six months`, String(fulls.length));
  const gaps = fulls.slice(1).map((t, i) => (t - fulls[i]) / DAY);
  const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  check(Math.abs(meanGap - 29.53) < 0.6,
        `successive full moons are ${meanGap.toFixed(2)} days apart, the synodic month`, String(meanGap));

  // Illumination has to use the whole range, and stay inside it.
  let lowest = 1, highest = 0;
  for (let d = 0; d < 40; d++) {
    const k = S.moonPhase(new Date(Date.UTC(2026, 0, 1) + d * DAY)).illumination;
    lowest = Math.min(lowest, k); highest = Math.max(highest, k);
  }
  check(lowest < 0.05 && highest > 0.95, `illumination runs ${lowest.toFixed(2)} to ${highest.toFixed(2)}`);
  check(lowest >= 0 && highest <= 1, 'and never leaves zero to one');

  // The Moon's orbit is inclined about five degrees to the ecliptic, so its
  // declination reaches further than the Sun's but not limitlessly.
  let maxDec = 0;
  for (let d = 0; d < 400; d++) {
    maxDec = Math.max(maxDec, Math.abs(S.moonPosition(new Date(Date.UTC(2026, 0, 1) + d * DAY)).dec));
  }
  check(maxDec > 23.44 && maxDec < 29.5,
        `the Moon reaches ${maxDec.toFixed(1)} degrees declination, beyond the Sun but inside the limit`,
        String(maxDec));

  // A waxing moon is getting brighter. Backwards, every phase name is wrong.
  const waxingSample = (() => {
    for (let d = 0; d < 40; d++) {
      const t = Date.UTC(2026, 0, 1) + d * DAY;
      const now = S.moonPhase(new Date(t));
      if (now.illumination > 0.2 && now.illumination < 0.8) {
        const tomorrow = S.moonPhase(new Date(t + DAY));
        return { waxing: now.waxing, brighter: tomorrow.illumination > now.illumination };
      }
    }
    return null;
  })();
  check(waxingSample && waxingSample.waxing === waxingSample.brighter,
        'a moon called waxing is in fact getting brighter', JSON.stringify(waxingSample));
}

// ── how washed out the sky is ──────────────────────────────────────────────
console.log('\nHow much the sky costs you');
{
  const sample = (atMs) => S.skyConditionsAt(atMs, LAT, LON);

  // Find a properly dark moment and a daylight one in the same week.
  let darkest = null, brightest = null;
  const start = Date.UTC(2026, 5, 15);
  for (let m = 0; m < 7 * 1440; m += 20) {
    const sky = sample(start + m * 60000);
    if (!darkest || sky.washout < darkest.washout) darkest = sky;
    if (!brightest || sky.washout > brightest.washout) brightest = sky;
  }
  check(darkest.washout < 0.1, `the darkest moment of a week scores ${darkest.washout.toFixed(2)}`);
  check(darkest.darkness === 'dark', 'and is classed as dark');
  check(brightest.washout > 0.95, 'while the brightest is hopeless');
  check(brightest.darkness === 'daylight', 'and is classed as daylight');
  check(darkest.sunAltitude < -18, 'the dark one has the Sun well below the horizon',
        String(darkest.sunAltitude));

  // A moon below the horizon costs nothing, whatever phase it is in. That is
  // the whole reason a late-rising moon leaves a usable window earlier on.
  let moonDown = null;
  for (let m = 0; m < 30 * 1440; m += 30) {
    const sky = sample(start + m * 60000);
    if (sky.darkness === 'dark' && sky.moonAltitude < -10 && sky.phase.illumination > 0.8) { moonDown = sky; break; }
  }
  check(moonDown != null, 'found a dark night with a bright moon safely below the horizon');
  check(moonDown && moonDown.washout < 0.05,
        'and it costs nothing at all', moonDown ? String(moonDown.washout) : 'n/a');

  // A bright moon high up costs a lot - but never everything, because a real
  // display still gets through a full moon.
  let moonUp = null;
  for (let m = 0; m < 40 * 1440; m += 30) {
    const sky = sample(start + m * 60000);
    if (sky.darkness === 'dark' && sky.moonAltitude > 40 && sky.phase.illumination > 0.9) { moonUp = sky; break; }
  }
  check(moonUp != null, 'found a dark night with a full moon high overhead');
  check(moonUp && moonUp.washout > 0.3 && moonUp.washout < 0.8,
        `and it costs ${moonUp ? moonUp.washout.toFixed(2) : '?'} - a lot, but not everything`);

  check(S.bestSkyWithin(start, start, LAT, LON) === null, 'an empty window has no best moment');
  check(S.bestSkyWithin(start, start + 400 * DAY, LAT, LON) === null, 'nor does an absurd one');
  const best = S.bestSkyWithin(start, start + DAY, LAT, LON);
  check(best != null && best.washout <= sample(start).washout,
        'and the best moment in a day is at least as good as its start');
}

// ── what you would actually see ────────────────────────────────────────────
console.log('\nWhat you could expect to see');
{
  const dark = { atMs: 0, sunAltitude: -40, moonAltitude: -20, darkness: 'dark', washout: 0,
                 phase: { illumination: 0, elongation: 0, waxing: true, name: 'New moon' } };
  const moonlit = { ...dark, moonAltitude: 60, washout: 0.5,
                    phase: { illumination: 1, elongation: 180, waxing: false, name: 'Full moon' } };
  const day = { ...dark, sunAltitude: 30, darkness: 'daylight', washout: 1 };

  // One scale for every surface, the app's published one (tierForStrength):
  // 20 long exposure, 35 phone, 50 a faint glow to the eye. Where a given
  // oval position lands on it is utils/auroraVisibility's job, and that is
  // tested against typical New Zealand nights in test-aurora-visibility.
  check(S.visibilityOutlook(85, dark).tier === 'eye', 'a strong display in a dark sky is naked eye');
  check(S.visibilityOutlook(55, dark).tier === 'eye', 'a faint glow to the eye still counts as eye');
  check(/faint glow/.test(S.visibilityOutlook(55, dark).label), 'and says it is only a faint one');
  check(S.visibilityOutlook(40, dark).tier === 'phone', 'a moderate one is a phone shot');
  check(S.visibilityOutlook(25, dark).tier === 'camera', 'a weak one needs a long exposure');
  check(S.visibilityOutlook(15, dark).tier === 'none', 'and a very weak one is not worth going out for');
  check(S.tierForStrength(S.TIER_CAMERA) === 'camera' && S.tierForStrength(S.TIER_PHONE) === 'phone'
        && S.tierForStrength(S.TIER_EYE) === 'eye', 'each tier starts exactly at its threshold');

  // The tiers must never invert: more light in the sky can only cost you.
  let monotonic = true;
  for (let strength = 0; strength <= 100; strength += 5) {
    const clear = S.visibilityOutlook(strength, dark).effectiveStrength;
    const washed = S.visibilityOutlook(strength, moonlit).effectiveStrength;
    if (washed > clear + 1e-9) monotonic = false;
  }
  check(monotonic, 'a washed-out sky never beats a dark one at the same strength');

  const sameDisplay = S.visibilityOutlook(85, moonlit);
  check(sameDisplay.effectiveStrength < 65 && /faint glow/.test(sameDisplay.label),
        'a display under a high full moon drops to a faint glow', sameDisplay.label);
  // Moonlight drowns what is faint and leaves what is bright.
  check(S.visibilityOutlook(40, moonlit).tier !== 'phone',
        'but a phone shot under the same moon is gone', S.visibilityOutlook(40, moonlit).tier);
  check(S.visibilityOutlook(100, moonlit).tier === 'eye',
        'while the oval overhead is still a naked-eye display');
  check(/washing out/.test(sameDisplay.note), 'and says the moon is why', sameDisplay.note);
  check(/as dark as it gets/.test(S.visibilityOutlook(85, dark).note),
        'while a moonless sky is called out as the good case');

  check(S.visibilityOutlook(100, day).tier === 'none', 'nothing is visible in daylight');
  check(S.visibilityOutlook(100, day).effectiveStrength === 0, 'however strong the stream');
  check(/following night/.test(S.visibilityOutlook(100, day).note),
        'and it points at the next night rather than just saying no');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
