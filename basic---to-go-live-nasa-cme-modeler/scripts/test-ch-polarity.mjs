#!/usr/bin/env node
// Which way a coronal hole's field points, and what that is worth.
//
//   npm run test:ch-polarity
//
// The reading is taken off a greyscale magnetogram, where white is field
// coming at us and black is field going away. Getting the sign backwards
// would invert every conclusion downstream - the sector, the season it
// favours, the advice on the panel - while still looking entirely plausible,
// so the sign is the thing most of this pins down. The rest is about refusing
// to answer: near the limb there is nothing to measure, and a dark patch that
// is not one-sided is probably not a coronal hole.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..');
const dir = mkdtempSync(join(tmpdir(), 'chpol-'));

async function load(rel) {
  const src = readFileSync(join(APP, rel), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  const out = join(dir, rel.split('/').pop());
  writeFileSync(out, src);
  return import(pathToFileURL(out).href);
}
await load('utils/solarEphemeris.ts');
await load('utils/solarDisk.ts');
const P = await load('utils/coronalHolePolarity.ts');

let pass = 0, fail = 0;
const check = (ok, label, detail) => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? '\n        ' + detail : ''}`); }
};

// ── a synthetic magnetogram ────────────────────────────────────────────────
const SIZE = 512;
const GEOM = { width: SIZE, height: SIZE, cx: SIZE / 2, cy: SIZE / 2, radius: SIZE * 0.45 };

/**
 * A blank magnetogram: mid-grey everywhere, which is zero field.
 * `paint(x, y)` returns a luma to write, or null to leave it alone.
 */
function magnetogram(paint) {
  const data = new Uint8ClampedArray(SIZE * SIZE * 4).fill(127);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = paint ? paint(x, y) : null;
      if (v === null || v === undefined) continue;
      const i = (y * SIZE + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: SIZE, height: SIZE };
}

/** A box outline in heliographic degrees, centred where asked. */
const box = (lat, lon, half = 10) => ([
  { lat: lat + half, lon: lon - half },
  { lat: lat + half, lon: lon + half },
  { lat: lat - half, lon: lon + half },
  { lat: lat - half, lon: lon - half },
]);

// ── reading one pixel ──────────────────────────────────────────────────────
console.log('\nReading a single pixel of the magnetogram');
{
  check(P.magnetogramPixelField(127, 127, 127) === 0, 'mid-grey is no field');
  check(P.magnetogramPixelField(130, 130, 130) === 0, 'and so is a hair either side of it');
  check(P.magnetogramPixelField(120, 120, 120) === 0, 'including a hair darker');

  const white = P.magnetogramPixelField(255, 255, 255);
  const black = P.magnetogramPixelField(0, 0, 0);
  check(white > 0, 'white is positive: field coming toward us, out of the Sun', String(white));
  check(black < 0, 'black is negative: field going away from us, into the Sun', String(black));
  check(Math.abs(white) === 1 && Math.abs(black) === 1, 'and both saturate at one', `${white} / ${black}`);
  check(Math.abs(white + black) < 1e-9, 'symmetrically about mid-grey');

  const mid = P.magnetogramPixelField(200, 200, 200);
  check(mid > 0 && mid < white, 'a pale grey is a weaker positive field', String(mid));
  check(P.magnetogramPixelField(180, 180, 180) < mid, 'and a paler one weaker still');

  // The GIF is greyscale so the channels agree; averaging is just noise
  // reduction, not a colour decision.
  check(P.magnetogramPixelField(200, 190, 210) === P.magnetogramPixelField(200, 200, 200),
        'a little channel noise averages out');
}

// ── summing over a footprint ───────────────────────────────────────────────
console.log('\nSumming the field over a hole footprint');
{
  const allWhite = magnetogram(() => 255);
  const s = P.samplePolygonField(allWhite, box(0, 0), GEOM);
  check(s.total > 100, `the footprint covers ${s.total} pixels`, String(s.total));
  check(s.positive === s.total && s.negative === 0, 'an all-white patch is entirely positive');
  check(Math.abs(s.signedSum - s.absSum) < 1e-9, 'so signed and absolute flux agree');

  const allBlack = magnetogram(() => 0);
  const b = P.samplePolygonField(allBlack, box(0, 0), GEOM);
  check(b.negative === b.total && b.positive === 0, 'an all-black patch is entirely negative');
  check(Math.abs(b.signedSum + b.absSum) < 1e-9, 'and its signed flux is the negative of its magnitude');
  check(b.total === s.total, 'both cover the same footprint');

  const blank = P.samplePolygonField(magnetogram(), box(0, 0), GEOM);
  check(blank.total > 100 && blank.absSum === 0, 'a blank magnetogram carries no flux at all');

  // Real holes are not solid: the flux sits in network elements with quiet
  // lanes between them, so most pixels read zero and the sum still has to work.
  const speckled = magnetogram((x, y) => ((x % 7 === 0 && y % 7 === 0) ? 255 : 127));
  const sp = P.samplePolygonField(speckled, box(0, 0), GEOM);
  check(sp.positive > 0 && sp.positive < sp.total * 0.1,
        `scattered network elements cover ${((sp.positive / sp.total) * 100).toFixed(1)}% of the footprint`);
  check(sp.signedSum > 0, 'and they still sum to a positive field');

  check(P.samplePolygonField(allWhite, [], GEOM).total === 0, 'no outline is no sample');
  check(P.samplePolygonField(allWhite, [{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }], GEOM).total === 0,
        'nor is a two-point one');

  // A hole half round the back is no longer the shape that was detected.
  check(P.samplePolygonField(allWhite, box(0, 85), GEOM).total === 0,
        'a footprint partly over the limb is not sampled rather than being sampled wrong');

  // The ring outside the hole, which is what `exclude` is for.
  const ring = P.samplePolygonField(allWhite, box(0, 0), GEOM, { scale: 1.8, exclude: 1.05 });
  check(ring.total > s.total * 0.5, 'a surrounding ring covers a comparable area', String(ring.total));
  const solid = P.samplePolygonField(allWhite, box(0, 0), GEOM, { scale: 1.8 });
  check(ring.total < solid.total, 'and is smaller than the filled version, so the middle really is cut out');
}

// ── calling it ─────────────────────────────────────────────────────────────
console.log('\nCalling the polarity');
{
  const unipolar = (sign) => ({
    total: 1000, positive: sign > 0 ? 400 : 20, negative: sign > 0 ? 20 : 400,
    signedSum: sign * 300, absSum: 340,
  });

  const pos = P.classifyChPolarity(unipolar(1), null, 5);
  check(pos.polarity === 'positive', 'mostly-white flux is a positive hole', pos.polarity);
  check(pos.sector === 'away', 'which drags an away sector past Earth', pos.sector);
  check(/away/.test(pos.summary), 'and the summary says so', pos.summary);

  const neg = P.classifyChPolarity(unipolar(-1), null, 5);
  check(neg.polarity === 'negative', 'mostly-black flux is a negative hole', neg.polarity);
  check(neg.sector === 'toward', 'which drags a toward sector', neg.sector);
  check(pos.imbalance === -neg.imbalance, 'and the two are mirror images');

  // Balanced flux is not a coronal hole.
  const mixed = P.classifyChPolarity({ total: 1000, positive: 200, negative: 190, signedSum: 10, absSum: 340 }, null, 0);
  check(mixed.polarity === 'mixed', 'balanced flux reads as mixed', mixed.polarity);
  check(mixed.sector === 'unknown', 'and gives no sector rather than a coin toss');
  check(/filament|shadow/.test(mixed.detail), 'saying what it is more likely to be', mixed.detail);

  // Near the limb there is nothing to measure.
  const limb = P.classifyChPolarity(unipolar(1), null, 75);
  check(limb.polarity === 'unknown', 'a hole near the limb is not called at all', limb.polarity);
  check(limb.confidence === 'none', 'with no confidence in it');
  check(/pointing at us|measure/.test(limb.detail), 'and an explanation of why', limb.detail);
  check(P.classifyChPolarity(unipolar(1), null, -75).polarity === 'unknown', 'on either limb');
  check(/toward us/.test(P.classifyChPolarity(unipolar(1), null, -75).detail),
        'and an eastern one is told it will firm up');

  // Not enough pixels, or not enough of them carrying field.
  check(P.classifyChPolarity({ total: 10, positive: 8, negative: 0, signedSum: 8, absSum: 8 }, null, 0).polarity === 'unknown',
        'a handful of pixels is not a measurement');
  check(P.classifyChPolarity({ total: 1000, positive: 5, negative: 2, signedSum: 5, absSum: 6 }, null, 0).polarity === 'unknown',
        'nor is a footprint where almost nothing carries field');

  // Confidence degrades where it should.
  check(pos.confidence === 'good', 'a strong reading near disk centre is a good one', pos.confidence);
  check(P.classifyChPolarity(unipolar(1), null, 50).confidence === 'fair',
        'the same reading further out is only fair');
  check(P.classifyChPolarity({ total: 1000, positive: 300, negative: 100, signedSum: 140, absSum: 340 }, null, 0).confidence === 'fair',
        'and a marginally one-sided one is only fair too');

  // If the ring outside leans the same way as the inside, the boundary is
  // suspect: quiet Sun is balanced, so a one-sided outside means the outline
  // is probably not where the hole actually ends.
  const leaning = P.classifyChPolarity(unipolar(1), { total: 1000, positive: 380, negative: 30, signedSum: 290, absSum: 330 }, 0);
  check(leaning.confidence === 'fair', 'a surround leaning the same way lowers confidence', leaning.confidence);
  check(leaning.polarity === 'positive', 'without changing the answer');
  const balanced = P.classifyChPolarity(unipolar(1), { total: 1000, positive: 180, negative: 175, signedSum: 5, absSum: 330 }, 0);
  check(balanced.confidence === 'good', 'a balanced surround leaves it alone');
  check(balanced.surroundImbalance !== null && Math.abs(balanced.surroundImbalance) < 0.1,
        'and is reported as balanced', String(balanced.surroundImbalance));
}

// ── what the sector is worth today ─────────────────────────────────────────
console.log('\nWhat the sector is worth at this time of year');
{
  const march = new Date(Date.UTC(2026, 2, 20));
  const sept  = new Date(Date.UTC(2026, 8, 22));
  const june  = new Date(Date.UTC(2026, 5, 21));
  const dec   = new Date(Date.UTC(2026, 11, 21));

  // Russell-McPherron. Away sector (By > 0) is the geoeffective one around
  // the September equinox; toward (By < 0) around March. Getting these two
  // the wrong way round is the single most consequential mistake available
  // here, because it would confidently tell people the wrong nights.
  check(P.sectorSeasonNote('away', sept).favourable === true, 'an away sector is favoured in September');
  check(P.sectorSeasonNote('toward', march).favourable === true, 'a toward sector is favoured in March');
  check(P.sectorSeasonNote('away', march).favourable === false, 'an away sector is the wrong one in March');
  check(P.sectorSeasonNote('toward', sept).favourable === false, 'a toward sector is the wrong one in September');

  check(P.sectorSeasonNote('away', june).favourable === null, 'neither is favoured at the June solstice');
  check(P.sectorSeasonNote('toward', dec).favourable === null, 'or the December one');
  check(/solstice/.test(P.sectorSeasonNote('away', june).note), 'and the note says why', P.sectorSeasonNote('away', june).note);

  check(P.sectorSeasonNote('unknown', sept).favourable === null, 'no sector, nothing to say');
  check(P.sectorSeasonNote('unknown', sept).note === '', 'and nothing said');

  // The window is six weeks either side of the equinox, so it opens well
  // before the date itself - which is the point, since a stream takes days to
  // arrive and nobody plans around a single day.
  check(P.sectorSeasonNote('toward', new Date(Date.UTC(2026, 1, 4))).favourable === true,
        'the March window is already open in early February');
  check(P.sectorSeasonNote('toward', new Date(Date.UTC(2026, 1, 3))).favourable === null,
        'but not a day earlier');
  check(P.sectorSeasonNote('away', new Date(Date.UTC(2026, 10, 1))).favourable === true,
        'and the September one is still open in early November');

  // Distance to an equinox is measured the short way round the year, so a
  // date in January is compared against the previous September, not the
  // three hundred days forward to the next one.
  const jan = P.sectorSeasonNote('away', new Date(Date.UTC(2027, 0, 1)));
  check(jan.favourable === null && /solstice/.test(jan.note),
        'New Year reads as solstice-ish rather than as far from September as possible', jan.note);

  // Every day of the year gets an answer, and the two sectors never agree.
  let sane = true;
  for (let d = 0; d < 365; d++) {
    const day = new Date(Date.UTC(2026, 0, 1 + d));
    const a = P.sectorSeasonNote('away', day).favourable;
    const t = P.sectorSeasonNote('toward', day).favourable;
    if (a !== null && t !== null && a === t) sane = false;
    if (!P.sectorSeasonNote('away', day).note) sane = false;
  }
  check(sane, 'on every day of the year the two sectors never both win, and both get a note');
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
