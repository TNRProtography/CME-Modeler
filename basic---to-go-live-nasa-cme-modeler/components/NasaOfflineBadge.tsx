// A small "NASA offline" badge for the sections that show NASA DONKI data
// (the CME list and the solar flares), shown while DONKI has not answered for
// a while - or straight away when that section's own fetch has failed.
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

// One status check for every badge on the page, refreshed every few minutes.
let shared: { status: DonkiStatus | null; atMs: number; pending: Promise<DonkiStatus | null> | null } = { status: null, atMs: 0, pending: null };
function donkiStatus(): Promise<DonkiStatus | null> {
  if (shared.pending) return shared.pending;
  if (shared.atMs && Date.now() - shared.atMs < POLL_MS - 1000) return Promise.resolve(shared.status);
  shared.pending = (async () => {
    try {
      const res = await fetch(DONKI_STATUS_URL, { signal: AbortSignal.timeout(8000) });
      const s = res.ok ? await res.json() : null;
      if (s && typeof s.online === 'boolean') shared.status = s;
    } catch { /* the worker itself unreachable: keep what we had */ }
    shared.atMs = Date.now();
    shared.pending = null;
    return shared.status;
  })();
  return shared.pending;
}

const NasaOfflineBadge: React.FC<{
  /** The section's own NASA fetch failed: show it whatever the status says. */
  failed?: boolean;
  /** Which way the details open. */
  align?: 'left' | 'right' | 'center';
}> = ({ failed = false, align = 'right' }) => {
  const [status, setStatus] = useState<DonkiStatus | null>(shared.status);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const check = async () => {
      const s = await donkiStatus();
      if (!cancelled && s) setStatus(s);
      if (!cancelled) timer = window.setTimeout(check, POLL_MS);
    };
    // Not on the critical path: after the first page is up.
    whenAppIdle().then(() => { if (!cancelled) check(); });
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, []);

  if (!failed && (!status || status.online)) return null;

  const side = align === 'left' ? 'left-0' : align === 'center' ? 'left-1/2 -translate-x-1/2' : 'right-0';
  return (
    <div className="relative inline-block">
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
        <div className={`absolute ${side} top-full mt-2 w-64 z-50 text-left rounded-lg border border-amber-500/30 bg-neutral-950/95 p-3 text-xs text-neutral-300 shadow-2xl`}>
          <p className="font-semibold text-amber-200 mb-1">NASA's DONKI service isn't answering</p>
          {status?.cached_at ? (
            <p>
              CMEs, flares and shocks come from NASA. Until it is back, this shows what was last received
              - <span className="text-neutral-100">{fmtNz(status.cached_at)}</span>
              {status.age_minutes != null && <> ({ago(status.age_minutes)} ago)</>}.
            </p>
          ) : (
            <p>
              CMEs, flares and shocks come from NASA. Nothing was stored from before it went down, so this will
              fill in once NASA is back - the app checks every minute.
            </p>
          )}
          <p className="mt-1.5 text-neutral-500">Everything else - the forecast, solar wind, imagery and sunspots - comes from elsewhere and is unaffected.</p>
        </div>
      )}
    </div>
  );
};

export default NasaOfflineBadge;
