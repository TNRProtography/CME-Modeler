// The 90-day coronal hole record as the 3D scene takes it: one evolution per
// hole, a snapshot per sighting, each carrying the outline measured then. So
// scrubbing the CME Visualization's timeline shows every hole as it was at
// that moment - its shape, its size, whether it had opened yet, and gone once
// it closed, merged or turned off the disk - under the same numbers as the
// Coronal Hole Tracker.

import type { CoronalHole } from './coronalHoleData';
import type { CHEvolution } from './coronalHoleHistory';
import { decodeOutline } from './chOutline';
import { LIVE_GRACE_MS } from './chTracking';
import type { ChLife, ChLifecycle, ChSighting } from './chLifecycle';

const DAY = 86400000;

/** A hole's evolution, marked when it is still open at the newest frame. */
export interface LifecycleEvolution extends CHEvolution {
  /** Still on the disk: draw it on past its last sighting, while it faces us. */
  openEnded: boolean;
}

export function sightingToHole(id: string, s: ChSighting, index: number): CoronalHole {
  const widthDeg = Math.max(5, s.widthDeg);
  const polygon = decodeOutline(s.outline) ?? undefined;
  return {
    id,
    lat: s.lat,
    lon: s.lon,
    widthDeg,
    heightDeg: Math.max(5, s.heightDeg ?? widthDeg),
    ...(polygon ? { polygon } : {}),
    estimatedSpeedKms: s.speedKms,
    darkness: s.darkness,
    sourceDirectionDeg: { lat: s.lat, lon: s.lon },
    expansionHalfAngleDeg: Math.min(22, 8 + widthDeg * 0.30),
    opacity: Math.min(0.65, 0.30 + (widthDeg / 180) * 3),
    hssVisible: true,
    animPhase: (index * 0.37) % 1,
  };
}

const isOpen = (life: ChLife, lc: ChLifecycle) =>
  (life.status === 'live' || life.status === 'closed') && lc.lastFrameMs - life.lastSeenMs <= LIVE_GRACE_MS;

/**
 * Every hole that was on the disk within `withinMs` of the newest frame,
 * oldest sighting first. Merged holes are included up to their merge: they
 * were real holes until then.
 */
export function lifecycleEvolutions(lc: ChLifecycle, nowMs = Date.now(), withinMs = 10 * DAY): LifecycleEvolution[] {
  const out: LifecycleEvolution[] = [];
  lc.lives.forEach((life, index) => {
    if (life.sightings.length === 0 || lc.lastFrameMs - life.lastSeenMs > withinMs) return;
    const id = `CH${life.number}`;
    const snapshots = life.sightings.map((s) => ({
      timestampMs: s.atMs,
      hoursAgo: (nowMs - s.atMs) / 3600000,
      ch: sightingToHole(id, s, index),
    }));
    out.push({
      trackId: id,
      snapshots,
      current: snapshots[snapshots.length - 1].ch,
      openEnded: isOpen(life, lc),
    });
  });
  return out;
}

/**
 * The outline to draw for a hole at a moment: the one measured at the latest
 * sighting at or before it (the first, before the hole's first sighting),
 * or null when no sighting in reach carried one.
 */
export function outlineAt(evolution: CHEvolution, atMs: number): { ch: CoronalHole; atMs: number } | null {
  let chosen: { ch: CoronalHole; atMs: number } | null = null;
  for (const snap of evolution.snapshots) {
    if (!snap.ch?.polygon || snap.ch.polygon.length < 3) continue;
    if (snap.timestampMs <= atMs || !chosen) chosen = { ch: snap.ch, atMs: snap.timestampMs };
    if (snap.timestampMs > atMs) break;
  }
  return chosen;
}
