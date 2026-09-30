#!/usr/bin/env node
// CME particle physics: every particle simulated, and still part of its CME.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'cmep-'));
let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};
const deg = (d) => d * Math.PI / 180;

try {
  execFileSync('npx', ['esbuild', join(root, 'utils/cmeParticleSim.ts'),
    '--bundle', '--format=esm', `--outfile=${join(out, 's.mjs')}`, '--log-level=error'],
    { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
  const { CmeParticleSim, PUSH_LIMIT, QUEUE_GAP } = await import(pathToFileURL(join(out, 's.mjs')).href);

  const H = 3600000, T0 = Date.UTC(2026, 8, 20);
  const SUN = 0.1;
  // A cone of particles along local +Y: y in [0.6, 1], radius up to y·tan(half).
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Units per hour for a speed in km/s, 1 AU = 3 units.
  const uph = (kms) => kms * 3600 / 1.496e8 * 3;
  const cme = (id, azDeg, speed, halfDeg, startH, n = 1500) => {
    const local = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const y = 0.6 + 0.4 * rnd(), rr = Math.sqrt(rnd()) * y * Math.tan(deg(halfDeg)), ph = rnd() * Math.PI * 2;
      local[i * 3] = rr * Math.cos(ph); local[i * 3 + 1] = y; local[i * 3 + 2] = rr * Math.sin(ph);
    }
    const az = deg(azDeg);
    const dir = [Math.sin(az), 0, Math.cos(az)];
    // Local +Y → dir; local X → the horizontal perpendicular; local Z → up.
    const ex = [Math.cos(az), 0, -Math.sin(az)], ez = [0, 1, 0];
    const startMs = T0 + startH * H;
    return {
      id, startMs, speed, halfAngle: deg(halfDeg), dir, local, bodyCount: n,
      nominalAt: (ms) => {
        if (ms < startMs) return null;
        const d = SUN + uph(speed) * (ms - startMs) / H;   // front distance
        // world = d · (x·ex + y·dir + z·ez): the cone scales with distance.
        const m = [ex[0] * d, dir[0] * d, ez[0] * d, ex[1] * d, dir[1] * d, ez[1] * d, ex[2] * d, dir[2] * d, ez[2] * d];
        return { body: { m, c: [0, 0, 0] }, tail: null };
      },
    };
  };
  const opts = { stepMs: H / 2, contactSize: 0.04, sunRadius: SUN };
  const pts = (sim, id, t) => { const c = sim.cmes.find((x) => x.input.id === id); const o = new Float32Array(c.pos.length); sim.positionsAt(id, t, o); return o; };
  const nominalPts = (c, t) => { const a = c.nominalAt(t).body; const o = new Float32Array(c.local.length);
    for (let i = 0; i < c.local.length; i += 3) for (let k = 0; k < 3; k++) o[i + k] = a.m[k * 3] * c.local[i] + a.m[k * 3 + 1] * c.local[i + 1] + a.m[k * 3 + 2] * c.local[i + 2] + a.c[k]; return o; };
  const maxDiff = (p, q) => { let m = 0; for (let i = 0; i < p.length; i++) m = Math.max(m, Math.abs(p[i] - q[i])); return m; };
  const azOf = (p, i) => Math.atan2(p[i * 3], p[i * 3 + 2]);
  const meanR = (p) => { let s = 0; for (let i = 0; i < p.length; i += 3) s += Math.hypot(p[i], p[i + 1], p[i + 2]); return s / (p.length / 3); };

  console.log('\nLeft alone, a CME is exactly as it has always been drawn');
  {
    const a = cme('A', 0, 600, 30, 0);
    const sim = new CmeParticleSim([a], opts);
    sim.advanceTo(T0 + 40 * H);
    { const dd = maxDiff(pts(sim, 'A', T0 + 40 * H), nominalPts(a, T0 + 40 * H)); check(dd < 1e-4, 'no drift after 40 h of free flight', String(dd)); }
    const between = T0 + 40 * H + 10 * 60000;
    check(maxDiff(pts(sim, 'A', between), nominalPts(a, between)) < 1e-4, 'and between steps too');
  }

  console.log('\nTwo side by side push each other apart');
  {
    // Launched together at one speed, 40° apart; A is twice as wide (35° vs
    // 25° half-widths, 20° of overlap), so it is the stronger.
    const a = cme('A', -20, 800, 35, 0), b = cme('B', 20, 800, 25, 0);
    const sim = new CmeParticleSim([a, b], opts);
    const t = T0 + 30 * H;
    sim.advanceTo(t);
    const pa = pts(sim, 'A', t), pb = pts(sim, 'B', t);
    const na = nominalPts(a, t), nb = nominalPts(b, t);
    // How far each flank reaches into the other's side (towards the middle, az 0).
    const reach = (p, sign) => { let m = -Infinity; for (let i = 0; i < p.length / 3; i++) m = Math.max(m, sign * azOf(p, i)); return m; };
    const aGive = reach(na, 1) - reach(pa, 1);   // A's west flank pulled back
    const bGive = reach(nb, -1) - reach(pb, -1); // B's east flank pulled back
    check(aGive > deg(1) && bGive > deg(1), `both give ground (A ${(aGive * 180 / Math.PI).toFixed(1)}°, B ${(bGive * 180 / Math.PI).toFixed(1)}°)`);
    check(bGive > aGive, 'the weaker gives more');
    const tA = sim.touchingOf('A'), tB = sim.touchingOf('B');
    check(tA.get('B') === 'west' && tB.get('A') === 'east', `each knows who presses which flank (${tA.get('B')}, ${tB.get('A')})`);
    const glowB = sim.glowOf('B'); let lit = 0; for (const g of glowB) if (g > 0.3) lit++;
    check(lit > 0 && lit < glowB.length * 0.6, `the pressed particles glow, not the whole CME (${lit}/${glowB.length})`);
    // Its middle, not its mean: the pressed flank is meant to move.
    const azs = []; for (let i = 0; i < pa.length / 3; i++) azs.push(azOf(pa, i)); azs.sort((x, y) => x - y);
    const dirDrift = Math.abs(azs[Math.floor(azs.length / 2)] - deg(-20));
    check(dirDrift < deg(6), `the CME keeps its direction (${(dirDrift * 180 / Math.PI).toFixed(1)}° off)`);
  }

  console.log('\nOne catching another compresses both, and slows the chaser');
  {
    // At 27 h the fast one's front is into the slow one's back, but its
    // centre is still behind: mid-collision.
    const lead = cme('L', 0, 400, 25, 0), chase = cme('C', 1, 1300, 25, 20);
    const sim = new CmeParticleSim([lead, chase], opts);
    const t = T0 + 27 * H;
    sim.advanceTo(t);
    const pc = pts(sim, 'C', t), pl = pts(sim, 'L', t);
    check(meanR(pc) < meanR(nominalPts(chase, t)) * 0.995, `the chaser is held back (${meanR(pc).toFixed(3)} vs ${meanR(nominalPts(chase, t)).toFixed(3)})`);
    const nl = nominalPts(lead, t);
    let over = 0;
    for (let i = 0; i < pl.length; i += 3) {
      const r = Math.hypot(pl[i], pl[i + 1], pl[i + 2]), rn = Math.hypot(nl[i], nl[i + 1], nl[i + 2]);
      if (r > rn * (1 + PUSH_LIMIT) + 1e-4) over++;
    }
    check(over === 0, 'the leader is never shoved more than 7.5% past its own path');
    check(sim.touchingOf('C').get('L') === 'front' && sim.touchingOf('L').get('C') === 'behind',
      `the chaser's front is pressed, the leader from behind (${sim.touchingOf('C').get('L')}, ${sim.touchingOf('L').get('C')})`);
  }

  console.log('\nThe CME in front is never slowed; the one behind never gets into it');
  {
    // Same direction and width; each has a thick front (y 0.8-1) and a thin
    // tail behind it (y 0.3-0.8).
    const withTail = (id, speed, startH, nb = 1200, nt = 800) => {
      const c = cme(id, 0, speed, 25, startH, nb + nt);
      for (let i = 0; i < nb + nt; i++) {
        const body = i < nb;
        const y = body ? 0.8 + 0.2 * rnd() : 0.3 + 0.5 * rnd();
        const rr = Math.sqrt(rnd()) * y * Math.tan(deg(25)) * (body ? 1 : 0.6), ph = rnd() * Math.PI * 2;
        c.local[i * 3] = rr * Math.cos(ph); c.local[i * 3 + 1] = y; c.local[i * 3 + 2] = rr * Math.sin(ph);
      }
      const bodyOnly = c.nominalAt;
      c.bodyCount = nb;
      c.nominalAt = (ms) => { const n = bodyOnly(ms); return n && { body: n.body, tail: n.body }; };
      return c;
    };
    // Where a CME's front would be on its own path: which one is in front.
    const pathFront = (c, t) => { const n = c.nominalAt(t); return n ? n.body.m[5] * 1 : -Infinity; };
    // Particles of `chase` inside or past `lead`'s thick front: level with
    // (within 0.03 across) a front particle of it, and ahead of it.
    const intoFront = (lead, chase) => {
      let n = 0;
      for (let j = 0; j < chase.length / 3; j++) {
        const x = chase[j * 3], y = chase[j * 3 + 1], z = chase[j * 3 + 2];
        for (let i = 0; i < 1200; i++) {
          if (Math.abs(lead[i * 3] - x) < 0.03 && Math.abs(lead[i * 3 + 1] - y) < 0.03 && z > lead[i * 3 + 2]) { n++; break; }
        }
      }
      return n;
    };
    // Front particles more than 1% of the way behind their own path.
    const behindPath = (c, p, t) => {
      const nom = nominalPts(c, t); let n = 0;
      for (let i = 0; i < 1200; i++) if (p[i * 3 + 2] < nom[i * 3 + 2] * 0.99) n++;
      return n;
    };

    // A slow one, then a fast one that catches it up and goes past on its
    // own path at 21.6 h; then a third, faster still.
    const a = withTail('A', 400, 0), b = withTail('B', 900, 12), c = withTail('C', 1500, 22);
    const all = [a, b, c];
    const sim = new CmeParticleSim(all, opts);
    let frontSlowed = 0, into = 0, heldSeen = false, passed = false, recoveredLate = 0, overtakenBack = 0;
    let front = null, frontSince = -Infinity;
    for (let h = 14; h <= 40; h += 0.5) {
      const t = T0 + h * H;
      sim.advanceTo(t);
      const live = all.filter((x) => pathFront(x, t) > 0);
      const order = live.slice().sort((x, y) => pathFront(y, t) - pathFront(x, t));
      const p = new Map(order.map((x) => [x, pts(sim, x.id, t)]));
      if (order[0] !== front) { front = order[0]; frontSince = h; }
      // The one furthest out on its own path is never slowed by those
      // behind: once it has made up what it lost while it was catching up
      // (it takes over held behind, and recovers in a couple of hours).
      const lagging = behindPath(front, p.get(front), t);
      if (h - frontSince >= 4) frontSlowed += lagging;
      if (h - frontSince >= 4 && lagging) recoveredLate++;
      // No one ever inside the thick front of one further out (away from the
      // moment two paths draw level, when which is in front is a toss-up).
      if (Math.round(h * 2) % 4 === 0) for (let i = 1; i < order.length; i++) {
        if (pathFront(order[i - 1], t) - pathFront(order[i], t) < 0.02 * pathFront(order[i - 1], t)) continue;
        into += intoFront(p.get(order[i - 1]), p.get(order[i]));
      }
      if (h > 18 && h < 21.5 && behindPath(b, p.get(b), t) > 100) heldSeen = true;
      if (h > 23 && order[0] !== a && behindPath(b, p.get(b), t) === 0 || order[0] === c) passed = passed || h > 23;
      if (h === 23) overtakenBack = behindPath(a, p.get(a), t);
    }
    check(heldSeen, 'a fast CME catching a slow one is held behind it while the slow one is still ahead');
    check(passed, 'once its own path is ahead, it is the front CME: carried on, not held');
    check(frontSlowed === 0, `the CME in front is never slowed by those behind, back on its own path within 4 h of taking the lead (${frontSlowed} front particles behind it, ${recoveredLate} samples)`);
    check(into === 0, `no CME ever inside the thick front of one further out (${into} particles)`);
    check(overtakenBack > 600, `the slow one it passed drops back behind it (${overtakenBack} front particles behind their path)`);
    const t = T0 + 40 * H;
    check(behindPath(a, pts(sim, 'A', t), t) === 0, 'and, left behind and clear, is back on its own path');

  }

  console.log('\nA gap between them, and the tail pressed ahead');
  {
    const withTail = (id, speed, startH, nb = 1200, nt = 800) => {
      const c = cme(id, 0, speed, 25, startH, nb + nt);
      for (let i = 0; i < nb + nt; i++) {
        const body = i < nb;
        const y = body ? 0.8 + 0.2 * rnd() : 0.3 + 0.5 * rnd();
        const rr = Math.sqrt(rnd()) * y * Math.tan(deg(25)) * (body ? 1 : 0.6), ph = rnd() * Math.PI * 2;
        c.local[i * 3] = rr * Math.cos(ph); c.local[i * 3 + 1] = y; c.local[i * 3 + 2] = rr * Math.sin(ph);
      }
      const bodyOnly = c.nominalAt;
      c.bodyCount = nb;
      c.nominalAt = (ms) => { const n = bodyOnly(ms); return n && { body: n.body, tail: n.body }; };
      return c;
    };
    // Two launched together, the second slower: it stays behind the first
    // on its own path, overlapping its tail and front, all the way.
    const a = withTail('A', 500, 0), b = withTail('B', 450, 0.5);
    const sim = new CmeParticleSim([a, b], opts);
    let gapShort = Infinity, tailRunOver = 0;
    const nearAxis = (p, i) => Math.abs(p[i * 3]) < 0.02 && Math.abs(p[i * 3 + 1]) < 0.02;
    for (let h = 10; h <= 50; h += 2) {
      const t = T0 + h * H;
      sim.advanceTo(t);
      const pa = pts(sim, 'A', t), pb = pts(sim, 'B', t);
      let lb = Infinity, mid = -Infinity;
      for (let i = 0; i < 1200; i++) if (nearAxis(pa, i)) lb = Math.min(lb, pa[i * 3 + 2]);
      for (let i = 0; i < pb.length / 3; i++) if (nearAxis(pb, i)) mid = Math.max(mid, pb[i * 3 + 2]);
      gapShort = Math.min(gapShort, lb - mid);
      for (let i = 1200; i < pa.length / 3; i++) if (nearAxis(pa, i) && pa[i * 3 + 2] < mid - 1e-3) tailRunOver++;
    }
    check(gapShort > 0.03, `down the middle, a gap between them (at least ${gapShort.toFixed(3)})`);
    check(tailRunOver === 0, `the front one's tail is pressed ahead of the one behind, not run over (${tailRunOver})`);
    const t = T0 + 50 * H;
    check(meanR(pts(sim, 'B', t)) < meanR(nominalPts(b, t)), 'the one behind is held back to keep the gap');
  }

  console.log('\nStream edges are walls');
  {
    // A stream straddling az 25°-45° at all distances.
    const bins = 40, r = [], az = [], offLo = [], offHi = [], yLo = [], yHi = [];
    for (let i = 0; i < bins; i++) { r.push(0.1 + 5 * i / (bins - 1)); az.push(deg(35)); offLo.push(-deg(10)); offHi.push(deg(10)); yLo.push(-10); yHi.push(10); }
    const stream = { id: 'CH9', r, az, offLo, offHi, yLo, yHi };
    const a = cme('A', 0, 700, 40, 0);
    const sim = new CmeParticleSim([a], { ...opts, wallsAt: () => ({ streams: [stream], groupAngle: 0 }) });
    const t = T0 + 30 * H;
    sim.advanceTo(t);
    const p = pts(sim, 'A', t);
    let inStream = 0, beyond = 0, maxAz = -Infinity;
    for (let i = 0; i < p.length / 3; i++) { const z = azOf(p, i); if (z > deg(25.5) && z < deg(44.5)) inStream++; if (z > deg(45)) beyond++; maxAz = Math.max(maxAz, z); }
    check(inStream === 0 && beyond === 0, `no particle inside or past the stream (${inStream}, ${beyond})`);
    check(maxAz > deg(24), `the flank is pressed right up to the edge (${(maxAz * 180 / Math.PI).toFixed(1)}°)`);
    let eastMin = Infinity; for (let i = 0; i < p.length / 3; i++) eastMin = Math.min(eastMin, azOf(p, i));
    check(eastMin < -deg(35), `the other flank spreads freely (${(eastMin * 180 / Math.PI).toFixed(1)}°)`);
    check(sim.touchingOf('A').get('CH9') === 'west', 'and knows which flank is held');

    // Launched inside the stream: stays inside.
    const b = cme('B', 35, 700, 30, 0);
    const simB = new CmeParticleSim([b], { ...opts, wallsAt: () => ({ streams: [stream], groupAngle: 0 }) });
    simB.advanceTo(t);
    const q = pts(simB, 'B', t);
    let out2 = 0; for (let i = 0; i < q.length / 3; i++) { const z = azOf(q, i); if (z < deg(24.5) || z > deg(45.5)) out2++; }
    check(out2 === 0, `a CME launched inside a stream stays inside it (${out2} out)`);
  }

  console.log('\nThe same moment always looks the same');
  {
    const mk = () => [cme('A', -20, 1200, 30, 0), cme('B', 20, 500, 30, 0)];
    seed = 99; const s1 = new CmeParticleSim(mk(), opts);
    s1.advanceTo(T0 + 50 * H); s1.advanceTo(T0 + 20 * H);
    seed = 99; const s2 = new CmeParticleSim(mk(), opts);
    s2.advanceTo(T0 + 20 * H);
    check(maxDiff(pts(s1, 'B', T0 + 20 * H), pts(s2, 'B', T0 + 20 * H)) < 1e-6, 'scrubbing back gives the same state as playing to it');
  }

  console.log('\nFast enough');
  {
    const list = []; for (let k = 0; k < 8; k++) list.push(cme(`K${k}`, -60 + k * 15, 400 + k * 100, 30, k * 8, 4000));
    const sim = new CmeParticleSim(list, opts);
    const t0 = performance.now(); sim.advanceTo(T0 + 7 * 24 * H); const ms = performance.now() - t0;
    check(ms < 8000, `a week of 8 CMEs × 4000 particles in ${ms.toFixed(0)} ms`);
  }
} catch (err) {
  fail++;
  console.error(err);
} finally {
  rmSync(out, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
