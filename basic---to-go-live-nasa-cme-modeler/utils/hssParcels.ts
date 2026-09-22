// A high-speed stream built from the wind itself.
//
// Each stream is a string of parcels. A parcel leaves the coronal hole at
// some moment, at the speed and width the hole had then, and travels straight
// out from the Sun at that speed. Nothing is drawn that has not been emitted
// yet, so:
//
//   - a hole that has just formed has a stub of a stream, and it grows out
//     from the Sun at the wind speed, reading by reading;
//   - each reading's wind keeps that reading's speed and width;
//   - faster wind that catches slower wind ahead cannot pass through it - it
//     piles up behind it, which is how the compressed front of a real stream
//     forms, and the pile-up is marked so it can be drawn brighter;
//   - when a hole closes the Sun stops feeding it, and the last wind emitted
//     drifts on outward as a detached section.
//
// Geometry is in the Sun's own rotating frame, the one the hole patches are
// drawn in. A parcel moves radially in space, so in that frame it falls
// behind its source at the Sun's rotation rate - which is what winds the
// stream into a Parker spiral. The spiral here comes from that and from the
// wind speed, not from a drawing constant.

/** What a hole was like at a moment, in the fixed frame the patches use. */
export interface HoleState {
  lat: number;
  lon: number;          // degrees, west positive
  widthDeg: number;
  heightDeg: number;
  darkness: number;
  estimatedSpeedKms: number;
}

export interface StreamSource {
  /** The hole's state at an emission time, or null if unknown then. */
  stateAt: (ms: number) => HoleState | null;
  /** When the hole was first seen: nothing is emitted before this. */
  firstMs: number;
  /** When it stopped being fed, or null while it is still open. */
  lastMs: number | null;
}

export interface Parcel {
  emittedMs: number;
  /** Distance from the Sun's centre, scene units. */
  r: number;
  /** Azimuth in the Sun's frame, radians: atan2(x, z) of the patch frame. */
  az: number;
  state: HoleState;
  /** 0 = flowing freely, 1 = piled up hard against slower wind ahead. */
  compression: number;
}

export interface StreamOptions {
  /** Simulation time. */
  nowMs: number;
  /** How many parcels to lay along the stream. */
  count: number;
  /** Where the wind starts, and where the drawn stream ends. */
  r0: number;
  reach: number;
  /** Scene units per km. */
  unitsPerKm: number;
  /** Rotation rate of the Sun as the scene turns it, rad/s. */
  omega: number;
}

const DEG = Math.PI / 180;

/** Scene units per km when 1 AU is `sceneScale` units. */
export const unitsPerKmFor = (sceneScale: number) => sceneScale / 1.495978707e8;

/**
 * The parcels of one stream at `nowMs`, nearest the Sun first. Empty when
 * nothing has been emitted yet, or everything emitted has left the scene.
 */
export function streamParcels(source: StreamSource, o: StreamOptions): Parcel[] {
  const newest = Math.min(o.nowMs, source.lastMs ?? Infinity);
  if (!(newest > source.firstMs) || o.count < 2) return [];

  // The oldest wind still inside the scene. The slowest wind the hole ever
  // produced decides how far back that can be; anything emitted earlier has
  // gone past the reach whatever its speed.
  const span = o.reach - o.r0;
  let slowest = Infinity;
  const probe = 24;
  for (let i = 0; i <= probe; i++) {
    const s = source.stateAt(source.firstMs + ((newest - source.firstMs) * i) / probe);
    if (s && s.estimatedSpeedKms > 0) slowest = Math.min(slowest, s.estimatedSpeedKms);
  }
  if (!Number.isFinite(slowest)) return [];
  const longestTripMs = (span / (slowest * o.unitsPerKm)) * 1000;
  const oldest = Math.max(source.firstMs, o.nowMs - longestTripMs);
  if (!(newest > oldest)) return [];

  // Oldest first: that is the order the pile-up has to be worked out in.
  const raw: Parcel[] = [];
  for (let i = 0; i < o.count; i++) {
    const emittedMs = oldest + ((newest - oldest) * i) / (o.count - 1);
    const state = source.stateAt(emittedMs);
    if (!state) continue;
    const ageS = Math.max(0, (o.nowMs - emittedMs) / 1000);
    raw.push({
      emittedMs,
      r: o.r0 + state.estimatedSpeedKms * o.unitsPerKm * ageS,
      az: state.lon * DEG - o.omega * ageS,
      state,
      compression: 0,
    });
  }
  if (raw.length < 2) return [];

  // No overtaking: a parcel may not be further out than the one emitted
  // before it. Where it would be, it rides up against it instead, and how
  // much closer it sits than its own speed would put it is the compression.
  const minGap = span * 1e-5;
  for (let i = 1; i < raw.length; i++) {
    const ahead = raw[i - 1];
    const p = raw[i];
    const nominalGap = Math.max(minGap,
      p.state.estimatedSpeedKms * o.unitsPerKm * ((p.emittedMs - ahead.emittedMs) / 1000));
    if (p.r > ahead.r - minGap) p.r = ahead.r - minGap;
    const gap = ahead.r - p.r;
    p.compression = Math.max(0, Math.min(1, 1 - gap / nominalGap));
  }
  // The pile-up is felt on both sides of it.
  for (let i = raw.length - 2; i >= 0; i--) {
    raw[i].compression = Math.max(raw[i].compression, raw[i + 1].compression * 0.8);
  }

  // Past the reach is off the edge of the scene.
  return raw.filter((p) => p.r <= o.reach && p.r >= o.r0 * 0.999).reverse();
}
