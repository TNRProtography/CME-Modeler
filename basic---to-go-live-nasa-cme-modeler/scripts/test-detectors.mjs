#!/usr/bin/env node
// Replays realistic space weather through the detectors and asserts exactly
// which notifications come out.
//
//   npm run test:detectors
//
// Delivery tests prove a notification reaches everyone who wants it. They say
// nothing about whether it should have been sent at all, and that is the half
// where the September 2026 bugs lived: a shock loop that ran zero iterations, a
// `temp ?? 0` that turned every comparison into NaN, an unreachable DSLR tier,
// and a missing config key that threw into a swallowed catch. All four were
// silent - the worker reported a quiet sun through a real storm.
//
// So this drives the real detectors, tick by tick, the way the cron does, and
// checks the topics that actually get queued. A detector that stops firing
// fails here rather than in the sky.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'worker', 'push-notification-worker.js');

const dir = mkdtempSync(join(tmpdir(), 'detectors-'));
const copy = join(dir, 'w.mjs');
writeFileSync(copy, readFileSync(SRC, 'utf8') +
  '\nexport { checkSolarFlares, checkShockDetection, checkSubstormActivity,' +
  ' checkVisibilityNotifications, checkOvernightWatch, geoToGmag,' +
  ' snapshotSolarRegions, handleRegionsHistory };\n');
const W = await import(pathToFileURL(copy).href);

// ── harness ────────────────────────────────────────────────────────────────
const store = new Map();
const kv = {
  get: async (k, t) => { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
  put: async (k, v) => { store.set(k, v); },
  delete: async (k) => { store.delete(k); },
  list: async ({ prefix = '', cursor, limit = 1000 } = {}) => {
    const all = [...store.keys()].filter(n => n.startsWith(prefix)).sort();
    const start = cursor ? all.indexOf(cursor) + 1 : 0;
    const page = all.slice(start, start + limit);
    const done = start + limit >= all.length;
    return { keys: page.map(name => ({ name })), cursor: done ? undefined : page.at(-1), list_complete: done };
  },
};

// No SELF_URL, so nothing fans out - we only care which jobs were queued.
const env = { SUBSCRIPTIONS_KV: kv, TRIGGER_SECRET: 's' };
globalThis.fetch = async () => new Response('[]', { status: 200 });

/** Every payload any detector has produced during this run. */
const allPayloads = [];

/** Which topics were queued since the last call, newest last. */
async function queuedTopics() {
  const out = [];
  for (const name of [...store.keys()].filter(k => k.startsWith('JOB_'))) {
    const job = JSON.parse(store.get(name));
    if (job.payload) allPayloads.push({ topic: job.topic ?? job.kind, ...job.payload });
    out.push(job.topic ?? job.kind);
    store.delete(name);
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') {
      store.delete(`JOBSHARD_${name.slice(4)}_${ch}`);
    }
  }
  return out;
}

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

const CONFIG = { substorm: { cooldownMinutes: 30 } };

/** NOAA GOES X-ray feed shape. */
const xray = (fluxes) => {
  const now = Date.now();
  return fluxes.map((flux, i) => ({
    energy: '0.1-0.8nm', flux,
    time_tag: new Date(now - (fluxes.length - 1 - i) * 60000).toISOString(),
  }));
};

/** Solar wind series, one point a minute for the last hour. */
const wind = (f) => {
  const mag = [], plasma = [], now = Date.now();
  for (let i = 60; i >= 0; i--) {
    const ts = now - i * 60000, p = f(i);
    mag.push({ ts, bz: p.bz, bt: p.bt, by: p.by ?? 1 });
    plasma.push({ ts, speed: p.speed, density: p.den, temp: p.temp,
                  pressure: 1.6726e-6 * p.den * p.speed ** 2 });
  }
  return { mag, plasma };
};

// ── 1. an X-class flare, start to finish ───────────────────────────────────
// The intricate one: a state machine across rising, new peak, and decline,
// with cumulative thresholds. Every threshold the flare crosses should fire
// once and only once, and the peak should close it out.
console.log('\nAn X5 flare, minute by minute');
{
  store.clear();
  store.set('CONFIG_THRESHOLDS', JSON.stringify(CONFIG));
  const fired = [];

  // Quiet, then up through M1, M5, X1, X5, then back down below M1.
  const climb = [1e-6, 2e-6, 1.2e-5, 6e-5, 1.5e-4, 6e-4];
  for (const flux of climb) {
    await W.checkSolarFlares(env, xray([1e-6, 1e-6, flux]), () => {});
    fired.push(...await queuedTopics());
  }
  console.log(`    on the way up: ${fired.join(', ') || 'nothing'}`);
  check(same(fired, ['flare-M1', 'flare-M5', 'flare-X1', 'flare-X5']),
        'each threshold the flare crosses fires exactly once, in order',
        fired.join(', '));

  // Flux collapses and stays down long enough to confirm the peak.
  const decline = [];
  for (let i = 0; i < 6; i++) {
    await W.checkSolarFlares(env, xray([6e-4, 3e-4, 5e-7]), () => {});
    decline.push(...await queuedTopics());
  }
  console.log(`    at the peak: ${decline.join(', ') || 'nothing'}`);
  check(decline.includes('flare-peak') && decline.includes('flare-event'),
        'the peak closes the flare out with a summary');
  check(!decline.some(t => t.startsWith('flare-M') || t.startsWith('flare-X')),
        'no threshold fires a second time on the way down', decline.join(', '));
}

// ── 1b. the peak waits for two falling readings ────────────────────────────
// "Past the peak" used to mean a three-minute timer that started the moment
// flux stopped climbing and never looked at the flux again - so a flare that
// plateaued, or wobbled once and kept rising, was called peaked on the clock
// alone. It now has to actually fall, twice in a row, on the feed's own
// one-minute cadence.
console.log('\nConfirming a peak needs the flux to actually fall');
{
  /** Put the detector in mid-flare with a known peak, then feed it a tail. */
  const midFlare = (declineStartMsAgo = null) => {
    store.clear();
    store.set('CONFIG_THRESHOLDS', JSON.stringify(CONFIG));
    store.set('STATE_flare', JSON.stringify({
      status: 'active', peakFlux: 6e-4, peakTime: Date.now() - 5 * 60000,
      notifiedThresholds: ['flare-M1', 'flare-M5', 'flare-X1', 'flare-X5'],
      declineStart: declineStartMsAgo == null ? null : Date.now() - declineStartMsAgo,
      stateEnteredAt: Date.now() - 10 * 60000,
    }));
  };

  // One fall, then a rise. Not a peak - this is the wobble near the top.
  midFlare();
  await W.checkSolarFlares(env, xray([4.0e-4, 3.0e-4, 3.5e-4]), () => {});
  check((await queuedTopics()).length === 0,
        'a single fall followed by a rise is not a peak');

  // Flat. A plateau is not a decline, however long it lasts.
  midFlare();
  await W.checkSolarFlares(env, xray([3.0e-4, 3.0e-4, 3.0e-4]), () => {});
  check((await queuedTopics()).length === 0,
        'a plateau is not a decline');

  // Two consecutive falls. This is the peak.
  midFlare();
  await W.checkSolarFlares(env, xray([4.0e-4, 3.0e-4, 2.0e-4]), () => {});
  const fired = await queuedTopics();
  check(fired.includes('flare-peak'),
        'two falling readings in a row confirms the peak', fired.join(', ') || 'nothing');

  // Still both notifications, one of which the user can now switch off.
  check(fired.includes('flare-event'),
        'and the summary still goes out alongside it', fired.join(', '));

  // No time-based backstop: falling flux is the only thing that confirms a
  // peak, however long the flare sits there.
  midFlare(45 * 60 * 1000);
  await W.checkSolarFlares(env, xray([3.0e-4, 3.0e-4, 3.0e-4]), () => {});
  check((await queuedTopics()).length === 0,
        'time alone never confirms a peak, even 45 minutes of it');

  // The flare still has to end. Dropping below M1 closes it out and reports
  // the class it actually reached, so nothing is lost by having no backstop.
  midFlare(45 * 60 * 1000);
  await W.checkSolarFlares(env, xray([3.0e-4, 3.0e-4, 5.0e-6]), () => {});
  const ended = await queuedTopics();
  check(ended.includes('flare-peak') && ended.includes('flare-event'),
        'and dropping below M1 still closes the flare out',
        ended.join(', ') || 'nothing');
}

// ── 2. a quiet sun stays quiet ─────────────────────────────────────────────
console.log('\nA quiet day');
{
  store.clear();
  store.set('CONFIG_THRESHOLDS', JSON.stringify(CONFIG));
  await W.checkSolarFlares(env, xray([8e-7, 9e-7, 7e-7]), () => {});
  const { mag, plasma } = wind(() => ({ bz: -1.5, bt: 4, speed: 380, den: 4, temp: 80000 }));
  await W.checkShockDetection(env, mag, plasma, true, () => {});
  // Properly configured, unlike the case below.
  await W.checkSubstormActivity(env, CONFIG.substorm,
    { current: { score: 8, bay_onset_flag: false, summary: 'quiet' }, metrics: { solar_wind: {} } }, null, () => {});
  const sent = await queuedTopics();
  check(sent.length === 0, 'nothing fires on a quiet day', sent.join(', '));
}

// ── 3. a CME arrival ───────────────────────────────────────────────────────
// Speed, density, temperature and field all jump together. This is the shape
// the `temp ?? 0` bug silently stopped detecting.
console.log('\nA CME hits L1');
{
  store.clear();
  store.set('CONFIG_THRESHOLDS', JSON.stringify(CONFIG));
  const shock = i => i < 20
    ? { bz: -22, bt: 38, speed: 780, den: 24, temp: 620000 }
    : { bz: -2,  bt: 5,  speed: 420, den: 5,  temp: 90000 };

  const { mag, plasma } = wind(shock);
  await W.checkShockDetection(env, mag, plasma, true, () => {});
  const withTemp = await queuedTopics();
  check(withTemp.includes('shock-ff'), 'a fast forward shock fires', withTemp.join(', '));

  // The same storm with the temperature channel missing, which happens often
  // in the real feed and used to suppress every shock type.
  store.delete('STATE_shock');
  store.delete('COOLDOWN_shock-ff');
  const noTemp = wind(i => ({ ...shock(i), temp: null }));
  await W.checkShockDetection(env, noTemp.mag, noTemp.plasma, false, () => {});
  const without = await queuedTopics();
  check(without.includes('shock-ff'),
        'the same shock still fires with no temperature in the feed', without.join(', '));
}

// ── 4. visibility reaches real places ──────────────────────────────────────
// The DSLR tier was unreachable for months because the boundary maths never
// produced a distance in its band. Assert against actual NZ latitudes.
console.log('\nVisibility over New Zealand');
{
  store.clear();
  store.set('CONFIG_THRESHOLDS', JSON.stringify(CONFIG));

  const places = {
    Invercargill: [-46.41, 168.35],
    Christchurch: [-43.53, 172.64],
    Wellington:   [-41.29, 174.78],
    Auckland:     [-36.85, 174.76],
  };
  for (const [name, [lat, lon]] of Object.entries(places)) {
    const gmag = W.geoToGmag(lat, lon);
    check(isFinite(gmag) && gmag < 0 && gmag > -60,
          `${name} has a sane geomagnetic latitude (${gmag.toFixed(1)})`);
  }
  // Further south must always be closer to the oval than further north.
  const order = Object.entries(places).map(([n, [la, lo]]) => [n, W.geoToGmag(la, lo)]);
  check(order[0][1] < order[3][1],
        'Invercargill sits closer to the pole than Auckland',
        order.map(([n, g]) => `${n} ${g.toFixed(1)}`).join(', '));
}

// ── 5. a missing config key must not silence everything ────────────────────
// CONFIG_THRESHOLDS.substorm went missing once and the resulting throw was
// swallowed, so the detector reported nothing wrong while sending nothing.
// The caller reads the key from KV and passes it down, so a missing key
// arrives here as undefined - which is exactly what this feeds it.
console.log('\nA half-configured worker');
{
  store.clear();
  store.set('CONFIG_THRESHOLDS', JSON.stringify({}));
  const notes = [];
  await W.checkSubstormActivity(env, undefined,
    { current: { score: 78, bay_onset_flag: false, summary: 'elevated' }, metrics: { solar_wind: {} } },
    null, (n, s, d) => notes.push(`${n}:${s}`));
  const sent = await queuedTopics();
  check(sent.includes('substorm-forecast'),
        'a substorm still fires with the config key missing', notes.join(', '));
}

// ── daily region snapshots ────────────────────────────────────────────────
console.log('\nSunspot region history');
{
  store.clear();
  const feed = (area, spots, cls) => ([
    { region: '4534', area, number_spots: spots, mag_class: cls, spot_class: 'Dkc', location: 'N11W08' },
    { region: '4532', area: 10, number_spots: 4, mag_class: 'beta', location: 'S06W54' },
  ]);

  let served = feed(30, 8, 'beta');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url.includes('solar_regions')) return new Response(JSON.stringify(served), { status: 200 });
    return new Response('[]', { status: 200 });
  };

  const notes = [];
  const note = (n, st, d) => notes.push(`${n}:${st}:${d ?? ''}`);

  await W.snapshotSolarRegions(env, note);
  const today = new Date().toISOString().slice(0, 10);
  const stored = JSON.parse(store.get(`REGIONS_${today}`) ?? 'null');
  check(!!stored && stored.regions.length === 2, 'a cron run stores today\'s regions', notes.join(' | '));
  check(stored?.regions[0].area === 30 && stored?.regions[0].spotCount === 8,
        'with the fields the growth read needs', JSON.stringify(stored?.regions[0]));

  // A second run moments later must not spend another KV write.
  notes.length = 0;
  served = feed(999, 99, 'beta-gamma-delta');
  await W.snapshotSolarRegions(env, note);
  const again = JSON.parse(store.get(`REGIONS_${today}`) ?? 'null');
  check(again?.regions[0].area === 30,
        'a second run within the gap does not rewrite it',
        'hundreds of KV writes a day for a value that barely changes');
  check(notes.some((n) => n.startsWith('regions:quiet')), 'and says why it skipped', notes.join(' | '));

  // Once the gap has passed it refreshes.
  const aged = JSON.parse(store.get(`REGIONS_${today}`));
  aged.at = Date.now() - 4 * 60 * 60 * 1000;
  store.set(`REGIONS_${today}`, JSON.stringify(aged));
  await W.snapshotSolarRegions(env, () => {});
  check(JSON.parse(store.get(`REGIONS_${today}`)).regions[0].area === 999,
        'but does refresh once the gap has passed');

  // Backfill a few days and read the history out.
  for (let d = 1; d <= 3; d++) {
    const day = new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
    store.set(`REGIONS_${day}`, JSON.stringify({
      day, at: Date.now(),
      regions: [{ region: '4534', area: 30 * (4 - d), spotCount: 4 - d, magneticClass: 'beta' }],
    }));
  }
  const res = await W.handleRegionsHistory(
    new Request('https://w.invalid/regions-history?days=7'), env);
  const body = await res.json();
  check(body.daysWithData === 4, 'the history endpoint returns every day it has', String(body.daysWithData));
  const h = body.history['4534'];
  check(Array.isArray(h) && h.length === 4, 'with one entry per day for a region', String(h?.length));
  check(h[0].atMs < h[h.length - 1].atMs, 'oldest first, so a chart can plot it straight');
  check(h.every((e) => typeof e.atMs === 'number' && Number.isFinite(e.atMs)),
        'and every timestamp is real');

  const few = await (await W.handleRegionsHistory(
    new Request('https://w.invalid/regions-history?days=1'), env)).json();
  check(few.days === 2, 'asking for fewer than two days is raised to two', String(few.days));
  const many = await (await W.handleRegionsHistory(
    new Request('https://w.invalid/regions-history?days=999'), env)).json();
  check(many.days === 30, 'and asking for more than is kept is capped', String(many.days));

  globalThis.fetch = realFetch;
}

// ── no emojis in anything that reaches a phone ─────────────────────────────
console.log('\nNotifications carry no emojis');
{
  // Pictographs only. Arrows, the middle dot, degrees and superscripts are
  // typography and belong in "Speed: 400 -> 600 km/s" and "p/cm3".
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

  // What the detectors actually produced above, rather than what the source
  // looks like - a title assembled at runtime is where one would hide.
  const dirty = allPayloads.filter(p => EMOJI.test(`${p.title ?? ''} ${p.body ?? ''}`));
  check(dirty.length === 0,
        `every payload these tests produced is emoji-free (${allPayloads.length} checked)`,
        dirty.map(p => `${p.topic}: ${p.title}`).join('\n        '));
  check(allPayloads.length > 0, 'and there were payloads to check');

  // The backstop, because the tests above do not exercise every branch - the
  // visibility tiers, the overnight outlook and the test-push builder all have
  // their own titles. The worker's only user-visible output is notifications,
  // so no emoji anywhere in it is a clean invariant to hold.
  const src = readFileSync(SRC, 'utf8');
  const stray = [...src.matchAll(new RegExp(EMOJI.source, 'gu'))];
  check(stray.length === 0,
        'and none is left anywhere in the worker source',
        stray.map(m => `${JSON.stringify(m[0])} at index ${m.index}`).slice(0, 8).join(', '));

  // Also as an escape, which is how one survived a previous sweep.
  check(!/\\uD8[0-9A-F]{2}\\uD[C-F][0-9A-F]{2}/i.test(src),
        'nor written as an escaped surrogate pair',
        'a \\uD83C\\uDF0C in a template literal is an emoji a character scan misses');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
