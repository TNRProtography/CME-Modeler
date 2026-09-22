#!/usr/bin/env node
// NOAA active regions, ready to draw on a sphere.
//
// solar_regions.json is a HISTORY, not a snapshot: the same region appears
// once per day for as long as it lives. Drawing every row would stack a dozen
// markers of the same spot along its own track across the disk, which looks
// like a dozen regions.
//
// And NOAA reports where a region WAS. The Sun turns about half a degree an
// hour, so a report from yesterday belongs 13 degrees west of where it says.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'spots-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const DAY = 86400000;
const now = Date.UTC(2026, 8, 22, 0, 0, 0);
const dateStr = (ms) => new Date(ms).toISOString().slice(0, 10);

try {
  execFileSync('npx', ['esbuild', join(root, 'hooks/useSunspotRegions.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 's.mjs')}`,
    // React comes along for the ride because the pure function shares a
    // module with the hook. Cheaper than splitting the file for a test.
    '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const { normaliseRegions } = await import(pathToFileURL(join(out, 's.mjs')).href);

  console.log('\nOne marker per region, not one per report');
  {
    // Region 4123 reported on four consecutive days, drifting west as it must.
    const rows = [0, 1, 2, 3].map((d) => ({
      region: 4123, latitude: -12, longitude: -30 + d * 13,
      area: 220 + d * 40, number_spots: 8, mag_class: 'Beta',
      observed_date: dateStr(now - (3 - d) * DAY),
    }));
    const got = normaliseRegions(rows, now);
    check(got.length === 1, `four reports of one region give one marker (${got.length})`, String(got.length));
    check(got[0].areaMsh === 340, `and it is the newest report (area ${got[0].areaMsh})`, String(got[0].areaMsh));
    check(got[0].region === '4123', 'keyed by region number', String(got[0].region));
  }

  console.log('\nPositions are carried forward to now');
  {
    // Reported two days ago at longitude 0. The Sun has turned since.
    const rows = [{ region: 4200, latitude: 10, longitude: 0, area: 100,
                    observed_date: dateStr(now - 2 * DAY) }];
    const [r] = normaliseRegions(rows, now);
    check(r !== undefined, 'a two-day-old report is still drawn');
    // The raw longitude is preserved for anything that wants the report as
    // filed; the carrying happens where it is drawn.
    check(r.longitude === 0, 'the reported longitude is kept as reported');
    check(r.observedAtMs !== null, 'along with when it was observed, so it can be carried');
  }

  console.log('\nRegions that have rotated away are dropped');
  {
    // Reported at longitude 40 west, eight days ago: long gone round the back.
    const stale = [{ region: 4001, latitude: 5, longitude: 40, area: 300,
                     observed_date: dateStr(now - 8 * DAY) }];
    check(normaliseRegions(stale, now).length === 0,
          'a report over three days old is not carried onto the far side');

    // Reported near the west limb yesterday: carried forward, now past it.
    const leaving = [{ region: 4002, latitude: 5, longitude: 84, area: 300,
                       observed_date: dateStr(now - 1 * DAY) }];
    check(normaliseRegions(leaving, now).length === 0,
          'and one that has rotated past the limb since its report is dropped',
          JSON.stringify(normaliseRegions(leaving, now)));

    const facing = [{ region: 4003, latitude: 5, longitude: 10, area: 300,
                      observed_date: dateStr(now) }];
    check(normaliseRegions(facing, now).length === 1, 'while one facing us is kept');
  }

  console.log('\nJunk in does not become a marker');
  {
    check(normaliseRegions([], now).length === 0, 'no rows, no markers');
    check(normaliseRegions([{ region: 4010, latitude: null, longitude: 10 }], now).length === 0,
          'a row with no latitude is dropped');
    check(normaliseRegions([{ latitude: 5, longitude: 5, area: 10 }], now).length === 0,
          'a row with no region number is dropped');
    const noArea = normaliseRegions(
      [{ region: 4011, latitude: 5, longitude: 5, observed_date: dateStr(now) }], now);
    check(noArea.length === 1 && noArea[0].areaMsh === null,
          'a region with no reported area still exists, with a null area');
  }

  console.log('\nBiggest first, and coloured by size');
  {
    const rows = [
      { region: 4100, latitude: 5, longitude: 5, area: 80, observed_date: dateStr(now) },
      { region: 4101, latitude: -5, longitude: -5, area: 900, observed_date: dateStr(now) },
      { region: 4102, latitude: 0, longitude: 0, area: 300, observed_date: dateStr(now) },
    ];
    const got = normaliseRegions(rows, now);
    check(got.map((r) => r.areaMsh).join(',') === '900,300,80', 'sorted by area, largest first',
          got.map((r) => r.areaMsh).join(','));
    check(got[0].color !== got[2].color, 'and the big one is not the same colour as the small one');
  }

  console.log('\nLongitude is read as Stonyhurst, or not at all');
  {
    // The location string is unambiguous: degrees from the central meridian.
    const located = normaliseRegions(
      [{ region: 4300, location: 'S14W23', area: 200, observed_date: dateStr(now) }], now);
    check(located.length === 1, 'a location string is enough on its own');
    check(located[0].latitude === -14 && located[0].longitude === 23,
          'S14W23 is 14 south, 23 west',
          `${located[0]?.latitude},${located[0]?.longitude}`);

    const east = normaliseRegions(
      [{ region: 4301, location: 'N07E45', area: 200, observed_date: dateStr(now) }], now);
    check(east[0].longitude === -45, 'and east is negative', String(east[0]?.longitude));

    // The bare numeric field is NOT always Stonyhurst - SWPC also publishes
    // Carrington longitude, which runs 0-360 from a rotating prime meridian
    // that has nothing to do with where Earth is. Reading one as the other put
    // every region past the limb, where the Earth-facing filter dropped it,
    // which is why none of them appeared on the Sun at all.
    const carrington = normaliseRegions(
      [{ region: 4302, latitude: 10, longitude: 287, area: 200, observed_date: dateStr(now) }], now);
    check(carrington.length === 0,
          'a Carrington longitude is refused rather than drawn in the wrong place',
          JSON.stringify(carrington));

    // But the location string wins even when both are present, so a report
    // carrying Carrington alongside a location still lands correctly.
    const both = normaliseRegions(
      [{ region: 4303, location: 'N05W10', latitude: 5, longitude: 287, area: 200,
         observed_date: dateStr(now) }], now);
    check(both.length === 1 && both[0].longitude === 10,
          'and the location string wins when a report carries both',
          JSON.stringify(both.map((r) => r.longitude)));

    const plausible = normaliseRegions(
      [{ region: 4304, latitude: 10, longitude: -35, area: 200, observed_date: dateStr(now) }], now);
    check(plausible.length === 1 && plausible[0].longitude === -35,
          'a numeric longitude inside a hemisphere is still trusted');
  }

} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
