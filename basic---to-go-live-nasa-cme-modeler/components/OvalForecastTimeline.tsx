// --- START OF FILE src/components/OvalForecastTimeline.tsx ---
//
// Aurora oval forecast timeline slider.
// Sits directly below the sightings map and projects the oval + viewline
// forward in 5-minute steps up to 2 hours, using the same physics
// (Newell coupling, IGRF-13 dipole) that drives the real-time oval.
//
// The "Now" frame uses live measured data. All future frames are projections
// with decreasing confidence, reflected visually by increasing dash length
// and decreasing fill opacity on the oval.

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface OvalForecastFrame {
  minutesFromNow: number;
  timestamp: number;          // absolute ms
  newellProjected: number;    // projected Newell coupling value
  scoreProjected: number;     // projected aurora score (0-100)
  bayOnset: boolean;
  confidence: 'ground' | 'high' | 'medium' | 'low';
}

export interface OvalForecastTimelineProps {
  // Current measured values
  substormRiskData: {
    current?: {
      score?: number;
      bay_onset_flag?: boolean;
      risk_trend?: string;
      confidence?: number | null;
    } | null;
    metrics?: {
      solar_wind?: {
        newell_coupling_now?: number;
        newell_avg_30m?: number;
        newell_avg_60m?: number;
      };
    } | null;
  } | null | undefined;

  // Projected scores from VisibilityForecastPanel (raw, before location adjustment)
  auroraScore: number | null;
  score15: number;
  score30: number;
  score60: number;
  score120: number;

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

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function getConfidence(minutes: number): OvalForecastFrame['confidence'] {
  if (minutes === 0) return 'ground';
  if (minutes <= 15) return 'high';
  if (minutes <= 45) return 'medium';
  return 'low';
}

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
//
// We have projected scores at 0, 15, 30, 60, and 120 minutes.
// Interpolate linearly between these anchor points to fill all 25 frames.
// For Newell coupling, extrapolate from the current value using the
// trend (difference between now and 30m average), then dampen over time.

function buildFrames(
  newellNow: number,
  newellAvg30: number,
  currentScore: number,
  score15: number,
  score30: number,
  score60: number,
  score120: number,
  bayOnset: boolean,
): OvalForecastFrame[] {
  const now = Date.now();

  // Newell trend: rate of change per minute, dampened exponentially
  const newellTrend = (newellNow - newellAvg30) / 30;

  // Score anchor points for interpolation
  const scoreAnchors: [number, number][] = [
    [0, currentScore],
    [15, score15],
    [30, score30],
    [60, score60],
    [120, score120],
  ];

  function interpolateScore(minutes: number): number {
    if (minutes <= 0) return scoreAnchors[0][1];
    if (minutes >= 120) return scoreAnchors[scoreAnchors.length - 1][1];
    // Find surrounding anchors
    for (let i = 0; i < scoreAnchors.length - 1; i++) {
      const [m0, s0] = scoreAnchors[i];
      const [m1, s1] = scoreAnchors[i + 1];
      if (minutes >= m0 && minutes <= m1) {
        const t = (minutes - m0) / (m1 - m0);
        return lerp(s0, s1, t);
      }
    }
    return currentScore;
  }

  const frames: OvalForecastFrame[] = [];

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const minutes = i * STEP_MINUTES;

    // Newell projection: extrapolate with exponential dampening
    // After 30 minutes the trend influence halves every 15 minutes
    const dampen = minutes <= 30
      ? 1.0
      : Math.pow(0.5, (minutes - 30) / 15);
    const newellProjected = Math.max(0, newellNow + newellTrend * minutes * dampen);

    const scoreProjected = Math.max(0, Math.min(100, interpolateScore(minutes)));

    frames.push({
      minutesFromNow: minutes,
      timestamp: now + minutes * 60_000,
      newellProjected,
      scoreProjected,
      bayOnset: minutes === 0 ? bayOnset : false, // bay onset only applies to "now"
      confidence: getConfidence(minutes),
    });
  }

  return frames;
}

// ── Component ────────────────────────────────────────────────────────────────

export const OvalForecastTimeline: React.FC<OvalForecastTimelineProps> = ({
  substormRiskData,
  auroraScore,
  score15,
  score30,
  score60,
  score120,
  onFrameChange,
}) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const newellNow = substormRiskData?.metrics?.solar_wind?.newell_coupling_now ?? 0;
  const newellAvg30 = substormRiskData?.metrics?.solar_wind?.newell_avg_30m ?? 0;
  const currentScore = substormRiskData?.current?.score ?? auroraScore ?? 0;
  const bayOnset = substormRiskData?.current?.bay_onset_flag ?? false;

  const frames = useMemo(
    () => buildFrames(newellNow, newellAvg30, currentScore, score15, score30, score60, score120, bayOnset),
    [newellNow, newellAvg30, currentScore, score15, score30, score60, score120, bayOnset]
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
    high:   { label: 'High confidence', colour: '#34d399' },
    medium: { label: 'Medium confidence', colour: '#fbbf24' },
    low:    { label: 'Rough guide', colour: '#525252' },
  };
  const conf = confMap[activeFrame?.confidence ?? 'ground'];

  return (
    <div className="bg-neutral-900/90 border-t border-neutral-700 px-3 py-2.5 flex-shrink-0">
      {/* Top row: time label + confidence */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isForecasting ? (
            <>
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Forecast</span>
              <span className="text-sm font-semibold text-neutral-200 tabular-nums">
                {formatNZTime(activeFrame.timestamp)}
              </span>
              <span className="text-xs text-neutral-500">
                (+{activeFrame.minutesFromNow} min)
              </span>
            </>
          ) : (
            <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Live</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className="inline-block w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: conf.colour }}
          />
          <span className="text-[10px] text-neutral-500">{conf.label}</span>
        </div>
      </div>

      {/* Controls row: prev, play/pause, next, slider */}
      <div className="flex items-center gap-2">
        {/* Back to live button (only when forecasting) */}
        {isForecasting && (
          <button
            onClick={handleReset}
            title="Back to live"
            className="px-2 py-1.5 rounded-md text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors flex-shrink-0"
          >
            Live
          </button>
        )}

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

        {/* Slider */}
        <div className="relative flex-grow flex items-center h-5">
          <input
            type="range"
            min="0"
            max={TOTAL_FRAMES - 1}
            value={frameIndex}
            onChange={handleSliderChange}
            className="w-full h-1.5 bg-neutral-700/80 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-200 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-neutral-200"
          />
          {/* "Now" marker at position 0 when slider has moved away */}
          {isForecasting && (
            <div
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3.5 bg-emerald-400 rounded-full pointer-events-none"
              style={{ left: '0%' }}
              title="Now (live data)"
            />
          )}
        </div>

        {/* Time labels at edges */}
        <div className="flex-shrink-0 text-[10px] text-neutral-500 tabular-nums min-w-[32px] text-right">
          {activeFrame.minutesFromNow === 0 ? 'Now' : `+${activeFrame.minutesFromNow}m`}
        </div>
      </div>
    </div>
  );
};

export default OvalForecastTimeline;

// --- END OF FILE src/components/OvalForecastTimeline.tsx ---
