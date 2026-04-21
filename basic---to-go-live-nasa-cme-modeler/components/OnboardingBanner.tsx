import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { subscribeUserToPush, getNotificationPreference, setNotificationPreference, updatePushSubscriptionPreferences, getOvernightMode, setOvernightMode } from '../utils/notifications';
import type { OvernightMode } from '../utils/notifications';
import CloseIcon from './icons/CloseIcon';

// --- Storage keys ---
const BANNER_DISMISSED_KEY = 'onboarding_banner_dismissed_v1';

// Shock notifications are "coming soon" — always excluded from presets and
// defaults so the user never gets them enabled during onboarding.
const SHOCK_IDS = new Set(['shock-ff', 'shock-sf', 'shock-fr', 'shock-sr', 'shock-imf']);

// --- Presets ---
// Each preset answers the question "how do you want to experience aurora?"
// The `prefs` list is the set of notification IDs to enable. All other IDs
// (except shocks, which are always off) are disabled. `overnightMode` sets
// the threshold for the nightly "worth watching" summary.
type PresetId = 'naked' | 'phone' | 'dslr' | 'everything' | 'custom';
interface Preset {
  id: PresetId;
  emoji: string;
  title: string;
  tagline: string;
  description: string;
  prefs: string[];               // notification IDs to enable
  overnightMode: OvernightMode;
}
const PRESETS: Preset[] = [
  {
    id: 'naked',
    emoji: '👁️',
    title: 'Naked-eye only',
    tagline: 'The big ones',
    description: 'Minimal alerts — only when aurora should be visible to the naked eye from your location, plus very strong flares and announcements.',
    prefs: ['visibility-naked', 'overnight-watch', 'flare-X1', 'flare-X5', 'flare-X10', 'admin-broadcast'],
    overnightMode: 'eye',
  },
  {
    id: 'phone',
    emoji: '📱',
    title: 'Phone camera',
    tagline: 'A practical middle ground',
    description: 'Alerts when aurora is bright enough for a phone camera or better, plus meaningful flare activity (M5+) and nightly watch.',
    prefs: ['visibility-phone', 'visibility-naked', 'overnight-watch', 'flare-M5', 'flare-X1', 'flare-X5', 'flare-X10', 'admin-broadcast'],
    overnightMode: 'phone',
  },
  {
    id: 'dslr',
    emoji: '📷',
    title: 'DSLR / early warning',
    tagline: 'Maximum lead time',
    description: 'Catch aurora as soon as it becomes camera-detectable, with broader flare coverage (M1+). Best if you want time to drive somewhere dark.',
    prefs: ['visibility-dslr', 'visibility-phone', 'visibility-naked', 'overnight-watch', 'flare-M1', 'flare-M5', 'flare-X1', 'flare-X5', 'flare-X10', 'admin-broadcast'],
    overnightMode: 'camera',
  },
  {
    id: 'everything',
    emoji: '🔔',
    title: 'Everything',
    tagline: 'Full firehose',
    description: 'Every alert we currently send — all visibility thresholds, all flare classes, and announcements. Best for enthusiasts who want nothing missed.',
    prefs: ['visibility-dslr', 'visibility-phone', 'visibility-naked', 'overnight-watch', 'flare-M1', 'flare-M5', 'flare-X1', 'flare-X5', 'flare-X10', 'admin-broadcast'],
    overnightMode: 'camera',
  },
  {
    id: 'custom',
    emoji: '⚙️',
    title: 'Custom',
    tagline: 'Pick individually',
    description: 'Skip the preset and choose each alert yourself.',
    prefs: [],
    overnightMode: 'phone',
  },
];

// --- Notification groups (mirrors SettingsModal, but with plain-English tooltips for newcomers) ---
const NOTIFICATION_GROUPS = [
  {
    group: 'Aurora Visibility',
    description: 'Get alerted when the aurora is visible from your location.',
    items: [
      {
        id: 'visibility-dslr',
        emoji: '📷',
        label: 'DSLR Camera Visible',
        plain: 'The earliest warning — aurora is just becoming detectable using a DSLR camera on a tripod with a long exposure.',
        auroraEffect: 'Perfect for maximum lead time — gives you time to grab your camera and drive somewhere dark before it peaks.',
        advanced: 'Triggered when the aurora oval reaches your geomagnetic latitude at the lowest detectable threshold. Aurora may not yet be visible to the naked eye.',
      },
      {
        id: 'visibility-phone',
        emoji: '📱',
        label: 'Phone Camera Visible',
        plain: 'Aurora is bright enough for your smartphone\'s night mode. Point your phone south and you\'ll catch it.',
        auroraEffect: 'A practical middle-ground alert — conditions are real enough to capture, even if you can\'t see it directly yet.',
        advanced: 'Corresponds to moderate oval expansion. The aurora oval boundary has moved close enough to your latitude that activity exceeds the phone camera threshold.',
      },
      {
        id: 'visibility-naked',
        emoji: '👁️',
        label: 'Naked Eye Visible',
        plain: 'The big one — aurora should be visible to the naked eye from your location. Just go outside and look south.',
        auroraEffect: 'This is the strongest visibility threshold and the most exciting alert. Conditions are genuinely significant for your location.',
        advanced: 'Requires substantial oval expansion equatorward. Combined with sufficient activity index, this is a high-confidence aurora event for your latitude.',
      },
    ],
  },
  {
    group: 'Tonight\'s Forecast',
    description: 'A heads-up before dark so you can plan your evening.',
    items: [
      {
        id: 'overnight-watch',
        emoji: '🌌',
        label: 'Worth Watching Tonight',
        plain: 'Sent around sunset when conditions look elevated. Includes whether the moon will interfere.',
        auroraEffect: 'Not sent on quiet nights — only when solar wind conditions are genuinely elevated enough to be worth staying up for.',
        advanced: 'Uses a composite of live Bz, solar wind speed, Newell coupling, and short-range forecast confidence. Sent once per evening window (6–9 PM NZST).',
      },
    ],
  },
  {
    group: 'Solar Events',
    description: 'Space weather that could trigger aurora in the hours or days ahead.',
    items: [
      {
        id: 'flare-M1',
        emoji: '☀️',
        label: 'Solar Flare M1+',
        plain: 'Broad flare alert sent from M1 and up — earliest notice when flare activity starts ramping.',
        auroraEffect: 'M1+ flares signal increasing solar activity. While not all produce Earth-directed CMEs, frequent M-class activity raises aurora probability over the following 1–4 days.',
        advanced: 'Flare class scales logarithmically — M1 is 10× a C1. Geoeffectiveness depends on CME association, source longitude, and CME speed.',
      },
      {
        id: 'flare-M5',
        emoji: '☀️',
        label: 'Solar Flare M5+',
        plain: 'Stronger M-class flares only — fewer alerts, still catches meaningful events.',
        auroraEffect: 'M5+ flares have a stronger association with major CME launches. Fewer false alarms than M1+ while still providing useful lead time.',
        advanced: 'M5 is approximately 5× an M1 in X-ray flux. Often associated with type II/IV radio bursts and proton events that help confirm CME launches.',
      },
      {
        id: 'flare-X1',
        emoji: '☀️',
        label: 'Solar Flare X1+',
        plain: 'Major X-class flare alert — high threshold, focused on large events.',
        auroraEffect: 'X-class flares are major solar events with a high association with fast, geoeffective CMEs that drive significant aurora 1–4 days later.',
        advanced: 'X-class flares are 10× stronger than M-class. Source longitude on the solar disk strongly influences whether the associated CME is Earth-directed.',
      },
      {
        id: 'flare-X5',
        emoji: '☀️',
        label: 'Solar Flare X5+',
        plain: 'Very strong flare threshold — rare and high-impact events only.',
        auroraEffect: 'X5+ flares represent extreme solar output and are often followed by the most significant geomagnetic storms and wide-latitude aurora events.',
        advanced: 'These events frequently trigger NOAA G3–G5 geomagnetic storm watches. CME speeds commonly exceed 1500 km/s with strong compressed IMF fields on arrival.',
      },
      {
        id: 'flare-X10',
        emoji: '☀️',
        label: 'Solar Flare X10+',
        plain: 'Extreme flare alert for exceptional events only — very rare.',
        auroraEffect: 'Historically associated with the strongest geomagnetic storms on record. If Earth-directed, these events can produce aurora visible from the tropics.',
        advanced: 'X10+ events are rare — typically a few per solar cycle. The X28 event in 2003 saturated monitoring instruments. These produce the most extreme space weather conditions.',
      },
      {
        id: 'shock-ff',
        emoji: '💥',
        label: 'CME Hit the Satellites',
        plain: 'A fast forward shock — the classic CME arrival signature at L1. Speed, density, temperature, and magnetic field all jumped simultaneously.',
        auroraEffect: 'One of the most actionable aurora alerts. Earth conditions can shift from quiet to active within 30–60 minutes. Watch for southward Bz in the Solar Wind panel.',
        advanced: 'Fast Forward shocks compress the entire solar wind structure ahead of them. Aurora strength depends on the sheath and magnetic cloud Bz that follows the shock front.',
      },
      {
        id: 'shock-sf',
        emoji: '💥',
        label: 'Compression Wave Arriving',
        plain: 'A slow forward shock — a gentler compression wave, often from a solar wind stream or weak CME edge.',
        auroraEffect: 'Can enhance aurora conditions but typically less dramatically than a fast forward shock. Watch for Bz turning southward in the following hours.',
        advanced: 'Often marks the leading edge of a stream interaction region (SIR). Lacks the strong magnetic cloud of a CME but can still drive moderate geomagnetic activity.',
      },
      {
        id: 'shock-fr',
        emoji: '💥',
        label: 'CME Trailing Edge Passing',
        plain: 'A fast reverse shock — the back end of a CME or high-speed stream is sweeping past.',
        auroraEffect: 'The strongest part of the disturbance has typically already passed. Residual aurora may continue for hours, but activity is usually declining.',
        advanced: 'Fast reverse shocks occur when fast solar wind outruns the slower wind behind it, creating a rarefaction at the trailing boundary.',
      },
      {
        id: 'shock-sr',
        emoji: '💥',
        label: 'Trailing Rarefaction',
        plain: 'A slow reverse shock — density and temperature falling as the tail end of a solar wind event sweeps past.',
        auroraEffect: 'Aurora is usually winding down at this point. Confirms the full passage of a solar wind structure and that conditions are returning toward baseline.',
        advanced: 'Slow reverse shocks are relatively uncommon. Density and temperature decrease while the magnetic field slightly increases across the boundary.',
      },
      {
        id: 'shock-imf',
        emoji: '🧲',
        label: 'IMF Field Shift',
        plain: 'A sudden magnetic field change at L1 — no plasma shock, just the field direction changing rapidly.',
        auroraEffect: 'If the field swings southward (Bz negative), aurora can ramp up very quickly — even without a speed or density increase. Fast-acting and easy to miss without real-time monitoring.',
        advanced: 'IMF discontinuities often signal heliospheric current sheet crossings or magnetic flux ropes in the solar wind. Aurora response depends almost entirely on the Bz direction and duration that follows.',
      },
    ],
  },
  {
    group: 'Announcements',
    description: 'Occasional messages from the Spot The Aurora team.',
    items: [
      {
        id: 'admin-broadcast',
        emoji: '📣',
        label: 'Spot The Aurora Announcements',
        plain: 'Sent manually by the team only when something genuinely matters — a major aurora event, important app news, or a useful tip.',
        auroraEffect: 'If you receive one of these during the night, it is worth checking conditions immediately — they are only sent when there is something real happening.',
        advanced: 'These are not automated — a human sends them. Frequency is very low by design. If you are sensitive to notifications, this is the safest group to keep enabled.',
      },
    ],
  },
];

// --- InfoModal ---
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string | React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (<div dangerouslySetInnerHTML={{ __html: content }} />) : (content)}
        </div>
      </div>
    </div>,
    document.body
  );
};

// --- Notifications Modal ---
const NotificationsModal: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    NOTIFICATION_GROUPS.forEach(g => g.items.forEach(item => {
      // Shocks are "coming soon" — always initialized off, ignoring any
      // legacy stored value so the user never sees them pre-enabled.
      initial[item.id] = SHOCK_IDS.has(item.id) ? false : getNotificationPreference(item.id);
    }));
    return initial;
  });
  const [selectedPreset, setSelectedPreset] = useState<PresetId | null>(() => {
    // If the user already has notifications granted, they're returning to edit
    // existing preferences — skip the forced preset picker and show their
    // current settings under "Custom" so they can tweak directly.
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      return 'custom';
    }
    return null;
  });
  const [isEnabling, setIsEnabling] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string>(() =>
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [error, setError] = useState<string | null>(null);
  const [overnightMode, setOvernightModeState] = useState<OvernightMode>(() => getOvernightMode());
  const [infoModalData, setInfoModalData] = useState<{ title: string; content: string } | null>(null);

  const buildStatTooltip = (title: string, whatItIs: string, auroraEffect: string, advanced: string) => `
    <div class='space-y-3 text-left'>
      <p><strong>${title}</strong></p>
      <p><strong>What this is:</strong> ${whatItIs}</p>
      <p><strong>Why it matters for aurora:</strong> ${auroraEffect}</p>
      <p class='text-xs text-neutral-400'><strong>Advanced:</strong> ${advanced}</p>
    </div>
  `;

  const togglePref = useCallback((id: string) => {
    if (SHOCK_IDS.has(id)) return; // shocks are locked off — coming soon
    setPrefs(prev => ({ ...prev, [id]: !prev[id] }));
    // If the user manually tweaks a toggle, mark them as on the "custom" preset
    // so the detailed list stays visible and the "Enable" button stays active.
    setSelectedPreset('custom');
  }, []);

  const applyPreset = useCallback((preset: Preset) => {
    setSelectedPreset(preset.id);
    if (preset.id === 'custom') {
      // Custom = leave the user's current selections alone, just reveal the list.
      return;
    }
    // Build the full prefs object: everything off, then turn on the preset's
    // list. Shocks stay off regardless.
    setPrefs(prev => {
      const next: Record<string, boolean> = {};
      Object.keys(prev).forEach(id => {
        if (SHOCK_IDS.has(id)) { next[id] = false; return; }
        next[id] = preset.prefs.includes(id);
      });
      return next;
    });
    // Also update overnight-watch mode to match the preset.
    setOvernightModeState(preset.overnightMode);
    setOvernightMode(preset.overnightMode);
  }, []);

  const handleEnable = useCallback(async () => {
    setIsEnabling(true);
    setError(null);
    try {
      // Save preferences first
      Object.entries(prefs).forEach(([id, enabled]) => setNotificationPreference(id, enabled));

      const result = await subscribeUserToPush();
      if (result) {
        await updatePushSubscriptionPreferences();
        setPermissionStatus('granted');
        onDone();
      } else {
        setError('Could not enable notifications. Please check your browser settings and try again.');
        setPermissionStatus('Notification' in window ? Notification.permission : 'unsupported');
      }
    } catch (e) {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsEnabling(false);
    }
  }, [prefs, onDone]);

  const handleSavePrefs = useCallback(async () => {
    Object.entries(prefs).forEach(([id, enabled]) => setNotificationPreference(id, enabled));
    await updatePushSubscriptionPreferences();
    onClose();
  }, [prefs, onClose]);

  const handleOvernightModeChange = useCallback(async (mode: OvernightMode) => {
    setOvernightModeState(mode);
    setOvernightMode(mode);
    // Fix: also push the updated mode to the server immediately.
    // Previously this only saved to localStorage, so the server always
    // defaulted the user to 'phone' mode regardless of their selection.
    await updatePushSubscriptionPreferences();
  }, []);

  // Compute allSelected ignoring shocks, since they're locked off (coming soon).
  const allSelected = Object.entries(prefs).every(([id, v]) => SHOCK_IDS.has(id) || v);
  const toggleAll = () => {
    const next = !allSelected;
    setPrefs(prev => Object.fromEntries(
      Object.keys(prev).map(k => [k, SHOCK_IDS.has(k) ? false : next])
    ));
    setSelectedPreset('custom');
  };

  const alreadyGranted = permissionStatus === 'granted';

  return (
    <>
    <InfoModal isOpen={!!infoModalData} onClose={() => setInfoModalData(null)} title={infoModalData?.title ?? ''} content={infoModalData?.content ?? ''} />
    <div className="fixed inset-0 z-[3000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full sm:max-w-lg bg-neutral-950 border border-neutral-800 rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-neutral-800 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-white">Aurora Notifications</h2>
            <p className="text-xs text-neutral-400 mt-0.5">Choose which alerts you'd like to receive</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4 space-y-5 styled-scrollbar">

          {/* --- Preset picker --- */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-2">How do you want to experience aurora?</p>
            <p className="text-xs text-neutral-500 mb-3">Pick the option that matches how you watch. You can fine-tune below, or change this anytime in Settings.</p>
            <div className="grid grid-cols-1 gap-2">
              {PRESETS.map(preset => {
                const active = selectedPreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => applyPreset(preset)}
                    className={`text-left p-3 rounded-xl border transition-colors ${
                      active
                        ? 'bg-sky-500/15 border-sky-500/60 ring-1 ring-sky-500/40'
                        : 'bg-neutral-900 border-neutral-800 hover:bg-neutral-800/60 hover:border-neutral-700'
                    }`}
                    aria-pressed={active}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">{preset.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm font-semibold ${active ? 'text-sky-200' : 'text-neutral-200'}`}>{preset.title}</span>
                          <span className="text-[11px] text-neutral-500">{preset.tagline}</span>
                        </div>
                        <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{preset.description}</p>
                      </div>
                      {active && (
                        <span className="flex-shrink-0 text-sky-400 text-sm" aria-hidden="true">✓</span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* --- Detailed toggle list (shown once a preset is picked, so new users aren't overwhelmed) --- */}
          {selectedPreset !== null && (
            <>
              <div className="border-t border-neutral-800 pt-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                    {selectedPreset === 'custom' ? 'Choose your alerts' : 'Fine-tune your alerts'}
                  </p>
                  <button
                    onClick={toggleAll}
                    className="text-xs text-sky-400 hover:text-sky-300 transition-colors"
                  >
                    {allSelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>
                <p className="text-xs text-neutral-500 mb-3">
                  {selectedPreset === 'custom'
                    ? 'Pick each alert individually below.'
                    : 'Your preset is applied. Tweak anything below if you want.'}
                </p>
              </div>

              {NOTIFICATION_GROUPS.map(group => (
                <div key={group.group}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">{group.group}</p>
                  <p className="text-xs text-neutral-500 mb-2">{group.description}</p>
                  <div className="space-y-2">
                    {group.items.map(item => {
                      const isShock = SHOCK_IDS.has(item.id);
                      return (
                      <React.Fragment key={item.id}>
                      <div className={`flex items-start gap-3 p-3 rounded-xl border ${isShock ? 'bg-neutral-900/40 border-neutral-800/60 opacity-70' : 'bg-neutral-900 border-neutral-800'}`}>
                        <button
                          onClick={() => togglePref(item.id)}
                          disabled={isShock}
                          className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors duration-200 mt-0.5 focus:outline-none ${
                            isShock
                              ? 'bg-neutral-800 cursor-not-allowed'
                              : prefs[item.id] ? 'bg-sky-500' : 'bg-neutral-700'
                          }`}
                          aria-pressed={prefs[item.id]}
                          aria-disabled={isShock}
                        >
                          <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow transition-transform duration-200 ${isShock ? 'bg-neutral-500' : 'bg-white'} ${prefs[item.id] ? 'translate-x-4' : 'translate-x-0'}`} />
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm">{item.emoji}</span>
                            <span className={`text-sm font-medium ${isShock ? 'text-neutral-400' : 'text-neutral-200'}`}>{item.label}</span>
                            {isShock && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-sky-500/15 text-sky-300 border border-sky-500/30">
                                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                COMING SOON
                              </span>
                            )}
                            <button
                              onClick={() => setInfoModalData({ title: `About: ${item.label}`, content: buildStatTooltip(item.label, item.plain, item.auroraEffect ?? item.plain, item.advanced ?? '') })}
                              className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
                              title={`About ${item.label}`}
                            >?</button>
                          </div>
                          <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{item.plain.split('.')[0]}.</p>
                        </div>
                      </div>
                      {/* Overnight mode selector -- shown inline when overnight-watch is toggled on */}
                      {item.id === 'overnight-watch' && prefs[item.id] && (
                        <div className="mt-2 p-3 bg-neutral-800/60 border border-neutral-700/50 rounded-xl">
                          <p className="text-xs font-semibold text-neutral-300 mb-2">Send when...</p>
                          <div className="space-y-1.5">
                            {([
                              { value: 'every-night', label: 'Every night', desc: 'Always send a nightly summary, even on quiet nights.' },
                              { value: 'camera',      label: 'Camera may detect aurora', desc: 'Only when conditions could show aurora on a DSLR.' },
                              { value: 'phone',       label: 'Phone camera may show aurora', desc: 'Only when aurora should appear on a smartphone camera.' },
                              { value: 'eye',         label: 'Naked eye aurora likely', desc: 'Only on significant nights -- naked eye visibility possible.' },
                            ] as { value: OvernightMode; label: string; desc: string }[]).map(opt => (
                              <label key={opt.value} className={`flex items-start gap-2 cursor-pointer p-2 rounded-lg transition-colors ${overnightMode === opt.value ? 'bg-sky-500/15 border border-sky-500/30' : 'hover:bg-neutral-700/40'}`}>
                                <input
                                  type="radio"
                                  name="overnight-mode-onboarding"
                                  value={opt.value}
                                  checked={overnightMode === opt.value}
                                  onChange={() => handleOvernightModeChange(opt.value)}
                                  className="mt-0.5 accent-sky-500 flex-shrink-0"
                                />
                                <div>
                                  <p className="text-xs font-medium text-neutral-200">{opt.label}</p>
                                  <p className="text-[11px] text-neutral-500 leading-relaxed mt-0.5">{opt.desc}</p>
                                </div>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-neutral-800 flex-shrink-0">
          {alreadyGranted ? (
            <button
              onClick={handleSavePrefs}
              disabled={selectedPreset === null}
              className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
            >
              {selectedPreset === null ? 'Pick an option above' : 'Save preferences'}
            </button>
          ) : (
            <button
              onClick={handleEnable}
              disabled={isEnabling || selectedPreset === null}
              className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isEnabling ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Enabling...
                </>
              ) : selectedPreset === null ? (
                'Pick an option above'
              ) : (
                '🔔 Enable notifications'
              )}
            </button>
          )}
          <p className="text-xs text-neutral-600 text-center mt-2">You can change these anytime in Settings</p>
        </div>
      </div>
    </div>
    </>
  );
};

// --- Main Banner ---
interface OnboardingBannerProps {
  deferredInstallPrompt: Event | null;
  onInstallClick: () => void;
}

const OnboardingBanner: React.FC<OnboardingBannerProps> = ({ deferredInstallPrompt, onInstallClick }) => {
  const [dismissed, setDismissed] = useState(() =>
    localStorage.getItem(BANNER_DISMISSED_KEY) === 'true'
  );
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [isInstalled, setIsInstalled] = useState(() =>
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
  const [showNotifModal, setShowNotifModal] = useState(false);

  // Re-check install/notif status
  useEffect(() => {
    const mq = window.matchMedia('(display-mode: standalone)');
    const handler = (e: MediaQueryListEvent) => setIsInstalled(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    // Poll permission in case user grants it in browser settings
    const interval = setInterval(() => {
      if ('Notification' in window) setNotifPermission(Notification.permission);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(BANNER_DISMISSED_KEY, 'true');
    setDismissed(true);
  }, []);

  const handleNotifDone = useCallback(() => {
    setShowNotifModal(false);
    setNotifPermission('Notification' in window ? Notification.permission : 'unsupported');
  }, []);

  const notifGranted = notifPermission === 'granted';
  const canInstall = !!deferredInstallPrompt && !isInstalled;

  // Determine what to show.
  // Notifications button is only shown once the app is installed — no point
  // prompting for push notifications in a browser tab where they won't persist.
  const showInstall = canInstall;
  const showNotif = isInstalled && !notifGranted;

  // Hide entirely if: dismissed, or nothing left to show
  if (dismissed || (!showInstall && !showNotif)) return null;

  return (
    <>
      {showNotifModal && (
        <NotificationsModal
          onClose={() => setShowNotifModal(false)}
          onDone={handleNotifDone}
        />
      )}

      <div className="fixed bottom-0 left-0 right-0 z-[2000] p-3 sm:p-4">
        <div className="max-w-2xl mx-auto bg-neutral-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl px-4 py-3 flex items-center gap-3">

          {/* Icon */}
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-sky-500/20 border border-sky-400/30 flex items-center justify-center text-base">
            🌌
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white leading-tight">
              {showInstall && showNotif
                ? 'Get the full experience'
                : showInstall
                  ? 'Install the app'
                  : 'Never miss an aurora'}
            </p>
            <p className="text-xs text-neutral-400 leading-tight mt-0.5 truncate">
              {showInstall && showNotif
                ? 'Install the app and enable aurora alerts'
                : showInstall
                  ? 'Add to your home screen for quick access'
                  : 'Enable push notifications for aurora alerts'}
            </p>
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {showInstall && (
              <button
                onClick={onInstallClick}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 border border-white/15 text-white text-xs font-semibold transition-colors"
              >
                <span>📲</span>
                <span className="hidden sm:inline">Install</span>
              </button>
            )}
            {showNotif && (
              <button
                onClick={() => setShowNotifModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors"
              >
                <span>🔔</span>
                <span className="hidden sm:inline">Notifications</span>
              </button>
            )}
          </div>

          {/* Dismiss */}
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 p-1 rounded-full text-neutral-500 hover:text-neutral-200 hover:bg-white/10 transition-colors"
            aria-label="Dismiss"
          >
            <CloseIcon className="w-4 h-4" />
          </button>

        </div>
      </div>
    </>
  );
};

export default OnboardingBanner;