#!/usr/bin/env node
// The 3D scene draws the coronal holes the Coronal Hole Tracker lists.
//
//   npm run test:scene-holes
//
// The scene used to draw only the newest detection, so a hole the detector
// missed in one frame vanished from the Sun while the tracker, which keeps
// such a hole live for a grace period, still listed it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'scenech-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/chDetectionStore.ts'), '--bundle', '--format=esm',
    `--outfile=${join(out, 's.mjs')}`, '--log-level=error'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const S = await import(pathToFileURL(join(out, 's.mjs')).href);

  const H = 3600000;
  const now = Date.UTC(2026, 8, 24, 12);
  const hole = (id, lat, lon, widthDeg = 20) => ({
    id, lat, lon, widthDeg, heightDeg: 15, estimatedSpeedKms: 600, darkness: 0.6,
    sourceDirectionDeg: { lat, lon }, expansionHalfAngleDeg: 14, opacity: 0.5, hssVisible: true, animPhase: 0,
  });
  const disk = { cx: 0.5, cy: 0.5, r: 0.4 };
  // A hole seen a day ago and never again: long gone.
  S.publishDetection('f-24h', now - 24 * H, [hole('CH_SUVI_0', 30, -40)], disk, 0);
  // Two holes seen twice, then the newest frame misses the second.
  S.publishDetection('f-6h', now - 6 * H, [hole('CH_SUVI_0', -10, -20), hole('CH_SUVI_1', 20, 10)], disk, 0);
  S.publishDetection('f-4h', now - 4 * H, [hole('CH_SUVI_0', -10, -18.9), hole('CH_SUVI_1', 20, 11.1)], disk, 0);
  S.publishDetection('f-0h', now, [hole('CH_SUVI_0', -10, -16.7)], disk, 0);

  const scene = S.holesForScene(S.getChState());
  check(scene && scene.atMs === now, 'anchored at the newest detection');
  const holes = scene?.holes ?? [];
  const current = holes.find((h) => Math.abs(h.lat + 10) < 1);
  check(!!current, 'the hole in the newest frame is drawn');
  check(current && /^CH\d+$/.test(current.id), `under the tracker's number, so the scene finds its history (${current?.id})`);
  const missed = holes.find((h) => Math.abs(h.lat - 20) < 1);
  check(!!missed, 'the hole the newest frame missed is still drawn', JSON.stringify(holes.map((h) => [h.id, h.lat, h.lon])));
  check(missed && Math.abs(missed.lon - (11.1 + 13.2 * 4 / 24)) < 0.5,
    `carried forward with the Sun's rotation (${missed?.lon.toFixed(1)})`);
  check(missed && /^CH\d+$/.test(missed.id), `named as the tracker names it (${missed?.id})`);
  check(!holes.some((h) => Math.abs(h.lat - 30) < 1), 'a hole last seen a day ago is not');
  check(holes.length === 2, `and nothing is drawn twice (${holes.length})`);

  // A track from the 90-day record: measured at times this session never
  // detected (another device, an earlier visit), and under another id. Its
  // outline still has to be found, by where the hole is.
  const recordTrack = {
    key: 'CH200', number: 200, live: true, present: true,
    points: [{ atMs: now - 30 * 60000, hole: { id: 'CH_SUVI_7', lat: -10.5, lon: -17, widthDeg: 20, darkness: 0.6 } }],
    firstSeenMs: now - 30 * 60000, lastSeenMs: now - 30 * 60000,
    latest: { id: 'CH_SUVI_7', lat: -10.5, lon: -17, widthDeg: 20, darkness: 0.6 },
  };
  const drawn = S.drawableHoles(S.getChState(), [recordTrack], now);
  check(drawn.length === 1 && drawn[0].hole.id === 'CH_SUVI_0' && drawn[0].trackKey === 'CH200',
    'a record track with no measurement from this session is still outlined', JSON.stringify(drawn.map((d) => d.hole.id)));
  const far = { ...recordTrack, key: 'CH201', latest: { ...recordTrack.latest, lat: 50 },
    points: [{ ...recordTrack.points[0], hole: { ...recordTrack.latest, lat: 50 } }] };
  check(S.drawableHoles(S.getChState(), [far], now).length === 0, 'but not with some other hole\'s outline');
} catch (err) {
  fail++;
  console.error(err);
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
