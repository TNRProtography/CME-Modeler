#!/usr/bin/env node
// Sunspot positions from SDO/HMI SHARPs.
//
// The fixture below has the shape of a real response from
// jsoc_info?ds=hmi.sharp_720s_nrt[][2026.09.22_12:00_TAI/6h] - columns rather
// than rows, every value a string, NOAA_AR "0" for patches NOAA has not
// numbered, and the full five-digit NOAA number where everyone else uses four.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'sharp-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const response = {
  keywords: [
    { name: 'T_REC', values: [
      '2026.09.22_12:00:00_TAI', '2026.09.22_17:00:00_TAI',   // HARP 13989, unnumbered
      '2026.09.22_12:00:00_TAI', '2026.09.22_16:48:00_TAI',   // HARP 14026 = AR 4536
      '2026.09.22_12:00:00_TAI', '2026.09.22_17:00:00_TAI',   // HARP 14044 = AR 4538
      '2026.09.22_17:00:00_TAI',                              // HARP 14045, NaN centre
    ] },
    { name: 'HARPNUM', values: ['13989', '13989', '14026', '14026', '14044', '14044', '14045'] },
    { name: 'NOAA_AR', values: ['0', '0', '14536', '14536', '14538', '14538', '14539'] },
    { name: 'LAT_FWT', values: ['27.77', '27.76', '2.79', '2.75', '11.40', '11.42', 'NaN'] },
    { name: 'LON_FWT', values: ['-40.1', '-37.4', '6.10', '8.85', '15.20', '17.90', 'NaN'] },
  ],
};

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/sharpPositions.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 's.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const S = await import(pathToFileURL(join(out, 's.mjs')).href);

  console.log('\nThe response is read the way JSOC actually sends it');
  {
    const rows = S.parseSharpResponse(response);
    check(rows.length === 2, `two numbered patches with real centres (${rows.length})`, String(rows.length));
    check(!rows.some((r) => r.harp === 13989), 'an unnumbered patch is dropped - there is no NOAA region to attach it to');
    check(!rows.some((r) => r.harp === 14045), 'a patch with a NaN centre is dropped, not drawn at 0,0');

    const ar4538 = rows.find((r) => r.harp === 14044);
    check(ar4538.latitude === 11.42 && ar4538.longitude === 17.9,
          'the NEWEST record of each patch wins', `${ar4538.latitude},${ar4538.longitude}`);
    check(new Date(ar4538.atMs).toISOString() === '2026-09-22T16:59:23.000Z',
          'and its time is converted from TAI to UTC, 37 seconds earlier', new Date(ar4538.atMs).toISOString());
  }

  console.log('\nNumbers match the way people say them');
  {
    check(S.regionKey(14538) === '4538', 'SHARP 14538 is region 4538');
    check(S.regionKey('4538') === '4538', 'and the SRS 4538 is the same key');
    check(S.regionKey('AR 4538') === '4538', 'even with a prefix');
  }

  console.log('\nNOAA says which regions exist; SHARPs say where they are');
  {
    const sharp = S.sharpByRegion(S.parseSharpResponse(response));
    const noaaRow = { region: '4538', latitude: 11, longitude: 9, observedTime: Date.UTC(2026, 8, 22), area: 10 };
    const moved = S.withSharpPosition(noaaRow, sharp, 'observedTime');
    check(moved.latitude === 11.42 && moved.longitude === 17.9,
          `AR 4538 takes its HMI position (N11W09 at midnight becomes ${moved.latitude}, ${moved.longitude})`);
    check(moved.observedTime === sharp.get('4538').atMs,
          'and its time, so the rotation correction is only the hour since HMI saw it');
    check(moved.area === 10 && moved.positionSource === 'sharp',
          'while everything else still comes from NOAA');

    const unknown = S.withSharpPosition({ region: '4599', latitude: -5, longitude: 20, observedTime: 1 },
      sharp, 'observedTime');
    check(unknown.latitude === -5 && unknown.longitude === 20 && unknown.positionSource === 'noaa',
          'a region with no SHARP yet keeps its NOAA position rather than disappearing');
  }

  console.log('\nThe query is the form JSOC accepted');
  {
    const url = S.sharpQueryUrl(Date.UTC(2026, 8, 22, 18, 0), 6);
    const ds = decodeURIComponent(new URL(url).searchParams.get('ds'));
    check(ds === 'hmi.sharp_720s_nrt[][2026.09.22_12:00_TAI/6h]',
          `a six-hour window ending now, not [$], which JSOC rejected (${ds})`, ds);
    check(new URL(url).searchParams.get('key') === 'T_REC,HARPNUM,NOAA_AR,LAT_FWT,LON_FWT',
          'asking for exactly the five columns used');
    // Everyone inside the same twelve minutes asks the identical question, so
    // the proxy's edge cache can answer them.
    const a = S.sharpQueryUrl(Date.UTC(2026, 8, 22, 18, 1));
    const b = S.sharpQueryUrl(Date.UTC(2026, 8, 22, 18, 11));
    const c = S.sharpQueryUrl(Date.UTC(2026, 8, 22, 18, 13));
    check(a === b, 'two visitors ten minutes apart share one cacheable URL');
    check(a !== c, 'but the next twelve-minute cadence asks again');
  }

  console.log('\nGarbage in');
  {
    check(S.parseSharpResponse({ status: 6, error: '' }).length === 0,
          "JSOC's own error shape is an empty result, not a crash");
    check(S.parseSharpResponse(null).length === 0, 'nor is nothing at all');
    check(S.parseTRec('not a time') === null, 'an unreadable T_REC is null');
  }

  console.log('\nHistory: flux and area per region, hourly');
  {
    const H = (h) => `2026.09.22_${String(h).padStart(2, '0')}:00:00_TAI`;
    const hist = {
      keywords: [
        { name: 'T_REC', values: [H(10), H(10), H(11), H(11), H(11), H(12), H(12)] },
        // 14044 and 14050 are two patches of one region; 14044 is repeated at 11:00.
        { name: 'HARPNUM', values: ['14044', '14050', '14044', '14044', '14050', '14044', '14050'] },
        { name: 'NOAA_AR', values: ['14538', '14538', '14538', '14538', '14538', '14538', '14538'] },
        { name: 'USFLUX', values: ['1e22', '2e21', '1.1e22', '1.1e22', '2e21', '1.2e22', '3e21'] },
        { name: 'AREA_ACR', values: ['300', '50', '320', '320', '50', '340', '60'] },
      ],
    };
    const series = S.parseSharpHistory(hist).get('4538');
    check(series?.length === 3, `one point per hour (${series?.length})`, String(series?.length));
    check(Math.abs(series[0].usfluxMx - 1.2e22) < 1e15,
          'two patches of one region are summed - flux is a total and both halves are the region',
          String(series[0].usfluxMx));
    check(Math.abs(series[1].usfluxMx - 1.3e22) < 1e15,
          'but a patch measured twice in the same hour counts once',
          String(series[1].usfluxMx));
    check(series[2].areaMh === 400, 'area is summed the same way', String(series[2].areaMh));
    check(series.every((p, i) => i === 0 || p.atMs > series[i - 1].atMs), 'oldest first');
  }

  console.log('\nThe trend is said in words, carefully');
  {
    const mk = (fluxes) => fluxes.map((f, i) => ({ atMs: Date.UTC(2026, 8, 21, 12) + i * 3600000, usfluxMx: f, areaMh: 100 }));
    const day = (from, to) => mk(Array.from({ length: 25 }, (_, i) => from + (to - from) * (i / 24)));

    const fast = S.fluxTrend(day(1e22, 1.4e22));
    check(fast.label === 'Flux emerging fast' && Math.round(fast.change24hPct) === 40,
          `+40% in a day is emerging fast (${fast.label})`);
    check(/worth watching/.test(fast.note) && !/will flare/.test(fast.note),
          'and is worded as worth watching, not as a flare forecast');

    check(S.fluxTrend(day(1e22, 1.1e22)).label === 'Growing', '+10% is growing');
    check(S.fluxTrend(day(1e22, 1.02e22)).label === 'Stable', '+2% is stable');
    check(S.fluxTrend(day(1e22, 0.8e22)).label === 'Decaying', '-20% is decaying');
    check(S.fluxTrend(mk([1e22])).change24hPct === null, 'one point is not a trend');
    check(S.fluxTrend(mk([1e22, 2e22, 3e22])).change24hPct === null,
          'nor are three hours - too short to call, however steep');
  }

  console.log('\nThe history query');
  {
    const url = S.sharpHistoryUrl(Date.UTC(2026, 8, 22, 18, 25), 72, '1h');
    const ds = decodeURIComponent(new URL(url).searchParams.get('ds'));
    check(ds === 'hmi.sharp_720s_nrt[][2026.09.19_18:00_TAI/3d@1h]',
          `three days, one record an hour, rounded to the hour (${ds})`, ds);
    const week = decodeURIComponent(new URL(S.sharpHistoryUrl(Date.UTC(2026, 8, 22, 18, 25), 168, '1h')).searchParams.get('ds'));
    check(week === 'hmi.sharp_720s_nrt[][2026.09.15_18:00_TAI/7d@1h]',
          `and a week, which the scrubber's longest window needs (${week})`, week);
    check(new URL(url).searchParams.get('key') === 'T_REC,HARPNUM,NOAA_AR,USFLUX,AREA_ACR,LAT_FWT,LON_FWT',
          'asking for flux, area and position - the scrubber needs where it was, not just how big');
    const plain = decodeURIComponent(new URL(S.sharpHistoryUrl(Date.UTC(2026, 8, 22, 18, 25), 24, null)).searchParams.get('ds'));
    check(plain === 'hmi.sharp_720s_nrt[][2026.09.21_18:00_TAI/24h]',
          'and the unstepped fallback in the form JSOC is known to accept', plain);
  }


  console.log('\nWhere a region was, hour by hour');
  {
    const H = (h) => `2026.09.22_${String(h).padStart(2, '0')}:00:00_TAI`;
    const hist = {
      keywords: [
        { name: 'T_REC', values: [H(10), H(10), H(12)] },
        { name: 'HARPNUM', values: ['14044', '14050', '14044'] },
        { name: 'NOAA_AR', values: ['14538', '14538', '14538'] },
        { name: 'USFLUX', values: ['3e21', '9e21', '1e22'] },
        { name: 'AREA_ACR', values: ['100', '200', '300'] },
        { name: 'LAT_FWT', values: ['10', '12', '11'] },
        { name: 'LON_FWT', values: ['5', '8', '9'] },
      ],
    };
    const series = S.parseSharpHistory(hist).get('4538');
    check(series[0].latitude === 12 && series[0].longitude === 8,
          'a region over two patches is placed at the one carrying more flux - positions cannot be summed',
          `${series[0].latitude},${series[0].longitude}`);
    check(Math.abs(series[0].usfluxMx - 1.2e22) < 1e15, 'while its flux is still the total');

    const at = (h) => Date.UTC(2026, 8, 22, h) - 37000;
    const p = S.positionAt(series, at(12) + 20 * 60000);
    check(p && p.latitude === 11 && p.longitude === 9, 'the nearest hour is used');
    check(p.atMs === series[1].atMs, "with that hour's time, so the rotation correction covers the gap exactly");
    check(S.positionAt(series, at(16)) === null,
          'nothing within the tolerance is null, and the caller falls back to NOAA');

    check(!S.trackedBy(series, at(7)), 'a region is not shown three hours before HMI first tracked it');
    check(S.trackedBy(series, at(9)), 'but is inside the grace period just before');
    check(S.trackedBy(undefined, at(1)), 'and a region with no history at all is not hidden - nothing says it was absent');

    // The trap: if JSOC falls back to one day, EVERY region's history starts at
    // the window edge. Read naively, all of them "emerged" a day ago and would
    // vanish from every older frame.
    const windowStart = at(10);
    check(S.trackedBy(series, at(1), windowStart),
          'history that begins where the query began says nothing about before it - the region stays');
    check(!S.trackedBy(series, at(1), at(1) - 3 * 3600000),
          'but history that begins well inside the window really is an emergence');
  }


  console.log('\nPositions glide instead of stepping');
  {
    // A region fixed on the surface, sampled hourly the way HMI's history is,
    // with the hour-to-hour wander of a flux-weighted centre on top.
    const SYN = 360 / 27.2753;
    const t0 = Date.UTC(2026, 8, 20, 0);
    const wobble = [0.4, -0.5, 0.3, -0.2, 0.5, -0.4, 0.2, -0.3, 0.4, -0.5, 0.3, -0.2, 0.1];
    const pts = wobble.map((w, h) => ({
      atMs: t0 + h * 3600000, usfluxMx: 1e22, areaMh: 100,
      latitude: 12 + w, longitude: -30 + SYN * (h / 24) + w,
    }));

    // Stonyhurst longitude at each quarter-hour frame, as the tracker draws it.
    const drawn = [];
    for (let m = 3 * 60; m <= 9 * 60; m += 15) {
      const t = t0 + m * 60000;
      const p = S.smoothedPositionAt(pts, t);
      drawn.push(p.longitude + SYN * ((t - p.atMs) / 86400000));
    }
    const steps = drawn.slice(1).map((v, i) => v - drawn[i]);
    const expected = SYN / 96;      // a quarter-hour of rotation
    const held = steps.filter((d) => Math.abs(d) < expected * 0.25).length;
    const worst = Math.max(...steps.map((d) => Math.abs(d - expected)));
    check(held === 0, `no frame holds still waiting for the next hour (${held} held)`, String(held));
    check(worst < 0.1, `each frame moves about a quarter-hour of rotation (worst off by ${worst.toFixed(3)}°)`, worst.toFixed(3));

    // The old way for contrast: snapping to the nearest hourly sample.
    const snapped = [];
    for (let m = 3 * 60; m <= 9 * 60; m += 15) {
      const t = t0 + m * 60000;
      const p = S.positionAt(pts, t);
      snapped.push(p.longitude + SYN * ((t - p.atMs) / 86400000));
    }
    const snapWorst = Math.max(...snapped.slice(1).map((v, i) => Math.abs(v - snapped[i] - expected)));
    check(snapWorst > worst * 3, `snapping jumped ${snapWorst.toFixed(2)}° against ${worst.toFixed(2)}° smoothed`);

    const lats = [];
    for (let m = 3 * 60; m <= 9 * 60; m += 15) lats.push(S.smoothedPositionAt(pts, t0 + m * 60000).latitude);
    const latRange = Math.max(...lats) - Math.min(...lats);
    check(latRange < 0.4, `latitude wanders ${latRange.toFixed(2)}° smoothed, against 1° raw`, latRange.toFixed(3));
  }

  console.log('\nBefore it existed, it is pinned to where it would emerge');
  {
    const SYN = 360 / 27.2753;
    const first = Date.UTC(2026, 8, 21, 12);
    const pts = [0, 1, 2].map((h) => ({
      atMs: first + h * 3600000, usfluxMx: 1e21, areaMh: 20,
      latitude: -8, longitude: -20 + SYN * (h / 24),
    }));
    const dayBefore = first - 24 * 3600000;
    const p = S.smoothedPositionAt(pts, dayBefore);
    check(p.beforeFirst, 'a frame a day before HMI first saw it is flagged as before');
    const lonThen = p.longitude + SYN * ((dayBefore - p.atMs) / 86400000);
    check(Math.abs(lonThen - (-20 - SYN)) < 0.3,
          `the site is wound back a day of rotation, to ${lonThen.toFixed(1)}° - where that patch of surface was`,
          lonThen.toFixed(2));
    check(Math.abs(p.latitude - -8) < 1e-9, 'at the latitude it emerged at');
    check(!S.smoothedPositionAt(pts, first + 3600000).beforeFirst, 'and during its life it is not flagged');
    check(S.smoothedPositionAt([], first) === null, 'no history at all is null, and NOAA takes over');
  }

} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
