#!/usr/bin/env node
// End-to-end check of the delivery outbox, using the nightly overnight-watch
// job as the worked example.
//
//   npm run test:outbox
//
// This is the test that would have caught the old fan-out: it seeds several
// thousand subscribers, runs a real sunset through checkOvernightWatch, and
// insists that everyone who asked for the nightly gets it exactly once - then
// throws away a quarter of the shard dispatches and checks that a single cron
// sweep still reaches all of them.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'worker', 'push-notification-worker.js');
const dir = mkdtempSync(join(tmpdir(), 'nightly-'));
const copy = join(dir, 'w.mjs');
writeFileSync(copy, readFileSync(SRC, 'utf8') +
  '\nexport { checkOvernightWatch, runShard, sweepJobs, jobProgress, maybeRunCensus, runCensusShard };\n');
const W = await import(pathToFileURL(copy).href);

// ---- fake KV with real prefix/cursor semantics -------------------------
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

// ---- real VAPID keys so the crypto path actually runs ------------------
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const b64u = (b) => Buffer.from(b).toString('base64url');
const VAPID_PUBLIC_KEY  = b64u(await webcrypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);

const env = {
  SUBSCRIPTIONS_KV: kv,
  TRIGGER_SECRET: 's',
  SELF_URL: 'https://push.invalid',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: jwk.d,
  VAPID_SUBJECT: 'mailto:test@example.com',
};

// ---- push endpoint + self-dispatch stubs -------------------------------
const delivered = [];
let dropDispatches = 0;
// The real worker holds dispatches open with ctx.waitUntil; here we collect
// them so the test can wait for the fan-out to finish.
const inflight = [];
const settle = async () => { while (inflight.length) await inflight.splice(0).reduce((p, q) => p.then(() => q), Promise.resolve()); };
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input);
  if (url.includes('/run-shard')) {
    if (dropDispatches > 0) { dropDispatches--; return new Response('{}', { status: 200 }); }
    const { jobId, shard } = JSON.parse(init.body);
    const p = W.runShard(env, jobId, shard);
    inflight.push(p);
    await p;
    return new Response('{}', { status: 200 });
  }
  if (url.includes('push.example')) { delivered.push(url); return new Response('', { status: 201 }); }
  return new Response('[]', { status: 200 });
};

// ---- seed subscribers --------------------------------------------------
const sha = async (s) => b64u(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const p256 = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const P256DH = b64u(await webcrypto.subtle.exportKey('raw', p256.publicKey));

const N = 4000;
let wantNightly = 0;
const modes = ['eye', 'phone', 'camera'];
for (let i = 0; i < N; i++) {
  const endpoint = `https://push.example/${i}`;
  const key = await sha(endpoint);
  const on = i % 3 !== 0;                 // two thirds want the nightly
  const mode = modes[i % 3];
  if (on) wantNightly++;
  store.set(key, JSON.stringify({
    subscription: { endpoint, keys: { p256dh: P256DH, auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) } },
    preferences: { 'overnight-watch': on, 'admin-broadcast': true },
    overnight_mode: mode,
    location: { latitude: -41.3, longitude: 174.8 },
    lastSeenAt: Date.now(),
  }));
}
console.log(`seeded ${N} subscribers, ${wantNightly} want the nightly`);

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' - ' + detail : ''}`); }
};

// ---- 1. nightly fires for everyone who wants it ------------------------
console.log('\n1. nightly outlook at sunset');
const sunsetMs = Date.now() - 60 * 1000;   // one minute after sunset
const forecast = {
  currentForecast: {
    sun: { set: sunsetMs },
    spotTheAuroraForecast: 95,             // above every mode threshold
    moon: { illumination: 10 },
  },
};
const substorm = { current: { score: 60, risk_trend: 'rising' },
                   metrics: { solar_wind: { bz: -12, bt: 20, speed: 600, hemispheric_power: 60, southward_minutes_30m: 25 } } };
const mag = [{ ts: Date.now(), bz: -12, bt: 20 }];
const plasma = [{ ts: Date.now(), speed: 600, density: 8 }];

const notes = [];
await W.checkOvernightWatch(env, forecast, substorm, mag, plasma, (n, s, d) => notes.push(`${n}:${s}:${d ?? ''}`));
console.log('   ', notes.join(' | '));
const jobId = [...store.keys()].filter(k => k.startsWith('JOB_')).map(k => k.slice(4))[0];
await settle();
let prog = await W.jobProgress(env, jobId);
console.log(`    shards ${prog.shards.done}/${prog.shards.total}, sent ${prog.sent}, failed ${prog.failed}`);
const unique = new Set(delivered);
console.log(`    unique recipients: ${unique.size} of ${wantNightly} wanted, duplicates ${delivered.length - unique.size}`);
check(prog.complete && unique.size === wantNightly && delivered.length === unique.size,
      'every nightly subscriber got it exactly once');

// ---- 2. the once-a-night marker stops a second run ---------------------
console.log('\n2. a second sunset run the same night');
delivered.length = 0;
await W.checkOvernightWatch(env, forecast, substorm, mag, plasma, () => {});
const jobs2 = [...store.keys()].filter(k => k.startsWith('JOB_')).map(k => k.slice(4));
const job2 = jobs2.find(j => j !== jobId);
await settle();
const prog2 = await W.jobProgress(env, job2);
console.log(`    shards ${prog2.shards.done}/${prog2.shards.total}, sent ${prog2.sent}, deliveries ${delivered.length}`);
check(prog2.complete && delivered.length === 0,
      'nobody is notified twice in one night', `${delivered.length} deliveries`);

// ---- 3. a lost dispatch is recovered by the sweep ----------------------
console.log('\n3. nightly with 25 dispatches silently lost');
for (const k of [...store.keys()]) {
  if (k.startsWith('JOB_') || k.startsWith('JOBSHARD_') || k.startsWith('COOLDOWN_')) store.delete(k);
  else { const v = JSON.parse(store.get(k)); delete v.overnightWatchSentDate; store.set(k, JSON.stringify(v)); }
}
delivered.length = 0;
dropDispatches = 25;
await W.checkOvernightWatch(env, forecast, substorm, mag, plasma, () => {});
const jobId3 = [...store.keys()].filter(k => k.startsWith('JOB_')).map(k => k.slice(4))[0];
await settle();
let p3 = await W.jobProgress(env, jobId3);
console.log(`    after the lost dispatches: ${p3.shards.done}/${p3.shards.total} shards, ${new Set(delivered).size} recipients`);
const before = new Set(delivered).size;
await W.sweepJobs(env, () => {});
await settle();
p3 = await W.jobProgress(env, jobId3);
console.log(`    after 1 cron sweep: ${p3.shards.done}/${p3.shards.total} shards, ${new Set(delivered).size} recipients`);
check(p3.complete && new Set(delivered).size === wantNightly && before < wantNightly,
      'the sweep recovered everyone the lost dispatches would have missed');

// ---- 4. mode thresholds still gate ------------------------------------
console.log('\n4. a mediocre night only reaches the camera crowd');
for (const k of [...store.keys()]) {
  if (k.startsWith('JOB_') || k.startsWith('JOBSHARD_') || k.startsWith('COOLDOWN_')) store.delete(k);
  else { const v = JSON.parse(store.get(k)); delete v.overnightWatchSentDate; store.set(k, JSON.stringify(v)); }
}
delivered.length = 0;
const weak = JSON.parse(JSON.stringify(forecast));
weak.currentForecast.sun.set = sunsetMs;
weak.currentForecast.spotTheAuroraForecast = 32;
await W.checkOvernightWatch(env, weak, substorm, mag, plasma, () => {});
await settle();
const camWanted = [...store.values()].filter(v => { const s = JSON.parse(v); return s.preferences?.['overnight-watch'] && s.overnight_mode === 'camera'; }).length;
console.log(`    delivered ${new Set(delivered).size}, camera-mode subscribers wanting it ${camWanted}`);
check(new Set(delivered).size === camWanted, 'only the lower-threshold modes were woken');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
