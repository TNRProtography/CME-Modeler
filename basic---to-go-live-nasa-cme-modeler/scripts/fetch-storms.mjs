#!/usr/bin/env node
// Pull the preset storms' real make-up from NASA's DONKI catalogue and write
// components/game/stormData.ts from it.
//
//   node scripts/fetch-storms.mjs
//   node scripts/fetch-storms.mjs --key YOUR_NASA_KEY   (DEMO_KEY is rate
//                                                        limited to 30/hour)
//
// For each event window it asks DONKI for:
//   CME            every ejection, with its analyses and any linked flare
//   CMEAnalysis    speed, half angle, source latitude and longitude, type
//   FLR            the flares, their class and where on the disk they were
//   GST            the observed Kp the storm actually reached
//
// and keeps the Earth-directed clouds, in launch order, with each one's own
// figures. DONKI starts in 2010, so the two historical events cannot come from
// it; those stay as they are and the script says so.

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT  = join(HERE, '..', 'components', 'game', 'stormData.ts');

const keyArg = process.argv.indexOf('--key');
const API_KEY = keyArg > -1 ? process.argv[keyArg + 1] : (process.env.NASA_API_KEY || 'DEMO_KEY');
// DONKI_BASE lets the parsing be exercised against a fixture without
// calling NASA, which is how the script itself is tested.
const BASE = process.env.DONKI_BASE || 'https://api.nasa.gov/DONKI';

// The windows to query, and how each maps onto a preset. Each window starts a
// little before the first eruption and ends after the last, so nothing at the
// edges is missed.
const EVENTS = [
  { id: 'may-2024', from: '2024-05-07', to: '2024-05-12', minSpeed: 700 },
  { id: 'oct-2024', from: '2024-10-07', to: '2024-10-11', minSpeed: 700 },
  { id: 'apr-2023', from: '2023-04-20', to: '2023-04-24', minSpeed: 600 },
];
// Anything before DONKI's own record begins cannot be fetched.
const PRE_DONKI = ['mar-1989', 'carrington'];

async function get(path, params) {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('api_key', API_KEY);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${path} returned ${res.status}. ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** GOES class string, e.g. "X2.25", split into the class and the magnitude. */
function parseFlare(classType) {
  const m = /^([ABCMX])\s*([\d.]+)?$/i.exec((classType || '').trim());
  if (!m) return null;
  const cls = m[1].toUpperCase();
  const mag = m[2] ? parseFloat(m[2]) : 1;
  // The model only has C, M and X. Anything fainter is not launching a storm.
  if (cls === 'A' || cls === 'B') return { flareClass: 'C', flareMag: 1 };
  return { flareClass: cls, flareMag: Math.min(9.9, Math.max(1, mag)) };
}

/** "S19W34" as DONKI writes it, into signed degrees. West is positive. */
function parseSourceLocation(loc) {
  const m = /^([NS])(\d+)([EW])(\d+)$/i.exec((loc || '').trim());
  if (!m) return null;
  const lat = (m[1].toUpperCase() === 'S' ? -1 : 1) * parseInt(m[2], 10);
  const lon = (m[3].toUpperCase() === 'W' ? 1 : -1) * parseInt(m[4], 10);
  return { latDeg: lat, lonDeg: lon };
}

function bestAnalysis(cme) {
  const list = cme.cmeAnalyses || [];
  if (!list.length) return null;
  return list.find(a => a.isMostAccurate) || list[0];
}

async function fetchEvent(ev) {
  const [cmes, flares, storms] = await Promise.all([
    get('CME', { startDate: ev.from, endDate: ev.to }),
    get('FLR', { startDate: ev.from, endDate: ev.to }),
    get('GST', { startDate: ev.from, endDate: ev.to }),
  ]);

  // Flares, so a cloud can be matched to the one it went with.
  const flareByTime = flares
    .map(f => ({ t: Date.parse(f.beginTime || f.peakTime), f }))
    .filter(x => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);

  const rows = [];
  for (const cme of cmes) {
    const a = bestAnalysis(cme);
    if (!a || a.speed == null || a.latitude == null || a.longitude == null) continue;
    if (a.speed < ev.minSpeed) continue;

    const tStart = Date.parse(cme.startTime);
    // The flare that went off closest before it, inside two hours.
    let flare = null;
    for (const { t, f } of flareByTime) {
      if (t <= tStart + 30 * 60000 && tStart - t < 2 * 3600000) flare = f;
    }
    const parsed = flare ? parseFlare(flare.classType) : null;
    // DONKI gives the CME its own source coordinates; the flare's are a
    // fallback when the analysis does not carry them.
    const fromFlare = flare ? parseSourceLocation(flare.sourceLocation) : null;

    rows.push({
      tStart,
      flareClass: parsed ? parsed.flareClass : 'M',
      flareMag:   parsed ? parsed.flareMag : 5,
      lonDeg:     a.longitude ?? (fromFlare ? fromFlare.lonDeg : 0),
      latDeg:     a.latitude  ?? (fromFlare ? fromFlare.latDeg : 0),
      speedKms:   Math.round(a.speed),
      // DONKI's halfAngle is the half width in degrees. Where it is missing,
      // fall back to the same 30 the visualisation itself assumes rather than
      // to something huge: a halo is a cloud pointed at us, not a wide one,
      // and the scene scales a cloud by the tangent of this.
      halfWidthDeg: Math.max(12, Math.min(70, Math.round(a.halfAngle ?? 30))),
      flareLabel: flare ? `${flare.classType}, ${new Date(tStart).toUTCString().slice(5, 16)}` : null,
      activityID: cme.activityID,
      note: (cme.note || '').slice(0, 200),
      type: a.type || null,
    });
  }

  rows.sort((x, y) => x.tStart - y.tStart);
  if (!rows.length) return { clouds: [], kp: null, raw: { cmes: cmes.length, flares: flares.length } };

  const t0 = rows[0].tStart;
  const clouds = rows.map(r => ({
    flareClass: r.flareClass,
    flareMag: r.flareMag,
    lonDeg: r.lonDeg,
    latDeg: r.latDeg,
    speedKms: r.speedKms,
    halfWidthDeg: r.halfWidthDeg,
    offsetHours: +(((r.tStart - t0) / 3600000).toFixed(1)),
    label: r.flareLabel || r.activityID,
  }));

  // The highest Kp DONKI recorded for the storm that followed.
  let kp = null;
  for (const g of storms) {
    for (const k of g.allKpIndex || []) {
      if (kp === null || k.kpIndex > kp) kp = k.kpIndex;
    }
  }
  return { clouds, kp, raw: { cmes: cmes.length, flares: flares.length, kept: rows.length } };
}

function fmtCloud(c) {
  return `  { flareClass: '${c.flareClass}', flareMag: ${c.flareMag}, lonDeg: ${c.lonDeg}, latDeg: ${c.latDeg}, ` +
         `speedKms: ${c.speedKms}, halfWidthDeg: ${c.halfWidthDeg}, offsetHours: ${c.offsetHours}, ` +
         `label: ${JSON.stringify(c.label)} },`;
}

const main = async () => {
  const existing = readFileSync(OUT, 'utf8');
  const fetched = {};
  for (const ev of EVENTS) {
    process.stdout.write(`${ev.id}: querying DONKI ${ev.from} to ${ev.to} ... `);
    try {
      const r = await fetchEvent(ev);
      fetched[ev.id] = r;
      console.log(`${r.clouds.length} Earth-directed clouds kept of ${r.raw.cmes} CMEs` +
                  (r.kp != null ? `, observed Kp ${r.kp}` : ''));
      for (const c of r.clouds) {
        console.log(`    ${String(c.offsetHours).padStart(6)}h  ${c.flareClass}${c.flareMag}` +
                    `  ${String(c.speedKms).padStart(5)} km/s  half ${String(c.halfWidthDeg).padStart(3)}°` +
                    `  at ${c.lonDeg}°, ${c.latDeg}°`);
      }
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
      console.log('  Nothing written for this event; the existing values are kept.');
    }
  }

  if (!Object.keys(fetched).length) {
    console.log('\nNothing fetched, so stormData.ts is unchanged.');
    process.exit(1);
  }

  // Rewrite only the blocks we actually got, so a partial run cannot quietly
  // wipe the rest.
  let out = existing;
  const NAMES = { 'may-2024': 'GANNON', 'oct-2024': 'OCT_2024', 'apr-2023': 'APR_2023' };
  const stamp = new Date().toISOString();
  for (const [id, r] of Object.entries(fetched)) {
    if (!r.clouds.length) continue;
    const name = NAMES[id];
    const body = `const ${name}: CloudSpec[] = [\n${r.clouds.map(fmtCloud).join('\n')}\n];`;
    const re = new RegExp(`const ${name}: CloudSpec\\[\\] = \\[[\\s\\S]*?\\n\\];`);
    if (!re.test(out)) { console.log(`Could not find the ${name} block to replace.`); continue; }
    out = out.replace(re, body);
    const ev = EVENTS.find(e => e.id === id);
    // Each entry is one line, so replace the whole line rather than trying to
    // balance braces: the nested window object defeats a naive [^}]* match.
    out = out.replace(
      new RegExp(`^(\\s*)'${id}':.*$`, 'm'),
      `$1'${id}':   { clouds: ${name}, source: 'donki', fetchedAt: '${stamp}', window: { from: '${ev.from}', to: '${ev.to}' } },`
    );
  }
  writeFileSync(OUT, out);
  console.log(`\nWrote ${OUT}`);
  console.log(`Pre-DONKI and therefore untouched: ${PRE_DONKI.join(', ')}`);
};

main().catch(e => { console.error(e); process.exit(1); });
