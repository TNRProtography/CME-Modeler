#!/usr/bin/env node
// One timeline of the solar wind at Earth, and the aurora forecast from it.
//
//   npm run test:forecast-timeline
//
// The structure is the part worth pinning down. A stream's density DROPS while
// its speed peaks, and spikes in the compression AHEAD of it - which is the
// opposite of what anybody expects, and a model that gets it backwards looks
// entirely plausible while being wrong about the one thing the shape is for.
//
// The other thing checked hard: that Bz is never claimed. The sector geometry
// gives a real, computable southward field; the fluctuations do not, and the
// two must stay in different fields so nothing downstream can quietly add
// them together and call it a forecast.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'ftl-'));

async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
await load('utils/rmEffect.ts');
await load('utils/rmWindows.ts');
await load('utils/skyConditions.ts');
await load('utils/ovalPhysics.ts');
await load('utils/solarEphemeris.ts');
await load('utils/solarDisk.ts');
await load('utils/solarWindModel.ts');
await load('utils/coronalHoleData.ts');
const C = await load('utils/coronalHoleDynamics.ts');
const F = await load('utils/forecastTimeline.ts');
const A = await load('utils/auroraOutlook.ts');
const S = await load('utils/skyConditions.ts');
const dark = { atMs: 0, sunAltitude: -40, moonAltitude: -20, darkness: 'dark', washout: 0,
               phase: { illumination: 0, elongation: 0, waxing: true, name: 'New moon' } };

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const HOUR = 3600000, DAY = 86400000;
const NOW = Date.now();
const LAT = -43.53, LON = 172.63;

const stream = (over = {}) => ({
  id: 'CH96',
  centralMeridianMs: NOW,
  peakSpeedKms: 650,
  widthDeg: 50,
  bySign: -1,
  ...over,
});

// ── how long a hole blows at us ────────────────────────────────────────────
console.log('\nA hole is aimed at Earth for days, not for a moment');
{
  const wide = F.emissionWindowMs(50) / DAY;
  const narrow = F.emissionWindowMs(10) / DAY;
  check(wide > 3 && wide < 4.5, `a 50 degree hole blows at us for ${wide.toFixed(1)} days`);
  check(narrow < 1, `a 10 degree one for ${narrow.toFixed(2)} days`);
  check(wide > narrow, 'and a wider hole always blows for longer');
  check(F.emissionWindowMs(0) > 0, 'even a degenerate width gives a positive window');
}

// ── the shape of a stream ──────────────────────────────────────────────────
console.log('\nThe shape of a stream at Earth');
{
  const s = stream();
  const timeline = F.buildForecastTimeline([], [s], {
    fromMs: NOW, toMs: NOW + 9 * DAY, stepMs: HOUR,
  });
  check(timeline.length > 100, `${timeline.length} points across nine days`);
  check(timeline.every(p => p.source === 'modelled'), 'all of it is modelled, since none of it has happened');

  const peak = timeline.reduce((a, b) => (a.speedKms >= b.speedKms ? a : b));
  check(Math.abs(peak.speedKms - 650) < 30, `speed peaks near the estimate (${peak.speedKms.toFixed(0)})`);
  check(peak.disturbance === 'HSS', 'and the peak is inside the stream itself', peak.disturbance);

  // The counterintuitive bit, and the reason the shape is worth having.
  const sir = timeline.filter(p => p.disturbance === 'SIR');
  const hss = timeline.filter(p => p.disturbance === 'HSS');
  check(sir.length > 0 && hss.length > 0, 'both a compression and a stream appear');
  const sirPeakDensity = Math.max(...sir.map(p => p.densityCm3));
  const hssMinDensity = Math.min(...hss.map(p => p.densityCm3));
  check(sirPeakDensity > hssMinDensity * 3,
        `density spikes to ${sirPeakDensity.toFixed(1)} in the compression and drops to ${hssMinDensity.toFixed(1)} in the stream`,
        `${sirPeakDensity} vs ${hssMinDensity}`);
  check(hssMinDensity < 5, 'fast wind is THIN, which is the thing models get backwards');

  // The compression comes FIRST. Backwards, the whole profile is wrong.
  const firstSir = Math.min(...sir.map(p => p.atMs));
  const firstHss = Math.min(...hss.map(p => p.atMs));
  check(firstSir < firstHss, 'and the compression arrives ahead of the stream');

  const sirPeakBt = Math.max(...sir.map(p => p.btNt));
  check(sirPeakBt > 6, `the field is enhanced in the compression (${sirPeakBt.toFixed(1)} nT)`);

  // Quiet before and after.
  check(timeline[0].disturbance === 'ambient', 'it is quiet before any of it starts');
  check(timeline[timeline.length - 1].disturbance === 'ambient', 'and quiet again at the end');

  const spans = F.disturbanceSpans(timeline);
  check(spans.length >= 2, `${spans.length} disturbance spans found`);
  check(spans[0].kind === 'SIR', 'the first span is the compression', spans[0].kind);
  check(spans.every(s => s.endMs >= s.startMs), 'and every span is the right way round');
}

// ── observation always wins ────────────────────────────────────────────────
console.log('\nObservation beats model wherever it exists');
{
  const observed = [];
  for (let h = -48; h <= 0; h++) {
    observed.push({ atMs: NOW + h * HOUR, speedKms: 412, densityCm3: 9, btNt: 7, bzNt: -3 });
  }
  const timeline = F.buildForecastTimeline(observed, [stream()], {
    fromMs: NOW - 48 * HOUR, toMs: NOW + 5 * DAY, stepMs: HOUR,
  });

  const past = timeline.filter(p => p.atMs < NOW - HOUR);
  const future = timeline.filter(p => p.atMs > NOW + HOUR);
  check(past.every(p => p.source === 'observed'), 'the past is all observation');
  check(future.every(p => p.source === 'modelled'), 'the future is all model');
  check(past.every(p => p.speedKms === 412), 'and the observed values are used as given, not smoothed into a model');
  check(past.every(p => p.bzFluctuationNt === 0),
        'a measured Bz carries no fluctuation band, because it is a fact rather than an expectation');

  const sparse = F.buildForecastTimeline(
    [{ atMs: NOW - 10 * DAY, speedKms: 400, densityCm3: 5, btNt: 5, bzNt: 0 }],
    [], { fromMs: NOW - DAY, toMs: NOW + DAY, stepMs: HOUR });
  check(sparse.every(p => p.source === 'modelled'),
        'an observation far outside the window is not stretched across it');
}

// ── Bz is never claimed ────────────────────────────────────────────────────
console.log('\nBz is offered as geometry and amplitude, never as a value');
{
  const withPolarity = F.buildForecastTimeline([], [stream({ bySign: -1 })], {
    fromMs: NOW, toMs: NOW + 5 * DAY, stepMs: HOUR });
  const without = F.buildForecastTimeline([], [stream({ bySign: null })], {
    fromMs: NOW, toMs: NOW + 5 * DAY, stepMs: HOUR });

  check(withPolarity.some(p => p.bzFromSectorNt < -0.5),
        'a known sector produces a real southward expectation at some hours');
  check(withPolarity.some(p => Math.abs(p.bzFromSectorNt) < 0.01),
        'and none at others, because the projection swings through the day');
  check(without.every(p => p.bzFromSectorNt === 0),
        'an unmeasured polarity claims no southward field at all');
  check(withPolarity.every(p => p.bzFluctuationNt >= 0),
        'the fluctuation is an amplitude, so it is never negative');
  check(withPolarity.some(p => p.bzFluctuationNt > 0),
        'and it is offered, so callers can show a range');

  // The two must be separate fields. Anything that adds them together and
  // calls the result a forecast Bz is claiming something unknowable.
  const sample = withPolarity.find(p => p.disturbance === 'HSS');
  check(sample && 'bzFromSectorNt' in sample && 'bzFluctuationNt' in sample,
        'the computable part and the unknowable part stay separate');
}

// ── the same chain, run forward ────────────────────────────────────────────
console.log('\nThe nowcast chain, fed forecast numbers');
{
  const timeline = F.buildForecastTimeline([], [stream()], {
    fromMs: NOW, toMs: NOW + 6 * DAY, stepMs: HOUR });
  const outlook = A.buildOutlook(timeline);

  check(outlook.length === timeline.length, 'every point gets an outlook');
  check(outlook.every(p => p.boundaryLikely <= -44 && p.boundaryLikely >= -76),
        'the oval boundary stays inside its physical clamps');
  // The oval moves EQUATORWARD as driving strengthens, and equatorward in the
  // southern hemisphere is toward zero - a LESS negative number. Getting this
  // backwards is easy and would invert every comparison downstream.
  check(outlook.every(p => p.boundaryBest >= p.boundaryLikely - 1e-9),
        'the best case never puts the oval further poleward than the likely case');
  check(outlook.some(p => p.boundaryBest > p.boundaryLikely + 0.1),
        'and does move it equatorward somewhere, so the range is not cosmetic');

  // The coupling has to come out in the units the oval physics expects -
  // thousands, not tens. Too small and the oval never moves, which looks like
  // a working forecast that happens to be boring.
  const stormy = A.newellCoupling(700, 10, -15);
  check(stormy > 20000, `a storm couples at ${stormy.toFixed(0)}, in the thousands`, String(stormy));
  const calm = A.newellCoupling(400, 3, 0);
  check(calm > 1000 && calm < stormy / 4, `and quiet conditions at ${calm.toFixed(0)}`, String(calm));

  const quiet = A.buildOutlook(F.buildForecastTimeline([], [], {
    fromMs: NOW, toMs: NOW + DAY, stepMs: HOUR }));
  const active = outlook.filter(p => p.disturbance === 'HSS');
  check(active.length > 0 && Math.max(...active.map(p => p.boundaryLikely))
        > Math.max(...quiet.map(p => p.boundaryLikely)),
        'a stream pushes the oval further equatorward than quiet conditions',
        `${Math.max(...active.map(p => p.boundaryLikely)).toFixed(2)} vs ${Math.max(...quiet.map(p => p.boundaryLikely)).toFixed(2)}`);

  // How far equatorward of the oval each instrument still sees something. A
  // long exposure reaches a great deal further than an eye does, and
  // collapsing that into one distance either calls those nights nothing or
  // calls them naked-eye. Both are wrong; the second is worse.
  const tierAt = (reach) => S.visibilityOutlook(A.strengthAtLatitude(-45 - reach, -45), dark).tier;
  check(A.strengthAtLatitude(-45, -45) === 100, 'the oval at your latitude is as good as it gets');
  check(tierAt(0) === 'eye', 'overhead is naked eye');
  check(tierAt(3) === 'eye', 'and three degrees away still is');
  check(tierAt(7) === 'phone', 'seven degrees away is a phone shot');
  check(tierAt(12) === 'camera', 'twelve degrees away needs a long exposure');
  check(tierAt(17) === 'none', 'and seventeen degrees away is nothing at all');
  check(A.strengthAtLatitude(-50, -45) > A.strengthAtLatitude(-55, -45),
        'it falls off steadily with distance');

  // Geomagnetic latitude is not geographic, and for New Zealand the
  // difference is about four degrees in the direction that matters.
  const geomag = A.geomagneticLatitude(-43.53, 172.63);
  check(geomag < -45 && geomag > -50,
        `Christchurch sits at ${geomag.toFixed(1)} geomagnetic, not -43.5`, String(geomag));
  check(Math.abs(geomag) > 43.53,
        'which is further from the equator magnetically than geographically - using the geographic '
        + 'figure quietly under-forecasts the whole country');
}

// ── night by night ─────────────────────────────────────────────────────────
console.log('\nScoring each night by its best moment');
{
  const timeline = F.buildForecastTimeline([], [stream()], {
    fromMs: NOW, toMs: NOW + 6 * DAY, stepMs: HOUR });
  const nights = A.nightlyOutlook(A.buildOutlook(timeline), LAT, LON);

  check(nights.length >= 4, `${nights.length} nights in a six day forecast`);
  check(nights.every(n => n.bestMs >= NOW), 'each night reports a moment inside the forecast');
  check(nights.every(n => n.strengthBest >= n.strengthLikely - 1e-9),
        'the best case is never worse than the likely case');

  // The point of doing it per night: the answer must be a NIGHT moment, not
  // whenever the oval happened to peak.
  let allDark = true;
  for (const night of nights) {
    const sky = (await load('utils/skyConditions.ts')).skyConditionsAt(night.bestMs, LAT, LON);
    if (sky.darkness === 'daylight') allDark = false;
  }
  check(allDark, 'and never nominates a moment in broad daylight');

  check(nights.every((n, i) => i === 0 || n.nightMs > nights[i - 1].nightMs),
        'nights come out in order');
  check(A.nightlyOutlook([], LAT, LON).length === 0, 'no outlook, no nights');
}

// ── refusing to grind ──────────────────────────────────────────────────────
console.log('\nRefusing silly requests');
{
  check(F.buildForecastTimeline([], [], { fromMs: NOW, toMs: NOW }).length === 0, 'an empty window is empty');
  check(F.buildForecastTimeline([], [], { fromMs: NOW + DAY, toMs: NOW }).length === 0, 'so is a backwards one');
  check(F.buildForecastTimeline([], [], { fromMs: NOW, toMs: NOW + 900 * DAY, stepMs: HOUR }).length === 0,
        'and an absurd span is refused rather than ground through');
  check(F.buildForecastTimeline([], [], { fromMs: NOW, toMs: NOW + DAY, stepMs: 0 }).length === 0,
        'a zero step too');
}

// ── the coronal hole strike zone is a LATITUDE one ───────────────────
console.log('\nA polar hole does not hit Earth, however well aimed in longitude');
{
  // The trap: both gates are called a strike zone, and a CME's is about
  // LONGITUDE. A hole over a pole can cross the middle of the disk, tick
  // every longitude box, and send its wind entirely over the top of us.
  // Polar holes are the Sun's normal state for most of the cycle, so getting
  // this wrong forecasts near-permanent aurora that never arrives.
  const equatorial = C.chEarthConnection(5, 0);
  const polar = C.chEarthConnection(72, 0);
  const mid = C.chEarthConnection(45, 0);

  check(equatorial.reachesEarth && equatorial.factor === 1, 'an equatorial hole is squarely aimed at us');
  check(!polar.reachesEarth && polar.factor === 0, 'a polar one does not reach us at all');
  check(/over the top of us/.test(polar.note), 'and says why rather than just scoring zero', polar.note);
  check(/equatorward extension/.test(polar.note),
        'and points at what WOULD be geoeffective, since that is the useful part');
  check(mid.factor > 0 && mid.factor < 1, `a mid-latitude hole glances (${mid.factor.toFixed(2)})`);

  // Southern holes behave the same as northern ones.
  check(C.chEarthConnection(-72, 0).factor === C.chEarthConnection(72, 0).factor,
        'the south pole is no different from the north');

  // B0 shifts which latitude is actually Earth-facing, by up to 7 degrees.
  const tilted = C.chEarthConnection(36, 7.2);
  const untilted = C.chEarthConnection(36, 0);
  check(tilted.factor > untilted.factor,
        'a hole is better connected when the Sun is tilted toward it', `${tilted.factor} vs ${untilted.factor}`);

  check(C.chEarthConnection(NaN, 0).reachesEarth === false, 'no latitude means no forecast rather than a guess');

  // And the timeline must actually honour it.
  const polarStream = { id: 'polar', centralMeridianMs: NOW, peakSpeedKms: 700,
                        widthDeg: 60, bySign: -1, earthConnection: 0 };
  const polarLine = F.buildForecastTimeline([], [polarStream], {
    fromMs: NOW, toMs: NOW + 8 * DAY, stepMs: HOUR });
  check(polarLine.every(p => p.disturbance === 'ambient'),
        'a disconnected hole contributes nothing to the timeline at all');
  check(polarLine.every(p => p.speedKms < 400), 'and the wind stays at background');

  const glancing = F.buildForecastTimeline([], [{ ...polarStream, earthConnection: 0.4 }], {
    fromMs: NOW, toMs: NOW + 8 * DAY, stepMs: HOUR });
  const full = F.buildForecastTimeline([], [{ ...polarStream, earthConnection: 1 }], {
    fromMs: NOW, toMs: NOW + 8 * DAY, stepMs: HOUR });
  const peakOf = (line) => Math.max(...line.map(p => p.speedKms));
  check(peakOf(glancing) < peakOf(full),
        `a glancing stream is weaker (${peakOf(glancing).toFixed(0)} vs ${peakOf(full).toFixed(0)})`);
  check(peakOf(glancing) > 400, 'but still something, since it is not a clean miss');
}

// ── not flattering the forecast ──────────────────────────────
console.log('\nNot flattering the forecast');
{
  // The oval eight degrees poleward is a faint glow low down, not a display.
  // A generous falloff here makes every quiet night look worth driving for,
  // which is the way to lose people's trust fastest.
  // The calibration that matters: a fast stream with no southward field is a
  // camera target, not a naked-eye display. Speed alone does not do it.
  check(A.strengthAtLatitude(-59, -43) === 0, 'sixteen degrees poleward scores nothing at all');
  check(S.visibilityOutlook(A.strengthAtLatitude(-55, -43), dark).tier === 'camera',
        'twelve degrees poleward is a long exposure, not a night out');
  check(S.visibilityOutlook(A.strengthAtLatitude(-50, -43), dark).tier !== 'eye',
        'and seven degrees poleward is still not naked eye');
  check(A.strengthAtLatitude(-43, -43) === 100, 'while overhead is still full marks');

  // Quiet conditions must not produce a viewable night by themselves.
  const quietNights = A.nightlyOutlook(
    A.buildOutlook(F.buildForecastTimeline([], [], { fromMs: NOW, toMs: NOW + 4 * DAY, stepMs: HOUR })),
    LAT, LON);
  check(quietNights.every(n => n.tier === 'none'),
        'a week of nothing happening forecasts nothing to see',
        JSON.stringify(quietNights.map(n => n.tier)));
  check(quietNights.every(n => n.strengthBest < 11),
        'not even on the optimistic reading', JSON.stringify(quietNights.map(n => n.strengthBest.toFixed(1))));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
