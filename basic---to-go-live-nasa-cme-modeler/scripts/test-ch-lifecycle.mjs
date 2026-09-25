#!/usr/bin/env node
// Every coronal hole's life, kept for 90 days (utils/chLifecycle), the
// detector joining holes cut by a sliver, and the forecast worker keeping the
// shared record and forecasting from it.
//
//   npm run test:ch-lifecycle

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'chlife-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};
const bundle = (entry, name) => {
  execFileSync('npx', ['esbuild', join(root, entry), '--bundle', '--format=esm', '--define:import.meta.env={}',
    `--outfile=${join(out, name)}`, '--log-level=error'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  return import(pathToFileURL(join(out, name)).href);
};

try {
  const D = await bundle('utils/suviCoronalHoleDetector.ts', 'd.mjs');
  const L = await bundle('utils/chLifecycle.ts', 'l.mjs');
  const HS = await bundle('utils/holeStream.ts', 'hs.mjs');
  const Wk = await bundle('worker/forecast-entry.js', 'w.mjs');

  // ── joining across slivers ──────────────────────────────────────────────
  console.log('\nThe detector joins holes cut by a sliver');
  {
    const W = 40, H = 20;
    const within = new Array(W * H).fill(true);
    const mask = new Array(W * H).fill(false);
    // Two blocks, a two-pixel gap between them, and a third far away.
    for (let y = 5; y < 15; y++) {
      for (let x = 5; x < 15; x++) mask[y * W + x] = true;
      for (let x = 17; x < 27; x++) mask[y * W + x] = true;
      for (let x = 35; x < 38; x++) mask[y * W + x] = true;
    }
    const closed = D.closeMask(mask, within, W, H, D.CH_JOIN_RADIUS_PX);
    check(closed[10 * W + 15] && closed[10 * W + 16], 'a two-pixel sliver between two holes is filled');
    check(!closed[10 * W + 31], 'a wide gap stays open');
    check(!closed[2 * W + 10] && !closed[17 * W + 10], 'the holes do not grow outwards');
    check(closed[10 * W + 36], 'a small hole on its own is kept');
    const outside = within.map((_, i) => (i % W) < 16);
    const limited = D.closeMask(mask, outside, W, H, D.CH_JOIN_RADIUS_PX);
    check(!limited[10 * W + 20], 'nothing is added off the solar disk');
  }

  console.log('\nJoining does not turn holes into sunspots');
  {
    // A disk with a ragged small hole, a smooth round sunspot-like blob, and
    // two patches split by a thin bright sliver. All under the size where the
    // sunspot shape test applies.
    const S = 200, R = 90;
    const disk = new Array(S * S).fill(false);
    const dark = new Array(S * S).fill(false);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      disk[i] = Math.hypot(x - 100, y - 100) < R;
      const ang = Math.atan2(y - 70, x - 70);
      const wob = 1 + 0.2 * Math.sin(ang * 5) + 0.1 * Math.sin(ang * 11);
      const r = Math.hypot((x - 70) / 16, (y - 70) / 10);
      if (r < wob && (r < wob - 0.3 || rnd() > 0.35)) dark[i] = true;            // ragged hole
      if (Math.hypot(x - 140, y - 70) < 10) dark[i] = true;                      // round blob
      const pair = Math.hypot((x - 92) / 8, (y - 140) / 12) < 1 || Math.hypot((x - 110) / 8, (y - 140) / 12) < 1;
      if (pair && x !== 100 && x !== 101) dark[i] = true;                       // pair, 2 px sliver at x=100-101
    }
    const regions = D.holeRegions(dark, disk, S);
    const at = (x, y) => regions.find((r) => Math.abs(r.centroidX - x) < 6 && Math.abs(r.centroidY - y) < 6);
    check(!!at(70, 70), 'a small ragged hole is still found once its edge is smoothed',
      JSON.stringify(regions.map((r) => [Math.round(r.centroidX), Math.round(r.centroidY), r.pixels.length])));
    check(!at(140, 70), 'a small round smooth patch is still taken for a sunspot');
    const pair = at(101, 140);
    check(!!pair && pair.minX < 90 && pair.maxX > 112, 'two patches split by a sliver are one hole');
  }

  // ── the record ──────────────────────────────────────────────────────────
  const HOUR = 3600000, DAY = 24 * HOUR;
  const RATE = 360 / 27.2753 / 24;             // degrees per hour
  const t0 = Date.UTC(2026, 8, 1, 0);
  const hole = (id, lat, lon, width, darkness = 0.5) => ({ id, lat, lon, widthDeg: width, heightDeg: width * 0.8, darkness });

  console.log('\nOne hole across the disk');
  {
    const lc = L.emptyLifecycle();
    // Frames every two hours for twelve days, one hole from -60 drifting west,
    // growing then shrinking.
    for (let h = 0; h <= 12 * 24; h += 2) {
      const lon = -60 + RATE * h;
      if (lon > 88) break;
      const w = 10 + 15 * Math.sin(Math.PI * h / (12 * 24));
      L.applyFrame(lc, { atMs: t0 + h * HOUR, holes: [hole('CH1', -5, lon, w)] });
    }
    check(lc.lives.length === 1, 'one hole, one record', String(lc.lives.length));
    const life = lc.lives[0];
    check(life.firstSeenMs === t0, 'first seen is its first frame');
    check(life.sightings.length > 100, 'every sighting is kept', String(life.sightings.length));
    check(life.sightings.every((s) => s.speedKms > 300 && s.speedKms < 900), 'each sighting has a stream speed');
    const speeds = life.sightings.map((s) => s.speedKms);
    check(Math.max(...speeds) > speeds[0], 'speed follows its size over time');
    check(life.status === 'live', 'still live on the disk');

    // Frames with nothing: it turns off the west limb.
    const last = life.lastSeenMs;
    L.applyFrame(lc, { atMs: last + 24 * HOUR, holes: [] });
    check(life.status === 'rotated-off', 'past the west limb it has rotated off', life.status);
    check(life.endedMs === last, 'and ended at its last sighting');

    // A rotation later, a new hole at the east limb where it would be.
    const back = last + 13.5 * DAY;
    let lon = L.projectedLon(life, back);
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    L.applyFrame(lc, { atMs: back, holes: [hole('CH1', -6, lon + 3, 14)] });
    const returned = lc.lives[1];
    check(returned && returned.returnOf === life.number, 'coming round again, it is the same hole returning',
      JSON.stringify(returned?.returnOf));
    check(returned.number === life.number + 1, 'under a new number, as a new rotation');
  }

  console.log('\nClosing, coming back, merging');
  {
    const lc = L.emptyLifecycle();
    const at = (h) => t0 + h * HOUR;
    L.applyFrame(lc, { atMs: at(0), holes: [hole('CH1', 10, -10, 12), hole('CH2', -20, 20, 10)] });
    L.applyFrame(lc, { atMs: at(2), holes: [hole('CH1', 10, -10 + 2 * RATE, 12)] });
    const two = lc.lives.find((l) => l.sightings[0].lat === -20);
    check(two.status === 'live', 'missing from one frame is not gone');
    L.applyFrame(lc, { atMs: at(4), holes: [hole('CH1', 10, -10 + 4 * RATE, 12)] });
    check(two.status === 'closed', 'missing on the near side for four hours, it has closed', two.status);
    L.applyFrame(lc, { atMs: at(8), holes: [hole('CH1', 10, -10 + 8 * RATE, 12), hole('X', -20, 20 + 8 * RATE, 9)] });
    check(two.status === 'live' && lc.lives.length === 2, 'found again within hours, it is the same hole back');

    // Two holes grow into one.
    const lc2 = L.emptyLifecycle();
    L.applyFrame(lc2, { atMs: at(0), holes: [hole('A', 0, 0, 10), hole('B', 0, 13, 8)] });
    L.applyFrame(lc2, { atMs: at(2), holes: [hole('AB', 0, 6 + 2 * RATE, 26)] });
    const a = lc2.lives.find((l) => l.sightings[0].holeId === 'A');
    const b = lc2.lives.find((l) => l.sightings[0].holeId === 'B');
    check(b.status === 'merged' && b.mergedInto === a.number, 'two holes joined: one record carries on, the other is merged into it',
      `${b.status} ${b.mergedInto}`);
    check(a.status === 'live' && a.sightings.length === 2, 'the carrying-on record has the joined hole');
    const tracks = L.lifecycleTracks(lc2);
    check(tracks.length === 1 && tracks[0].number === a.number, 'a merged hole is not forecast twice');

    check(!L.applyFrame(lc2, { atMs: at(1), holes: [] }), 'an older frame is refused');
    check(!L.applyFrame(lc2, { atMs: at(2) + 10 * 60000, holes: [] }), 'a frame too close to the last is refused');
  }

  console.log('\nNinety days, kept small');
  {
    const lc = L.emptyLifecycle();
    for (let h = 0; h <= 200 * 24; h += 2) {
      // A new equatorial hole every 20 days, each living ten.
      const k = Math.floor(h / (20 * 24));
      const age = h - k * 20 * 24;
      const holes = age <= 10 * 24 ? [hole(`H${k}`, 0, -60 + RATE * age, 15)] : [];
      L.applyFrame(lc, { atMs: t0 + h * HOUR, holes });
    }
    const now = t0 + 200 * DAY;
    L.pruneLifecycle(lc, now);
    check(lc.lives.every((l) => (l.endedMs ?? l.lastSeenMs) >= now - 90 * DAY), 'nothing gone longer than 90 days is kept');
    check(lc.lives.length >= 5 && lc.lives.length <= 6, 'the last 90 days of holes are', String(lc.lives.length));
    const old = lc.lives.find((l) => l.lastSeenMs < now - 8 * DAY);
    const gaps = old.sightings.slice(1, -1).map((s, i) => s.atMs - old.sightings[i].atMs);
    check(gaps.every((g) => g >= 6 * HOUR), 'older sightings are thinned to one every six hours');
    const size = JSON.stringify(lc).length;
    check(size < 200000, 'the record stays small', `${size} bytes`);
    const again = L.parseLifecycle(JSON.parse(JSON.stringify(lc)));
    check(again.lives.length === lc.lives.length && again.nextNumber === lc.nextNumber, 'it survives storing');
    check(L.parseLifecycle('nonsense').lives.length === 0, 'a broken record reads as empty');
  }

  console.log('\nThe forecast from the record');
  {
    const now = Date.now();
    const lc = L.emptyLifecycle();
    // A hole that crossed the meridian a day ago, seen for three days.
    for (let h = -72; h <= 0; h += 2) {
      L.applyFrame(lc, { atMs: now + h * HOUR, holes: [hole('CH1', -3, RATE * (h + 24), 25, 0.6)] });
    }
    const [track] = L.lifecycleTracks(lc);
    const s = HS.holeStream(track, now);
    check(s.connection.reachesEarth && s.choice.speedKms > 400, 'an equatorial hole has a stream for Earth', String(s.choice.speedKms));
    check(Math.abs(s.centralMeridianMs - (now - 24 * HOUR)) < 3 * HOUR, 'crossing the meridian when it did');
  }

  // ── the worker ──────────────────────────────────────────────────────────
  console.log('\nThe forecast worker keeps the shared record');
  {
    const store = new Map();
    const kv = {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => { store.set(k, v); },
    };
    const env = { FORECAST_KV: kv };
    globalThis.fetch = async () => new Response('{"snapshots":[]}', { status: 200 });
    const now = Date.now();
    const frames = [];
    for (let h = -48; h <= 0; h += 2) {
      frames.push({ atMs: now + h * HOUR, holes: [hole('CH1', -3, RATE * (h + 30), 22, 0.55), hole('CH2', 75, -20 + RATE * h, 20)] });
    }
    const post = (body) => Wk.default.fetch(new Request('https://w.invalid/ch/observe', {
      method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
    }), env);
    const r1 = await (await post({ frames })).json();
    check(r1.ok && r1.applied === frames.length, 'a device\'s frames are added', JSON.stringify(r1.applied));
    check(r1.lifecycle.lives.length === 2, 'two holes on record');
    const r2 = await (await post({ frames })).json();
    check(r2.applied === 0, 'sending the same frames again adds nothing');
    const bad = await post({ frames: [{ atMs: now + 3 * HOUR, holes: [{ lat: 'x' }, hole('Z', 0, 500, 10)] }, { atMs: 5, holes: [] }] });
    const rb = await bad.json();
    check(rb.ok && rb.lifecycle.lives.length === 2, 'malformed holes and old frames are dropped');
    check((await post('not json')).status === 400, 'a body that is not JSON is refused');
    check((await post('x'.repeat(600 * 1024))).status === 413, 'an oversized body is refused');

    const get = await Wk.default.fetch(new Request('https://w.invalid/ch/lifecycle'), env);
    const g = await get.json();
    check(g.ok && g.lifecycle.lives.length === 2, 'the record can be read back');
    const opt = await Wk.default.fetch(new Request('https://w.invalid/ch/observe', { method: 'OPTIONS' }), env);
    check(/POST/.test(opt.headers.get('Access-Control-Allow-Methods') ?? ''), 'browsers may POST to it');

    const run = await Wk.default.fetch(new Request('https://w.invalid/run'), env);
    const rr = await run.json();
    check(rr.ok, 'the forecast runs', JSON.stringify(rr).slice(0, 300));
    const fc = await (await Wk.default.fetch(new Request('https://w.invalid/forecast'), env)).json();
    const ids = (fc.streams ?? []).map((s) => s.id);
    check(ids.length === 1 && ids[0] === `CH${r1.lifecycle.lives[0].number}`,
      'it forecasts from the record, under the record\'s numbers, and not the polar hole', JSON.stringify(ids));
    check(fc.stale === false, 'and is not stale while the record is fresh');
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
