// --- START OF FILE src/components/SettingsModal.tsx ---

import React, { useState, useEffect, useCallback } from 'react';
import CloseIcon from './icons/CloseIcon';
import ToggleSwitch from './ToggleSwitch';
import { 
  getNotificationPreference, 
  setNotificationPreference,
  requestNotificationPermission,
  // We don't need sendTestNotification for now, but no harm in keeping the import
  sendTestNotification 
} from '../utils/notifications.ts';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appVersion: string;
  // NEW PROP: This function will be provided by the parent to trigger the tutorial
  onShowTutorial: () => void; 
}

const NOTIFICATION_CATEGORIES = [
  { id: 'aurora-50percent', label: 'Aurora Forecast ≥ 50%' },
  { id: 'aurora-80percent', label: 'Aurora Forecast ≥ 80%' },
  { id: 'flare-M1', label: 'Solar Flare M-Class (≥ M1.0)' },
  { id: 'flare-M5', label: 'Solar Flare M5-Class (≥ M5.0)' },
  { id: 'flare-X1', label: 'Solar Flare X-Class (≥ X1.0)' },
  { id: 'substorm-eruption', label: 'Substorm Eruption Detected' },
];

const LOCATION_PREF_KEY = 'location_preference_use_gps_autodetect';

// NEW: A simple icon for the tutorial button
const GuideIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
  </svg>
);

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

// Destructure the new onShowTutorial prop
const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, appVersion, onShowTutorial }) => {
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>('default');
  const [notificationSettings, setNotificationSettings] = useState<Record<string, boolean>>({});
  const [useGpsAutoDetect, setUseGpsAutoDetect] = useState<boolean>(true);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAppInstallable, setIsAppInstallable] = useState<boolean>(false);
  const [isAppInstalled, setIsAppInstalled] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      if (!('Notification' in window)) {
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
  
  const handleRequestPermission = useCallback(async () => {
    const permission = await requestNotificationPermission();
    setNotificationStatus(permission);
  }, []);

  const handleNotificationToggle = useCallback((id: string, checked: boolean) => {
    setNotificationSettings(prev => ({ ...prev, [id]: checked }));
    setNotificationPreference(id, checked);
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
          {/* App Installation Section */}
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
                <button onClick={handleInstallApp} className="flex items-center space-x-2 px-4 py-2 bg-blue-600/20 border border-blue-500/50 rounded-md text-blue-300 hover:bg-blue-500/30 hover:border-blue-400 transition-colors">
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

          {/* Notification Section */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Notifications</h3>
            {notificationStatus === 'unsupported' && <p className="text-red-400 text-sm mb-4">Your browser does not support web notifications.</p>}
            {notificationStatus === 'denied' && <div className="bg-red-900/30 border border-red-700/50 rounded-md p-3 mb-4 text-sm"><p className="text-red-300">Notification permission denied. Please enable them in your browser settings to receive future alerts.</p></div>}
            {notificationStatus === 'default' && (
              <div className="bg-orange-900/30 border border-orange-700/50 rounded-md p-3 mb-4 text-sm">
                <p className="text-orange-300 mb-2">Enable notifications to be alerted of major space weather events.</p>
                <button onClick={handleRequestPermission} className="px-3 py-1 bg-orange-600/50 border border-orange-500 rounded-md text-white hover:bg-orange-500/50 text-xs">Enable Notifications</button>
              </div>
            )}
            
            {notificationStatus === 'granted' && (
              <div className="space-y-4">
                <p className="text-green-400 text-sm">Notifications are enabled.</p>
                <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-md p-4 text-center">
                    <h4 className="font-semibold text-neutral-300">Custom Alerts Coming Soon!</h4>
                    <p className="text-sm text-neutral-400 mt-2">
                        The ability to customize which alerts you receive is under development.
                        For now, your device is ready to receive critical notifications once the feature is fully launched.
                    </p>
                </div>
              </div>
            )}
          </section>

          {/* Location Settings Section */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Location Settings</h3>
            <p className="text-sm text-neutral-400 mb-4">Control how your location is determined for features like the Aurora Sighting Map.</p>
            <ToggleSwitch label="Auto-detect Location (GPS)" checked={useGpsAutoDetect} onChange={handleGpsToggle} />
            <p className="text-xs text-neutral-500 mt-2">When enabled, the app will try to use your device's GPS. If disabled, you will be prompted to place your location manually on the map.</p>
          </section>

          {/* NEW: Help & Support Section */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Help & Support</h3>
            <p className="text-sm text-neutral-400 mb-4">Need a refresher on how to use the app? You can restart the welcome tutorial here.</p>
            <button 
              onClick={onShowTutorial} 
              className="flex items-center space-x-2 px-4 py-2 bg-neutral-700/80 border border-neutral-600/80 rounded-md text-neutral-200 hover:bg-neutral-600/90 transition-colors"
            >
              <GuideIcon className="w-5 h-5" />
              <span>Show App Tutorial</span>
            </button>
          </section>
        </div>
        
        <div className="p-4 border-t border-neutral-700/80 text-right text-xs text-neutral-500">
          Version: {appVersion}
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
// --- END OF FILE src/components/SettingsModal.tsx ---