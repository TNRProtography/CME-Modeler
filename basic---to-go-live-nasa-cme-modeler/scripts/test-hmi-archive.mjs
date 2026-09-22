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
    const bc = A.parseBrowseListing(listing, 'colorized', dir);
    check(bc.length === 4, `four colorised frames, each listed twice, counted once (${bc.length})`, String(bc.length));
    check(bc[0].url === `${dir}20260922_000011_1024_HMIBC.jpg`, 'with the full archive URL');
    check(new Date(bc[1].atMs).toISOString() === '2026-09-22T00:15:11.000Z', 'and the time from the name, seconds included');

    const b = A.parseBrowseListing(listing, 'magnetogram', dir);
    check(b.length === 4 && b.every((f) => /_HMIB\.jpg$/.test(f.url)),
          'HMIB does not also match HMIBC, whose name contains it');
    check(A.parseBrowseListing(listing, 'intensity', dir).length === 4, 'intensity frames are found too');
    check(A.parseBrowseListing('<html>no files</html>', 'colorized', dir).length === 0,
          "the app's own index.html - what an undeployed proxy returns - is an empty list");
  }

  console.log('\nThinning keeps playback light');
  {
    const every5 = Array.from({ length: 13 }, (_, i) => ({ atMs: i * 5 * 60000, url: String(i) }));
    const kept = A.thinFrames(every5, 15 * 60000);
    check(kept.length === 5, `an hour of five-minute frames becomes one per quarter-hour (${kept.length})`, String(kept.length));
    check(kept[kept.length - 1].url === '12', 'always keeping the newest');
    check(kept.every((f, i) => i === 0 || f.atMs - kept[i - 1].atMs >= 15 * 60000), 'and never closer than the interval');
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
