// --- START OF FILE src/components/AppTutorial.tsx ---

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TutorialAction {
  page?: 'forecast' | 'solar-activity' | 'modeler';
  forecastView?: 'simple' | 'advanced';
  openSettings?: boolean;
  closeSettings?: boolean;
  openControlsPanel?: boolean;
  closeControlsPanel?: boolean;
  toggleHss?: boolean;
  scrollTo?: string;
  highlightId?: string;
  /** Anything else the step needs once its page is up, e.g. selecting a CME. */
  run?: () => void;
}

export interface TutorialStep {
  id: string;
  section: string;
  title: string;
  content: string;
  emoji: string;
  action: TutorialAction;
  placement?: 'bottom' | 'top';
}

// ── Steps ────────────────────────────────────────────────────────────────────

const DEFAULT_STEPS: TutorialStep[] = [
  {
    id: 'welcome', section: 'Welcome', emoji: '🌌',
    title: 'Welcome to Spot The Aurora',
    content: 'Your space weather and aurora forecast app for New Zealand. This walkthrough visits every page, from tonight\'s forecast back to the Sun, and takes about two minutes.',
    action: {}, placement: 'bottom',
  },
  {
    id: 'simple-forecast', section: 'Forecast: Simple View', emoji: '🔮',
    title: 'What to Expect',
    content: 'Your aurora forecast for where you are. What you can expect to see now, in 15 and 30 minutes, an hour and two hours: naked eye, phone camera or a camera on a tripod. The dots show confidence: green high, amber medium, grey a rough guide.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'visibility-forecast-panel', highlightId: 'visibility-forecast-panel' },
    placement: 'bottom',
  },
  {
    id: 'simple-map', section: 'Forecast: Simple View', emoji: '🗺️',
    title: 'Sightings Map and Aurora Oval',
    content: 'Sightings from people around New Zealand, and yours with one tap. The coloured band is the aurora oval and the dashed line is how far north it can be seen. Slide the timeline under the map to run the oval forward up to two hours.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'aurora-sightings-section', highlightId: 'aurora-sightings-section' },
    placement: 'top',
  },
  {
    id: 'simple-3day', section: 'Forecast: Simple View', emoji: '📅',
    title: 'The Next Three Days',
    content: 'The app\'s own forecast, hour by hour: a <strong>full block for naked eye</strong>, two thirds for a phone, a third for a camera. It allows for daylight, twilight and the Moon, and marks when a coronal hole stream or a CME is due to arrive. Tap any hour for details.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'kp-forecast-section', highlightId: 'kp-forecast-section' },
    placement: 'top',
  },
  {
    id: 'simple-cloud', section: 'Forecast: Simple View', emoji: '☁️',
    title: 'Cloud Cover and Webcams',
    content: 'Windy.com cloud forecast for NZ. If you can\'t see stars looking south, you won\'t see aurora. Below it are live cameras from around New Zealand, to check a sky before you drive to it.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'cloud-cover-section', highlightId: 'cloud-cover-section' },
    placement: 'top',
  },
  {
    id: 'advanced-overview', section: 'Forecast: Advanced View', emoji: '📊',
    title: 'Advanced View',
    content: 'Every number behind the forecast: the magnetic field (IMF Bz and Bt), solar wind speed, density, temperature, pressure and coupling, over 24 hours. If you want to know <em>why</em> the forecast says what it says, look here. Every panel has a <strong>?</strong> with a plain explanation.',
    action: { page: 'forecast', forecastView: 'advanced', scrollTo: 'imf-chart-section', highlightId: 'imf-chart-section' },
    placement: 'bottom',
  },
  {
    id: 'advanced-substorm', section: 'Forecast: Advanced View', emoji: '⚡',
    title: 'Substorms and the Magnetotail',
    content: 'Substorms are the bursts that make the aurora suddenly brighten and dance. The Substorm Index shows how close the next one is, and below it the <strong>Magnetotail</strong> shows the tail loading up and snapping, live. Tap <strong>How aurora forms</strong> for a 3D explainer.',
    action: { page: 'forecast', forecastView: 'advanced', scrollTo: 'substorm-index-section', highlightId: 'substorm-index-section' },
    placement: 'top',
  },
  {
    id: 'advanced-solarwind', section: 'Forecast: Advanced View', emoji: '🌬️',
    title: 'Solar Wind Quick View',
    content: 'Field, speed, density and temperature stacked on one timeline. When they all jump together, a CME shock has just hit the satellites, and it reaches us in under an hour.',
    action: { page: 'forecast', forecastView: 'advanced', scrollTo: 'solar-wind-quick-view-section', highlightId: 'solar-wind-quick-view-section' },
    placement: 'top',
  },
  {
    id: 'solar-xray', section: 'Solar Dashboard', emoji: '💥',
    title: 'Solar Flares',
    content: 'Live X-ray flux with the C, M and X class levels marked. Every flare is listed with where on the Sun it came from, and if it launched a CME, one tap takes you to that CME in the 3D view.',
    action: { page: 'solar-activity', scrollTo: 'goes-xray-flux-section', highlightId: 'goes-xray-flux-section' },
    placement: 'top',
  },
  {
    id: 'solar-suvi', section: 'Solar Dashboard', emoji: '☀️',
    title: 'SUVI Solar Imagery',
    content: 'Four wavelengths, each showing something different. <strong>131</strong> flares, <strong>195</strong> and <strong>284</strong> coronal holes and loops, <strong>304</strong> eruptions and filaments. Play back up to a week at up to 20x, and turn on <strong>Difference</strong> to show anything that moved.',
    action: { page: 'solar-activity', scrollTo: 'suvi-imagery-section', highlightId: 'suvi-imagery-section' },
    placement: 'top',
  },
  {
    id: 'solar-coronagraph', section: 'Solar Dashboard', emoji: '🌑',
    title: 'Coronagraph Imagery',
    content: 'Blocks the bright Sun to show the corona around it, where a CME shows as an expanding cloud. GOES-19 CCOR-1, SWFO-L1 CCOR-2, SOHO LASCO C2 and C3, and STEREO-A. Difference mode makes CMEs far easier to spot.',
    action: { page: 'solar-activity', scrollTo: 'coronagraph-section', highlightId: 'coronagraph-section' },
    placement: 'top',
  },
  {
    id: 'solar-sunspots', section: 'Solar Dashboard', emoji: '🔴',
    title: 'Sunspot Tracker',
    content: 'Every numbered region on the Sun, placed every twelve minutes. Scrub back up to a week and regions appear and fade when they really did. Tap one for its flare chances, size, spots and magnetic field over time, whether it is growing, and when it faces Earth. <strong>Beta-Gamma-Delta</strong> regions are the ones that make X-class flares.',
    action: { page: 'solar-activity', scrollTo: 'active-sunspots-section', highlightId: 'active-sunspots-section' },
    placement: 'top',
  },
  {
    id: 'solar-holes', section: 'Solar Dashboard', emoji: '🕳️',
    title: 'Coronal Hole Tracker',
    content: 'Dark patches where the Sun\'s field opens and fast wind escapes, a common driver of aurora in New Zealand. Each hole is found live, with its size, polarity, stream speed and when that stream reaches Earth, and keeps its number and 90 days of history.',
    action: { page: 'solar-activity', scrollTo: 'coronal-hole-tracker-section', highlightId: 'coronal-hole-tracker-section' },
    placement: 'top',
  },
  {
    id: 'cme-overview', section: 'CME Visualization', emoji: '🌍',
    title: 'CMEs in 3D',
    content: 'Every CME travelling from the Sun to Earth, in live 3D, slowed by the solar wind it ploughs through and tilted the way it left the Sun. Rotate and zoom, play the timeline at up to 20x, and tap a CME for its details and arrival time.',
    action: { page: 'modeler' },
    placement: 'bottom',
  },
  {
    id: 'cme-hss', section: 'CME Visualization', emoji: '💨',
    title: 'Coronal Holes and High Speed Streams',
    content: 'Coronal holes sit on the Sun in their real shape, and their streams spiral out past Earth, growing from the wind each hole has actually blown. Each stream shows its compression, fast wind and rarefaction, and CMEs and streams interact.',
    action: { page: 'modeler', openControlsPanel: true, toggleHss: true, scrollTo: 'show-hss-toggle', highlightId: 'show-hss-toggle' },
    placement: 'bottom',
  },
  {
    id: 'notifications', section: 'Settings', emoji: '🔔',
    title: 'Aurora Notifications',
    content: 'Pick a preset for your gear, naked eye, phone, DSLR or everything, or choose each alert yourself: visibility, substorm stages, flares by class, Earth-directed CMEs above a speed you set, and CME arrivals. Tapping an alert opens the app at what it is about. Install the app to your home screen first for reliable alerts.',
    action: { closeControlsPanel: true, toggleHss: false, openSettings: true, scrollTo: 'settings-notifications-section', highlightId: 'settings-notifications-section' },
    placement: 'top',
  },
  {
    id: 'finish', section: 'All Done', emoji: '🎉',
    title: 'Go Chase Some Aurora',
    content: 'That\'s everything. Free and ad-free, always. <strong>Simple View</strong> for a quick check, <strong>Advanced</strong> for the data, the <strong>Solar Dashboard</strong> for the Sun, and the <strong>CME Visualization</strong> for what is on its way. This tutorial is in Settings any time. Clear skies! 🌌',
    action: { closeSettings: true, closeControlsPanel: true, toggleHss: false, page: 'forecast', forecastView: 'simple' },
    placement: 'bottom',
  },
];

// ── Highlight overlay component ──────────────────────────────────────────────
// Instead of CSS pseudo-elements (which break on overflow:hidden),
// render an absolutely-positioned overlay div that tracks the target element.

const HighlightOverlay: React.FC<{ targetId: string | null }> = ({ targetId }) => {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!targetId) { setRect(null); return; }

    let attempts = 0;
    const maxAttempts = 30; // try for up to 3 seconds

    const tryFind = () => {
      const el = document.getElementById(targetId);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) {
          setRect(r);
          // Keep tracking position in case of scroll
          const track = () => {
            const el2 = document.getElementById(targetId);
            if (el2) setRect(el2.getBoundingClientRect());
            rafRef.current = requestAnimationFrame(track);
          };
          rafRef.current = requestAnimationFrame(track);
          return;
        }
      }
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(tryFind, 100);
      }
    };

    // Start looking after a short delay for page transition
    setTimeout(tryFind, 200);

    return () => {
      cancelAnimationFrame(rafRef.current);
      setRect(null);
    };
  }, [targetId]);

  if (!rect || !targetId) return null;

  return createPortal(
    <div
      className="pointer-events-none fixed z-[9997]"
      style={{
        top: rect.top - 4,
        left: rect.left - 4,
        width: rect.width + 8,
        height: rect.height + 8,
        border: '2px solid rgba(56, 189, 248, 0.5)',
        borderRadius: '12px',
        boxShadow: '0 0 20px 4px rgba(56, 189, 248, 0.12)',
        animation: 'tutorial-ring-pulse 2s ease-in-out infinite',
      }}
    />,
    document.body
  );
};

// ── Main component ───────────────────────────────────────────────────────────

export interface AppTutorialProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToPage: (page: 'forecast' | 'solar-activity' | 'modeler') => void;
  onForecastViewChange: (mode: 'simple' | 'advanced') => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onOpenControlsPanel: () => void;
  onCloseControlsPanel: () => void;
  onToggleHss: (show: boolean) => void;
  /** A different tour: the what's-new tour passes its own steps. */
  steps?: TutorialStep[];
  skipLabel?: string;
}

const DEFAULT_SECTIONS = ['Welcome', 'Forecast: Simple View', 'Forecast: Advanced View', 'Solar Dashboard', 'CME Visualization', 'Settings', 'All Done'];

const AppTutorial: React.FC<AppTutorialProps> = ({
  isOpen, onClose, onNavigateToPage, onForecastViewChange, onOpenSettings, onCloseSettings, onOpenControlsPanel, onCloseControlsPanel, onToggleHss,
  steps, skipLabel = 'Skip tutorial',
}) => {
  const STEPS = steps ?? DEFAULT_STEPS;
  const SECTIONS = steps ? [...new Set(steps.map((s) => s.section))] : DEFAULT_SECTIONS;
  const [stepIndex, setStepIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (isOpen) { setStepIndex(0); setActiveHighlightId(null); } }, [isOpen]);

  // Scroll to element with retry
  const scrollToElement = useCallback((id: string) => {
    let attempts = 0;
    const tryScroll = () => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      attempts++;
      if (attempts < 20) {
        scrollTimeoutRef.current = setTimeout(tryScroll, 150);
      }
    };
    tryScroll();
  }, []);

  // Execute the action for the current step
  const executeAction = useCallback((action: TutorialAction) => {
    setIsTransitioning(true);
    setActiveHighlightId(null);

    // Close settings if needed
    if (action.closeSettings) onCloseSettings();

    // Close controls panel first if explicitly requested AND we're not about to open it
    if (action.closeControlsPanel && !action.openControlsPanel) onCloseControlsPanel();

    // Navigate to page (but skip if openControlsPanel is set - that implies modeler page)
    if (action.page && !action.openControlsPanel) onNavigateToPage(action.page);

    // Switch forecast view
    if (action.forecastView) onForecastViewChange(action.forecastView);

    // Open settings
    if (action.openSettings) onOpenSettings();

    // If opening controls panel, use that as the navigation (it navigates to modeler + overlay)
    if (action.openControlsPanel) onOpenControlsPanel();

    // Determine delay based on context
    const isPageChange = !!action.page || !!action.openControlsPanel;
    const isSolarDashboard = action.page === 'solar-activity';
    const baseDelay = isSolarDashboard ? 1500 : isPageChange ? 800 : 400;

    setTimeout(() => {
      // Toggle HSS after page/panel has loaded
      if (action.toggleHss !== undefined) {
        onToggleHss(action.toggleHss);
      }
      if (action.run) { try { action.run(); } catch { /* a step's extra is never worth stopping the tour */ } }

      // Scroll after everything has settled
      const scrollDelay = action.toggleHss ? 600 : 0;
      setTimeout(() => {
        if (action.scrollTo) scrollToElement(action.scrollTo);
        setTimeout(() => {
          setActiveHighlightId(action.highlightId ?? null);
          setIsTransitioning(false);
        }, action.scrollTo ? 600 : 100);
      }, scrollDelay);
    }, baseDelay);
  }, [onNavigateToPage, onForecastViewChange, onOpenSettings, onCloseSettings, onOpenControlsPanel, onCloseControlsPanel, onToggleHss, scrollToElement]);

  // Execute action when step changes
  useEffect(() => {
    if (!isOpen) return;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    const step = STEPS[stepIndex];
    if (step) executeAction(step.action);
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, isOpen, executeAction]);

  // Clean up on close
  useEffect(() => {
    if (!isOpen) setActiveHighlightId(null);
  }, [isOpen]);

  const handleNext = useCallback(() => {
    if (stepIndex < STEPS.length - 1) setStepIndex(p => p + 1);
    else { setActiveHighlightId(null); onClose(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex, onClose, STEPS.length]);

  const handlePrev = useCallback(() => { setStepIndex(p => Math.max(0, p - 1)); }, []);

  const handleSkip = useCallback(() => { setActiveHighlightId(null); onClose(); }, [onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const currentSectionIndex = SECTIONS.indexOf(step.section);
  const isBottom = step.placement !== 'top';

  return createPortal(
    <>
      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes tutorial-ring-pulse {
          0%, 100% { border-color: rgba(56, 189, 248, 0.3); box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.08); }
          50% { border-color: rgba(56, 189, 248, 0.6); box-shadow: 0 0 24px 6px rgba(56, 189, 248, 0.15); }
        }
      `}</style>

      {/* Highlight overlay that tracks the target element */}
      <HighlightOverlay targetId={activeHighlightId} />

      {/* Floating tutorial card */}
      <div
        className={`fixed left-0 right-0 z-[9998] p-3 sm:p-4 transition-all duration-300 ${
          isBottom ? 'bottom-0' : 'top-0'
        } ${isTransitioning ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}
      >
        <div className="max-w-lg mx-auto bg-neutral-950/95 border border-neutral-700/80 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">{step.emoji}</span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">{step.section}</span>
            </div>
            <button onClick={handleSkip} className="text-[10px] text-neutral-600 hover:text-neutral-300 transition-colors">
              {skipLabel}
            </button>
          </div>

          {/* Content */}
          <div className="px-4 py-3">
            <h2 className="text-sm font-bold text-neutral-100 mb-2">{step.title}</h2>
            <p
              className="text-xs text-neutral-400 leading-relaxed [&_strong]:text-neutral-200 [&_em]:text-neutral-300"
              dangerouslySetInnerHTML={{ __html: step.content }}
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-800/60">
            <button
              onClick={handlePrev}
              disabled={isFirst}
              className="px-3 py-1.5 text-xs text-neutral-500 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              Back
            </button>
            <div className="flex items-center gap-3">
              <div className="flex gap-1">
                {SECTIONS.map((s, i) => (
                  <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === currentSectionIndex ? 'w-5 bg-sky-500'
                    : i < currentSectionIndex ? 'w-1.5 bg-sky-500/40'
                    : 'w-1.5 bg-neutral-700'
                  }`} />
                ))}
              </div>
              <span className="text-[10px] text-neutral-600 tabular-nums">{stepIndex + 1}/{STEPS.length}</span>
            </div>
            <button
              onClick={handleNext}
              className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
            >
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
};

export default AppTutorial;
// --- END OF FILE src/components/AppTutorial.tsx ---
