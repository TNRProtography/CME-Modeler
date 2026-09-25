// The aurora forecast, from the nowcast's own physics.
//
// The app already turns observed L1 data into an oval boundary and a
// visibility read. computeOvalBoundary takes plain numbers - a coupling term,
// a dynamic pressure, a By and a Bz - and has no idea whether they were
// measured or modelled. So a five day forecast needs no new physics at all:
// feed it the forecast timeline instead of the observations and the same
// chain runs forward.
//
// That is the whole point of doing it this way. A separate forecast model
// would be a second place for the numbers to drift from the nowcast, and the
// two would eventually disagree about the same night.
//
// WHAT THE UNCERTAINTY ACTUALLY IS
// ────────────────────────────────
// The chain is only as good as its weakest input, and that is Bz - which is
// not forecastable. So each night gets a range rather than a number: the
// pessimistic end assumes the field never turns south beyond what the sector
// geometry guarantees, the optimistic end assumes the fluctuations line up.
// Both are computed; neither is dressed up as the answer.

import { computeOvalBoundary } from './ovalPhysics';
import { skyConditionsAt, visibilityOutlook, type VisibilityTier } from './skyConditions';
import { auroraGeometryAt, magneticLatitude } from './auroraVisibility';
import type { L1State } from './forecastTimeline';

/**
 * The Newell coupling function (Newell et al. 2007), in the units the rest of
 * this app's oval physics expects.
 *
 * Units matter here more than anywhere else in the chain, and the mistake is
 * invisible. computeOvalBoundary divides this by 1800 to get a latitude shift,
 * and LOADING_NEWELL_MIN is 2500 - so it wants the RAW value, which for
 * ordinary conditions is a few thousand. Dividing by a thousand first, as one
 * other coupling helper in the app does for its own purposes, makes every
 * value about twenty, the shift about a hundredth of a degree, and the oval
 * sit stubbornly at its quiet-time default no matter what the wind does. The
 * forecast still renders; it is just flat, and nothing says why.
 */
export function newellCoupling(speedKms: number, byNt: number, bzNt: number): number {
  const bt = Math.sqrt((byNt ?? 0) ** 2 + (bzNt ?? 0) ** 2);
  const theta = Math.atan2(byNt ?? 0, bzNt ?? 0);
  const s = Math.sin(theta / 2);
  return Math.pow(Math.max(0, speedKms), 4 / 3) * Math.pow(bt, 2 / 3) * Math.pow(Math.abs(s), 8 / 3);
}

// Probabilists' Gauss-Hermite nodes and weights, seven points: the expected
// value of f(z) for z ~ N(0, 1) is the weighted sum of f at the nodes.
const GAUSS_HERMITE_7: [number, number][] = [
  [-3.7504397, 0.000548268858737], [-2.3667594, 0.030757123967586], [-1.1544054, 0.240123178605013],
  [0, 0.457142857142857],
  [1.1544054, 0.240123178605013], [2.3667594, 0.030757123967586], [3.7504397, 0.000548268858737],
];

/**
 * The coupling to expect over an hour of a field whose Bz swings about
 * `bzMeanNt` by `bzSigmaNt`.
 *
 * Not the coupling at the average Bz. Coupling only counts the southward
 * part of the field, so the swings do not cancel: the southward half of
 * them feeds the magnetosphere and the northward half costs little. An hour
 * of a stream whose field averages zero but swings a few nT either way
 * drives far more than an hour of a field that sits at zero - and it is the
 * hourly average of exactly that which the nowcast's measured coupling is.
 */
export function expectedNewellCoupling(speedKms: number, byNt: number, bzMeanNt: number, bzSigmaNt: number): number {
  const sigma = Math.abs(bzSigmaNt);
  if (!(sigma > 0)) return newellCoupling(speedKms, byNt, bzMeanNt);
  return GAUSS_HERMITE_7.reduce((sum, [z, w]) => sum + w * newellCoupling(speedKms, byNt, bzMeanNt + sigma * z), 0);
}

/** Dynamic pressure from speed and density, in nPa. */
export function dynamicPressureNPa(speedKms: number, densityCm3: number): number {
  return 1.6726e-6 * Math.max(0, densityCm3) * Math.max(0, speedKms) ** 2;
}

export interface OutlookPoint {
  atMs: number;
  /** Oval boundary in southern geomagnetic latitude, negative degrees. */
  boundaryLikely: number;
  boundaryBest: number;
  couplingLikely: number;
  couplingBest: number;
  source: L1State['source'];
  disturbance: L1State['disturbance'];
}

/**
 * Run the timeline through the nowcast chain.
 *
 * Two passes, because Bz is the input nobody can forecast. The likely case
 * is the coupling to expect over an hour of the field swinging about what the
 * sector geometry guarantees - the swings' timing cannot be forecast, but
 * their size can, and their southward half drives the aurora whichever hours
 * they fall in. (It used to take only the guaranteed part, as if the field sat
 * perfectly still: a floor, which read every fast stream as barely worth a
 * camera.) The best case has the swings lined up southward for the hour.
 */
export function buildOutlook(timeline: L1State[]): OutlookPoint[] {
  return timeline.map((point) => {
    const by = point.btNt * 0.6;

    const bzLikely = point.bzFromSectorNt;
    const bzBest = point.bzFromSectorNt - Math.abs(point.bzFluctuationNt);

    const couplingLikely = expectedNewellCoupling(point.speedKms, by, bzLikely, point.bzFluctuationNt);
    const couplingBest = newellCoupling(point.speedKms, by, bzBest);
    const pressure = dynamicPressureNPa(point.speedKms, point.densityCm3);
    const at = new Date(point.atMs);

    return {
      atMs: point.atMs,
      boundaryLikely: computeOvalBoundary(
        { newell_avg_60m: couplingLikely, newell_avg_30m: couplingLikely,
          dynamic_pressure_nPa: pressure, by, bz: bzLikely }, false, at),
      boundaryBest: computeOvalBoundary(
        { newell_avg_60m: couplingBest, newell_avg_30m: couplingBest,
          dynamic_pressure_nPa: pressure, by, bz: bzBest }, false, at),
      couplingLikely,
      couplingBest,
      source: point.source,
      disturbance: point.disturbance,
    };
  });
}

export interface NightOutlook {
  /** Local midnight the night is named by. */
  nightMs: number;
  /** The best moment of that night, by visibility. */
  bestMs: number;
  tier: VisibilityTier;
  tierBest: VisibilityTier;
  label: string;
  strengthLikely: number;
  strengthBest: number;
  disturbance: L1State['disturbance'];
  note: string;
}

/**
 * The outlook night by night, which is how anybody actually plans.
 *
 * A forecast that says "moderate activity on Thursday" is not actionable if
 * Thursday's activity is at 2pm. Each night is therefore scored by its BEST
 * moment - darkest sky, oval closest - and reports when that is.
 */
export function nightlyOutlook(
  outlook: OutlookPoint[],
  latitude: number,
  longitude: number,
  viewerMlat: number = magneticLatitude(latitude, longitude),
): NightOutlook[] {
  if (outlook.length === 0) return [];

  const byNight = new Map<number, OutlookPoint[]>();
  for (const point of outlook) {
    // Nights are named by the local day they START in, so the small hours
    // belong to the evening before rather than to a new date.
    const local = point.atMs + longitude / 15 * 3600000;
    const night = Math.floor((local - 12 * 3600000) / 86400000);
    if (!byNight.has(night)) byNight.set(night, []);
    byNight.get(night)!.push(point);
  }

  const nights: NightOutlook[] = [];
  for (const [night, points] of [...byNight.entries()].sort((a, b) => a[0] - b[0])) {
    let best: { point: OutlookPoint; likely: number; bestCase: number; sky: ReturnType<typeof skyConditionsAt> } | null = null;

    for (const point of points) {
      const sky = skyConditionsAt(point.atMs, latitude, longitude);
      if (sky.darkness === 'daylight') continue;
      // The shared model: the viewer's corrected magnetic latitude, the oval
      // where it sits at this hour's magnetic local time, the viewline for
      // this much activity. The small hours near magnetic midnight win ties
      // they should win, because that is where the oval comes furthest.
      const likely = visibilityOutlook(
        auroraGeometryAt(point.boundaryLikely, point.atMs, latitude, longitude, viewerMlat).strength, sky).effectiveStrength;
      const bestCase = visibilityOutlook(
        auroraGeometryAt(point.boundaryBest, point.atMs, latitude, longitude, viewerMlat).strength, sky).effectiveStrength;
      // Chosen on the LIKELY case. Picking the moment that maximises the
      // optimistic case biases every night toward whichever hour has the
      // largest fluctuation amplitude, which is the hour we know least about.
      if (!best || likely > best.likely
          || (likely === best.likely && bestCase > best.bestCase)) {
        best = { point, likely, bestCase, sky };
      }
    }

    if (!best) continue;

    const likelyOutlook = visibilityOutlook(
      auroraGeometryAt(best.point.boundaryLikely, best.point.atMs, latitude, longitude, viewerMlat).strength, best.sky);
    const bestOutlook = visibilityOutlook(
      auroraGeometryAt(best.point.boundaryBest, best.point.atMs, latitude, longitude, viewerMlat).strength, best.sky);

    nights.push({
      nightMs: night * 86400000 + 12 * 3600000 - longitude / 15 * 3600000,
      bestMs: best.point.atMs,
      tier: likelyOutlook.tier,
      tierBest: bestOutlook.tier,
      label: likelyOutlook.tier === bestOutlook.tier
        ? likelyOutlook.label
        : `${likelyOutlook.label}, up to ${bestOutlook.label.toLowerCase()}`,
      strengthLikely: best.likely,
      strengthBest: best.bestCase,
      disturbance: best.point.disturbance,
      note: bestOutlook.note,
    });
  }

  return nights;
}
