#!/usr/bin/env node
// Past HMI frames from SDO's browse archive, read from the directory listing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'hmiarch-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

// An Apache-style index: every name appears twice, in the href and the text,
// and the three products sit side by side.
const listing = ['000011', '001511', '003011', '004511'].map((t) => ['HMIBC', 'HMIB', 'HMIIF']
  .map((p) => `<a href="20260922_${t}_1024_${p}.jpg">20260922_${t}_1024_${p}.jpg</a> 22-Sep-2026 00:15  180K`)
  .join('\n')).join('\n');

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/hmiArchive.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'a.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const A = await import(pathToFileURL(join(out, 'a.mjs')).href);
  const dir = A.browseDirUrl(Date.UTC(2026, 8, 22, 15));

  console.log('\nThe archive layout');
  check(dir === 'https://sdo.gsfc.nasa.gov/assets/img/browse/2026/09/22/', `a directory per UTC day (${dir})`, dir);

  console.log('\nReading a listing');
  {
    const bc = A.parseBrowseListing(listing, 'HMIBC', dir);
    check(bc.length === 4, `four colorised frames, each listed twice, counted once (${bc.length})`, String(bc.length));
    check(bc[0].url === `${dir}20260922_000011_1024_HMIBC.jpg`, 'with the full archive URL');
    check(new Date(bc[1].atMs).toISOString() === '2026-09-22T00:15:11.000Z', 'and the time from the name, seconds included');

    const b = A.parseBrowseListing(listing, 'HMIB', dir);
    check(b.length === 4 && b.every((f) => /_HMIB\.jpg$/.test(f.url)),
          'HMIB does not also match HMIBC, whose name contains it');
    check(A.parseBrowseListing('<html>no files</html>', 'HMIBC', dir).length === 0,
          "the app's own index.html - what an undeployed proxy returns - is an empty list");
  }

  console.log('\nAgainst a real day\'s listing');
  {
    // Copied from https://sdo.gsfc.nasa.gov/assets/img/browse/2026/09/22/ on
    // the day: AIA channels, the AIA/HMI composite, and HMI only as HMID and
    // HMII - no HMIBC, HMIB or HMIIF in the stretch it covered.
    const real = [
      '20260922_000006_1024_4500.jpg', '20260922_000014_1024_0335.jpg',
      '20260922_000335_1024_094335193.jpg', '20260922_000335_1024_HMI171.jpg',
      '20260922_001038_1024_HMID.jpg', '20260922_001038_1024_HMII.jpg',
      '20260922_001038_4096_HMII.jpg', '20260922_001038_512_HMII.jpg',
      '20260922_002538_1024_HMII.jpg',
    ].map((n) => `<a href="${n}">${n}</a>`).join('\n');

    check(A.chooseProduct([real], 'intensity') === 'HMII',
          'the intensity view falls back to HMII, which the archive does carry');
    const frames = A.parseBrowseListing(real, 'HMII', dir);
    check(frames.length === 2, `only the 1024px intensitygrams, not the 512 or 4096 (${frames.length})`, String(frames.length));
    check(!frames.some((f) => /HMI171|HMID/.test(f.url)),
          'and not the composite or the Dopplergram, whose names also start HMI');
    check(A.chooseProduct([real], 'colorized') === null,
          'a view with no archived product at all says so, rather than borrowing a different measurement');
    check(A.chooseProduct([real + '\n<a href="20260922_003000_1024_HMIB.jpg">x</a>'], 'colorized') === 'HMIB',
          'the colorised view falls back to the plain magnetogram - the same measurement in grey');
  }

  console.log('\nThe choice is made once for the whole window');
  {
    const today = '<a href="20260922_000011_1024_HMIBC.jpg">x</a>';
    const yesterday = '<a href="20260921_230011_1024_HMIB.jpg">x</a>';
    check(A.chooseProduct([yesterday, today], 'colorized') === 'HMIBC',
          'the preferred product wins if any day has it, so a scrub across midnight does not flip colour');
  }

  console.log('\nThinning keeps playback light');
  {
    const every5 = Array.from({ length: 13 }, (_, i) => ({ atMs: i * 5 * 60000, url: String(i) }));
    const kept = A.thinFrames(every5, 15 * 60000);
    check(kept.length === 5, `an hour of five-minute frames becomes one per quarter-hour (${kept.length})`, String(kept.length));
    check(kept[kept.length - 1].url === '12', 'always keeping the newest');
    check(kept.every((f, i) => i === 0 || f.atMs - kept[i - 1].atMs >= 15 * 60000), 'and never closer than the interval');
  }

  console.log('\nThe smaller and larger copies');
  {
    const names = [
      '20260922_001038_512_HMII.jpg', '20260922_001038_1024_HMII.jpg', '20260922_001038_2048_HMII.jpg',
      '20260922_002538_1024_HMII.jpg',
    ].map((n) => `<a href="${n}">${n}</a>`).join('\n');
    const [a, b] = A.parseBrowseListing(names, 'HMII', dir);
    check(a.preview === `${dir}20260922_001038_512_HMII.jpg`, 'the 512px copy is used for dragging');
    check(a.detail === `${dir}20260922_001038_2048_HMII.jpg`, 'the 2048px copy for the close-up');
    check(b.preview === undefined && b.detail === undefined,
          'and a frame the listing has no copies of gets none - not a guessed URL that 404s');
  }

  console.log('\nLonger windows space their frames out');
  {
    const H = 3600000;
    check(A.intervalForWindow(12 * H) === 15 * 60000, 'twelve hours: a frame every quarter-hour');
    check(A.intervalForWindow(24 * H) === 15 * 60000, 'a day: still a quarter-hour, 96 frames');
    check(A.intervalForWindow(72 * H) === 45 * 60000, 'three days: 45 minutes');
    const week = A.intervalForWindow(168 * H);
    check(week === 105 * 60000 && 168 * H / week <= 96,
          `a week: ${week / 60000} minutes, so about a hundred frames rather than seven hundred`);
  }

} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
