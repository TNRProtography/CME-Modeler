#!/usr/bin/env node
// Two front ends, one worker.
//
//   npm run test:sites
//
// spottheaurora.co.nz and cme-modeler.pages.dev both talk to the same push
// worker. A push subscription belongs to the origin that created it, so the
// same person on both sites is two independent subscriptions - and until the
// worker recorded which was which, a test push aimed at the dev site went to
// every live subscriber, and /stats could not say how many of its numbers were
// real users versus a preview tab left open.
//
// This drives the real handlers: it subscribes devices from each origin, runs
// a scoped send and an unscoped one, and reads the census back.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'worker', 'push-notification-worker.js');
const dir = mkdtempSync(join(tmpdir(), 'sites-'));
const copy = join(dir, 'w.mjs');
writeFileSync(copy, readFileSync(SRC, 'utf8') +
  '\nexport { classifySite, siteOf, enqueueDelivery, runShard, maybeRunCensus,' +
  ' runCensusShard, handleSaveSubscription, handleTriggerTestPush, SHARD_CHARS };\n');
const W = await import(pathToFileURL(copy).href);

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

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

const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const b64u = (b) => Buffer.from(b).toString('base64url');
const VAPID_PUBLIC_KEY = b64u(await webcrypto.subtle.exportKey('raw', pair.publicKey));
const jwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const p256 = await webcrypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const P256DH = b64u(await webcrypto.subtle.exportKey('raw', p256.publicKey));

const env = {
  SUBSCRIPTIONS_KV: kv, TRIGGER_SECRET: 's', SELF_URL: 'https://push.invalid',
  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:t@example.com',
};

const delivered = [];
const inflight = [];
const settle = async () => { while (inflight.length) await inflight.splice(0).reduce((p, q) => p.then(() => q), Promise.resolve()); };
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input);
  if (url.includes('/run-shard')) {
    const { jobId, shard } = JSON.parse(init.body);
    const p = W.runShard(env, jobId, shard);
    inflight.push(p); await p;
    return new Response('{}', { status: 200 });
  }
  if (url.includes('/run-census-shard')) {
    const { censusId, shard } = JSON.parse(init.body);
    const p = W.runCensusShard(env, censusId, shard);
    inflight.push(p); await p;
    return new Response('{}', { status: 200 });
  }
  if (url.includes('push.example')) { delivered.push(url); return new Response('', { status: 201 }); }
  return new Response('[]', { status: 200 });
};

/** Subscribe a device the way the app does, from a given origin. */
async function subscribe(n, origin) {
  const req = new Request('https://push.invalid/save-subscription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify({
      subscription: { endpoint: `https://push.example/${origin.replace(/\W/g, '')}/${n}`,
                      keys: { p256dh: P256DH, auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) } },
      preferences: { 'flare-X1': true },
      timezone: 'Pacific/Auckland', latitude: -43.5, longitude: 172.6,
    }),
  });
  return W.handleSaveSubscription(req, env);
}

const PROD = 'https://www.spottheaurora.co.nz';
const DEV  = 'https://cme-modeler.pages.dev';

// ── 1. the origins are recognised ──────────────────────────────────────────
console.log('\nEach front end is recognised');
{
  const cases = [
    ['https://spottheaurora.co.nz',                 'prod'],
    ['https://www.spottheaurora.co.nz',             'prod'],
    ['https://cme-modeler.pages.dev',               'dev'],
    // Pages gives every preview deploy its own hostname under the project.
    ['https://a1b2c3d4.cme-modeler.pages.dev',      'dev'],
    ['https://claude-happy.cme-modeler.pages.dev',  'dev'],
    ['http://localhost:5173',                       'dev'],
    ['https://spottheaurora.co.nz.evil.example',    'other'],
    ['https://someone-elses-site.example',          'other'],
    [null,                                          'unknown'],
  ];
  const wrong = cases.filter(([o, want]) => W.classifySite(o) !== want)
                     .map(([o, want]) => `${o} -> ${W.classifySite(o)}, want ${want}`);
  check(wrong.length === 0, 'every origin classifies correctly', wrong.join('\n        '));

  // The apex trick above matters: a lookalike domain must not read as prod.
  check(W.classifySite('https://spottheaurora.co.nz.evil.example') !== 'prod',
        'a lookalike hostname is not mistaken for the live site');
}

// ── 2. subscribing records where it came from ──────────────────────────────
console.log('\nA subscription remembers its site');
{
  for (let i = 0; i < 20; i++) await subscribe(i, PROD);
  for (let i = 0; i < 5; i++)  await subscribe(i, DEV);
  // Someone who subscribed before any of this existed.
  store.set('legacyrecord', JSON.stringify({
    subscription: { endpoint: 'https://push.example/legacy/1', keys: { p256dh: P256DH, auth: 'aaaa' } },
    preferences: { 'flare-X1': true },
  }));

  const rows = [...store.values()]
    .map(v => { try { return JSON.parse(v); } catch { return null; } })
    .filter(r => r?.subscription?.endpoint);
  const prod = rows.filter(r => r.site === 'prod');
  const dev  = rows.filter(r => r.site === 'dev');
  check(prod.length === 20 && dev.length === 5,
        'each device is filed under the site it subscribed from',
        `prod ${prod.length}, dev ${dev.length}`);
  check(prod[0]?.origin === PROD && dev[0]?.origin === DEV,
        'and the literal origin is stored, not just the category',
        `${prod[0]?.origin} / ${dev[0]?.origin}`);
}

// ── 3. a scoped send reaches only that site ────────────────────────────────
console.log('\nA test aimed at one site stays there');
{
  delivered.length = 0;
  await W.enqueueDelivery(env, {
    kind: 'topic', topic: 'flare-X1', site: 'dev',
    payload: { title: 'dev only', body: 'x', tag: 'flare-X1', data: { url: '/' } },
  });
  await settle();
  const toDev  = delivered.filter(u => u.includes('cmemodelerpagesdev')).length;
  const toProd = delivered.filter(u => u.includes('spottheaurora')).length;
  check(toDev === 5, 'every dev subscriber gets it', `${toDev} of 5`);
  check(toProd === 0,
        'and not one live subscriber is touched',
        `${toProd} live phones would have lit up`);
}

// ── 4. a real alert still reaches everyone ─────────────────────────────────
console.log('\nA real alert goes to both sites');
{
  // The important half of the feature: scoping is opt-in. Someone using the
  // dev site is still someone waiting for the aurora, and a solar flare is not
  // a test.
  delivered.length = 0;
  await W.enqueueDelivery(env, {
    kind: 'topic', topic: 'flare-X1',
    payload: { title: 'X1 flare', body: 'x', tag: 'flare-X1', data: { url: '/' } },
  });
  await settle();
  const toDev  = delivered.filter(u => u.includes('cmemodelerpagesdev')).length;
  const toProd = delivered.filter(u => u.includes('spottheaurora')).length;
  const legacy = delivered.filter(u => u.includes('legacy')).length;
  check(toProd === 20 && toDev === 5, 'both front ends receive it',
        `prod ${toProd}/20, dev ${toDev}/5`);
  check(legacy === 1,
        'including someone who subscribed before origins were recorded',
        'an unscoped send must never exclude a record for lacking an origin');
}

// ── 5. a test push defaults to the caller's own site ───────────────────────
console.log('\nA test push defaults to where it was triggered from');
{
  delivered.length = 0;
  const req = new Request('https://push.invalid/trigger-test-push?secret=s&type=test',
                          { headers: { Origin: DEV } });
  const res = await W.handleTriggerTestPush(req, env);
  const body = await res.json();
  check(body.site === 'dev',
        'triggering it with the dev site open scopes it to dev',
        JSON.stringify(body));

  const all = new Request('https://push.invalid/trigger-test-push?secret=s&type=test&site=all',
                          { headers: { Origin: DEV } });
  const allBody = await (await W.handleTriggerTestPush(all, env)).json();
  check(allBody.site === 'all', 'and ?site=all still means everyone', JSON.stringify(allBody));
}

// ── 6. the census says which URL has which subscribers ─────────────────────
console.log('\n/stats breaks the count down by URL');
{
  store.delete('STATS');
  for (const ch of W.SHARD_CHARS) store.delete(`STATSSHARD_${ch}`);
  await W.maybeRunCensus(env, () => {});
  await settle();
  const stats = await kv.get('STATS', 'json');
  check(!!stats, 'the census completed');
  if (stats) {
    console.log(`    byOrigin: ${JSON.stringify(stats.byOrigin)}`);
    check(stats.byOrigin?.[PROD] === 20 && stats.byOrigin?.[DEV] === 5,
          'each site is reported against its own URL',
          JSON.stringify(stats.byOrigin));
    check(stats.bySite?.prod === 20 && stats.bySite?.dev === 5,
          'and grouped as prod and dev', JSON.stringify(stats.bySite));
    check(Object.values(stats.byOrigin ?? {}).reduce((a, b) => a + b, 0) === stats.subscribers,
          'the per-URL counts add up to the total',
          `${JSON.stringify(stats.byOrigin)} vs ${stats.subscribers}`);
    check(stats.bySite?.unknown === 1,
          'a record from before origins were tracked is counted, not hidden',
          JSON.stringify(stats.bySite));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
