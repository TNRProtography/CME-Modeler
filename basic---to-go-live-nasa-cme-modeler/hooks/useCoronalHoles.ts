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
// Policy: REAL DATA ONLY - no simulated fallback.

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
import { registerDatasetTicker } from '../utils/pollingScheduler';
import { getChState, holesForScene, publishDetection, subscribeToChDetections } from '../utils/chDetectionStore';
import { lifecycleEvolutions } from '../utils/chLifecycleScene';
import { startChLifecycleSync } from '../utils/chLifecycleSync';

/**
 * How fresh a shared detection has to be for the scene to use it rather than
 * running its own. Well inside the 15 minute refresh, so in practice the
 * dashboard's work is reused and the scene detects nothing at all.
 */
const SHARED_DETECTION_MAX_AGE_MS = 30 * 60 * 1000;

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
  // Once the 90-day record has holes, it is what the scene's history comes
  // from; the older 72-hour history is only a fallback before then.
  const usingRecordRef = useRef(false);
  const recordSignatureRef = useRef('');
  const [historyProgress, setHistoryProgress] = useState<number | null>(null);

  const timerRef          = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const unregisterTickerRef = useRef<(() => void) | null>(null);
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
      // Prefer a detection the rest of the app already ran. The Coronal Hole
      // Tracker measures the same Sun from the same channel, and two
      // independent runs produce two slightly different sets of outlines -
      // which shows up as the 3D scene and the dashboard disagreeing about
      // where a hole is.
      const shared = getChState();
      const newest = shared.detections[shared.detections.length - 1];
      if (newest && Date.now() - newest.atMs < SHARED_DETECTION_MAX_AGE_MS && newest.holes.length > 0) {
        // The tracker's live holes, not only the newest frame's.
        const scene = holesForScene(shared);
        setCoronalHoles(scene?.holes ?? newest.holes);
        setLastDetectedAt(new Date(newest.atMs));
        setStatus('detected');
        return;
      }

      const result = await detectCoronalHolesFromSuvi195(sourceImageUrl ?? undefined);
      if (!mountedRef.current) return;

      // And publish ours, so the dashboard reuses it in turn.
      if (result.succeeded && result.diskFraction) {
        publishDetection(
          result.imageUrl, result.analysedAt.getTime(),
          result.coronalHoles, result.diskFraction, result.b0Deg,
        );
      }

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

        // POST to worker (debounced - max once per minute)
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

  // Follow the shared store, so a detection run anywhere in the app reaches
  // the scene without waiting for its own refresh.
  useEffect(() => subscribeToChDetections((shared) => {
    if (!mountedRef.current) return;
    const newest = shared.detections[shared.detections.length - 1];
    if (!newest || newest.holes.length === 0) return;
    if (Date.now() - newest.atMs > SHARED_DETECTION_MAX_AGE_MS) return;
    setCoronalHoles(holesForScene(shared)?.holes ?? newest.holes);
    setLastDetectedAt(new Date(newest.atMs));
    setStatus('detected');
  }), []);

  // ── History from the 90-day record ─────────────────────────────────
  // Every hole the Coronal Hole Tracker has, as it was at each sighting,
  // outline included, so the scene can show the holes of any moment on its
  // timeline. Kept in step with the shared record while HSS is on.
  useEffect(() => {
    if (!enabled) return;
    startChLifecycleSync();
    return subscribeToChDetections((shared) => {
      if (!mountedRef.current) return;
      const lc = shared.lifecycle;
      if (!lc || lc.lives.length === 0) return;
      let sightings = 0, outlines = 0;
      for (const life of lc.lives) for (const s of life.sightings) { sightings++; if (s.outline) outlines++; }
      // Only a real change rebuilds the scene's holes and streams.
      const signature = `${lc.lastFrameMs}|${lc.lives.length}|${sightings}|${outlines}`;
      if (signature === recordSignatureRef.current) return;
      recordSignatureRef.current = signature;
      const evolutions = lifecycleEvolutions(lc);
      if (evolutions.length === 0) return;
      usingRecordRef.current = true;
      setChEvolutions(evolutions);
    });
  }, [enabled]);

  // ── Detection lifecycle ────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      setStatus('idle');
      setErrorMessage(undefined);
      unregisterTickerRef.current?.();
      unregisterTickerRef.current = null;
      [timerRef, historyTimerRef, backfillTimerRef].forEach(ref => {
        if (ref.current) { clearTimeout(ref.current as any); clearInterval(ref.current as any); ref.current = null; }
      });
      return;
    }

    timerRef.current = setTimeout(() => { void runDetection(); }, INITIAL_DELAY_MS);
    unregisterTickerRef.current = registerDatasetTicker(
      'coronal-hole-detection',
      () => runDetection(),
      REFRESH_INTERVAL_MS,
    );
    void runDetection();

    return () => {
      mountedRef.current = false;
      unregisterTickerRef.current?.();
      unregisterTickerRef.current = null;
      [timerRef, historyTimerRef, backfillTimerRef].forEach(ref => {
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
        if (!usingRecordRef.current) setChEvolutions(evolutions);
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
              console.log(`[CH History] Backfilled ${filled} frames - refreshing history`);
              // Re-fetch the now-enriched history
              const updated = await fetchHistoryFromWorker();
              if (updated && mountedRef.current) {
                setChHistory(updated);
                if (!usingRecordRef.current) setChEvolutions(buildEvolutionTracks(updated, coronalHoles));
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
      usingRecordRef.current = false;
      recordSignatureRef.current = '';
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