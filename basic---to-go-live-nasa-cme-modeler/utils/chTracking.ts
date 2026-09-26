// Following one coronal hole across many frames.
//
// The detector has no memory. Every frame it produces a fresh list of holes
// numbered from zero, so "CH1" in this frame and "CH1" in the last one are
// only the same hole by coincidence of ordering. Watching a hole open or close
// means deciding, for each frame, which of that frame's holes is the one we
// were already following.
//
// Two things make that harder than matching positions. The Sun turns about
// 13.2 degrees a day, so a hole's longitude is different in every frame even
// when nothing about the hole has changed - every measurement has to be
// carried forward to a common moment before anything is compared. And holes
// merge, split and fade, so the answer is sometimes that there is no match,
// which has to read as "this hole is no longer there" rather than as an empty
// row or a silently dropped entry.

import { longitudeAt } from './solarDisk';

/** Everything a hole needs to be followed. */
export interface TrackedHole {
  id: string;
  lat: number;
  lon: number;
  widthDeg: number;
  heightDeg?: number;
  darkness: number;
  /**
   * The detector's outline, compact (utils/chOutline). Not used for
   * following; carried so the record can show each hole's shape over time.
   */
  outline?: string;
}

export interface ChFrame<H extends TrackedHole = TrackedHole> {
  atMs: number;
  holes: H[];
}

/**
 * How far apart two measurements can be and still be the same hole, in
 * degrees, once rotation has been taken out.
 *
 * Generous, because a hole's centroid genuinely wanders as its shape changes -
 * a lobe opening on one side can move the centre several degrees between
 * frames without the hole having gone anywhere.
 */
export const MATCH_RADIUS_DEG = 22;

export interface ChTrackPoint<H extends TrackedHole = TrackedHole> {
  atMs: number;
  hole: H;
}

export interface ChTrack<H extends TrackedHole = TrackedHole> {
  /** Stable for as long as the track lives, unlike the detector's numbering. */
  key: string;
  points: ChTrackPoint<H>[];
  firstSeenMs: number;
  lastSeenMs: number;
  /** The most recent measurement of it. */
  latest: H;
  /** True when it was found in the newest frame available. */
  present: boolean;
  /**
   * True while the hole should still be shown, which is a different and much
   * more useful question than whether it turned up in one particular frame.
   *
   * The detector misses holes. A faint frame, a bit of the disk washed out by
   * a flare, a shape that momentarily falls under the area threshold - any of
   * those drop a hole for one frame and bring it back the next. Keying the
   * display off `present` makes holes flicker in and out as the timeline
   * plays, which reads as the app being broken rather than as the detector
   * being imperfect.
   *
   * So a hole stays live for a grace period after it was last measured, its
   * outline rotating with the Sun as though it were still being seen. Only
   * after a long enough silence - long enough that a genuinely closed hole
   * would not have come back - is it treated as gone.
   */
  live: boolean;
}

/**
 * Group every hole in every frame into tracks.
 *
 * Frames are walked oldest first, and each hole is offered to the open tracks
 * in order of how close it is. A track can take at most one hole per frame, so
 * two holes that drift together cannot both claim the same history.
 */
export const LIVE_GRACE_MS = 12 * 3600 * 1000;

export function buildChTracks<H extends TrackedHole>(
  frames: ChFrame<H>[],
  matchRadiusDeg: number = MATCH_RADIUS_DEG,
  graceMs: number = LIVE_GRACE_MS,
): ChTrack<H>[] {
  const ordered = [...frames]
    .filter((f) => Number.isFinite(f.atMs) && Array.isArray(f.holes))
    .sort((a, b) => a.atMs - b.atMs);
  if (ordered.length === 0) return [];

  const newestMs = ordered[ordered.length - 1].atMs;
  const tracks: ChTrack<H>[] = [];
  let nextKey = 0;

  for (const frame of ordered) {
    const claimed = new Set<number>();

    // Every (track, hole) pairing that is close enough, best first. Deciding
    // globally rather than per-track stops the first track in the list from
    // taking a hole that fits a later one far better.
    const pairs: { trackIndex: number; holeIndex: number; distance: number }[] = [];
    tracks.forEach((track, trackIndex) => {
      // Where the track's last measurement would be now.
      const last = track.points[track.points.length - 1];
      const predictedLon = longitudeAt(last.hole.lon, last.atMs, frame.atMs);
      frame.holes.forEach((hole, holeIndex) => {
        const distance = Math.hypot(predictedLon - hole.lon, last.hole.lat - hole.lat);
        if (distance <= matchRadiusDeg) pairs.push({ trackIndex, holeIndex, distance });
      });
    });
    pairs.sort((a, b) => a.distance - b.distance);

    const usedTracks = new Set<number>();
    for (const pair of pairs) {
      if (usedTracks.has(pair.trackIndex) || claimed.has(pair.holeIndex)) continue;
      usedTracks.add(pair.trackIndex);
      claimed.add(pair.holeIndex);
      const track = tracks[pair.trackIndex];
      const hole = frame.holes[pair.holeIndex];
      track.points.push({ atMs: frame.atMs, hole });
      track.lastSeenMs = frame.atMs;
      track.latest = hole;
    }

    // Anything left over is a hole we have not seen before.
    frame.holes.forEach((hole, holeIndex) => {
      if (claimed.has(holeIndex)) return;
      tracks.push({
        key: `CHT_${nextKey++}`,
        points: [{ atMs: frame.atMs, hole }],
        firstSeenMs: frame.atMs,
        lastSeenMs: frame.atMs,
        latest: hole,
        present: false,
        live: false,
      });
    });
  }

  for (const track of tracks) {
    track.present = track.lastSeenMs === newestMs;
    track.live = newestMs - track.lastSeenMs <= graceMs;
  }

  // Live ones first, then the most recently seen, then the biggest. A hole
  // that has gone is still listed - it just sorts below the live ones.
  return tracks.sort((a, b) => {
    if (a.live !== b.live) return a.live ? -1 : 1;
    if (a.lastSeenMs !== b.lastSeenMs) return b.lastSeenMs - a.lastSeenMs;
    return b.latest.widthDeg - a.latest.widthDeg;
  });
}

export type ChDisappearance =
  | { gone: false }
  | { gone: true; reason: 'rotated-off' | 'closed' | 'lost'; label: string; note: string };

/** What each way of going means, in words. */
export const GONE_WORDS: Record<'rotated-off' | 'closed' | 'lost', { label: string; note: string }> = {
  'rotated-off': {
    label: 'Round the back',
    note: 'It has turned past the west limb. The hole still exists and any stream already '
        + 'on its way still arrives - we simply cannot see it from here until it comes round again.',
  },
  closed: {
    label: 'Closed',
    note: 'Still on the near side of the Sun but no longer dark enough to detect, which means '
        + 'the open field has closed down. Any stream it already sent is still on its way.',
  },
  lost: {
    label: 'Not in the latest frame',
    note: 'On the disk but missed in the most recent frame. That is usually a faint or partial '
        + 'image rather than the hole going anywhere, and it often reappears in the next one.',
  },
};

/**
 * Why a hole is no longer in the latest frame.
 *
 * Worth separating, because the three cases mean completely different things
 * and an app that just stops showing the hole tells you none of them. A hole
 * that has turned past the west limb is still there and its stream is still
 * on its way; one that closed up is over; one that simply stopped matching is
 * a gap in our tracking rather than a fact about the Sun, and should say so
 * instead of inventing a tidier story.
 */
export function chDisappearance(
  track: ChTrack,
  nowMs: number,
  latestFrameMs: number,
): ChDisappearance {
  if (track.present) return { gone: false };

  const projected = longitudeAt(track.latest.lon, track.lastSeenMs, nowMs);
  const hoursMissing = (latestFrameMs - track.lastSeenMs) / 3600000;

  if (projected > 80) return { gone: true, reason: 'rotated-off', ...GONE_WORDS['rotated-off'] };

  // Still on the visible disk but not being found. Over a few frames that is
  // the hole closing up; over one it is more likely the detector losing it in
  // a faint frame.
  if (hoursMissing >= 4) return { gone: true, reason: 'closed', ...GONE_WORDS.closed };

  return { gone: true, reason: 'lost', ...GONE_WORDS.lost };
}
