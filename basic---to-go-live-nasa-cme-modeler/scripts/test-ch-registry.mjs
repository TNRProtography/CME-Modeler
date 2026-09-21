#!/usr/bin/env node
// Giving a coronal hole a name that sticks.
//
//   npm run test:ch-registry
//
// The detector renumbers from zero every frame, so "CH1" means nothing across
// time. A hole somebody has been watching all morning must not become CH2 in
// the afternoon because a new one appeared east of it, and must not be
// renamed because one faint frame missed it. That is what this is for, and
// the failure mode it prevents - a number that wanders - is the kind people
// notice immediately and trust nothing after.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'chreg-'));

async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
await load('utils/solarEphemeris.ts');
const D = await load('utils/solarDisk.ts');
const R = await load('utils/chRegistry.ts');
const T = await load('utils/chTracking.ts');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const HOUR = 3600000, DAY = 86400000;
const T0 = Date.UTC(2026, 8, 21, 12);
const RATE = D.SOLAR_SYNODIC_DEG_PER_DAY;

const track = (key, lat, lon, lastSeenHoursAgo = 0, firstSeenDaysAgo = 1) => ({
  key,
  latest: { lat, lon },
  lastSeenMs: T0 - lastSeenHoursAgo * HOUR,
  firstSeenMs: T0 - firstSeenDaysAgo * DAY,
});

// ── numbers that stick ─────────────────────────────────────────────────────
console.log('\nA hole keeps its number');
{
  const first = R.assignChNumbers([track('a', 0, 0), track('b', 40, -30)], R.emptyRegistry(), T0);
  check(first.numbers.size === 2, 'two holes get two numbers');
  check(first.numbers.get('a') === R.FIRST_CH_NUMBER,
        `numbering starts at ${R.FIRST_CH_NUMBER} rather than 1`, String(first.numbers.get('a')));
  check(first.numbers.get('b') === R.FIRST_CH_NUMBER + 1, 'and counts up from there');

  // Six hours later both have rotated. The registry has to carry its own
  // remembered positions forward too, or it hands the numbers to whatever is
  // now sitting where they used to be.
  const later = T0 + 6 * HOUR;
  const turned = R.assignChNumbers([
    { key: 'a2', latest: { lat: 0, lon: 6 * RATE / 24 }, lastSeenMs: later, firstSeenMs: T0 - DAY },
    { key: 'b2', latest: { lat: 40, lon: -30 + 6 * RATE / 24 }, lastSeenMs: later, firstSeenMs: T0 - DAY },
  ], first.registry, later);
  check(turned.numbers.get('a2') === first.numbers.get('a'),
        'six hours and a new track key later, the same hole has the same number',
        `${turned.numbers.get('a2')} vs ${first.numbers.get('a')}`);
  check(turned.numbers.get('b2') === first.numbers.get('b'), 'and so does the other one');
  check(turned.registry.nextNumber === first.registry.nextNumber,
        'with no new numbers issued');

  // A genuinely new hole gets the next one, not a recycled one.
  const withNew = R.assignChNumbers([
    { key: 'a3', latest: { lat: 0, lon: 0 }, lastSeenMs: T0, firstSeenMs: T0 },
    { key: 'new', latest: { lat: -55, lon: 60 }, lastSeenMs: T0, firstSeenMs: T0 },
  ], first.registry, T0);
  check(withNew.numbers.get('a3') === first.numbers.get('a'), 'the old hole keeps its number');
  check(withNew.numbers.get('new') === R.FIRST_CH_NUMBER + 2,
        'and a new one takes the next free number', String(withNew.numbers.get('new')));
}

// ── the grace period ───────────────────────────────────────────────────────
console.log('\nA number survives a hole going missing for a while');
{
  const base = R.assignChNumbers([track('a', 0, 0)], R.emptyRegistry(), T0);
  const number = base.numbers.get('a');

  // Missing for six hours, then back. The detector drops holes in faint
  // frames; renaming them on return is the flicker this exists to stop.
  const sixLater = T0 + 6 * HOUR;
  const back = R.assignChNumbers([
    { key: 'a-again', latest: { lat: 0, lon: 6 * RATE / 24 }, lastSeenMs: sixLater, firstSeenMs: T0 },
  ], base.registry, sixLater);
  check(back.numbers.get('a-again') === number,
        'gone for six hours and back again, it is still the same hole');

  // Gone beyond the grace period: a new number, because by then it really has
  // closed or gone round the back, and reusing the name would be a lie.
  const muchLater = T0 + 20 * HOUR;
  const stale = R.assignChNumbers([
    { key: 'a-much-later', latest: { lat: 0, lon: 20 * RATE / 24 }, lastSeenMs: muchLater, firstSeenMs: muchLater },
  ], base.registry, muchLater);
  check(stale.numbers.get('a-much-later') !== number,
        'gone for twenty hours, it gets a fresh number', String(stale.numbers.get('a-much-later')));
  check(stale.registry.entries.every(e => e.number !== number),
        'and the entry that timed out is dropped rather than lingering',
        JSON.stringify(stale.registry.entries.map(e => e.number)));
  check(stale.registry.nextNumber > base.registry.nextNumber,
        'with the counter moved on, so the retired number is never reissued');
}

// ── not handing a name to a stranger ───────────────────────────────────────
console.log('\nNot handing a name to whatever is passing');
{
  const base = R.assignChNumbers([track('a', 0, 0)], R.emptyRegistry(), T0);

  // A day later, a DIFFERENT hole sits at longitude 0 - where the first one
  // was when it was written down. Without carrying the remembered hole
  // forward, it would inherit the name.
  const dayLater = T0 + DAY;
  const impostor = R.assignChNumbers([
    { key: 'other', latest: { lat: 0, lon: 0 }, lastSeenMs: dayLater, firstSeenMs: dayLater },
  ], base.registry, dayLater);
  check(impostor.numbers.get('other') !== base.numbers.get('a'),
        'a hole that did not rotate with the Sun is not the one we remembered',
        String(impostor.numbers.get('other')));

  // Two tracks that both fit one remembered hole: only one can have it.
  const crowded = R.assignChNumbers([
    { key: 'x', latest: { lat: 0, lon: 2 }, lastSeenMs: T0, firstSeenMs: T0 },
    { key: 'y', latest: { lat: 4, lon: -2 }, lastSeenMs: T0, firstSeenMs: T0 },
  ], base.registry, T0);
  const assigned = [...crowded.numbers.values()];
  check(new Set(assigned).size === 2, 'two tracks never share a number', String(assigned));
  check(assigned.includes(base.numbers.get('a')), 'one of them inherits the remembered name');
}

// ── surviving storage ──────────────────────────────────────────────────────
console.log('\nSurviving a reload');
{
  const base = R.assignChNumbers([track('a', 0, 0), track('b', 40, -30)], R.emptyRegistry(), T0);
  const round = R.parseRegistry(JSON.stringify(base.registry));
  check(round.nextNumber === base.registry.nextNumber, 'the counter survives being written out');
  check(round.entries.length === base.registry.entries.length, 'and so do the entries');

  const after = R.assignChNumbers([track('a-new', 0, 0)], round, T0);
  check(after.numbers.get('a-new') === base.numbers.get('a'),
        'so a hole keeps its number across a reload');

  check(R.parseRegistry(null).entries.length === 0, 'no stored registry starts empty');
  check(R.parseRegistry('not json').nextNumber === R.FIRST_CH_NUMBER, 'and so does a corrupt one');
  check(R.parseRegistry('{"entries":[{"number":"x"}]}').entries.length === 0,
        'junk entries are dropped rather than numbered');

  // A counter behind its own entries must never reissue a live number.
  const behind = R.parseRegistry(JSON.stringify({
    nextNumber: R.FIRST_CH_NUMBER,
    entries: [{ number: R.FIRST_CH_NUMBER + 5, lat: 0, lon: 0, lastSeenMs: T0, firstSeenMs: T0 }],
  }));
  check(behind.nextNumber === R.FIRST_CH_NUMBER + 6,
        'a stale counter is pulled up past every number already issued', String(behind.nextNumber));
}

// ── the grace period in tracking ───────────────────────────────────────────
console.log('\nA hole missed in one frame stays on screen');
{
  const hole = (id, lat, lon) => ({ id, lat, lon, widthDeg: 25, darkness: 0.6 });
  const perHour = RATE / 24;
  const frame = (hoursAgo, holes) => ({ atMs: T0 - hoursAgo * HOUR, holes });

  // Seen, missed, seen: exactly what a faint frame does.
  const blinked = T.buildChTracks([
    frame(4, [hole('a', 0, -4 * perHour), hole('b', 40, -30)]),
    frame(2, [hole('a', 0, -2 * perHour)]),
    frame(0, [hole('a', 0, 0), hole('b', 40, -30 + 4 * perHour)]),
  ]);
  check(blinked.length === 2, 'a hole that blinked out and back is one track', String(blinked.length));
  check(blinked.every(t => t.live), 'and both are live');

  // Missing from the newest frame, but only just.
  const justMissed = T.buildChTracks([
    frame(2, [hole('a', 0, -2 * perHour), hole('b', 40, -30)]),
    frame(0, [hole('a', 0, 0)]),
  ]);
  const missing = justMissed.find(t => !t.present);
  check(missing != null, 'a hole absent from the latest frame is not present');
  check(missing.live, 'but is still live, so it stays drawn instead of flickering out');

  // Long gone is genuinely gone.
  const longGone = T.buildChTracks([
    frame(20, [hole('a', 0, -20 * perHour), hole('b', 40, -30)]),
    frame(0, [hole('a', 0, 0)]),
  ]);
  const dead = longGone.find(t => !t.present);
  check(dead != null && !dead.live, 'after twelve hours it is no longer live');
  check(longGone[0].live, 'while the one still being seen is');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
