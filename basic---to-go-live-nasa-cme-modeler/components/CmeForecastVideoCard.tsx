// --- START OF FILE src/components/CmeForecastVideoCard.tsx ---

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ProcessedCME } from '../types';
import { renderCmeForecastGif } from '../utils/cmeVideoRenderer';
import type { RenderProgress, RenderResult } from '../utils/cmeVideoRenderer';

type MediaObject =
  | { type: 'image'; url: string }
  | { type: 'video'; url: string }
  | { type: 'animation'; urls: string[] };

interface Props {
  cmes: ProcessedCME[];
  /** Hook into the modal's media viewer so clicking the preview opens the full-size viewer. */
  setViewerMedia: (media: MediaObject | null) => void;
}

/**
 * Generates a 12-day (past 7 days + next 5 days) CME propagation GIF in the
 * user's browser on demand, and shows it inside a ModelCard-style tile.
 *
 * We lean on the existing ModelCard wrapper in ForecastModelsModal for visual
 * consistency, but because this card has its own button / progress UI we
 * render its body contents directly rather than passing them as children.
 */
const CmeForecastVideoCard: React.FC<Props> = ({ cmes, setViewerMedia }) => {
  const [status, setStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [progress, setProgress] = useState<RenderProgress | null>(null);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const lastBlobUrlRef = useRef<string | null>(null);

  // Revoke old object URLs on unmount / regenerate so we don't leak memory
  useEffect(() => {
    return () => {
      if (lastBlobUrlRef.current) {
        try { URL.revokeObjectURL(lastBlobUrlRef.current); } catch { /* no-op */ }
      }
    };
  }, []);

  const usableCmeCount = cmes.filter(c => c.speed > 0).length;

  const handleGenerate = useCallback(async () => {
    if (usableCmeCount === 0) {
      setErrorMsg('No CMEs with propagation data in the current window.');
      setStatus('error');
      return;
    }
    // Reset previous result
    if (lastBlobUrlRef.current) {
      try { URL.revokeObjectURL(lastBlobUrlRef.current); } catch { /* no-op */ }
      lastBlobUrlRef.current = null;
    }
    setResult(null);
    setErrorMsg(null);
    setStatus('generating');
    // Reset cancel flag by mutating the existing object (renderer captures a
    // reference to it at call time — reassigning .current here would leave
    // the renderer pointing at a stale object).
    cancelRef.current.cancelled = false;

    try {
      const res = await renderCmeForecastGif({
        cmes,
        onProgress: p => setProgress(p),
        cancelRef: cancelRef.current,
      });
      lastBlobUrlRef.current = res.objectUrl;
      setResult(res);
      setStatus('ready');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Render failed';
      if (msg === 'cancelled') {
        setStatus('idle');
        setProgress(null);
      } else {
        // Non-cancel failure — surface the message but don't spam console
        console.warn('[CmeForecastVideoCard] render failed:', err);
        setErrorMsg(msg);
        setStatus('error');
      }
    }
  }, [cmes, usableCmeCount]);

  const handleCancel = useCallback(() => {
    cancelRef.current.cancelled = true;
  }, []);

  const openInViewer = useCallback(() => {
    if (result) {
      setViewerMedia({ type: 'image', url: result.objectUrl });
    }
  }, [result, setViewerMedia]);

  // ── Render ──
  // Uses the same visual language as the surrounding ModelCards.
  const progressPct = progress
    ? progress.phase === 'encoding'
      ? progress.current // encoding progress is 0–100
      : Math.round((progress.current / Math.max(1, progress.total)) * 100)
    : 0;

  return (
    <div className="bg-neutral-900/60 border border-neutral-700/50 rounded-xl p-4 flex flex-col gap-3">
      <div>
        <h3 className="text-lg font-bold text-white">Spot The Aurora Forecast</h3>
        <p className="text-xs text-neutral-400 mt-1">
          A 12-day CME propagation visualisation (last 7 days + next 5 days) generated
          from NASA DONKI data using drag-based propagation. GCS croissant shape,
          top-down and side views, like NOAA WSA-Enlil.
        </p>
      </div>

      {/* Preview area — switches between button / progress / result */}
      <div className="bg-neutral-800/50 p-2 rounded-lg aspect-[2/1] flex items-center justify-center relative overflow-hidden">
        {status === 'idle' && (
          <button
            onClick={handleGenerate}
            disabled={usableCmeCount === 0}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-sky-500/80 to-indigo-500/80 text-white text-sm font-semibold shadow-lg hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            title={usableCmeCount === 0 ? 'No CME data available' : 'Generate forecast video'}
          >
            Generate forecast video
          </button>
        )}

        {status === 'generating' && (
          <div className="flex flex-col items-center gap-3 w-full px-6">
            <div className="text-xs text-neutral-300 text-center">
              {progress?.message ?? 'Preparing...'}
            </div>
            <div className="w-full bg-neutral-700/60 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-sky-400 to-indigo-400 transition-all duration-150"
                style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
              />
            </div>
            <button
              onClick={handleCancel}
              className="text-xs text-neutral-400 hover:text-white transition-colors underline-offset-2 hover:underline"
            >
              Cancel
            </button>
          </div>
        )}

        {status === 'ready' && result && (
          <img
            src={result.objectUrl}
            alt="CME forecast animation"
            className="w-full h-full object-contain rounded cursor-pointer"
            onClick={openInViewer}
            title="Click to open full-size viewer"
          />
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center gap-2 text-center px-4">
            <div className="text-xs text-rose-300">{errorMsg ?? 'Render failed'}</div>
            <button
              onClick={handleGenerate}
              className="text-xs text-sky-300 hover:text-sky-200 underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      {/* Status footer */}
      <div className="flex items-center justify-between text-[11px] text-neutral-500">
        <span>
          {usableCmeCount > 0
            ? `Based on ${usableCmeCount} CME${usableCmeCount === 1 ? '' : 's'} from NASA DONKI`
            : 'No CME data available'}
        </span>
        {status === 'ready' && (
          <button
            onClick={handleGenerate}
            className="text-sky-400 hover:text-sky-300 transition-colors"
          >
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
};

export default CmeForecastVideoCard;

// --- END OF FILE src/components/CmeForecastVideoCard.tsx ---