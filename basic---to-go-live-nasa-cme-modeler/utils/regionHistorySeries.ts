// The series and colour scales behind a sunspot region's history charts.
//
// Each chart's line is coloured by level the way the X-ray flux chart is:
// every stretch of line takes the colour of the level it reaches, with a
// faint fill of the same colour under it. Green, yellow, orange, red, purple.
//
// Flare and proton chances use the bands chosen for this app; area, spots,
// flux and magnetised area use bands set from what NOAA and HMI report for
// ordinary, notable, large and exceptional regions.

import { replayStates, type RegionRecord, type RegionSnapshot } from './sunspotHistory';
import type { SharpHistoryPoint } from './sharpPositions';

export const LEVEL_RGB = {
  green: '34, 197, 94',
  yellow: '250, 204, 21',
  orange: '249, 115, 22',
  red: '239, 68, 68',
  purple: '168, 85, 247',
} as const;
export type Level = keyof typeof LEVEL_RGB;

/** Thresholds, highest first: at or above `min` is that level. Below all of them is green. */
export type Scale = { min: number; level: Level }[];

export const SCALES = {
  // As specified: C tops out at red.
  c: [{ min: 99, level: 'red' }, { min: 75, level: 'orange' }, { min: 60, level: 'yellow' }],
  m: [{ min: 90, level: 'purple' }, { min: 70, level: 'red' }, { min: 50, level: 'orange' }, { min: 30, level: 'yellow' }],
  x: [{ min: 70, level: 'purple' }, { min: 40, level: 'red' }, { min: 25, level: 'orange' }, { min: 10, level: 'yellow' }],
  proton: [{ min: 90, level: 'purple' }, { min: 70, level: 'red' }, { min: 50, level: 'orange' }, { min: 30, level: 'yellow' }],
  // NOAA sunspot area, millionths of a hemisphere. Most regions stay under
  // 100; 500 is a big group; past 1000 is the kind seen a few times a cycle.
  area: [{ min: 1000, level: 'purple' }, { min: 500, level: 'red' }, { min: 250, level: 'orange' }, { min: 100, level: 'yellow' }],
  // Spots in the group. A simple pair has a handful; 40 is a sprawling complex.
  spots: [{ min: 40, level: 'purple' }, { min: 25, level: 'red' }, { min: 15, level: 'orange' }, { min: 6, level: 'yellow' }],
  // HMI total unsigned flux, Maxwell. Big flare producers run 3-6 ×10²² Mx.
  flux: [{ min: 5e22, level: 'purple' }, { min: 3e22, level: 'red' }, { min: 1.5e22, level: 'orange' }, { min: 5e21, level: 'yellow' }],
  // HMI strong-field area, millionths of a hemisphere (counts plage, so
  // several times NOAA's spot area).
  fieldArea: [{ min: 2000, level: 'purple' }, { min: 1000, level: 'red' }, { min: 500, level: 'orange' }, { min: 200, level: 'yellow' }],
  // How fast the sunspot area is changing, MSH per day. Shrinking or barely
  // moving is green; +15 a day is a region building; +100 a day is the kind
  // of rapid growth that comes before big flares; +200 is explosive.
  growth: [{ min: 200, level: 'purple' }, { min: 100, level: 'red' }, { min: 50, level: 'orange' }, { min: 15, level: 'yellow' }],
} satisfies Record<string, Scale>;

export function levelOf(value: number, scale: Scale): Level {
  for (const band of scale) if (value >= band.min) return band.level;
  return 'green';
}

export const colourOf = (value: number, scale: Scale, opacity = 1): string =>
  `rgba(${LEVEL_RGB[levelOf(value, scale)]}, ${opacity})`;

export interface SeriesPoint { atMs: number; value: number }

/**
 * One of NOAA's numbers over the record, as a step: it holds each value
 * until the next report changes it, out to `untilMs` (now, or when the region
 * was last listed).
 */
export function noaaSeries(rec: RegionRecord, field: keyof RegionSnapshot, untilMs: number): SeriesPoint[] {
  const states = rec.events.every((e) => e.state) ? rec.events.map((e) => e.state as RegionSnapshot) : replayStates(rec);
  const out: SeriesPoint[] = [];
  rec.events.forEach((e, i) => {
    if ((e.source !== 'srs' && e.source !== 'noaa-json') || e.kind === 'gone') return;
    const v = states[i]?.[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) return;
    const last = out[out.length - 1];
    if (last && last.atMs === e.atMs) out[out.length - 1] = { atMs: e.atMs, value: v };
    else if (!last || last.value !== v) out.push({ atMs: e.atMs, value: v });
  });
  if (out.length && untilMs > out[out.length - 1].atMs) out.push({ atMs: untilMs, value: out[out.length - 1].value });
  return out;
}

/** HMI's hourly points from the app and from the worker, one per hour. */
export function mergeSharp(a: SharpHistoryPoint[], b: { atMs: number; usfluxMx: number; areaMh: number }[]): { atMs: number; usfluxMx: number; areaMh: number }[] {
  const byHour = new Map<number, { atMs: number; usfluxMx: number; areaMh: number }>();
  for (const p of b) byHour.set(Math.floor(p.atMs / 3600000), p);
  // The app's own query wins where both have an hour: it is the fresher.
  for (const p of a) byHour.set(Math.floor(p.atMs / 3600000), p);
  return [...byHour.values()].sort((x, y) => x.atMs - y.atMs);
}

/** The value at a moment: the last point at or before it. */
export function valueAt(points: SeriesPoint[], atMs: number): number | null {
  let v: number | null = null;
  for (const p of points) {
    if (p.atMs > atMs) break;
    v = p.value;
  }
  return v;
}

export interface RegionTrend {
  label: 'Growing' | 'Shrinking' | 'Stable' | 'Mixed';
  areaDelta: number | null;
  spotDelta: number | null;
}

/**
 * Whether a region is growing, from its area AND its spot count in NOAA's
 * latest report against the report in force a day before it. More spots in a day is a region building even when the area has
 * barely moved, and the other way round; when the two disagree it says so.
 */
export function regionTrend(rec: RegionRecord): RegionTrend | null {
  const area = noaaSeries(rec, 'areaMsh', 0);
  const spots = noaaSeries(rec, 'spotCount', 0);
  const latestMs = rec.lastSeenMs;
  const delta = (s: SeriesPoint[]) => {
    const now = valueAt(s, latestMs);
    // Reports are daily: 20 hours back lands on the one before.
    const then = valueAt(s, latestMs - 20 * 3600000);
    return now != null && then != null ? now - then : null;
  };
  const areaDelta = delta(area), spotDelta = delta(spots);
  if (areaDelta == null && spotDelta == null) return null;
  const up = (areaDelta ?? 0) >= 15 || (spotDelta ?? 0) >= 3;
  const down = (areaDelta ?? 0) <= -15 || (spotDelta ?? 0) <= -3;
  const label = up && down ? 'Mixed' : up ? 'Growing' : down ? 'Shrinking' : 'Stable';
  return { label, areaDelta, spotDelta };
}

/**
 * How fast the area changed between each pair of reports, MSH per day, as a
 * step: each rate holds from one report to the next, and the latest out to
 * `untilMs`.
 */
export function growthRateSeries(history: { atMs: number; area: number | null }[], untilMs: number): SeriesPoint[] {
  const pts = history.filter((h) => h.area != null && Number.isFinite(h.atMs)).sort((a, b) => a.atMs - b.atMs);
  const out: SeriesPoint[] = [];
  for (let i = 1; i < pts.length; i++) {
    const days = (pts[i].atMs - pts[i - 1].atMs) / 86400000;
    if (days < 0.25) continue;
    const rate = Math.round(((pts[i].area as number) - (pts[i - 1].area as number)) / days);
    // From the earlier report: the rate is what happened between the two.
    out.push({ atMs: pts[i - 1].atMs, value: rate });
  }
  const last = pts[pts.length - 1];
  if (out.length && last) {
    out.push({ atMs: last.atMs, value: out[out.length - 1].value });
    if (untilMs > last.atMs) out.push({ atMs: untilMs, value: out[out.length - 1].value });
  }
  return out;
}
