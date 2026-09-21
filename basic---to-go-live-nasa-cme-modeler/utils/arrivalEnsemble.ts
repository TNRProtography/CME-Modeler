// How wrong the arrival time could be, worked out rather than asserted.
//
// The panel used to say "plus or minus 7 hours". That 7 was a judgement call
// of mine - a plausible-looking number with nothing behind it. It was the same
// 7 for a hole measured fifty times over two days as for one seen once near
// the limb, which is the giveaway: a real uncertainty narrows as you learn
// more, and that one never moved.
//
// This runs the arrival many times instead, each with the inputs jiggled by
// as much as they are actually uncertain, and reports where the answers land.
// The band is then a consequence of what is known, so it tightens for a
// well-measured hole and widens for a guess - and it comes out asymmetric,
// which matters, because a stream can be held up by slower wind ahead of it
// far more easily than it can arrive early.
//
// References for the drag model: Vrsnak et al. 2013 for the quadratic drag
// itself, Napoletano et al. 2018 and Dumbovic et al. 2018 for running it as
// an ensemble rather than a single shot.

const AU_KM = 149597870.7;

/**
 * A small deterministic generator.
 *
 * Deterministic on purpose. A forecast computed on a server and shown on a
 * phone has to be the same forecast, and a test that re-rolls its dice every
 * run tells you nothing when it fails.
 */
export function makeRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    // xorshift32
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 4294967296;
  };
}

/** Box-Muller, so the perturbations are normal rather than flat. */
function gaussian(random: () => number): number {
  const u = Math.max(1e-12, random());
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface HssArrivalInputs {
  /** When the hole crossed the middle of the disk. */
  centralMeridianMs: number;
  /** Estimated stream speed at 1 AU. */
  speedKms: number;
  /**
   * How well the hole is measured, 0 badly to 1 thoroughly.
   *
   * Drives the spread. A hole measured through fifty frames while it crossed
   * the disk is a different proposition from one glimpsed once near the limb,
   * and the band has to say so.
   */
  confidence: number;
}

export interface ArrivalEnsemble {
  /** The middle of the distribution. */
  medianMs: number;
  /** Where 80% of members landed. */
  p10Ms: number;
  p90Ms: number;
  /** Hours from the median to each edge - asymmetric, and that is the point. */
  earlyHours: number;
  lateHours: number;
  members: number;
  /** Median speed across the ensemble. */
  medianSpeedKms: number;
}

/**
 * The spread on an HSS arrival.
 *
 * Three things are uncertain and they are not equally uncertain:
 *
 *  - the speed, from a width-and-darkness estimate that is a correlation
 *    rather than a measurement;
 *  - when the hole actually crossed the meridian, since its centroid moves
 *    around as its shape changes;
 *  - how much slower wind ahead holds the stream up, which can only ever
 *    delay it. That is why the band is lopsided.
 */
export function hssArrivalEnsemble(
  inputs: HssArrivalInputs,
  members = 200,
  seed = 12345,
): ArrivalEnsemble | null {
  const { centralMeridianMs, speedKms, confidence } = inputs;
  if (!Number.isFinite(centralMeridianMs) || !(speedKms > 0)) return null;

  const trust = Math.max(0, Math.min(1, confidence));
  // A well-measured hole still has a real speed uncertainty - the width-to-
  // speed relation itself scatters - so this narrows but never vanishes.
  const speedSigma = 0.10 + 0.16 * (1 - trust);
  // Centroid wander, in hours of meridian crossing.
  const crossingSigmaHours = 2 + 6 * (1 - trust);

  const random = makeRandom(seed);
  const arrivals: number[] = [];
  const speeds: number[] = [];

  for (let i = 0; i < members; i++) {
    const speed = speedKms * Math.exp(gaussian(random) * speedSigma);
    if (!(speed > 50)) continue;
    const crossing = centralMeridianMs + gaussian(random) * crossingSigmaHours * 3600000;
    // Interaction delay. Most streams run more or less freely; a minority
    // catch slower wind ahead and are held up substantially. Modelling that
    // as "everyone is delayed a bit" would be wrong in a way that hides the
    // whole effect: a delay applied to every member just moves the median
    // later and leaves the band as symmetric as it started. It is the rare
    // large hold-up that makes the late tail longer than the early one, and
    // that tail is the honest part - nothing makes a stream arrive before a
    // straight run would.
    const heldUp = random() < 0.3;
    const delayHours = heldUp ? -Math.log(Math.max(1e-9, random())) * 7 : 0;

    arrivals.push(crossing + (AU_KM / speed) * 1000 + delayHours * 3600000);
    speeds.push(speed);
  }

  if (arrivals.length < 10) return null;
  arrivals.sort((a, b) => a - b);
  speeds.sort((a, b) => a - b);

  const at = (q: number) => arrivals[Math.min(arrivals.length - 1, Math.floor(q * arrivals.length))];
  const medianMs = at(0.5);
  const p10Ms = at(0.1);
  const p90Ms = at(0.9);

  return {
    medianMs,
    p10Ms,
    p90Ms,
    earlyHours: (medianMs - p10Ms) / 3600000,
    lateHours: (p90Ms - medianMs) / 3600000,
    members: arrivals.length,
    medianSpeedKms: Math.round(speeds[Math.floor(speeds.length / 2)]),
  };
}

/**
 * How well a hole is measured, from what we actually have of it.
 *
 * Three things earn trust: being seen many times, being seen over a long
 * enough span to show a trend, and having been measured near the middle of
 * the disk where a hole is not foreshortened.
 */
export function measurementConfidence(
  sampleCount: number,
  spanHours: number,
  closestToMeridianDeg: number,
): number {
  const counted = Math.min(1, sampleCount / 24);
  const spanned = Math.min(1, spanHours / 36);
  const centred = Math.max(0, 1 - Math.abs(closestToMeridianDeg) / 70);
  return Math.max(0, Math.min(1, counted * 0.3 + spanned * 0.3 + centred * 0.4));
}

/** How to describe a lopsided band without pretending it is symmetric. */
export function describeSpread(ensemble: ArrivalEnsemble): string {
  const early = Math.round(ensemble.earlyHours);
  const late = Math.round(ensemble.lateHours);
  if (Math.abs(early - late) <= 1) return `give or take ${Math.max(early, late)} hours`;
  return `${early} hours early to ${late} hours late`;
}
