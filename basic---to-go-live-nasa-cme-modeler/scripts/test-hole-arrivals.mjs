#!/usr/bin/env node
// "What to expect in the next couple of days" lists exactly the coronal holes
// the Coronal Hole Tracker has reaching Earth - the same function decides for
// both (utils/holeForecast). This builds a week of tracked holes and checks
// the list against the tracker's own verdict for each.
//
//   npm run test:hole-arrivals

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'holearr-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/holeForecast.ts'), '--bundle', '--format=esm',
    `--outfile=${join(out, 'h.mjs')}`, '--log-level=error'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const H = await import(pathToFileURL(join(out, 'h.mjs')).href);

  const HOUR = 3600000;
  const now = Date.UTC(2026, 8, 25, 1, 0);   // 25 Sept, early afternoon in NZ
  const ROT = 13.2 / 24;                     // degrees of longitude per hour
  // Frames every two hours for a day and a half, each hole drifting west.
  const hole = (id, lat, lonNow, t, widthDeg = 25, darkness = 0.7) =>
    ({ id, lat, lon: lonNow - ROT * (now - t) / HOUR, widthDeg, heightDeg: 15, darkness });
  const history = [];
  for (let t = now - 36 * HOUR; t <= now; t += 2 * HOUR) {
    history.push({ atMs: t, holes: [
      hole('CH_SUVI_0', -2, 20, t),          // near the equator, just past the middle: coming
      hole('CH_SUVI_1', 75, -5, t),          // polar: its wind goes over the top of us
      hole('CH_SUVI_2', -43, 26, t),         // like CH1351: 43 S, 50 from Earth's latitude
      hole('CH_SUVI_3', 5, -70, t),          // just round the east limb: a week away
    ] });
  }
  const state = { detections: [], history, progress: null, error: null };
  const tracks = H.tracksFromStore(state);
  check(tracks.length === 4, 'four holes tracked', `${tracks.length}`);

  const opts = { nowMs: now, latestFrameMs: now, latitude: -42.45, longitude: 171.21 };
  const due = H.holesDueWithin(tracks, { ...opts, horizonMs: 3 * 86400000, polarityOf: () => null });
  const lat = (d) => Math.round(d.track.latest.lat);
  const dueLats = due.map(lat);

  // The tracker's own verdict for each hole, one at a time.
  const verdict = new Map(tracks.map((t) => [Math.round(t.latest.lat), H.forecastHole(t, { ...opts, polarity: null })]));
  for (const [l, f] of verdict) {
    const inWindow = f.arrival != null && f.windowToMs >= now && f.windowFromMs <= now + 3 * 86400000;
    check(dueLats.includes(l) === inWindow,
      `hole at ${l}°: listed exactly when the tracker has it reaching Earth in 3 days`,
      `listed=${dueLats.includes(l)} tracker=${inWindow} arrival=${f.arrival && new Date(f.arrival).toISOString()}`);
  }
  check(dueLats.includes(-2), 'the equatorial hole past the middle is listed');
  check(dueLats.includes(-43), 'the 43° S hole the tracker forecasts (like CH1351) is listed');
  check(!dueLats.includes(75), 'the polar hole is not');
  check(!dueLats.includes(5), 'the hole still at the east limb is not: its stream is a week away');

  const eq = due.find((d) => lat(d) === -2);
  check(eq && eq.forecast.arrival === verdict.get(-2).arrival, 'same arrival time as the tracker shows');
  check(eq && eq.forecast.choice.speedKms === verdict.get(-2).choice.speedKms, 'same speed as the tracker shows');
  check(due.every((d, i) => i === 0 || d.forecast.arrival >= due[i - 1].forecast.arrival), 'soonest first');

  // Polarity is matched by frame, not by a reused id.
  const shared = { CH_SUVI_0: { polarity: 'negative', sector: 'toward', confidence: 'good', summary: 'x' } };
  const eqTrack = tracks.find((t) => Math.round(t.latest.lat) === -2);
  check(H.polarityForTrack(eqTrack, shared, now) === shared.CH_SUVI_0, 'polarity applies to the hole it was read for');
  check(H.polarityForTrack(eqTrack, shared, now - 2 * HOUR) === null, 'but not from a reading of another frame');
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
