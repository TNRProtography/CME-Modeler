// --- START OF FILE utils/coronalHoleHistory.ts ---
//
// ═══════════════════════════════════════════════════════════════════════
//  CORONAL HOLE HISTORY TRACKER
//  3-day CH evolution for time-varying HSS simulation
// ═══════════════════════════════════════════════════════════════════════
//
//  CONCEPT
//  ───────
//  The HSS at 1 AU right now was emitted ~3–4 days ago from a CH that
//  may have looked very different. This module tracks how each CH has
//  evolved over the past 3 days, enabling:
//
//    1. A time-varying HSS ribbon where each radial slice carries the
//       CH properties (width, darkness, lat extent) from the moment
//       that slice of wind was actually emitted.
//
//    2. Animated CH patch morphing on the Sun when the timeline is
//       scrubbed — the CH visually grows/shrinks/shifts as it was
//       observed at different times.
//
//  DATA SOURCES
//  ─────────────
//  • SWPC animation directory: individual timestamped SUVI 195 frames
//    at ~4-min cadence, retained for ~24 hours.
//    URL: https://services.swpc.noaa.gov/images/animations/suvi/primary/195/
//
//  • For the 24–72h lookback, we use SOLAR ROTATION EXTRAPOLATION:
//    the Sun rotates ~13.2°/day (synodic). A CH detected now at lon X
//    was at lon (X + 13.2 * daysAgo) in the past. We adjust the CH's
//    disk-centre-relative properties for foreshortening at that
//    earlier longitude.
//
//  STRATEGY (6 snapshots, every 12 hours over 3 days)
//  ──────────────────────────────────────────────────
//  Snapshot 0: NOW            — current live SUVI detection (already have)
//  Snapshot 1: -12h           — from SWPC animation directory
//  Snapshot 2: -24h           — from SWPC animation directory (edge of retention)
//  Snapshot 3: -36h           — rotation-extrapolated from snapshot 2
//  Snapshot 4: -48h           — rotation-extrapolated from snapshot 1
//  Snapshot 5: -60h (~2.5d)   — rotation-extrapolated from snapshot 0
//
//  Each snapshot produces a CoronalHole[] array. We match CHs across
//  snapshots by proximity (centroid distance < threshold) to track
//  the same physical CH over time.
//
// ═══════════════════════════════════════════════════════════════════════

import { CoronalHole } from './coronalHoleData';
import { detectCoronalHolesFromSuvi195 } from './suviCoronalHoleDetector';

// ─── Constants ────────────────────────────────────────────────────────
const SUVI_ANIM_BASE = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/';
const SUN_SYNODIC_DEG_PER_DAY = 13.2;  // degrees/day (synodic rotation)
const SUN_SYNODIC_DEG_PER_HOUR = SUN_SYNODIC_DEG_PER_DAY / 24;
const SNAPSHOT_COUNT = 6;
const SNAPSHOT_INTERVAL_HOURS = 12;
const CH_MATCH_THRESHOLD_DEG = 20;  // max centroid distance to consider same CH

// ─── Types ────────────────────────────────────────────────────────────

/** A single snapshot of CH state at a specific time */
export interface CHSnapshot {
  /** When this observation was taken (ms since epoch) */
  timestampMs: number;
  /** Hours before present (0 = now, 12, 24, 36, 48, 60) */
  hoursAgo: number;
  /** Detected coronal holes at this time */
  coronalHoles: CoronalHole[];
  /** Whether this was from real imagery or rotation-extrapolated */
  source: 'live' | 'historical_image' | 'rotation_extrapolated';
}

/** Time-resolved evolution of a single physical coronal hole */
export interface CHEvolution {
  /** Stable ID for this physical CH across snapshots */
  trackId: string;
  /** The CH's properties at each snapshot time (oldest first) */
  snapshots: {
    timestampMs: number;
    hoursAgo: number;
    /** The CH data at this time — null if not detected (behind limb, etc.) */
    ch: CoronalHole | null;
  }[];
  /** The current (latest) detection */
  current: CoronalHole;
}

/** Full history result */
export interface CHHistoryResult {
  /** Individual snapshots (newest first) */
  snapshots: CHSnapshot[];
  /** Per-CH evolution tracks (matched across snapshots) */
  evolutions: CHEvolution[];
  /** When history was built */
  builtAt: Date;
  /** Loading progress (0–1) */
  progress: number;
}

// ─── SWPC Directory Parser ────────────────────────────────────────────

/**
 * Parse the SWPC animation directory listing to find SUVI 195 frame URLs
 * with timestamps. Returns sorted by time (newest first).
 */
async function fetchSuviFrameList(): Promise<{ url: string; timestamp: Date }[]> {
  try {
    const resp = await fetch(SUVI_ANIM_BASE);
    if (!resp.ok) return [];
    const html = await resp.text();

    // Parse filenames like: or_suvi-l2-ci195_g19_s20260106T154000Z_e...
    const frameRegex = /href="(or_suvi-l2-ci195_g\d+_s(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z_[^"]+\.png)"/g;
    const frames: { url: string; timestamp: Date }[] = [];
    let match;

    while ((match = frameRegex.exec(html)) !== null) {
      const [, filename, yr, mo, dy, hr, mi, sc] = match;
      const timestamp = new Date(`${yr}-${mo}-${dy}T${hr}:${mi}:${sc}Z`);
      if (!isNaN(timestamp.getTime())) {
        frames.push({
          url: SUVI_ANIM_BASE + filename,
          timestamp,
        });
      }
    }

    // Sort newest first
    frames.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    return frames;
  } catch (err) {
    console.warn('[CH History] Failed to fetch SUVI frame list:', err);
    return [];
  }
}

/**
 * Find the SUVI frame closest to a target time.
 */
function findClosestFrame(
  frames: { url: string; timestamp: Date }[],
  targetMs: number,
  maxDeltaMs: number = 4 * 3600 * 1000,  // max 4h tolerance
): { url: string; timestamp: Date } | null {
  let best: (typeof frames)[0] | null = null;
  let bestDelta = Infinity;

  for (const frame of frames) {
    const delta = Math.abs(frame.timestamp.getTime() - targetMs);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = frame;
    }
  }

  return best && bestDelta <= maxDeltaMs ? best : null;
}

// ─── Rotation Extrapolation ───────────────────────────────────────────

/**
 * Extrapolate a CH backward in time by applying solar rotation.
 *
 * A CH currently at disk-centre-relative longitude X was at
 * longitude (X + rotation_rate * hours_ago) in the past.
 *
 * We also adjust the apparent width for foreshortening:
 * a CH near the limb (|lon| > 60°) appears narrower due to
 * projection effects.
 */
function extrapolateCH(
  ch: CoronalHole,
  hoursAgo: number,
): CoronalHole | null {
  const rotationDeg = SUN_SYNODIC_DEG_PER_HOUR * hoursAgo;
  const pastLon = ch.lon + rotationDeg;

  // If the CH was behind the limb at that time, it wasn't emitting
  // Earth-directed wind — return null
  if (Math.abs(pastLon) > 80) return null;

  // Foreshortening: apparent width shrinks as cos(lon)
  const foreshortenCurrent = Math.cos(ch.lon * Math.PI / 180);
  const foreshortenPast = Math.cos(pastLon * Math.PI / 180);
  const foreshortenRatio = foreshortenCurrent > 0.01
    ? foreshortenPast / foreshortenCurrent
    : 1.0;

  // Reconstruct the CH at its past position
  const pastCh: CoronalHole = {
    ...ch,
    id: `${ch.id}_t-${hoursAgo}h`,
    lon: pastLon,
    // Width: de-foreshorten the current measurement, then re-foreshorten at past lon
    widthDeg: Math.max(3, (ch.widthDeg ?? 15) * Math.abs(foreshortenRatio)),
    // Height doesn't change much with longitude
    heightDeg: ch.heightDeg,
    // Darkness might vary slightly — CHs can evolve over 3 days
    // Apply a mild uncertainty factor
    darkness: ch.darkness * (1.0 - 0.05 * hoursAgo / 12),
    // Speed estimate follows from width
    estimatedSpeedKms: ch.estimatedSpeedKms,
    // Polygon: shift each point by the rotation amount
    polygon: ch.polygon?.map(p => ({
      lat: p.lat,
      lon: p.lon,  // relative to centroid — stays the same
    })),
  };

  return pastCh;
}

// ─── CH Matching Across Snapshots ─────────────────────────────────────

/**
 * Match coronal holes between two snapshots based on centroid proximity,
 * accounting for solar rotation between the timestamps.
 */
function matchCHs(
  chsNow: CoronalHole[],
  chsPast: CoronalHole[],
  hoursBetween: number,
): Map<string, string> {
  // Map: current CH id → past CH id
  const matches = new Map<string, string>();
  const rotationDeg = SUN_SYNODIC_DEG_PER_HOUR * hoursBetween;
  const usedPast = new Set<string>();

  for (const chNow of chsNow) {
    let bestMatch: string | null = null;
    let bestDist = CH_MATCH_THRESHOLD_DEG;

    for (const chPast of chsPast) {
      if (usedPast.has(chPast.id)) continue;

      // The past CH should be at lon + rotation relative to current
      const expectedPastLon = chNow.lon + rotationDeg;
      const dLon = Math.abs(chPast.lon - expectedPastLon);
      const dLat = Math.abs(chPast.lat - chNow.lat);
      const dist = Math.sqrt(dLon * dLon + dLat * dLat);

      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = chPast.id;
      }
    }

    if (bestMatch) {
      matches.set(chNow.id, bestMatch);
      usedPast.add(bestMatch);
    }
  }

  return matches;
}

// ═══════════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Build a 3-day CH evolution history.
 *
 * @param currentCHs  The current live detection (from useCoronalHoles)
 * @param onProgress  Callback for loading progress (0–1)
 * @returns           CHHistoryResult with snapshots and evolution tracks
 */
export async function buildCHHistory(
  currentCHs: CoronalHole[],
  onProgress?: (progress: number) => void,
): Promise<CHHistoryResult> {
  const now = Date.now();
  const snapshots: CHSnapshot[] = [];

  // Snapshot 0: NOW (already have detection)
  snapshots.push({
    timestampMs: now,
    hoursAgo: 0,
    coronalHoles: currentCHs,
    source: 'live',
  });
  onProgress?.(0.1);

  // ── Fetch historical SUVI frames from SWPC directory ──────────────
  const frames = await fetchSuviFrameList();
  onProgress?.(0.2);

  // Snapshot 1: -12h (from SWPC directory if available)
  const target12h = now - 12 * 3600 * 1000;
  const frame12h = findClosestFrame(frames, target12h);
  if (frame12h) {
    try {
      const result = await detectCoronalHolesFromSuvi195(frame12h.url);
      if (result.succeeded && result.coronalHoles.length > 0) {
        snapshots.push({
          timestampMs: frame12h.timestamp.getTime(),
          hoursAgo: 12,
          coronalHoles: result.coronalHoles,
          source: 'historical_image',
        });
      }
    } catch (err) {
      console.warn('[CH History] Failed to analyse -12h frame:', err);
    }
  }
  onProgress?.(0.4);

  // Snapshot 2: -24h (from SWPC directory — edge of retention)
  const target24h = now - 24 * 3600 * 1000;
  const frame24h = findClosestFrame(frames, target24h);
  if (frame24h) {
    try {
      const result = await detectCoronalHolesFromSuvi195(frame24h.url);
      if (result.succeeded && result.coronalHoles.length > 0) {
        snapshots.push({
          timestampMs: frame24h.timestamp.getTime(),
          hoursAgo: 24,
          coronalHoles: result.coronalHoles,
          source: 'historical_image',
        });
      }
    } catch (err) {
      console.warn('[CH History] Failed to analyse -24h frame:', err);
    }
  }
  onProgress?.(0.6);

  // Snapshots 3–5: Rotation-extrapolated from current detection
  // These cover the -36h to -60h range where SWPC frames aren't retained
  for (let i = 3; i < SNAPSHOT_COUNT; i++) {
    const hoursAgo = i * SNAPSHOT_INTERVAL_HOURS;
    const extrapolated = currentCHs
      .map(ch => extrapolateCH(ch, hoursAgo))
      .filter((ch): ch is CoronalHole => ch !== null);

    if (extrapolated.length > 0) {
      snapshots.push({
        timestampMs: now - hoursAgo * 3600 * 1000,
        hoursAgo,
        coronalHoles: extrapolated,
        source: 'rotation_extrapolated',
      });
    }
  }
  onProgress?.(0.8);

  // ── Sort snapshots oldest first ────────────────────────────────────
  snapshots.sort((a, b) => a.timestampMs - b.timestampMs);

  // ── Build evolution tracks ─────────────────────────────────────────
  // Start from the current detection and trace each CH backward
  const evolutions: CHEvolution[] = currentCHs.map(ch => {
    const track: CHEvolution = {
      trackId: ch.id,
      snapshots: [],
      current: ch,
    };

    // For each snapshot, find the matching CH
    for (const snap of snapshots) {
      if (snap.hoursAgo === 0) {
        // Current — direct match
        track.snapshots.push({
          timestampMs: snap.timestampMs,
          hoursAgo: snap.hoursAgo,
          ch: ch,
        });
      } else {
        // Historical — find by proximity with rotation correction
        const matches = matchCHs([ch], snap.coronalHoles, snap.hoursAgo);
        const matchedId = matches.get(ch.id);
        const matchedCH = matchedId
          ? snap.coronalHoles.find(c => c.id === matchedId) ?? null
          : null;
        track.snapshots.push({
          timestampMs: snap.timestampMs,
          hoursAgo: snap.hoursAgo,
          ch: matchedCH,
        });
      }
    }

    return track;
  });

  onProgress?.(1.0);

  return {
    snapshots,
    evolutions,
    builtAt: new Date(),
    progress: 1.0,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  HSS PROPERTY INTERPOLATION
// ═══════════════════════════════════════════════════════════════════════
//
//  Given a CHEvolution and a "time ago" value (how long ago the wind
//  at a given radial distance was emitted), return the interpolated
//  CH properties (width, darkness, lat extent) for that emission time.
//
//  This is used by the spiral geometry builder: each radial slice of
//  the HSS tube is sized according to what the CH looked like when
//  that slice of wind was actually emitted.

/**
 * Get interpolated CH properties for wind emitted `hoursAgo` hours
 * before present.
 *
 * @param evolution   The CH's tracked evolution
 * @param hoursAgo    How many hours before present this wind was emitted
 * @returns           Interpolated CH properties, or null if CH wasn't
 *                    visible at that time
 */
export function interpolateCHAtTime(
  evolution: CHEvolution,
  hoursAgo: number,
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

  // Find the two bracketing snapshots
  let before: typeof snaps[0] | null = null;
  let after: typeof snaps[0] | null = null;

  for (let i = 0; i < snaps.length; i++) {
    if (snaps[i].hoursAgo <= hoursAgo) {
      after = snaps[i];
    }
    if (snaps[i].hoursAgo >= hoursAgo && !before) {
      before = snaps[i];
    }
  }

  // If hoursAgo is beyond our history range, use the nearest
  if (!before && !after) return null;
  if (!before) before = after;
  if (!after) after = before;
  if (!before || !after) return null;

  const chBefore = before.ch;
  const chAfter = after.ch;

  // If neither bracket has a detection, the CH wasn't visible
  if (!chBefore && !chAfter) return null;

  // If only one bracket has data, use it directly
  if (!chBefore && chAfter) return {
    widthDeg: chAfter.widthDeg ?? 15,
    heightDeg: chAfter.heightDeg ?? chAfter.widthDeg ?? 15,
    darkness: chAfter.darkness,
    lat: chAfter.lat,
    lon: chAfter.lon,
    estimatedSpeedKms: chAfter.estimatedSpeedKms,
  };
  if (chBefore && !chAfter) return {
    widthDeg: chBefore.widthDeg ?? 15,
    heightDeg: chBefore.heightDeg ?? chBefore.widthDeg ?? 15,
    darkness: chBefore.darkness,
    lat: chBefore.lat,
    lon: chBefore.lon,
    estimatedSpeedKms: chBefore.estimatedSpeedKms,
  };

  // Both brackets have data — interpolate
  const range = after.hoursAgo - before.hoursAgo;
  const t = range > 0 ? (hoursAgo - before.hoursAgo) / range : 0;

  const lerp = (a: number, b: number) => a + t * (b - a);

  return {
    widthDeg: lerp(chBefore!.widthDeg ?? 15, chAfter!.widthDeg ?? 15),
    heightDeg: lerp(
      chBefore!.heightDeg ?? chBefore!.widthDeg ?? 15,
      chAfter!.heightDeg ?? chAfter!.widthDeg ?? 15,
    ),
    darkness: lerp(chBefore!.darkness, chAfter!.darkness),
    lat: lerp(chBefore!.lat, chAfter!.lat),
    lon: lerp(chBefore!.lon, chAfter!.lon),
    estimatedSpeedKms: lerp(chBefore!.estimatedSpeedKms, chAfter!.estimatedSpeedKms),
  };
}

/**
 * Get the CH shape (polygon or ellipse params) at a specific timeline
 * time, for animating the CH patch on the Sun surface.
 *
 * @param evolution    The CH's tracked evolution
 * @param absoluteMs   The absolute time to show
 * @returns            A CoronalHole with interpolated properties
 */
export function getCHAtTimelineTime(
  evolution: CHEvolution,
  absoluteMs: number,
): CoronalHole {
  const hoursAgo = (Date.now() - absoluteMs) / (3600 * 1000);
  const interpolated = interpolateCHAtTime(evolution, Math.max(0, hoursAgo));

  if (!interpolated) return evolution.current;

  // Build a synthetic CoronalHole with interpolated properties
  // but preserve the polygon shape (morphing the polygon would require
  // point-by-point interpolation which is expensive; instead we scale)
  const current = evolution.current;
  const widthScale = interpolated.widthDeg / (current.widthDeg ?? 15);
  const heightScale = interpolated.heightDeg / (current.heightDeg ?? current.widthDeg ?? 15);

  return {
    ...current,
    widthDeg: interpolated.widthDeg,
    heightDeg: interpolated.heightDeg,
    darkness: interpolated.darkness,
    lat: interpolated.lat,
    estimatedSpeedKms: interpolated.estimatedSpeedKms,
    // Scale the polygon if present
    polygon: current.polygon?.map(p => ({
      lat: p.lat * heightScale,
      lon: p.lon * widthScale,
    })),
  };
}

// --- END OF FILE utils/coronalHoleHistory.ts ---