// --- START OF FILE hooks/useCoronalHoles.ts ---
//
// React hook that runs the SUVI 195 coronal-hole detector on mount and
// periodically thereafter. When HSS is enabled, also builds a 3-day
// CH evolution history for time-varying HSS simulation.
//
// Policy: REAL DATA ONLY.
//   • If detection succeeds → use the detected holes.
//   • If detection fails or finds nothing → coronalHoles is [] (empty).
//     The scene simply shows no CH patches or HSS arms until the next
//     successful fetch.  There is no simulated fallback data.
//
// HISTORY LOADING:
//   • Only triggered when `enabled` is true (HSS overlay is on).
//   • Fetches ~2 historical SUVI frames + rotation-extrapolates the rest.
//   • Total load: ~1.5 MB over ~15s (2 × 770KB images + analysis time).
//   • Cached until the next refresh cycle — not re-fetched on every render.

import { useState, useEffect, useRef, useCallback } from 'react';
import { CoronalHole }                              from '../utils/coronalHoleData';
import {
  detectCoronalHolesFromSuvi195,
  SuviDetectionResult,
} from '../utils/suviCoronalHoleDetector';
import {
  buildCHHistory,
  CHHistoryResult,
  CHEvolution,
} from '../utils/coronalHoleHistory';

// ── TUNE ──────────────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;  // 15 minutes
const INITIAL_DELAY_MS    = 3_000;            // 3 s after mount (don't block paint)
const HISTORY_DEBOUNCE_MS = 5_000;            // wait 5s after detection before building history

// ── Types ─────────────────────────────────────────────────────────────

export type CoronalHoleDetectionStatus =
  | 'idle'       // not started yet
  | 'loading'    // fetch + analysis in progress
  | 'detected'   // live SUVI result — coronalHoles is populated
  | 'empty'      // analysis ran but found no holes (quiet Sun or poor image)
  | 'error';     // network / CORS / canvas error

export interface CoronalHolesState {
  /** Live detected coronal holes — empty array if none found or on error */
  coronalHoles:    CoronalHole[];
  detectionStatus: CoronalHoleDetectionStatus;
  lastDetectedAt:  Date | null;
  errorMessage:    string | undefined;
  /** Full result object for optional debug display */
  lastResult:      SuviDetectionResult | null;
  /** Manually trigger a fresh analysis */
  refresh:         () => void;
  /** 3-day CH evolution history (null until loaded) */
  chHistory:       CHHistoryResult | null;
  /** Per-CH evolution tracks (empty until history loads) */
  chEvolutions:    CHEvolution[];
  /** History loading progress (0–1), null if not loading */
  historyProgress: number | null;
}

interface UseCoronalHolesOptions {
  enabled?: boolean;
  sourceImageUrl?: string | null;
}

// ── Hook ──────────────────────────────────────────────────────────────

export function useCoronalHoles({ enabled = false, sourceImageUrl }: UseCoronalHolesOptions = {}): CoronalHolesState {
  const [coronalHoles,   setCoronalHoles]   = useState<CoronalHole[]>([]);
  const [status,         setStatus]         = useState<CoronalHoleDetectionStatus>('idle');
  const [lastDetectedAt, setLastDetectedAt] = useState<Date | null>(null);
  const [errorMessage,   setErrorMessage]   = useState<string | undefined>(undefined);
  const [lastResult,     setLastResult]     = useState<SuviDetectionResult | null>(null);

  // ── History state ──────────────────────────────────────────────────
  const [chHistory,       setChHistory]       = useState<CHHistoryResult | null>(null);
  const [chEvolutions,    setChEvolutions]    = useState<CHEvolution[]>([]);
  const [historyProgress, setHistoryProgress] = useState<number | null>(null);

  const timerRef         = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const intervalRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyTimerRef  = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const mountedRef       = useRef(true);
  const historyBuiltRef  = useRef(false);

  const runDetection = useCallback(async () => {
    if (!mountedRef.current) return;
    setStatus('loading');
    setErrorMessage(undefined);

    try {
      const result = await detectCoronalHolesFromSuvi195(sourceImageUrl ?? undefined);
      if (!mountedRef.current) return;

      setLastResult(result);
      setLastDetectedAt(result.analysedAt);

      if (!result.succeeded) {
        setCoronalHoles([]);
        setStatus('error');
        setErrorMessage(result.errorMessage ?? 'SUVI 195 analysis failed');
      } else if (result.coronalHoles.length === 0) {
        setCoronalHoles([]);
        setStatus('empty');
        setErrorMessage('No coronal holes detected in latest SUVI 195 image');
      } else {
        setCoronalHoles(result.coronalHoles);
        setStatus('detected');
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setCoronalHoles([]);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [sourceImageUrl]);

  // ── Main detection lifecycle ───────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      setStatus('idle');
      setErrorMessage(undefined);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
      timerRef.current = null;
      intervalRef.current = null;
      historyTimerRef.current = null;
      return;
    }

    timerRef.current    = setTimeout(() => { void runDetection(); }, INITIAL_DELAY_MS);
    intervalRef.current = setInterval(() => { void runDetection(); }, REFRESH_INTERVAL_MS);

    void runDetection();

    return () => {
      mountedRef.current = false;
      if (timerRef.current)    clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [enabled, runDetection, sourceImageUrl]);

  // ── History building — triggered after successful detection ─────────
  useEffect(() => {
    if (!enabled || coronalHoles.length === 0 || historyBuiltRef.current) return;

    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current || coronalHoles.length === 0) return;

      console.log('[CH History] Building 3-day evolution history...');
      setHistoryProgress(0);

      try {
        const result = await buildCHHistory(
          coronalHoles,
          (progress) => {
            if (mountedRef.current) setHistoryProgress(progress);
          },
        );

        if (!mountedRef.current) return;

        setChHistory(result);
        setChEvolutions(result.evolutions);
        setHistoryProgress(null);
        historyBuiltRef.current = true;
        console.log(
          '[CH History] Built',
          result.snapshots.length, 'snapshots,',
          result.evolutions.length, 'CH tracks'
        );
      } catch (err) {
        console.warn('[CH History] Failed to build history:', err);
        if (mountedRef.current) setHistoryProgress(null);
      }
    }, HISTORY_DEBOUNCE_MS);

    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [enabled, coronalHoles]);

  // ── Reset history when HSS is disabled ─────────────────────────────
  useEffect(() => {
    if (!enabled) {
      historyBuiltRef.current = false;
      setChHistory(null);
      setChEvolutions([]);
      setHistoryProgress(null);
    }
  }, [enabled]);

  return {
    coronalHoles,
    detectionStatus: status,
    lastDetectedAt,
    errorMessage,
    lastResult,
    refresh: runDetection,
    chHistory,
    chEvolutions,
    historyProgress,
  };
}

// --- END OF FILE hooks/useCoronalHoles.ts ---