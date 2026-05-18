// --- START OF FILE src/components/AppTutorial.tsx ---

import React, { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const MockForecastSlot: React.FC<{ time: string; level: string; emoji: string; color: string; active?: boolean }> = ({ time, level, emoji, color, active }) => (
  <div className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${active ? 'bg-neutral-800/80 scale-[1.02]' : 'bg-neutral-800/40'}`}>
    <span className={`text-xs font-semibold w-12 ${time === 'Now' ? 'text-emerald-400' : 'text-neutral-500'}`}>{time}</span>
    <div className="flex-1 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.random() * 40 + 20}%`, backgroundColor: color }} />
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
  <div className="flex items-start gap-3 py-2">
    <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-neutral-800/80 text-lg">{icon}</div>
    <div>
      <div className="text-xs font-semibold text-neutral-200">{label}</div>
      <div className="text-xs text-neutral-500">{desc}</div>
    </div>
  </div>
);

const SunspotClass: React.FC<{ cls: string; risk: string; color: string; desc: string }> = ({ cls, risk, color, desc }) => (
  <div className="flex items-start gap-3 py-2">
    <div className="flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg font-bold text-xs" style={{ backgroundColor: color + '20', color, border: `1px solid ${color}40` }}>{cls}</div>
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-neutral-200">{cls}</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: color + '20', color }}>{risk}</span>
      </div>
      <div className="text-xs text-neutral-500 mt-0.5">{desc}</div>
    </div>
  </div>
);

const SuviCard: React.FC<{ wavelength: string; color: string; bestFor: string }> = ({ wavelength, color, bestFor }) => (
  <div className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-neutral-800/50">
    <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold" style={{ backgroundColor: color + '25', color, border: `1px solid ${color}50` }}>{wavelength}</div>
    <div className="text-xs text-neutral-400">{bestFor}</div>
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

interface StepDef { id: string; section: string; title: string; render: () => React.ReactNode; }

const STEPS: StepDef[] = [
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

  { id: 'simple-map', section: 'Forecast: Simple View', title: 'Sightings Map and Aurora Oval', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Real-time reports and the live aurora oval.</p>
      <div className="relative bg-neutral-900 rounded-lg border border-neutral-800 overflow-hidden h-32">
        <svg viewBox="0 0 300 130" className="w-full h-full">
          <ellipse cx="150" cy="170" rx="200" ry="80" fill="none" stroke="#34d399" strokeWidth="2" opacity="0.6" />
          <ellipse cx="150" cy="170" rx="200" ry="80" fill="#34d399" opacity="0.08" />
          <line x1="20" y1="105" x2="280" y2="90" stroke="#38bdf8" strokeWidth="1.5" strokeDasharray="4 6" opacity="0.6" />
          <text x="150" y="65" textAnchor="middle" fill="#525252" fontSize="10">NEW ZEALAND</text>
          <text x="120" y="95" fontSize="14">📱</text>
          <text x="180" y="80" fontSize="14">👁️</text>
          <text x="85" y="85" fontSize="12">❌📷</text>
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

  { id: 'simple-3day', section: 'Forecast: Simple View', title: 'NOAA 3-Day Forecast', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Plan ahead with the 3-day outlook.</p>
      <div className="bg-neutral-800/40 rounded-lg p-3">
        <div className="flex items-end gap-1 h-14 mb-2">
          {[20, 35, 60, 45, 30, 15, 40, 55, 70, 50, 25, 10].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm transition-all" style={{ height: `${h}%`, backgroundColor: h > 50 ? '#f472b6' : '#34d399', opacity: i >= 4 && i <= 7 ? 0.25 : 1 }} />
          ))}
        </div>
        <div className="flex justify-between text-[8px] text-neutral-600">
          <span>Tonight</span><span className="text-neutral-500">☀️ Daylight</span><span>Tomorrow night</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <div className="bg-neutral-800/40 rounded-lg px-3 py-2"><div className="text-lg">🌅</div><div className="text-[10px] text-neutral-500">Sunrise/sunset</div></div>
        <div className="bg-neutral-800/40 rounded-lg px-3 py-2"><div className="text-lg">🌙</div><div className="text-[10px] text-neutral-500">Moonrise/moonset</div></div>
      </div>
      <p className="text-[10px] text-neutral-500 text-center">Faded bars = daylight. Aurora viewing needs the dark sections.</p>
    </div>
  )},

  { id: 'simple-cloud', section: 'Forecast: Simple View', title: 'Cloud Cover and Webcams', render: () => (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-neutral-800/40 rounded-lg p-4 text-center"><div className="text-3xl mb-2">☁️</div><div className="text-xs font-semibold text-neutral-300">Cloud Cover</div><div className="text-[10px] text-neutral-500 mt-1">No stars = no aurora. Check the forecast.</div></div>
        <div className="bg-neutral-800/40 rounded-lg p-4 text-center"><div className="text-3xl mb-2">📹</div><div className="text-xs font-semibold text-neutral-300">Webcams</div><div className="text-[10px] text-neutral-500 mt-1">Live cameras around NZ. Check before heading out.</div></div>
      </div>
    </div>
  )},

  { id: 'advanced-overview', section: 'Forecast: Advanced View', title: 'Advanced View', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Toggle to Advanced to see the raw data behind the forecast.</p>
      <div className="bg-neutral-800/40 rounded-lg p-3">
        <div className="text-[10px] text-neutral-500 mb-1">IMF Bz (24 hours)</div>
        <svg viewBox="0 0 200 40" className="w-full h-10">
          <line x1="0" y1="20" x2="200" y2="20" stroke="#333" strokeWidth="0.5" />
          <polyline fill="none" stroke="#f87171" strokeWidth="1.5" points="0,22 20,18 40,25 60,30 80,15 100,10 120,28 140,35 160,20 180,12 200,18" />
        </svg>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {['Speed', 'Density', 'Bz/Bt'].map(label => (
          <div key={label} className="bg-neutral-800/30 rounded-lg px-2 py-2 text-center">
            <svg viewBox="0 0 60 20" className="w-full h-4 mb-1"><polyline fill="none" stroke="#38bdf8" strokeWidth="1" points={`0,${12} 15,${8} 30,${15} 45,${6} 60,${11}`} /></svg>
            <div className="text-[9px] text-neutral-500">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-neutral-500 text-center">24-hour graphs for all solar wind components plus an EPAM energetic particle monitor at the bottom. If you want to know <em>why</em>, look here.</p>
    </div>
  )},

  { id: 'solar-suvi', section: 'Solar Dashboard', title: 'SUVI Difference Imagery', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Highlights anything moving on the sun by subtracting consecutive frames.</p>
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-neutral-800/40 rounded-lg p-2 text-center">
          <div className="w-14 h-14 mx-auto rounded-full bg-yellow-600/30 border border-yellow-500/20" />
          <div className="text-[9px] text-neutral-500 mt-1">Normal</div>
        </div>
        <div className="text-neutral-600 text-lg">→</div>
        <div className="flex-1 bg-neutral-800/40 rounded-lg p-2 text-center">
          <div className="relative w-14 h-14 mx-auto rounded-full bg-neutral-900 border border-neutral-700">
            <div className="absolute top-1 right-1 w-3 h-3 rounded-full bg-emerald-400/80 animate-pulse" />
            <div className="absolute bottom-2 left-2 w-2 h-4 rounded-full bg-emerald-400/50 rotate-45" />
          </div>
          <div className="text-[9px] text-emerald-400 mt-1">Difference</div>
        </div>
      </div>
      <p className="text-[10px] text-neutral-500 text-center">Stationary = invisible. Moving material lights up.</p>
      <div className="space-y-2 mt-2">
        <SuviCard wavelength="195" color="#34d399" bestFor="Structures leaving the sun" />
        <SuviCard wavelength="131" color="#f87171" bestFor="Pinpointing solar flares" />
        <SuviCard wavelength="304" color="#fb923c" bestFor="Dense eruptions and filaments" />
      </div>
    </div>
  )},

  { id: 'solar-coronagraph', section: 'Solar Dashboard', title: 'Coronagraph Imagery', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Blocks the bright solar disk to reveal what's leaving the sun.</p>
      <div className="flex justify-center">
        <div className="relative w-36 h-36">
          <svg viewBox="0 0 160 160" className="w-full h-full">
            <circle cx="80" cy="80" r="55" fill="#1a1a1a" opacity="0.4" />
            <circle cx="80" cy="80" r="14" fill="#262626" stroke="#333" strokeWidth="1" />
            <circle cx="80" cy="80" r="6" fill="#fbbf24" opacity="0.3" />
            <path d="M95,65 Q120,50 140,45" fill="none" stroke="#a3a3a3" strokeWidth="2" opacity="0.4" />
            <circle cx="140" cy="45" r="6" fill="#a3a3a3" opacity="0.15" />
            <text x="145" y="42" fill="#737373" fontSize="7">CME</text>
          </svg>
        </div>
      </div>
      <p className="text-[10px] text-neutral-500 text-center">CMEs appear as expanding clouds moving outward. Difference mode makes them far easier to spot.</p>
      <p className="text-[10px] text-neutral-500 text-center">This is where you see potential storms before they reach Earth days later.</p>
    </div>
  )},

  { id: 'solar-sunspots', section: 'Solar Dashboard', title: 'Sunspot Tracker', render: () => (
    <div className="space-y-2">
      <p className="text-xs text-neutral-400 text-center">Classified by how explosive they could be.</p>
      <SunspotClass cls="Alpha" risk="Stable" color="#34d399" desc="Simple, single polarity. Nothing to worry about." />
      <SunspotClass cls="Beta" risk="Minor" color="#fbbf24" desc="Two polarities. Minor to moderate flares." />
      <SunspotClass cls="B-G" risk="Active" color="#fb923c" desc="Beta-Gamma. Complex. Strong flares possible." />
      <SunspotClass cls="BGD" risk="Danger" color="#f87171" desc="Beta-Gamma-Delta. X-class flares and major CMEs." />
    </div>
  )},

  { id: 'cme-overview', section: 'CME Visualization', title: 'World-First 3D CME Model', render: () => (
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
      <div className="text-center">
        <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30">World First</span>
      </div>
      <p className="text-xs text-neutral-400 text-center">Watch CMEs travel from the Sun to Earth in real-time 3D. Rotate, zoom, and scrub through time.</p>
    </div>
  )},

  { id: 'cme-controls', section: 'CME Visualization', title: 'Timeline and Controls', render: () => (
    <div className="space-y-3">
      <div className="bg-neutral-800/60 rounded-lg px-3 py-2.5 flex items-center gap-2">
        <div className="flex items-center gap-1">
          <div className="w-6 h-6 rounded bg-neutral-700/60 flex items-center justify-center text-[10px]">⏮</div>
          <div className="w-7 h-7 rounded bg-neutral-700/60 flex items-center justify-center text-xs">▶️</div>
          <div className="w-6 h-6 rounded bg-neutral-700/60 flex items-center justify-center text-[10px]">⏭</div>
        </div>
        <div className="flex-1 h-1.5 bg-neutral-700 rounded-full"><div className="w-1/3 h-full bg-sky-500 rounded-full" /></div>
        <div className="flex gap-0.5">
          {['1x', '5x', '20x'].map(s => (
            <div key={s} className={`px-1.5 py-0.5 rounded text-[8px] ${s === '1x' ? 'bg-sky-600/30 text-sky-400' : 'bg-neutral-800 text-neutral-500'}`}>{s}</div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[{ l: 'CME List', d: 'Tap any CME to focus on it' }, { l: 'Impact Graph', d: 'Predicted arrival at Earth' }, { l: 'Forecast Models', d: 'Compare arrival estimates' }, { l: 'Share CME', d: 'Copy a link to share' }].map(i => (
          <div key={i.l} className="bg-neutral-800/40 rounded-lg px-3 py-2"><div className="text-[10px] font-semibold text-neutral-300">{i.l}</div><div className="text-[9px] text-neutral-500">{i.d}</div></div>
        ))}
      </div>
    </div>
  )},

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
      <div className="text-center">
        <span className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-400 border border-amber-500/30">World First</span>
      </div>
      <p className="text-xs text-neutral-400 text-center">See coronal holes and high-speed streams spiralling through the solar system. HSS interact with CMEs and are a common aurora driver in NZ.</p>
    </div>
  )},

  { id: 'notifications', section: 'Settings and Notifications', title: 'Aurora Notifications', render: () => (
    <div className="space-y-3">
      <p className="text-xs text-neutral-400 text-center">Choose a preset or customise every alert.</p>
      <div className="space-y-2">
        <PresetButton emoji="👁️" label="Eye visibility" desc="Only when visible to the naked eye" />
        <PresetButton emoji="📱" label="Phone camera" desc="When your phone camera will pick it up" active />
        <PresetButton emoji="📷" label="DSLR / Mirrorless" desc="When a long exposure will show it" />
        <PresetButton emoji="🔔" label="Everything" desc="All aurora and space weather alerts" />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-800/30">
        <span className="text-sm">🎛️</span>
        <span className="text-[10px] text-neutral-400">Or go fully custom and toggle each alert individually</span>
      </div>
    </div>
  )},

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
