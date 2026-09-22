// HSS barrier (experimental) - high-speed streams as walls a CME cannot spread
// through.
//
// What it models, and what it deliberately does not:
//
//   - A CME keeps the direction and speed it was measured with. Any turning
//     near the Sun is already in NASA's direction, so the centre is never
//     moved. Only the SPREAD is limited.
//   - Each stream is a wall at the edge of its arm, exactly as the scene draws
//     it: the arm's centre and tube width at whatever distance the CME has
//     reached, turned by the Sun's rotation. As the CME moves outward the wall
//     follows the spiral with it.
//   - A flank that would cross a stream stops at the stream's near edge; the
//     other flank expands normally.
//   - A CME whose centre is already inside a stream is held between that
//     stream's two edges: the edges are walls from both sides.
//
// All angles are radians. Azimuth is measured about the solar north axis the
// way the scene does it, atan2(x, z), which increases towards solar WEST (the
// direction the Sun rotates). "West" and "east" below mean that.

export interface HssStreamSamples {
  /** Coronal hole this stream comes from, for the on-screen note. */
  id: string;
  /** Distances from the Sun's centre, evenly spaced along the arm. */
  r: number[];
  /** The arm's centre-line azimuth at each distance, in the arm's own frame. */
  az: number[];
  /** How far the drawn tube reaches either side of that, at that distance. */
  offLo: number[];
  offHi: number[];
  /** The tube's lowest and highest points there, above the equator plane. */
  yLo: number[];
  yHi: number[];
}

export interface StreamSector {
  id: string;
  /** World azimuth of the stream's centre line at this distance. */
  az: number;
  /** Its east and west edges, relative to that (lo ≤ 0 ≤ hi). */
  lo: number;
  hi: number;
  /** Latitude band it fills at this distance. */
  latLo: number;
  latHi: number;
}

/** Wraps an angle into (-π, π]. */
export function wrapAngle(a: number): number {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

/**
 * Where a stream is at distance R.
 *
 * groupAngle is the Y rotation the arm's parent groups add (the Sun's turn
 * plus the anchor), which carries the arm's own frame into the world. Null
 * where the stream is not drawn: beyond either end of the arm.
 */
export function streamSectorAt(s: HssStreamSamples, R: number, groupAngle: number): StreamSector | null {
  const n = s.r.length;
  if (n < 2 || !(R > 0)) return null;
  if (R < s.r[0] || R > s.r[n - 1]) return null;

  const f = ((R - s.r[0]) / (s.r[n - 1] - s.r[0])) * (n - 1);
  const i = Math.min(n - 2, Math.floor(f));
  const t = f - i;
  const lerp = (a: number[]) => a[i] + (a[i + 1] - a[i]) * t;

  const asinC = (v: number) => Math.asin(Math.max(-1, Math.min(1, v)));
  return {
    id: s.id,
    az: wrapAngle(s.az[i] + wrapAngle(s.az[i + 1] - s.az[i]) * t + groupAngle),
    lo: Math.min(0, lerp(s.offLo)),
    hi: Math.max(0, lerp(s.offHi)),
    latLo: asinC(lerp(s.yLo) / R),
    latHi: asinC(lerp(s.yHi) / R),
  };
}

export interface BarrierCme {
  /** World azimuth of the CME's direction. */
  az: number;
  /** Latitude of the CME's direction. */
  lat: number;
  /** Half-angle of the CME's spread. */
  halfAngle: number;
}

export interface BarrierLimits {
  /** How far west of its centre the CME may reach (≤ halfAngle). */
  west: number;
  /** How far east, as a positive angle (≤ halfAngle). */
  east: number;
  westBy: string | null;
  eastBy: string | null;
  /** The stream the CME's centre sits inside, if any. */
  inside: string | null;
}

/** Smallest reach a held flank keeps, so the CME never collapses to nothing. */
export const MIN_FLANK = (2 * Math.PI) / 180;

/**
 * How far each flank of a CME may spread past its centre, with every stream
 * it overlaps in latitude treated as a wall.
 */
export function barrierLimitsFor(cme: BarrierCme, sectors: StreamSector[]): BarrierLimits {
  let west = cme.halfAngle;
  let east = cme.halfAngle;
  let westBy: string | null = null;
  let eastBy: string | null = null;
  let inside: string | null = null;

  const cmeLatLo = cme.lat - cme.halfAngle;
  const cmeLatHi = cme.lat + cme.halfAngle;

  for (const sec of sectors) {
    if (sec.latHi < cmeLatLo || sec.latLo > cmeLatHi) continue;   // passes above or below
    // The stream's edges measured from the CME's centre, west positive.
    const mid = wrapAngle(sec.az - cme.az);
    const eastEdge = mid + sec.lo;
    const westEdge = mid + sec.hi;

    if (eastEdge <= 0 && westEdge >= 0) {
      // Centre inside the stream: both edges hold it.
      inside = inside ?? sec.id;
      if (westEdge < west) { west = westEdge; westBy = sec.id; }
      if (-eastEdge < east) { east = -eastEdge; eastBy = sec.id; }
    } else if (eastEdge > 0) {
      // Wholly to the west: its east edge is the wall.
      if (eastEdge < west) { west = eastEdge; westBy = sec.id; }
    } else {
      if (-westEdge < east) { east = -westEdge; eastBy = sec.id; }
    }
  }

  return {
    west: Math.max(MIN_FLANK, Math.min(cme.halfAngle, west)),
    east: Math.max(MIN_FLANK, Math.min(cme.halfAngle, east)),
    westBy,
    eastBy,
    inside,
  };
}

/** The on-screen note for one CME, or null when nothing is holding it. */
export function barrierNote(limits: BarrierLimits): string | null {
  if (limits.inside) return `Held inside the ${limits.inside} stream`;
  const parts: string[] = [];
  if (limits.eastBy) parts.push(`East flank held by ${limits.eastBy}`);
  if (limits.westBy) parts.push(`West flank held by ${limits.westBy}`);
  return parts.length ? parts.join(' · ') : null;
}
