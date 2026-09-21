#!/usr/bin/env node
// What a sunspot region is about to do, and what it did.
//
//   npm run test:region-dynamics
//
// The disk is a clock: a region appears at the east limb, takes a fortnight to
// cross, and is only aimed at Earth for part of that. Everything checked here
// is arithmetic on that rotation, plus a read on whether the region is still
// building. The numbers are presented to people deciding whether to stay up, so
// the ones that could mislead - "it stays aimed at us for another two days",
// "40% chance of an X-class" - are the ones worth pinning down.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'dynamics-'));

async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
await load('utils/solarEphemeris.ts');
await load('utils/solarDisk.ts');
await load('utils/cmeAnalysis.ts');
const R = await load('utils/regionDynamics.ts');
const D = await load('utils/solarDisk.ts');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const DAY = 86400000;
const T0 = Date.UTC(2026, 8, 21, 12);
const RATE = D.SOLAR_SYNODIC_DEG_PER_DAY;

// ── crossing the disk ──────────────────────────────────────────────────────
console.log('\nWhere a region is in its trip across the disk');
{
  const atCM = R.regionTiming(0, T0, T0);
  check(Math.abs(atCM.daysToCentralMeridian) < 1e-9, 'a region on the meridian is there now');
  check(Math.abs(atCM.daysToWestLimb - 90 / RATE) < 1e-9,
        `and reaches the west limb in ${(90 / RATE).toFixed(1)} days`, String(atCM.daysToWestLimb));
  check(Math.abs(atCM.daysSinceEastLimb - 90 / RATE) < 1e-9, 'having come over the east limb the same time ago');

  // A region measured a day ago has moved since.
  const stale = R.regionTiming(0, T0 - DAY, T0);
  check(Math.abs(stale.longitude - RATE) < 1e-9,
        'a day-old measurement is rotated forward before anything else', String(stale.longitude));

  const east = R.regionTiming(-70, T0, T0);
  check(east.daysToCentralMeridian > 0 && east.daysToWestLimb > east.daysToCentralMeridian,
        'an eastern region reaches the meridian before the limb');

  const west = R.regionTiming(80, T0, T0);
  check(west.daysToCentralMeridian < 0, 'a western region has already passed the meridian');
  check(west.daysToWestLimb > 0 && west.daysToWestLimb < 1,
        'and is less than a day from rotating out of sight', String(west.daysToWestLimb));
}

// ── the strike zone ────────────────────────────────────────────────────────
console.log('\nThe Earth strike zone');
{
  // Same +-45 the CME alert uses, so the two cannot disagree about whether
  // something was aimed at us.
  check(R.regionTiming(0, T0, T0).inStrikeZone, 'dead centre is in the zone');
  check(R.regionTiming(-44, T0, T0).inStrikeZone, 'and 44 degrees east');
  check(R.regionTiming(44, T0, T0).inStrikeZone, 'and 44 degrees west');
  check(!R.regionTiming(-60, T0, T0).inStrikeZone, 'but not 60 east');
  check(!R.regionTiming(60, T0, T0).inStrikeZone, 'nor 60 west');

  const coming = R.regionTiming(-70, T0, T0);
  check(coming.daysToStrikeZone > 0, 'an eastern region has a countdown to entering');
  check(Math.abs(coming.daysToStrikeZone - 25 / RATE) < 1e-9,
        'which is exactly the rotation to reach 45 east', String(coming.daysToStrikeZone));
  check(!coming.strikeZonePassed, 'and has not passed through yet');

  const inside = R.regionTiming(30, T0, T0);
  check(inside.daysToStrikeZone === 0, 'a region already inside has no countdown');
  check(Math.abs(inside.daysLeftInStrikeZone - 15 / RATE) < 1e-9,
        'and a countdown to leaving', String(inside.daysLeftInStrikeZone));

  const gone = R.regionTiming(70, T0, T0);
  check(gone.strikeZonePassed && gone.daysLeftInStrikeZone === 0,
        'and a region past 45 west is done, with no time left');
}

// ── how much chance it has to do something ─────────────────────────────────
console.log('\nThe chance it fires something at us before turning away');
{
  const inside = R.regionTiming(0, T0, T0);           // 45 deg to run, ~3.4 days
  const risk = R.earthDirectedRisk(inside, 25, 5, 'BETA-GAMMA-DELTA');
  const days = inside.daysLeftInStrikeZone;

  // 1 - (1-p)^days, from NOAA's own daily figure.
  const expectedM = (1 - Math.pow(0.75, days)) * 100;
  check(Math.abs(risk.mChance - Math.round(expectedM * 10) / 10) < 0.05,
        `25% a day over ${days.toFixed(1)} days compounds to ${risk.mChance}%`,
        `expected ${expectedM.toFixed(1)}`);
  check(risk.mChance > 25, 'which is more than the daily figure, as more days means more chances');
  check(risk.xChance < risk.mChance, 'and X is rarer than M');
  check(risk.complexField, 'a delta region is flagged as magnetically complex');
  check(/compounded from NOAA/.test(risk.note),
        'and the note says where the number came from rather than implying a model');

  // Less time left means less chance, for the same daily probability.
  const later = R.earthDirectedRisk(R.regionTiming(40, T0, T0), 25, 5, 'BETA');
  check(later.mChance < risk.mChance,
        'the same region nearly out of the zone has less chance left',
        `${later.mChance} vs ${risk.mChance}`);

  // Outside the zone there is no number to give.
  const early = R.earthDirectedRisk(R.regionTiming(-70, T0, T0), 50, 20, 'BETA');
  check(early.mChance === null && early.level === 'none',
        'a region not yet in the zone gets no chance figure');
  check(/Enters the strike zone in/.test(early.label), 'just a countdown', early.label);

  const past = R.earthDirectedRisk(R.regionTiming(70, T0, T0), 50, 20, 'BETA-DELTA');
  check(past.mChance === null && /past the strike zone/.test(past.label),
        'and one that has rotated past is reported as past', past.label);

  // No published probabilities must not become a fake zero.
  const unknown = R.earthDirectedRisk(inside, null, null, 'ALPHA');
  check(unknown.mChance === null && /not published/.test(unknown.note),
        'a region with no NOAA probabilities says so rather than showing 0%');

  const quiet = R.earthDirectedRisk(inside, 1, 0, 'ALPHA');
  check(quiet.level === 'none' && /quiet/.test(quiet.label),
        'a simple region with a 1% daily chance reads as quiet', quiet.label);
}

// ── the track it draws ─────────────────────────────────────────────────────
console.log('\nThe path it traces across the disk');
{
  const track = R.rotationTrack(-14, -64, T0, T0 - 3 * DAY, T0 + 3 * DAY, 12);
  check(track.length === 13, 'six days at twelve hour steps is thirteen points', String(track.length));
  check(track[0].longitude < track[track.length - 1].longitude,
        'longitude only ever increases, because the Sun turns one way');
  check(track.every((p) => p.latitude === -14), 'latitude does not change as it rotates');

  // Far enough back and it was behind the east limb.
  const long = R.rotationTrack(0, 80, T0, T0 - 10 * DAY, T0 + 2 * DAY, 24);
  check(long.some((p) => !p.visible), 'a long enough track runs off the disk');
  check(long.filter((p) => p.visible).length > 0, 'while still having a visible part');
  const firstVisible = long.findIndex((p) => p.visible);
  const lastVisible = long.length - 1 - [...long].reverse().findIndex((p) => p.visible);
  check(long.slice(firstVisible, lastVisible + 1).every((p) => p.visible),
        'and the visible part is one unbroken run, not scattered');

  check(R.rotationTrack(0, 0, T0, T0, T0 - DAY, 6).length === 0, 'a backwards window gives nothing');
  check(R.rotationTrack(0, 0, T0, T0, T0 + DAY, 0).length === 0, 'and a zero step does not hang');
}

// ── growth ─────────────────────────────────────────────────────────────────
console.log('\nWhether it is still building');
{
  const day = (n, area, spots, cls) => ({ atMs: T0 - (n * DAY), area, spotCount: spots, magneticClass: cls });

  check(R.growthSummary([]).phase === 'unknown', 'no history says so');
  check(R.growthSummary([day(0, 100, 5)]).phase === 'unknown', 'and one snapshot is not history');
  check(/Not enough history/.test(R.growthSummary([]).label), 'with a label that admits it');

  const fast = R.growthSummary([day(2, 40, 2, 'BETA'), day(1, 90, 5, 'BETA'), day(0, 180, 9, 'BETA-GAMMA')]);
  check(fast.phase === 'growing fast', `a region that quadrupled in two days is growing fast`, fast.phase);
  check(fast.areaChange === 140 && Math.abs(fast.areaPerDay - 70) < 1e-9,
        'with the change and the daily rate reported', `${fast.areaChange}, ${fast.areaPerDay}`);
  check(fast.classChanged, 'and a magnetic class change is flagged');

  const steady = R.growthSummary([day(3, 200, 10, 'BETA'), day(0, 205, 10, 'BETA')]);
  check(steady.phase === 'steady', 'a big region that barely moved is steady', steady.phase);
  check(!steady.classChanged, 'with no class change');

  const decaying = R.growthSummary([day(2, 300, 12, 'BETA'), day(0, 120, 4, 'ALPHA')]);
  check(decaying.phase === 'decaying', 'one that halved is decaying', decaying.phase);
  check(decaying.spotChange === -8, 'and the spot count fell', String(decaying.spotChange));

  // The same absolute gain means very different things at different sizes.
  const smallGain = R.growthSummary([day(1, 10, 1), day(0, 40, 3)]);
  const bigGain = R.growthSummary([day(1, 400, 20), day(0, 430, 21)]);
  check(smallGain.phase === 'growing fast' && bigGain.phase === 'steady',
        '30 MSH on a tiny region is fast growth; on a huge one it is noise',
        `${smallGain.phase} vs ${bigGain.phase}`);

  // Missing fields must not read as a collapse to zero.
  const gappy = R.growthSummary([day(2, null, null), day(0, 150, 7)]);
  check(gappy.areaChange === null && gappy.phase === 'unknown',
        'a snapshot with no area is not treated as an area of zero');

  // Order should not matter; the worker may hand them back either way.
  const forwards = R.growthSummary([day(2, 40, 2), day(1, 90, 5), day(0, 180, 9)]);
  const backwards = R.growthSummary([day(0, 180, 9), day(2, 40, 2), day(1, 90, 5)]);
  check(forwards.phase === backwards.phase && forwards.areaChange === backwards.areaChange,
        'snapshots are sorted, so the order they arrive in does not matter');
}

// ── which third of the disk ──────────────────────────────────────
console.log('\nWhich third of the disk a flare went off on');
{
  check(R.diskZoneFor(0).zone === 'earth strike zone', 'dead centre is the strike zone');
  check(R.diskZoneFor(44).zone === 'earth strike zone', 'and so is just inside the western edge');
  check(R.diskZoneFor(-44).zone === 'earth strike zone', 'and the eastern one');
  check(R.diskZoneFor(46).zone === 'west limb', 'just outside it to the west is the west limb');
  check(R.diskZoneFor(-46).zone === 'east limb', 'and to the east, the east limb');
  check(R.diskZoneFor(89).zone === 'west limb', 'right at the western edge of the disk too');

  // The same 45 degrees the CME alert uses, so a flare "in the zone" and a
  // CME "Earth-directed" can never mean different stretches of disk.
  const edge = 45;
  check(R.diskZoneFor(edge).zone === 'earth strike zone' && R.diskZoneFor(edge + 0.1).zone === 'west limb',
        `the boundary sits exactly at ${edge} degrees, shared with the CME alert`);

  check(R.diskZoneFor(null) === null, 'a flare with no location gets no zone rather than a guess');
  check(R.diskZoneFor(undefined) === null, 'nor does a missing one');
  check(R.diskZoneFor(NaN) === null, 'nor an unparseable one');

  check(/Parker/.test(R.diskZoneFor(70).note), 'a western flare is described as the well-connected one');
  check(/turning toward Earth/.test(R.diskZoneFor(-70).note), 'and an eastern one as still to come');
  check(R.diskZoneFor(10).label === 'Earth strike zone', 'each zone has a badge');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
