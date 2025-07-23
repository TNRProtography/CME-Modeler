// --- START OF FILE SettingsModal.tsx ---

import React, { useState, useEffect, useCallback } from 'react';
import CloseIcon from './icons/CloseIcon';
import ToggleSwitch from './ToggleSwitch'; // Re-use the existing ToggleSwitch
import {
  getNotificationPreference,
  setNotificationPreference,
  requestNotificationPermission,
  sendNotification, // Import the in-app notification function
  subscribeUserToPush // Import the push subscription function
} from '../utils/notifications'; // Adjust path if necessary

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Define categories for notifications. These should match the tags used in sendNotification.
// UPDATED: M-class flare categories
const NOTIFICATION_CATEGORIES = [
  { id: 'aurora-50percent', label: 'Aurora Forecast ≥ 50%' },
  { id: 'aurora-80percent', label: 'Aurora Forecast ≥ 80%' },
  { id: 'flare-M1', label: 'Solar Flare M-Class (≥ M1.0)' }, // Changed to M1+
  { id: 'flare-M5', label: 'Solar Flare M5-Class (≥ M5.0)' }, // NEW: M5+
  { id: 'flare-X1', label: 'Solar Flare X-Class (≥ X1.0)' },
  { id: 'substorm-eruption', label: 'Substorm Eruption Detected' },
];

// Key for storing location preference in localStorage
const LOCATION_PREF_KEY = 'location_preference_use_gps_autodetect';

// Icon component for install button
const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>('default');
  const [isPushSubscribed, setIsPushSubscribed] = useState(false); // Renamed from isSubscribed for clarity
  const [notificationSettings, setNotificationSettings] = useState<Record<string, boolean>>({});
  // State for location preference
  const [useGpsAutoDetect, setUseGpsAutoDetect] = useState<boolean>(true);
  // NEW: State for PWA install
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAppInstallable, setIsAppInstallable] = useState<boolean>(false);
  const [isAppInstalled, setIsAppInstalled] = useState<boolean>(false);

  // Function to check and update notification & push subscription status
  const updateNotificationAndPushStatus = useCallback(async () => {
    if (!('Notification' in window)) {
      setNotificationStatus('unsupported');
      return;
    }

    const status = Notification.permission;
    setNotificationStatus(status);

    if (status === 'granted' && 'serviceWorker' in navigator && 'PushManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setIsPushSubscribed(!!subscription);
      } catch (error) {
        console.error('Error checking push subscription:', error);
        setIsPushSubscribed(false);
      }
    } else {
      setIsPushSubscribed(false);
    }
  }, []);


  useEffect(() => {
    if (isOpen) {
      updateNotificationAndPushStatus(); // Update status when modal opens

      // Load saved notification preferences
      const loadedNotificationSettings: Record<string, boolean> = {};
      NOTIFICATION_CATEGORIES.forEach(category => {
        loadedNotificationSettings[category.id] = getNotificationPreference(category.id);
      });
      setNotificationSettings(loadedNotificationSettings);

      // Load saved location preference
      const storedGpsPref = localStorage.getItem(LOCATION_PREF_KEY);
      setUseGpsAutoDetect(storedGpsPref === null ? true : JSON.parse(storedGpsPref));

      // Check if app is already installed
      checkAppInstallationStatus();
    }
  }, [isOpen, updateNotificationAndPushStatus, checkAppInstallationStatus]); // Dependencies for useEffect

  // NEW: Setup PWA install event listeners
  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Store the event so it can be triggered later
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

  // NEW: Check if app is already installed
  const checkAppInstallationStatus = useCallback(() => {
    // Check if running in standalone mode (already installed)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    // Check if running as PWA on mobile
    // Note: window.navigator.standalone is Safari-specific
    const isPWA = (window.navigator as any).standalone === true;

    setIsAppInstalled(isStandalone || isPWA);
  }, []);

  const handleNotificationToggle = useCallback((id: string, checked: boolean) => {
    setNotificationSettings(prev => ({ ...prev, [id]: checked }));
    setNotificationPreference(id, checked);
  }, []);

  // Updated handler to request permission and subscribe to push
  const handleRequestAndSubscribe = useCallback(async () => {
    const permission = await requestNotificationPermission();
    setNotificationStatus(permission);

    if (permission === 'granted') {
      const subscription = await subscribeUserToPush(); // Attempt to subscribe to push
      setIsPushSubscribed(!!subscription);
      alert('Notifications enabled and subscribed! (Check console for details)');
      // Send a welcome in-app notification immediately
      sendNotification('Welcome!', 'You will now receive solar dashboard alerts.', { tag: 'welcome' });
    } else {
      alert(`Permission ${permission}. Cannot enable notifications.`);
    }
  }, [setNotificationStatus, setIsPushSubscribed]); // Added setters to dependencies


  // Handler for location toggle
  const handleGpsToggle = useCallback((checked: boolean) => {
    setUseGpsAutoDetect(checked);
    localStorage.setItem(LOCATION_PREF_KEY, JSON.stringify(checked));
  }, []);

  // NEW: Handle app installation
  const handleInstallApp = useCallback(async () => {
    if (!deferredPrompt) return;

    try {
      // Show the install prompt
      deferredPrompt.prompt();

      // Wait for the user to respond to the prompt
      const { outcome } = await deferredPrompt.userChoice;

      if (outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
      }

      // Clear the deferredPrompt since it can only be used once
      setDeferredPrompt(null);
      setIsAppInstallable(false);
    } catch (error) {
      console.error('Error during app installation:', error);
    }
  }, [deferredPrompt]);

  // NEW: Handle sending a test notification (both in-app and push)
  const handleSendTestNotification = useCallback(async () => {
    // 1. Always send an in-app notification if permission is granted
    if (notificationStatus === 'granted') {
      sendNotification('Test Notification', 'This is an in-app test notification.', { tag: 'test-in-app' });
    } else {
      console.warn('Notification permission not granted for in-app test.');
    }

    // 2. Attempt to send a push notification if subscribed
    if (isPushSubscribed) {
      alert('Attempting to send push from worker. Check your device!');
      try {
        // !!! IMPORTANT: Replace with YOUR ACTUAL Cloudflare Worker URL !!!
        // This is your worker's domain, including your unique subdomain.
        const workerUrl = 'https://solar-dashboard-push-worker.<YOUR_SUBDOMAIN>.workers.dev/api/send-notification';

        // !!! SECURITY WARNING !!!
        // For production, you MUST secure this endpoint on your Cloudflare Worker.
        // If your worker expects an API key or JWT, you need to include it here.
        // For development/testing, you might temporarily relax worker authentication,
        // or use a simple shared API key.
        const headers: HeadersInit = { 'Content-Type': 'application/json' };
        // Example if your worker requires an API key in the Authorization header:
        // headers['Authorization'] = 'Bearer YOUR_VERY_SECRET_API_KEY_HERE'; // <--- ADD THIS IF REQUIRED

        const response = await fetch(workerUrl, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({
            title: 'Solar Test Push!',
            body: 'This is a test notification from your Cloudflare Worker. It should appear even if the app is closed!',
            tag: 'test-push',
            url: '/' // What URL to open on click (e.g., '/dashboard', or '/')
          })
        });

        if (response.ok) {
          console.log('Test push trigger successful (via worker).');
        } else {
          const errorText = await response.text();
          console.error('Test push trigger failed (via worker):', response.status, errorText);
          alert(`Failed to trigger push from worker (${response.status}): ${errorText}`);
        }
      } catch (err: any) {
        console.error('Error triggering test push (via worker):', err);
        alert('Error triggering push from worker: ' + err.message);
      }
    } else {
      console.log('Not subscribed to push. Only an in-app notification was sent (if permission granted).');
      if (notificationStatus === 'granted') {
        alert('You are not subscribed to push notifications. Only an in-app notification was sent.');
      }
    }
  }, [notificationStatus, isPushSubscribed]); // Dependencies for useCallback


  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-2xl max-h-[85vh] text-neutral-300 flex flex-col"
        onClick={e => e.stopPropagation()} // Prevent click from closing modal
      >
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h2 className={`text-2xl font-bold text-neutral-200`}>App Settings</h2>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 space-y-6">
          {/* NEW: App Installation Section */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">App Installation</h3>
            {isAppInstalled ? (
              <div className="bg-green-900/30 border border-green-700/50 rounded-md p-3 text-sm">
                <p className="text-green-300 flex items-center">
                  <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  App is installed and ready to use offline!
                </p>
              </div>
            ) : isAppInstallable ? (
              <div className="space-y-3">
                <p className="text-sm text-neutral-400">Install this app on your device for faster access and offline capabilities.</p>
                <button
                  onClick={handleInstallApp}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600/20 border border-blue-500/50 rounded-md text-blue-300 hover:bg-blue-500/30 hover:border-blue-400 transition-colors"
                >
                  <DownloadIcon className="w-4 h-4" />
                  <span>Install App</span>
                </button>
              </div>
            ) : (
              <div className="bg-neutral-800/50 border border-neutral-700/50 rounded-md p-3 text-sm">
                <p className="text-neutral-400">App installation is not currently available. This may be because:</p>
                <ul className="mt-2 ml-4 text-xs text-neutral-500 space-y-1">
                  <li>• The app is already installed</li>
                  <li>• Your browser doesn't support PWA installation</li>
                  <li>• Installation criteria haven't been met yet</li>
                </ul>
              </div>
            )}
          </section>

          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Notifications</h3>
            {notificationStatus === 'unsupported' && (
              <p className="text-red-400 text-sm mb-4">Your browser does not support web notifications.</p>
            )}
            {notificationStatus === 'denied' && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-md p-3 mb-4 text-sm">
                <p className="text-red-300 mb-2">Notification permission denied. Please enable notifications for this site in your browser settings to receive alerts.</p>
                <button
                  onClick={handleRequestAndSubscribe} // Use the combined handler
                  className="px-3 py-1 bg-red-600/50 border border-red-500 rounded-md text-white hover:bg-red-500/50 text-xs"
                >
                  Re-request Permission
                </button>
              </div>
            )}
            {notificationStatus === 'default' && (
              <div className="bg-orange-900/30 border border-orange-700/50 rounded-md p-3 mb-4 text-sm">
                <p className="text-orange-300 mb-2">Notifications are not enabled. Click below to allow them.</p>
                <button
                  onClick={handleRequestAndSubscribe} // Use the combined handler
                  className="px-3 py-1 bg-orange-600/50 border border-orange-500 rounded-md text-white hover:bg-orange-500/50 text-xs"
                >
                  Enable Notifications
                </button>
              </div>
            )}
            {notificationStatus === 'granted' && (
              <p className="text-green-400 text-sm mb-4">Notifications are enabled.</p>
            )}

            {notificationStatus === 'granted' && (
              <div className="space-y-3">
                <h4 className="font-semibold text-neutral-400">Receive alerts for:</h4>
                {NOTIFICATION_CATEGORIES.map(category => (
                  <ToggleSwitch
                    key={category.id}
                    label={category.label}
                    checked={notificationSettings[category.id] ?? true} // Default to true if not set
                    onChange={(checked) => handleNotificationToggle(category.id, checked)}
                  />
                ))}

                {/* NEW: Test Notification Button */}
                <button
                  onClick={handleSendTestNotification}
                  className="mt-4 px-4 py-2 bg-purple-600/20 border border-purple-500/50 rounded-md text-purple-300 hover:bg-purple-500/30 hover:border-purple-400 transition-colors flex items-center space-x-2"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17l-3 3m0 0l-3-3m3 3V3"></path></svg>
                  <span>Send Test Notification</span>
                </button>
                {isPushSubscribed ? (
                  <p className="text-xs text-green-500 mt-1">Push notifications are active. Test button will send a push.</p>
                ) : (
                  <p className="text-xs text-yellow-500 mt-1">You are not subscribed to push. Test button will only send an in-app notification.</p>
                )}
              </div>
            )}
          </section>

          {/* Location Settings Section */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Location Settings</h3>
            <p className="text-sm text-neutral-400 mb-4">Control how your location is determined for features like the Aurora Sighting Map.</p>
            <ToggleSwitch
              label="Auto-detect Location (GPS)"
              checked={useGpsAutoDetect}
              onChange={handleGpsToggle}
            />
            <p className="text-xs text-neutral-500 mt-2">When enabled, the app will try to use your device's GPS. If disabled, you will always be prompted to place your location manually on the map.</p>
          </section>

        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
// --- END OF FILE SettingsModal.tsx ---