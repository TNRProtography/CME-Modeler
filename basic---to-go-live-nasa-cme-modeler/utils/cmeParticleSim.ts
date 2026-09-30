// CME particle physics (experimental interactions).
//
// Every particle of every CME is simulated. A particle is still a part of its
// CME - it is born where the CME's shape puts it and it is always drawn back
// towards that shape - but what happens to it is its own:
//
//   - FREE FLIGHT. Each particle follows its own nominal path: where the
//     CME's shape, expanding and slowing as the propagation model says, would
//     carry that one particle. Left alone, the particles reproduce the CME
//     exactly as it has always been drawn: the nose fastest, the flanks and
//     the trailing body slower.
//   - STREAM WALLS. A particle cannot cross into a high-speed stream its CME
//     is outside of, and cannot leave one its CME was launched inside. At a
//     wall it stops going sideways and slides along it, so a flank piles up
//     against the stream edge.
//   - OTHER CMEs. Side by side, where particles of two CMEs come to share
//     space they push each other apart, along the line between the two
//     CMEs' fronts, and the stronger CME (faster, wider) gives less ground.
//     One behind the other (heading within 30 degrees of each other), the
//     front CME is whichever one's own path is further out at the moment, and
//     it is never slowed by the one behind: its thick front stays on its
//     path, and only its tail and the depth behind its front are pressed
//     forward, compressing as far as they have to. The one behind can never
//     get into the front CME's thick front: seen from behind, each part of it
//     is held a little way (QUEUE_GAP, so the two stay two CMEs) behind the
//     part of the front CME ahead of it, and it falls behind its own path,
//     which is it slowing down. A fast CME catching a slow one is held
//     behind it until its own path goes past; from then on it is the front
//     CME, back on its path within a couple of hours, and the slow one it
//     passed is held behind it instead. A queue of any length settles from
//     the front back.
//   - STAYING A CME. Each step every particle is drawn part of the way back
//     to its place in the CME's shape, shifted by however far the CME's thick
//     front as a whole has been held back along its path. A pushed particle
//     holds its position while it is being pushed, and the CME closes up
//     again once it is free - it never scatters. A CME keeps the ground it
//     has lost only while it is held, and ground it has gained only while it
//     is pressed on; free of both, it settles back onto its own path within a
//     couple of hours (LAG_RECOVERY). The lag is only ever along its own
//     direction: it slows down, it does not drift sideways.
//
// Particles glow where they are being pushed: compression made visible.
//
// The clock moves in fixed steps from the first launch. State is kept at
// checkpoints, so scrubbing backwards restores the nearest earlier one and
// steps forward from there, and the same moment always looks the same.
//
// World units are scene units; azimuth is atan2(x, z), increasing west.

import { streamSectorAt, wrapAngle, type HssStreamSamples } from './hssBarrier';

/** An affine map: world = m · local + c, m row-major 3×3. */
export interface Affine {
  m: number[];   // 9
  c: number[];   // 3
}

export interface SimCmeInput {
  id: string;
  startMs: number;
  /** Measured speed, km/s, and half-width, radians: its strength. */
  speed: number;
  halfAngle: number;
  /** The CME's direction, unit vector. */
  dir: [number, number, number];
  /** Particle coordinates in the CME's own frame: body first, then tail. */
  local: Float32Array;
  bodyCount: number;
  /**
   * How many of the first particles are the thick front, which holds its
   * ground against another CME; the rest (the body's depth, the tail) are
   * pressed aside and compress. Defaults to the whole body.
   */
  frontCount?: number;
  /**
   * Where the CME's shape puts its body and tail at a moment, or null for a
   * part not drawn then (the tail is hidden while the CME is young).
   */
  nominalAt: (ms: number) => { body: Affine; tail: Affine | null } | null;
}

/** A stream wall set at one moment. */
export interface WallSet {
  streams: HssStreamSamples[];
  /** The rotation that carries the streams' frame into the world then. */
  groupAngle: number;
}

export interface SimOptions {
  stepMs: number;
  /** Particles closer than this, from different CMEs, are in contact. */
  contactSize: number;
  sunRadius: number;
  /** Walls in force at a moment, or null for none. */
  wallsAt?: (ms: number) => WallSet | null;
}

/** At most this fraction further out than its own path can a CME be shoved. */
export const PUSH_LIMIT = 0.075;
/**
 * The gap a chaser is held behind the leader's front at, as a fraction of the
 * leader's distance from the Sun (0.04 AU at 1 AU): enough to see two CMEs,
 * not one merged blob. Never less than the contact size.
 */
export const QUEUE_GAP = 0.04;
/** How much of the way back to its place in the CME a particle goes per step. */
const COHESION = 0.12;
/** How fast the glow of being pushed fades, per step. */
const GLOW_DECAY = 0.8;
/** A checkpoint every 6 hours of steps: a scrub back replays at most that. */
const CHECKPOINT_EVERY = 12;
/** Cohesion for a CME nothing is holding back. */
const FREE_COHESION = 0.35;
/** How much of its lag a CME nothing is holding makes up per step. */
const LAG_RECOVERY = 0.5;

interface CmeState {
  input: SimCmeInput;
  /** Particles of the thick front: the first this many. */
  front: number;
  strength: number;
  pos: Float32Array;       // world positions, 3 per particle
  glow: Float32Array;
  active: boolean;
  /** What is holding it, for the note. */
  touching: Map<string, string>;
  /** Held behind another CME last step (so it keeps its lag). */
  held: boolean;
  /** Pressed on from behind last step (so it keeps its lead). */
  pressed: boolean;
}

interface Checkpoint {
  atMs: number;
  pos: Map<string, Float32Array>;
  glow: Map<string, Float32Array>;
  active: Map<string, boolean>;
  held: Map<string, boolean>;
  pressed: Map<string, boolean>;
}

const apply = (a: Affine, x: number, y: number, z: number, out: number[] | Float32Array, o: number) => {
  const m = a.m;
  out[o] = m[0] * x + m[1] * y + m[2] * z + a.c[0];
  out[o + 1] = m[3] * x + m[4] * y + m[5] * z + a.c[1];
  out[o + 2] = m[6] * x + m[7] * y + m[8] * z + a.c[2];
};

export class CmeParticleSim {
  readonly options: SimOptions;
  private cmes: CmeState[];
  private clockMs: number;
  private readonly originMs: number;
  private checkpoints: Checkpoint[] = [];
  private stepCount = 0;
  /** One CME behind another this step: n is the leader's direction. */
  private queues: { lead: CmeState; chase: CmeState; n: [number, number, number] }[] = [];
  /** Where each CME's front would be on its own path this step. */
  private pathFronts = new Map<CmeState, number>();

  constructor(inputs: SimCmeInput[], options: SimOptions) {
    this.options = options;
    this.cmes = inputs.map((input) => ({
      input,
      front: Math.max(0, Math.min(input.bodyCount, input.frontCount ?? input.bodyCount)),
      strength: Math.max(1, input.speed) * Math.max(0.03, input.halfAngle),
      pos: new Float32Array(input.local.length),
      glow: new Float32Array(input.local.length / 3),
      active: false,
      touching: new Map(),
      held: false,
      pressed: false,
    }));
    const first = inputs.length ? Math.min(...inputs.map((c) => c.startMs)) : 0;
    this.originMs = Math.floor(first / options.stepMs) * options.stepMs;
    this.clockMs = this.originMs;
    this.saveCheckpoint();
  }

  /** The moment the state stands at. */
  get timeMs(): number { return this.clockMs; }

  /** Where the clock started: the first launch. */
  get startMs(): number { return this.originMs; }

  /**
   * Runs the clock to `targetMs`, or as far as `budgetMs` of work allows.
   * Returns true once it has arrived. Going backwards restores a checkpoint.
   */
  advanceTo(targetMs: number, budgetMs = Infinity): boolean {
    const target = Math.max(this.originMs, targetMs);
    if (target < this.clockMs) this.restoreBefore(target);
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    while (this.clockMs + this.options.stepMs <= target) {
      this.step();
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - started > budgetMs) return false;
    }
    return true;
  }

  /**
   * World positions for one CME at `atMs`, which may lie a little past the
   * state's clock: the gap is covered by each particle's own free flight.
   * Particles of a part not drawn at that moment are left untouched.
   */
  positionsAt(id: string, atMs: number, out: Float32Array): boolean {
    const c = this.cmes.find((x) => x.input.id === id);
    if (!c || !c.active) return false;
    const now = c.input.nominalAt(atMs);
    const then = c.input.nominalAt(this.clockMs);
    if (!now || !then) return false;
    const { local, bodyCount } = c.input;
    const a: number[] = [0, 0, 0], b: number[] = [0, 0, 0];
    const n = local.length / 3;
    for (let i = 0; i < n; i++) {
      const aNow = i < bodyCount ? now.body : now.tail;
      const aThen = i < bodyCount ? then.body : then.tail;
      const o = i * 3;
      if (!aNow || !aThen) {
        out[o] = c.pos[o]; out[o + 1] = c.pos[o + 1]; out[o + 2] = c.pos[o + 2];
        continue;
      }
      apply(aNow, local[o], local[o + 1], local[o + 2], a, 0);
      apply(aThen, local[o], local[o + 1], local[o + 2], b, 0);
      out[o] = c.pos[o] + a[0] - b[0];
      out[o + 1] = c.pos[o + 1] + a[1] - b[1];
      out[o + 2] = c.pos[o + 2] + a[2] - b[2];
    }
    return true;
  }

  glowOf(id: string): Float32Array | null {
    return this.cmes.find((x) => x.input.id === id)?.glow ?? null;
  }

  /** What is holding this CME, as "who → how", for the on-screen note. */
  touchingOf(id: string): Map<string, string> {
    return this.cmes.find((x) => x.input.id === id)?.touching ?? new Map();
  }

  // ── The step ─────────────────────────────────────────────────────────────

  private step(): void {
    const t0 = this.clockMs;
    const t1 = t0 + this.options.stepMs;
    const a: number[] = [0, 0, 0], b: number[] = [0, 0, 0];

    // Nominal places at t1, kept for the constraints below.
    const nominal = new Map<CmeState, Float32Array>();

    for (const c of this.cmes) {
      c.touching.clear();
      const n1 = c.input.nominalAt(t1);
      if (!n1 || t1 < c.input.startMs) { c.active = false; continue; }
      const n0 = c.input.nominalAt(t0);
      const { local, bodyCount } = c.input;
      const count = local.length / 3;
      const nom = new Float32Array(local.length);
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        const part1 = i < bodyCount ? n1.body : n1.tail;
        // A tail not drawn yet grows out of the body's back: use the body map.
        apply(part1 ?? n1.body, local[o], local[o + 1], local[o + 2], nom, o);
      }
      nominal.set(c, nom);

      if (!c.active || !n0 || t0 < c.input.startMs) {
        // Born this step: exactly where its shape says.
        c.pos.set(nom);
        c.glow.fill(0);
        c.active = true;
        continue;
      }

      // Free flight: every particle moves as its own path moves.
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        const p0 = (i < bodyCount ? n0.body : n0.tail) ?? n0.body;
        const p1 = (i < bodyCount ? n1.body : n1.tail) ?? n1.body;
        apply(p1, local[o], local[o + 1], local[o + 2], a, 0);
        apply(p0, local[o], local[o + 1], local[o + 2], b, 0);
        c.pos[o] += a[0] - b[0];
        c.pos[o + 1] += a[1] - b[1];
        c.pos[o + 2] += a[2] - b[2];
      }

      // Staying a CME: back toward the shape, carried along by however far
      // the CME as a whole has fallen behind along its own direction. That is
      // measured on its thick front alone: a tail pressed forward from behind
      // is compressed, it does not carry the CME forward.
      const [dx, dy, dz] = c.input.dir;
      let lag = 0;
      const lagOver = Math.max(1, c.front);
      for (let i = 0; i < lagOver; i++) {
        const o = i * 3;
        lag += (c.pos[o] - nom[o]) * dx + (c.pos[o + 1] - nom[o + 1]) * dy + (c.pos[o + 2] - nom[o + 2]) * dz;
      }
      lag /= lagOver;
      // Nothing held it back or pressed on it last step: it settles back
      // onto its own path, quickly. A CME held behind another keeps its lag
      // only while it is held, and one shoved forward keeps its lead only
      // while it is pressed; once clear (or once its own path takes it past
      // the other), it is back on its path within a couple of hours.
      const free = !c.held;
      if ((lag < 0 && !c.held) || (lag > 0 && !c.pressed)) {
        const settle = -lag * LAG_RECOVERY;
        for (let o = 0; o < c.pos.length; o += 3) {
          c.pos[o] += dx * settle; c.pos[o + 1] += dy * settle; c.pos[o + 2] += dz * settle;
        }
        lag += settle;
      }
      c.held = false;
      c.pressed = false;
      // Not held back by another CME, it takes its own shape back faster.
      const k = free ? FREE_COHESION : COHESION;
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        c.pos[o] += k * (nom[o] + lag * dx - c.pos[o]);
        c.pos[o + 1] += k * (nom[o + 1] + lag * dy - c.pos[o + 1]);
        c.pos[o + 2] += k * (nom[o + 2] + lag * dz - c.pos[o + 2]);
      }
      for (let i = 0; i < c.glow.length; i++) c.glow[i] *= GLOW_DECAY;
    }

    const walls = this.options.wallsAt?.(t1) ?? null;
    if (walls && walls.streams.length) this.applyWalls(walls);
    this.applyContacts(nominal);
    this.applyLimits(nominal);
    this.applyNoOvertaking();

    this.clockMs = t1;
    this.stepCount++;
    if (this.stepCount % CHECKPOINT_EVERY === 0) this.saveCheckpoint();
  }

  /** Stream edges are walls. */
  private applyWalls(walls: WallSet): void {
    for (const c of this.cmes) {
      if (!c.active) continue;
      const [dx, , dz] = c.input.dir;
      const cmeAz = Math.atan2(dx, dz);
      const count = c.pos.length / 3;
      for (const st of walls.streams) {
        const rMin = st.r[0], rMax = st.r[st.r.length - 1];
        if (!(rMax > rMin)) continue;
        // Which side of this stream the CME is on - decided once, at the
        // CME's own distance, so every particle of it agrees.
        let cr = 0;
        for (let i = 0; i < count; i += 16) {
          const o = i * 3;
          cr += Math.hypot(c.pos[o], c.pos[o + 1], c.pos[o + 2]);
        }
        cr /= Math.ceil(count / 16);
        const home = streamSectorAt(st, Math.min(rMax, Math.max(rMin, cr)), walls.groupAngle);
        if (!home) continue;
        const homeOff = wrapAngle(cmeAz - home.az);
        const inside = homeOff >= home.lo && homeOff <= home.hi;

        let held = 0, heldSide = 0;
        for (let i = 0; i < count; i++) {
          const o = i * 3;
          const x = c.pos[o], y = c.pos[o + 1], z = c.pos[o + 2];
          const r = Math.hypot(x, y, z);
          if (r < rMin || r > rMax) continue;
          const sec = streamSectorAt(st, r, walls.groupAngle);
          if (!sec) continue;
          const lat = Math.asin(Math.max(-1, Math.min(1, y / r)));
          if (lat < sec.latLo || lat > sec.latHi) continue;
          const az = Math.atan2(x, z);
          const off = wrapAngle(az - sec.az);
          const inStream = off >= sec.lo && off <= sec.hi;
          let target: number | null = null;
          if (!inside && inStream) {
            // Back out through the edge on the CME's side.
            target = homeOff < sec.lo ? sec.lo : sec.hi;
          } else if (inside && !inStream) {
            target = off < sec.lo ? sec.lo : sec.hi;
          }
          if (target == null) continue;
          const delta = target - off;
          const cs = Math.cos(delta), sn = Math.sin(delta);
          c.pos[o] = x * cs + z * sn;
          c.pos[o + 2] = z * cs - x * sn;
          c.glow[i] = Math.min(1, c.glow[i] + 0.6);
          held++;
          heldSide += Math.sign(wrapAngle(sec.az - cmeAz)) || 1;
        }
        if (held > count * 0.01) {
          c.touching.set(st.id, inside ? 'inside' : heldSide > 0 ? 'west' : 'east');
        }
      }
    }
  }

  /**
   * Two CMEs that overlap meet at one boundary between them.
   *
   * The boundary is a plane across the line joining their centres - side by
   * side it stands between their flanks, one catching the other it lies
   * across their path. Where it sits is shared by strength: of the depth by
   * which they overlap, each gives ground in proportion to the OTHER's
   * strength. Every particle of either that has crossed it, near the other
   * CME, is set back onto it and glows - the flattened, compressed contact
   * face. Particles away from the other CME are left alone.
   *
   * The line, and how far each reaches, are the thick fronts': the depth
   * behind a front and the tail do not hold their ground, they are simply
   * pressed back onto the boundary.
   */
  private applyContacts(nominal: Map<CmeState, Float32Array>): void {
    this.queues = [];
    const active = this.cmes.filter((c) => c.active);
    if (active.length < 2) return;
    const margin = this.options.contactSize;

    // How far out each CME's front would be on its own path now: which of
    // two is ahead, whatever order they launched in.
    const pathFront = this.pathFronts;
    pathFront.clear();
    for (const c of active) {
      const nom = nominal.get(c);
      const [dx, dy, dz] = c.input.dir;
      let f = -Infinity;
      if (nom) for (let o = 0; o < c.front * 3; o += 3) f = Math.max(f, nom[o] * dx + nom[o + 1] * dy + nom[o + 2] * dz);
      pathFront.set(c, f);
    }

    const box = new Map<CmeState, number[]>();
    const centre = new Map<CmeState, number[]>();
    for (const c of active) {
      const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      const s = [0, 0, 0];
      const bodyEnd = c.front * 3;
      for (let o = 0; o < c.pos.length; o += 3) {
        for (let k = 0; k < 3; k++) {
          const v = c.pos[o + k];
          if (v < bb[k]) bb[k] = v;
          if (v > bb[k + 3]) bb[k + 3] = v;
          if (o < bodyEnd) s[k] += v;
        }
      }
      const n = Math.max(1, c.front);
      box.set(c, bb);
      centre.set(c, [s[0] / n, s[1] / n, s[2] / n]);
    }
    const inside = (bb: number[], x: number, y: number, z: number) =>
      x >= bb[0] - margin && x <= bb[3] + margin && y >= bb[1] - margin && y <= bb[4] + margin
      && z >= bb[2] - margin && z <= bb[5] + margin;

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        let A = active[i], B = active[j];
        if (box.get(A)![0] > box.get(B)![3] + margin || box.get(B)![0] > box.get(A)![3] + margin
          || box.get(A)![1] > box.get(B)![4] + margin || box.get(B)![1] > box.get(A)![4] + margin
          || box.get(A)![2] > box.get(B)![5] + margin || box.get(B)![2] > box.get(A)![5] + margin) continue;

        // Heading the same way (within 30 degrees; further apart they meet
        // flank to flank): the leader is the one whose own path is further
        // out now, and its front is a wall the other cannot pass (checked
        // once the step is done). Decided by where each would be on its own,
        // not by where the physics has put them, so a CME held back never
        // becomes the leader and slips through; and not by launch, so a fast
        // CME that has caught up and gone past a slow one is the front CME
        // from then on, never slowed by the one it passed, which is held
        // behind it instead.
        const dA = A.input.dir, dB = B.input.dir;
        const queued = dA[0] * dB[0] + dA[1] * dB[1] + dA[2] * dB[2] > Math.cos(Math.PI / 6);
        if (queued) {
          const fa = pathFront.get(A)!, fb = pathFront.get(B)!;
          if (fb > fa || (fb === fa && B.input.startMs < A.input.startMs)) [A, B] = [B, A];
        }
        const ba = box.get(A)!, bb = box.get(B)!;

        // A lies on the + side of n, B on the - side.
        let nx: number, ny: number, nz: number;
        if (queued) {
          // Settled after the step, following the leader's shape; one flat
          // boundary would hold a chaser at the tips of a croissant's legs.
          this.queues.push({ lead: A, chase: B, n: [...A.input.dir] as [number, number, number] });
          continue;
        } else {
          const ca = centre.get(A)!, cb = centre.get(B)!;
          nx = ca[0] - cb[0]; ny = ca[1] - cb[1]; nz = ca[2] - cb[2];
          const len = Math.hypot(nx, ny, nz);
          if (len < 1e-9) {
            // Centres together: split along A's own direction.
            [nx, ny, nz] = A.input.dir;
          } else { nx /= len; ny /= len; nz /= len; }
        }

        // How far each reaches into the other's side, among the particles
        // that are near the other at all.
        let aMin = Infinity, bMax = -Infinity;
        for (let o = 0; o < A.front * 3; o += 3) {
          if (!inside(bb, A.pos[o], A.pos[o + 1], A.pos[o + 2])) continue;
          const p = A.pos[o] * nx + A.pos[o + 1] * ny + A.pos[o + 2] * nz;
          if (p < aMin) aMin = p;
        }
        for (let o = 0; o < B.front * 3; o += 3) {
          if (!inside(ba, B.pos[o], B.pos[o + 1], B.pos[o + 2])) continue;
          const p = B.pos[o] * nx + B.pos[o + 1] * ny + B.pos[o + 2] * nz;
          if (p > bMax) bMax = p;
        }
        const depth = bMax - aMin;
        if (!(depth > 0) || !Number.isFinite(depth)) continue;

        // A gives the share of the overlap that B's strength claims.
        const giveA = B.strength / (A.strength + B.strength);
        const plane = aMin + depth * giveA;

        let movedA = 0, movedB = 0;
        for (let o = 0, k = 0; o < A.pos.length; o += 3, k++) {
          if (!inside(bb, A.pos[o], A.pos[o + 1], A.pos[o + 2])) continue;
          const p = A.pos[o] * nx + A.pos[o + 1] * ny + A.pos[o + 2] * nz;
          if (p >= plane) continue;
          const d = plane - p;
          A.pos[o] += nx * d; A.pos[o + 1] += ny * d; A.pos[o + 2] += nz * d;
          A.glow[k] = Math.min(1, A.glow[k] + 0.6);
          movedA++;
        }
        for (let o = 0, k = 0; o < B.pos.length; o += 3, k++) {
          if (!inside(ba, B.pos[o], B.pos[o + 1], B.pos[o + 2])) continue;
          const p = B.pos[o] * nx + B.pos[o + 1] * ny + B.pos[o + 2] * nz;
          if (p <= plane) continue;
          const d = p - plane;
          B.pos[o] -= nx * d; B.pos[o + 1] -= ny * d; B.pos[o + 2] -= nz * d;
          B.glow[k] = Math.min(1, B.glow[k] + 0.6);
          movedB++;
        }
        if (!movedA && !movedB) continue;
        if (movedA) A.pressed = true;
        if (movedB) B.pressed = true;

        // What it is to each: pressed from ahead, from behind, or on a flank.
        const how = (C: CmeState, other: CmeState, sign: number) => {
          const [dx, dy, dz] = C.input.dir;
          // The push on C points along sign·n.
          const along = sign * (nx * dx + ny * dy + nz * dz);
          if (along < -0.6) return 'front';
          if (along > 0.6) return 'behind';
          const oc = centre.get(other)!;
          return wrapAngle(Math.atan2(oc[0], oc[2]) - Math.atan2(dx, dz)) > 0 ? 'west' : 'east';
        };
        A.touching.set(B.input.id, how(A, B, 1));
        B.touching.set(A.input.id, how(B, A, -1));
      }
    }
  }

  /** No CME shoved far past its own path, and nothing inside the Sun. */
  private applyLimits(nominal: Map<CmeState, Float32Array>): void {
    const floor = this.options.sunRadius * 1.02;
    for (const c of this.cmes) {
      if (!c.active) continue;
      const nom = nominal.get(c);
      if (!nom) continue;
      for (let o = 0; o < c.pos.length; o += 3) {
        const r = Math.hypot(c.pos[o], c.pos[o + 1], c.pos[o + 2]);
        const rNom = Math.hypot(nom[o], nom[o + 1], nom[o + 2]);
        const cap = Math.max(floor, rNom * (1 + PUSH_LIMIT));
        // Out of the Sun, but never beyond its own path: a CME being born
        // is inside the Sun's disk by its shape, and must not be shoved.
        const want = Math.min(cap, Math.max(Math.min(floor, rNom), r));
        if (r > 0 && want !== r) {
          const s = want / r;
          c.pos[o] *= s; c.pos[o + 1] *= s; c.pos[o + 2] *= s;
        }
      }
    }
  }

  /**
   * No CME gets past the one in front of it. Seen from behind, across the
   * leader's path, each part of the chaser is held a gap short of the part
   * of the leader's front directly ahead of it (behind the nose in the
   * middle, the legs at the sides), and a gap short of the leader's
   * foremost point where there is no front ahead of it (beside the leader,
   * between its legs). The leader's tail and the depth behind its front are
   * pressed forward ahead of the chaser and compress as far as they have to;
   * the front itself never moves, so the leader is never slowed by what is
   * behind it. Runs after the limits, so a leader held to its own path
   * still cannot be run through.
   */
  private applyNoOvertaking(): void {
    const margin = this.options.contactSize;
    // Front to back: in a queue of three, the middle one is settled behind
    // the first before the last is settled behind it.
    const queues = [...this.queues].sort((x, y) =>
      (this.pathFronts.get(y.lead) ?? 0) - (this.pathFronts.get(x.lead) ?? 0)
      || (this.pathFronts.get(y.chase) ?? 0) - (this.pathFronts.get(x.chase) ?? 0));
    for (const { lead, chase, n } of queues) {
      const [nx, ny, nz] = n;
      const bodyEnd = lead.front * 3;
      if (!bodyEnd) continue;
      // Two directions across the leader's path, for a grid seen from behind.
      let ux = -nz, uy = 0, uz = nx;
      if (Math.hypot(ux, uy, uz) < 1e-6) { ux = 1; uy = 0; uz = 0; }
      const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
      const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
      const proj = (p: Float32Array, o: number) => p[o] * nx + p[o + 1] * ny + p[o + 2] * nz;

      // The leader's front, seen from behind: in each cell across its path,
      // how far back its front reaches there (a croissant's nose is far
      // ahead of its legs), and overall how far forward it goes.
      let ahead = -Infinity;
      let uMin = Infinity, uMax = -Infinity, wMin = Infinity, wMax = -Infinity;
      for (let o = 0; o < bodyEnd; o += 3) {
        ahead = Math.max(ahead, proj(lead.pos, o));
        const u = lead.pos[o] * ux + lead.pos[o + 1] * uy + lead.pos[o + 2] * uz;
        const w = lead.pos[o] * wx + lead.pos[o + 1] * wy + lead.pos[o + 2] * wz;
        if (u < uMin) uMin = u; if (u > uMax) uMax = u;
        if (w < wMin) wMin = w; if (w > wMax) wMax = w;
      }
      const gap = Math.max(margin, QUEUE_GAP * Math.max(0, ahead));
      const G = 14;
      const cellU = Math.max(margin, (uMax - uMin) / G), cellW = Math.max(margin, (wMax - wMin) / G);
      const nu = Math.ceil((uMax - uMin) / cellU) + 1, nw = Math.ceil((wMax - wMin) / cellW) + 1;
      const backOf = new Float32Array(nu * nw).fill(Infinity);
      const cellOf = (p: Float32Array, o: number) => {
        const iu = Math.floor((p[o] * ux + p[o + 1] * uy + p[o + 2] * uz - uMin) / cellU);
        const iw = Math.floor((p[o] * wx + p[o + 1] * wy + p[o + 2] * wz - wMin) / cellW);
        return iu < 0 || iw < 0 || iu >= nu || iw >= nw ? -1 : iu * nw + iw;
      };
      for (let o = 0; o < bodyEnd; o += 3) {
        const k = cellOf(lead.pos, o);
        if (k >= 0) backOf[k] = Math.min(backOf[k], proj(lead.pos, o));
      }
      // A cell the particles happen to miss, with front material on both
      // sides of it, is front too: its neighbours' back, so the chaser does
      // not leak through the gaps between particles.
      for (let pass = 0; pass < 2; pass++) {
        const src = backOf.slice();
        for (let iu = 0; iu < nu; iu++) for (let iw = 0; iw < nw; iw++) {
          const k = iu * nw + iw;
          if (src[k] < Infinity) continue;
          const at = (a: number, b: number) => (a >= 0 && b >= 0 && a < nu && b < nw ? src[a * nw + b] : Infinity);
          const pairs: [number, number][] = [
            [at(iu - 1, iw), at(iu + 1, iw)], [at(iu, iw - 1), at(iu, iw + 1)],
            [at(iu - 1, iw - 1), at(iu + 1, iw + 1)], [at(iu - 1, iw + 1), at(iu + 1, iw - 1)],
          ];
          let fill = Infinity;
          for (const [x, y] of pairs) if (x < Infinity && y < Infinity) fill = Math.min(fill, x, y);
          if (fill < Infinity) backOf[k] = fill;
        }
      }
      // Where the chaser may reach in each cell: a gap short of the leader's
      // front there and in the cells around it (so nothing slips in at a
      // cell's edge), or of its foremost point where there is no front
      // nearby (beside it, or between its legs).
      const reachOf = new Float32Array(nu * nw);
      for (let iu = 0; iu < nu; iu++) for (let iw = 0; iw < nw; iw++) {
        let m = Infinity;
        for (let du = -1; du <= 1; du++) for (let dw = -1; dw <= 1; dw++) {
          const a = iu + du, b = iw + dw;
          if (a >= 0 && b >= 0 && a < nu && b < nw) m = Math.min(m, backOf[a * nw + b]);
        }
        reachOf[iu * nw + iw] = (m < Infinity ? m : ahead) - gap;
      }
      const limitOf = (k: number) => (k >= 0 ? reachOf[k] : ahead - gap);

      // Not touching yet: the chaser is all still behind the leader's tail.
      let chaseMax = -Infinity, tailMin = Infinity;
      for (let o = 0; o < chase.pos.length; o += 3) chaseMax = Math.max(chaseMax, proj(chase.pos, o));
      for (let o = 0; o < lead.pos.length; o += 3) tailMin = Math.min(tailMin, proj(lead.pos, o));
      if (chaseMax <= tailMin - gap) continue;

      // The chaser, held behind the leader cell by cell; how far forward it
      // then reaches in each.
      const frontOf = new Float32Array(nu * nw).fill(-Infinity);
      let held = 0;
      for (let o = 0, k = 0; o < chase.pos.length; o += 3, k++) {
        const p = proj(chase.pos, o);
        if (p <= tailMin - gap) continue;
        const cell = cellOf(chase.pos, o);
        const limit = limitOf(cell);
        let q = p;
        if (p > limit) {
          const d = p - limit;
          chase.pos[o] -= nx * d; chase.pos[o + 1] -= ny * d; chase.pos[o + 2] -= nz * d;
          chase.glow[k] = Math.min(1, chase.glow[k] + 0.6);
          held++;
          q = limit;
        }
        if (cell >= 0 && q > frontOf[cell]) frontOf[cell] = q;
      }

      // The leader's tail and the depth behind its front, pressed ahead of
      // the chaser where they share a cell; the front itself never moves.
      for (let o = bodyEnd, k = lead.front; o < lead.pos.length; o += 3, k++) {
        const cell = cellOf(lead.pos, o);
        if (cell < 0 || frontOf[cell] === -Infinity) continue;
        const p = proj(lead.pos, o);
        const to = Math.min(frontOf[cell] + gap * 0.5, backOf[cell] < Infinity ? backOf[cell] : ahead);
        if (p >= to) continue;
        const d = to - p;
        lead.pos[o] += nx * d; lead.pos[o + 1] += ny * d; lead.pos[o + 2] += nz * d;
        lead.glow[k] = Math.min(1, lead.glow[k] + 0.6);
        lead.pressed = true;
      }
      if (held) {
        chase.held = true;
        chase.touching.set(lead.input.id, 'front');
        lead.touching.set(chase.input.id, 'behind');
      }
    }
  }

  // ── Checkpoints ──────────────────────────────────────────────────────────

  private saveCheckpoint(): void {
    const cp: Checkpoint = { atMs: this.clockMs, pos: new Map(), glow: new Map(), active: new Map(), held: new Map(), pressed: new Map() };
    for (const c of this.cmes) {
      cp.active.set(c.input.id, c.active);
      cp.held.set(c.input.id, c.held);
      cp.pressed.set(c.input.id, c.pressed);
      if (c.active) {
        cp.pos.set(c.input.id, c.pos.slice());
        cp.glow.set(c.input.id, c.glow.slice());
      }
    }
    this.checkpoints.push(cp);
  }

  private restoreBefore(targetMs: number): void {
    let cp = this.checkpoints[0];
    for (const x of this.checkpoints) if (x.atMs <= targetMs) cp = x;
    this.checkpoints = this.checkpoints.filter((x) => x.atMs <= cp.atMs);
    for (const c of this.cmes) {
      c.active = cp.active.get(c.input.id) ?? false;
      c.held = cp.held.get(c.input.id) ?? false;
      c.pressed = cp.pressed.get(c.input.id) ?? false;
      const p = cp.pos.get(c.input.id);
      const g = cp.glow.get(c.input.id);
      if (p) c.pos.set(p);
      if (g) c.glow.set(g);
      c.touching.clear();
    }
    this.clockMs = cp.atMs;
    this.stepCount = Math.round((cp.atMs - this.originMs) / this.options.stepMs);
  }
}

/**
 * A CME id as a reader would say it: "2026-09-20T12:36:00-CME-001" becomes
 * "CME 20 Sep 12:36". Anything else comes back as it was.
 */
export function shortCmeLabel(id: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(id);
  if (!m) return id;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `CME ${+m[3]} ${months[+m[2] - 1] ?? m[2]} ${m[4]}:${m[5]}`;
}

/**
 * What is being done to a CME, for the on-screen note. `cmeIds` tells other
 * CMEs apart from streams in what it is touching.
 */
export function touchingNotes(touching: Map<string, string>, cmeIds: Set<string>): string[] {
  const notes: string[] = [];
  const side = (how: string) => (how === 'west' ? 'West' : 'East');
  for (const [who, how] of touching) {
    if (cmeIds.has(who)) {
      const name = shortCmeLabel(who);
      if (how === 'front') notes.push(`Front compressed into ${name}`);
      else if (how === 'behind') notes.push(`Compressed from behind by ${name}`);
      else notes.push(`${side(how)} flank pressed by ${name}`);
    } else if (how === 'inside') {
      notes.push(`Held inside the ${who} stream`);
    } else {
      notes.push(`${side(how)} flank held by ${who}`);
    }
  }
  return notes.sort();
}
