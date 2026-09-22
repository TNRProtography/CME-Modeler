// CME–CME interactions (experimental): two storms that meet share the squeeze.
//
// Unlike a high-speed stream, which is a wall, neither CME is solid. Where two
// overlap, both give ground, and the stronger one (faster and wider) gives
// less. Each overlapping pair is resolved along whichever way they overlap
// least - the usual rule for separating two bodies - which sorts the two
// kinds of meeting apart without guessing:
//
//   - SIDE BY SIDE: their spreads overlap in azimuth at the same distance.
//     They share a boundary between them and each flank is flattened against
//     it.
//   - CATCH-UP: a CME behind runs into one ahead in the same direction. They
//     meet at an interface: the chaser's front is held there, the leader's
//     back is squeezed up against it. The leader is also nudged forward a
//     little - at most PUSH_LIMIT of its distance, about a 5-10% speed-up -
//     but compression is most of what happens.
//
// Everything here is worked out afresh each frame from where the CMEs would
// be on their own, so scrubbing the timeline backwards is as correct as
// playing it forwards.
//
// Angles are radians; azimuth is atan2(x, z) about solar north, increasing to
// the west, as in hssBarrier.ts. Distances are scene units from the Sun's
// centre.

import { wrapAngle } from './hssBarrier';

export interface CmeBody {
  id: string;
  /** Direction, as measured. */
  az: number;
  lat: number;
  halfAngle: number;
  /** Measured speed, km/s - with the width, what makes a CME hard to shift. */
  speed: number;
  /** Where the body runs from and to along its direction, on its own. */
  rBack: number;
  rFront: number;
}

export interface CmeAdjustment {
  /** Furthest the flanks may reach from the centre, or null where free. */
  westCap: number | null;
  eastCap: number | null;
  westBy: string | null;
  eastBy: string | null;
  /** Radii the body is squeezed between, or null where free. */
  frontCap: number | null;
  backCap: number | null;
  frontBy: string | null;
  backBy: string | null;
  /** How far the whole body is pushed on, beyond where it would be. */
  shift: number;
}

/** At most this fraction of its own distance is a leader pushed on. */
export const PUSH_LIMIT = 0.075;

/** Nobody is squeezed thinner than this, in angle or in depth. */
const MIN_ANGLE = (2 * Math.PI) / 180;
const MIN_DEPTH_FRAC = 0.15;

/** How hard a CME is to push around: faster and wider is harder. */
export const cmeStrength = (b: Pick<CmeBody, 'speed' | 'halfAngle'>) =>
  Math.max(1, b.speed) * Math.max(MIN_ANGLE, b.halfAngle);

const empty = (): CmeAdjustment => ({
  westCap: null, eastCap: null, westBy: null, eastBy: null,
  frontCap: null, backCap: null, frontBy: null, backBy: null, shift: 0,
});

const tighter = (current: number | null, next: number) =>
  current == null ? next : Math.min(current, next);

export function resolveCmeInteractions(bodies: CmeBody[]): Map<string, CmeAdjustment> {
  const out = new Map<string, CmeAdjustment>();
  for (const b of bodies) out.set(b.id, empty());

  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const A = bodies[i];
      const B = bodies[j];

      // Must share some latitude...
      if (Math.abs(A.lat - B.lat) >= A.halfAngle + B.halfAngle) continue;
      // ...some distance...
      const radialOverlap = Math.min(A.rFront, B.rFront) - Math.max(A.rBack, B.rBack);
      if (radialOverlap <= 0) continue;
      // ...and some azimuth.
      const d = wrapAngle(B.az - A.az);   // > 0: B lies west of A
      const angularOverlap = A.halfAngle + B.halfAngle - Math.abs(d);
      if (angularOverlap <= 0) continue;

      const sA = cmeStrength(A);
      const sB = cmeStrength(B);
      const giveA = sB / (sA + sB);   // the share of the squeeze A takes
      const giveB = sA / (sA + sB);

      const angularFrac = angularOverlap / (A.halfAngle + B.halfAngle);
      const depthA = A.rFront - A.rBack;
      const depthB = B.rFront - B.rBack;
      const radialFrac = radialOverlap / Math.max(1e-9, depthA + depthB);

      const adjA = out.get(A.id)!;
      const adjB = out.get(B.id)!;

      if (angularFrac <= radialFrac) {
        // Side by side: one shared boundary, each flank flattened against it.
        const capA = Math.max(MIN_ANGLE, A.halfAngle - angularOverlap * giveA);
        const capB = Math.max(MIN_ANGLE, B.halfAngle - angularOverlap * giveB);
        if (d >= 0) {
          if (adjA.westCap == null || capA < adjA.westCap) adjA.westBy = B.id;
          adjA.westCap = tighter(adjA.westCap, capA);
          if (adjB.eastCap == null || capB < adjB.eastCap) adjB.eastBy = A.id;
          adjB.eastCap = tighter(adjB.eastCap, capB);
        } else {
          if (adjA.eastCap == null || capA < adjA.eastCap) adjA.eastBy = B.id;
          adjA.eastCap = tighter(adjA.eastCap, capA);
          if (adjB.westCap == null || capB < adjB.westCap) adjB.westBy = A.id;
          adjB.westCap = tighter(adjB.westCap, capB);
        }
      } else {
        // Catch-up: the one whose front is further out is the leader.
        const [lead, chase, adjLead, adjChase, giveLead] = A.rFront >= B.rFront
          ? [A, B, adjA, adjB, giveA] as const
          : [B, A, adjB, adjA, giveB] as const;
        const penetration = chase.rFront - lead.rBack;
        if (penetration <= 0) continue;

        // The interface: the leader's back gives giveLead of the way.
        const pushLead = penetration * giveLead;
        const shift = Math.min(pushLead, PUSH_LIMIT * lead.rBack);
        adjLead.shift = Math.max(adjLead.shift, shift);

        const iface = lead.rBack + pushLead;
        const leadBack = Math.min(iface, lead.rFront + shift - MIN_DEPTH_FRAC * (lead.rFront - lead.rBack));
        const chaseFront = Math.max(iface, chase.rBack + MIN_DEPTH_FRAC * (chase.rFront - chase.rBack));

        if (adjLead.backCap == null || leadBack > adjLead.backCap) adjLead.backBy = chase.id;
        adjLead.backCap = adjLead.backCap == null ? leadBack : Math.max(adjLead.backCap, leadBack);
        if (adjChase.frontCap == null || chaseFront < adjChase.frontCap) adjChase.frontBy = lead.id;
        adjChase.frontCap = tighter(adjChase.frontCap, chaseFront);
      }
    }
  }
  return out;
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

/** What is being done to this CME by the others, for the on-screen note. */
export function interactionNotes(adj: CmeAdjustment | undefined): string[] {
  if (!adj) return [];
  const notes: string[] = [];
  if (adj.eastBy) notes.push(`East flank pressed by ${shortCmeLabel(adj.eastBy)}`);
  if (adj.westBy) notes.push(`West flank pressed by ${shortCmeLabel(adj.westBy)}`);
  if (adj.frontBy) notes.push(`Front compressed into ${shortCmeLabel(adj.frontBy)}`);
  if (adj.backBy) notes.push(`Compressed from behind by ${shortCmeLabel(adj.backBy)}`);
  return notes;
}
