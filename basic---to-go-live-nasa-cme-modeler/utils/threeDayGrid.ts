// The next three days, three hours at a time: what can be seen from where the
// viewer is, laid out like NOAA's 3-day forecast - a column a day, a row for
// each three-hour block - but in visibility rather than Kp.
//
// Each block is the stronger of three forecasts, all put through the same
// chain (oval boundary -> viewer's strength) so they are comparable:
//   - NOAA's Kp forecast for the block (utils/kpVisibility),
//   - the coronal hole streams the Coronal Hole Tracker has coming,
//   - the CME model.
// Taking the stronger is deliberate. Each misses things the others see - NOAA
// forecasters know about streams and CMEs this app has not modelled, and the
// tracker sees holes NOAA may not have weighted - and a night one of them
// rates is a night worth knowing about.
//
// Then the sky at that hour: daylight hides everything, twilight dims, and
// the Moon costs what it costs when it is actually up.

import type { OutlookPoint } from './auroraOutlook';
import { auroraGeometryAt } from './auroraVisibility';
import { skyConditionsAt, visibilityOutlook, type VisibilityTier, type Darkness } from './skyConditions';
import { boundaryForKp, kpAt, type KpBlock } from './kpVisibility';

const HOUR = 3600000;
const NZ_ZONE = 'Pacific/Auckland';

/** New Zealand's offset from UTC at a moment, in ms (12 or 13 hours). */
export function nzOffsetMs(atMs: number): number {
  const part = new Intl.DateTimeFormat('en-NZ', { timeZone: NZ_ZONE, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(atMs)).find((p) => p.type === 'timeZoneName')?.value ?? '';
  const m = part.match(/([+-]\d{1,2})(?::(\d{2}))?/);
  if (!m) return 12 * HOUR;
  const h = Number(m[1]);
  return (h + Math.sign(h) * Number(m[2] ?? 0) / 60) * HOUR;
}

/** The UTC moment of a New Zealand wall-clock time given as if it were UTC. */
function nzWallToUtc(wallMs: number): number {
  const guess = wallMs - nzOffsetMs(wallMs - 12 * HOUR);
  return wallMs - nzOffsetMs(guess);
}

export type GridDriver = 'NOAA Kp' | 'coronal hole' | 'CME' | 'quiet';

export interface GridCell {
  /** Block start and end, UTC. */
  startMs: number;
  endMs: number;
  /** New Zealand clock hour the block starts at: 0, 3, ... 21. */
  startHour: number;
  past: boolean;
  tier: VisibilityTier;
  /** Strength after the sky, 0-100: the number the hours card shows too. */
  effective: number;
  /** Before the sky. */
  raw: number;
  /** The best hour of the block. */
  bestMs: number;
  darkness: Darkness;
  moonUp: boolean;
  moonIllumination: number;
  /** Which forecast set the strength. */
  driver: GridDriver;
  kp: number | null;
  label: string;
}

export interface GridDay {
  /** Midnight starting the New Zealand day, UTC. */
  dayStartMs: number;
  cells: GridCell[];
}

export interface GridInputs {
  nowMs: number;
  latitude: number;
  longitude: number;
  kpBlocks: KpBlock[];
  /** The tracker's streams, run through buildOutlook, hourly. */
  holeOutlook: OutlookPoint[];
  /** The CME model's outlook; only its CME-disturbed hours are used. */
  cmeOutlook: OutlookPoint[];
  days?: number;
}

const nearest = (points: OutlookPoint[], atMs: number, within = 45 * 60000): OutlookPoint | null => {
  let best: OutlookPoint | null = null;
  let gap = within;
  for (const p of points) {
    const g = Math.abs(p.atMs - atMs);
    if (g <= gap) { gap = g; best = p; }
  }
  return best;
};

/**
 * One hour, before the sky: the strongest of the three forecasts for the
 * viewer, which set it, and the Kp it amounts to - NOAA's own when NOAA set
 * it, otherwise the Kp whose oval sits where that forecast's does. The Kp is
 * what lets a Kp-styled chart draw a stream-driven night in the right colours.
 */
export function combinedAt(t: number, i: GridInputs): { raw: number; driver: GridDriver; kp: number | null; equivalentKp: number } {
  const strengthAt = (boundary: number) => auroraGeometryAt(boundary, t, i.latitude, i.longitude).strength;
  let raw = 0;
  let driver: GridDriver = 'quiet';
  let boundary: number | null = null;

  const hole = nearest(i.holeOutlook, t);
  if (hole) {
    raw = strengthAt(hole.boundaryLikely);
    boundary = hole.boundaryLikely;
    driver = hole.disturbance === 'ambient' ? 'quiet' : 'coronal hole';
  }
  const cme = nearest(i.cmeOutlook.filter((p) => String(p.disturbance).startsWith('CME')), t);
  if (cme) {
    const s = strengthAt(cme.boundaryLikely);
    if (s > raw) { raw = s; driver = 'CME'; boundary = cme.boundaryLikely; }
  }
  const block = kpAt(i.kpBlocks, t);
  if (block) {
    const s = strengthAt(boundaryForKp(block.kp, t));
    if (s > raw) { raw = s; driver = 'NOAA Kp'; }
  }

  let equivalentKp = 0;
  if (driver === 'NOAA Kp' && block) equivalentKp = block.kp;
  else if (boundary != null) {
    // boundaryForKp rises towards the equator with Kp, so bisect.
    let lo = 0, hi = 9;
    for (let n = 0; n < 24; n++) {
      const mid = (lo + hi) / 2;
      if (boundaryForKp(mid, t) < boundary) lo = mid; else hi = mid;
    }
    equivalentKp = Math.max(block?.kp ?? 0, (lo + hi) / 2);
  } else equivalentKp = block?.kp ?? 0;

  return { raw, driver, kp: block?.kp ?? null, equivalentKp };
}

/** One hour: the combined strength, then the sky. */
function evaluateHour(t: number, i: GridInputs) {
  const c = combinedAt(t, i);
  const sky = skyConditionsAt(t, i.latitude, i.longitude);
  const vis = visibilityOutlook(c.raw, sky);
  return { t, raw: c.raw, driver: c.driver, sky, vis, kp: c.kp };
}

export function buildThreeDayGrid(i: GridInputs): GridDay[] {
  const days = i.days ?? 3;
  // Today's New Zealand midnight, as wall-clock-in-UTC, then real UTC.
  const wallNow = i.nowMs + nzOffsetMs(i.nowMs);
  const wallMidnight = Math.floor(wallNow / (24 * HOUR)) * 24 * HOUR;

  const out: GridDay[] = [];
  for (let d = 0; d < days; d++) {
    const dayWall = wallMidnight + d * 24 * HOUR;
    const cells: GridCell[] = [];
    for (let h = 0; h < 24; h += 3) {
      const startMs = nzWallToUtc(dayWall + h * HOUR);
      const endMs = nzWallToUtc(dayWall + (h + 3) * HOUR);
      const past = endMs <= i.nowMs;

      // The hours of the block still to come, each at its middle.
      const hours: number[] = [];
      for (let t = startMs + HOUR / 2; t < endMs; t += HOUR) if (t >= i.nowMs - HOUR / 2) hours.push(t);
      const evaluated = past || hours.length === 0 ? [] : hours.map((t) => evaluateHour(t, i));
      const best = evaluated.reduce<ReturnType<typeof evaluateHour> | null>(
        (a, b) => (!a || b.vis.effectiveStrength > a.vis.effectiveStrength ? b : a), null);
      // Daylight everywhere in the block: say so, whatever the strength.
      const shown = best ?? (hours.length ? evaluateHour(hours[0], i) : null);

      cells.push({
        startMs, endMs, startHour: h, past,
        tier: best ? best.vis.tier : 'none',
        effective: best ? Math.round(best.vis.effectiveStrength) : 0,
        raw: best ? Math.round(best.raw) : 0,
        bestMs: shown?.t ?? startMs,
        darkness: shown?.sky.darkness ?? 'daylight',
        moonUp: (shown?.sky.moonAltitude ?? -1) > 0,
        moonIllumination: shown?.sky.phase.illumination ?? 0,
        driver: shown?.driver ?? 'quiet',
        kp: shown?.kp ?? null,
        label: shown?.vis.label ?? '',
      });
    }
    out.push({ dayStartMs: nzWallToUtc(dayWall), cells });
  }
  return out;
}

/** The single best block ahead, for the line under the grid. */
export function bestCell(grid: GridDay[]): GridCell | null {
  let best: GridCell | null = null;
  for (const day of grid) for (const c of day.cells) {
    if (c.past || c.tier === 'none') continue;
    if (!best || c.effective > best.effective) best = c;
  }
  return best;
}
