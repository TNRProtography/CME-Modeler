// --- START OF FILE utils/coronalHoleHistory.ts ---
//
// ═══════════════════════════════════════════════════════════════════════
//  CORONAL HOLE HISTORY — Worker-backed 72h CH evolution tracker
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

import { CoronalHole } from './coronalHoleData';
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
const SUN_SYNODIC_DEG_PER_HOUR = 13.2 / 24;
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
): Promise<boolean> {
  try {
    const record: CHSnapshotRecord = {
      timestamp: new Date().toISOString(),
      timestampMs: Date.now(),
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
//  BACKFILL — Analyse historical SWPC frames client-side
// ═══════════════════════════════════════════════════════════════════════

/**
 * Analyse a historical SUVI frame and post the result to the worker.
 * This runs the CH detector in the browser on an older SWPC PNG.
 */
export async function analyseAndPostHistoricalFrame(
  frame: SuviFrameInfo,
): Promise<boolean> {
  try {
    const result = await detectCoronalHolesFromSuvi195(frame.url);
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
): CHEvolution[] {
  if (history.snapshots.length === 0) return [];

  const now = Date.now();

  return currentCHs.map(currentCH => {
    const evolution: CHEvolution = {
      trackId: currentCH.id,
      snapshots: [],
      current: currentCH,
    };

    let matchCount = 0;

    // For each historical snapshot, find the matching CH.
    //
    // IMPORTANT: SUVI detector outputs Carrington coordinates which are
    // fixed to the Sun's surface. A CH at lon=45° stays near lon=45°
    // across snapshots (with small drift from physical evolution).
    // NO solar rotation correction is needed.
    for (const snap of history.snapshots) {
      const hoursAgo = (now - snap.timestampMs) / (3600 * 1000);

      let bestMatch: CoronalHole | null = null;
      let bestDist = CH_MATCH_THRESHOLD_DEG;

      for (const chData of snap.coronalHoles) {
        // Simple proximity match in Carrington coordinates
        const dLon = Math.abs(chData.lon - currentCH.lon);
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
//  INTERPOLATION — for time-varying HSS and CH animation
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
      beforeIdx = i;  // Keep updating — we want the latest one before target
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

  // If no non-null data exists anywhere — nothing to show
  if (!resolvedBefore && !resolvedAfter) return null;

  // Only one side has data — use it directly (pin to it)
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

  // Both sides have data — interpolate smoothly between them
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
 * Legacy wrapper — converts hoursAgo to absolute timestamp and calls
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