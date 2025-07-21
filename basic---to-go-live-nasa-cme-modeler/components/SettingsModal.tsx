// --- START OF FILE SettingsModal.tsx ---

import React, { useState, useEffect, useCallback } from 'react';
import CloseIcon from './icons/CloseIcon';
import ToggleSwitch from './ToggleSwitch'; // Re-use the existing ToggleSwitch
import { 
  getNotificationPreference, 
  setNotificationPreference,
  requestNotificationPermission 
} from '../utils/notifications.ts'; // Import notification utilities

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

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>('default');
  const [notificationSettings, setNotificationSettings] = useState<Record<string, boolean>>({});
  // NEW: State for location preference
  const [useGpsAutoDetect, setUseGpsAutoDetect] = useState<boolean>(true);

  useEffect(() => {
    if (isOpen) {
      // Check current notification permission status
      if (!('Notification' in window)) {
        setNotificationStatus('unsupported');
      } else {
        setNotificationStatus(Notification.permission);
      }

      // Load saved notification preferences
      const loadedNotificationSettings: Record<string, boolean> = {};
      NOTIFICATION_CATEGORIES.forEach(category => {
        loadedNotificationSettings[category.id] = getNotificationPreference(category.id);
      });
      setNotificationSettings(loadedNotificationSettings);

      // Load saved location preference
      const storedGpsPref = localStorage.getItem(LOCATION_PREF_KEY);
      setUseGpsAutoDetect(storedGpsPref === null ? true : JSON.parse(storedGpsPref));
    }
  }, [isOpen]);

  const handleNotificationToggle = useCallback((id: string, checked: boolean) => {
    setNotificationSettings(prev => ({ ...prev, [id]: checked }));
    setNotificationPreference(id, checked);
  }, []);

  const handleRequestPermission = useCallback(async () => {
    const permission = await requestNotificationPermission();
    setNotificationStatus(permission);
  }, []);

  // NEW: Handler for location toggle
  const handleGpsToggle = useCallback((checked: boolean) => {
    setUseGpsAutoDetect(checked);
    localStorage.setItem(LOCATION_PREF_KEY, JSON.stringify(checked));
  }, []);

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
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">Notifications</h3>
            {notificationStatus === 'unsupported' && (
              <p className="text-red-400 text-sm mb-4">Your browser does not support web notifications.</p>
            )}
            {notificationStatus === 'denied' && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-md p-3 mb-4 text-sm">
                <p className="text-red-300 mb-2">Notification permission denied. Please enable notifications for this site in your browser settings to receive alerts.</p>
                <button 
                  onClick={handleRequestPermission} 
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
                  onClick={handleRequestPermission} 
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
              </div>
            )}
          </section>

          {/* NEW: Location Settings Section */}
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