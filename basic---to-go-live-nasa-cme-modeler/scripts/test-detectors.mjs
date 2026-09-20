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
  ' checkVisibilityNotifications, checkOvernightWatch, geoToGmag };\n');
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

/** Which topics were queued since the last call, newest last. */
async function queuedTopics() {
  const out = [];
  for (const name of [...store.keys()].filter(k => k.startsWith('JOB_'))) {
    const job = JSON.parse(store.get(name));
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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
