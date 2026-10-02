#!/usr/bin/env node
// The Earth-directed CME alert, and its per-subscriber speed floor.
//
//   npm run test:cme
//
// Two things can go wrong here that nothing else would catch.
//
// The first is drift: the app decides whether a CME is Earth-directed in
// utils/cmeAnalysis.ts, and the worker has to decide it the same way, or the
// app draws a CME as a miss while the worker sends an alert about it. The
// worker cannot import TypeScript, so the rule is duplicated and checked here.
//
// The second is the speed floor. It is the only threshold in this worker that
// belongs to the subscriber rather than to the detector, so a bug in it is not
// "nobody gets it" but "the wrong people get it" - which nobody reports.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const SRC = join(APP, 'worker', 'push-notification-worker.js');
const dir = mkdtempSync(join(tmpdir(), 'cme-'));
const copy = join(dir, 'w.mjs');
writeFileSync(copy, readFileSync(SRC, 'utf8') +
  '\nexport { checkEarthDirectedCMEs, runShard, decideForSubscriber, pickCmeAnalysis,' +
  ' isCmeEarthDirected, cmeSpeedFloorOf, cmeSpeedBand, handleSaveSubscription,' +
  ' cmeDistanceAU, cmeTransitSeconds, cmeArrivalMs, CME_ARRIVAL_UNCERTAINTY_HOURS, fetchUpstream, upstreamFailure, fetchDonkiCmes };\n');
const W = await import(pathToFileURL(copy).href);

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// ── the app and the worker must agree ──────────────────────────────────────
console.log('\nThe worker and the app mean the same thing by "Earth-directed"');
{
  const shared = readFileSync(join(APP, 'utils', 'cmeAnalysis.ts'), 'utf8');
  const worker = readFileSync(SRC, 'utf8');

  const appLimit = shared.match(/EARTH_DIRECTED_MAX_LONGITUDE\s*=\s*(\d+)/)?.[1];
  const workerLimit = worker.match(/CME_EARTH_DIRECTED_MAX_LONGITUDE\s*=\s*(\d+)/)?.[1];
  check(appLimit && appLimit === workerLimit,
        `both use the same longitude limit (${appLimit}deg)`,
        `app ${appLimit}, worker ${workerLimit}`);

  // Both have to prefer DONKI's most-accurate analysis, or they can read the
  // same event and come away with different speeds.
  check(/isMostAccurate/.test(shared) && /isMostAccurate/.test(worker),
        'both prefer the analysis DONKI flags as most accurate');

  // And the app must actually use the shared module rather than its own copy.
  const svc = readFileSync(join(APP, 'services', 'nasaService.ts'), 'utf8');
  check(/from '\.\.\/utils\/cmeAnalysis'/.test(svc),
        'the app imports the shared rule');
  check(!/Math\.abs\(analysis\.longitude\)\s*<\s*\d+/.test(svc),
        'and no longer carries its own inline copy of it');

  // The speed bands have to match, or the notification calls a CME "medium"
  // while the settings screen that set the floor calls it "fast".
  for (const name of ['CME_SLOW_MAX', 'CME_MEDIUM_MAX']) {
    const a = shared.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))?.[1];
    const b = worker.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))?.[1];
    check(a && a === b, `${name} matches between app and worker (${a})`, `app ${a}, worker ${b}`);
  }

  // The speed bounds have to match too, or the app offers a number the worker
  // silently clamps.
  for (const [name, wname] of [['CME_SPEED_MIN', 'CME_SPEED_FLOOR_MIN'],
                               ['CME_SPEED_MAX', 'CME_SPEED_FLOOR_MAX'],
                               ['CME_SPEED_DEFAULT', 'CME_SPEED_FLOOR_DEFAULT']]) {
    const a = shared.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))?.[1];
    const b = worker.match(new RegExp(`${wname}\\s*=\\s*(\\d+)`))?.[1];
    check(a && a === b, `${name} matches the worker's ${wname} (${a})`, `app ${a}, worker ${b}`);
  }
}

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

const b64u = (b) => Buffer.from(b).toString('base64url');
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
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
  if (url.includes('push.example')) { delivered.push(url); return new Response('', { status: 201 }); }
  return new Response('[]', { status: 200 });
};

/** A DONKI CME record, as the proxy hands them over. */
const cme = ({ id, speed, longitude = 5, latitude = -10, hoursAgo = 1, accurate = true }) => ({
  activityID: id,
  startTime: new Date(Date.now() - hoursAgo * 3600000).toISOString(),
  cmeAnalyses: [{ speed, longitude, latitude, halfAngle: 40, isMostAccurate: accurate }],
});

/** Which topics got queued since the last call. */
async function queuedJobs() {
  const out = [];
  for (const name of [...store.keys()].filter(k => k.startsWith('JOB_'))) {
    out.push(JSON.parse(store.get(name)));
  }
  return out;
}
const clearJobs = () => {
  for (const name of [...store.keys()].filter(k => k.startsWith('JOB_') || k.startsWith('JOBSHARD_'))) {
    store.delete(name);
  }
};

// ── the detector ───────────────────────────────────────────────────────────
console.log('\nThe detector picks the right CMEs');
{
  store.clear();

  // First run must not announce days of history to everybody.
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'a', speed: 1200, hoursAgo: 30 }), cme({ id: 'b', speed: 900, hoursAgo: 40 })], () => {});
  check((await queuedJobs()).length === 0,
        'the first run adopts older CMEs and sends nothing for them');
  clearJobs();

  // But one from the last day is still news, even on the first run.
  store.clear();
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'old', speed: 1200, hoursAgo: 30 }), cme({ id: 'today', speed: 447, hoursAgo: 5 })], () => {});
  const firstRun = await queuedJobs();
  check(firstRun.length === 1 && firstRun[0].params?.id === 'today',
        'the first run still sends a CME launched in the last day', JSON.stringify(firstRun.map((j) => j.params)));
  const seen = JSON.parse(store.get('STATE_cme_seen'));
  check(seen.announced.old === 1200 && seen.announced.today === 447 && seen.primedAt,
        'and records both as seen', JSON.stringify(seen));
  clearJobs();
  store.clear();
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'a', speed: 1200, hoursAgo: 30 }), cme({ id: 'b', speed: 900, hoursAgo: 30 })], () => {});
  clearJobs();

  // A genuinely new one does fire.
  await W.checkEarthDirectedCMEs(env, [
    cme({ id: 'a', speed: 1200 }), cme({ id: 'b', speed: 900 }),
    cme({ id: 'c', speed: 850 }),
  ], () => {});
  let jobs = await queuedJobs();
  check(jobs.length === 1 && jobs[0].params.id === 'c',
        'a newly catalogued Earth-directed CME is queued',
        jobs.map(j => j.params?.id).join(', ') || 'nothing');
  check(jobs[0]?.kind === 'cme' && jobs[0]?.topic === 'cme-earth-directed',
        'as a per-subscriber cme job');
  clearJobs();

  // And is not re-announced on the next tick.
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'c', speed: 850 })], () => {});
  check((await queuedJobs()).length === 0, 'and is not sent twice');
  clearJobs();

  // Pointed away from Earth: not our problem.
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'far', speed: 2000, longitude: 80 })], () => {});
  check((await queuedJobs()).length === 0,
        'a CME launched 80deg off the Sun-Earth line is ignored however fast');
  clearJobs();

  // Right on the limb of the window still counts.
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'edge', speed: 600, longitude: -44 })], () => {});
  check((await queuedJobs()).length === 1, 'one at 44deg still counts');
  clearJobs();

  // Old news stays old news.
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'old', speed: 1500, hoursAgo: 72 })], () => {});
  check((await queuedJobs()).length === 0,
        'a CME from three days ago is not announced as new');
  clearJobs();

  // DONKI revises its analyses. A CME first seen below somebody's floor must
  // still reach them when the refined speed lands.
  store.delete('STATE_cme_seen');
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'rev', speed: 400 })], () => {});  // prime
  clearJobs();
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'new1', speed: 400 })], () => {});
  const first = (await queuedJobs())[0];
  check(first?.params?.speed === 400, 'a slow one is still queued - the floor is per subscriber, not here',
        JSON.stringify(first?.params));
  clearJobs();

  // The batch cap.
  store.delete('STATE_cme_seen');
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'p', speed: 500 })], () => {});  // prime
  clearJobs();
  await W.checkEarthDirectedCMEs(env, [
    cme({ id: 'b1', speed: 500 }), cme({ id: 'b2', speed: 1800 }), cme({ id: 'b3', speed: 900 }),
    cme({ id: 'b4', speed: 700 }), cme({ id: 'b5', speed: 1100 }),
  ], () => {});
  jobs = await queuedJobs();
  check(jobs.length === 3, 'a backlog of five sends at most three', `${jobs.length}`);
  check(jobs.some(j => j.params.speed === 1800),
        'and the fastest is one of them', jobs.map(j => j.params.speed).join(', '));
  clearJobs();

  // Nothing capped should reappear next tick, or the cap only delays the flood.
  await W.checkEarthDirectedCMEs(env, [
    cme({ id: 'b1', speed: 500 }), cme({ id: 'b4', speed: 700 }),
  ], () => {});
  check((await queuedJobs()).length === 0,
        'the ones the cap skipped do not arrive a minute later');
  clearJobs();
}

// ── the words attached to a speed ──────────────────────────────────────────
console.log('\nA speed is described in words, not just a number');
{
  const mod = readFileSync(join(APP, 'utils', 'cmeAnalysis.ts'), 'utf8');
  // Boundaries as the user stated them: slow below 500, medium below 800,
  // fast at or above 800.
  const cases = [[299, 'slow'], [499, 'slow'], [500, 'medium'], [799, 'medium'],
                 [800, 'fast'], [2500, 'fast']];
  const wrong = cases.filter(([sp, want]) => W.cmeSpeedBand(sp) !== want)
                     .map(([sp, want]) => `${sp} -> ${W.cmeSpeedBand(sp)}, want ${want}`);
  check(wrong.length === 0, 'every speed lands in the right band', wrong.join(', '));

  // The medium band is the one worth wording carefully: it is the "looks
  // unremarkable but can still deliver" case.
  check(/can still cause a good storm/i.test(mod),
        'the medium band says it can still cause a good storm');

  // And the notification body has to actually carry it.
  const worker = readFileSync(SRC, 'utf8');
  check(/CME_SPEED_BAND_TEXT\[band\]/.test(worker),
        'the notification body includes the band description');
}

// ── the arrival time has to be the app's own ───────────────────────────────
console.log("\nThe arrival time matches the model the 3D scene draws with");
{
  // Not "the same constants" - the same numbers. The scene decides where to
  // draw a CME with utils/cmePropagation.ts, and a notification quoting a
  // different arrival than the picture it links to is worse than one quoting
  // none at all. So run both and compare.
  const propSrc = readFileSync(join(APP, 'utils', 'cmePropagation.ts'), 'utf8')
    .replace(/import \{ AU_IN_KM \} from '\.\.\/constants';/, 'const AU_IN_KM = 149597870.7;')
    .replace(/:\s*number(\s*\|\s*null)?/g, '')
    .replace(/export function (\w+)\(([^)]*)\)/g, 'export function $1($2)');
  const propCopy = join(dir, 'prop.mjs');
  writeFileSync(propCopy, propSrc);
  const P = await import(pathToFileURL(propCopy).href);

  const speeds = [350, 500, 700, 900, 1200, 1800, 2500];
  const distDrift = [];
  const transitDrift = [];
  for (const sp of speeds) {
    for (const hours of [6, 24, 48, 72]) {
      const a = P.cmeDistanceAU(sp, hours * 3600);
      const b = W.cmeDistanceAU(sp, hours * 3600);
      if (Math.abs(a - b) > 1e-12) distDrift.push(`${sp} km/s at ${hours}h: app ${a}, worker ${b}`);
    }
    const ta = P.cmeTransitSeconds(sp, 1);
    const tb = W.cmeTransitSeconds(sp, 1);
    if (ta == null !== (tb == null) || (ta != null && Math.abs(ta - tb) > 1e-6)) {
      transitDrift.push(`${sp} km/s: app ${ta}, worker ${tb}`);
    }
  }
  check(distDrift.length === 0,
        `distance agrees with the app at every speed and time checked (${speeds.length * 4} points)`,
        distDrift.join('\n        '));
  check(transitDrift.length === 0,
        'and so does the transit time to 1 AU', transitDrift.join('\n        '));

  // Sanity, so a model that agrees with itself but is nonsense still fails.
  const hours = (sp) => W.cmeTransitSeconds(sp, 1) / 3600;
  console.log(`    transit: 500 km/s ${hours(500).toFixed(1)}h, `
            + `1000 km/s ${hours(1000).toFixed(1)}h, 2000 km/s ${hours(2000).toFixed(1)}h`);
  check(hours(500) > hours(1000) && hours(1000) > hours(2000),
        'a faster CME always arrives sooner');
  check(hours(2000) > 12 && hours(350) < 14 * 24,
        'and every transit lands in a physically sensible range',
        `${hours(2000).toFixed(1)}h to ${hours(350).toFixed(1)}h`);

  // The uncertainty is stated, always, and is the figure asked for.
  check(W.CME_ARRIVAL_UNCERTAINTY_HOURS === 12, 'the quoted uncertainty is +/- 12 hours');
  const worker = readFileSync(SRC, 'utf8');
  check(/Forecast arrival: \$\{formatNzTime\(forecastMs\)\} \(\+\/- \$\{CME_ARRIVAL_UNCERTAINTY_HOURS\} hours\)/.test(worker),
        'and the body always carries it beside the time, never a bare timestamp');
}

// ── the per-subscriber floor ───────────────────────────────────────────────
console.log("\nEach subscriber's own speed floor decides");
{
  const job = { kind: 'cme', topic: 'cme-earth-directed', params: { id: 'x', speed: 800 }, payload: {} };
  const on = { 'cme-earth-directed': true };

  const decide = (rec) => W.decideForSubscriber(env, job, 'k', rec, { ops: 0 });

  check(await decide({ preferences: on, cme_speed_min: 500 }) !== null,
        'an 800 km/s CME reaches someone whose floor is 500');
  check(await decide({ preferences: on, cme_speed_min: 1000 }) === null,
        'and not someone whose floor is 1000');
  check(await decide({ preferences: on, cme_speed_min: 800 }) !== null,
        'a floor exactly equal to the speed counts as a match');
  check(await decide({ preferences: on }) !== null,
        'someone who never chose gets the default floor of 700');
  check(await decide({ preferences: { 'cme-earth-directed': false }, cme_speed_min: 300 }) === null,
        'and the toggle still wins over any floor');

  // Nonsense in the record must not open the gate to everyone or close it.
  for (const bad of ['fast', NaN, -50, 99999]) {
    const got = W.cmeSpeedFloorOf({ cme_speed_min: bad });
    check(got >= 300 && got <= 3000,
          `a stored floor of ${String(bad)} clamps to something usable (${got})`);
  }

  // "Never chose" has to land on the default, not the minimum. Number(null) is
  // 0, so the obvious clamp would silently opt these records into every CME.
  for (const unset of [null, undefined, '']) {
    const got = W.cmeSpeedFloorOf({ cme_speed_min: unset });
    check(got === 700,
          `a stored floor of ${JSON.stringify(unset)} means unset, so 700 rather than 300`,
          `got ${got}`);
  }
  check(W.cmeSpeedFloorOf({}) === 700, 'and so does a record with no floor at all');
}

// ── end to end ─────────────────────────────────────────────────────────────
console.log('\nEnd to end: the right phones light up');
{
  store.clear();
  const floors = [400, 700, 1000, 1500];
  for (const f of floors) {
    const req = new Request('https://push.invalid/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://www.spottheaurora.co.nz' },
      body: JSON.stringify({
        subscription: { endpoint: `https://push.example/floor-${f}`,
                        keys: { p256dh: P256DH, auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) } },
        preferences: { 'cme-earth-directed': true },
        cme_speed_min: f,
      }),
    });
    await W.handleSaveSubscription(req, env);
  }

  await W.checkEarthDirectedCMEs(env, [cme({ id: 'prime', speed: 100 })], () => {});  // prime
  clearJobs();
  delivered.length = 0;
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'real', speed: 950 })], () => {});
  await settle();

  const got = delivered.map(u => Number(u.match(/floor-(\d+)/)?.[1])).sort((a, b) => a - b);
  check(got.join(',') === '400,700',
        'a 950 km/s CME reaches the 400 and 700 floors and nobody else',
        `reached ${got.join(', ') || 'nobody'}`);
}

// ── late analyses, revised speeds, and the feed itself ─────────────────────
console.log('\nLate analyses and revised speeds still reach people');
{
  store.clear();
  const floors = [400, 700];
  for (const f of floors) {
    await W.handleSaveSubscription(new Request('https://push.invalid/save-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://www.spottheaurora.co.nz' },
      body: JSON.stringify({
        subscription: { endpoint: `https://push.example/rev-${f}`,
                        keys: { p256dh: P256DH, auth: b64u(webcrypto.getRandomValues(new Uint8Array(16))) } },
        preferences: { 'cme-earth-directed': true },
        cme_speed_min: f,
      }),
    }), env);
  }
  const reached = () => delivered.map(u => Number(u.match(/rev-(\d+)/)?.[1])).filter(Boolean).sort((a, b) => a - b).join(',');

  await W.checkEarthDirectedCMEs(env, [cme({ id: 'prime', speed: 100 })], () => {});  // prime
  clearJobs();

  // Launched three days ago at 500 km/s: DONKI's analysis only just landed,
  // and the CME has yet to arrive. That is still news.
  delivered.length = 0;
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'late', speed: 500, hoursAgo: 72 })], () => {});
  await settle();
  check(reached() === '400', 'a 500 km/s CME first analysed three days after launch, still on its way, is sent',
        `reached ${reached() || 'nobody'}`);
  clearJobs();

  // DONKI re-measures it faster. The 700 floor now qualifies; 400 already has it.
  delivered.length = 0;
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'late', speed: 750, hoursAgo: 72 })], () => {});
  await settle();
  check(reached() === '700', 'revised up to 750 km/s, it reaches the 700 floor and not the 400 floor again',
        `reached ${reached() || 'nobody'}`);
  clearJobs();

  // Re-measured slower, or unchanged: nothing more.
  delivered.length = 0;
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'late', speed: 650, hoursAgo: 72 })], () => {});
  await settle();
  check(delivered.length === 0, 'revised down, nobody is told again');

  // A record from before speeds were kept: no re-send for what it knew.
  store.set('STATE_cme_seen', JSON.stringify({ ids: ['old-a'], updatedAt: Date.now() }));
  clearJobs();
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'old-a', speed: 900 })], () => {});
  check((await queuedJobs()).length === 0, 'CMEs in an old-style record are not announced again');
  check(JSON.parse(store.get('STATE_cme_seen')).announced?.['old-a'] === 900, 'and the record is carried over with speeds');
  clearJobs();
}

console.log('\nThe DONKI feed through a service binding');
{
  let viaBinding = 0;
  const DONKI = { fetch: async () => { viaBinding++; return new Response('[]', { status: 200 }); } };
  const res = await W.fetchUpstream('donki', DONKI, 'https://nasa-donki-api.example/CME', 1);
  check(res && viaBinding === 1, 'with a DONKI binding the feed is fetched through it');

  const saved = globalThis.fetch;
  globalThis.fetch = async () => new Response('error code: 1042', { status: 404 });
  const miss = await W.fetchUpstream('donki', undefined, 'https://nasa-donki-api.example/CME', 1);
  globalThis.fetch = saved;
  const why = W.upstreamFailure('donki', 'DONKI');
  check(miss === null && /public url returned 404/.test(why) && /service binding named DONKI/.test(why),
        'without one, a refusal says so and names the binding to add', why);
}

console.log('\nWithout a working DONKI binding, NASA is read directly');
{
  const saved = globalThis.fetch;
  const hits = { proxy: 0, nasa: 0 };
  let nasaUp = true;
  const feed = () => [cme({ id: 'direct-1', speed: 447 })];
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url.includes('nasa-donki-api')) { hits.proxy++; return new Response('error code: 1042', { status: 404 }); }
    if (url.startsWith('https://ccmc.gsfc.nasa.gov/DONKI-API/get/CME')) {
      hits.nasa++;
      return nasaUp ? new Response(JSON.stringify(feed()), { status: 200 }) : new Response('slow down', { status: 429 });
    }
    return saved(input, init);
  };
  const notes = [];
  const note = (name, status, detail) => notes.push({ name, status, detail });

  store.clear();
  await W.checkEarthDirectedCMEs(env, [cme({ id: 'prime', speed: 100 })], () => {});   // prime
  await W.checkEarthDirectedCMEs(env, null, note);
  const jobs = await queuedJobs();
  check(jobs.some((j) => j.kind === 'cme' && j.params?.id === 'direct-1' && j.params?.speed === 447),
        'with no binding, a 447 km/s Earth-directed CME is still found and queued', JSON.stringify(notes));
  check(hits.proxy === 0 && hits.nasa === 1,
        'and the proxy URL, which a worker is refused, is not even tried', JSON.stringify(hits));
  check(/api_key=DEMO_KEY/.test(JSON.stringify([...store.keys()])) === false, 'the key is never written to KV');

  clearJobs();
  await W.checkEarthDirectedCMEs(env, null, note);
  check(hits.nasa === 1 && /copy from/.test(notes.at(-1).detail),
        'the next run within ten minutes reuses the copy rather than calling NASA again', notes.at(-1).detail);

  // A binding that fails falls back the same way.
  const broken = { ...env, DONKI: { fetch: async () => new Response('no', { status: 500 }) } };
  store.set('CACHE_donki_cme_direct', JSON.stringify({ at: Date.now() - 11 * 60000, data: feed() }));
  await W.checkEarthDirectedCMEs(broken, null, note);
  check(hits.nasa === 2 && notes.at(-1).detail.includes('via NASA DONKI'),
        'a failing binding falls back to NASA too', notes.at(-1).detail);

  // NASA down: an hour-old copy still beats no alert.
  nasaUp = false;
  store.set('CACHE_donki_cme_direct', JSON.stringify({ at: Date.now() - 60 * 60000, data: feed() }));
  await W.checkEarthDirectedCMEs(env, null, note);
  check(/unreachable, using copy/.test(notes.at(-1).detail), 'with NASA down, a recent copy is used', notes.at(-1).detail);

  // Nothing at all: says why, rather than going quiet.
  store.delete('CACHE_donki_cme_direct');
  await W.checkEarthDirectedCMEs(env, null, note);
  const last = notes.at(-1);
  check(last.status === 'skipped' && /no DONKI binding/.test(last.detail) && /429/.test(last.detail),
        'and with nothing reachable, the diagnostics say what failed', last.detail);

  globalThis.fetch = saved;
  clearJobs();
}

// ── reaching the people who were already subscribed ────────────────────────
console.log('\nSubscribers who predate the category still get it');
{
  // A brand-new default-on topic reaches nobody until the migration fills it
  // in: the send needs preferences[topic] === true, and an older record has no
  // such key. This is the step that was easy to forget and silent to get wrong.
  const worker = readFileSync(SRC, 'utf8');
  const version = Number(worker.match(/const MIGRATION_VERSION = (\d+)/)?.[1]);
  check(version >= 3,
        `the migration version is bumped so the fill-in runs again (${version})`,
        'without a bump, everyone already migrated keeps a record with no cme-earth-directed key');

  check(/const TOPIC_DEFAULT_ON = new Set\(\[[\s\S]*?'cme-earth-directed'[\s\S]*?\]\);/.test(worker),
        'and the topic is in TOPIC_DEFAULT_ON, so the fill-in writes true');

  // The fill-in must never overwrite a choice somebody made.
  check(/if \(prefs\[topic\] === undefined\)/.test(worker),
        'the fill-in only touches keys nobody has set');
}

// ── telling existing subscribers it exists ─────────────────────────────────
console.log('\nExisting subscribers are told rather than opted in');
{
  // shock-ff stays false for everyone who already migrated - the fill-in does
  // not overwrite stored values, and flipping it for them would be deciding on
  // their behalf. The announcement is what closes that gap, so it has to
  // actually reach them and actually offer the switch.
  const modal = readFileSync(join(APP, 'components', 'WhatsNewModal.tsx'), 'utf8');
  const gate  = readFileSync(join(APP, 'utils', 'whatsNew.ts'), 'utf8');
  const app   = readFileSync(join(APP, 'App.tsx'), 'utf8');

  for (const id of ['cme-earth-directed', 'shock-ff']) {
    check(modal.includes(`'${id}'`), `it offers ${id}`);
  }

  check(/pushManager\.getSubscription/.test(gate),
        'it is only shown to devices that already have a push subscription',
        'otherwise it interrupts people who have never turned notifications on');
  check(/localStorage\.setItem\(WHATS_NEW_ID/.test(gate) && /markWhatsNewSeen/.test(modal),
        'and it is marked seen when dismissed, so it shows once');
  // Run it rather than read it: with storage blocked - private mode, or a
  // browser with site data turned off - it must report "seen". An announcement
  // that cannot stay dismissed would come back on every single load.
  {
    const gateCopy = join(dir, 'whatsNew.mjs');
    writeFileSync(gateCopy, gate.replace(/:\s*(string|boolean|void|Promise<boolean>)/g, ''));
    const throwing = { getItem() { throw new Error('blocked'); },
                       setItem() { throw new Error('blocked'); } };
    globalThis.localStorage = throwing;
    const G = await import(pathToFileURL(gateCopy).href);
    check(G.hasSeenWhatsNew() === true,
          'blocked storage counts as seen rather than showing on every load',
          'an announcement that cannot stay dismissed is worse than one missed');
    let threw = false;
    try { G.markWhatsNewSeen(); } catch { threw = true; }
    check(!threw, 'and dismissing it never throws when storage is blocked');
    check(await G.shouldShowWhatsNew() === false,
          'nor is it shown when there is no service worker at all');
    delete globalThis.localStorage;
  }

  check(/isLoading \|\| isAppTutorialOpen \|\| isFirstVisitTutorialOpen \|\| isTutorialOpen/.test(app),
        'it waits for the loading screen and the tutorials, so popups never stack');

  // The ids have to be real, or the switches write preferences nothing reads.
  const manifest = readFileSync(join(APP, 'utils', 'notificationCategories.ts'), 'utf8');
  const bogus = ['cme-earth-directed', 'shock-ff'].filter(id => !manifest.includes(`id: '${id}'`));
  check(bogus.length === 0, 'and both ids are declared categories', bogus.join(', '));

  // Both must be things a user can actually see and control afterwards.
  for (const id of ['cme-earth-directed', 'shock-ff']) {
    const block = manifest.slice(manifest.indexOf(`id: '${id}'`));
    check(/^\s*ui: 'toggle'/m.test(block.slice(0, 200)),
          `${id} has a toggle in Settings to change it later`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
