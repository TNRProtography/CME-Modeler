#!/usr/bin/env node
// The CMEs on the STEREO J-plot's Sun-Earth guide: only the ones the CME
// Visualization has reaching Earth, each front where the scene draws it, and
// arriving when the scene and the 3-day forecast say.
//
//   npm run test:jplot-cmes

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'jplotcmes-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

try {
  const bundle = (entry, name) => execFileSync('npx', ['esbuild', join(root, entry), '--bundle', '--format=esm', '--define:import.meta.env={}',
    `--outfile=${join(out, name)}`, '--log-level=error'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  bundle('utils/jplotCmes.ts', 'j.mjs');
  bundle('utils/cmeEarthArrivals.ts', 'c.mjs');
  bundle('utils/cmePropagation.ts', 'p.mjs');
  const J = await import(pathToFileURL(join(out, 'j.mjs')).href);
  const C = await import(pathToFileURL(join(out, 'c.mjs')).href);
  const P = await import(pathToFileURL(join(out, 'p.mjs')).href);
  const H = 3600000;
  const t0 = Date.UTC(2026, 9, 6, 12);
  const FOVS = [{ key: 'hi1', startAu: 0.056, endAu: 0.391 }, { key: 'hi2', startAu: 0.307, endAu: 1.479 }];
  const cme = (o) => ({ id: 'x', startTime: new Date(t0), speed: 800, longitude: 0, latitude: 0, halfAngle: 30, ...o });
  const arrivalsOf = (list) => list.map(C.cmeEarthArrival).filter(Boolean);

  console.log('Only the CMEs the visualization has reaching Earth');
  const list = [cme({ id: 'head-on' }), cme({ id: 'miss', longitude: 70 }), cme({ id: 'unknown-direction', longitudeMeasured: false })];
  const shown = J.jplotCmes(arrivalsOf(list), t0 + 10 * H, FOVS);
  check(shown.length === 1 && shown[0].id === 'head-on', 'one aimed elsewhere, or with no measured direction, is left off', JSON.stringify(shown.map((c) => c.id)));

  console.log('\nThe front is where the scene draws it');
  const a = C.cmeEarthArrival(cme({}));
  const now = t0 + 10 * H;
  const [c] = J.jplotCmes([a], now, FOVS);
  check(Math.abs(c.distanceAu - P.cmeDistanceAU(800, 10 * 3600)) < 1e-12, `the same propagation: ${c.distanceAu.toFixed(3)} AU after 10 h`);
  check(c.arrivalMs === a.arrivalMs, 'arriving when the scene and the 3-day forecast say');
  check(Math.abs(P.cmeDistanceAU(800, (c.arrivalMs - t0) / 1000) - 1) < 1e-6, 'which is when its front is at 1 AU');
  check(c.speedNowKms < 800 && c.speedNowKms >= P.MIN_CME_SPEED_KMS, `a fast one has slowed: ${Math.round(c.speedNowKms)} km/s`);
  check(c.progress > 0 && c.progress < 1 && !c.arrived, 'on its way');
  const later = J.jplotCmes([a], now + 6 * H, FOVS)[0];
  check(later.distanceAu > c.distanceAu && later.progress > c.progress, 'and further along later');

  console.log('\nFrom launch until a day after it arrives');
  check(J.jplotCmes([a], t0 - H, FOVS).length === 0, 'not before it leaves the Sun');
  const justIn = J.jplotCmes([a], a.arrivalMs + 5 * H, FOVS)[0];
  check(justIn && justIn.arrived && justIn.progress === 1 && justIn.distanceAu > 1, 'arrived, and drawn past Earth');
  check(J.jplotCmes([a], a.arrivalMs + J.JPLOT_KEEP_AFTER_ARRIVAL_MS + H, FOVS).length === 0, 'gone once its storm is over');
  check(J.JPLOT_KEEP_AFTER_ARRIVAL_MS === C.CME_FULL_MS + C.CME_EASE_MS, 'which is as long as the forecast counts its storm');

  console.log('\nWhich J-plot to look on');
  const at = (au) => t0 + P.cmeTransitSeconds(800, au) * 1000;
  const inView = (ms, key) => J.jplotCmes([a], ms, FOVS)[0].views.find((v) => v.key === key).inViewNow;
  check(!inView(t0 + 60000, 'hi1'), 'just launched: not yet in HI1');
  check(inView(at(0.2), 'hi1') && !inView(at(0.2), 'hi2'), 'at 0.2 AU: in HI1 only');
  check(inView(at(0.35), 'hi1') && inView(at(0.35), 'hi2'), 'at 0.35 AU: where the two overlap, in both');
  check(!inView(at(0.6), 'hi1') && inView(at(0.6), 'hi2'), 'at 0.6 AU: in HI2 only');
  const hi1 = c.views.find((v) => v.key === 'hi1');
  check(Math.abs(P.cmeDistanceAU(800, (hi1.enterMs - t0) / 1000) - 0.056) < 1e-6
    && Math.abs(P.cmeDistanceAU(800, (hi1.leaveMs - t0) / 1000) - 0.391) < 1e-6, 'it enters and leaves a view where the range starts and ends');

  console.log('\nSoonest first');
  const slow = C.cmeEarthArrival(cme({ id: 'slow', speed: 450, startTime: new Date(t0 - 24 * H) }));
  const fast = C.cmeEarthArrival(cme({ id: 'fast', speed: 1600 }));
  const order = J.jplotCmes([slow, fast, a], t0 + 2 * H, FOVS).map((x) => x.id);
  const byArrival = [slow, fast, a].sort((x, y) => x.arrivalMs - y.arrivalMs).map((x) => x.id);
  check(JSON.stringify(order) === JSON.stringify(byArrival), `in order of arrival: ${order.join(', ')}`);

  console.log('\nThe panel and the forecast share one list');
  const panel = readFileSync(join(root, 'components/StereoJPlotsPanel.tsx'), 'utf8');
  const outlook = readFileSync(join(root, 'hooks/useThreeDayOutlook.ts'), 'utf8');
  check(/useCmeEarthArrivals\(\)/.test(panel) && /useCmeEarthArrivals\(\)/.test(outlook), 'both read useCmeEarthArrivals');
  check(/jplotCmes\(/.test(panel), 'the panel places them with jplotCmes');
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
