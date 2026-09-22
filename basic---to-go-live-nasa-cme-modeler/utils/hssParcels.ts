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
  /** 0 = flowing freely (or merely denser), 1 = piled up hard against slower wind ahead. */
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

/**
 * Speeds are averaged over this much either side of a parcel's emission.
 *
 * The speed is estimated from each reading's measured width, and a width
 * measured every two hours wobbles by tens of percent from one frame to the
 * next. Taken literally, every wobble is fast wind catching slow wind, the
 * stream piles up on itself everywhere, and the tube folds into slabs. Real
 * changes in a hole last many hours and survive the averaging; frame-to-frame
 * noise does not.
 */
export const SPEED_SMOOTHING_MS = 12 * 3600000;


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

  // What the hole was really like when a parcel left: the readings around
  // it averaged, within the time the hole was actually emitting. Position
  // and size as well as speed - the detector's centroid wanders by a few
  // degrees from frame to frame, more than the Sun turns between frames, and
  // taken literally the stream zigzags. Finely sampled and tapered at the
  // ends, so the average does not beat against the readings' cadence.
  const smoothedState = (ms: number, fallback: HoleState): HoleState => {
    const acc = { lat: 0, lon: 0, widthDeg: 0, heightDeg: 0, darkness: 0, estimatedSpeedKms: 0 };
    let weight = 0;
    const K = 24;
    for (let k = -K; k <= K; k++) {
      const at = ms + (k * SPEED_SMOOTHING_MS) / K;
      if (at < source.firstMs || at > newest) continue;
      const s = source.stateAt(at);
      if (!s || !(s.estimatedSpeedKms > 0)) continue;
      const w = 1 - Math.abs(k) / (K + 1);
      acc.lat += s.lat * w; acc.lon += s.lon * w;
      acc.widthDeg += s.widthDeg * w; acc.heightDeg += s.heightDeg * w;
      acc.darkness += s.darkness * w; acc.estimatedSpeedKms += s.estimatedSpeedKms * w;
      weight += w;
    }
    if (!weight) return fallback;
    return {
      lat: acc.lat / weight, lon: acc.lon / weight,
      widthDeg: acc.widthDeg / weight, heightDeg: acc.heightDeg / weight,
      darkness: acc.darkness / weight, estimatedSpeedKms: acc.estimatedSpeedKms / weight,
    };
  };

  // Oldest first: that is the order the pile-up has to be worked out in.
  const raw: Parcel[] = [];
  for (let i = 0; i < o.count; i++) {
    const emittedMs = oldest + ((newest - oldest) * i) / (o.count - 1);
    const measured = source.stateAt(emittedMs);
    if (!measured) continue;
    const state = smoothedState(emittedMs, measured);
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
  // before it. Where it would be, it rides up behind it instead, and how
  // much closer it sits than its own speed would put it is the compression.
  //
  // It keeps a quarter of its natural spacing even then. Wind squeezed to a
  // quarter is a hard pile-up; squeezed to nothing, a run of parcels would
  // sit at one distance side by side, and the tube through them would fold
  // sideways into a slab.
  const minGap = span * 1e-5;
  for (let i = 1; i < raw.length; i++) {
    const ahead = raw[i - 1];
    const p = raw[i];
    const nominalGap = Math.max(minGap,
      p.state.estimatedSpeedKms * o.unitsPerKm * ((p.emittedMs - ahead.emittedMs) / 1000));
    const closest = Math.max(minGap, nominalGap * 0.25);
    if (p.r > ahead.r - closest) p.r = ahead.r - closest;
    // Compression counts from half the natural spacing down to the floor:
    // wind a little closer together than usual is just denser wind, and
    // only a real pile-up should be drawn as one.
    const ratio = (ahead.r - p.r) / nominalGap;
    p.compression = Math.max(0, Math.min(1, (0.5 - ratio) / 0.25));
  }
  // The pile-up is felt on both sides of it.
  for (let i = raw.length - 2; i >= 0; i--) {
    raw[i].compression = Math.max(raw[i].compression, raw[i + 1].compression * 0.8);
  }

  // Past the reach is off the edge of the scene.
  return raw.filter((p) => p.r <= o.reach && p.r >= o.r0 * 0.999).reverse();
}
