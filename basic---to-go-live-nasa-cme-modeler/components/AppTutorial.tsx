// --- START OF FILE src/components/AppTutorial.tsx ---
//
// Interactive guided tutorial that navigates the user through the real app.
// Instead of showing screenshots, it takes the user to each section,
// scrolls to the relevant element, and shows a floating explanation card.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

// ── Step definitions ─────────────────────────────────────────────────────────

export interface TutorialAction {
  page?: 'forecast' | 'solar-activity' | 'modeler';
  forecastView?: 'simple' | 'advanced';
  openSettings?: boolean;
  closeSettings?: boolean;
  scrollTo?: string;       // element ID to scroll into view
  highlightId?: string;    // element ID to highlight with pulsing ring
  delay?: number;          // ms to wait after navigation before showing card
}

interface TutorialStep {
  id: string;
  section: string;
  title: string;
  content: string;         // short, punchy HTML
  emoji: string;
  action: TutorialAction;
  placement?: 'bottom' | 'top'; // card position relative to viewport
}

const STEPS: TutorialStep[] = [
  // ── Welcome (no navigation) ──
  {
    id: 'welcome',
    section: 'Welcome',
    emoji: '🌌',
    title: 'Welcome to Spot The Aurora',
    content: 'Your all-in-one space weather and aurora forecast app for New Zealand. This walkthrough will take you through each section of the app so you know where everything is.',
    action: {},
    placement: 'bottom',
  },

  // ── Simple View: What to Expect ──
  {
    id: 'simple-forecast',
    section: 'Forecast: Simple View',
    emoji: '🔮',
    title: 'What to Expect',
    content: 'This is your aurora forecast, personalised to your GPS location. It tells you what visibility to expect right now, in 15 min, 30 min, 1 hour and 2 hours. The coloured dots show confidence level — green is high, amber is medium, grey is a rough guide.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'visibility-forecast-panel', highlightId: 'visibility-forecast-panel', delay: 400 },
    placement: 'bottom',
  },

  // ── Simple View: Sightings Map ──
  {
    id: 'simple-map',
    section: 'Forecast: Simple View',
    emoji: '🗺️',
    title: 'Sightings Map and Aurora Oval',
    content: 'Real-time user reports from across NZ. The coloured band is the aurora oval (green = quiet, red = storm). The blue dashed line is the visibility horizon — if it\'s over your town, you should see aurora on camera looking south. Report icons: 👁️ naked eye, 📱 phone, 📷 DSLR, ❌ nothing seen.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'aurora-sightings-section', highlightId: 'aurora-sightings-section', delay: 300 },
    placement: 'top',
  },

  // ── Simple View: 3-Day Forecast ──
  {
    id: 'simple-3day',
    section: 'Forecast: Simple View',
    emoji: '📅',
    title: '3-Day Aurora Forecast',
    content: 'NOAA\'s 3-day outlook with sunrise/sunset and moonrise/moonset times. Green bars = aurora base, pink = active, blue = intense (G3+). Aurora needs dark skies — look at the dark sections between sunset and sunrise. Tap any window for details.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'kp-forecast-section', highlightId: 'kp-forecast-section', delay: 300 },
    placement: 'top',
  },

  // ── Simple View: Cloud Cover ──
  {
    id: 'simple-cloud',
    section: 'Forecast: Simple View',
    emoji: '☁️',
    title: 'Cloud Cover and Webcams',
    content: 'Windy.com cloud forecast for NZ. If you can\'t see stars looking south, you won\'t see aurora. Below this are live webcams from around New Zealand so you can check real sky conditions.',
    action: { page: 'forecast', forecastView: 'simple', scrollTo: 'cloud-cover-section', highlightId: 'cloud-cover-section', delay: 300 },
    placement: 'top',
  },

  // ── Advanced View ──
  {
    id: 'advanced-overview',
    section: 'Forecast: Advanced View',
    emoji: '📊',
    title: 'Advanced View',
    content: 'Everything from Simple View plus 24-hour charts of all solar wind data: IMF Bz/Bt, speed, density, temperature, dynamic pressure, and Newell coupling. The IMF clock shows magnetic field orientation at a glance. If you want to know <em>why</em> the forecast says what it says, this is where to look.',
    action: { page: 'forecast', forecastView: 'advanced', scrollTo: 'imf-chart-section', highlightId: 'imf-chart-section', delay: 600 },
    placement: 'bottom',
  },

  // ── Solar Dashboard: SUVI ──
  {
    id: 'solar-suvi',
    section: 'Solar Dashboard',
    emoji: '☀️',
    title: 'SUVI Solar Imagery',
    content: 'Three wavelengths, each showing different solar features. <strong>131</strong> = flare locations. <strong>304</strong> = eruptions and filaments. <strong>195</strong> = structures leaving the sun. Toggle <strong>Difference mode</strong> — it subtracts frames so anything moving lights up and stationary features disappear. Play through the timeline to watch activity unfold.',
    action: { page: 'solar-activity', scrollTo: 'suvi-imagery-section', highlightId: 'suvi-imagery-section', delay: 500 },
    placement: 'top',
  },

  // ── Solar Dashboard: Coronagraph ──
  {
    id: 'solar-coronagraph',
    section: 'Solar Dashboard',
    emoji: '🌑',
    title: 'Coronagraph Imagery',
    content: 'Blocks the bright solar disk to reveal the outer corona. CMEs appear as expanding clouds moving outward. Multiple sources: GOES-19, SOHO LASCO C2/C3, and STEREO-A. Difference mode makes CMEs far easier to spot. This is where you see storms coming days before they arrive at Earth.',
    action: { page: 'solar-activity', scrollTo: 'coronagraph-section', highlightId: 'coronagraph-section', delay: 300 },
    placement: 'top',
  },

  // ── Solar Dashboard: Sunspots ──
  {
    id: 'solar-sunspots',
    section: 'Solar Dashboard',
    emoji: '🔴',
    title: 'Sunspot Tracker',
    content: 'Active regions classified by danger level. <strong>Alpha</strong> = stable. <strong>Beta</strong> = minor flares. <strong>Beta-Gamma</strong> = strong flares possible. <strong>Beta-Gamma-Delta</strong> = the dangerous ones — X-class flares and major CMEs. Tap any region for close-up imagery, flare probabilities, and 7-day history.',
    action: { page: 'solar-activity', scrollTo: 'active-sunspots-section', highlightId: 'active-sunspots-section', delay: 300 },
    placement: 'top',
  },

  // ── CME Visualization ──
  {
    id: 'cme-overview',
    section: 'CME Visualization',
    emoji: '🌍',
    title: 'World-First 3D CME Model',
    content: 'The first public tool that lets you watch Coronal Mass Ejections travel from the Sun to Earth in live 3D. Rotate and zoom the view. Use the timeline to play, pause, and scrub through time at up to 20x speed. Tap any CME in the list to focus on it.',
    action: { page: 'modeler', delay: 800 },
    placement: 'bottom',
  },

  // ── CME: HSS ──
  {
    id: 'cme-hss',
    section: 'CME Visualization',
    emoji: '💨',
    title: 'Coronal Hole / HSS Visualization',
    content: 'Another world first. Toggle on to see coronal holes and the high-speed solar wind streams they produce spiralling through the solar system. HSS interact with CMEs and are one of the most common aurora drivers in NZ. Look for the toggle in the controls panel.',
    action: { page: 'modeler', scrollTo: 'controls-panel-container', highlightId: 'controls-panel-container', delay: 400 },
    placement: 'bottom',
  },

  // ── Settings: Notifications ──
  {
    id: 'notifications',
    section: 'Settings',
    emoji: '🔔',
    title: 'Aurora Notifications',
    content: 'Pick a preset based on your gear: naked eye, phone camera, DSLR, or everything. Or go fully custom and toggle each alert individually. Install the app to your home screen first for notifications to work reliably.',
    action: { openSettings: true, delay: 500 },
    placement: 'bottom',
  },

  // ── Finish ──
  {
    id: 'finish',
    section: 'All Done',
    emoji: '🎉',
    title: 'Go Chase Some Aurora',
    content: 'That\'s everything. Free, ad-free, always will be. Start with <strong>Simple View</strong> for a quick check, <strong>Advanced</strong> for the data, <strong>Solar Dashboard</strong> for the sun, and <strong>CME Visualization</strong> to track storms in 3D. Clear skies! 🌌',
    action: { closeSettings: true, page: 'forecast', forecastView: 'simple', delay: 300 },
    placement: 'bottom',
  },
];

// ── Component ────────────────────────────────────────────────────────────────

export interface AppTutorialProps {
  isOpen: boolean;
  onClose: () => void;
  // App navigation callbacks
  onNavigateToPage: (page: 'forecast' | 'solar-activity' | 'modeler') => void;
  onForecastViewChange: (mode: 'simple' | 'advanced') => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}

const SECTIONS = ['Welcome', 'Forecast: Simple View', 'Forecast: Advanced View', 'Solar Dashboard', 'CME Visualization', 'Settings', 'All Done'];

const AppTutorial: React.FC<AppTutorialProps> = ({
  isOpen,
  onClose,
  onNavigateToPage,
  onForecastViewChange,
  onOpenSettings,
  onCloseSettings,
}) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const prevPageRef = useRef<'forecast' | 'solar-activity' | 'modeler'>('forecast');
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (isOpen) setStepIndex(0); }, [isOpen]);

  // Execute the action for the current step
  const executeAction = useCallback((action: TutorialAction) => {
    setIsTransitioning(true);

    // Close settings first if needed
    if (action.closeSettings) {
      onCloseSettings();
    }

    // Navigate to page
    if (action.page) {
      onNavigateToPage(action.page);
      prevPageRef.current = action.page;
    }

    // Switch forecast view
    if (action.forecastView) {
      onForecastViewChange(action.forecastView);
    }

    // Open settings
    if (action.openSettings) {
      onOpenSettings();
    }

    // After delay, scroll to element and highlight
    const delay = action.delay ?? 300;
    highlightTimeoutRef.current = setTimeout(() => {
      if (action.scrollTo) {
        const el = document.getElementById(action.scrollTo);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      if (action.highlightId) {
        const el = document.getElementById(action.highlightId);
        if (el) {
          el.classList.add('tutorial-target-highlight');
        }
      }
      setIsTransitioning(false);
    }, delay);
  }, [onNavigateToPage, onForecastViewChange, onOpenSettings, onCloseSettings]);

  // Clean up highlight on step change
  const clearHighlight = useCallback(() => {
    if (highlightTimeoutRef.current) {
      clearTimeout(highlightTimeoutRef.current);
    }
    document.querySelectorAll('.tutorial-target-highlight').forEach(el => {
      el.classList.remove('tutorial-target-highlight');
    });
  }, []);

  // Execute action when step changes
  useEffect(() => {
    if (!isOpen) return;
    clearHighlight();
    const step = STEPS[stepIndex];
    if (step) executeAction(step.action);
    return clearHighlight;
  }, [stepIndex, isOpen, executeAction, clearHighlight]);

  const handleNext = useCallback(() => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(p => p + 1);
    } else {
      clearHighlight();
      onClose();
    }
  }, [stepIndex, onClose, clearHighlight]);

  const handlePrev = useCallback(() => {
    setStepIndex(p => Math.max(0, p - 1));
  }, []);

  const handleSkip = useCallback(() => {
    clearHighlight();
    onClose();
  }, [onClose, clearHighlight]);

  if (!isOpen || typeof document === 'undefined') return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const currentSectionIndex = SECTIONS.indexOf(step.section);
  const isBottom = step.placement !== 'top';

  return createPortal(
    <>
      {/* Inject highlight CSS */}
      <style>{`
        .tutorial-target-highlight {
          position: relative;
          z-index: 50;
        }
        .tutorial-target-highlight::after {
          content: '';
          position: absolute;
          inset: -4px;
          border: 2px solid rgba(56, 189, 248, 0.5);
          border-radius: 12px;
          pointer-events: none;
          animation: tutorial-pulse 2s ease-in-out infinite;
          z-index: 51;
        }
        @keyframes tutorial-pulse {
          0%, 100% { border-color: rgba(56, 189, 248, 0.3); box-shadow: 0 0 0 0 rgba(56, 189, 248, 0.1); }
          50% { border-color: rgba(56, 189, 248, 0.6); box-shadow: 0 0 20px 4px rgba(56, 189, 248, 0.15); }
        }
      `}</style>

      {/* Floating tutorial card */}
      <div
        className={`fixed left-0 right-0 z-[9998] p-3 sm:p-4 transition-all duration-300 ${
          isBottom ? 'bottom-0' : 'top-0'
        } ${isTransitioning ? 'opacity-50' : 'opacity-100'}`}
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

          {/* Footer: progress + nav */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-800/60">
            <button
              onClick={handlePrev}
              disabled={isFirst}
              className="px-3 py-1.5 text-xs text-neutral-500 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            >
              Back
            </button>

            <div className="flex items-center gap-3">
              {/* Section dots */}
              <div className="flex gap-1">
                {SECTIONS.map((s, i) => (
                  <div
                    key={s}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === currentSectionIndex
                        ? 'w-5 bg-sky-500'
                        : i < currentSectionIndex
                          ? 'w-1.5 bg-sky-500/40'
                          : 'w-1.5 bg-neutral-700'
                    }`}
                  />
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
