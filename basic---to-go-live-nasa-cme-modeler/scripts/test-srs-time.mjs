#!/usr/bin/env node
// When NOAA's region positions were actually measured.
//
// The Solar Region Summary is issued at 0030 UT with positions valid at 2400Z
// the day before, and it says so in its header. The tracker ignored that and
// treated every text-bulletin position as measured at the moment the page
// loaded, so it applied no rotation correction at all - on an evening image,
// every label sat nine or ten degrees east of the spot it names.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'srs-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

// The shape of a real SRS header.
const srs = (issued, valid) => `:Product: 0922SRS.txt
:Issued: ${issued}
# Prepared jointly by the U.S. Dept. of Commerce, NOAA,
# Space Weather Prediction Center and the U.S. Air Force.
#
Joint USAF/NOAA Solar Region Summary
SRS Number 265 Issued at 0030Z on 22 Sep 2026
Report compiled from data received at SWO on 21 Sep
${valid ? `I.  Regions with Sunspots.  Locations Valid at ${valid}` : 'I.  Regions with Sunspots.'}
Nmbr Location  Lo  Area  Z   LL   NN Mag Type
4538 N11W09   123  0010 Bxo  04   03 Beta
`;

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/srsTime.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 's.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const { parseSrsValidTime, latestSrsEpoch } = await import(pathToFileURL(join(out, 's.mjs')).href);
  const iso = (ms) => (ms == null ? 'null' : new Date(ms).toISOString());

  console.log('\nThe validity time is read from the header');
  {
    const t = parseSrsValidTime(srs('2026 Sep 22 0030 UTC', '21/2400Z'));
    check(iso(t) === '2026-09-22T00:00:00.000Z', `21/2400Z is midnight going into the 22nd (${iso(t)})`, iso(t));

    const other = parseSrsValidTime(srs('2026 Sep 22 0030 UTC', '21/1800Z'));
    check(iso(other) === '2026-09-21T18:00:00.000Z', 'and any other stated time is honoured', iso(other));
  }

  console.log('\nMonth and year boundaries');
  {
    const monthEnd = parseSrsValidTime(srs('2026 Oct 01 0030 UTC', '30/2400Z'));
    check(iso(monthEnd) === '2026-10-01T00:00:00.000Z',
          `valid on the 30th, issued on the 1st, lands in the right month (${iso(monthEnd)})`, iso(monthEnd));

    const yearEnd = parseSrsValidTime(srs('2027 Jan 01 0030 UTC', '31/2400Z'));
    check(iso(yearEnd) === '2027-01-01T00:00:00.000Z',
          `and across the new year (${iso(yearEnd)})`, iso(yearEnd));
  }

  console.log('\nWhen the header is incomplete');
  {
    const noValid = parseSrsValidTime(srs('2026 Sep 22 0030 UTC', null));
    check(iso(noValid) === '2026-09-22T00:00:00.000Z',
          'no validity line falls back to half an hour before issue', iso(noValid));
    check(parseSrsValidTime('4538 N11W09 123 0010 Bxo 04 03 Beta') === null,
          'no header at all is null, not a guess');
    check(parseSrsValidTime('') === null, 'and neither is an empty file');
  }

  console.log('\nThe last-resort fallback is the bulletin time, not now');
  {
    const evening = Date.UTC(2026, 8, 22, 17, 30);
    check(iso(latestSrsEpoch(evening)) === '2026-09-22T00:00:00.000Z',
          'at 17:30 UT the positions are assumed valid at 00:00, not at 17:30');
    // What "now" cost: seventeen and a half hours of rotation, uncorrected.
    const degrees = (17.5 / 24) * (360 / 27.2753);
    check(degrees > 9 && degrees < 10,
          `treating them as current left every label ${degrees.toFixed(1)}° east of its spot`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
