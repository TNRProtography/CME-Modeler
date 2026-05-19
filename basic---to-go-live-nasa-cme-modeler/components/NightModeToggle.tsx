// --- START OF FILE src/components/NightModeToggle.tsx ---
//
// Night vision mode for mobile users.
// Compact toggle that sits below the Simple/Advanced view switcher.
// Applies a red-tinted overlay and dims the screen to preserve dark adaptation.

import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const NIGHT_MODE_KEY = 'night_mode_active';

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

// ── Brightness dimming ───────────────────────────────────────────────────────

const useDimming = (isActive: boolean) => {
  useEffect(() => {
    const root = document.getElementById('root') || document.body;
    if (isActive) {
      root.style.filter = 'brightness(0.55) saturate(0.6)';
      root.style.transition = 'filter 0.3s ease';
    } else {
      root.style.filter = '';
      root.style.transition = 'filter 0.3s ease';
    }
    return () => {
      root.style.filter = '';
      root.style.transition = '';
    };
  }, [isActive]);
};

// ── Component ────────────────────────────────────────────────────────────────

const NightModeToggle: React.FC = () => {
  const [isActive, setIsActive] = useState(() =>
    localStorage.getItem(NIGHT_MODE_KEY) === 'true'
  );
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useDimming(isActive);

  useEffect(() => {
    localStorage.setItem(NIGHT_MODE_KEY, isActive ? 'true' : 'false');
  }, [isActive]);

  const toggle = useCallback(() => setIsActive(prev => !prev), []);

  // Only render the button on mobile, but always render the overlay if active
  if (!isMobile) return <NightFilterOverlay isActive={isActive} />;

  return (
    <>
      <NightFilterOverlay isActive={isActive} />
      <div className="flex justify-center mb-4" style={{ position: 'relative', zIndex: 100000 }}>
        <button
          onClick={toggle}
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
          {/* Toggle indicator */}
          <div className={`w-7 h-4 rounded-full flex items-center transition-colors ${
            isActive ? 'bg-red-500/40 justify-end' : 'bg-neutral-700 justify-start'
          }`}>
            <div className={`w-3 h-3 rounded-full mx-0.5 transition-colors ${
              isActive ? 'bg-red-400' : 'bg-neutral-500'
            }`} />
          </div>
        </button>
      </div>
    </>
  );
};

export default NightModeToggle;
// --- END OF FILE src/components/NightModeToggle.tsx ---
