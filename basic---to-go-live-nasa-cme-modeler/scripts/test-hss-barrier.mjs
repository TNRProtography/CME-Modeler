#!/usr/bin/env node
// HSS barrier (experimental): streams as walls a CME's spread cannot cross.
//
// Two things have to hold. The walls must be the streams as DRAWN - the arm's
// own vertices, turned the way the scene turns them - or a CME visibly stops
// short of, or inside, the arm it is meant to be stopped by. And the rules
// must be the agreed ones: centre and speed untouched, a flank that would
// cross a stream stops at its near edge, the other flank is free, and a CME
// launched inside a stream stays between that stream's edges.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'hssb-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};
const deg = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/coronalHoleGeometry.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'g.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('npx', ['esbuild', join(root, 'utils/hssBarrier.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'b.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const { buildParkerSpiralMesh } = await import(pathToFileURL(join(out, 'g.mjs')).href);
  const { streamSectorAt, barrierLimitsFor, barrierNote, wrapAngle, MIN_FLANK } =
    await import(pathToFileURL(join(out, 'b.mjs')).href);

  // ── The wall is the drawn arm ───────────────────────────────────────────
  console.log('\nWalls follow the arm as drawn');
  const SUN_R = 0.1, REACH = 1.65 * 3;
  const ch = { id: 'CH96', lat: -8, lon: 25, widthDeg: 30, heightDeg: 26, darkness: 0.6,
               opacity: 0.5, estimatedSpeedKms: 650 };
  const mesh = buildParkerSpiralMesh(THREE, ch, SUN_R, REACH, 0);
  const samples = mesh.userData.barrier;
  check(samples && samples.r.length > 100, 'the arm records its backbone', String(samples?.r.length));

  // Where the GPU puts the vertices: the shader's own rotation, then the
  // parent groups' Y rotation (the Sun's turn plus the anchor).
  const groupAngle = 0.9;
  const lonRad = deg(-ch.lon);
  const pos = mesh.geometry.getAttribute('position');
  const SIDES = 8;
  const worldVertex = (k) => {
    const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
    const sx = x * Math.cos(lonRad) - z * Math.sin(lonRad);
    const sz = x * Math.sin(lonRad) + z * Math.cos(lonRad);
    // three.js rotation.y
    return new THREE.Vector3(
      sx * Math.cos(groupAngle) + sz * Math.sin(groupAngle), y,
      -sx * Math.sin(groupAngle) + sz * Math.cos(groupAngle));
  };

  for (const ring of [20, 110, 200]) {
    const c = new THREE.Vector3();
    for (let s = 0; s < SIDES; s++) c.add(worldVertex(ring * SIDES + s));
    c.divideScalar(SIDES);
    const R = c.length();
    const sec = streamSectorAt(samples, R, groupAngle);
    const drawnAz = Math.atan2(c.x, c.z);
    check(Math.abs(toDeg(wrapAngle(sec.az - drawnAz))) < 0.5,
      `ring ${ring}: wall centre sits on the drawn tube (${toDeg(sec.az).toFixed(1)}° vs ${toDeg(drawnAz).toFixed(1)}°)`);

    // Where a sphere of this radius actually cuts the drawn tube: every
    // vertex of the mesh at about this distance, whichever ring it is on. Far
    // out the arm runs nearly sideways, so the cut takes in many rings. The
    // wall's half-width is an estimate of that cut and should match it
    // within a few degrees.
    const band = (samples.r[1] - samples.r[0]) / 2;   // one profile bin
    let maxOff = 0;
    for (let k = 0; k < pos.count; k++) {
      const v = worldVertex(k);
      if (Math.abs(v.length() - R) > band) continue;
      maxOff = Math.max(maxOff, Math.abs(wrapAngle(Math.atan2(v.x, v.z) - drawnAz)));
    }
    // The farther edge, measured from the same place the vertex scan measures.
    const mid = wrapAngle(sec.az - drawnAz);
    const edge = Math.max(Math.abs(mid + sec.lo), Math.abs(mid + sec.hi));
    check(Math.abs(toDeg(edge - maxOff)) < 1,
      `ring ${ring}: wall edge on the drawn tube's edge (${toDeg(edge).toFixed(1)}° vs ${toDeg(maxOff).toFixed(1)}°)`);
  }

  // The spiral: further out, the stream is somewhere else.
  const near = streamSectorAt(samples, samples.r[3], groupAngle);
  const far = streamSectorAt(samples, samples.r[110], groupAngle);
  check(Math.abs(toDeg(wrapAngle(far.az - near.az))) > 20,
    `the wall winds with the spiral (${toDeg(wrapAngle(far.az - near.az)).toFixed(0)}° from Sun to far end)`);
  check(streamSectorAt(samples, REACH * 1.2, groupAngle) === null, 'no wall past the end of the arm');

  // Lopsided: where the arm bends, the edges are not symmetric, and each flank
  // must meet its own edge.
  L0: {
    const R = samples.r[60];
    const sec = streamSectorAt(samples, R, groupAngle);
    const cmeW = { az: wrapAngle(sec.az + sec.lo - deg(5)), lat: 0, halfAngle: deg(60) };
    const Lw = barrierLimitsFor(cmeW, [sec]);
    check(Math.abs(toDeg(Lw.west) - 5) < 1e-6, `a CME east of the arm stops at its east edge (${toDeg(Lw.west).toFixed(2)}°)`);
  }

  // ── The rules ───────────────────────────────────────────────────────────
  console.log('\nFlanks stop at the near edge; the other flank is free');
  const sector = (id, azDeg, halfDeg, lo = -30, hi = 30) =>
    ({ id, az: deg(azDeg), lo: -deg(halfDeg), hi: deg(halfDeg), latLo: deg(lo), latHi: deg(hi) });
  const cme = { az: 0, lat: 0, halfAngle: deg(45) };

  let L = barrierLimitsFor(cme, []);
  check(L.west === cme.halfAngle && L.east === cme.halfAngle && !L.westBy && !L.eastBy,
    'no streams: the CME spreads its full width');
  check(barrierNote(L) === null, 'and there is nothing to say');

  // A stream 30° west, 10° half-width: the west flank stops at 20°.
  L = barrierLimitsFor(cme, [sector('CH96', 30, 10)]);
  check(Math.abs(toDeg(L.west) - 20) < 1e-9, `west flank stops at the near edge (20°): ${toDeg(L.west)}`);
  check(L.east === cme.halfAngle && L.eastBy === null, 'east flank expands normally');
  check(barrierNote(L) === 'West flank held by CH96', `note: ${barrierNote(L)}`);

  // East, and two streams: each side takes its own nearest wall.
  L = barrierLimitsFor(cme, [sector('CH96', 30, 10), sector('CH97', -25, 5), sector('CH98', -40, 5)]);
  check(Math.abs(toDeg(L.east) - 20) < 1e-9 && L.eastBy === 'CH97', 'east flank stops at the nearer stream');
  check(barrierNote(L) === 'East flank held by CH97 · West flank held by CH96', `note: ${barrierNote(L)}`);

  // Out of reach: a stream beyond the spread does nothing.
  L = barrierLimitsFor(cme, [sector('CH96', 70, 10)]);
  check(L.west === cme.halfAngle && !L.westBy, 'a stream beyond the spread does not hold it');

  // Latitude: a stream passing entirely above the CME does not block it.
  L = barrierLimitsFor({ az: 0, lat: deg(-40), halfAngle: deg(20) }, [sector('CH96', 15, 5, 10, 40)]);
  check(!L.westBy, 'a stream passing above the CME is not a wall');

  // Across ±180°.
  L = barrierLimitsFor({ az: deg(170), lat: 0, halfAngle: deg(45) }, [sector('CH96', -170, 5)]);
  check(Math.abs(toDeg(L.west) - 15) < 1e-6, `walls work across ±180° (${toDeg(L.west).toFixed(1)}°)`);

  console.log('\nA CME launched inside a stream stays inside it');
  L = barrierLimitsFor(cme, [sector('CH96', 5, 15)]);
  check(Math.abs(toDeg(L.west) - 20) < 1e-9 && Math.abs(toDeg(L.east) - 10) < 1e-9,
    `held between the edges: west 20°, east 10° (${toDeg(L.west)}, ${toDeg(L.east)})`);
  check(L.inside === 'CH96' && barrierNote(L) === 'Held inside the CH96 stream', `note: ${barrierNote(L)}`);

  console.log('\nNever collapses');
  L = barrierLimitsFor(cme, [sector('CH96', 10.2, 10)]);
  check(L.west >= MIN_FLANK, 'a wall right beside the centre leaves a sliver of flank');
} catch (err) {
  fail++;
  console.error(err);
} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
