// --- START OF FILE src/components/AppTutorial.tsx ---

import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import CloseIcon from './icons/CloseIcon';

// ── Tutorial step definitions ────────────────────────────────────────────────

interface TutorialStep {
  id: string;
  section: string;       // Section header shown at top
  title: string;
  content: string;       // HTML string for rich formatting
  emoji: string;         // Visual identifier
}

const STEPS: TutorialStep[] = [
  // ── Welcome ──
  {
    id: 'welcome',
    section: 'Welcome',
    emoji: '🌌',
    title: 'Welcome to Spot The Aurora',
    content: `
      <p>Spot The Aurora is an all-in-one space weather app built for New Zealand. It covers everything from a live aurora forecast personalised to your GPS location, through to real-time solar monitoring and a world-first 3D CME visualization.</p>
      <p>This quick walkthrough will show you what each section does and how to get the most out of it.</p>
    `,
  },

  // ── Simple view ──
  {
    id: 'simple-what-to-expect',
    section: 'Forecast: Simple View',
    emoji: '🔮',
    title: 'What to Expect',
    content: `
      <p>The first thing you'll see is the <strong>What to Expect</strong> panel. This is your aurora forecast, personalised to your exact location using GPS.</p>
      <p>It shows what aurora visibility to expect right now, in 15 minutes, 30 minutes, 1 hour and 2 hours. Each time slot tells you whether you'll see aurora with your <strong>eyes</strong>, your <strong>phone camera</strong>, a <strong>DSLR/mirrorless camera</strong>, or <strong>nothing at all</strong>.</p>
      <p>The Now and 15/30 minute forecasts are based on real-time solar wind data. The 1 and 2 hour forecasts use our own predictive model and are less certain. The confidence dots next to each score show you how much to trust each time slot.</p>
    `,
  },
  {
    id: 'simple-sightings-map',
    section: 'Forecast: Simple View',
    emoji: '🗺️',
    title: 'Sightings Map and Aurora Oval',
    content: `
      <p>Below the forecast is the <strong>sightings map</strong>. This shows real-time user reports from people across New Zealand, plotted on the map so you can see who is seeing aurora and who isn't.</p>
      <p>The <strong>aurora oval</strong> (the coloured band) shows where aurora is actually happening right now. It goes from green when things are quiet through to red during storms. Because aurora happens very high in the atmosphere, you might still see it even if the oval doesn't reach your town on the map.</p>
      <p>The <strong>blue dashed line</strong> is the visibility horizon. If this line is over or above your location, you should be able to pick up aurora on camera looking south. The further north the line reaches, the better the chances of seeing it with your eyes.</p>
      <p>Report icons show what other users are seeing. A camera icon means camera-only visibility, a phone means phone visibility, an eye means naked eye, and an X means they looked but saw nothing. Use these alongside the forecast to build a picture of what's happening.</p>
    `,
  },
  {
    id: 'simple-3day',
    section: 'Forecast: Simple View',
    emoji: '📅',
    title: 'NOAA 3-Day Forecast',
    content: `
      <p>The <strong>NOAA 3-day forecast</strong> shows predicted geomagnetic activity over the next three days. The green and pink bars indicate expected activity levels.</p>
      <p>Crucially, it also shows <strong>sunrise/sunset</strong> and <strong>moonrise/moonset</strong> times. Aurora viewing needs to be during the dark sections of the chart. If the bars are high but it's during daylight or when the moon is up and bright, it may not be worth heading out.</p>
      <p>Use this for planning ahead. If a storm is forecast for tomorrow night and the moon sets early, that's a good combination.</p>
    `,
  },
  {
    id: 'simple-cloud-cameras',
    section: 'Forecast: Simple View',
    emoji: '☁️',
    title: 'Cloud Cover and Cameras',
    content: `
      <p>The <strong>Windy cloud cover widget</strong> shows you forecast cloud cover for New Zealand. If you can't see stars looking south, you won't see aurora, so this is essential for planning.</p>
      <p>The <strong>webcams</strong> section shows live camera feeds from various locations around New Zealand. These are useful for checking real-time sky conditions in places you might be heading to, or to see if aurora is showing up on camera before you make the effort to go outside.</p>
    `,
  },

  // ── Advanced view ──
  {
    id: 'advanced-overview',
    section: 'Forecast: Advanced View',
    emoji: '📊',
    title: 'Advanced View',
    content: `
      <p>Switch to <strong>Advanced View</strong> using the toggle at the top of the forecast page. This shows all the raw data that drives the forecast, with up to 24-hour graphs for every measurement.</p>
      <p>Everything from the simple view is still here, but you also get the individual solar wind components: IMF Bz and Bt, solar wind speed, density, temperature, dynamic pressure, and the Newell coupling function. Each chart shows the last 24 hours so you can see trends.</p>
      <p>If you want to understand <em>why</em> the forecast is saying what it's saying, this is where to look. If you just want to know whether to go outside, the simple view has you covered.</p>
    `,
  },
  {
    id: 'advanced-epam',
    section: 'Forecast: Advanced View',
    emoji: '⚡',
    title: 'EPAM Monitor',
    content: `
      <p>At the bottom of the advanced view is the <strong>EPAM monitor</strong>. This shows energetic particle data and is useful for detecting CME arrivals and solar energetic particle events.</p>
      <p>When a CME is about to arrive at Earth, EPAM data often shows a rise in energetic particles before the main shock hits. Advanced users can use this as an early warning sign.</p>
    `,
  },

  // ── Solar dashboard ──
  {
    id: 'solar-suvi',
    section: 'Solar Dashboard',
    emoji: '☀️',
    title: 'SUVI Solar Imagery',
    content: `
      <p>The solar dashboard shows what the sun is doing right now. A key feature is our <strong>SUVI difference imagery</strong>.</p>
      <p>Difference imagery works by subtracting one frame from the next, which highlights anything that has changed. Structures that are stationary disappear, and anything moving (like material leaving the sun) lights up. This makes it incredibly easy to spot eruptions and outflows that are nearly invisible in normal imagery.</p>
      <p><strong>SUVI 195 angstrom</strong> is best for seeing structures leaving the sun. It shows coronal material beautifully. <strong>131 angstrom</strong> is great for pinpointing exactly where solar flares are happening. <strong>304 angstrom</strong> highlights dense eruptions and filaments.</p>
      <p>On mobile, swipe between wavelengths or tap the wavelength buttons to switch. Toggle difference mode on and off to compare.</p>
    `,
  },
  {
    id: 'solar-coronagraph',
    section: 'Solar Dashboard',
    emoji: '🌑',
    title: 'Coronagraph Imagery',
    content: `
      <p>The <strong>coronagraph</strong> shows what is happening in the sun's outer corona by blocking out the bright solar disk. This lets you see CMEs (Coronal Mass Ejections) as they leave the sun and expand outward into space.</p>
      <p>Our difference imagery works here too. With difference mode on, you can see CMEs expanding outward far more clearly than in the raw imagery. If you see material moving outward from the sun in the coronagraph, that could be a CME headed into the solar system.</p>
      <p>This is where you spot potential incoming storms before they show up in the solar wind data days later.</p>
    `,
  },
  {
    id: 'solar-sunspots',
    section: 'Solar Dashboard',
    emoji: '🔴',
    title: 'Sunspot Tracker',
    content: `
      <p>The <strong>sunspot tracker</strong> monitors active regions on the sun. Each sunspot region has a magnetic classification that tells you how complex and potentially explosive it is.</p>
      <p><strong>Alpha</strong> regions are simple, single-polarity spots. Very stable and unlikely to produce anything significant.</p>
      <p><strong>Beta</strong> regions have two opposite magnetic polarities. These are more active and can produce minor to moderate flares.</p>
      <p><strong>Beta-Gamma</strong> regions are complex, with mixed polarities that don't separate cleanly. These are unstable and capable of producing strong flares.</p>
      <p><strong>Beta-Gamma-Delta</strong> regions are the most complex and dangerous. The delta configuration means opposite polarities are packed tightly together, storing huge amounts of magnetic energy. These are the ones that produce X-class flares and major CMEs. When you see a Beta-Gamma-Delta region, pay attention.</p>
    `,
  },

  // ── CME visualization ──
  {
    id: 'cme-overview',
    section: 'CME Visualization',
    emoji: '🌍',
    title: 'World-First 3D CME Model',
    content: `
      <p>This is a <strong>world first</strong>. Spot The Aurora is the first public tool that lets you watch Coronal Mass Ejections travel from the Sun to Earth in a live, interactive 3D visualization.</p>
      <p>The visualization shows the inner solar system with the sun at the centre and the planets in their real positions. When a CME is detected, it appears as an expanding cloud moving outward from the sun. You can rotate, zoom, and pan the 3D view to see it from any angle.</p>
      <p>CME data comes from NASA's DONKI catalog. Each CME's speed, direction, and angular width are modelled so you can see whether it's headed toward Earth or will miss.</p>
    `,
  },
  {
    id: 'cme-controls',
    section: 'CME Visualization',
    emoji: '🎛️',
    title: 'Timeline and Controls',
    content: `
      <p>The <strong>timeline controls</strong> at the bottom let you scrub through time. Play, pause, step frame by frame, or drag the slider to any point. Speed controls let you run from 0.5x to 20x speed.</p>
      <p>The <strong>CME list panel</strong> shows all recent CMEs. Tap any CME to select it and the visualization will focus on it. You can see its speed, direction, and whether it's Earth-directed.</p>
      <p>The <strong>impact graph</strong> button opens charts showing predicted arrival times and conditions at Earth.</p>
      <p>The <strong>forecast models panel</strong> shows different propagation models and their predicted arrival times, so you can compare estimates.</p>
    `,
  },
  {
    id: 'cme-hss',
    section: 'CME Visualization',
    emoji: '💨',
    title: 'World-First Coronal Hole and HSS Visualization',
    content: `
      <p>Another <strong>world first</strong>. Toggle on the Coronal Hole / High-Speed Stream visualization to see coronal holes on the sun and the high-speed solar wind streams they produce, rendered in 3D as they spiral outward through the solar system.</p>
      <p>This is important because HSS can interact with CMEs, deflecting or compressing them, and HSS on their own are one of the most common drivers of aurora activity in New Zealand.</p>
      <p>Being able to see both CMEs and HSS together in the same 3D space gives you a much better understanding of what's heading toward Earth.</p>
    `,
  },
  {
    id: 'cme-share',
    section: 'CME Visualization',
    emoji: '🔗',
    title: 'Share a CME',
    content: `
      <p>See something interesting? You can <strong>share a direct link</strong> to any specific CME. The link opens the app with that CME already selected and focused in the visualization.</p>
      <p>This is great for sharing with friends, posting in aurora groups, or saving for later reference. Anyone who opens the link will see exactly what you're looking at.</p>
    `,
  },

  // ── Notifications ──
  {
    id: 'notifications',
    section: 'Settings and Notifications',
    emoji: '🔔',
    title: 'Aurora Notifications',
    content: `
      <p>Head to <strong>Settings</strong> to configure push notifications. You have three options:</p>
      <p><strong>Preset templates</strong> let you pick based on your gear. Select "eye visibility" to only be notified when aurora is visible to the naked eye. Select "phone camera" for phone-level visibility alerts. Select "camera" for DSLR/mirrorless level notifications. Or select "everything" to get all alerts.</p>
      <p><strong>Custom mode</strong> lets you toggle each individual notification type on or off. Want substorm alerts but not Kp forecasts? Camera visibility but not phone? You can set it up exactly how you want.</p>
      <p>Make sure to install the app to your home screen first for notifications to work reliably.</p>
    `,
  },

  // ── Finish ──
  {
    id: 'finish',
    section: 'You\'re All Set',
    emoji: '🎉',
    title: 'Go Chase Some Aurora',
    content: `
      <p>That's everything. Spot The Aurora is free, ad-free, and always will be.</p>
      <p>Start with the <strong>Simple View</strong> forecast for a quick answer on whether it's worth going out tonight. Dive into <strong>Advanced View</strong> when you want to understand the data. Check the <strong>Solar Dashboard</strong> to see what the sun is up to. And use the <strong>CME Visualization</strong> to watch incoming storms in 3D.</p>
      <p>If you find the app useful, consider supporting us on <a href="https://buymeacoffee.com/spottheaurora" target="_blank" rel="noopener noreferrer" class="text-yellow-300 hover:underline">Buy Me a Coffee</a> and giving us a like on <a href="https://www.facebook.com/spot.the.aurora" target="_blank" rel="noopener noreferrer" class="text-blue-400 hover:underline">Facebook</a>.</p>
      <p>Clear skies!</p>
    `,
  },
];

// ── Section grouping for progress dots ──

const SECTIONS = ['Welcome', 'Forecast: Simple View', 'Forecast: Advanced View', 'Solar Dashboard', 'CME Visualization', 'Settings and Notifications', 'You\'re All Set'];

// ── Component ────────────────────────────────────────────────────────────────

interface AppTutorialProps {
  isOpen: boolean;
  onClose: () => void;
}

const AppTutorial: React.FC<AppTutorialProps> = ({ isOpen, onClose }) => {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (isOpen) setStepIndex(0);
  }, [isOpen]);

  const handleNext = useCallback(() => {
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(prev => prev + 1);
    } else {
      onClose();
    }
  }, [stepIndex, onClose]);

  const handlePrev = useCallback(() => {
    setStepIndex(prev => Math.max(0, prev - 1));
  }, []);

  const handleSkip = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const currentSectionIndex = SECTIONS.indexOf(step.section);

  return createPortal(
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[9999] flex justify-center items-center p-4">
      <div
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex justify-between items-center px-5 pt-4 pb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500">{step.section}</span>
          </div>
          <button
            onClick={handleSkip}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Skip tutorial
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto styled-scrollbar px-5 py-4">
          <div className="text-center mb-4">
            <span className="text-4xl">{step.emoji}</span>
          </div>
          <h2 className="text-lg font-bold text-neutral-100 text-center mb-4">{step.title}</h2>
          <div
            className="text-sm text-neutral-400 leading-relaxed space-y-3 [&_strong]:text-neutral-200 [&_em]:text-neutral-300 [&_a]:text-sky-400 [&_a:hover]:underline"
            dangerouslySetInnerHTML={{ __html: step.content }}
          />
        </div>

        {/* Section progress dots */}
        <div className="flex justify-center gap-1.5 py-3">
          {SECTIONS.map((section, i) => (
            <div
              key={section}
              className={`h-1.5 rounded-full transition-all ${
                i === currentSectionIndex
                  ? 'w-6 bg-sky-500'
                  : i < currentSectionIndex
                    ? 'w-1.5 bg-sky-500/40'
                    : 'w-1.5 bg-neutral-700'
              }`}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-neutral-800/60">
          <button
            onClick={handlePrev}
            disabled={isFirst}
            className="px-4 py-2 text-sm text-neutral-400 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Back
          </button>
          <span className="text-xs text-neutral-600 tabular-nums">{stepIndex + 1} / {STEPS.length}</span>
          <button
            onClick={handleNext}
            className="px-5 py-2 text-sm font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
          >
            {isLast ? 'Get started' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AppTutorial;
// --- END OF FILE src/components/AppTutorial.tsx ---
