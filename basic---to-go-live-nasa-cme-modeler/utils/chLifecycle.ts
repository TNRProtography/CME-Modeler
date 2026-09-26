// Every coronal hole's life, kept for 90 days: when it first appeared, its
// size and the speed of its stream at every sighting, and when and why it
// went.
//
// buildChTracks follows holes across whatever frames it is handed and starts
// again each time, so a hole's story is only ever as long as the frames one
// device happens to have. This is the other half: a record that is added to,
// frame by frame, and never rebuilt. The forecast worker keeps the shared copy
// (every device that detects holes feeds it) and the app keeps its own when the
// worker cannot be reached. The same functions run in both, so the two agree
// about which hole is which.
//
// Plain functions and plain data, no browser APIs: the forecast worker bundles
// this file.

import { longitudeAt } from './solarDisk';
import { estimateHssSpeedFromChWidthAndDarkness } from './solarWindModel';
import {
  GONE_WORDS, LIVE_GRACE_MS, MATCH_RADIUS_DEG, chDisappearance,
  type ChDisappearance, type ChTrack, type TrackedHole,
} from './chTracking';
import { FIRST_CH_NUMBER } from './chRegistry';
import { isOutline } from './chOutline';

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** How long a hole's record is kept after it has gone. */
export const LIFECYCLE_RETENTION_MS = 90 * DAY;
/** Sightings older than this are thinned to one per THIN_SPACING_MS. */
export const THIN_AFTER_MS = 7 * DAY;
export const THIN_SPACING_MS = 6 * HOUR;
/** Frames closer together than this add nothing; the later one is skipped. */
export const MIN_FRAME_GAP_MS = 45 * 60000;
/** Missing on the near side for this long, and it has closed. */
export const CLOSED_AFTER_MS = 4 * HOUR;
/** A hole found again within this long of closing is the same hole, back. */
export const REVIVE_WITHIN_MS = 12 * HOUR;
/** Past this longitude, projected, a hole has turned off the west limb. */
export const WEST_LIMB_DEG = 80;
/** East of this, a new hole has just come round the east limb. */
const EAST_LIMB_DEG = -55;
/**
 * A remembered hole this near, once it has been carried round the back of
 * the Sun, is the same hole returning a rotation later.
 */
const RETURN_MATCH_DEG = 30;
/** A second hole whose centre is within this of a hole's edge has merged into it. */
const MERGE_MARGIN_DEG = 6;

export type ChStatus = 'live' | 'rotated-off' | 'closed' | 'merged';

export interface ChSighting {
  atMs: number;
  /** The detector's id in that frame, for finding its outline. */
  holeId: string;
  lat: number;
  lon: number;
  widthDeg: number;
  heightDeg?: number;
  darkness: number;
  /** The stream speed its size and darkness give, km/s. */
  speedKms: number;
  /** Its outline in that frame (utils/chOutline), when the detector drew one. */
  outline?: string;
}

export interface ChLife {
  number: number;
  firstSeenMs: number;
  lastSeenMs: number;
  status: ChStatus;
  /** When it went: its last sighting, for a hole that has. */
  endedMs: number | null;
  /** For a merged hole, the hole it joined. */
  mergedInto?: number;
  /** For a hole coming round the east limb, the hole it was last rotation. */
  returnOf?: number;
  sightings: ChSighting[];
}

export interface ChLifecycle {
  version: 1;
  nextNumber: number;
  /** The newest frame applied. Older frames are not accepted. */
  lastFrameMs: number;
  /** The first frame applied: how far back the record goes. */
  startedMs: number;
  lives: ChLife[];
}

export interface LifecycleFrame {
  atMs: number;
  holes: TrackedHole[];
}

export const emptyLifecycle = (): ChLifecycle => ({
  version: 1, nextNumber: FIRST_CH_NUMBER, lastFrameMs: 0, startedMs: 0, lives: [],
});

const round = (x: number, places = 1) => {
  const k = 10 ** places;
  return Math.round(x * k) / k;
};

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** A hole from outside worth recording: finite, on the disk, a real size. */
export function isUsableHole(h: any): h is TrackedHole {
  return !!h && finite(h.lat) && finite(h.lon) && finite(h.widthDeg) && finite(h.darkness)
    && Math.abs(h.lat) <= 90 && Math.abs(h.lon) <= 100 && h.widthDeg > 0 && h.widthDeg <= 120
    && h.darkness >= 0 && h.darkness <= 1
    && (h.heightDeg == null || (finite(h.heightDeg) && h.heightDeg >= 0 && h.heightDeg <= 180));
}

const sightingOf = (atMs: number, h: TrackedHole): ChSighting => ({
  atMs,
  holeId: String(h.id ?? '').slice(0, 24),
  lat: round(h.lat),
  lon: round(h.lon),
  widthDeg: round(h.widthDeg),
  ...(h.heightDeg != null ? { heightDeg: round(h.heightDeg) } : {}),
  darkness: round(h.darkness, 3),
  speedKms: Math.round(estimateHssSpeedFromChWidthAndDarkness(h.widthDeg, h.darkness)),
  ...(isOutline(h.outline) ? { outline: h.outline } : {}),
});

const lastOf = (life: ChLife) => life.sightings[life.sightings.length - 1];

/** Where a hole's last sighting has turned to by a moment. */
export const projectedLon = (life: ChLife, atMs: number) => longitudeAt(lastOf(life).lon, lastOf(life).atMs, atMs);

/**
 * Add one frame's holes to the record.
 *
 * Each hole in the frame is matched to the hole it continues, closest first
 * with rotation taken out, one to one. A hole left over near another's edge
 * is that hole having grown into it, and the smaller record ends as merged.
 * A new hole just round the east limb, where a hole went off the west limb
 * about a rotation ago, is marked as that hole returning. Holes not found are
 * then settled: turned off the west limb, closed, or still live for now.
 *
 * Mutates and returns the record. Frames must come oldest first; an older or
 * too-close frame is ignored and the result says so.
 */
export function applyFrame(lc: ChLifecycle, frame: LifecycleFrame): boolean {
  if (!finite(frame.atMs) || !Array.isArray(frame.holes)) return false;
  if (lc.lastFrameMs && frame.atMs < lc.lastFrameMs + MIN_FRAME_GAP_MS) return false;
  const t = frame.atMs;
  const holes = frame.holes.filter(isUsableHole);

  // Anything that could continue: live holes still on the near side, and
  // holes that closed recently enough to come back.
  const candidates = lc.lives.filter((l) =>
    (l.status === 'live' || (l.status === 'closed' && l.endedMs != null && t - l.endedMs <= REVIVE_WITHIN_MS))
    && projectedLon(l, t) <= WEST_LIMB_DEG + 10);

  const pairs: { life: ChLife; hole: number; distance: number }[] = [];
  for (const life of candidates) {
    const last = lastOf(life);
    const lon = projectedLon(life, t);
    holes.forEach((h, i) => {
      const distance = Math.hypot(lon - h.lon, last.lat - h.lat);
      if (distance <= MATCH_RADIUS_DEG) pairs.push({ life, hole: i, distance });
    });
  }
  pairs.sort((a, b) => a.distance - b.distance);

  const holeOwner = new Map<number, ChLife>();
  const matched = new Set<ChLife>();
  for (const p of pairs) {
    if (matched.has(p.life) || holeOwner.has(p.hole)) continue;
    matched.add(p.life);
    holeOwner.set(p.hole, p.life);
  }

  // Two holes that have grown into one: the unmatched one sits inside or at
  // the edge of a hole another record took. The older record keeps going, so
  // the number people have been watching stays.
  for (const life of candidates) {
    if (matched.has(life) || life.status !== 'live') continue;
    const lon = projectedLon(life, t);
    const lat = lastOf(life).lat;
    for (const [i, owner] of holeOwner) {
      const h = holes[i];
      const reach = Math.max(h.widthDeg, h.heightDeg ?? h.widthDeg) / 2 + MERGE_MARGIN_DEG;
      if (Math.hypot(lon - h.lon, lat - h.lat) > reach) continue;
      let keep = owner;
      let end = life;
      if (life.firstSeenMs < owner.firstSeenMs) {
        // This one is older: it takes the merged hole over.
        holeOwner.set(i, life);
        matched.add(life);
        matched.delete(owner);
        keep = life;
        end = owner;
      }
      end.status = 'merged';
      end.mergedInto = keep.number;
      end.endedMs = end.lastSeenMs;
      break;
    }
  }

  for (const [i, life] of holeOwner) {
    const h = holes[i];
    life.sightings.push(sightingOf(t, h));
    life.lastSeenMs = t;
    life.status = 'live';
    life.endedMs = null;
  }

  holes.forEach((h, i) => {
    if (holeOwner.has(i)) return;
    const life: ChLife = {
      number: lc.nextNumber++,
      firstSeenMs: t,
      lastSeenMs: t,
      status: 'live',
      endedMs: null,
      sightings: [sightingOf(t, h)],
    };
    if (h.lon <= EAST_LIMB_DEG) {
      // Carried round the back: a hole that left the west limb comes back at
      // the east limb about 13.6 days later.
      let best: ChLife | null = null;
      let bestD = RETURN_MATCH_DEG;
      for (const old of lc.lives) {
        if (old.status !== 'rotated-off') continue;
        const since = t - old.lastSeenMs;
        if (since < 8 * DAY || since > 22 * DAY) continue;
        let lon = projectedLon(old, t);
        lon = ((lon + 180) % 360 + 360) % 360 - 180;
        const d = Math.hypot(lon - h.lon, lastOf(old).lat - h.lat);
        if (d < bestD && !lc.lives.some((l) => l.returnOf === old.number)) { bestD = d; best = old; }
      }
      if (best) life.returnOf = best.number;
    }
    lc.lives.push(life);
  });

  // Settle the ones not found.
  for (const life of lc.lives) {
    if (life.status !== 'live' || life.lastSeenMs === t) continue;
    if (projectedLon(life, t) > WEST_LIMB_DEG) {
      life.status = 'rotated-off';
      life.endedMs = life.lastSeenMs;
    } else if (t - life.lastSeenMs >= CLOSED_AFTER_MS) {
      life.status = 'closed';
      life.endedMs = life.lastSeenMs;
    }
  }
  // A closed hole whose position has since turned off the disk cannot come
  // back as itself; leave it closed.

  lc.lastFrameMs = t;
  if (!lc.startedMs) lc.startedMs = t;
  return true;
}

/** Apply frames oldest first. Returns how many were taken. */
export function applyFrames(lc: ChLifecycle, frames: LifecycleFrame[]): number {
  let n = 0;
  for (const f of [...frames].sort((a, b) => a.atMs - b.atMs)) if (applyFrame(lc, f)) n++;
  return n;
}

/**
 * Keep the record to a size that is cheap to store and send: holes gone for
 * longer than the retention are dropped, and sightings older than a week are
 * thinned to one every six hours, always keeping a hole's first and last.
 */
export function pruneLifecycle(lc: ChLifecycle, nowMs: number): ChLifecycle {
  const cutoff = nowMs - LIFECYCLE_RETENTION_MS;
  const thinBefore = nowMs - THIN_AFTER_MS;
  lc.lives = lc.lives.filter((l) => (l.endedMs ?? l.lastSeenMs) >= cutoff);
  for (const life of lc.lives) {
    const s = life.sightings;
    if (s.length < 3 || s[0].atMs >= thinBefore) continue;
    const kept: ChSighting[] = [];
    let lastKept = -Infinity;
    s.forEach((x, i) => {
      if (i === 0 || i === s.length - 1 || x.atMs >= thinBefore || x.atMs - lastKept >= THIN_SPACING_MS) {
        kept.push(x);
        lastKept = x.atMs;
      }
    });
    life.sightings = kept;
  }
  if (lc.startedMs && lc.startedMs < cutoff) lc.startedMs = cutoff;
  return lc;
}

/** A copy with no outlines on sightings before a moment (all of them, by default). */
export function withoutOutlines(lc: ChLifecycle, beforeMs = Infinity): ChLifecycle {
  return {
    ...lc,
    lives: lc.lives.map((life) => ({
      ...life,
      sightings: life.sightings.map((s) => {
        if (s.outline === undefined || s.atMs >= beforeMs) return s;
        const { outline: _dropped, ...rest } = s;
        return rest;
      }),
    })),
  };
}

/** Give `target` any outlines `source` has for the same sightings. Mutates target. */
export function mergeOutlines(target: ChLifecycle, source: ChLifecycle): ChLifecycle {
  const known = new Map<string, string>();
  for (const life of source.lives) {
    for (const s of life.sightings) if (s.outline) known.set(`${life.number}@${s.atMs}`, s.outline);
  }
  if (known.size === 0) return target;
  for (const life of target.lives) {
    for (const s of life.sightings) {
      if (!s.outline) {
        const o = known.get(`${life.number}@${s.atMs}`);
        if (o) s.outline = o;
      }
    }
  }
  return target;
}

/** A stored or received record, checked; an empty one when it will not do. */
export function parseLifecycle(raw: unknown): ChLifecycle {
  const data = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  const d = data as any;
  if (!d || d.version !== 1 || !Array.isArray(d.lives)) return emptyLifecycle();
  const lives: ChLife[] = d.lives.filter((l: any) =>
    finite(l?.number) && finite(l?.firstSeenMs) && finite(l?.lastSeenMs)
    && Array.isArray(l?.sightings) && l.sightings.length > 0
    && ['live', 'rotated-off', 'closed', 'merged'].includes(l?.status));
  const highest = lives.reduce((m, l) => Math.max(m, l.number + 1), FIRST_CH_NUMBER);
  return {
    version: 1,
    nextNumber: Math.max(finite(d.nextNumber) ? d.nextNumber : FIRST_CH_NUMBER, highest),
    lastFrameMs: finite(d.lastFrameMs) ? d.lastFrameMs : 0,
    startedMs: finite(d.startedMs) ? d.startedMs : 0,
    lives,
  };
}

/** A track carrying the number and life it came from. */
export interface LifecycleTrack extends ChTrack<TrackedHole> {
  number: number;
  life: ChLife;
}

/**
 * The record as tracks, the shape the tracker, the forecast and the 3D scene
 * already take. Merged holes are left out (their stream is the hole they
 * joined), as are holes gone for longer than `endedWithinMs` - long enough by
 * default for any stream a hole sent to have arrived.
 */
export function lifecycleTracks(lc: ChLifecycle, endedWithinMs = 10 * DAY): LifecycleTrack[] {
  const newest = lc.lastFrameMs;
  const out: LifecycleTrack[] = [];
  for (const life of lc.lives) {
    if (life.status === 'merged') continue;
    if (life.endedMs != null && newest - life.endedMs > endedWithinMs) continue;
    const points = life.sightings.map((s) => ({
      atMs: s.atMs,
      hole: { id: s.holeId, lat: s.lat, lon: s.lon, widthDeg: s.widthDeg, heightDeg: s.heightDeg, darkness: s.darkness },
    }));
    const latest = points[points.length - 1].hole;
    out.push({
      key: `CH${life.number}`,
      number: life.number,
      life,
      points,
      firstSeenMs: life.firstSeenMs,
      lastSeenMs: life.lastSeenMs,
      latest,
      present: life.lastSeenMs === newest,
      // Drawn for the same grace as the tracker always has: a hole marked
      // closed a few hours ago can still come back as itself.
      live: (life.status === 'live' || life.status === 'closed') && newest - life.lastSeenMs <= LIVE_GRACE_MS,
    });
  }
  return out.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.lastSeenMs !== b.lastSeenMs) return b.lastSeenMs - a.lastSeenMs;
    return b.latest.widthDeg - a.latest.widthDeg;
  });
}

/**
 * Why a hole from the record is not in the latest frame: what the record
 * settled on, once it has, and the tracker's own reading while it has not.
 */
export function lifecycleDisappearance(track: LifecycleTrack, nowMs: number, latestFrameMs: number): ChDisappearance {
  const s = track.life.status;
  if (s === 'rotated-off' || s === 'closed') return { gone: true, reason: s, ...GONE_WORDS[s] };
  return chDisappearance(track, nowMs, latestFrameMs);
}

export const isLifecycleTrack = (t: ChTrack<TrackedHole>): t is LifecycleTrack =>
  typeof (t as Partial<LifecycleTrack>).number === 'number' && !!(t as Partial<LifecycleTrack>).life;

/** The biggest a hole got, and its fastest stream. */
export function lifeSummary(life: ChLife) {
  let maxWidth = 0, maxSpeed = 0;
  for (const s of life.sightings) {
    maxWidth = Math.max(maxWidth, s.widthDeg);
    maxSpeed = Math.max(maxSpeed, s.speedKms);
  }
  return { maxWidthDeg: maxWidth, maxSpeedKms: maxSpeed, sightings: life.sightings.length };
}

export const STATUS_WORDS: Record<ChStatus, string> = {
  live: 'On the disk',
  'rotated-off': 'Turned off the west limb',
  closed: 'Closed',
  merged: 'Merged',
};
