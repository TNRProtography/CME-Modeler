// A small "NASA offline" badge for the header, shown only while NASA's DONKI
// service (CMEs, flares, shocks) has not answered for a while.
//
// The nasa-donki-api worker keeps the last good data for a week and falls back
// to CCMC's own DONKI service when NASA's public API is down, so the app keeps
// working through an outage; this says the CME and flare lists may be behind,
// and since when. Tapping it explains.

import React, { useEffect, useState } from 'react';
import { whenAppIdle } from '../utils/appReady';

const DONKI_STATUS_URL = 'https://nasa-donki-api.thenamesrock.workers.dev/status';
const POLL_MS = 5 * 60000;

interface DonkiStatus {
  online: boolean;
  cached_at: string | null;
  age_minutes: number | null;
  last_error: string | null;
}

const fmtNz = (iso: string) => new Date(iso).toLocaleString('en-NZ', {
  timeZone: 'Pacific/Auckland', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
});

const ago = (minutes: number) => (minutes < 120 ? `${minutes} min` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`);

const NasaOfflineBadge: React.FC = () => {
  const [status, setStatus] = useState<DonkiStatus | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      try {
        const res = await fetch(DONKI_STATUS_URL, { signal: AbortSignal.timeout(8000) });
        if (res.ok) {
          const s = await res.json();
          if (!cancelled && typeof s?.online === 'boolean') setStatus(s);
        }
      } catch { /* the worker itself unreachable: say nothing rather than guess */ }
      if (!cancelled) timer = window.setTimeout(check, POLL_MS);
    };
    // Not on the critical path: after the first page is up.
    whenAppIdle().then(() => { if (!cancelled) check(); });
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, []);

  if (!status || status.online) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-xl text-[10px] sm:text-xs font-semibold text-amber-200 bg-amber-900/40 border border-amber-500/40 hover:bg-amber-900/60 transition-colors"
        title="NASA's DONKI service is offline"
        aria-label="NASA offline - tap for details"
        aria-expanded={open}
      >
        {/* A planet and orbit, struck through. */}
        <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" aria-hidden="true">
          <circle cx="8" cy="8" r="3.2" fill="currentColor" opacity="0.85" />
          <ellipse cx="8" cy="8" rx="7" ry="2.6" fill="none" stroke="currentColor" strokeWidth="1.1" transform="rotate(-25 8 8)" />
          <line x1="2" y1="14" x2="14" y2="2" stroke="#f87171" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>NASA offline</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 z-50 rounded-lg border border-amber-500/30 bg-neutral-950/95 p-3 text-xs text-neutral-300 shadow-2xl">
          <p className="font-semibold text-amber-200 mb-1">NASA's DONKI service isn't answering</p>
          <p>
            CMEs, flares and shocks come from NASA. Until it is back, the app shows what it last received
            {status.cached_at
              ? <> - <span className="text-neutral-100">{fmtNz(status.cached_at)}</span>{status.age_minutes != null && <> ({ago(status.age_minutes)} ago)</>}.</>
              : <>, and has nothing stored yet.</>}
          </p>
          <p className="mt-1.5 text-neutral-500">Everything else - the forecast, solar wind, imagery and sunspots - comes from elsewhere and is unaffected.</p>
        </div>
      )}
    </div>
  );
};

export default NasaOfflineBadge;
