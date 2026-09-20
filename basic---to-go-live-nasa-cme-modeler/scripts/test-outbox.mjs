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
  '\nexport { checkOvernightWatch, runShard, sweepJobs, jobProgress, maybeRunCensus, runCensusShard,' +
  ' recordSend, foldAllClicks, handleSends, handleNotificationClicked, stampSendId,' +
  ' maybeRunMigration, runMigrationShard, migrationTotals, TOPIC_DEFAULT_ON, ALL_TOPICS,' +
  ' pushServiceOf };\n');
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

// ---- 5. the ledger records what actually happened ---------------------
console.log('\n5. the delivery ledger');
for (const k of [...store.keys()]) {
  if (k.startsWith('JOB_') || k.startsWith('JOBSHARD_') || k.startsWith('COOLDOWN_') ||
      k.startsWith('SEND_') || k.startsWith('CLK_') || k === 'SENDS') store.delete(k);
  else { const v = JSON.parse(store.get(k)); delete v.overnightWatchSentDate; store.set(k, JSON.stringify(v)); }
}
delivered.length = 0;
await W.checkOvernightWatch(env, forecast, substorm, mag, plasma, () => {});
await settle();
// The sweep is what writes the ledger entry, the same as on a real cron tick.
await W.sweepJobs(env, () => {});
const ledgerId = JSON.parse(store.get('SENDS') ?? '[]')[0];
const entry = ledgerId ? JSON.parse(store.get(`SEND_${ledgerId}`)) : null;
console.log(`    ${entry?.topic}: accepted ${entry?.accepted}, failed ${entry?.failed}, pruned ${entry?.pruned}`);
check(entry && entry.accepted === wantNightly && entry.failed === 0 && entry.topic === 'overnight-watch',
      'the send is recorded with the right recipient count',
      entry ? JSON.stringify(entry) : 'no ledger entry written');

// ---- 6. clicks are counted and attributed -----------------------------
console.log('\n6. click-through counting');
{
  // Every notification carries its send id in the deep link.
  const stamped = W.stampSendId({ title: 't', data: { url: '/?page=forecast' } }, ledgerId);
  check(stamped.data.url.includes(`n=${ledgerId}`) && stamped.data.sendId === ledgerId,
        'the send id rides in the notification link', stamped.data.url);

  // 640 people tap it. Each is one unique key, so none can clobber another.
  const CLICKS = 640;
  for (let i = 0; i < CLICKS; i++) {
    const req = new Request('https://x.invalid/notification-clicked', {
      method: 'POST', body: JSON.stringify({ id: ledgerId, topic: 'overnight-watch' }),
    });
    await W.handleNotificationClicked(req, env);
  }
  await W.foldAllClicks(env);
  const after = JSON.parse(store.get(`SEND_${ledgerId}`));
  const expectedRate = Math.round((CLICKS / wantNightly) * 1000) / 10;
  console.log(`    clicked ${after.clicked} of ${after.accepted} accepted (${after.clickRate}%)`);
  check(after.clicked === CLICKS && after.clickRate === expectedRate,
        'every click is counted exactly once, with a rate',
        `got ${after.clicked}, wanted ${CLICKS}`);

  // Folding again must not double-count - the number is recomputed, not added.
  await W.foldAllClicks(env);
  const twice = JSON.parse(store.get(`SEND_${ledgerId}`));
  check(twice.clicked === CLICKS, 'folding twice does not double-count', `got ${twice.clicked}`);

  const resp = await W.handleSends(
    new Request('https://x.invalid/sends?secret=s'), env);
  const body = await resp.json();
  check(body.byTopic['overnight-watch']?.clicked === CLICKS &&
        body.byTopic['overnight-watch']?.accepted === wantNightly,
        'the per-topic rollup matches', JSON.stringify(body.byTopic));
}

// ---- 7. the migration brings old subscribers forward invisibly --------
console.log('\n7. migrating existing subscribers');
{
  for (const k of [...store.keys()]) {
    if (!k.startsWith('JOB') && !k.startsWith('SEND') && !k.startsWith('CLK') &&
        !k.startsWith('COOLDOWN') && !k.startsWith('MIG') && k !== 'SENDS') continue;
    store.delete(k);
  }

  // Three shapes of record that really exist in the namespace: someone from
  // before the shock split, someone who has deliberately turned things off,
  // and someone already current.
  const mk = async (n, prefs, extra = {}) => {
    const endpoint = `https://push.example/legacy-${n}`;
    const key = await sha(endpoint);
    store.set(key, JSON.stringify({
      subscription: { endpoint, keys: { p256dh: P256DH, auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) } },
      preferences: prefs, ...extra,
    }));
    return key;
  };
  const oldShock = await mk('shock', { 'shock-detection': true, 'flare-M1': true });
  // Somebody from before several topics existed, with no legacy shock opt-in.
  const plain    = await mk('plain', { 'flare-M1': true });
  const optedOut = await mk('off', Object.fromEntries(W.ALL_TOPICS.map(t => [t, false])));
  const current  = await mk('now', Object.fromEntries(W.ALL_TOPICS.map(t => [t, W.TOPIC_DEFAULT_ON.has(t)])));
  const before = { optedOut: store.get(optedOut), current: store.get(current) };

  globalThis.fetch = (orig => async (input, init) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url.includes('/run-migration-shard')) {
      const p = W.runMigrationShard(env, JSON.parse(init.body).shard);
      inflight.push(p); await p;
      return new Response('{}', { status: 200 });
    }
    return orig(input, init);
  })(globalThis.fetch);

  await W.maybeRunMigration(env, () => {});
  await settle();
  await W.maybeRunMigration(env, () => {});   // second pass finalises
  await settle();

  const shock = JSON.parse(store.get(oldShock)).preferences;
  check(shock['shock-ff'] === true && shock['flare-M1'] === true,
        'an old shock-detection opt-in carries across the split',
        JSON.stringify({ ff: shock['shock-ff'], m1: shock['flare-M1'] }));

  // The topic they never saw gets the same default the app would show them -
  // not false, which is what used to make the switch and the worker disagree.
  // The old catch-all opt-in covers every shock subtype, shock-imf included -
  // they asked for shock alerts, so they get shock alerts.
  check(shock['shock-imf'] === true && shock['shock-sr'] === true,
        'the old opt-in covers every shock subtype');

  // The topic they were never asked about takes the same default the app
  // would show them - not false, which is what used to make the switch in
  // settings and the worker's stored preference disagree.
  const plainPrefs = JSON.parse(store.get(plain)).preferences;
  check(plainPrefs['overnight-watch'] === true && plainPrefs['visibility-naked'] === true,
        'never-seen topics take the app\'s own default rather than false',
        JSON.stringify({ overnight: plainPrefs['overnight-watch'], naked: plainPrefs['visibility-naked'] }));
  check(plainPrefs['shock-imf'] === false && plainPrefs['shock-ff'] === false,
        'a topic the app defaults to off stays off',
        JSON.stringify({ imf: plainPrefs['shock-imf'], ff: plainPrefs['shock-ff'] }));
  check(plainPrefs['flare-M1'] === true, 'their one real choice is preserved');

  check(store.get(optedOut) === before.optedOut,
        'somebody who turned everything off is left completely alone');
  check(store.get(current) === before.current,
        'an already-current record is not rewritten');

  // Everything in the namespace that is a subscriber, and nothing that is not.
  const subscriberCount = [...store].filter(([k, v]) => {
    try { return !!JSON.parse(v)?.subscription; } catch { return false; }
  }).length;
  const totals = await W.migrationTotals(env);
  check(totals.seen === subscriberCount && totals.errors === 0,
        'every subscriber was visited, and nothing else was',
        `${totals.seen} seen vs ${subscriberCount} subscribers, ${totals.errors} errors`);

  // Idempotence: a forced re-run must change nothing.
  const snapshot = new Map([...store].filter(([k]) => !k.startsWith('MIG') && k !== 'MIGRATION'));
  for (const ch of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'])
    await W.runMigrationShard(env, ch);
  const unchanged = [...snapshot].every(([k, v]) => store.get(k) === v);
  check(unchanged, 'running it again changes nothing');
}

// ---- 8. the stats snapshot ---------------------------------------------
console.log('\n8. the subscriber stats snapshot');
{
  globalThis.fetch = (orig => async (input, init) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url.includes('/run-census-shard')) {
      const { censusId, shard } = JSON.parse(init.body);
      const p = W.runCensusShard(env, censusId, shard);
      inflight.push(p); await p;
      return new Response('{}', { status: 200 });
    }
    return orig(input, init);
  })(globalThis.fetch);

  // Test 7 cleared the ledger, so put a real send through first - the point
  // of the digest is that one read of STATS shows both halves.
  for (const k of [...store.keys()]) {
    if (k.startsWith('JOB') || k.startsWith('COOLDOWN')) store.delete(k);
    else if (!k.startsWith('MIG') && k !== 'MIGRATION' && k !== 'STATS' && !k.startsWith('STATSSHARD')) {
      try { const v = JSON.parse(store.get(k)); if (v.subscription) { delete v.overnightWatchSentDate; store.set(k, JSON.stringify(v)); } } catch {}
    }
  }
  delivered.length = 0;
  await W.checkOvernightWatch(env, forecast, substorm, mag, plasma, () => {});
  await settle();
  await W.sweepJobs(env, () => {});
  const digestId = JSON.parse(store.get('SENDS') ?? '[]')[0];
  for (let i = 0; i < 12; i++) {
    await W.handleNotificationClicked(new Request('https://x.invalid/notification-clicked', {
      method: 'POST', body: JSON.stringify({ id: digestId, topic: 'overnight-watch' }),
    }), env);
  }

  store.delete('STATS');
  for (const ch of [...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'])
    store.delete(`STATSSHARD_${ch}`);
  await W.maybeRunCensus(env, () => {});
  await settle();
  const snap = JSON.parse(store.get('STATS'));
  console.log(`    ${snap.subscribers} subscribers, ${snap.subscribedToSomething} with a topic on`);
  console.log(`    overnight-watch ${snap.byCategory['overnight-watch']}, services ${JSON.stringify(snap.byPushService)}`);
  console.log(`    recent sends: ${snap.recentSends.map(r => `${r.topic} ${r.accepted} sent ${r.clicked} clicked (${r.clickRate}%)`).join('; ') || 'none'}`);

  const subscriberCount = [...store].filter(([k, v]) => {
    try { return !!JSON.parse(v)?.subscription; } catch { return false; }
  }).length;
  check(snap.subscribers === subscriberCount,
        'the census counts every subscriber and nothing else',
        `${snap.subscribers} vs ${subscriberCount}`);
  check(snap.subscribedToSomething + snap.subscribedToNothing === snap.subscribers &&
        snap.withLocation + snap.withoutLocation === snap.subscribers,
        'the totals add up');
  // Every subscriber record that actually has the topic on, counted directly.
  const reallyOn = [...store].filter(([k, v]) => {
    try { const r = JSON.parse(v); return r?.subscription && r.preferences?.['overnight-watch'] === true; }
    catch { return false; }
  }).length;
  check(snap.byCategory['overnight-watch'] === reallyOn,
        'per-category counts match the records',
        `${snap.byCategory['overnight-watch']} vs ${reallyOn}`);
  check(snap.recentSends.length > 0 &&
        snap.recentSends[0].accepted > 0 &&
        snap.recentSends[0].clicked === 12,
        'the snapshot carries the recent send digest, clicks included',
        JSON.stringify(snap.recentSends[0] ?? null));
  check(W.pushServiceOf('https://web.push.apple.com/abc') === 'apple' &&
        W.pushServiceOf('https://fcm.googleapis.com/fcm/send/x') === 'google' &&
        W.pushServiceOf('rubbish') === 'unknown',
        'push services are identified');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
