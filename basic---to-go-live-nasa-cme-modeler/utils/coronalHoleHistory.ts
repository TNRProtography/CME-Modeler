// --- START OF FILE utils/coronalHoleHistory.ts ---
//
// ═══════════════════════════════════════════════════════════════════════
//  CORONAL HOLE HISTORY - Worker-backed 72h CH evolution tracker
// ═══════════════════════════════════════════════════════════════════════
//
//  Uses the ch-history-worker on Cloudflare to store and retrieve
//  timestamped CH detection snapshots. The worker accumulates one
//  snapshot every 2 hours, giving 36 data points over 72 hours.
//
//  CLIENT RESPONSIBILITIES:
//    1. After each live SUVI detection, POST results to the worker
//    2. Fetch the full 72h history from the worker
//    3. Optionally analyse historical SWPC frames for backfill
//    4. Interpolate CH properties for the time-varying HSS ribbon
//
// ═══════════════════════════════════════════════════════════════════════

import type { CoronalHole } from './coronalHoleData';
import { longitudeAt } from './solarDisk';
import { detectCoronalHolesFromSuvi195 } from './suviCoronalHoleDetector';

// ─── Worker endpoint ──────────────────────────────────────────────────
const CH_WORKER_BASE = 'https://ch-history-worker.thenamesrock.workers.dev';

// ─── Types ────────────────────────────────────────────────────────────

export interface CHSnapshotRecord {
  timestamp: string;
  timestampMs: number;
  coronalHoles: CHSnapshotData[];
  source: 'live' | 'historical_frame';
  imageUrl: string;
}

export interface CHSnapshotData {
  id: string;
  lat: number;
  lon: number;
  widthDeg: number;
  heightDeg?: number;
  darkness: number;
  estimatedSpeedKms: number;
  polygon?: Array<{ lat: number; lon: number }>;
}

export interface CHHistoryResult {
  snapshots: CHSnapshotRecord[];
  count: number;
  oldestMs: number | null;
  newestMs: number | null;
  maxHours: number;
}

export interface CHEvolution {
  trackId: string;
  snapshots: {
    timestampMs: number;
    hoursAgo: number;
    ch: CoronalHole | null;
  }[];
  current: CoronalHole;
}

export interface SuviFrameInfo {
  url: string;
  timestamp: string;
  timestampMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────
// Rotation now comes from longitudeAt, which the rest of the app shares.
const CH_MATCH_THRESHOLD_DEG = 25;

// ═══════════════════════════════════════════════════════════════════════
//  WORKER API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Post a CH detection result to the worker for storage.
 * Called after each successful live SUVI detection.
 */
export async function postSnapshotToWorker(
  coronalHoles: CoronalHole[],
  imageUrl: string,
  atMs?: number,
): Promise<boolean> {
  try {
    // The frame's own time, when the caller knows it. Stamping an archived
    // frame with the wall clock would tell the server the holes are newer
    // than they are, which is the one lie the staleness check cannot survive.
    const stampMs = Number.isFinite(atMs) ? (atMs as number) : Date.now();
    const record: CHSnapshotRecord = {
      timestamp: new Date(stampMs).toISOString(),
      timestampMs: stampMs,
      coronalHoles: coronalHoles.map(ch => ({
        id: ch.id,
        lat: ch.lat,
        lon: ch.lon,
        widthDeg: ch.widthDeg,
        heightDeg: ch.heightDeg,
        darkness: ch.darkness,
        estimatedSpeedKms: ch.estimatedSpeedKms,
        polygon: ch.polygon,
      })),
      source: 'live',
      imageUrl,
    };

    const resp = await fetch(`${CH_WORKER_BASE}/ch-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });

    if (!resp.ok) {
      console.warn('[CH History] Failed to post snapshot:', resp.status);
      return false;
    }

    const result = await resp.json();
    console.log('[CH History] Snapshot stored:', (result as any).stored);
    return true;
  } catch (err) {
    console.warn('[CH History] Failed to post snapshot:', err);
    return false;
  }
}

/**
 * Fetch the full 72h CH history from the worker.
 */
export async function fetchHistoryFromWorker(): Promise<CHHistoryResult | null> {
  try {
    const resp = await fetch(`${CH_WORKER_BASE}/ch-history`);
    if (!resp.ok) {
      console.warn('[CH History] Failed to fetch history:', resp.status);
      return null;
    }
    return await resp.json() as CHHistoryResult;
  } catch (err) {
    console.warn('[CH History] Failed to fetch history:', err);
    return null;
  }
}

/**
 * Fetch available SUVI frame URLs from the worker.
 * These are historical frames the client can analyse for backfill.
 */
export async function fetchAvailableFrames(): Promise<SuviFrameInfo[]> {
  try {
    const resp = await fetch(`${CH_WORKER_BASE}/ch-history/frames`);
    if (!resp.ok) return [];
    const data = await resp.json() as { frames: SuviFrameInfo[] };
    return data.frames ?? [];
  } catch {
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  BACKFILL - Analyse historical SWPC frames client-side
// ═══════════════════════════════════════════════════════════════════════

/**
 * Analyse a historical SUVI frame and post the result to the worker.
 * This runs the CH detector in the browser on an older SWPC PNG.
 */
export async function analyseAndPostHistoricalFrame(
  frame: SuviFrameInfo,
): Promise<boolean> {
  try {
    // The frame's own time, not now: the axis tilt the projection needs is
    // the one that applied when the picture was taken.
    const result = await detectCoronalHolesFromSuvi195(frame.url, 0.3, new Date(frame.timestampMs));
    if (!result.succeeded || result.coronalHoles.length === 0) return false;

    const record: CHSnapshotRecord = {
      timestamp: frame.timestamp,
      timestampMs: frame.timestampMs,
      coronalHoles: result.coronalHoles.map(ch => ({
        id: ch.id,
        lat: ch.lat,
        lon: ch.lon,
        widthDeg: ch.widthDeg,
        heightDeg: ch.heightDeg,
        darkness: ch.darkness,
        estimatedSpeedKms: ch.estimatedSpeedKms,
        polygon: ch.polygon,
      })),
      source: 'historical_frame',
      imageUrl: frame.url,
    };

    const resp = await fetch(`${CH_WORKER_BASE}/ch-history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });

    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Backfill: analyse available SWPC frames that aren't yet in the history.
 * Runs sequentially to avoid hammering the network.
 *
 * @param existingTimestamps  Set of timestamps (ms) already in history
 * @param onProgress          Progress callback (0–1)
 * @returns                   Number of frames successfully backfilled
 */
export async function backfillFromAvailableFrames(
  existingTimestamps: Set<number>,
  onProgress?: (progress: number) => void,
): Promise<number> {
  const frames = await fetchAvailableFrames();
  if (frames.length === 0) return 0;

  // Filter to frames not already stored (within 30 min tolerance)
  const TOLERANCE_MS = 30 * 60 * 1000;
  const needsBackfill = frames.filter(f => {
    for (const existing of existingTimestamps) {
      if (Math.abs(f.timestampMs - existing) < TOLERANCE_MS) return false;
    }
    return true;
  });

  let filled = 0;
  for (let i = 0; i < needsBackfill.length; i++) {
    onProgress?.((i + 1) / needsBackfill.length);
    const ok = await analyseAndPostHistoricalFrame(needsBackfill[i]);
    if (ok) filled++;
    // Small delay between frames to avoid overwhelming the browser
    await new Promise(r => setTimeout(r, 500));
  }

  return filled;
}

// ═══════════════════════════════════════════════════════════════════════
//  CH MATCHING & EVOLUTION TRACKING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert worker snapshot data to CoronalHole objects.
 */
function snapshotDataToCH(data: CHSnapshotData): CoronalHole {
  return {
    id: data.id,
    lat: data.lat,
    lon: data.lon,
    widthDeg: data.widthDeg,
    heightDeg: data.heightDeg,
    darkness: data.darkness,
    estimatedSpeedKms: data.estimatedSpeedKms,
    polygon: data.polygon,
    sourceDirectionDeg: { lat: data.lat, lon: data.lon },
    expansionHalfAngleDeg: (data.widthDeg ?? 15) * 0.6,
    opacity: 0.5 + data.darkness * 0.3,
    hssVisible: true,
    animPhase: 0,
  };
}

/**
 * Build evolution tracks from worker history, matching CHs across
 * snapshots by proximity + solar rotation correction.
 */
export function buildEvolutionTracks(
  history: CHHistoryResult,
  currentCHs: CoronalHole[],
  now: number = Date.now(),
): CHEvolution[] {
  if (history.snapshots.length === 0) return [];
  const open = openTracks(history, currentCHs, now);
  return [...open, ...closedTracks(history, currentCHs, now)];
}

/** Sightings needed before a hole that has since closed gets a track. */
const CLOSED_MIN_SIGHTINGS = 2;

/**
 * Holes the history saw that are not open now.
 *
 * Without these a hole that closed simply vanished, stream and all, the
 * moment it stopped being detected - its wind was still out there and still
 * on its way. Anything that lands near an open hole is left to that hole's
 * track (the detector sometimes splits one hole in two), and a hole needs a
 * couple of sightings so that one noisy frame does not become a stream.
 */
function closedTracks(history: CHHistoryResult, currentCHs: CoronalHole[], now: number): CHEvolution[] {
  type Group = { lon: number; lat: number; sightings: { timestampMs: number; ch: CoronalHole }[] };
  const groups: Group[] = [];
  const snaps = [...history.snapshots].sort((a, b) => b.timestampMs - a.timestampMs);   // newest first
  for (const snap of snaps) {
    for (const chData of snap.coronalHoles) {
      const lon = longitudeAt(chData.lon, snap.timestampMs, now);
      const near = (a: { lon: number; lat: number }) =>
        Math.hypot(lon - a.lon, chData.lat - a.lat) < CH_MATCH_THRESHOLD_DEG;
      if (currentCHs.some(near)) continue;
      let group = groups.find(near);
      if (!group) {
        group = { lon, lat: chData.lat, sightings: [] };
        groups.push(group);
      }
      if (group.sightings.some((x) => x.timestampMs === snap.timestampMs)) continue;
      group.sightings.push({ timestampMs: snap.timestampMs, ch: snapshotDataToCH(chData) });
    }
  }
  return groups
    .filter((g) => g.sightings.length >= CLOSED_MIN_SIGHTINGS)
    .map((g, n) => {
      const sightings = [...g.sightings].sort((a, b) => a.timestampMs - b.timestampMs);
      const last = sightings[sightings.length - 1];
      const id = `Closed CH ${n + 1}`;
      return {
        trackId: id,
        snapshots: sightings.map(({ timestampMs, ch }) => ({
          timestampMs,
          hoursAgo: (now - timestampMs) / 3600000,
          ch: { ...ch, id },
        })),
        current: { ...last.ch, id },
      };
    });
}

function openTracks(history: CHHistoryResult, currentCHs: CoronalHole[], now: number): CHEvolution[] {
  return currentCHs.map(currentCH => {
    const evolution: CHEvolution = {
      trackId: currentCH.id,
      snapshots: [],
      current: currentCH,
    };

    let matchCount = 0;

    // For each historical snapshot, find the matching CH.
    //
    // IMPORTANT: the SUVI detector does NOT output Carrington coordinates,
    // whatever the old comment here said. pixelToHG measures longitude from
    // the centre of the disk, so it is Stonyhurst - fixed to the Earth-facing
    // direction, not to the Sun's surface - and a hole's longitude therefore
    // climbs about 13.2 degrees a day as the Sun turns.
    //
    // Matching on the raw value against a 25 degree threshold meant a snapshot
    // two days old was already 26 degrees adrift and could not match itself,
    // while one a day old could match a *neighbouring* hole more closely than
    // its own earlier self. So each historical longitude is carried forward to
    // now before being compared.
    for (const snap of history.snapshots) {
      const hoursAgo = (now - snap.timestampMs) / (3600 * 1000);

      let bestMatch: CoronalHole | null = null;
      let bestDist = CH_MATCH_THRESHOLD_DEG;

      for (const chData of snap.coronalHoles) {
        // Where that measurement would sit on today's disk.
        const projectedLon = longitudeAt(chData.lon, snap.timestampMs, now);
        const dLon = Math.abs(projectedLon - currentCH.lon);
        const dLat = Math.abs(chData.lat - currentCH.lat);
        const dist = Math.sqrt(dLon * dLon + dLat * dLat);
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = snapshotDataToCH(chData);
        }
      }

      if (bestMatch) matchCount++;

      evolution.snapshots.push({
        timestampMs: snap.timestampMs,
        hoursAgo,
        ch: bestMatch,
      });
    }

    // Add the current detection as the latest snapshot
    evolution.snapshots.push({
      timestampMs: now,
      hoursAgo: 0,
      ch: currentCH,
    });

    // Sort oldest first
    evolution.snapshots.sort((a, b) => a.timestampMs - b.timestampMs);

    console.log(
      `[CH History] Track ${currentCH.id}: matched ${matchCount}/${history.snapshots.length} snapshots, ` +
      `${evolution.snapshots.length} total points`
    );

    return evolution;
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  INTERPOLATION - for time-varying HSS and CH animation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Get interpolated CH properties at a specific absolute time (ms since epoch).
 *
 * Searches the evolution snapshots for the two that bracket the target time,
 * then linearly interpolates all CH properties between them.
 *
 * This replaces the old hoursAgo-based interpolation which was broken because
 * hoursAgo was relative to when buildEvolutionTracks ran, not to the query time.
 */
export function interpolateCHAtTimeMs(
  evolution: CHEvolution,
  targetTimeMs: number,
): {
  widthDeg: number;
  heightDeg: number;
  darkness: number;
  lat: number;
  lon: number;
  estimatedSpeedKms: number;
} | null {
  const snaps = evolution.snapshots;
  if (snaps.length === 0) return null;

  // Snapshots are sorted oldest-first (ascending timestampMs).
  // Find the two that bracket targetTimeMs.
  //
  //   [snap0]---[snap1]---[snap2]---*target*---[snap3]---[snap4]
  //                        ^before              ^after

  let beforeIdx = -1;
  let afterIdx  = -1;

  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].timestampMs <= targetTimeMs) {
      beforeIdx = i;  // Keep updating - we want the latest one before target
    }
    if (snaps[i].timestampMs >= targetTimeMs && afterIdx === -1) {
      afterIdx = i;   // First one after target
    }
  }

  // Edge cases: target is before all snapshots or after all
  if (beforeIdx === -1 && afterIdx === -1) return null;
  if (beforeIdx === -1) beforeIdx = afterIdx;
  if (afterIdx === -1)  afterIdx = beforeIdx;

  const snapBefore = snaps[beforeIdx];
  const snapAfter  = snaps[afterIdx];
  const chBefore = snapBefore.ch;
  const chAfter  = snapAfter.ch;

  // The immediate brackets may have null CH data (detector missed this CH
  // in that snapshot). Instead of jumping to evolution.current (which
  // causes teleporting), search outward from each bracket for the nearest
  // non-null snapshot. This gives smooth interpolation across gaps.

  // Search backward from beforeIdx for nearest non-null
  let resolvedBefore: CoronalHole | null = null;
  let resolvedBeforeMs = snapBefore.timestampMs;
  for (let i = beforeIdx; i >= 0; i--) {
    if (snaps[i].ch !== null) {
      resolvedBefore = snaps[i].ch;
      resolvedBeforeMs = snaps[i].timestampMs;
      break;
    }
  }

  // Search forward from afterIdx for nearest non-null
  let resolvedAfter: CoronalHole | null = null;
  let resolvedAfterMs = snapAfter.timestampMs;
  for (let i = afterIdx; i < snaps.length; i++) {
    if (snaps[i].ch !== null) {
      resolvedAfter = snaps[i].ch;
      resolvedAfterMs = snaps[i].timestampMs;
      break;
    }
  }

  // If no non-null data exists anywhere - nothing to show
  if (!resolvedBefore && !resolvedAfter) return null;

  // Only one side has data - use it directly (pin to it)
  if (!resolvedBefore || !resolvedAfter) {
    const single = resolvedBefore ?? resolvedAfter!;
    return {
      widthDeg: single.widthDeg ?? 15,
      heightDeg: single.heightDeg ?? single.widthDeg ?? 15,
      darkness: single.darkness,
      lat: single.lat,
      lon: single.lon,
      estimatedSpeedKms: single.estimatedSpeedKms,
    };
  }

  // Both sides have data - interpolate smoothly between them
  // This spans across any null gaps, so motion is continuous
  const range = resolvedAfterMs - resolvedBeforeMs;
  const t = range > 0 ? (targetTimeMs - resolvedBeforeMs) / range : 0;
  const tClamped = Math.max(0, Math.min(1, t));
  const lerp = (a: number, b: number) => a + tClamped * (b - a);

  return {
    widthDeg: lerp(resolvedBefore.widthDeg ?? 15, resolvedAfter.widthDeg ?? 15),
    heightDeg: lerp(
      resolvedBefore.heightDeg ?? resolvedBefore.widthDeg ?? 15,
      resolvedAfter.heightDeg ?? resolvedAfter.widthDeg ?? 15,
    ),
    darkness: lerp(resolvedBefore.darkness, resolvedAfter.darkness),
    lat: lerp(resolvedBefore.lat, resolvedAfter.lat),
    lon: lerp(resolvedBefore.lon, resolvedAfter.lon),
    estimatedSpeedKms: lerp(resolvedBefore.estimatedSpeedKms, resolvedAfter.estimatedSpeedKms),
  };
}

/**
 * Legacy wrapper - converts hoursAgo to absolute timestamp and calls
 * interpolateCHAtTimeMs. Used by any code still passing hoursAgo.
 */
export function interpolateCHAtTime(
  evolution: CHEvolution,
  hoursAgo: number,
): ReturnType<typeof interpolateCHAtTimeMs> {
  const targetMs = Date.now() - hoursAgo * 3600 * 1000;
  return interpolateCHAtTimeMs(evolution, targetMs);
}

/**
 * Get a morphed CoronalHole for animating the patch on the Sun
 * at a specific timeline time.
 */
export function getCHAtTimelineTime(
  evolution: CHEvolution,
  absoluteMs: number,
): CoronalHole {
  const interpolated = interpolateCHAtTimeMs(evolution, absoluteMs);
  if (!interpolated) return evolution.current;

  const current = evolution.current;

  return {
    ...current,
    widthDeg: interpolated.widthDeg,
    heightDeg: interpolated.heightDeg,
    darkness: interpolated.darkness,
    lat: interpolated.lat,
    lon: interpolated.lon,
    estimatedSpeedKms: interpolated.estimatedSpeedKms,
    polygon: current.polygon?.map(p => ({
      lat: p.lat,
      lon: p.lon,
    })),
  };
}

// --- END OF FILE utils/coronalHoleHistory.ts ---
// ─── Was it there at all? ─────────────────────────────────────────────────

/**
 * How long a hole is still drawn after its last measurement.
 *
 * The detector misses a hole in maybe one frame in ten - a faint frame, a bit
 * of disk washed out by a flare, a shape momentarily under the area threshold
 * - and frames come every couple of hours. Without a grace period, scrubbing
 * the timeline makes holes blink in and out, which reads as the app being
 * broken rather than as the detector being imperfect. Two cadences is enough
 * to bridge a miss without keeping a closed hole on screen for a day.
 */
export const CH_PRESENCE_GRACE_MS = 4 * 3600000;

/** The span a track was actually measured over, ignoring frames it was missed in. */
export function chMeasuredSpan(
  evolution: CHEvolution,
): { firstMs: number; lastMs: number } | null {
  let firstMs = Infinity;
  let lastMs = -Infinity;
  for (const snap of evolution.snapshots) {
    if (!snap.ch) continue;
    if (snap.timestampMs < firstMs) firstMs = snap.timestampMs;
    if (snap.timestampMs > lastMs) lastMs = snap.timestampMs;
  }
  return Number.isFinite(firstMs) ? { firstMs, lastMs } : null;
}

/**
 * Whether this hole existed at a given moment.
 *
 * interpolateCHAtTimeMs cannot answer this: asked for a time outside the
 * track it pins to the nearest measurement and returns a position, which is
 * the right behaviour for smoothing across a gap and the wrong one for
 * history. Scrubbing back a week would otherwise show today's holes on last
 * Tuesday's Sun, including ones that had not opened yet.
 */
export function chWasPresentAt(
  evolution: CHEvolution,
  atMs: number,
  graceMs = CH_PRESENCE_GRACE_MS,
): boolean {
  const span = chMeasuredSpan(evolution);
  if (!span) return false;
  return atMs >= span.firstMs - graceMs && atMs <= span.lastMs + graceMs;
}

/**
 * A hole's state at a moment, with its longitude expressed in one fixed frame.
 *
 * Every stored longitude is Stonyhurst AT ITS OWN SNAPSHOT TIME, so the same
 * unmoving hole has a different number in every snapshot - it climbs about
 * 13.2 degrees a day as the Sun turns. Interpolating those raw values and
 * then carrying the result forward from the QUERY time works only while the
 * query lands inside the track. Outside it, interpolateCHAtTimeMs pins to the
 * nearest measurement, so the longitude stops advancing while the correction
 * keeps growing - which subtracts the Sun's rotation from a hole that was
 * already rotating with it, and freezes it in space while the Sun turns
 * underneath.
 *
 * Carrying each snapshot into the target frame BEFORE interpolating has no
 * such seam: a hole that has not drifted has the same number in every
 * snapshot, so interpolating and pinning give the same answer, and the only
 * thing left in the result is the hole's own motion across the disk.
 */
export function chStateAtInFrame(
  evolution: CHEvolution,
  atMs: number,
  frameMs: number,
): ReturnType<typeof interpolateCHAtTimeMs> {
  return interpolateCHAtTimeMs(anchorEvolution(evolution, frameMs), atMs);
}

/**
 * The whole track carried into one fixed frame, for callers that ask it about
 * many moments - chStateAtInFrame does this afresh on every call.
 */
export function anchorEvolution(evolution: CHEvolution, frameMs: number): CHEvolution {
  return {
    ...evolution,
    snapshots: evolution.snapshots.map((snap) => ({
      ...snap,
      ch: snap.ch
        ? { ...snap.ch, lon: longitudeAt(snap.ch.lon, snap.timestampMs, frameMs) }
        : null,
    })),
  };
}
