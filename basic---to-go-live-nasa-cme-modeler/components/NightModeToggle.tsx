// --- START OF FILE src/components/NightModeToggle.tsx ---
//
// Astronomy night vision mode.
// Applies a red filter overlay to preserve dark adaptation.
// No brightness dimming - reminds user to dim their screen manually.
// Can auto-activate 2 hours after sunset if enabled in settings.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// ── Storage keys ─────────────────────────────────────────────────────────────

const NIGHT_MODE_KEY = 'night_mode_active';
const NIGHT_AUTO_KEY = 'night_mode_auto_after_dark';
const NIGHT_REMINDER_SHOWN_KEY = 'night_mode_reminder_shown';

// ── Public helpers (used by SettingsModal) ────────────────────────────────────

export function getNightAutoAfterDark(): boolean {
  return localStorage.getItem(NIGHT_AUTO_KEY) === 'true';
}

export function setNightAutoAfterDark(value: boolean): void {
  localStorage.setItem(NIGHT_AUTO_KEY, value ? 'true' : 'false');
}

// ── Red filter overlay ───────────────────────────────────────────────────────

const NightFilterOverlay: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  if (!isActive || typeof document === 'undefined') return null;
  return createPortal(
    <div
      id="night-mode-overlay"
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: 99999,
        backgroundColor: 'rgba(120, 0, 0, 0.35)',
        mixBlendMode: 'multiply',
      }}
    />,
    document.body
  );
};

// ── Dim reminder toast ───────────────────────────────────────────────────────

const DimReminder: React.FC<{ show: boolean; onDismiss: () => void }> = ({ show, onDismiss }) => {
  if (!show || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className="fixed top-4 left-1/2 -translate-x-1/2 z-[100001] px-4 py-3 rounded-xl bg-neutral-950/95 border border-red-500/30 shadow-2xl max-w-xs text-center animate-fade-in"
      style={{ animation: 'fadeSlideIn 0.3s ease' }}
    >
      <p className="text-xs text-red-300 font-medium mb-1">Night mode on</p>
      <p className="text-[11px] text-neutral-400">For best results, also turn your phone screen brightness down manually.</p>
      <button
        onClick={onDismiss}
        className="mt-2 px-3 py-1 text-[10px] rounded-full bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors"
      >
        Got it
      </button>
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translate(-50%, -8px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
    </div>,
    document.body
  );
};

// ── Tooltip ──────────────────────────────────────────────────────────────────

const NightModeTooltip: React.FC<{ show: boolean; onClose: () => void }> = ({ show, onClose }) => {
  if (!show || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100002] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-neutral-950/95 border border-neutral-700/80 rounded-xl shadow-2xl max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-bold text-neutral-100 mb-2">Night Vision Mode</h3>
        <p className="text-xs text-neutral-400 leading-relaxed mb-3">
          Applies a red filter over the app to help preserve your dark adaptation when viewing aurora. Your eyes take about 20 to 30 minutes to fully adapt to darkness, and exposure to white or blue light resets that process.
        </p>
        <p className="text-xs text-neutral-400 leading-relaxed mb-3">
          Red light has the least impact on your night vision, so using this mode while checking the forecast in the field means you can look up at the sky straight away without waiting for your eyes to readjust.
        </p>
        <p className="text-xs text-neutral-400 leading-relaxed mb-3">
          You can also set night mode to turn on automatically after dark in Settings. It will activate 2 hours after sunset at your location.
        </p>
        <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg bg-neutral-800 text-neutral-300 hover:bg-neutral-700 transition-colors">
          Close
        </button>
      </div>
    </div>,
    document.body
  );
};

// ── Component ────────────────────────────────────────────────────────────────

interface NightModeToggleProps {
  sunsetMs?: number | null; // sunset timestamp in ms from celestialTimes
}

const NightModeToggle: React.FC<NightModeToggleProps> = ({ sunsetMs }) => {
  const [isActive, setIsActive] = useState(() =>
    localStorage.getItem(NIGHT_MODE_KEY) === 'true'
  );
  const [isMobile, setIsMobile] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const autoActivatedRef = useRef(false);

  // Mobile detection
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Persist state
  useEffect(() => {
    localStorage.setItem(NIGHT_MODE_KEY, isActive ? 'true' : 'false');
  }, [isActive]);

  // Auto-activate 2 hours after sunset if enabled
  useEffect(() => {
    if (autoActivatedRef.current) return;
    if (!sunsetMs) return;
    const autoEnabled = getNightAutoAfterDark();
    if (!autoEnabled) return;

    const now = Date.now();
    const twoHoursAfterSunset = sunsetMs + (2 * 60 * 60 * 1000);

    if (now >= twoHoursAfterSunset && !isActive) {
      setIsActive(true);
      autoActivatedRef.current = true;
    }
  }, [sunsetMs, isActive]);

  // Show dim reminder on first activation per session
  const handleToggle = useCallback(() => {
    setIsActive(prev => {
      const next = !prev;
      if (next) {
        const reminderShown = sessionStorage.getItem(NIGHT_REMINDER_SHOWN_KEY);
        if (!reminderShown) {
          setShowReminder(true);
          sessionStorage.setItem(NIGHT_REMINDER_SHOWN_KEY, 'true');
          setTimeout(() => setShowReminder(false), 6000);
        }
      }
      return next;
    });
  }, []);

  const handleLongPress = useCallback(() => {
    setShowTooltip(true);
  }, []);

  // Only render button on mobile, always render overlay if active
  if (!isMobile) return <NightFilterOverlay isActive={isActive} />;

  return (
    <>
      <NightFilterOverlay isActive={isActive} />
      <DimReminder show={showReminder} onDismiss={() => setShowReminder(false)} />
      <NightModeTooltip show={showTooltip} onClose={() => setShowTooltip(false)} />

      <div className="flex justify-center items-center gap-2 mb-4" style={{ position: 'relative', zIndex: 100000 }}>
        <button
          onClick={handleToggle}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 border ${
            isActive
              ? 'bg-red-950/60 border-red-500/40 text-red-400'
              : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
          }`}
        >
          {/* Eye icon */}
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>{isActive ? 'Night mode on' : 'Night mode'}</span>
          {/* Toggle switch */}
          <div className={`w-7 h-4 rounded-full flex items-center transition-all ${
            isActive ? 'bg-red-500/40 justify-end' : 'bg-neutral-700 justify-start'
          }`}>
            <div className={`w-3 h-3 rounded-full mx-0.5 transition-all ${
              isActive ? 'bg-red-400' : 'bg-neutral-500'
            }`} />
          </div>
        </button>
        {/* Info button - matches the ? button above for simple/advanced view */}
        <button
          onClick={handleLongPress}
          className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
          title="What is night mode?"
        >
          ?
        </button>
      </div>
    </>
  );
};

export default NightModeToggle;
// --- END OF FILE src/components/NightModeToggle.tsx ---
