#!/usr/bin/env node
// Week-long series are kept between visits and topped up, not re-downloaded.
//
//   npm run test:incremental-series
//
// A return visit should ask for the shortest file that reaches back past what
// it already holds, merge the new rows over the old, drop what has aged out,
// and fall back to longer files, or to what it holds, when a fetch fails.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'incseries-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); } else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/incrementalSeries.ts'), '--bundle', '--format=esm',
    `--outfile=${join(out, 's.mjs')}`, '--log-level=error'], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const S = await import(pathToFileURL(join(out, 's.mjs')).href);

  const H = 3600000, M = 60000;
  const now = Date.UTC(2026, 8, 24, 12);
  const variants = S.goesVariants('https://x/goes/primary', 'xrays');
  check(variants.length === 4 && variants[0].url.endsWith('xrays-6-hour.json') && variants[3].url.endsWith('xrays-7-day.json'),
    'GOES variants run 6 hours to 7 days');
  check(S.goesVariants('b', 'magnetometers', '1-day').length === 2, 'a day-long series stops at the 1-day file');

  const week = 168 * H, overlap = 30 * M;
  const pick = (held) => S.chooseVariant(variants, held, week, now, overlap);
  check(pick({ newestMs: null, oldestMs: null, fullAtMs: 0 }) === 3, 'first visit fetches the full week');
  check(pick({ newestMs: now - 2 * M, oldestMs: now - week + H, fullAtMs: now - 2 * H }) === 0,
    'a refresh two minutes on fetches only the 6-hour file');
  check(pick({ newestMs: now - 10 * H, oldestMs: now - week + H, fullAtMs: now - 20 * H }) === 1,
    'back after ten hours: the 1-day file');
  check(pick({ newestMs: now - 2 * 24 * H, oldestMs: now - week + H, fullAtMs: now - 3 * 24 * H }) === 2,
    'back after two days: the 3-day file');
  check(pick({ newestMs: now - 5 * 24 * H, oldestMs: now - week + H, fullAtMs: now - 5 * 24 * H }) === 3,
    'back after five days: the full week');
  check(pick({ newestMs: now - 2 * M, oldestMs: now - 2 * H, fullAtMs: 0 }) === 3,
    'held rows short of the week are filled in with the full file');
  check(pick({ newestMs: now - 2 * M, oldestMs: now - 2 * H, fullAtMs: now - H }) === 0,
    '...but not again within hours of the last full fetch');

  const row = (t, energy, flux) => ({ time_tag: new Date(t).toISOString(), energy, flux });
  const timeOf = (r) => Date.parse(r.time_tag);
  const idOf = (r) => `${r.time_tag}|${r.energy}`;
  const merged = S.mergeRows(
    [row(now - 8 * 24 * H, 'a', 1), row(now - 2 * H, 'a', 2), row(now - H, 'a', 3)],
    [row(now - H, 'a', 30), row(now, 'a', 4), row(now, 'b', 5)],
    timeOf, idOf, now - week);
  check(merged.length === 4, 'merge keeps one row per reading and drops aged-out rows', JSON.stringify(merged));
  check(merged.find((r) => r.time_tag === new Date(now - H).toISOString())?.flux === 30, 'a revised reading replaces the held one');
  check(merged.every((r, i) => i === 0 || timeOf(merged[i - 1]) <= timeOf(r)), 'merged rows are in time order');

  // End to end, with the store in memory (no IndexedDB in node).
  const asked = [];
  let failShort = false, failAll = false;
  const series = (at, extra = {}) => S.fetchIncrementalSeries({
    key: 'test', variants, retentionMs: week, timeOf, idOf, nowMs: at,
    fetchRows: async (url) => {
      asked.push(url.split('/').pop());
      if (failAll || (failShort && url.includes('6-hour'))) throw new Error('down');
      const span = variants.find((v) => v.url === url).spanMs;
      const rows = [];
      for (let t = at - span; t <= at; t += H) rows.push(row(t - (t % H), 'a', t));
      return rows;
    },
    ...extra,
  });
  const first = await series(now);
  check(asked[0] === 'xrays-7-day.json' && first.length >= 168, 'first fetch: the week', `${asked} ${first.length}`);
  const second = await series(now + 5 * M);
  check(asked[1] === 'xrays-6-hour.json', 'next refresh: only the 6-hour file', String(asked));
  check(second.length >= 168 && second.length <= first.length + 1, 'and the week is still all there', `${second.length}`);
  failShort = true;
  await series(now + 10 * M);
  check(asked[2] === 'xrays-6-hour.json' && asked[3] === 'xrays-1-day.json', 'a failed short file falls back to a longer one', String(asked));
  failAll = true;
  const held = await series(now + 15 * M);
  check(held.length >= 168, 'with the source down, the held week is still shown');
  const [a, b] = await Promise.all([series(now + 20 * M), series(now + 20 * M)]);
  check(a === b, 'two panels asking at once share one top-up');

  // A caller that only wants the latest readings, on a first visit.
  const asked2 = [];
  let slowFull = null;
  const series2 = (at, recentOnly) => S.fetchIncrementalSeries({
    key: 'test2', variants, retentionMs: week, timeOf, idOf, nowMs: at, recentOnly,
    fetchRows: async (url) => {
      const name = url.split('/').pop();
      asked2.push(name);
      if (slowFull && name.includes('7-day')) await slowFull;
      const span = variants.find((v) => v.url === url).spanMs;
      const rows = [];
      for (let t = at - span; t <= at; t += H) rows.push(row(t - (t % H), 'a', t));
      return rows;
    },
  });
  await series2(now, true);
  check(asked2[0] === 'xrays-6-hour.json', 'recent-only on a first visit: just the 6-hour file', String(asked2));
  await series2(now + 30 * 1000 + 10000, true);
  check(asked2[1] === 'xrays-6-hour.json', '...and on its next tick, still not the week', String(asked2));
  const fullRows = await series2(now + 60 * 1000 + 20000, false);
  check(asked2[2] === 'xrays-7-day.json' && fullRows.length >= 168, 'a full caller then fills in the week', String(asked2));

  // Two top-ups of one series at once: the short one must not write back
  // over the week the long one just stored.
  let release;
  slowFull = new Promise((r) => { release = r; });
  const series3 = (at, recentOnly) => S.fetchIncrementalSeries({
    key: 'test3', variants, retentionMs: week, timeOf, idOf, nowMs: at, recentOnly,
    fetchRows: async (url) => {
      if (url.includes('7-day')) await slowFull;
      const span = variants.find((v) => v.url === url).spanMs;
      const rows = [];
      for (let t = at - span; t <= at; t += H) rows.push(row(t - (t % H), 'a', t));
      return rows;
    },
  });
  const pFull = series3(now, false);
  const pRecent = series3(now + 1000, true);
  release();
  await pFull;
  const after = await pRecent;
  check(after.length >= 168, 'a short top-up behind a long one keeps the week', `${after.length}`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
