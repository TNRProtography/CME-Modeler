import React, { useState, useEffect, useCallback, useRef } from 'react';
import { subscribeUserToPush, getNotificationPreference, setNotificationPreference, updatePushSubscriptionPreferences, getOvernightMode, setOvernightMode } from '../utils/notifications';
import type { OvernightMode } from '../utils/notifications';
import CloseIcon from './icons/CloseIcon';

// --- Storage keys ---
const BANNER_DISMISSED_KEY = 'onboarding_banner_dismissed_v1';

// --- Notification groups (mirrors SettingsModal, but with plain-English tooltips for newcomers) ---
const NOTIFICATION_GROUPS = [
  {
    group: 'Aurora Visibility',
    description: 'Get alerted when the aurora is visible from your location.',
    items: [
      {
        id: 'visibility-dslr',
        emoji: '📷',
        label: 'DSLR camera visible',
        plain: 'The earliest warning -- aurora is just becoming detectable. Perfect if you want time to grab your camera and drive somewhere dark.',
      },
      {
        id: 'visibility-phone',
        emoji: '📱',
        label: 'Phone camera visible',
        plain: 'Aurora is bright enough for your smartphone\'s night mode. You may not see it with your eyes yet, but point your phone south and you\'ll catch it.',
      },
      {
        id: 'visibility-naked',
        emoji: '👁️',
        label: 'Naked eye visible',
        plain: 'The big one -- aurora should be visible to the naked eye from your location. Just go outside and look south.',
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
        label: 'Worth watching tonight',
        plain: 'Sent around sunset when conditions look elevated. Includes whether the moon will interfere. Not sent on quiet nights -- only when it\'s actually worth staying up.',
      },
    ],
  },
  {
    group: 'Solar Events',
    description: 'Space weather that could trigger aurora in the hours or days ahead.',
    items: [
      {
        id: 'flare-event',
        emoji: '☀️',
        label: 'Solar flare',
        plain: 'A solar flare has peaked. Flares can enhance aurora but effects usually arrive 1-3 days later. Think of this as an early heads-up to watch conditions over the coming days.',
      },
      {
        id: 'shock-detection',
        emoji: '💥',
        label: 'Solar wind shock',
        plain: 'A sudden jump in solar wind has been detected -- about 30-60 minutes from Earth. One of the most actionable alerts. Conditions can go from quiet to active very quickly after a shock.',
      },
      {
        id: 'cme-sheath',
        emoji: '🌞',
        label: 'CME arrival',
        plain: 'A coronal mass ejection is passing Earth. These can drive aurora for hours at a time. If you see this alert, keep checking the forecast through the night.',
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
        label: 'Announcements',
        plain: 'Sent manually by the Spot The Aurora team only when something genuinely matters -- a major aurora event happening right now, important app news, or a useful tip. Sent sparingly.',
      },
    ],
  },
];

// --- Tooltip ---
const Tooltip: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  return (
    <div className="relative inline-block" ref={ref}>
      <div
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        onTouchStart={() => setVisible(v => !v)}
      >
        {children}
      </div>
      {visible && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-xs text-neutral-200 leading-relaxed shadow-2xl pointer-events-none">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-800" />
        </div>
      )}
    </div>
  );
};

// --- Notifications Modal ---
const NotificationsModal: React.FC<{ onClose: () => void; onDone: () => void }> = ({ onClose, onDone }) => {
  const [prefs, setPrefs] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    NOTIFICATION_GROUPS.forEach(g => g.items.forEach(item => {
      initial[item.id] = getNotificationPreference(item.id);
    }));
    return initial;
  });
  const [isEnabling, setIsEnabling] = useState(false);
  const [permissionStatus, setPermissionStatus] = useState<string>(() =>
    'Notification' in window ? Notification.permission : 'unsupported'
  );
  const [error, setError] = useState<string | null>(null);
  const [overnightMode, setOvernightModeState] = useState<OvernightMode>(() => getOvernightMode());

  const togglePref = useCallback((id: string) => {
    setPrefs(prev => ({ ...prev, [id]: !prev[id] }));
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
    // Persist immediately -- will be sent to server on next full subscribe/update
    try { localStorage.setItem('notification_overnight_mode', mode); } catch {}
  }, []);

  const allSelected = Object.values(prefs).every(Boolean);
  const toggleAll = () => {
    const next = !allSelected;
    setPrefs(prev => Object.fromEntries(Object.keys(prev).map(k => [k, next])));
  };

  const alreadyGranted = permissionStatus === 'granted';

  return (
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

          {/* Toggle all */}
          <button
            onClick={toggleAll}
            className="w-full text-xs text-sky-400 hover:text-sky-300 text-left transition-colors"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>

          {NOTIFICATION_GROUPS.map(group => (
            <div key={group.group}>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-1">{group.group}</p>
              <p className="text-xs text-neutral-500 mb-2">{group.description}</p>
              <div className="space-y-2">
                {group.items.map(item => (
                  <React.Fragment key={item.id}>
                  <div className="flex items-start gap-3 p-3 bg-neutral-900 rounded-xl border border-neutral-800">
                    <button
                      onClick={() => togglePref(item.id)}
                      className={`relative flex-shrink-0 w-10 h-6 rounded-full transition-colors duration-200 mt-0.5 focus:outline-none ${prefs[item.id] ? 'bg-sky-500' : 'bg-neutral-700'}`}
                      aria-pressed={prefs[item.id]}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${prefs[item.id] ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm">{item.emoji}</span>
                        <span className="text-sm font-medium text-neutral-200">{item.label}</span>
                        <Tooltip text={item.plain}>
                          <span className="text-neutral-500 hover:text-neutral-300 cursor-help transition-colors text-xs border border-neutral-700 rounded-full w-4 h-4 inline-flex items-center justify-center">?</span>
                        </Tooltip>
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
                ))}
              </div>
            </div>
          ))}

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
              className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-sm transition-colors"
            >
              Save preferences
            </button>
          ) : (
            <button
              onClick={handleEnable}
              disabled={isEnabling}
              className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:bg-neutral-700 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
            >
              {isEnabling ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Enabling...
                </>
              ) : (
                '🔔 Enable notifications'
              )}
            </button>
          )}
          <p className="text-xs text-neutral-600 text-center mt-2">You can change these anytime in Settings</p>
        </div>
      </div>
    </div>
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