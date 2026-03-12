// --- START OF FILE hooks/useCoronalHoles.ts ---
//
// React hook that runs the SUVI 195 coronal-hole detector on mount and
// periodically thereafter.
//
// Policy: REAL DATA ONLY.
//   • If detection succeeds → use the detected holes.
//   • If detection fails or finds nothing → coronalHoles is [] (empty).
//     The scene simply shows no CH patches or HSS arms until the next
//     successful fetch.  There is no simulated fallback data.
//
// REFRESH_INTERVAL_MS:
//   SUVI images update every ~4 minutes.  We re-analyse every 15 minutes
//   to stay fresh without hammering the proxy.

import { useState, useEffect, useRef, useCallback } from 'react';
import { CoronalHole }                              from '../utils/coronalHoleData';
import {
  detectCoronalHolesFromSuvi195,
  SuviDetectionResult,
} from '../utils/suviCoronalHoleDetector';

// ── TUNE ──────────────────────────────────────────────────────────────────────
const REFRESH_INTERVAL_MS = 15 * 60 * 1000;  // 15 minutes
const INITIAL_DELAY_MS    = 3_000;            // 3 s after mount (don't block paint)

// ── Types ─────────────────────────────────────────────────────────────────────

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
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useCoronalHoles(): CoronalHolesState {
  const [coronalHoles,   setCoronalHoles]   = useState<CoronalHole[]>([]);
  const [status,         setStatus]         = useState<CoronalHoleDetectionStatus>('idle');
  const [lastDetectedAt, setLastDetectedAt] = useState<Date | null>(null);
  const [errorMessage,   setErrorMessage]   = useState<string | undefined>(undefined);
  const [lastResult,     setLastResult]     = useState<SuviDetectionResult | null>(null);

  const timerRef    = useRef<ReturnType<typeof setTimeout>  | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef  = useRef(true);

  const runDetection = useCallback(async () => {
    if (!mountedRef.current) return;
    setStatus('loading');
    setErrorMessage(undefined);

    try {
      const result = await detectCoronalHolesFromSuvi195();
      if (!mountedRef.current) return;

      setLastResult(result);
      setLastDetectedAt(result.analysedAt);

      if (!result.succeeded) {
        // Network / CORS / canvas failure
        setCoronalHoles([]);
        setStatus('error');
        setErrorMessage(result.errorMessage ?? 'SUVI 195 analysis failed');
      } else if (result.coronalHoles.length === 0) {
        // Analysis ran cleanly but found no dark regions (quiet Sun)
        setCoronalHoles([]);
        setStatus('empty');
        setErrorMessage('No coronal holes detected in latest SUVI 195 image');
      } else {
        // Success
        setCoronalHoles(result.coronalHoles);
        setStatus('detected');
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setCoronalHoles([]);
      setStatus('error');
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    timerRef.current    = setTimeout(() => { void runDetection(); }, INITIAL_DELAY_MS);
    intervalRef.current = setInterval(() => { void runDetection(); }, REFRESH_INTERVAL_MS);

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