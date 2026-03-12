// --- START OF FILE hooks/useCoronalHoles.ts ---
//
// React hook that runs the SUVI 195 coronal-hole detector on mount and
// periodically thereafter.  Falls back to DEFAULT_CORONAL_HOLES if the
// detection fails (network error, CORS, image not yet loaded, etc.).
//
// Usage:
//   const { coronalHoles, detectionStatus } = useCoronalHoles();
//
// `coronalHoles` is always a non-empty CoronalHole[] — either real detected
// holes or the hard-coded fallback — so downstream code never has to handle
// an empty list.
//
// REFRESH_INTERVAL_MS:
//   SUVI images update every ~4 minutes.  We re-analyse every 15 minutes so
//   the CH positions stay reasonably fresh without hammering the proxy.

import { useState, useEffect, useRef, useCallback } from 'react';
import { CoronalHole, DEFAULT_CORONAL_HOLES }        from '../utils/coronalHoleData';
import { detectCoronalHolesFromSuvi195, SuviDetectionResult } from '../utils/suviCoronalHoleDetector';

// ── TUNE ──────────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;  // 15 minutes
const INITIAL_DELAY_MS    = 3000;             // wait 3 s after mount so we don't block page paint

// ── Status type exposed to consumers ──────────────────────────────────────────
export type CoronalHoleDetectionStatus =
  | 'idle'
  | 'loading'
  | 'detected'     // live SUVI result
  | 'fallback'     // using DEFAULT_CORONAL_HOLES due to an error
  | 'error';

export interface CoronalHolesState {
  /** Live or fallback coronal holes — always populated */
  coronalHoles:    CoronalHole[];
  detectionStatus: CoronalHoleDetectionStatus;
  lastDetectedAt:  Date | null;
  errorMessage:    string | undefined;
  /** Full result object for debug use (e.g. showing disk overlay) */
  lastResult:      SuviDetectionResult | null;
  /** Manually trigger a fresh analysis */
  refresh:         () => void;
}

export function useCoronalHoles(): CoronalHolesState {
  const [coronalHoles,    setCoronalHoles]    = useState<CoronalHole[]>(DEFAULT_CORONAL_HOLES);
  const [status,          setStatus]          = useState<CoronalHoleDetectionStatus>('idle');
  const [lastDetectedAt,  setLastDetectedAt]  = useState<Date | null>(null);
  const [errorMessage,    setErrorMessage]    = useState<string | undefined>(undefined);
  const [lastResult,      setLastResult]      = useState<SuviDetectionResult | null>(null);

  const timerRef     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef   = useRef(true);

  const runDetection = useCallback(async () => {
    if (!mountedRef.current) return;
    setStatus('loading');
    setErrorMessage(undefined);

    try {
      const result = await detectCoronalHolesFromSuvi195();

      if (!mountedRef.current) return;
      setLastResult(result);
      setLastDetectedAt(result.analysedAt);

      if (result.succeeded && result.coronalHoles.length > 0) {
        setCoronalHoles(result.coronalHoles);
        setStatus('detected');
      } else {
        // Detection ran but found nothing (e.g. quiet Sun) or failed — use fallback
        setCoronalHoles(DEFAULT_CORONAL_HOLES);
        setStatus(result.succeeded ? 'fallback' : 'error');
        setErrorMessage(result.errorMessage ?? 'No coronal holes detected — using simulated data');
      }
    } catch (err) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setCoronalHoles(DEFAULT_CORONAL_HOLES);
      setStatus('error');
      setErrorMessage(msg);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // Delay the first run so the rest of the page paints first
    timerRef.current = setTimeout(() => {
      void runDetection();
    }, INITIAL_DELAY_MS);

    // Periodic refresh
    intervalRef.current = setInterval(() => {
      void runDetection();
    }, REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (timerRef.current)    clearTimeout(timerRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [runDetection]);

  return {
    coronalHoles,
    detectionStatus: status,
    lastDetectedAt,
    errorMessage,
    lastResult,
    refresh: runDetection,
  };
}

// --- END OF FILE hooks/useCoronalHoles.ts ---