// Keeping a timeline's position when the timeline itself moves underneath it.
//
// The imagery panels poll their worker every thirty seconds, and each poll
// hands back a fresh array: new frames on the end, and on a rolling window,
// old ones dropped from the front. The scrubber's position is an index into
// that array, so an index that meant "two hours ago" before the poll can mean
// something else after it.
//
// The old code answered this by resetting to the newest frame and stopping
// playback whenever the frame count changed. That is invisible on a three hour
// window, which plays through in about nine seconds and so almost never has a
// poll land mid-playback. On twenty-four hours it is fatal: three hundred and
// sixty frames take over a minute to play, two or three polls land during it,
// and playback is killed every time. The 24h button looked broken while the
// shorter ones looked fine, which is exactly the shape of the report.

export interface TimedFrame {
  ts?: string | null;
}

export interface FramePositionInput<T extends TimedFrame> {
  frames: T[];
  /** The timestamp of the frame that was on screen before this update. */
  previousTs: string | null;
  /** Where the scrubber was. */
  previousIndex: number;
  /** True when the user changed source or window, rather than a poll landing. */
  switched: boolean;
}

export interface FramePosition {
  index: number;
  /** Only ever true for a real switch or an empty timeline. */
  stopPlayback: boolean;
}

/**
 * Where the scrubber should sit after the frame list changes.
 *
 * A genuine switch - different channel, different window - starts at the
 * newest frame and stops playback, because the old position means nothing in
 * the new list. A poll holds the moment being viewed: the same timestamp if it
 * is still there, and otherwise the nearest surviving index, which is what
 * happens when the frame being watched rolls off the back of the window.
 */
export function nextFramePosition<T extends TimedFrame>(
  { frames, previousTs, previousIndex, switched }: FramePositionInput<T>,
): FramePosition {
  if (frames.length === 0) return { index: 0, stopPlayback: true };
  if (switched) return { index: frames.length - 1, stopPlayback: true };

  // Nothing has been on screen yet, so there is no moment to hold on to. This
  // is the first load: the timeline key was recorded while the list was still
  // empty, so the frames arriving is not a "switch", and falling through to
  // the previous index would open every timeline on its oldest frame. People
  // open these to see now.
  if (previousTs == null) return { index: frames.length - 1, stopPlayback: false };

  if (previousTs) {
    const found = frames.findIndex((f) => f.ts === previousTs);
    if (found >= 0) return { index: found, stopPlayback: false };
  }

  // The frame we were on is gone. Hold the nearest position rather than
  // snapping to the end, so a long playback carries on from about where it
  // was instead of restarting.
  return {
    index: Math.max(0, Math.min(previousIndex, frames.length - 1)),
    stopPlayback: false,
  };
}

/**
 * How much time a set of frames actually covers, in hours.
 *
 * The window buttons say what was asked for, not what arrived. When a worker
 * is only holding twelve hours, a 24h button gives the same frames as the 12h
 * one and looks broken; reporting the real span says so instead.
 */
export function frameSpanHours<T extends TimedFrame>(frames: T[]): number | null {
  const times = frames
    .map((f) => (f.ts ? new Date(f.ts).getTime() : NaN))
    .filter((t) => Number.isFinite(t));
  if (times.length < 2) return null;
  return (Math.max(...times) - Math.min(...times)) / 3600000;
}
