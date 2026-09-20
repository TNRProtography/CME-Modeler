#!/usr/bin/env node
// Proves the service worker updates rather than getting stuck.
//
//   npm run test:sw
//
// The failure this guards against does not look like a failure. An old sw.js
// keeps running, keeps answering push events, and keeps serving whatever it
// cached - so the app on the device is months behind the deploy and nothing
// anywhere reports a problem. It is invisible until somebody says a feature
// they can see in the repo is not on their phone.
//
// So this does two things. It runs sw.js for real - install, activate, message
// - in a fake worker scope, and asserts the behaviour that makes an old version
// impossible to keep: it stands aside immediately, it takes over the pages that
// are already open, and it deletes any cache a previous version left. Then it
// checks the two things outside the file that have to hold for any of that to
// be reached: the no-cache header on /sw.js, and an app that keeps asking.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const SW = join(APP, 'public', 'sw.js');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

const src = readFileSync(SW, 'utf8');

// ── a fake worker scope ────────────────────────────────────────────────────
/**
 * Load sw.js into a scope we control, so its lifecycle can be driven the way a
 * browser drives it and the side effects can be observed.
 */
function loadWorker({ existingCaches = [], openClients = 1 } = {}) {
  const listeners = new Map();
  const log = { skipWaiting: 0, claimed: 0, deletedCaches: [], posted: [] };

  const clients = {
    claim: async () => { log.claimed++; },
    matchAll: async () => Array.from({ length: openClients }, (_, i) => ({
      id: `client-${i}`,
      url: 'https://example.test/',
      focus() {},
      postMessage: (m) => log.posted.push(m),
    })),
    openWindow: async () => {},
  };

  const cacheNames = [...existingCaches];
  const caches = {
    keys: async () => [...cacheNames],
    delete: async (n) => {
      const i = cacheNames.indexOf(n);
      if (i === -1) return false;
      cacheNames.splice(i, 1);
      log.deletedCaches.push(n);
      return true;
    },
  };

  const self = {
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    skipWaiting: () => { log.skipWaiting++; },
    clients,
    location: { origin: 'https://example.test' },
    registration: { showNotification: async () => {} },
  };

  const quiet = { log() {}, warn() {}, error() {}, debug() {} };
  // eslint-disable-next-line no-new-func
  const run = new Function('self', 'clients', 'caches', 'indexedDB', 'console', src);
  run(self, clients, caches, { open: () => { throw new Error('no idb in this harness'); } }, quiet);

  /** Dispatch an event and await whatever it passed to waitUntil. */
  const dispatch = async (type, event = {}) => {
    const waits = [];
    const e = { ...event, waitUntil: (p) => waits.push(p) };
    for (const fn of listeners.get(type) ?? []) await fn(e);
    await Promise.all(waits);
    return e;
  };

  return { dispatch, log, cacheNames, has: (t) => listeners.has(t) };
}

console.log('\nA new version takes over immediately');
{
  const w = loadWorker();
  await w.dispatch('install');
  check(w.log.skipWaiting === 1,
        'install calls skipWaiting, so a new version never sits behind an open tab',
        `skipWaiting called ${w.log.skipWaiting} times`);

  await w.dispatch('activate');
  check(w.log.claimed === 1,
        'activate claims the clients, so pages already open get the new version too',
        `claim called ${w.log.claimed} times`);
}

console.log('\nAn old version cannot leave anything behind');
{
  // The shape of the original problem: a previous cache-first worker left a
  // precache full of a build from months ago.
  const stale = ['sta-static-v1', 'sta-runtime', 'workbox-precache-v2'];
  const w = loadWorker({ existingCaches: stale });
  await w.dispatch('install');
  await w.dispatch('activate');

  check(w.log.deletedCaches.length === stale.length,
        'activate deletes every cache a previous version left',
        `deleted ${w.log.deletedCaches.join(', ') || 'nothing'} of ${stale.join(', ')}`);
  check(w.cacheNames.length === 0, 'and nothing survives the sweep', w.cacheNames.join(', '));

  // Nothing here writes a cache, and nothing may: a fetch handler is what turns
  // a cache into a served response, and that is the whole mechanism by which a
  // device can run an old build.
  check(!w.has('fetch'),
        'the worker registers no fetch handler, so it can never serve a stale page');
  check(!/caches\.open|cache\.put|cache\.addAll/.test(src),
        'and it writes nothing to Cache Storage');
}

console.log('\nThe running version can be identified and pushed');
{
  const w = loadWorker({ openClients: 3 });
  await w.dispatch('install');
  await w.dispatch('activate');
  check(w.log.posted.length === 3 && w.log.posted.every(m => m.type === 'SW_ACTIVATED' && m.version),
        'every open page is told which version just took control',
        JSON.stringify(w.log.posted));

  const version = w.log.posted[0]?.version;
  const declared = src.match(/@version\s+([\d.]+)/)?.[1];
  check(version === declared,
        'the version it reports matches the one in the file header',
        `reports ${version}, header says ${declared}`);

  // A page asking over a MessagePort, which is how the debug panel asks.
  const replies = [];
  await w.dispatch('message', {
    data: { type: 'GET_VERSION' },
    ports: [{ postMessage: (m) => replies.push(m) }],
  });
  check(replies.length === 1 && replies[0].version === version,
        'it answers GET_VERSION over a port', JSON.stringify(replies));

  // And a page that finds a worker stuck in `waiting` can shove it through,
  // even though install already calls skipWaiting.
  const w2 = loadWorker();
  await w2.dispatch('message', { data: { type: 'SKIP_WAITING' } });
  check(w2.log.skipWaiting === 1,
        'a waiting worker can be pushed through by the page', `${w2.log.skipWaiting}`);
}

console.log('\nThe browser is allowed to notice a new version');
{
  // Every guarantee above is worthless if the device is handed a cached copy of
  // sw.js. This header is the thing that makes an update reachable at all.
  const headers = readFileSync(join(APP, 'public', '_headers'), 'utf8');
  const block = headers.match(/^\/sw\.js\s*\n((?:\s{2}.*\n)+)/m);
  check(!!block, '/sw.js has a rule in _headers');
  check(!!block && /no-cache|max-age=0/.test(block[1]),
        '/sw.js is served no-cache, so an update is not hidden behind a CDN copy',
        block?.[1]?.trim());

  // The app shell has to revalidate too - a cached index.html points at the old
  // asset hashes however fresh the worker is.
  check(/^\/\s*\n\s+Cache-Control: no-cache/m.test(headers),
        'the HTML entry point revalidates on every visit');
}

console.log('\nThe app keeps asking');
{
  // A browser only re-checks /sw.js when a page in scope navigates. An
  // installed PWA left open for days never navigates, so without this the
  // session's worker is frozen for as long as the session lasts.
  const reg = join(APP, 'utils', 'serviceWorker.ts');
  check(existsSync(reg), 'the registration lives in one place');
  const app = readFileSync(reg, 'utf8');

  check(/navigator\.serviceWorker\.register\('\/sw\.js'/.test(app),
        'it registers /sw.js');
  check(/scope:\s*'\/'/.test(app),
        'at the root scope, so it controls every page rather than a subtree');
  check(/setInterval\([^)]*checkForUpdate|checkForUpdate\(reg, 'timer'\)/.test(app),
        'it re-checks on a timer during a long session');
  check(/visibilitychange[\s\S]{0,400}checkForUpdate\(reg, 'foreground'\)/.test(app),
        'and when the app comes back to the foreground');
  check(/'online'[\s\S]{0,200}checkForUpdate\(reg, 'online'\)/.test(app),
        'and when the network comes back');

  check(/updatefound/.test(app) && /SKIP_WAITING/.test(app),
        'a newly installed version is pushed through rather than left waiting');
  check(/reg\.waiting\b[\s\S]{0,200}SKIP_WAITING/.test(app),
        'including one left waiting by a previous session');

  check(/controllerchange/.test(app),
        'it notices when a new version takes control');
  check(/hadController/.test(app),
        'and does not mistake the first-ever worker for an update',
        'without this guard, every first visit reloads itself');
  check(/reloadPending/.test(app) && /visibilityState === 'hidden'/.test(app),
        'the reload happens once, and out of sight rather than under the user');

  // index.tsx must actually call it, or none of the above runs.
  const index = readFileSync(join(APP, 'index.tsx'), 'utf8');
  check(/registerServiceWorker\(\)/.test(index), 'and the app calls it on boot');
  check(!/navigator\.serviceWorker\.register/.test(index),
        'with no second, competing registration left in index.tsx');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
