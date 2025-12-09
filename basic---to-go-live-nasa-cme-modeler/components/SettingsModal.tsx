// --- START OF FILE src/components/SettingsModal.tsx ---

import React, { useState, useEffect, useCallback } from 'react';
import CloseIcon from './icons/CloseIcon';
import ToggleSwitch from './ToggleSwitch';
import { 
  getNotificationPreference, 
  setNotificationPreference,
  requestNotificationPermission,
  sendTestNotification,
  subscribeUserToPush,
  updatePushSubscriptionPreferences // IMPORT THE NEW FUNCTION
} from '../utils/notifications.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appVersion: string;
  onShowTutorial: () => void;
  defaultMainPage: 'forecast' | 'solar-activity' | 'modeler';
  defaultForecastView: 'simple' | 'advanced';
  onDefaultMainPageChange: (page: 'forecast' | 'solar-activity' | 'modeler') => void;
  onDefaultForecastViewChange: (view: 'simple' | 'advanced') => void;
}

const NOTIFICATION_CATEGORIES = [
  { id: 'aurora-40percent', label: 'Aurora Forecast ≥ 40% (Phone Visible)' },
  { id: 'aurora-50percent', label: 'Aurora Forecast ≥ 50% (Faint Eye Visible)' },
  { id: 'aurora-60percent', label: 'Aurora Forecast ≥ 60% (Eye Visible)' },
  { id: 'aurora-80percent', label: 'Aurora Forecast ≥ 80% (Strong Display)' },
  { id: 'flare-M1', label: 'Solar Flare ≥ M1-Class' },
  { id: 'flare-M5', label: 'Solar Flare ≥ M5-Class' },
  { id: 'flare-X1', label: 'Solar Flare ≥ X1-Class' },
  { id: 'flare-X5', label: 'Solar Flare ≥ X5-Class' },
  { id: 'flare-X10', label: 'Solar Flare ≥ X10-Class (Historic)' },
  { id: 'flare-peak', label: 'Solar Flare Peak & Decline Alerts' },
  { id: 'substorm-forecast', label: 'Substorm Forecast Issued' },
];

const LOCATION_PREF_KEY = 'location_preference_use_gps_autodetect';

// --- Local Icon Components for this file ---
const GuideIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
  </svg>
);

const MailIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
  </svg>
);

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const HeartIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.015-4.5-4.5-4.5S12 5.765 12 8.25c0-2.485-2.015-4.5-4.5-4.5S3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
    </svg>
);

const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  appVersion,
  onShowTutorial,
  defaultMainPage,
  defaultForecastView,
  onDefaultMainPageChange,
  onDefaultForecastViewChange,
}) => {
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribing, setIsSubscribing] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState<Record<string, boolean>>({});
  const [useGpsAutoDetect, setUseGpsAutoDetect] = useState<boolean>(true);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAppInstallable, setIsAppInstallable] = useState<boolean>(false);
  const [isAppInstalled, setIsAppInstalled] = useState<boolean>(false);

  const primaryActionClass = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-500 text-white font-semibold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all active:scale-95';
  const subtleActionClass = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-neutral-200 font-semibold hover:bg-white/10 transition-all active:scale-95';
  const chipActionClass = 'flex-shrink-0 px-3 py-1.5 text-xs rounded-full bg-white/10 border border-white/15 text-sky-200 hover:bg-white/20 transition-colors';

  useEffect(() => {
    if (isOpen) {
      if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        setNotificationStatus('unsupported');
      } else {
        setNotificationStatus(Notification.permission);
      }
      const loadedNotificationSettings: Record<string, boolean> = {};
      NOTIFICATION_CATEGORIES.forEach(category => {
        loadedNotificationSettings[category.id] = getNotificationPreference(category.id);
      });
      setNotificationSettings(loadedNotificationSettings);
      const storedGpsPref = localStorage.getItem(LOCATION_PREF_KEY);
      setUseGpsAutoDetect(storedGpsPref === null ? true : JSON.parse(storedGpsPref));
      checkAppInstallationStatus();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setIsAppInstallable(true);
    };
    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setIsAppInstallable(false);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const checkAppInstallationStatus = useCallback(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isPWA = (window.navigator as any).standalone === true;
    setIsAppInstalled(isStandalone || isPWA);
  }, []);
  
  const handleEnableNotifications = useCallback(async () => {
    setIsSubscribing(true);
    const permission = await requestNotificationPermission();
    setNotificationStatus(permission);

    if (permission === 'granted') {
      const subscription = await subscribeUserToPush();
      if (subscription) {
        console.log("Successfully subscribed to push notifications.");
      } else {
        console.error("Failed to get a push subscription.");
      }
    }
    setIsSubscribing(false);
  }, []);

  const handleNotificationToggle = useCallback((id: string, checked: boolean) => {
    setNotificationSettings(prev => ({ ...prev, [id]: checked }));
    setNotificationPreference(id, checked);
    // THIS IS THE FIX: Call the new function to sync changes with the server.
    updatePushSubscriptionPreferences();
  }, []);

  const handleGpsToggle = useCallback((checked: boolean) => {
    setUseGpsAutoDetect(checked);
    localStorage.setItem(LOCATION_PREF_KEY, JSON.stringify(checked));
  }, []);

  const handleInstallApp = useCallback(async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') console.log('User accepted the install prompt');
      else console.log('User dismissed the install prompt');
      setDeferredPrompt(null);
      setIsAppInstallable(false);
    } catch (error) {
      console.error('Error during app installation:', error);
    }
  }, [deferredPrompt]);
  
  const handleTestCategory = useCallback((categoryId: string) => {
    let title = 'Test Notification';
    let body = 'This is a sample alert for your selected category.';

    switch (categoryId) {
        case 'aurora-40percent':
            title = 'Aurora Alert: Phone Visible!';
            body = 'Forecast has reached 42%. Good chance to capture with a phone camera.';
            break;
        case 'aurora-50percent':
            title = 'Aurora Alert: Faint Eye Visibility!';
            body = 'Forecast has reached 51%. A faint glow may be visible to the naked eye.';
            break;
        case 'aurora-60percent':
            title = 'Aurora Alert: Eye Visible!';
            body = 'Forecast has reached 65%. Good chance of naked-eye visibility.';
            break;
        case 'aurora-80percent':
            title = 'Major Aurora Alert!';
            body = 'Forecast has reached 82%! A significant display is likely!';
            break;
        case 'flare-M1':
            title = 'Solar Flare: ≥M1-Class';
            body = 'An M1.3 flare is in progress. Minor radio blackouts possible.';
            break;
        case 'flare-M5':
            title = 'Major Flare: ≥M5-Class';
            body = 'A strong M5.8 flare is in progress. Moderate radio blackouts likely.';
            break;
        case 'flare-X1':
            title = 'Significant Flare: ≥X1-Class';
            body = 'A powerful X1.2 flare is in progress. Strong, widespread radio blackouts expected.';
            break;
        case 'flare-X5':
            title = 'Extreme Flare: ≥X5-Class';
            body = 'An extreme X5.1 flare is in progress. Severe radio blackouts and radiation storms possible.';
            break;
        case 'substorm-forecast':
            title = 'Substorm Forecast Issued';
            body = 'Forecast: ~75% chance of activity between 11:30pm and 12:00am. Expected visibility: Faint Eye Visible.';
            break;
    }
    sendTestNotification(title, body);
  }, []);


  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[3000] flex justify-center items-center p-4" 
      onClick={onClose}
    >
      <div 
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] text-neutral-300 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h2 className={`text-2xl font-bold text-neutral-200`}>App Settings</h2>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 space-y-8 flex-1">
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Support the Project</h3>
            <div className="text-sm text-neutral-400 mb-4 space-y-3">
                <p>
                    This application is a passion project, built and maintained by one person with over <strong>400 hours</strong> of development time invested. To provide the best user experience, this app will <strong>always be ad-free</strong>.
                </p>
                <p>
                    However, there are real costs for server hosting, domain registration, and API services. If you find this tool useful and appreciate the ad-free experience, please consider supporting its continued development and operational costs.
                </p>
            </div>
            <a 
              href="https://buymeacoffee.com/spottheaurora"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-3 w-full px-4 py-3 bg-yellow-500/20 border border-yellow-400/50 rounded-lg text-yellow-200 hover:bg-yellow-500/30 hover:border-yellow-300 transition-colors font-semibold"
            >
              <HeartIcon className="w-6 h-6 text-yellow-300" />
              <span>Support on Buy Me a Coffee</span>
            </a>
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">App Installation</h3>
            {isAppInstalled ? (
              <div className="bg-green-900/30 border border-green-700/50 rounded-md p-3 text-sm">
                <p className="text-green-300 flex items-center">
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                  App has been installed to your device!
                </p>
              </div>
            ) : isAppInstallable ? (
              <div className="space-y-3">
                <p className="text-sm text-neutral-400">Install this app for quick home-screen access and notifications.</p>
                <button onClick={handleInstallApp} className={primaryActionClass}>
                  <DownloadIcon className="w-4 h-4" />
                  <span>Install App</span>
                </button>
              </div>
            ) : (
              <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-md p-3 text-sm">
                <p className="text-neutral-400">App installation is not currently available.</p>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Default start view</h3>
            <p className="text-sm text-neutral-400 mb-4">
              Choose the page the app opens to by default and which forecast layout loads first when you visit Spot the Aurora.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-neutral-300" htmlFor="default-main-page">
                  Landing page
                </label>
                <select
                  id="default-main-page"
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-neutral-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={defaultMainPage}
                  onChange={e => onDefaultMainPageChange(e.target.value as 'forecast' | 'solar-activity' | 'modeler')}
                >
                  <option value="forecast">Spot the Aurora Forecast</option>
                  <option value="solar-activity">Solar Activity Dashboard</option>
                  <option value="modeler">CME Visualization</option>
                </select>
                <p className="text-xs text-neutral-500">
                  Your default landing page is stored on this device so it opens straight to your preferred dashboard.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-semibold text-neutral-300" htmlFor="default-forecast-view">
                  Forecast view mode
                </label>
                <select
                  id="default-forecast-view"
                  className="w-full bg-neutral-900 border border-neutral-800 rounded-md px-3 py-2 text-neutral-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  value={defaultForecastView}
                  onChange={e => onDefaultForecastViewChange(e.target.value as 'simple' | 'advanced')}
                >
                  <option value="simple">Simple view (at-a-glance)</option>
                  <option value="advanced">Advanced view (full detail)</option>
                </select>
                <p className="text-xs text-neutral-500">
                  The selected layout is saved locally and applied whenever you load the forecast page without a shared link.
                </p>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Push Notifications</h3>
            {notificationStatus === 'unsupported' && <p className="text-red-400 text-sm mb-4">Your browser or device does not support push notifications.</p>}
            
            {notificationStatus === 'denied' && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-md p-3 mb-4 text-sm">
                <p className="text-red-300">Notification permission was denied. You must enable them in your browser or system settings to receive alerts.</p>
              </div>
            )}

            {notificationStatus === 'default' && (
              <div className="bg-orange-900/30 border border-orange-700/50 rounded-md p-3 mb-4 text-sm">
                <p className="text-orange-300 mb-3">Enable push notifications to be alerted of major space weather events, even when the app is closed.</p>
                <button
                  onClick={handleEnableNotifications}
                  disabled={isSubscribing}
                  className={`${primaryActionClass} disabled:opacity-50 disabled:cursor-wait`}
                >
                  {isSubscribing ? 'Subscribing...' : 'Enable Notifications'}
                </button>
              </div>
            )}
            
            {notificationStatus === 'granted' && (
              <div className="space-y-4">
                <div className="bg-green-900/30 border border-green-700/50 rounded-md p-3 text-sm">
                    <p className="text-green-300">Push notifications are enabled! You can now customize your alerts below.</p>
                </div>
                <div className="space-y-3 bg-neutral-900/50 border border-neutral-700/60 rounded-lg p-4">
                  {NOTIFICATION_CATEGORIES.map(category => (
                    <div key={category.id} className="flex items-center justify-between gap-4">
                      <ToggleSwitch
                        label={category.label}
                        checked={notificationSettings[category.id] ?? true}
                        onChange={(checked) => handleNotificationToggle(category.id, checked)}
                      />
                      <button
                        onClick={() => handleTestCategory(category.id)}
                        className={chipActionClass}
                      >
                        Test
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-center">
                    <button
                        onClick={() => sendTestNotification()} // Sends a generic test
                        className={subtleActionClass}
                    >
                        Send Generic Test Notification
                    </button>
                </div>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Location Settings</h3>
            <p className="text-sm text-neutral-400 mb-4">Control how your location is determined for features like the Aurora Sighting Map.</p>
            <ToggleSwitch label="Auto-detect Location (GPS)" checked={useGpsAutoDetect} onChange={handleGpsToggle} />
            <p className="text-xs text-neutral-500 mt-2">When enabled, the app will try to use your device's GPS. If disabled, you will be prompted to place your location manually on the map.</p>
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Help & Support</h3>
            <p className="text-sm text-neutral-400 mb-4">
              Have feedback, a feature request, or need support? Restart the welcome tutorial or send an email.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={onShowTutorial}
                className={subtleActionClass}
              >
                <GuideIcon className="w-5 h-5" />
                <span>Show App Tutorial</span>
              </button>
              <a
                href="mailto:help@spottheaurora.co.nz?subject=Spot%20The%20Aurora%20Support"
                className={`${subtleActionClass} no-underline`}
              >
                <MailIcon className="w-5 h-5" />
                <span>Email for Support</span>
              </a>
            </div>
          </section>
        </div>
        
        <div className="flex justify-between items-center p-4 border-t border-neutral-700/80 text-xs text-neutral-500">
          <span>Version: v1.3</span>
          <a 
            href="https://www.tnrprotography.co.nz/spot-the-aurora---change-log" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-sky-400 hover:underline hover:text-sky-300 transition-colors"
          >
            View Changelog
          </a>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
// --- END OF FILE src/components/SettingsModal.tsx ---