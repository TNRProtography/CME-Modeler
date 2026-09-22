#!/usr/bin/env node
// Coronal holes on the 3D Sun, sized for the moment being shown.
//
// The scene drew every hole at its latest measured size no matter where the
// timeline sat, so scrubbing back three days put today's hole on Tuesday's
// Sun - and a hole that has doubled since Tuesday was simply wrong by a
// factor of two. The evolution tracks were already being passed in and
// explicitly ignored.
//
// The shape has to survive the resize. The outline is a measurement of THIS
// hole, not a generic blob, so it is scaled about its own centroid rather
// than rebuilt from a width.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'chsize-'));

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const HOUR = 3600000;
const now = Date.UTC(2026, 8, 22, 0, 0, 0);

/** Just enough of three.js for the geometry helpers. */
class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  divideScalar(s) { this.x /= s; this.y /= s; this.z /= s; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  lengthSq() { return this.x ** 2 + this.y ** 2 + this.z ** 2; }
  length() { return Math.sqrt(this.lengthSq()); }
  normalize() { const l = this.length() || 1; return this.divideScalar(l); }
  distanceToSquared(v) { return (this.x - v.x) ** 2 + (this.y - v.y) ** 2 + (this.z - v.z) ** 2; }
  distanceTo(v) { return Math.sqrt(this.distanceToSquared(v)); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) {
    this.x = a.y * b.z - a.z * b.y;
    this.y = a.z * b.x - a.x * b.z;
    this.z = a.x * b.y - a.y * b.x;
    return this;
  }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
}
const THREE = { Vector3: V3, MathUtils: { degToRad: (d) => d * Math.PI / 180 } };

// buildChFootprintPoints closes the loop by repeating vertex 0, so a naive
// mean counts that vertex twice and reports a centroid that is not the
// outline's. buildChSurfaceMesh drops it before triangulating; so does this.
const openLoop = (pts) =>
  (pts.length > 1 && pts[0].distanceToSquared(pts[pts.length - 1]) < 1e-10
    ? pts.slice(0, -1) : pts);

/** Angular radius of a footprint about its own centroid, in degrees. */
const angularExtent = (raw) => {
  const pts = openLoop(raw);
  const cen = new V3();
  pts.forEach((p) => cen.add(p));
  cen.divideScalar(pts.length).normalize();
  let max = 0;
  for (const p of pts) {
    const u = p.clone().normalize();
    max = Math.max(max, Math.acos(Math.max(-1, Math.min(1, u.dot(cen)))));
  }
  return max * 180 / Math.PI;
};

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/coronalHoleGeometry.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'g.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync('npx', ['esbuild', join(root, 'utils/coronalHoleHistory.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'h.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });

  const { buildChFootprintPoints } = await import(pathToFileURL(join(out, 'g.mjs')).href);
  const { interpolateCHAtTimeMs, chWasPresentAt, chMeasuredSpan, CH_PRESENCE_GRACE_MS } =
    await import(pathToFileURL(join(out, 'h.mjs')).href);
  execFileSync('npx', ['esbuild', join(root, 'utils/solarDisk.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 'd.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const { longitudeAt, SOLAR_SYNODIC_DEG_PER_DAY } = await import(pathToFileURL(join(out, 'd.mjs')).href);

  // A deliberately lopsided outline, so a change of shape is detectable.
  const polygon = [
    { lat: 12, lon: -4 }, { lat: 8, lon: 9 }, { lat: -2, lon: 11 },
    { lat: -11, lon: 3 }, { lat: -7, lon: -8 }, { lat: 3, lon: -10 },
  ];
  const hole = { id: 'CH96', lat: -20, lon: 5, widthDeg: 48, heightDeg: 44, darkness: 0.6, polygon };
  const SUN_R = 10;

  console.log('\nScaling changes the size');
  {
    const base = angularExtent(buildChFootprintPoints(THREE, hole, SUN_R, 1));
    const big = angularExtent(buildChFootprintPoints(THREE, hole, SUN_R, 2));
    const small = angularExtent(buildChFootprintPoints(THREE, hole, SUN_R, 0.5));
    check(big > base * 1.7, `doubling grows it (${base.toFixed(1)}° → ${big.toFixed(1)}°)`,
          `${base.toFixed(1)} ${big.toFixed(1)}`);
    check(small < base * 0.7, `halving shrinks it (${base.toFixed(1)}° → ${small.toFixed(1)}°)`,
          `${base.toFixed(1)} ${small.toFixed(1)}`);
    check(Math.abs(angularExtent(buildChFootprintPoints(THREE, hole, SUN_R, 1)) - base) < 1e-9,
          'and a scale of 1 is exactly the old behaviour');
  }

  console.log('\nBut not the shape, and not where it is');
  {
    // Distance from the centroid to each vertex, as a fraction of the largest.
    // A resize must not reorder or reshape those, or the hole has become a
    // different hole.
    const profile = (scale) => {
      const pts = openLoop(buildChFootprintPoints(THREE, hole, SUN_R, scale));
      const cen = new V3();
      pts.forEach((p) => cen.add(p));
      cen.divideScalar(pts.length).normalize();
      const ds = pts.map((p) => Math.acos(Math.max(-1, Math.min(1, p.clone().normalize().dot(cen)))));
      const max = Math.max(...ds);
      return ds.map((d) => d / max);
    };
    const a = profile(1), b = profile(1.8);
    const worst = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    check(worst < 0.05, `the outline keeps its shape when resized (worst ${worst.toFixed(3)})`,
          worst.toFixed(3));

    const centroidOf = (scale) => {
      const pts = openLoop(buildChFootprintPoints(THREE, hole, SUN_R, scale));
      const cen = new V3();
      pts.forEach((p) => cen.add(p));
      return cen.divideScalar(pts.length).normalize();
    };
    // Tight on purpose. The patch is anchored to the position the detector
    // measured, and so is the HSS stream drawn from it - if the patch wanders
    // as it grows, a hole and its own stream part company on screen.
    const drift = centroidOf(1).distanceTo(centroidOf(2.2));
    check(drift < 0.002,
          `and stays put even at 2.2x - it grows about itself (${(drift * 180 / Math.PI).toFixed(3)}°)`,
          String(drift));
  }

  console.log('\nThe size comes from the track, at the time being shown');
  {
    // 24 degrees three days ago, 48 now: a hole that has doubled.
    const snapshots = [0, 1, 2, 3].map((d) => ({
      timestampMs: now - (3 - d) * 24 * HOUR,
      hoursAgo: (3 - d) * 24,
      ch: { ...hole, widthDeg: 24 + d * 8, heightDeg: 22 + d * 7 },
    }));
    const evolution = { trackId: 'CH96', snapshots, current: hole };

    const atNow = interpolateCHAtTimeMs(evolution, now);
    const at3d = interpolateCHAtTimeMs(evolution, now - 3 * 24 * HOUR);
    check(Math.round(atNow.widthDeg) === 48, `now reads 48° (${atNow.widthDeg.toFixed(1)})`, String(atNow.widthDeg));
    check(Math.round(at3d.widthDeg) === 24, `three days ago reads 24° (${at3d.widthDeg.toFixed(1)})`, String(at3d.widthDeg));

    // Which is the scale the scene applies: half the size, three days back.
    const scaleAt = (ms) => {
      const at = interpolateCHAtTimeMs(evolution, ms);
      return Math.max(0.35, Math.min(2.5, at.widthDeg / (hole.widthDeg || 1)));
    };
    check(Math.abs(scaleAt(now) - 1) < 0.01, 'so today draws at full size');
    check(Math.abs(scaleAt(now - 3 * 24 * HOUR) - 0.5) < 0.01,
          `and three days ago at half (${scaleAt(now - 3 * 24 * HOUR).toFixed(2)})`,
          scaleAt(now - 3 * 24 * HOUR).toFixed(2));

    const midway = scaleAt(now - 36 * HOUR);
    check(midway > 0.5 && midway < 1, `with the hours between interpolated (${midway.toFixed(2)})`,
          midway.toFixed(2));
  }

  console.log('\nOne bad frame cannot swallow the disk');
  {
    // The detector merging two holes for one frame is a real failure mode. It
    // must not produce a hole covering the Sun, nor one that vanishes.
    const clamp = (w) => Math.max(0.35, Math.min(2.5, w / 48));
    check(clamp(4800) === 2.5, 'an absurdly large measurement is capped');
    check(clamp(0.5) === 0.35, 'and an absurdly small one has a floor');
    check(Math.abs(clamp(48) - 1) < 1e-9, 'while a sane one passes through untouched');
  }

  console.log('\nNo history is not a crash');
  {
    const empty = { trackId: 'CH99', snapshots: [], current: hole };
    check(interpolateCHAtTimeMs(empty, now) === null, 'an empty track gives null, so the caller draws as measured');
    const allNull = {
      trackId: 'CH98',
      snapshots: [{ timestampMs: now - HOUR, hoursAgo: 1, ch: null }],
      current: hole,
    };
    const got = interpolateCHAtTimeMs(allNull, now);
    check(got === null || Number.isFinite(got.widthDeg),
          'and a track of misses gives either null or a real number, never NaN',
          JSON.stringify(got));
  }

  console.log('\nA hole is only drawn for the days it existed');
  {
    // Measured from five days ago until two days ago, then gone.
    const snaps = [5, 4, 3, 2].map((d) => ({
      timestampMs: now - d * 24 * HOUR,
      hoursAgo: d * 24,
      ch: { ...hole, widthDeg: 30, lat: -20, lon: 0 },
    }));
    const evolution = { trackId: 'CH90', snapshots: snaps, current: hole };

    const span = chMeasuredSpan(evolution);
    check(span.firstMs === now - 5 * 24 * HOUR && span.lastMs === now - 2 * 24 * HOUR,
          'the measured span is the first and last frame it was seen in');

    check(chWasPresentAt(evolution, now - 3 * 24 * HOUR),
          'it is drawn in the middle of its life');
    check(!chWasPresentAt(evolution, now - 6 * 24 * HOUR),
          'not before it was ever measured - scrubbing back a week must not show it');
    check(!chWasPresentAt(evolution, now),
          'and not today, when it has been gone for two days');

    // interpolateCHAtTimeMs alone cannot answer this: outside the track it
    // pins to the nearest measurement and hands back a position, which is
    // right for bridging a gap and wrong for history.
    check(interpolateCHAtTimeMs(evolution, now - 6 * 24 * HOUR) !== null,
          'which is why presence is a separate question from position');
  }

  console.log('\nA missed frame does not make it blink');
  {
    // Seen, missed, seen: the detector drops a hole in about one frame in ten.
    const snaps = [
      { timestampMs: now - 6 * HOUR, hoursAgo: 6, ch: { ...hole, widthDeg: 30 } },
      { timestampMs: now - 4 * HOUR, hoursAgo: 4, ch: null },
      { timestampMs: now - 2 * HOUR, hoursAgo: 2, ch: { ...hole, widthDeg: 32 } },
    ];
    const evolution = { trackId: 'CH91', snapshots: snaps, current: hole };
    check(chWasPresentAt(evolution, now - 4 * HOUR),
          'a frame the detector missed inside the span is still a frame it was there');
    check(chWasPresentAt(evolution, now - 1 * HOUR),
          'and the grace period covers the hours just after the last measurement');
    check(!chWasPresentAt(evolution, now - 2 * HOUR + CH_PRESENCE_GRACE_MS + HOUR),
          'but not indefinitely - a closed hole does leave the screen');
  }

  console.log('\nAn empty track is never present');
  {
    check(chMeasuredSpan({ trackId: 'X', snapshots: [], current: hole }) === null,
          'no measurements, no span');
    check(!chWasPresentAt({ trackId: 'X', snapshots: [], current: hole }, now),
          'and nothing to draw');
    const allMissed = {
      trackId: 'Y',
      snapshots: [{ timestampMs: now - HOUR, hoursAgo: 1, ch: null }],
      current: hole,
    };
    check(!chWasPresentAt(allMissed, now),
          'a track of nothing but misses is not a hole that existed');
  }


  console.log('\nSolar rotation is applied once, not twice');
  {
    // The CH group is a child of sunMesh and its rotation is anchored to the
    // detection time, so the Sun's turn is ALREADY in the scene. What goes
    // into the geometry is the historical measurement carried into that
    // anchor's frame. Get this wrong and a hole scrubbed three days back sits
    // 40 degrees from where it belongs - the rotation counted twice.
    const anchorMs = now;

    // A hole that has not moved relative to the Sun: measured at Stonyhurst
    // -40 three days ago is the same feature as +0 today.
    const threeDaysAgo = now - 3 * 24 * HOUR;
    const lonThen = -SOLAR_SYNODIC_DEG_PER_DAY * 3;
    const carried = longitudeAt(lonThen, threeDaysAgo, anchorMs);
    check(Math.abs(carried - 0) < 0.01,
          `a hole that has not drifted lands at the anchor longitude (${carried.toFixed(2)}°)`,
          carried.toFixed(3));

    // Using the raw historical longitude instead would place it 40 degrees
    // east of where it should be, which is the bug this guards.
    check(Math.abs(lonThen - carried) > 39,
          `while the raw measurement would be ${Math.abs(lonThen - carried).toFixed(0)}° out`,
          Math.abs(lonThen - carried).toFixed(1));

    // A hole that HAS drifted keeps its drift after the conversion, because
    // that is the part worth seeing on the scrubber.
    const drifted = longitudeAt(lonThen + 7, threeDaysAgo, anchorMs);
    check(Math.abs(drifted - 7) < 0.01,
          `and real proper motion survives the conversion (${drifted.toFixed(2)}°)`,
          drifted.toFixed(3));

    check(Math.abs(longitudeAt(12, anchorMs, anchorMs) - 12) < 1e-9,
          'converting a measurement already in the anchor frame changes nothing');
  }

} finally {
  rmSync(out, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
