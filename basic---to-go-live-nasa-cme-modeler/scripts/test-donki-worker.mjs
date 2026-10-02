#!/usr/bin/env node
// The NASA DONKI worker riding out a NASA outage.
//
//   npm run test:donki-worker
//
// api.nasa.gov goes down for days at a time. The worker must ask CCMC's own
// DONKI service first (at its new address), keep serving what it last had
// (for a week), and
// say whether NASA is answering so the app can show it is offline.

import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; say(`  PASS  ${label}`); }
  else { fail++; say(`  FAIL  ${label} ${detail}`); }
};

const W = (await import(pathToFileURL(join(root, 'worker/nasa-donki-api-worker.js')).href)).default;
const kv = new Map(), ttl = new Map();
const env = {
  NASA_API_KEY: 'test',
  NASA_DONKI_CACHE: {
    get: async (k) => kv.get(k) ?? null,
    put: async (k, v, o) => { kv.set(k, v); ttl.set(k, o?.expirationTtl ?? null); },
  },
};
const world = { nasa: true, ccmc: true, legacy: true };
const calls = [];
console.log = () => {}; console.warn = () => {}; console.error = () => {};
const say = (...a) => process.stdout.write(a.join(' ') + '\n');
globalThis.fetch = async (url) => {
  const u = String(url);
  calls.push(u);
  const isNasa = u.includes('api.nasa.gov'), isCcmc = u.startsWith('https://ccmc.gsfc.nasa.gov/DONKI-API/get/');
  const isLegacy = u.includes('kauai.ccmc.gsfc.nasa.gov');
  if ((isNasa && !world.nasa) || (isCcmc && !world.ccmc) || (isLegacy && !world.legacy)) return new Response('down', { status: 503 });
  const kind = (u.match(/(?:WS|DONKI-API)\/get\/([A-Za-z]+)/) || u.match(/DONKI\/([A-Za-z]+)/))[1].toUpperCase();
  const from = isCcmc ? 'ccmc' : isLegacy ? 'legacy' : 'nasa';
  const item = kind === 'CME'
    ? { activityID: `CME-${from}`, startTime: '2026-10-01T10:00Z' }
    : { eventTime: '2026-10-01T10:00Z' };
  return new Response(JSON.stringify([item]));
};
const get = async (path) => {
  const res = await W.fetch(new Request(`https://x${path}`), env, {});
  return { res, body: res.headers.get('Content-Type')?.includes('json') ? await res.json() : await res.text() };
};

say('\nCCMC answering (its address since 30 September 2026)');
await W.scheduled({}, env, {});
let { res, body } = await get('/CME');
check(res.status === 200 && body[0].activityID === 'CME-ccmc', 'CMEs come from CCMC first');
check(calls.some((u) => u.startsWith('https://ccmc.gsfc.nasa.gov/DONKI-API/get/CME?') && !u.includes('api_key')),
      'at its new DONKI-API address, without the key', calls.find((u) => u.includes('DONKI-API')));
check(calls.some((u) => u.includes('/DONKI-API/get/notifications?') && u.includes('type=all')), 'notifications keep their filter');
check(calls.some((u) => u.includes('/DONKI-API/get/IPS?') && u.includes('location=Earth')), 'and shocks theirs');
check(ttl.get('nasa_donki_data') === 7 * 86400, `kept for a week, not a day (${ttl.get('nasa_donki_data')} s)`);
check(!!res.headers.get('X-Donki-Updated'), 'and say when they were fetched');
let status = (await get('/status')).body;
check(status.online === true && status.via === 'ccmc', 'status: online, via CCMC', JSON.stringify(status));

say('\nCCMC down, NASA\'s gateway up');
world.ccmc = false; calls.length = 0;
await W.scheduled({}, env, {});
({ body } = await get('/CME'));
check(body[0].activityID === 'CME-nasa', 'api.nasa.gov is used instead');
status = (await get('/status')).body;
check(status.online === true && status.via === 'api.nasa.gov', 'status: still online, via api.nasa.gov', JSON.stringify(status));

say('\nOnly the old CCMC address answering');
world.nasa = false;
await W.scheduled({}, env, {});
({ body } = await get('/CME'));
check(body[0].activityID === 'CME-legacy', 'the old address is the last resort');

say('\nEverything down');
world.legacy = false;
await W.scheduled({}, env, {});
({ res, body } = await get('/CME'));
check(res.status === 200 && body[0].activityID === 'CME-legacy', 'the last good CMEs are still served');
// Forty minutes later, nothing has come back.
const realNow = Date.now;
Date.now = () => realNow() + 40 * 60000;
status = (await get('/status')).body;
Date.now = realNow;
check(status.online === false && status.age_minutes >= 40 && !!status.last_error, 'status: offline, with how old the data is', JSON.stringify(status));
check(!!status.cached_at, 'and when the cached data was fetched');

say(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
