#!/usr/bin/env node
// Two weeks of sunspot history, every change timestamped.
//
//   npm run test:sunspot-history
//
// Runs the worker itself against sample NOAA bulletins, SHARPs and flares,
// with KV and the network replaced, over several days.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'ssh-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const H = 3600000, DAY = 24 * H;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** An SRS issued at 0030 on the day of `dayMs`, valid at 2400Z the day before. */
const srs = (dayMs, rows) => {
  const d = new Date(dayMs), prev = new Date(dayMs - DAY);
  return [
    `:Product: Solar Region Summary`,
    `:Issued: ${d.getUTCFullYear()} ${MON[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')} 0030 UTC`,
    `I.  Regions with Sunspots.  Locations Valid at ${String(prev.getUTCDate()).padStart(2, '0')}/2400Z`,
    `Nmbr Location  Lo  Area  Z   LL   NN Mag Type`,
    ...rows,
    `IA. H-alpha Plages without Spots.  Locations Valid at ${String(prev.getUTCDate()).padStart(2, '0')}/2400Z`,
    `Nmbr  Location  Lo`,
    `4999  N05E10   100`,
    `II. Regions Due to Return 02 Oct to 04 Oct`,
  ].join('\n');
};

try {
  execFileSync('npx', ['esbuild', join(root, 'worker/sunspot-history-worker.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'w.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const W = await import(pathToFileURL(join(out, 'w.mjs')).href);

  const kv = new Map();
  const env = {
    SUNSPOT_HISTORY: {
      get: async (k) => (kv.has(k) ? JSON.parse(kv.get(k)) : null),
      put: async (k, v) => { kv.set(k, v); },
    },
    DONKI: { fetch: async () => new Response(JSON.stringify(world.flares)) },
  };
  // What the outside world says, changed between runs.
  const world = { srs: '', regionsJson: [], sharp: null, flares: [] };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('solar-regions.txt')) return new Response(world.srs);
    if (u.includes('solar_regions.json')) return new Response(JSON.stringify(world.regionsJson));
    if (u.includes('jsoc')) return world.sharp ? new Response(JSON.stringify(world.sharp)) : new Response('', { status: 500 });
    return new Response('', { status: 404 });
  };
  const sharp = (points) => ({ keywords: [
    { name: 'T_REC', values: points.map(p => new Date(p.at + 37000).toISOString().replace(/-/g, '.').replace('T', '_').slice(0, 19) + '_TAI') },
    { name: 'HARPNUM', values: points.map(() => '13000') },
    { name: 'NOAA_AR', values: points.map(() => '14538') },
    { name: 'USFLUX', values: points.map(p => String(p.flux)) },
    { name: 'AREA_ACR', values: points.map(p => String(p.area)) },
    { name: 'LAT_FWT', values: points.map(() => '12') },
    { name: 'LON_FWT', values: points.map(() => '-20') },
  ] });
  const api = async (path) => (await W.default.fetch(new Request(`https://x${path}`), env, { waitUntil() {} })).json();

  const D0 = Date.UTC(2026, 8, 20);

  console.log('\nFirst run: NOAA history backfills the days before the worker existed');
  world.regionsJson = [
    { region: 14538, observed_date: '2026-09-17', location: 'N12E40', area: 60, spot_class: 'Cao', extent: 4, number_spots: 3, mag_class: 'B' },
    { region: 14538, observed_date: '2026-09-18', location: 'N12E27', area: 120, spot_class: 'Dai', extent: 8, number_spots: 9, mag_class: 'BG' },
    { region: 14538, observed_date: '2026-09-19', location: 'N12E14', area: 120, spot_class: 'Dai', extent: 8, number_spots: 9, mag_class: 'BG', c_flare_probability: 40, m_flare_probability: 10, x_flare_probability: 1 },
    // Older than two weeks: not kept.
    { region: 14400, observed_date: '2026-08-20', location: 'S10W80', area: 30, number_spots: 2, mag_class: 'A' },
  ];
  world.srs = srs(D0, ['4538 N12E01   210  0250 Dkc  10   18 Beta-Gamma-Delta']);
  world.sharp = sharp([{ at: D0 - 2 * H, flux: 1.0e22, area: 400 }, { at: D0 - H, flux: 1.02e22, area: 405 }]);
  world.flares = [{ flrID: '2026-09-19T22:00:00-FLR-001', classType: 'M1.4', beginTime: '2026-09-19T21:50Z', peakTime: '2026-09-19T22:00Z', activeRegionNum: 14538, sourceLocation: 'N12E05' }];
  let status = await W.run(env, D0 + H);
  check(status.sources.srs && status.sources.sharp && status.sources.flares, 'every source was read', JSON.stringify(status.sources));
  let r = (await api('/api/region/4538')).region;
  check(r?.firstSeenMs === Date.UTC(2026, 8, 17), 'the region is known from the day NOAA first listed it, not from today');
  const kinds = r.events.map(e => e.kind);
  check(kinds[0] === 'appeared' && kinds.filter(k => k === 'changed').length >= 2, `its days are there as changes (${kinds.join(', ')})`);
  const grew = r.events.find(e => e.changes?.areaMsh?.[1] === 120);
  check(grew?.atMs === Date.UTC(2026, 8, 18) && grew.changes.spotCount[0] === 3 && grew.changes.spotCount[1] === 9,
        'each change has its time, and the before and after', JSON.stringify(grew));
  const srsChange = r.events.find(e => e.source === 'srs');
  check(srsChange?.atMs === D0 && srsChange.changes.magClass[1] === 'Beta-Gamma-Delta' && srsChange.changes.mcintosh[1] === 'Dkc',
        "today's bulletin is timed to when its positions were valid (2400Z), and names what changed", JSON.stringify(srsChange));
  check(r.events.some(e => e.kind === 'flare' && e.flareClass === 'M1.4'), 'its flare is on its timeline');
  check(r.sharp.length === 2 && r.sharp[1].usfluxMx === 1.02e22, 'and its hourly magnetic flux');
  check(!(await api('/api/regions')).regions.some(x => x.id === '4400'), 'a region gone for over two weeks is not kept');
  check(!(await api('/api/regions')).regions.some(x => x.id === '4999'), 'a spotless plage region is not a sunspot region');
  check(r.current.cFlareProbability === 40, "NOAA's flare chances ride along");

  console.log('\nThe same bulletin again changes nothing');
  const before = r.events.length;
  await W.run(env, D0 + 2 * H);
  r = (await api('/api/region/4538')).region;
  check(r.events.length === before, `still ${before} events after a run where nothing changed`, String(r.events.length));
  check(r.events.filter(e => e.kind === 'flare').length === 1, 'and the flare is logged once, however often it is fetched');

  console.log('\nFlux emerging is logged within the hour');
  world.sharp = sharp([{ at: D0 + 2 * H, flux: 1.05e22, area: 410 }, { at: D0 + 3 * H, flux: 1.2e22, area: 470 }]);
  await W.run(env, D0 + 3.5 * H);
  r = (await api('/api/region/4538')).region;
  const flux = r.events.filter(e => e.kind === 'flux');
  check(flux.length === 1 && flux[0].atMs === D0 + 3 * H, 'a 20% rise in flux is an event, at the hour it was measured', JSON.stringify(flux));
  check(r.sharp.length === 4, 'and the series has every hour once', String(r.sharp.length));

  console.log('\nNext day: changes, a newcomer, and a region rotating off');
  world.srs = srs(D0 + DAY, [
    '4538 N12W12   210  0310 Ekc  13   24 Beta-Gamma-Delta',
    '4540 S20E70   080  0030 Hsx  02   01 Alpha',
  ]);
  await W.run(env, D0 + DAY + H);
  r = (await api('/api/region/4538')).region;
  const day2 = r.events.filter(e => e.atMs === D0 + DAY);
  check(day2.length === 1 && day2[0].changes.areaMsh[0] === 250 && day2[0].changes.areaMsh[1] === 310 && !day2[0].changes.magClass,
        'only what changed is listed', JSON.stringify(day2));
  const nu = (await api('/api/region/4540')).region;
  check(nu?.events[0].kind === 'appeared' && nu.firstSeenMs === D0 + DAY, 'a new region appears on the day it was first listed');
  world.srs = srs(D0 + 2 * DAY, ['4540 S20E57   080  0040 Hsx  02   01 Alpha']);
  await W.run(env, D0 + 2 * DAY + H);
  r = (await api('/api/region/4538')).region;
  check(r.active === false && r.events[r.events.length - 1].kind === 'gone', 'one dropped from the list is marked gone, and kept');
  check((await api('/api/regions?active=1')).regions.every(x => x.active), 'the active filter shows only the ones still listed');

  console.log('\nThe tracker\'s growth read is rebuilt from the changes');
  execFileSync('npx', ['esbuild', join(root, 'utils/sunspotHistory.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'u.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const U = await import(pathToFileURL(join(out, 'u.mjs')).href);
  const pts = U.growthPoints((await api('/api/region/4538')).region);
  check(pts.map(p => p.area).join(',') === '60,120,250,310', `one point per report that moved: areas ${pts.map(p => p.area).join(', ')}`);
  check(pts.every((p, i) => i === 0 || p.atMs > pts[i - 1].atMs), 'in time order');
  check(pts[pts.length - 1].magneticClass === 'Beta-Gamma-Delta', 'carrying the magnetic class');

  console.log('\nA list without the section heading still reads');
  const bare = U.parseSrs([
    ':Product: Solar Region Summary',
    ':Issued: 2026 Oct 01 0030 UTC',
    'Nmbr Location  Lo  Area  Z   LL   NN Mag Type',
    '4227 S10W13   218  0080 Dao  06   06 Beta',
    '4230 N15E40   160  0010 Axx  01   01 Alpha',
    'IA. H-alpha Plages without Spots.  Locations Valid at 30/2400Z',
    '4999  N05E10   100',
  ].join('\n'));
  check(bare.regions.size === 2 && bare.regions.get('4227')?.spotCount === 6, `both regions found (${bare.regions.size})`);
  check(bare.validMs === Date.UTC(2026, 8, 30, 24, 0), 'timed to 2400Z the day before it was issued', new Date(bare.validMs).toISOString());

  console.log('\nEvery event carries the whole region as it was then');
  const full = (await api('/api/region/4538')).region;
  check(full.events.every(e => e.state), 'every event has a state');
  const ev18 = full.events.find(e => e.atMs === Date.UTC(2026, 8, 18));
  check(ev18.state.areaMsh === 120 && ev18.state.spotCount === 9 && ev18.state.magClass === 'Beta-Gamma' && ev18.state.location === 'N12E27',
        'the 18th: area, spots, class and position as reported that day', JSON.stringify(ev18.state));
  const at17 = U.regionAt(full, Date.UTC(2026, 8, 17, 12));
  check(at17.listed && at17.state.spotCount === 3, 'regionAt reads it back for any moment');
  check(!U.regionAt(full, Date.UTC(2026, 8, 16)).listed, 'and not before it was listed');
  check(!U.regionAt(full, D0 + 3 * DAY).listed, 'nor after it dropped off the list');

  console.log('\nPast frames show the regions that were there then');
  execFileSync('npx', ['esbuild', join(root, 'utils/regionsAtTime.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'f.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const F = await import(pathToFileURL(join(out, 'f.mjs')).href);
  const records = Object.fromEntries((await api('/api/regions')).regions.map(x => [x.id, x]));
  const current = [{ id: '4540', latitude: -20, longitude: 57, observedAtMs: D0 + 2 * DAY, magneticClass: 'Alpha', spotCount: 1, area: 40, color: '#0f0' }];
  const frame = (atMs, sharp = new Map()) => F.regionsAtFrame({
    records, current, sharp, coverageFromMs: D0 - 7 * DAY, atMs, nowMs: D0 + 2 * DAY + H,
    colourOf: (m) => (String(m).toUpperCase().includes('DELTA') ? 'red' : 'yellow'),
  }).inputs;
  const ids = (atMs, sharp) => frame(atMs, sharp).map(r => r.id).sort().join(',');
  check(ids(Date.UTC(2026, 8, 18, 6)) === '4538', `a frame on the 18th shows 4538, since gone, and not 4540, not yet formed (${ids(Date.UTC(2026, 8, 18, 6))})`);
  check(ids(D0 + DAY + 6 * H) === '4538,4540', 'the day both were listed shows both');
  check(ids(D0 + 2 * DAY + 6 * H) === '4540', 'and after 4538 dropped off, only 4540');
  const old = frame(Date.UTC(2026, 8, 18, 6))[0];
  check(old.magneticClass === 'Beta-Gamma' && old.spotCount === 9 && old.color === 'yellow', 'its label says what it was then, not what it became', JSON.stringify(old));
  check(old.latitude === 12 && old.longitude === -27 && old.observedAtMs === Date.UTC(2026, 8, 18), 'placed where NOAA reported it that day, for the label to carry for rotation');
  // HMI knows better than NOAA's daily list: first seen at 03:00 on the 19th.
  const sharpMap = new Map([['4540', [
    { atMs: D0 + DAY - 21 * H, usfluxMx: 1e21, areaMh: 50, latitude: -20, longitude: 40 },
    { atMs: D0 + 2 * DAY, usfluxMx: 2e21, areaMh: 80, latitude: -20, longitude: 57 },
  ]]]);
  check(!ids(D0 + DAY - 23 * H, sharpMap).includes('4540') && ids(D0 + DAY - 20 * H, sharpMap).includes('4540'),
        'with HMI history, a region appears within the hour HMI first saw it');

  console.log('\nCharts: colour bands, series and trend');
  execFileSync('npx', ['esbuild', join(root, 'utils/regionHistorySeries.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 's.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const S = await import(pathToFileURL(join(out, 's.mjs')).href);
  const lv = (v, k) => S.levelOf(v, S.SCALES[k]);
  check([99, 75, 60, 59].map(v => lv(v, 'c')).join() === 'red,orange,yellow,green', 'C: 99 red, 75 orange, 60 yellow, below green');
  check([90, 70, 50, 30, 29].map(v => lv(v, 'm')).join() === 'purple,red,orange,yellow,green', 'M: 90 purple, 70 red, 50 orange, 30 yellow, below green');
  check([70, 40, 25, 10, 9].map(v => lv(v, 'x')).join() === 'purple,red,orange,yellow,green', 'X: 70 purple, 40 red, 25 orange, 10 yellow, below green');
  check([90, 70, 50, 30, 29].map(v => lv(v, 'proton')).join() === 'purple,red,orange,yellow,green', 'Protons: as M');
  const rec = (await api('/api/region/4538')).region;
  const areaS = S.noaaSeries(rec, 'areaMsh', D0 + 2 * DAY);
  check(areaS.map(p => p.value).join() === '60,120,250,310,310', `area steps at each change, held to the end (${areaS.map(p => p.value).join(', ')})`);
  const tr = S.regionTrend(rec);
  check(tr.label === 'Growing' && tr.areaDelta === 60 && tr.spotDelta === 6, `trend from area and spots over the last day (${JSON.stringify(tr)})`);
  check(S.valueAt(areaS, Date.UTC(2026, 8, 18, 12)) === 120, 'the value at a moment is the report in force then');

  console.log('\nA column read from the wrong place is not recorded');
  const shifted = U.parseSrs(':Issued: 2026 Oct 01 0030 UTC\n4257 N11W57   210  0060 6  06   06 Beta-Gamma');
  check(shifted.regions.get('4257')?.mcintosh === null && shifted.regions.get('4257')?.spotCount === 6, 'an impossible McIntosh class is left empty, the rest kept');
  const dirty = U.emptyState();
  dirty.regions['4257'] = { id: '4257', firstSeenMs: D0, lastSeenMs: D0 + DAY, active: true, sharp: [], fluxRefMx: null,
    current: { ...shifted.regions.get('4257'), mcintosh: '6' },
    events: [
      { kind: 'appeared', atMs: D0, seenAtMs: D0, source: 'noaa-json', location: 'N11W50', changes: { mcintosh: [null, 'Dao'], spotCount: [null, 6] } },
      { kind: 'changed', atMs: D0 + DAY, seenAtMs: D0 + DAY, source: 'srs', location: 'N11W57', changes: { mcintosh: ['Dao', '6'] } },
    ] };
  U.prune(dirty, D0 + DAY + H);
  const clean = dirty.regions['4257'];
  check(clean.events.length === 1 && clean.current.mcintosh === null, 'one already stored is cleaned up on the next run');

  console.log('\nAfter two weeks it is forgotten');
  await W.run(env, D0 + 17 * DAY);
  check(!(await api('/api/regions')).regions.some(x => x.id === '4538'), 'a region last seen over two weeks ago is dropped');

  console.log('\nRoutes');
  check((await api('/api/status')).ranAt != null, '/api/status says when it last ran');
  check((await api('/API/Status/')).ranAt != null, 'paths are not fussy about capitals or a trailing slash');
  check((await api('/api/region/9')).error === 'Unknown region', 'an unknown region is a 404, not a crash');
  const again = await W.default.fetch(new Request('https://x/api/run'), env, { waitUntil() {} });
  check(again.status === 200 || again.status === 429, '/api/run runs (or says it just did)');
  check(kv.get('state').length < 2_000_000, `the stored state is small (${(kv.get('state').length / 1024).toFixed(1)} KiB)`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
