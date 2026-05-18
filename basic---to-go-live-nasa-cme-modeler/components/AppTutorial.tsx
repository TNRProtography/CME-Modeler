// --- START OF FILE src/components/AppTutorial.tsx ---

import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ── Reusable visual components ───────────────────────────────────────────────

const Screenshot: React.FC<{ src: string; alt: string }> = ({ src, alt }) => (
  <div className="rounded-lg overflow-hidden border border-neutral-800 my-3">
    <img src={src} alt={alt} className="w-full h-auto" loading="lazy" />
  </div>
);

const MockForecastSlot: React.FC<{ time: string; level: string; emoji: string; color: string; active?: boolean }> = ({ time, level, emoji, color, active }) => (
  <div className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${active ? 'bg-neutral-800/80' : 'bg-neutral-800/40'}`}>
    <span className={`text-xs font-semibold w-12 ${time === 'Now' ? 'text-emerald-400' : 'text-neutral-500'}`}>{time}</span>
    <div className="flex-1 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.min(80, Math.max(15, Math.random() * 60 + 15))}%`, backgroundColor: color }} />
    </div>
    <span className="text-lg">{emoji}</span>
    <span className="text-xs text-neutral-400 w-20 text-right">{level}</span>
  </div>
);

const ConfidenceDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-1.5">
    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
    <span className="text-xs text-neutral-500">{label}</span>
  </div>
);

const MapLegendItem: React.FC<{ icon: React.ReactNode; label: string; desc: string }> = ({ icon, label, desc }) => (
  <div className="flex items-start gap-3 py-1.5">
    <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-neutral-800/80 text-lg">{icon}</div>
    <div>
      <div className="text-xs font-semibold text-neutral-200">{label}</div>
      <div className="text-xs text-neutral-500">{desc}</div>
    </div>
  </div>
);

const SunspotClass: React.FC<{ cls: string; risk: string; color: string; desc: string }> = ({ cls, risk, color, desc }) => (
  <div className="flex items-start gap-3 py-1.5">
    <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg font-bold text-[10px]" style={{ backgroundColor: color + '20', color, border: `1px solid ${color}40` }}>{cls}</div>
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-neutral-200">{cls}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: color + '20', color }}>{risk}</span>
      </div>
      <div className="text-xs text-neutral-500 mt-0.5">{desc}</div>
    </div>
  </div>
);

const PresetButton: React.FC<{ emoji: string; label: string; desc: string; active?: boolean }> = ({ emoji, label, desc, active }) => (
  <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${active ? 'bg-sky-600/15 border-sky-500/40' : 'bg-neutral-800/40 border-neutral-700/40'}`}>
    <span className="text-xl">{emoji}</span>
    <div>
      <div className={`text-xs font-semibold ${active ? 'text-sky-300' : 'text-neutral-300'}`}>{label}</div>
      <div className="text-[10px] text-neutral-500">{desc}</div>
    </div>
  </div>
);

const WorldFirstBadge = () => (
  <div className="text-center my-2">
    <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30">World First</span>
  </div>
);

// ── Steps ────────────────────────────────────────────────────────────────────

interface StepDef { id: string; section: string; title: string; render: () => React.ReactNode; }

const STEPS: StepDef[] = [
  // Welcome
  { id: 'welcome', section: 'Welcome', title: 'Welcome to Spot The Aurora', render: () => (
    <div className="space-y-4 text-center">
      <div className="text-6xl">🌌</div>
      <p className="text-sm text-neutral-400">Your all-in-one space weather app for New Zealand.</p>
      <div className="grid grid-cols-2 gap-2 mt-4">
        {[{ emoji: '🔮', label: 'Aurora Forecast' }, { emoji: '☀️', label: 'Solar Dashboard' }, { emoji: '🌍', label: '3D CME Model' }, { emoji: '🔔', label: 'Smart Alerts' }].map(f => (
          <div key={f.label} className="bg-neutral-800/50 rounded-lg px-3 py-3 text-center">
            <div className="text-2xl mb-1">{f.emoji}</div>
            <div className="text-[10px] font-medium text-neutral-400">{f.label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-neutral-500 mt-3">Tap Next to see how it all works.</p>
    </div>
  )},

  // Simple: What to Expect (no screenshot yet, use mock)
  { id: 'simple-forecast', section: 'Forecast: Simple View', title: 'What to Expect', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Your GPS-personalised aurora forecast for the next 2 hours.</p>
      <div className="space-y-1.5 mt-3">
        <MockForecastSlot time="Now" level="Phone camera" emoji="📱" color="#38bdf8" active />
        <MockForecastSlot time="15 min" level="Phone camera" emoji="📱" color="#38bdf8" />
        <MockForecastSlot time="30 min" level="Naked eye" emoji="👁️" color="#34d399" />
        <MockForecastSlot time="1 hour" level="Camera only" emoji="📷" color="#fbbf24" />
        <MockForecastSlot time="2 hours" level="Nothing" emoji="😴" color="#525252" />
      </div>
      <div className="flex justify-center gap-4 mt-3">
        <ConfidenceDot color="#34d399" label="High confidence" />
        <ConfidenceDot color="#fbbf24" label="Medium" />
        <ConfidenceDot color="#525252" label="Rough guide" />
      </div>
      <p className="text-[10px] text-neutral-500 text-center mt-2">Now and 15/30 min use live solar wind data. 1hr and 2hr use our predictive model.</p>
    </div>
  )},

  // Simple: Sightings map (no screenshot yet, use SVG mock)
  { id: 'simple-map', section: 'Forecast: Simple View', title: 'Sightings Map and Aurora Oval', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Real-time reports and the live aurora oval.</p>
      <div className="relative bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden h-28">
        <svg viewBox="0 0 300 120" className="w-full h-full">
          <ellipse cx="150" cy="160" rx="200" ry="80" fill="none" stroke="#34d399" strokeWidth="2" opacity="0.6" />
          <ellipse cx="150" cy="160" rx="200" ry="80" fill="#34d399" opacity="0.08" />
          <line x1="20" y1="95" x2="280" y2="82" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.6" />
          <text x="150" y="55" textAnchor="middle" fill="#525252" fontSize="10">NEW ZEALAND</text>
          <text x="120" y="85" fontSize="14">📱</text>
          <text x="180" y="72" fontSize="14">👁️</text>
          <text x="85" y="78" fontSize="11">❌📷</text>
        </svg>
      </div>
      <div className="space-y-0.5">
        <MapLegendItem icon={<span className="text-sm">👁️</span>} label="Naked eye" desc="Someone saw it with their eyes" />
        <MapLegendItem icon={<span className="text-sm">📱</span>} label="Phone camera" desc="Visible on phone, not to eyes" />
        <MapLegendItem icon={<span className="text-sm">📷</span>} label="DSLR only" desc="Only on long exposure" />
        <MapLegendItem icon={<span className="text-sm">❌</span>} label="Nothing seen" desc="Looked but nothing there" />
      </div>
      <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-neutral-800/40">
        <div className="w-4 h-0.5 bg-emerald-500 rounded-full" />
        <span className="text-[10px] text-neutral-400">Aurora oval: green = quiet, red = storm</span>
      </div>
      <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-neutral-800/40">
        <div className="w-4 border-t border-dashed border-sky-400" />
        <span className="text-[10px] text-neutral-400">Blue dashed line = how far north aurora is visible</span>
      </div>
    </div>
  )},

  // Simple: 3-day forecast (REAL SCREENSHOT)
  { id: 'simple-3day', section: 'Forecast: Simple View', title: '3-Day Aurora Forecast', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Plan ahead. Tap any window for details.</p>
      <Screenshot src="/tutorial-3day-forecast.png" alt="3-day aurora forecast showing activity bars with sunrise, sunset, moonrise and moonset times" />
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-neutral-800/40 rounded-lg px-2 py-1.5"><div className="text-[10px] text-emerald-400 font-semibold">Green</div><div className="text-[9px] text-neutral-500">Aurora base</div></div>
        <div className="bg-neutral-800/40 rounded-lg px-2 py-1.5"><div className="text-[10px] text-pink-400 font-semibold">Pink</div><div className="text-[9px] text-neutral-500">Active</div></div>
        <div className="bg-neutral-800/40 rounded-lg px-2 py-1.5"><div className="text-[10px] text-sky-400 font-semibold">Blue</div><div className="text-[9px] text-neutral-500">Intense (G3+)</div></div>
      </div>
      <p className="text-[10px] text-neutral-500 text-center">Aurora viewing needs dark skies. Check the moon and sunset times.</p>
    </div>
  )},

  // Simple: Cloud cover (REAL SCREENSHOT)
  { id: 'simple-cloud', section: 'Forecast: Simple View', title: 'Cloud Cover', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">No stars = no aurora. Check the cloud forecast.</p>
      <Screenshot src="/tutorial-cloud-cover.png" alt="Windy.com cloud cover forecast for New Zealand" />
      <p className="text-[10px] text-neutral-500 text-center">Powered by Windy.com. Look for clear patches over the South Island.</p>
    </div>
  )},

  // Advanced view (REAL SCREENSHOT)
  { id: 'advanced-overview', section: 'Forecast: Advanced View', title: 'Advanced View', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Toggle to Advanced to see the raw data behind the forecast.</p>
      <Screenshot src="/tutorial-advanced-view.png" alt="Advanced forecast view showing IMF Bz chart, IMF clock, and solar wind phase" />
      <p className="text-[10px] text-neutral-500 text-center">24-hour charts for all solar wind components, the IMF clock, solar wind phase estimate, and EPAM energetic particles. If you want to know <em>why</em> the forecast says what it says, look here.</p>
    </div>
  )},

  // Solar: SUVI 131 (REAL SCREENSHOT)
  { id: 'solar-suvi-131', section: 'Solar Dashboard', title: 'SUVI 131 Angstrom', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Best for pinpointing exactly where solar flares are.</p>
      <Screenshot src="/tutorial-suvi-131.png" alt="SUVI 131 angstrom raw and difference imagery showing solar flare location" />
      <p className="text-[10px] text-neutral-500 text-center"><strong className="text-neutral-300">Left:</strong> Raw image. <strong className="text-neutral-300">Right:</strong> Difference mode. Anything that moved between frames lights up. Stationary features disappear.</p>
    </div>
  )},

  // Solar: SUVI 304 (REAL SCREENSHOT)
  { id: 'solar-suvi-304', section: 'Solar Dashboard', title: 'SUVI 304 Angstrom', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Best for dense eruptions and filaments.</p>
      <Screenshot src="/tutorial-suvi-304.png" alt="SUVI 304 angstrom raw and difference imagery showing eruptions" />
      <p className="text-[10px] text-neutral-500 text-center">Watch for bright spots erupting from the sun's surface. Filament eruptions show clearly in difference mode.</p>
    </div>
  )},

  // Solar: SUVI 195 (REAL SCREENSHOT)
  { id: 'solar-suvi-195', section: 'Solar Dashboard', title: 'SUVI 195 Angstrom', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Best for seeing structures leaving the sun.</p>
      <Screenshot src="/tutorial-suvi-195.png" alt="SUVI 195 angstrom raw and difference imagery showing coronal structures" />
      <p className="text-[10px] text-neutral-500 text-center">195 shows the solar corona in incredible detail. Difference mode reveals material flowing outward that you'd never see in the raw image.</p>
    </div>
  )},

  // Solar: Coronagraph (REAL SCREENSHOT)
  { id: 'solar-coronagraph', section: 'Solar Dashboard', title: 'Coronagraph Imagery', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Blocks the bright solar disk to reveal CMEs leaving the sun.</p>
      <Screenshot src="/tutorial-coronagraph.png" alt="Coronagraph raw and difference imagery showing the outer corona" />
      <p className="text-[10px] text-neutral-500 text-center">Multiple sources available: GOES-19, SOHO LASCO C2/C3, and STEREO-A. Difference mode makes CMEs expanding outward far easier to spot. This is where you see storms coming days before they arrive.</p>
    </div>
  )},

  // Solar: Sunspots (REAL SCREENSHOT)
  { id: 'solar-sunspots', section: 'Solar Dashboard', title: 'Sunspot Tracker', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Tap any region for detailed info and flare probabilities.</p>
      <Screenshot src="/tutorial-sunspots.png" alt="Active sunspot tracker showing labeled regions on the solar disk with detailed region info" />
      <div className="space-y-1 mt-1">
        <SunspotClass cls="Alpha" risk="Stable" color="#34d399" desc="Simple, single polarity. Nothing to worry about." />
        <SunspotClass cls="Beta" risk="Minor" color="#fbbf24" desc="Two polarities. Minor to moderate flares." />
        <SunspotClass cls="B-G" risk="Active" color="#fb923c" desc="Beta-Gamma. Strong flares possible." />
        <SunspotClass cls="BGD" risk="Danger" color="#f87171" desc="Beta-Gamma-Delta. X-class flares and major CMEs." />
      </div>
    </div>
  )},

  // CME: Overview (no screenshot yet, use SVG)
  { id: 'cme-overview', section: 'CME Visualization', title: '3D CME Visualization', render: () => (
    <div className="space-y-3">
      <div className="flex justify-center">
        <svg viewBox="0 0 160 160" className="w-36 h-36">
          <circle cx="80" cy="80" r="10" fill="#fbbf24" opacity="0.8" />
          <circle cx="80" cy="80" r="50" fill="none" stroke="#333" strokeWidth="0.5" />
          <circle cx="130" cy="80" r="4" fill="#38bdf8" />
          <text x="130" y="72" textAnchor="middle" fill="#525252" fontSize="7">Earth</text>
          <path d="M88,76 L138,58 L138,102 Z" fill="#f87171" opacity="0.12" stroke="#f87171" strokeWidth="0.5" strokeOpacity="0.4" />
          <text x="118" y="52" fill="#f87171" fontSize="6" opacity="0.6">CME</text>
        </svg>
      </div>
      <WorldFirstBadge />
      <p className="text-xs text-neutral-400 text-center">Watch Coronal Mass Ejections travel from the Sun to Earth in real-time 3D. Rotate, zoom, and scrub through time.</p>
      <div className="grid grid-cols-2 gap-2 mt-2">
        {[{ l: 'CME List', d: 'Tap any CME to focus' }, { l: 'Impact Graph', d: 'Predicted arrival' }, { l: 'Forecast Models', d: 'Compare estimates' }, { l: 'Share CME', d: 'Copy a link to share' }].map(i => (
          <div key={i.l} className="bg-neutral-800/40 rounded-lg px-3 py-2"><div className="text-[10px] font-semibold text-neutral-300">{i.l}</div><div className="text-[9px] text-neutral-500">{i.d}</div></div>
        ))}
      </div>
    </div>
  )},

  // CME: HSS (no screenshot yet, use SVG)
  { id: 'cme-hss', section: 'CME Visualization', title: 'Coronal Hole / HSS Visualization', render: () => (
    <div className="space-y-3">
      <div className="flex justify-center">
        <svg viewBox="0 0 160 160" className="w-36 h-36">
          <circle cx="80" cy="80" r="10" fill="#fbbf24" opacity="0.8" />
          <circle cx="75" cy="75" r="4" fill="#171717" stroke="#fbbf24" strokeWidth="0.5" opacity="0.8" />
          <path d="M84,78 Q100,60 130,50 Q150,45 160,60" fill="none" stroke="#a78bfa" strokeWidth="1.5" opacity="0.5" strokeDasharray="3 3" />
          <path d="M84,82 Q95,90 110,100 Q130,115 155,120" fill="none" stroke="#a78bfa" strokeWidth="1" opacity="0.3" strokeDasharray="3 3" />
          <circle cx="80" cy="80" r="50" fill="none" stroke="#333" strokeWidth="0.5" />
          <circle cx="130" cy="80" r="4" fill="#38bdf8" />
        </svg>
      </div>
      <WorldFirstBadge />
      <p className="text-xs text-neutral-400 text-center">Toggle on to see coronal holes and high-speed streams spiralling through the solar system. HSS interact with CMEs and are a common aurora driver in NZ.</p>
    </div>
  )},

  // Notifications (REAL SCREENSHOT)
  { id: 'notifications', section: 'Settings and Notifications', title: 'Aurora Notifications', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Choose a preset based on your gear, or go fully custom.</p>
      <Screenshot src="/tutorial-notifications.png" alt="Notification preset templates: naked eye, phone camera, DSLR, everything, and custom" />
      <p className="text-[10px] text-neutral-500 text-center">Pick a template to get started, or choose Custom to toggle each alert individually. Install the app to your home screen for notifications to work reliably.</p>
    </div>
  )},

  // Finish
  { id: 'finish', section: "You're All Set", title: 'Go Chase Some Aurora', render: () => (
    <div className="space-y-4 text-center">
      <div className="text-5xl">🎉</div>
      <p className="text-sm text-neutral-300">Free, ad-free, always will be.</p>
      <div className="grid grid-cols-2 gap-2 text-left">
        {[{ t: 'Quick check', d: 'Simple View' }, { t: 'Deep dive', d: 'Advanced View' }, { t: 'Watch the sun', d: 'Solar Dashboard' }, { t: 'Track storms', d: 'CME Visualization' }].map(i => (
          <div key={i.t} className="bg-neutral-800/40 rounded-lg px-3 py-2"><div className="text-xs font-semibold text-neutral-300">{i.t}</div><div className="text-[10px] text-neutral-500">{i.d}</div></div>
        ))}
      </div>
      <div className="flex justify-center gap-3 mt-2">
        <a href="https://buymeacoffee.com/spottheaurora" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/15 border border-yellow-400/30 text-yellow-200 text-xs hover:bg-yellow-500/25 transition-colors">☕ Buy us a coffee</a>
        <a href="https://www.facebook.com/spot.the.aurora" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1877F2]/15 border border-[#1877F2]/30 text-blue-200 text-xs hover:bg-[#1877F2]/25 transition-colors">👍 Like on Facebook</a>
      </div>
      <p className="text-xs text-neutral-500">Clear skies! 🌌</p>
    </div>
  )},
];

const SECTIONS = ['Welcome', 'Forecast: Simple View', 'Forecast: Advanced View', 'Solar Dashboard', 'CME Visualization', 'Settings and Notifications', "You're All Set"];

interface AppTutorialProps { isOpen: boolean; onClose: () => void; }

const AppTutorial: React.FC<AppTutorialProps> = ({ isOpen, onClose }) => {
  const [stepIndex, setStepIndex] = useState(0);
  useEffect(() => { if (isOpen) setStepIndex(0); }, [isOpen]);
  const handleNext = useCallback(() => { if (stepIndex < STEPS.length - 1) setStepIndex(p => p + 1); else onClose(); }, [stepIndex, onClose]);
  const handlePrev = useCallback(() => { setStepIndex(p => Math.max(0, p - 1)); }, []);
  if (!isOpen || typeof document === 'undefined') return null;
  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;
  const currentSectionIndex = SECTIONS.indexOf(step.section);

  return createPortal(
    <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[9999] flex justify-center items-center p-4">
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-xl shadow-2xl w-full max-w-md max-h-[85vh] text-neutral-300 flex flex-col overflow-hidden">
        <div className="flex justify-between items-center px-4 pt-3 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-neutral-500">{step.section}</span>
          <button onClick={onClose} className="text-[10px] text-neutral-600 hover:text-neutral-300 transition-colors">Skip</button>
        </div>
        <div className="px-4 pb-2"><h2 className="text-base font-bold text-neutral-100">{step.title}</h2></div>
        <div className="flex-1 overflow-y-auto styled-scrollbar px-4 pb-4">{step.render()}</div>
        <div className="flex justify-center gap-1.5 py-2">
          {SECTIONS.map((s, i) => (<div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${i === currentSectionIndex ? 'w-6 bg-sky-500' : i < currentSectionIndex ? 'w-1.5 bg-sky-500/40' : 'w-1.5 bg-neutral-700'}`} />))}
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-neutral-800/60">
          <button onClick={handlePrev} disabled={isFirst} className="px-3 py-1.5 text-xs text-neutral-500 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">Back</button>
          <span className="text-[10px] text-neutral-600 tabular-nums">{stepIndex + 1} / {STEPS.length}</span>
          <button onClick={handleNext} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors">{isLast ? 'Get started' : 'Next'}</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default AppTutorial;
// --- END OF FILE src/components/AppTutorial.tsx ---
