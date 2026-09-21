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
 * uses only what the sector geometry guarantees - that is a real, computable
 * southward field. The best case adds the fluctuation amplitude on top, which
 * is what happens when the swings happen to line up southward. The truth is
 * somewhere between and nobody can say where.
 */
export function buildOutlook(timeline: L1State[]): OutlookPoint[] {
  return timeline.map((point) => {
    const by = point.btNt * 0.6;

    const bzLikely = point.bzFromSectorNt;
    const bzBest = point.bzFromSectorNt - Math.abs(point.bzFluctuationNt);

    const couplingLikely = newellCoupling(point.speedKms, by, bzLikely);
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

/**
 * Turn an oval boundary into a strength for somebody at a given latitude.
 *
 * The oval reaching your latitude is not the same as it being overhead. Aurora
 * is visible well equatorward of the boundary as a glow on the horizon, so
 * this falls off with distance rather than switching off at the line.
 */
const FALLOFF_DEG = 8;

export function strengthAtLatitude(boundaryGeomagLat: number, viewerLat: number): number {
  // Both are southern and negative, and the oval moves EQUATORWARD - toward
  // zero, so toward a less negative number - as the driving strengthens.
  // `reach` is how many degrees poleward of the viewer the oval's equatorward
  // edge still sits: zero means it is right overhead, and larger means further
  // away.
  const reach = Math.abs(boundaryGeomagLat) - Math.abs(viewerLat);
  if (reach <= 0) return 100;
  if (reach >= FALLOFF_DEG) return 0;
  // Beyond overhead it is a glow low on the horizon, and it goes from
  // "obvious" to "is that a cloud" over surprisingly few degrees. An eight
  // degree falloff rather than fourteen: the earlier number had a display
  // eight degrees poleward still scoring well over half, which is generous
  // enough that quiet nights came out looking worth driving for.
  return Math.max(0, Math.min(100, 100 * (1 - reach / FALLOFF_DEG) ** 1.6));
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
  geomagneticLatitude: number = latitude,
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
      const likely = visibilityOutlook(
        strengthAtLatitude(point.boundaryLikely, geomagneticLatitude), sky).effectiveStrength;
      const bestCase = visibilityOutlook(
        strengthAtLatitude(point.boundaryBest, geomagneticLatitude), sky).effectiveStrength;
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
      strengthAtLatitude(best.point.boundaryLikely, geomagneticLatitude), best.sky);
    const bestOutlook = visibilityOutlook(
      strengthAtLatitude(best.point.boundaryBest, geomagneticLatitude), best.sky);

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
