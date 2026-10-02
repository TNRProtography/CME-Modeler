#!/usr/bin/env node
// The page-view counter worker.
//
//   npm run test:page-views
//
// Starts at 84,382, counts every open of the app, keeps each
// visitor's own number, and carries over what a device counted before.

import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

import { DatabaseSync } from 'node:sqlite';
process.removeAllListeners('warning');

const mod = await import(pathToFileURL(join(root, 'worker/page-views-worker.js')).href);
const W = mod.default;
// A Durable Object's SQLite, played by node's: the same exec(query, ...args)
// and toArray() the object uses.
const db = new DatabaseSync(':memory:');
const state = { storage: { sql: { exec: (q, ...a) => {
  const st = db.prepare(q);
  const rows = /^\s*(SELECT|WITH)/i.test(q) ? st.all(...a) : (st.run(...a), []);
  return { toArray: () => rows };
} } } };
const object = new mod.PageViews(state);
const env = { PAGE_VIEWS: {
  idFromName: (n) => n,
  get: () => ({ fetch: (url, init) => object.fetch(new Request(url, init)) }),
} };
const call = async (method, path, body, origin = 'https://spottheaurora.co.nz') => {
  const res = await W.fetch(new Request(`https://x.test${path}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }), env);
  return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
};
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

console.log('A fresh counter');
let r = await call('GET', '/page-views');
check(r.json.lifetime === 84382, 'starts at 84,382', JSON.stringify(r.json));
check(r.json.daily === 0 && r.json.yours === 0 && r.json.visitors === 0, 'with nothing today, no visitors and nothing yours');

console.log('Counting');
r = await call('POST', '/page-views', { id: A });
check(r.json.lifetime === 84383 && r.json.daily === 1 && r.json.weekly === 1 && r.json.yours === 1, 'a first view counts everywhere', JSON.stringify(r.json));
r = await call('POST', '/page-views', { id: A });
check(r.json.lifetime === 84383 && r.json.yours === 1, 'a double send within seconds does not count twice');
r = await call('POST', '/page-views', { id: B });
check(r.json.lifetime === 84384 && r.json.yours === 1, 'another visitor adds to the total with their own number');
r = await call('GET', `/page-views?id=${A}`);
check(r.json.yours === 1 && r.json.lifetime === 84384, 'a GET reads without counting');

check(r.json.visitors === 2 && r.json.yearly === 2, 'and counts visitors and the year');

console.log('Two views at once');
const crowd = await Promise.all(Array.from({ length: 50 }, (_, i) =>
  call('POST', '/page-views', { id: `crowd-visitor-${String(i).padStart(4, '0')}` })));
r = await call('GET', '/page-views');
check(r.json.lifetime === 84384 + 50 && r.json.visitors === 52, 'fifty at once lose none', JSON.stringify(r.json));

console.log('Coming back');
const realNow = Date.now;
Date.now = () => realNow() + 6000;
r = await call('POST', '/page-views', { id: A });
check(r.json.yours === 2 && r.json.lifetime === 84385 + 50, 'the same visitor opening the app again counts again', JSON.stringify(r.json));
Date.now = realNow;

console.log('Carrying over a device count');
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
r = await call('POST', '/page-views', { id: C, seed: 57 });
check(r.json.yours === 58, 'a new visitor starts from what their device counted, plus this view', JSON.stringify(r.json));
r = await call('POST', '/page-views', { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', seed: 1e12 });
check(r.json.yours <= 100001, 'but not from an absurd number');

console.log('Bad input and access');
r = await call('POST', '/page-views', { id: 'short' });
check(r.status === 400, 'a malformed visitor id is refused');
r = await call('POST', '/page-views', {});
check(r.status === 400, 'so is no id at all');
r = await call('DELETE', '/page-views');
check(r.status === 405, 'other methods are refused');
r = await call('GET', '/elsewhere');
check(r.status === 404, 'other paths are not found');
r = await call('GET', '/page-views', null, 'https://spottheaurora.co.nz');
check(r.headers.get('Access-Control-Allow-Origin') === 'https://spottheaurora.co.nz', 'the live site may read it');
r = await call('GET', '/page-views', null, 'https://evil.example');
check(!r.headers.get('Access-Control-Allow-Origin'), 'another site may not');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
