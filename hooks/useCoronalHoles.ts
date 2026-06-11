// --- START OF FILE hooks/useCoronalHoles.ts ---
//
// React hook that runs the SUVI 195 coronal-hole detector and
// integrates with the ch-history-worker for 72h evolution tracking.
//
// LIFECYCLE:
//   1. Detect CHs from live SUVI image (as before)
//   2. POST the detection to the worker for storage
//   3. Fetch the full 72h history from the worker
//   4. Backfill any missing historical SWPC frames
//   5. Build evolution tracks for each CH
//
// Policy: REAL DATA ONLY — no simulated fallback.

import { useState, useEffect, useRef, useCallback } from 'react';
import { CoronalHole }                              from '../utils/coronalHoleData';
import {
  detectCoronalHolesFromSuvi195,
  SuviDetectionResult,
} from '../utils/suviCoronalHoleDetector';
import {
  postSnapshotToWorker,
  fetchHistoryFromWorker,
  backfillFromAvailableFrames,
  buildEvolutionTracks,
  CHHistoryResult,
  CHEvolution,
} from '../utils/coronalHoleHistory';

// ── TUNE ──────────────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS   = 15 * 60 * 1000;  // 15 minutes
const INITIAL_DELAY_MS      = 3_000;            // 3s after mount
const HISTORY_FETCH_DELAY   = 2_000;            // 2s after detection before fetching history
const BACKFILL_DELAY        = 10_000;           // 10s after history fetch before backfilling
const POST_DEBOUNCE_MS      = 60_000;           // Don't post more than once per minute

// ── Types ─────────────────────────────────────────────────────────────

export type CoronalHoleDetectionStatus =
  | 'idle'
  | 'loading'
  | 'detected'
  | 'empty'
  | 'error';

export interface CoronalHolesState {
  coronalHoles:    CoronalHole[];
  detectionStatus: CoronalHoleDetectionStatus;
  lastDetectedAt:  Date | null;
  errorMessage:    string | undefined;
  lastResult:      SuviDetectionResult | null;
  refresh:         () => void;
  /** 72h CH history from the worker (null until fetched) */
  chHistory:       CHHistoryResult | null;
  /** Per-CH evolution tracks (empty until history loads) */
  chEvolutions:    CHEvolution[];
  /** History/backfill loading progress (0–1), null if idle */
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

  const [chHistory,       setChHistory]       = useState<CHHistoryResult | null>(null);
  const [chEvolutions,    setChEvolutions]    = useState<CHEvolution[]>([]);
  const [historyProgress, setHistoryProgress] = useState<number | null>(null);

  const timerRef          = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const intervalRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const historyTimerRef   = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const backfillTimerRef  = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const mountedRef        = useRef(true);
  const lastPostTimeRef   = useRef(0);
  const backfillDoneRef   = useRef(false);

  // ── Live detection ─────────────────────────────────────────────────
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

        // POST to worker (debounced — max once per minute)
        const now = Date.now();
        if (now - lastPostTimeRef.current > POST_DEBOUNCE_MS) {
          lastPostTimeRef.current = now;
          postSnapshotToWorker(
            result.coronalHoles,
            result.imageUrl ?? sourceImageUrl ?? 'latest',
          ).catch(() => {}); // Fire and forget
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setCoronalHoles([]);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [sourceImageUrl]);

  // ── Detection lifecycle ────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      setStatus('idle');
      setErrorMessage(undefined);
      [timerRef, intervalRef, historyTimerRef, backfillTimerRef].forEach(ref => {
        if (ref.current) { clearTimeout(ref.current as any); clearInterval(ref.current as any); ref.current = null; }
      });
      return;
    }

    timerRef.current    = setTimeout(() => { void runDetection(); }, INITIAL_DELAY_MS);
    intervalRef.current = setInterval(() => { void runDetection(); }, REFRESH_INTERVAL_MS);
    void runDetection();

    return () => {
      mountedRef.current = false;
      [timerRef, intervalRef, historyTimerRef, backfillTimerRef].forEach(ref => {
        if (ref.current) { clearTimeout(ref.current as any); clearInterval(ref.current as any); ref.current = null; }
      });
    };
  }, [enabled, runDetection, sourceImageUrl]);

  // ── Fetch history after detection succeeds ─────────────────────────
  useEffect(() => {
    if (!enabled || coronalHoles.length === 0) return;

    if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    historyTimerRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;

      setHistoryProgress(0.1);
      const history = await fetchHistoryFromWorker();
      if (!mountedRef.current) return;

      if (history) {
        setChHistory(history);
        const evolutions = buildEvolutionTracks(history, coronalHoles);
        setChEvolutions(evolutions);
        setHistoryProgress(0.5);

        console.log(
          `[CH History] Loaded ${history.count} snapshots,`,
          `${evolutions.length} CH tracks,`,
          history.oldestMs ? `${((Date.now() - history.oldestMs) / 3600000).toFixed(1)}h coverage` : 'no data yet'
        );

        // ── Backfill missing frames ──────────────────────────────────
        if (!backfillDoneRef.current) {
          if (backfillTimerRef.current) clearTimeout(backfillTimerRef.current);
          backfillTimerRef.current = setTimeout(async () => {
            if (!mountedRef.current) return;

            const existingTimestamps = new Set(
              history.snapshots.map(s => s.timestampMs)
            );

            console.log('[CH History] Starting backfill of missing frames...');
            const filled = await backfillFromAvailableFrames(
              existingTimestamps,
              (p) => { if (mountedRef.current) setHistoryProgress(0.5 + p * 0.5); },
            );

            if (!mountedRef.current) return;
            backfillDoneRef.current = true;
            setHistoryProgress(null);

            if (filled > 0) {
              console.log(`[CH History] Backfilled ${filled} frames — refreshing history`);
              // Re-fetch the now-enriched history
              const updated = await fetchHistoryFromWorker();
              if (updated && mountedRef.current) {
                setChHistory(updated);
                setChEvolutions(buildEvolutionTracks(updated, coronalHoles));
              }
            } else {
              console.log('[CH History] No frames needed backfilling');
            }
          }, BACKFILL_DELAY);
        } else {
          setHistoryProgress(null);
        }
      } else {
        setHistoryProgress(null);
      }
    }, HISTORY_FETCH_DELAY);

    return () => {
      if (historyTimerRef.current) clearTimeout(historyTimerRef.current);
    };
  }, [enabled, coronalHoles]);

  // ── Reset when disabled ────────────────────────────────────────────
  useEffect(() => {
    if (!enabled) {
      backfillDoneRef.current = false;
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