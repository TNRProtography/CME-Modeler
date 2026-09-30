#!/usr/bin/env node
// The CME list: which DONKI CMEs the app shows, and what it does with a CME
// whose analysis has no longitude (a plane-of-sky measurement from one
// coronagraph).
//
//   npm run test:cme-list

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'cmelist-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

try {
  const entry = join(out, 'entry.ts');
  writeFileSync(entry, `export { processCMEData, sourceLongitude } from ${JSON.stringify(join(root, 'services/nasaService.ts'))};\n`
    + `export { cmeEarthArrival } from ${JSON.stringify(join(root, 'utils/cmeEarthArrivals.ts'))};\n`);
  execFileSync('npx', ['esbuild', entry, '--bundle', '--format=esm', `--outfile=${join(out, 'l.mjs')}`,
    '--log-level=error', '--define:import.meta.env={}', '--platform=neutral'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const L = await import(pathToFileURL(join(out, 'l.mjs')).href);

  const a = (x) => [{ isMostAccurate: true, halfAngle: 20, ...x }];
  const donki = [
    { activityID: '2026-09-29T18:36:00-CME-001', startTime: '2026-09-29T18:36Z', sourceLocation: '',
      cmeAnalyses: a({ latitude: 82, longitude: null, speed: 511, halfAngle: 10 }) },
    { activityID: '2026-09-28T16:18:00-CME-001', startTime: '2026-09-28T16:18Z', sourceLocation: 'S15W40',
      cmeAnalyses: a({ latitude: -17, longitude: null, speed: 581 }) },
    { activityID: '2026-09-28T14:36:00-CME-001', startTime: '2026-09-28T14:36Z', sourceLocation: 'N27W50',
      cmeAnalyses: a({ latitude: 15, longitude: 29, speed: 447, halfAngle: 45 }) },
    { activityID: 'no-speed', startTime: '2026-09-28T10:00Z', cmeAnalyses: a({ latitude: 10, longitude: null, speed: null }) },
    { activityID: 'no-analysis', startTime: '2026-09-28T09:00Z', cmeAnalyses: [] },
  ];
  const list = L.processCMEData(donki);
  const by = Object.fromEntries(list.map((c) => [c.id, c]));

  console.log('\nA CME with no longitude is listed');
  const pos = by['2026-09-29T18:36:00-CME-001'];
  check(!!pos, 'the plane-of-sky CME of 29 Sep 18:36 is in the list');
  check(pos && pos.longitudeMeasured === false && pos.latitude === 82 && pos.speed === 511, 'flagged as having no measured longitude, with its latitude and speed');
  check(pos && pos.isEarthDirected === false, 'never Earth-directed');
  check(pos && pos.longitude === 0, 'drawn at 0 when there is no source region');
  check(by['2026-09-28T16:18:00-CME-001']?.longitude === 40, 'drawn at its source region\'s longitude when there is one');
  check(L.cmeEarthArrival(pos) === null && L.cmeEarthArrival({ ...by['2026-09-28T16:18:00-CME-001'] }) === null,
    'and never counted as arriving at Earth');
  check(list[0].id === '2026-09-29T18:36:00-CME-001', 'newest first');

  console.log('\nThe rest as before');
  const full = by['2026-09-28T14:36:00-CME-001'];
  check(full && full.longitudeMeasured === true && full.longitude === 29 && full.isEarthDirected === true, 'a full analysis: measured, Earth-directed within 45 degrees');
  check(!by['no-speed'] && !by['no-analysis'], 'no speed or no analysis: not listed');
  check(L.sourceLongitude('N27W50') === 50 && L.sourceLongitude('S10E30') === -30 && L.sourceLongitude('') === null, 'source regions read west-positive');
} catch (err) {
  fail++;
  console.error(err);
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
