// --- START OF FILE src/components/OvalForecastTimeline.tsx ---
//
// Aurora oval forecast timeline slider.
// Sits directly below the sightings map and steps the oval + viewline
// forward in 5-minute frames up to 2 hours.
//
// The frames are not extrapolated. Each one is the oval from the solar wind
// that will have reached Earth by then - measured at L1 already, and moved
// forward by its own travel time (utils/auroraVisibility). At ordinary speeds
// that covers the first 45 minutes or more. Past the newest measurement the
// oval is held where that wind leaves it, and the frame says so.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { realWindBoundary, type L1Sample } from '../utils/auroraVisibility';

// ── Types ────────────────────────────────────────────────────────────────────

export interface OvalForecastFrame {
  minutesFromNow: number;
  timestamp: number;          // absolute ms
  /** The oval's midnight-sector equatorward edge, magnetic latitude. */
  boundary: number;
  bayOnset: boolean;
  /**
   * ground - now; high - measured wind; medium - partly measured;
   * low - past the newest measurement, the oval held where it leaves off.
   */
  confidence: 'ground' | 'high' | 'medium' | 'low';
}

export interface OvalForecastTimelineProps {
  /** L1 readings, merged (see mergeL1Series). */
  samples: L1Sample[];
  /** A confirmed substorm onset at Eyrewell - carried into the first quarter hour. */
  bayOnset: boolean;
  /** Where the oval sits if there is no L1 series at all. */
  fallbackBoundary: number;

  // Callback: tells the parent which frame is active so it can adjust
  // the oval overlay and sighting marker opacity
  onFrameChange: (frame: OvalForecastFrame | null) => void;
}

// ── Constants ────────────────────────────────────────────────────────────────

const TOTAL_MINUTES = 120;
const STEP_MINUTES = 5;
const TOTAL_FRAMES = (TOTAL_MINUTES / STEP_MINUTES) + 1; // 0..120 = 25 frames
const PLAYBACK_INTERVAL_MS = 1200; // ms per frame during auto-play

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatNZTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString('en-NZ', {
      timeZone: 'Pacific/Auckland',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

// ── Frame generation ─────────────────────────────────────────────────────────

export function buildFrames(
  samples: L1Sample[],
  bayOnset: boolean,
  fallbackBoundary: number,
  now: number = Date.now(),
): OvalForecastFrame[] {
  const frames: OvalForecastFrame[] = [];
  let held = fallbackBoundary;
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const minutes = i * STEP_MINUTES;
    const timestamp = now + minutes * 60_000;
    const onset = minutes <= 15 && bayOnset;
    const real = realWindBoundary(samples, timestamp, onset);
    let confidence: OvalForecastFrame['confidence'];
    let boundary: number;
    if (real) {
      boundary = real.boundary;
      held = boundary;
      confidence = minutes === 0 ? 'ground' : real.wind.coverage >= 0.999 ? 'high' : 'medium';
    } else {
      boundary = held;
      confidence = minutes === 0 ? 'ground' : 'low';
    }
    frames.push({ minutesFromNow: minutes, timestamp, boundary, bayOnset: onset, confidence });
  }
  return frames;
}

// ── Component ────────────────────────────────────────────────────────────────

export const OvalForecastTimeline: React.FC<OvalForecastTimelineProps> = ({
  samples,
  bayOnset,
  fallbackBoundary,
  onFrameChange,
}) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const frames = useMemo(
    () => buildFrames(samples, bayOnset, fallbackBoundary),
    [samples, bayOnset, fallbackBoundary]
  );

  // Notify parent of frame changes
  useEffect(() => {
    if (frameIndex === 0) {
      onFrameChange(null); // null = show live data, no forecast overlay
    } else {
      onFrameChange(frames[frameIndex]);
    }
  }, [frameIndex, frames, onFrameChange]);

  // Auto-play logic
  useEffect(() => {
    if (isPlaying) {
      playIntervalRef.current = setInterval(() => {
        setFrameIndex(prev => {
          if (prev >= TOTAL_FRAMES - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, PLAYBACK_INTERVAL_MS);
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    };
  }, [isPlaying]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      // If at the end, restart from beginning
      if (frameIndex >= TOTAL_FRAMES - 1) {
        setFrameIndex(0);
      }
      setIsPlaying(true);
    }
  }, [isPlaying, frameIndex]);

  const handleStepForward = useCallback(() => {
    setIsPlaying(false);
    setFrameIndex(prev => Math.min(TOTAL_FRAMES - 1, prev + 1));
  }, []);

  const handleStepBack = useCallback(() => {
    setIsPlaying(false);
    setFrameIndex(prev => Math.max(0, prev - 1));
  }, []);

  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    setFrameIndex(parseInt(e.target.value, 10));
  }, []);

  const handleReset = useCallback(() => {
    setIsPlaying(false);
    setFrameIndex(0);
  }, []);

  const activeFrame = frames[frameIndex];
  const isForecasting = frameIndex > 0;

  // Confidence label and colour
  const confMap: Record<string, { label: string; colour: string }> = {
    ground: { label: 'Live data', colour: '#34d399' },
    high:   { label: 'Measured wind, on its way', colour: '#34d399' },
    medium: { label: 'Partly measured', colour: '#fbbf24' },
    low:    { label: 'Held at the last measured wind', colour: '#525252' },
  };
  const conf = confMap[activeFrame?.confidence ?? 'ground'];

  return (
    <div className="bg-neutral-900/90 border-t border-neutral-700 px-3 py-2.5 flex-shrink-0">
      {/* Row 1: time label + controls + confidence */}
      <div className="flex items-center justify-between mb-2">
        {/* Left: Live button (always takes space) + time info */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            title="Back to live"
            className={`px-2 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider flex-shrink-0 transition-colors ${
              isForecasting
                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 cursor-pointer'
                : 'bg-emerald-500/10 text-emerald-400/60 border border-emerald-500/20 cursor-default'
            }`}
          >
            Live
          </button>
          {isForecasting && (
            <>
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Forecast</span>
              <span className="text-sm font-semibold text-neutral-200 tabular-nums">
                {formatNZTime(activeFrame.timestamp)}
              </span>
              <span className="text-xs text-neutral-500">
                (+{activeFrame.minutesFromNow} min)
              </span>
            </>
          )}
        </div>

        {/* Centre: transport controls */}
        <div className="flex items-center gap-1">
          {/* Prev */}
          <button
            onClick={handleStepBack}
            disabled={frameIndex === 0}
            title="Previous frame"
            className="p-1.5 rounded-md bg-neutral-800/50 text-neutral-200 hover:bg-neutral-700/60 border border-neutral-700/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
            </svg>
          </button>

          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            title={isPlaying ? 'Pause' : 'Play forecast'}
            className="p-1.5 rounded-md bg-neutral-800/50 text-neutral-200 hover:bg-neutral-700/60 border border-neutral-700/80 transition-colors"
          >
            {isPlaying ? (
              <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>

          {/* Next */}
          <button
            onClick={handleStepForward}
            disabled={frameIndex >= TOTAL_FRAMES - 1}
            title="Next frame"
            className="p-1.5 rounded-md bg-neutral-800/50 text-neutral-200 hover:bg-neutral-700/60 border border-neutral-700/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <svg className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
            </svg>
          </button>
        </div>

        {/* Right: confidence */}
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: conf.colour }}
          />
          <span className="text-[10px] text-neutral-500">{conf.label}</span>
        </div>
      </div>

      {/* Row 2: slider on its own full-width row */}
      <div className="flex items-center gap-2">
        <span className="flex-shrink-0 text-[10px] text-neutral-600 tabular-nums w-7">Now</span>
        <div className="relative flex-grow flex items-center h-5">
          <input
            type="range"
            min="0"
            max={TOTAL_FRAMES - 1}
            value={frameIndex}
            onChange={handleSliderChange}
            className="w-full h-1.5 bg-neutral-700/80 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-200 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-neutral-200 [&::-moz-range-thumb]:border-0"
          />
        </div>
        <span className="flex-shrink-0 text-[10px] text-neutral-600 tabular-nums w-7 text-right">2hr</span>
      </div>
    </div>
  );
};

export default OvalForecastTimeline;

// --- END OF FILE src/components/OvalForecastTimeline.tsx ---
