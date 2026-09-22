#!/usr/bin/env node
// Growing HSS streams: the stream is the wind the hole has actually emitted.
//
// Nothing before the hole's first reading; a young stream reaches exactly as
// far as its wind has travelled; each reading's wind keeps its own speed;
// faster wind piles up behind slower wind instead of passing it; a closed
// hole's last wind detaches and drifts; and the spiral is the Sun turning
// away from wind that left it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'hssp-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/hssParcels.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'p.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const { streamParcels, unitsPerKmFor } = await import(pathToFileURL(join(out, 'p.mjs')).href);
  execFileSync('npx', ['esbuild', join(root, 'utils/coronalHoleHistory.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'h.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const { buildEvolutionTracks, chMeasuredSpan } = await import(pathToFileURL(join(out, 'h.mjs')).href);

  const H = 3600000;
  const T0 = Date.UTC(2026, 8, 20);
  const upk = unitsPerKmFor(3);
  const opts = (nowMs, extra = {}) => ({ nowMs, count: 200, r0: 0.1, reach: 4.95, unitsPerKm: upk, omega: 2.666e-6, ...extra });
  const hole = (speed, lon = 0) => ({ lat: 0, lon, widthDeg: 20, heightDeg: 20, darkness: 0.5, estimatedSpeedKms: speed });
  const steady = (speed, firstMs, lastMs = null) => ({ firstMs, lastMs, stateAt: () => hole(speed) });
  const kmPerS = (units) => units / upk;

  console.log('\nA new hole grows its stream at the wind speed');
  check(streamParcels(steady(600, T0), opts(T0 - H)).length === 0, 'nothing before the first reading');
  let ps = streamParcels(steady(600, T0), opts(T0 + 10 * H));
  const front = ps[ps.length - 1].r;
  const expected = 0.1 + 600 * upk * 10 * 3600;
  check(Math.abs(front - expected) < 1e-3, `after 10 h the front is 600 km/s × 10 h out (${front.toFixed(4)} vs ${expected.toFixed(4)})`);
  check(Math.abs(ps[0].r - 0.1) < 1e-3, 'and the stream still starts at the Sun');
  const later = streamParcels(steady(600, T0), opts(T0 + 20 * H));
  check(later[later.length - 1].r > front * 1.8, 'ten hours later it has reached twice as far');

  console.log('\nThe Parker spiral comes from the Sun turning');
  const lag = ps[0].az - ps[ps.length - 1].az;
  check(Math.abs(lag - 2.666e-6 * 10 * 3600) < 1e-3, `the oldest wind lags its source by the Sun's turn in 10 h (${(lag * 180 / Math.PI).toFixed(2)}°)`);

  console.log('\nEach reading keeps its own speed');
  const stepped = { firstMs: T0, lastMs: null, stateAt: (ms) => hole(ms < T0 + 12 * H ? 400 : 700) };
  ps = streamParcels(stepped, opts(T0 + 16 * H));
  const old = ps.filter((p) => p.emittedMs < T0 + 6 * H);
  const young = ps.filter((p) => p.emittedMs > T0 + 13 * H);
  check(old.every((p) => p.state.estimatedSpeedKms === 400) && young.every((p) => p.state.estimatedSpeedKms === 700),
    'wind keeps the speed it left with');

  console.log('\nFast wind piles up behind slow wind');
  // Slow for a day, then fast: by two days on, the fast wind has caught up.
  const catchUp = { firstMs: T0, lastMs: null, stateAt: (ms) => hole(ms < T0 + 24 * H ? 350 : 800) };
  ps = streamParcels(catchUp, opts(T0 + 60 * H));
  let monotonic = true;
  for (let i = 1; i < ps.length; i++) if (ps[i].r < ps[i - 1].r) monotonic = false;
  check(monotonic, 'no parcel overtakes the one ahead of it');
  const peak = Math.max(...ps.map((p) => p.compression));
  check(peak > 0.5, `the catch-up is marked as compression (${peak.toFixed(2)})`);
  const calm = streamParcels(steady(600, T0), opts(T0 + 60 * H));
  check(Math.max(...calm.map((p) => p.compression)) < 0.05, 'steady wind is not compressed');

  console.log('\nA closed hole leaves a detached stream');
  ps = streamParcels(steady(600, T0, T0 + 24 * H), opts(T0 + 40 * H));
  const gapStart = ps[0].r;
  const expectGap = 0.1 + 600 * upk * 16 * 3600;
  check(Math.abs(gapStart - expectGap) < 1e-2, `its near end has left the Sun: ${gapStart.toFixed(3)} (expected ${expectGap.toFixed(3)})`);
  check(streamParcels(steady(600, T0, T0 + 24 * H), opts(T0 + 30 * 24 * H)).length === 0, 'and in the end it leaves the scene entirely');

  console.log('\nHoles that have closed still have their wind tracked');
  {
    const now = T0 + 72 * H;
    const rate = 13.2 / 24;   // Stonyhurst drift, deg per hour, near enough for matching
    const rec = (hAgo, holes) => ({ timestamp: '', timestampMs: now - hAgo * H, source: 'live', imageUrl: '',
      coronalHoles: holes.map(([id, lat, lonNow]) => ({ id, lat, lon: lonNow - rate * hAgo, widthDeg: 20, heightDeg: 20, darkness: 0.5, estimatedSpeedKms: 600 })) });
    // Open hole at lon 10 throughout; a second at lon -50 seen 60h-30h ago; a
    // one-off blip at lon 60, 20h ago.
    const history = { snapshots: [
      rec(60, [['a', 0, 10], ['b', 20, -50]]), rec(50, [['a', 0, 10], ['b', 20, -50]]),
      rec(40, [['a', 0, 10], ['b', 20, -50]]), rec(30, [['a', 0, 10], ['b', 20, -50]]),
      rec(20, [['a', 0, 10], ['c', -20, 60]]), rec(10, [['a', 0, 10]]),
    ], count: 6, oldestMs: now - 60 * H, newestMs: now - 10 * H, maxHours: 168 };
    const live = [{ id: 'CH_SUVI_0', lat: 0, lon: 10, widthDeg: 20, heightDeg: 20, darkness: 0.5, estimatedSpeedKms: 600,
      sourceDirectionDeg: { lat: 0, lon: 10 }, expansionHalfAngleDeg: 12, opacity: 0.6, hssVisible: true, animPhase: 0 }];
    const tracks = buildEvolutionTracks(history, live, now);
    const closed = tracks.filter((t) => t.trackId.startsWith('Closed'));
    check(tracks.some((t) => t.trackId === 'CH_SUVI_0'), 'the open hole keeps its track');
    check(closed.length === 1, `one closed hole found, the blip ignored (${closed.map((t) => t.trackId)})`);
    const span = closed[0] && chMeasuredSpan(closed[0]);
    check(span && span.firstMs === now - 60 * H && span.lastMs === now - 30 * H, 'its track runs from first to last sighting');
  }
} catch (err) {
  fail++;
  console.error(err);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
