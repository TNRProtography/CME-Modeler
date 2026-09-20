#!/usr/bin/env node
// Runs the push notification worker's detectors against synthetic solar wind.
// It exercises the real file, not a copy of the logic, by appending named
// exports to a temporary copy so the internals can be imported.
//
//   npm run test:worker
//
// Cases that must fire, and cases that must stay quiet. The four September
// 2026 bugs all showed up here first.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'worker', 'push-notification-worker.js');

const dir = mkdtempSync(join(tmpdir(), 'stapush-'));
const copy = join(dir, 'w.mjs');
writeFileSync(copy, readFileSync(SRC, 'utf8') +
  '\nexport { checkShockDetection, checkSubstormActivity, pickVisibilityTier, moonAdjustedTriggers };\n');
const W = await import(pathToFileURL(copy).href);

const store = new Map();
const kv = {
  get: async (k, t) => { const v = store.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
  put: async (k, v) => { store.set(k, v); },
  delete: async (k) => { store.delete(k); },
  list: async () => ({ keys: [...store.keys()].map(name => ({ name })), cursor: undefined, list_complete: true }),
};
globalThis.fetch = async () => new Response('[]', { status: 200 });
const env = { SUBSCRIPTIONS_KV: kv, TRIGGER_SECRET: 's', SELF_URL: 'https://x.invalid' };

const mk = (f) => {
  const mag = [], plasma = [], now = Date.now();
  for (let i = 60; i >= 0; i--) {
    const ts = now - i * 60000; const p = f(i);
    mag.push({ ts, bz: p.bz, bt: p.bt, by: 1 });
    plasma.push({ ts, speed: p.speed, density: p.den, temp: p.temp,
                  pressure: 1.6726e-6 * p.den * p.speed ** 2 });
  }
  return { mag, plasma };
};

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`); }
};

console.log('\nShock detection');
const shockCases = [
  ['quiet wind stays quiet',            i => ({ bz: -2, bt: 5, speed: 400, den: 5, temp: 90000 }), false],
  ['slow drift stays quiet',            i => ({ bz: -3, bt: 6, speed: 400 + i * 0.4, den: 5, temp: 95000 }), false],
  ['gentle rise stays quiet',           i => ({ bz: -3, bt: i < 20 ? 7 : 6, speed: i < 20 ? 428 : 420, den: i < 20 ? 5.4 : 5, temp: i < 20 ? 98000 : 95000 }), false],
  ['real fast forward shock fires',     i => ({ bz: i < 20 ? -15 : -2, bt: i < 20 ? 24 : 6, speed: i < 20 ? 660 : 420, den: i < 20 ? 17 : 5, temp: i < 20 ? 340000 : 90000 }), true],
  ['fires with no temperature in feed', i => ({ bz: i < 20 ? -15 : -2, bt: i < 20 ? 24 : 6, speed: i < 20 ? 660 : 420, den: i < 20 ? 17 : 5, temp: null }), true],
  ['weak bump, no temperature, quiet',  i => ({ bz: i < 20 ? -5 : -2, bt: i < 20 ? 8 : 6, speed: i < 20 ? 438 : 420, den: i < 20 ? 6.2 : 5, temp: null }), false],
];
for (const [label, f, shouldFire] of shockCases) {
  store.clear();
  const notes = []; const note = (n, s) => notes.push(s);
  const { mag, plasma } = mk(f);
  await W.checkShockDetection(env, mag, plasma, plasma.some(p => p.temp != null), note);
  check(notes.includes('fired') === shouldFire, label, notes.join(','));
}

console.log('\nVisibility tiers');
const trig = W.moonAdjustedTriggers(0, false);
const seen = new Set();
for (let d = 6; d >= -25; d -= 0.5) { const t = W.pickVisibilityTier(d, d + 12, trig); if (t) seen.add(t); }
for (const tier of ['dslr', 'phone', 'naked']) check(seen.has(tier), `${tier} is reachable`);

console.log('\nSubstorm');
store.clear();
{
  const notes = []; const note = (n, s) => notes.push(s);
  await W.checkSubstormActivity(env, undefined,
    { current: { score: 72, bay_onset_flag: false, summary: 's' }, metrics: { solar_wind: {} } }, null, note);
  check(notes.includes('fired'), 'survives a missing CONFIG_THRESHOLDS.substorm key', notes.join(','));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
