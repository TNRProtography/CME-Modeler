// Which sunspot regions were on the Sun at a past moment, and what they were
// like then - for the sunspot tracker's labels as it scrubs back through the
// imagery.
//
// NOAA's list is today's. Drawn on a frame from five days ago it left off
// every region that has since rotated away or faded, and showed today's
// regions before they had formed. Now each region shows on a frame only if
// it existed then, with its class, spots and area as they were then:
//
//   - HMI says best when a region was there: it tracks each region's patch
//     hour by hour, so a region appears on the frame where HMI first picked
//     it up and goes on the frame after HMI last saw it.
//   - Where HMI has nothing to say (no patch, or the frame is before the
//     history HMI was asked for), the sunspot-history worker's record does:
//     listed from the day NOAA first listed it to the day it dropped off.
//   - A region in neither is today's, and is shown as before.

import { regionKey, smoothedPositionAt, type SharpHistoryPoint } from './sharpPositions';
import { regionAt, type RegionRecord } from './sunspotHistory';
import type { RegionInput } from './regionLabels';

const HOUR = 3600000;
const GRACE_MS = 90 * 60000;

export interface FrameRegionsOptions {
  /** The sunspot-history worker's records, by NOAA's four-digit number, or null. */
  records: Record<string, RegionRecord> | null;
  /** Today's regions, as drawn on the live frame. */
  current: RegionInput[];
  /** HMI's hourly history, keyed by regionKey. */
  sharp: Map<string, SharpHistoryPoint[]>;
  /** Where that history begins: a patch first seen there may be older. */
  coverageFromMs: number;
  atMs: number;
  nowMs?: number;
  /** The region the close-up follows: kept, grey, before it emerged. */
  selectedId?: string | null;
  /** Label colour from a region's class and flare chances at the time. */
  colourOf: (magClass: string | null, mProb: number | null, xProb: number | null) => string;
}

/** HMI's verdict on whether a region was there: true, false, or no idea. */
export function hmiPresent(points: SharpHistoryPoint[] | undefined, atMs: number, coverageFromMs: number, nowMs: number): boolean | null {
  if (!points || points.length === 0) return null;
  const first = points[0].atMs, last = points[points.length - 1].atMs;
  if (atMs >= first - GRACE_MS && atMs <= last + GRACE_MS) return true;
  // After its last hour: gone, unless that hour is recent and the frame is
  // simply newer than HMI's pipeline.
  if (atMs > last + GRACE_MS) return nowMs - last < 3 * HOUR ? true : false;
  // Before its first hour. A history that starts where the query started
  // says nothing about before it.
  return first <= coverageFromMs + 2 * HOUR ? null : false;
}

export function regionsAtFrame(o: FrameRegionsOptions): {
  inputs: RegionInput[];
  placedFromHmi: number;
  selectedPreEmergence: boolean;
} {
  const nowMs = o.nowMs ?? Date.now();
  const currentById = new Map(o.current.map((r) => [r.id, r]));
  const ids = new Set<string>([...currentById.keys(), ...Object.keys(o.records ?? {})]);
  const inputs: RegionInput[] = [];
  let placedFromHmi = 0;
  let selectedPreEmergence = false;

  for (const id of ids) {
    const cur = currentById.get(id) ?? null;
    const rec = o.records?.[id] ?? null;
    const points = o.sharp.get(regionKey(id));
    const at = rec ? regionAt(rec, o.atMs) : null;

    const hmi = hmiPresent(points, o.atMs, o.coverageFromMs, nowMs);
    const listed = at ? at.listed : cur != null;
    const present = hmi ?? listed;

    const pos = points ? smoothedPositionAt(points, o.atMs) : null;
    if (!present) {
      // The selected region before it formed: pinned to the patch of surface
      // it emerged from, so its close-up can watch it form.
      if (id === o.selectedId && pos && pos.beforeFirst && cur) {
        selectedPreEmergence = true;
        inputs.push({ ...cur, latitude: pos.latitude, longitude: pos.longitude, observedAtMs: pos.atMs, color: '#a3a3a3' });
      }
      continue;
    }

    // What it was like then: its state at the time, or the nearest thing.
    const state = at?.state ?? rec?.current ?? null;
    const magneticClass = state?.magClass ?? cur?.magneticClass ?? null;
    const spotCount = state?.spotCount ?? cur?.spotCount ?? null;
    const area = state?.areaMsh ?? cur?.area ?? null;
    const colour = state ? o.colourOf(state.magClass, state.mFlareProbability, state.xFlareProbability) : (cur?.color ?? o.colourOf(magneticClass, null, null));
    const base = { id, magneticClass, spotCount, area, color: colour };

    if (pos) {
      placedFromHmi++;
      inputs.push({ ...base, latitude: pos.latitude, longitude: pos.longitude, observedAtMs: pos.atMs });
    } else if (state?.latitude != null && state.longitude != null) {
      // NOAA's position when it was reported, carried by the label code for
      // rotation to the frame's moment.
      inputs.push({ ...base, latitude: state.latitude, longitude: state.longitude, observedAtMs: at?.reportedAtMs ?? rec?.lastSeenMs ?? null });
    } else if (cur) {
      inputs.push({ ...cur, ...base });
    }
  }
  return { inputs, placedFromHmi, selectedPreEmergence };
}
