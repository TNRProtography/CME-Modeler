#!/usr/bin/env node
// The next-three-days grid: NOAA's Kp on the app's own visibility scale,
// the stronger of NOAA, the tracker's streams and the CME model per
// three-hour block, and the sky applied. Plus the "likely" outlook now
// averaging coupling over the field's swings.
//
//   npm run test:three-day-grid

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'grid3-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

try {
  const entry = join(out, 'entry.ts');
  writeFileSync(entry, [
    `export * from '${join(root, 'utils/kpVisibility.ts')}';`,
    `export * from '${join(root, 'utils/threeDayGrid.ts')}';`,
    `export { newellCoupling, expectedNewellCoupling, buildOutlook } from '${join(root, 'utils/auroraOutlook.ts')}';`,
    `export { buildForecastTimeline } from '${join(root, 'utils/forecastTimeline.ts')}';`,
    `export { computeOvalBoundary } from '${join(root, 'utils/ovalPhysics.ts')}';`,
  ].join('\n'));
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${join(out, 'g.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const G = await import(pathToFileURL(join(out, 'g.mjs')).href);
  const HOUR = 3600000;

  console.log('Kp on the model\'s scale');
  // The same pins scripts/test-aurora-visibility.mjs holds the model to.
  for (const [kp, n] of [[1, 3200], [3, 9800], [5, 18000], [7, 26000]]) {
    check(G.newellForKp(kp) === n, `Kp ${kp} is coupling ${n}, the model's own anchor`);
  }
  let mono = true;
  for (let k = 0; k < 9; k += 0.33) if (G.newellForKp(k + 0.33) < G.newellForKp(k)) mono = false;
  check(mono, 'higher Kp never means less');
  const t0 = Date.UTC(2026, 8, 10, 12);
  check(G.boundaryForKp(5, t0) === G.computeOvalBoundary({ newell_avg_60m: 18000, newell_avg_30m: 18000 }, false, new Date(t0)),
    'the boundary comes from the same oval physics as the live forecast');

  console.log('\nNOAA\'s feed, both shapes');
  const objs = G.parseNoaaKpForecast([{ time_tag: '2026-09-10T12:00:00', kp: 4.67, observed: 'predicted' }]);
  const arrs = G.parseNoaaKpForecast([['time_tag', 'kp', 'observed', 'noaa_scale'], ['2026-09-10 12:00:00', '4.67', 'predicted', null]]);
  check(objs.length === 1 && objs[0].startMs === t0 && objs[0].kp === 4.67, 'objects, read as UTC');
  check(arrs.length === 1 && arrs[0].startMs === t0 && arrs[0].endMs === t0 + 3 * HOUR, 'header and rows, read as UTC');
  check(G.parseNoaaKpForecast(null).length === 0 && G.parseNoaaKpForecast('x').length === 0, 'nonsense is nothing');

  console.log('\nThe grid');
  const greymouth = { latitude: -42.45, longitude: 171.21 };
  const now = Date.UTC(2026, 8, 10, 0);   // noon 10 Sept NZST; the Moon is new on the 11th
  const kpBlocks = [];
  for (let t = now - 6 * HOUR; t < now + 4 * 86400000; t += 3 * HOUR) {
    // Kp 5 over the night of the 10th into the 11th (UT 12-15 is 00-03 NZST), quiet otherwise.
    kpBlocks.push({ startMs: t, endMs: t + 3 * HOUR, kp: t === Date.UTC(2026, 8, 10, 12) ? 5 : 1.33, observed: 'predicted' });
  }
  const quietOutlook = G.buildOutlook(G.buildForecastTimeline([], [], { fromMs: now - HOUR, toMs: now + 4 * 86400000, stepMs: HOUR }));
  const grid = G.buildThreeDayGrid({ nowMs: now, ...greymouth, kpBlocks, holeOutlook: quietOutlook, cmeOutlook: [] });
  check(grid.length === 3 && grid.every((d) => d.cells.length === 8), 'three days of eight three-hour blocks');
  check(grid[0].cells.map((c) => c.startHour).join(',') === '0,3,6,9,12,15,18,21', 'blocks on the New Zealand clock');
  check(grid[0].cells[0].past && grid[0].cells[3].past && !grid[0].cells[4].past, 'blocks already gone are marked past');
  const noon = grid[0].cells[4];
  check(noon.darkness === 'daylight' && noon.tier === 'none', 'midday is daylight, nothing to see');
  const storm = grid[1].cells[0];   // 00-03 on the 11th
  check(storm.driver === 'NOAA Kp' && storm.kp === 5, 'the Kp 5 block is set by NOAA', JSON.stringify(storm));
  check(storm.tier === 'eye' || storm.tier === 'phone', `Kp 5 on a moonless night is worth going out for from Greymouth (${storm.tier} ${storm.effective})`);
  const quiet = grid[1].cells[1];  // 03-06, back to Kp 1.33
  check(quiet.tier === 'none', `a Kp 1.33 block is nothing from Greymouth (${quiet.effective})`);
  check(G.bestCell(grid)?.startMs === storm.startMs, 'the best block ahead is the storm');

  // A coronal hole stream the tracker has arriving: it lifts the blocks it covers above a quiet NOAA.
  const cm = now - 2 * 86400000;
  const streamOutlook = G.buildOutlook(G.buildForecastTimeline([], [{
    id: 'x', centralMeridianMs: cm, peakSpeedKms: 750, widthDeg: 30, bySign: null, earthConnection: 1,
  }], { fromMs: now - HOUR, toMs: now + 4 * 86400000, stepMs: HOUR }));
  const quietKp = kpBlocks.map((b) => ({ ...b, kp: 1 }));
  const withStream = G.buildThreeDayGrid({ nowMs: now, ...greymouth, kpBlocks: quietKp, holeOutlook: streamOutlook, cmeOutlook: [] });
  const lifted = withStream.flatMap((d) => d.cells).filter((c) => c.driver === 'coronal hole' && c.tier !== 'none');
  check(lifted.length > 0, `the stream shows as visible blocks when NOAA is quiet (${lifted.length})`);

  // The Moon costs a full-Moon night: the same Kp 5, two weeks later.
  const fullNow = now + 15 * 86400000;
  const fullKp = kpBlocks.map((b) => ({ ...b, startMs: b.startMs + 15 * 86400000, endMs: b.endMs + 15 * 86400000 }));
  const fullGrid = G.buildThreeDayGrid({ nowMs: fullNow, ...greymouth, kpBlocks: fullKp, holeOutlook: [], cmeOutlook: [] });
  const fullStorm = fullGrid[1].cells[0];
  check(fullStorm.moonUp ? fullStorm.effective < storm.effective : true,
    `under a full Moon the same Kp 5 scores lower (${fullStorm.effective} vs ${storm.effective})`);

  console.log('\nSensitivity: the likely case averages over the field\'s swings');
  check(G.expectedNewellCoupling(600, 4, 0, 0) === G.newellCoupling(600, 4, 0), 'no swing: the same as before');
  check(G.expectedNewellCoupling(600, 4, 0, 3) > G.newellCoupling(600, 4, 0), 'swings add coupling (their southward half drives)');
  check(G.expectedNewellCoupling(600, 4, -3, 0) > G.expectedNewellCoupling(600, 4, 0, 3),
    'but a field held south drives more than one only swinging through it');
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
