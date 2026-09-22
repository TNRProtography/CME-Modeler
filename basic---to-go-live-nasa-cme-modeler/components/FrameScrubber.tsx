// The frame scrubber, looking and behaving like the coronal hole tracker's
// and the SUVI panel's - same buttons, same speeds, same slider - so moving
// between panels does not mean learning a new control.

import React, { useEffect } from 'react';

export const SCRUB_SPEEDS = [0.5, 1, 2, 5, 10] as const;

interface Props {
  count: number;
  index: number;
  onIndex: (i: number) => void;
  /** One frame forward, wrapping - what playback does on each tick. */
  onAdvance: () => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  speed: number;
  onSpeed: (s: number) => void;
  /** The line under the slider - usually the frame's time. */
  caption: React.ReactNode;
}

const FrameScrubber: React.FC<Props> = ({ count, index, onIndex, onAdvance, playing, onPlaying, speed, onSpeed, caption }) => {
  // Same cadence rule as the coronal hole tracker, so 1x means the same
  // thing in both. Keyed on the COUNT, not the frames, so a refresh that
  // returns the same frames does not restart playback.
  useEffect(() => {
    if (!playing || count < 2) return;
    const id = setInterval(onAdvance, Math.max(40, Math.round(220 / speed)));
    return () => clearInterval(id);
  }, [playing, count, speed, onAdvance]);

  const step = (delta: number) => { onPlaying(false); onIndex((index + delta + count) % count); };

  return (
    <div className="mt-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => step(-1)}
          disabled={count < 2}
          className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Previous frame"
        >
          ◀ Prev
        </button>
        <button
          onClick={() => onPlaying(!playing)}
          disabled={count < 2}
          className="px-3 py-1.5 text-xs rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
          title={playing ? 'Pause' : 'Play'}
        >
          {playing ? '⏸ Pause' : '▶ Play'}
        </button>
        <button
          onClick={() => step(1)}
          disabled={count < 2}
          className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          title="Next frame"
        >
          Next ▶
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-neutral-300">
          Speed
          <select
            value={speed}
            onChange={(e) => onSpeed(Number(e.target.value))}
            className="rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
            title="Playback speed"
          >
            {SCRUB_SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
          </select>
        </label>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(0, count - 1)}
        value={Math.min(index, Math.max(0, count - 1))}
        onChange={(e) => { onPlaying(false); onIndex(Number(e.target.value)); }}
        className="w-full accent-sky-500"
      />
      <div className="mt-1 text-xs text-neutral-500 text-right">{caption}</div>
    </div>
  );
};

export default FrameScrubber;
