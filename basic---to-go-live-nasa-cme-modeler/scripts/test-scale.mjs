#!/usr/bin/env node
// The real thing: 80,000 subscribers, a hostile push service, lost dispatches.
//
//   npm run test:scale        (about half a minute)
//
// Kept out of `test:all` because of how long it takes, but this is the one
// that answers the actual question - does an alert reach everybody who asked
// for it, exactly once, when things are going wrong. Run it before any change
// to the outbox.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'worker', 'push-notification-worker.js');
const dir = mkdtempSync(join(tmpdir(), 'scale-'));
const copy = join(dir, 'w.mjs');
writeFileSync(copy, readFileSync(SRC, 'utf8') +
  '\nexport { enqueueDelivery, runShard, sweepJobs, jobProgress, SHARD_CHARS, DISPATCH_GRACE_MS };\n');
const W = await import(pathToFileURL(copy).href);

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
const b64u = b => Buffer.from(b).toString('base64url');
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify']);
const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const p256 = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const P256DH = b64u(await webcrypto.subtle.exportKey('raw', p256.publicKey));
const env = {
  SUBSCRIPTIONS_KV: kv, TRIGGER_SECRET: 's', SELF_URL: 'https://push.invalid',
  VAPID_PUBLIC_KEY: b64u(await webcrypto.subtle.exportKey('raw', pair.publicKey)),
  VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:t@example.com',
};

const delivered = [];
let dropDispatches = 0, chaos = 0;
const inflight = [];
const settle = async () => { while (inflight.length) await inflight.splice(0).reduce((p,q)=>p.then(()=>q), Promise.resolve()); };
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input);
  if (url.includes('/run-shard')) {
    if (dropDispatches > 0) { dropDispatches--; return new Response('{}', { status: 200 }); }
    const { jobId, shard } = JSON.parse(init.body);
    const p = W.runShard(env, jobId, shard); inflight.push(p); await p;
    return new Response('{}', { status: 200 });
  }
  if (url.includes('push.example')) {
    if (chaos > 0 && Math.random() < 0.05) { chaos--; return new Response(null, { status: 503 }); }
    delivered.push(url);
    return new Response('', { status: 201 });
  }
  return new Response('[]', { status: 200 });
};

const sha = async s => b64u(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const N = 80000;
let want = 0;
console.log(`seeding ${N} subscribers...`);
for (let i = 0; i < N; i++) {
  const endpoint = `https://push.example/${i}`;
  const on = i % 5 !== 0;
  if (on) want++;
  store.set(await sha(endpoint), JSON.stringify({
    subscription: { endpoint, keys: { p256dh: P256DH, auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) } },
    preferences: { 'flare-X1': on }, lastSeenAt: Date.now(),
  }));
}
console.log(`${want} of them want flare-X1\n`);

const ageJob = id => { for (const k of [...store.keys()]) {
  if (!k.startsWith(`JOBSHARD_${id}_`)) continue;
  const v = JSON.parse(store.get(k)); if (v.state === 'pending') { v.nextAttemptAt = 0; store.set(k, JSON.stringify(v)); }
} };

const t0 = Date.now();
dropDispatches = 15;          // some dispatches vanish
chaos = 400;                  // and the push service has a bad few minutes
const jobId = await W.enqueueDelivery(env, {
  kind: 'topic', topic: 'flare-X1',
  payload: { title: 'X1 flare', body: 'A major flare has occurred.', tag: 'flare-X1', data: { url: '/' } },
});
await settle();

let sweeps = 0, prog = await W.jobProgress(env, jobId);
while (!prog.complete && sweeps < 25) {
  ageJob(jobId);
  await W.sweepJobs(env, () => {});
  await settle();
  prog = await W.jobProgress(env, jobId);
  sweeps++;
}

const unique = new Set(delivered);
console.log(`shards ${prog.shards.done}/${prog.shards.total} done after ${sweeps} sweep(s)`);
console.log(`accepted ${prog.sent}, failed ${prog.failed}, pruned ${prog.pruned}`);
console.log(`unique recipients: ${unique.size} of ${want} who wanted it`);
console.log(`duplicates: ${delivered.length - unique.size}`);
console.log(`took ${((Date.now()-t0)/1000).toFixed(1)}s\n`);

const ok = prog.complete && unique.size === want && delivered.length === unique.size;
console.log(ok ? 'PASS - everyone who wanted it got it exactly once'
               : 'FAIL - see the numbers above');
process.exit(ok ? 0 : 1);
