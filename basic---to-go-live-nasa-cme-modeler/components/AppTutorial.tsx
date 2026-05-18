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
}

interface TutorialStep {
  id: string;
  section: string;
  title: string;
  content: string;
  emoji: string;
  action: TutorialAction;
  placement?: 'bottom' | 'top';
}

// ── Steps ────────────────────────────────────────────────────────────────────

const STEPS: TutorialStep[] = [
  {
    id: 'welcome', section: 'Welcome', emoji: '🌌',
    title: 'Welcome to Spot The Aurora',
    content: 'Your all-in-one space weather and aurora forecast app for New Zealand. This walkthrough will take you through each section of the app.',
    action: {}, placement: 'bottom',
  },
  {
    id: 'simple-forecast', section: 'Forecast: Simple View', emoji: '🔮',
    title: 'What to Expect',
    content: 'Your aurora forecast, personalised to your GPS location. Shows what visibility to expect now, in 15 min, 30 min, 1 hour and 2 hours. Coloured dots show confidence: green = high, amber = medium, grey = rough guide.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'visibility-forecast-panel', highlightId: 'visibility-forecast-panel' },
    placement: 'bottom',
  },
  {
    id: 'simple-map', section: 'Forecast: Simple View', emoji: '🗺️',
    title: 'Sightings Map and Aurora Oval',
    content: 'Real-time user reports from across NZ. The coloured band is the aurora oval (green = quiet, red = storm). The blue dashed line is the visibility horizon. If it\'s over your town, you should see aurora on camera looking south.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'aurora-sightings-section', highlightId: 'aurora-sightings-section' },
    placement: 'top',
  },
  {
    id: 'simple-3day', section: 'Forecast: Simple View', emoji: '📅',
    title: '3-Day Aurora Forecast',
    content: 'NOAA\'s 3-day outlook with sunrise/sunset and moonrise/moonset times. Green bars = aurora base, pink = active, blue = intense (G3+). Aurora needs dark skies. Tap any window for details.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'kp-forecast-section', highlightId: 'kp-forecast-section' },
    placement: 'top',
  },
  {
    id: 'simple-cloud', section: 'Forecast: Simple View', emoji: '☁️',
    title: 'Cloud Cover and Webcams',
    content: 'Windy.com cloud forecast for NZ. If you can\'t see stars looking south, you won\'t see aurora. Below this are live webcams from around New Zealand.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'cloud-cover-section', highlightId: 'cloud-cover-section' },
    placement: 'top',
  },
  {
    id: 'advanced-overview', section: 'Forecast: Advanced View', emoji: '📊',
    title: 'Advanced View',
    content: 'Everything from Simple View plus 24-hour charts of all solar wind data: IMF Bz/Bt, speed, density, temperature, dynamic pressure, and Newell coupling. The IMF clock shows magnetic field orientation. If you want to know <em>why</em> the forecast says what it says, look here.',
    action: { page: 'forecast', forecastView: 'advanced', scrollTo: 'imf-chart-section', highlightId: 'imf-chart-section' },
    placement: 'bottom',
  },
  {
    id: 'solar-suvi', section: 'Solar Dashboard', emoji: '☀️',
    title: 'SUVI Solar Imagery',
    content: 'Three wavelengths, each showing different solar features. <strong>131</strong> = flare locations. <strong>304</strong> = eruptions and filaments. <strong>195</strong> = structures leaving the sun. Toggle <strong>Difference mode</strong> to highlight anything that moved between frames.',
    action: { page: 'solar-activity', scrollTo: 'suvi-imagery-section', highlightId: 'suvi-imagery-section' },
    placement: 'top',
  },
  {
    id: 'solar-coronagraph', section: 'Solar Dashboard', emoji: '🌑',
    title: 'Coronagraph Imagery',
    content: 'Blocks the bright solar disk to reveal the outer corona. CMEs appear as expanding clouds moving outward. Multiple sources: GOES-19, SOHO LASCO C2/C3, and STEREO-A. Difference mode makes CMEs far easier to spot.',
    action: { page: 'solar-activity', scrollTo: 'coronagraph-section', highlightId: 'coronagraph-section' },
    placement: 'top',
  },
  {
    id: 'solar-sunspots', section: 'Solar Dashboard', emoji: '🔴',
    title: 'Sunspot Tracker',
    content: 'Active regions classified by danger level. <strong>Alpha</strong> = stable. <strong>Beta</strong> = minor flares. <strong>Beta-Gamma</strong> = strong flares possible. <strong>Beta-Gamma-Delta</strong> = X-class flares and major CMEs. Tap any region for details.',
    action: { page: 'solar-activity', scrollTo: 'active-sunspots-section', highlightId: 'active-sunspots-section' },
    placement: 'top',
  },
  {
    id: 'cme-overview', section: 'CME Visualization', emoji: '🌍',
    title: 'World-First 3D CME Model',
    content: 'The first public tool that lets you watch Coronal Mass Ejections travel from the Sun to Earth in live 3D. Rotate and zoom the view. Use the timeline to play, pause, and scrub through time. Tap any CME in the list to focus on it.',
    action: { page: 'modeler' },
    placement: 'bottom',
  },
  {
    id: 'cme-hss', section: 'CME Visualization', emoji: '💨',
    title: 'Coronal Hole / HSS Visualization',
    content: 'Another world first. Coronal holes and the high-speed solar wind streams they produce are now visible spiralling through the solar system. HSS interact with CMEs and are a common aurora driver in NZ.',
    action: { page: 'modeler', openControlsPanel: true, toggleHss: true, scrollTo: 'show-hss-toggle', highlightId: 'show-hss-toggle' },
    placement: 'bottom',
  },
  {
    id: 'notifications', section: 'Settings', emoji: '🔔',
    title: 'Aurora Notifications',
    content: 'Pick a preset based on your gear: naked eye, phone camera, DSLR, or everything. Or go fully custom and toggle each alert individually. Install the app to your home screen first for reliable notifications.',
    action: { openSettings: true },
    placement: 'bottom',
  },
  {
    id: 'finish', section: 'All Done', emoji: '🎉',
    title: 'Go Chase Some Aurora',
    content: 'That\'s everything. Free, ad-free, always will be. Start with <strong>Simple View</strong> for a quick check, <strong>Advanced</strong> for the data, <strong>Solar Dashboard</strong> for the sun, and <strong>CME Visualization</strong> to track storms in 3D. Clear skies! 🌌',
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
}

const SECTIONS = ['Welcome', 'Forecast: Simple View', 'Forecast: Advanced View', 'Solar Dashboard', 'CME Visualization', 'Settings', 'All Done'];

const AppTutorial: React.FC<AppTutorialProps> = ({
  isOpen, onClose, onNavigateToPage, onForecastViewChange, onOpenSettings, onCloseSettings, onOpenControlsPanel, onCloseControlsPanel, onToggleHss,
}) => {
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

    // Close settings/controls first if needed
    if (action.closeSettings) onCloseSettings();
    if (action.closeControlsPanel) onCloseControlsPanel();

    // Navigate to page
    if (action.page) onNavigateToPage(action.page);

    // Switch forecast view
    if (action.forecastView) onForecastViewChange(action.forecastView);

    // Open settings or controls panel
    if (action.openSettings) onOpenSettings();

    // Determine delay based on context
    const isPageChange = !!action.page;
    const isSolarDashboard = action.page === 'solar-activity';
    const baseDelay = isSolarDashboard ? 1500 : isPageChange ? 800 : 400;

    setTimeout(() => {
      // Open controls panel after page has loaded
      if (action.openControlsPanel) onOpenControlsPanel();

      // Toggle HSS after controls panel opens
      if (action.toggleHss !== undefined) {
        setTimeout(() => onToggleHss(action.toggleHss!), 400);
      }

      // Scroll after everything has settled
      const scrollDelay = (action.openControlsPanel ? 600 : 0) + (action.toggleHss ? 200 : 0);
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
  }, [stepIndex, isOpen, executeAction]);

  // Clean up on close
  useEffect(() => {
    if (!isOpen) setActiveHighlightId(null);
  }, [isOpen]);

  const handleNext = useCallback(() => {
    if (stepIndex < STEPS.length - 1) setStepIndex(p => p + 1);
    else { setActiveHighlightId(null); onClose(); }
  }, [stepIndex, onClose]);

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
        <div className="max-w-lg mx-auto bg-neutral-950/95 backdrop-blur-xl border border-neutral-700/80 rounded-xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">{step.emoji}</span>
              <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">{step.section}</span>
            </div>
            <button onClick={handleSkip} className="text-[10px] text-neutral-600 hover:text-neutral-300 transition-colors">
              Skip tutorial
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
