// --- START OF FILE src/components/NightModeToggle.tsx ---
//
// Astronomy night vision mode for mobile users.
//
// Strategy: Instead of a crude red overlay that kills blue/green elements,
// we apply a combination of:
//   1. CSS hue-rotate (180deg) + sepia + saturate to shift the entire palette
//      toward warm red/amber tones while preserving luminance relationships
//   2. Reduced brightness to dim the overall output
//   3. A subtle dark red overlay for extra warmth
//
// This keeps ALL text, charts, icons, and UI elements visible and readable,
// just shifted into the red/amber spectrum that doesn't destroy dark adaptation.

import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const NIGHT_MODE_KEY = 'night_mode_active';

// ── Night mode CSS injected globally ─────────────────────────────────────────

const NIGHT_MODE_STYLE_ID = 'night-mode-styles';

const NIGHT_CSS = `
  /* Night mode: shift entire app to red/amber spectrum */
  #root.night-mode {
    filter: sepia(1) saturate(2.5) hue-rotate(335deg) brightness(0.55);
    transition: filter 0.4s ease;
  }

  /* Make sure the night overlay and toggle sit outside the filter */
  #night-mode-overlay,
  #night-mode-toggle-container {
    /* These are portalled outside #root, so they're not affected */
  }

  /* Boost text contrast slightly within night mode */
  #root.night-mode .text-neutral-400,
  #root.night-mode .text-neutral-500 {
    filter: brightness(1.3);
  }

  /* Keep white text readable */
  #root.night-mode .text-white,
  #root.night-mode .text-neutral-100,
  #root.night-mode .text-neutral-200 {
    filter: brightness(1.15);
  }
`;

function injectStyles() {
  if (document.getElementById(NIGHT_MODE_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = NIGHT_MODE_STYLE_ID;
  style.textContent = NIGHT_CSS;
  document.head.appendChild(style);
}

function applyNightMode(active: boolean) {
  const root = document.getElementById('root');
  if (!root) return;
  if (active) {
    injectStyles();
    root.classList.add('night-mode');
  } else {
    root.classList.remove('night-mode');
  }
}

// ── Subtle warm overlay (portalled above everything) ─────────────────────────

const NightOverlay: React.FC<{ isActive: boolean }> = ({ isActive }) => {
  if (!isActive || typeof document === 'undefined') return null;
  return createPortal(
    <div
      id="night-mode-overlay"
      className="fixed inset-0 pointer-events-none"
      style={{
        zIndex: 99999,
        background: 'radial-gradient(ellipse at center, rgba(40, 0, 0, 0.15) 0%, rgba(60, 0, 0, 0.25) 100%)',
      }}
    />,
    document.body
  );
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

  // Apply/remove night mode class
  useEffect(() => {
    applyNightMode(isActive);
    localStorage.setItem(NIGHT_MODE_KEY, isActive ? 'true' : 'false');
    return () => applyNightMode(false);
  }, [isActive]);

  const toggle = useCallback(() => setIsActive(prev => !prev), []);

  // Only render button on mobile, but always apply filter if active
  if (!isMobile) return <NightOverlay isActive={isActive} />;

  return (
    <>
      <NightOverlay isActive={isActive} />
      <div className="flex justify-center mb-4" style={{ position: 'relative', zIndex: 100000 }}>
        <button
          onClick={toggle}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-all active:scale-95 border ${
            isActive
              ? 'bg-red-950/60 border-red-500/40 text-red-400'
              : 'bg-white/5 border-white/10 text-neutral-400 hover:text-neutral-200'
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>{isActive ? 'Night mode on' : 'Night mode'}</span>
          <div className={`w-7 h-4 rounded-full flex items-center transition-all ${
            isActive ? 'bg-red-500/40 justify-end' : 'bg-neutral-700 justify-start'
          }`}>
            <div className={`w-3 h-3 rounded-full mx-0.5 transition-all ${
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
