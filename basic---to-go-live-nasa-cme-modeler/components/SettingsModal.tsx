// --- START OF FILE src/components/SettingsModal.tsx (FULL CODE) ---

import React, { useState, useEffect, useCallback } from 'react';
import CloseIcon from './icons/CloseIcon';
import ToggleSwitch from './ToggleSwitch';
import { 
  getNotificationPreference, 
  setNotificationPreference, // Keep this import for consistency, even if not used for custom toggles yet
  requestNotificationPermission,
} from '../utils/notifications.ts';

// NEW: Named imports for all custom icons
import { ThemeIcon } from './icons/ThemeIcon';
import { LocationIcon } from './icons/LocationIcon';
import { DashboardIcon } from './icons/DashboardIcon'; 
import { HelpIcon } from './icons/HelpIcon'; 
import { MailIcon } from './icons/MailIcon';
import { DownloadIcon } from './icons/DownloadIcon';

// Import SavedLocation type
import { SavedLocation } from '../types'; 

// Import constants and utility functions from settingsUtils
import {
  LOCATION_PREF_KEY, SAVED_LOCATIONS_KEY, ACTIVE_LOCATION_KEY, THEME_KEY,
  FD_TIPS_VISIBLE_KEY, FD_CAMERA_SETTINGS_VISIBLE_KEY, FD_AURORA_SIGHTINGS_VISIBLE_KEY,
  FD_FORECAST_TREND_VISIBLE_KEY, FD_GAUGES_VISIBLE_KEY, FD_GOES_MAG_VISIBLE_KEY,
  FD_IPS_VISIBLE_KEY, FD_CLOUD_MAP_VISIBLE_KEY, FD_QUEENSTOWN_CAM_VISIBLE_KEY, FD_EPAM_VISIBLE_KEY,
  SAD_SOLAR_IMAGERY_VISIBLE_KEY, SAD_XRAY_FLUX_VISIBLE_KEY, SAD_SOLAR_FLARES_VISIBLE_KEY,
  SAD_CCOR1_VIDEO_VISIBLE_KEY, SAD_PROTON_FLUX_VISIBLE_KEY,
  loadDashboardVisibilitySettings as loadDashboardVisibilitySettingsUtil // Renamed to avoid conflict
} from '../utils/settingsUtils'; 


interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  appVersion: string; 
  onShowTutorial: () => void;
  currentTheme: string; // Passed from App.tsx
  onThemeChange: (theme: string) => void; // Passed from App.tsx
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, appVersion, onShowTutorial, currentTheme, onThemeChange }) => {
  const [notificationStatus, setNotificationStatus] = useState<NotificationPermission | 'unsupported'>('default');
  const [notificationSettings, setNotificationSettings] = useState<Record<string, boolean>>({}); // Retained for future custom notification settings
  const [useGpsAutoDetect, setUseGpsAutoDetect] = useState<boolean>(true);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isAppInstallable, setIsAppInstallable] = useState<boolean>(false);
  const [isAppInstalled, setIsAppInstalled] = useState<boolean>(false);

  // Theme state for local selection within the modal
  const [selectedTheme, setSelectedTheme] = useState(currentTheme);

  // Dashboard Visibility States, initialized to empty and loaded in useEffect
  const [fdSectionVisibility, setFdSectionVisibility] = useState<Record<string, boolean>>({});
  const [sadSectionVisibility, setSadSectionVisibility] = useState<Record<string, boolean>>({});

  // Location Management States
  const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [newLocationName, setNewLocationName] = useState('');
  const [newLocationLat, setNewLocationLat] = useState<number | ''>('');
  const [newLocationLng, setNewLocationLng] = useState<number | ''>('');
  const [isAddingCustomLocation, setIsAddingCustomLocation] = useState(false);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);


  // --- Initial Load Effect: Runs when modal opens ---
  useEffect(() => {
    if (isOpen) {
      // 1. Notifications permission status
      if (!('Notification' in window)) {
        setNotificationStatus('unsupported');
      } else {
        setNotificationStatus(Notification.permission);
      }
      // Load general notification preferences (even if not exposed via toggles yet)
      const loadedNotificationSettings: Record<string, boolean> = {};
      // This `NOTIFICATION_CATEGORIES` list is not imported/defined in this version,
      // so this loop will not populate anything unless you re-introduce it.
      // For now, it will safely result in an empty object.
      // NOTIFICATION_CATEGORIES.forEach(category => {
      //   loadedNotificationSettings[category.id] = getNotificationPreference(category.id);
      // });
      setNotificationSettings(loadedNotificationSettings);

      // 2. GPS Preference (for location auto-detection)
      const storedGpsPref = localStorage.getItem(LOCATION_PREF_KEY);
      setUseGpsAutoDetect(storedGpsPref === null ? true : JSON.parse(storedGpsPref));
      
      // 3. App Install Status
      checkAppInstallationStatus();

      // 4. Current Theme
      setSelectedTheme(currentTheme);

      // 5. Dashboard Section Visibility
      const { fd, sad } = loadDashboardVisibilitySettingsUtil();
      setFdSectionVisibility(fd);
      setSadSectionVisibility(sad);

      // 6. Location Management
      loadLocationSettings();
    }
  }, [isOpen, currentTheme]);

  // --- PWA Install Prompt Effect: Runs once on component mount ---
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

  // --- Utility Functions ---
  const checkAppInstallationStatus = useCallback(() => {
    // Checks if the app is already running as a standalone PWA
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
    const isPWA = (window.navigator as any).standalone === true; // For iOS
    setIsAppInstalled(isStandalone || isPWA);
  }, []);
  
  // --- Notification Handlers ---
  const handleRequestPermission = useCallback(async () => {
    const permission = await requestNotificationPermission();
    setNotificationStatus(permission);
  }, []);

  // --- Theme Handlers ---
  const handleThemeChange = useCallback((themeName: string) => {
      setSelectedTheme(themeName);
      localStorage.setItem(THEME_KEY, themeName);
      onThemeChange(themeName); // Notify parent (App.tsx) to apply the CSS class
  }, [onThemeChange]);

  // --- Dashboard Visibility Handlers ---
  const handleDashboardSectionToggle = useCallback((key: string, checked: boolean, dashboard: 'forecast' | 'solar') => {
    if (dashboard === 'forecast') {
      setFdSectionVisibility(prev => ({ ...prev, [key]: checked }));
    } else {
      setSadSectionVisibility(prev => ({ ...prev, [key]: checked }));
    }
    localStorage.setItem(key, JSON.stringify(checked));
  }, []);

  // --- Location Management Handlers ---
  const loadLocationSettings = () => {
    const storedLocations = JSON.parse(localStorage.getItem(SAVED_LOCATIONS_KEY) || '[]') as SavedLocation[];
    setSavedLocations(storedLocations);
    setActiveLocationId(localStorage.getItem(ACTIVE_LOCATION_KEY));
  };

  const handleSetActiveLocation = useCallback((id: string) => {
    setActiveLocationId(id);
    localStorage.setItem(ACTIVE_LOCATION_KEY, id);
  }, []);

  const handleAddCurrentLocation = useCallback(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newId = `gps-${Date.now()}`;
          const newLoc: SavedLocation = {
            id: newId,
            name: `My Location (${position.coords.latitude.toFixed(2)}, ${position.coords.longitude.toFixed(2)})`,
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          const updatedLocations = [...savedLocations, newLoc];
          setSavedLocations(updatedLocations);
          localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(updatedLocations));
          handleSetActiveLocation(newId);
          // When adding a new location and making it active, disable GPS auto-detect
          setUseGpsAutoDetect(false);
          localStorage.setItem(LOCATION_PREF_KEY, JSON.stringify(false));
        },
        (error) => {
          alert(`Could not get current location: ${error.message}. Please try adding manually.`);
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 }
      );
    } else {
      alert("Geolocation is not supported by your browser.");
    }
  }, [savedLocations, handleSetActiveLocation]);

  const handleAddCustomLocation = useCallback(() => {
    if (newLocationName.trim() && typeof newLocationLat === 'number' && typeof newLocationLng === 'number' && !isNaN(newLocationLat) && !isNaN(newLocationLng)) {
      const newId = `custom-${Date.now()}`;
      const newLoc: SavedLocation = {
        id: newId,
        name: newLocationName.trim(),
        lat: newLocationLat,
        lng: newLocationLng,
      };
      const updatedLocations = [...savedLocations, newLoc];
      setSavedLocations(updatedLocations);
      localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(updatedLocations));
      handleSetActiveLocation(newId);
      setNewLocationName('');
      setNewLocationLat('');
      setNewLocationLng('');
      setIsAddingCustomLocation(false);
      // When adding a new location and making it active, disable GPS auto-detect
      setUseGpsAutoDetect(false);
      localStorage.setItem(LOCATION_PREF_KEY, JSON.stringify(false));
    } else {
      alert("Please provide a name, valid latitude, and valid longitude for the custom location.");
    }
  }, [newLocationName, newLocationLat, newLocationLng, savedLocations, handleSetActiveLocation]);

  const handleEditLocation = useCallback((id: string) => {
    const locationToEdit = savedLocations.find(loc => loc.id === id);
    if (locationToEdit) {
      setEditingLocationId(id);
      setNewLocationName(locationToEdit.name);
      setNewLocationLat(locationToEdit.lat);
      setNewLocationLng(locationToEdit.lng);
      setIsAddingCustomLocation(true); // Re-use the custom add form for editing
    }
  }, [savedLocations]);

  const handleSaveEditedLocation = useCallback(() => {
    if (editingLocationId && newLocationName.trim() && typeof newLocationLat === 'number' && typeof newLocationLng === 'number' && !isNaN(newLocationLat) && !isNaN(newLocationLng)) {
      const updatedLocations = savedLocations.map(loc => 
        loc.id === editingLocationId 
          ? { ...loc, name: newLocationName.trim(), lat: newLocationLat, lng: newLocationLng } 
          : loc
      );
      setSavedLocations(updatedLocations);
      localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(updatedLocations));
      setEditingLocationId(null);
      setNewLocationName('');
      setNewLocationLat('');
      setNewLocationLng('');
      setIsAddingCustomLocation(false);
    } else {
      alert("Please fill all fields with valid data to save the edited location.");
    }
  }, [editingLocationId, newLocationName, newLocationLat, newLocationLng, savedLocations]);

  const handleDeleteLocation = useCallback((id: string) => {
    if (window.confirm("Are you sure you want to delete this location?")) {
      const updatedLocations = savedLocations.filter(loc => loc.id !== id);
      setSavedLocations(updatedLocations);
      localStorage.setItem(SAVED_LOCATIONS_KEY, JSON.stringify(updatedLocations));
      if (activeLocationId === id) {
        setActiveLocationId(null);
        localStorage.removeItem(ACTIVE_LOCATION_KEY);
        // If the active location is deleted, and GPS auto-detect is off, consider turning it back on
        if (!useGpsAutoDetect) {
             setUseGpsAutoDetect(true);
             localStorage.setItem(LOCATION_PREF_KEY, JSON.stringify(true));
        }
      }
    }
  }, [savedLocations, activeLocationId, useGpsAutoDetect]);

  const handleCancelEditOrAdd = useCallback(() => {
    setIsAddingCustomLocation(false);
    setEditingLocationId(null);
    setNewLocationName('');
    setNewLocationLat('');
    setNewLocationLng('');
  }, []);

  const handleGpsToggle = useCallback((checked: boolean) => {
    setUseGpsAutoDetect(checked);
    localStorage.setItem(LOCATION_PREF_KEY, JSON.stringify(checked));
    if (checked) { // If turning GPS auto-detect ON, clear any active custom location
      setActiveLocationId(null);
      localStorage.removeItem(ACTIVE_LOCATION_KEY);
    }
  }, []);

  const handleClearAllSettings = useCallback(() => {
    if (window.confirm("Are you sure you want to reset ALL app preferences to their default state? This includes themes, location settings, and dashboard section visibility.")) {
      localStorage.clear(); // Clears all localStorage for the origin
      window.location.reload(); // Force a full reload to apply defaults from initial load logic
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[3000] flex justify-center items-center p-4" 
      onClick={onClose}
    >
      <div 
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] text-neutral-300 flex flex-col"
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
            <h3 className="text-xl font-semibold text-neutral-300 mb-3 flex items-center gap-2">
              <DownloadIcon className="w-6 h-6" /> App Installation
            </h3>
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

          {/* Theme Customization Section (NEW) */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3 flex items-center gap-2">
              <ThemeIcon className="w-6 h-6" /> Theme & Appearance
            </h3>
            <div className="space-y-3">
              <p className="text-sm text-neutral-400">Choose your preferred visual theme for the application.</p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => handleThemeChange('default')}
                  className={`px-4 py-2 rounded-md border transition-colors text-sm font-semibold 
                              ${selectedTheme === 'default' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'}`}
                >
                  Default (Dark)
                </button>
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`px-4 py-2 rounded-md border transition-colors text-sm font-semibold 
                              ${selectedTheme === 'light' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'}`}
                >
                  Light Mode
                </button>
                <button
                  onClick={() => handleThemeChange('high-contrast')}
                  className={`px-4 py-2 rounded-md border transition-colors text-sm font-semibold 
                              ${selectedTheme === 'high-contrast' ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700'}`}
                >
                  High Contrast
                </button>
              </div>
            </div>
          </section>

          {/* Dashboard Layout Customization Section (NEW) */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3 flex items-center gap-2">
              <DashboardIcon className="w-6 h-6" /> Dashboard Layout
            </h3>
            <p className="text-sm text-neutral-400 mb-4">Choose which sections are visible on the Aurora Forecast and Solar Activity dashboards.</p>
            
            {/* Aurora Forecast Dashboard Sections */}
            <div className="bg-neutral-900/50 p-4 rounded-lg border border-neutral-700/60 mb-6">
              <h4 className="text-lg font-semibold text-neutral-200 mb-3 border-b border-neutral-600 pb-2">Aurora Forecast Page</h4>
              <div className="space-y-3">
                {/* Use ?? true to default to visible if setting is not found */}
                <ToggleSwitch id={FD_TIPS_VISIBLE_KEY} label="Tips for Spotting" checked={fdSectionVisibility[FD_TIPS_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_TIPS_VISIBLE_KEY, c, 'forecast')} />
                <ToggleSwitch id={FD_CAMERA_SETTINGS_VISIBLE_KEY} label="Suggested Camera Settings" checked={fdSectionVisibility[FD_CAMERA_SETTINGS_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_CAMERA_SETTINGS_VISIBLE_KEY, c, 'forecast')} />
                <ToggleSwitch id={FD_AURORA_SIGHTINGS_VISIBLE_KEY} label="Community Sighting Map" checked={fdSectionVisibility[FD_AURORA_SIGHTINGS_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_AURORA_SIGHTINGS_VISIBLE_KEY, c, 'forecast')} />
                <ToggleSwitch id={FD_FORECAST_TREND_VISIBLE_KEY} label="Forecast Trend Chart" checked={fdSectionVisibility[FD_FORECAST_TREND_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_FORECAST_TREND_VISIBLE_KEY, c, 'forecast')} />
                <ToggleSwitch id={FD_GAUGES_VISIBLE_KEY} label="Solar Wind Gauges" checked={fdSectionVisibility[FD_GAUGES_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_GAUGES_VISIBLE_KEY, c, 'forecast')} />
                <ToggleSwitch id={FD_GOES_MAG_VISIBLE_KEY} label="GOES Magnetometer (Substorm Watch)" checked={fdSectionVisibility[FD_GOES_MAG_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_GOES_MAG_VISIBLE_KEY, c, 'forecast')} />
                <ToggleSwitch id={FD_IPS_VISIBLE_KEY} label="Interplanetary Shock Events" checked={fdSectionVisibility[FD_IPS_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_IPS_VISIBLE_KEY, c, 'forecast')} />
                <ToggleSwitch id={FD_CLOUD_MAP_VISIBLE_KEY} label="Live Cloud Cover Map" checked={fdSectionVisibility[FD_CLOUD_MAP_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_CLOUD_MAP_VISIBLE_KEY, c, 'forecast')} />
                <ToggleSwitch id={FD_QUEENSTOWN_CAM_VISIBLE_KEY} label="Live Cameras" checked={fdSectionVisibility[FD_QUEENSTOWN_CAM_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_QUEENSTOWN_CAM_VISIBLE_KEY, c, 'forecast')} />
                <ToggleSwitch id={FD_EPAM_VISIBLE_KEY} label="ACE EPAM Chart" checked={fdSectionVisibility[FD_EPAM_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(FD_EPAM_VISIBLE_KEY, c, 'forecast')} />
              </div>
            </div>

            {/* Solar Activity Dashboard Sections */}
            <div className="bg-neutral-900/50 p-4 rounded-lg border border-neutral-700/60">
              <h4 className="text-lg font-semibold text-neutral-200 mb-3 border-b border-neutral-600 pb-2">Solar Activity Page</h4>
              <div className="space-y-3">
                <ToggleSwitch id={SAD_SOLAR_IMAGERY_VISIBLE_KEY} label="Solar Imagery" checked={sadSectionVisibility[SAD_SOLAR_IMAGERY_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(SAD_SOLAR_IMAGERY_VISIBLE_KEY, c, 'solar')} />
                <ToggleSwitch id={SAD_XRAY_FLUX_VISIBLE_KEY} label="GOES X-ray Flux Chart" checked={sadSectionVisibility[SAD_XRAY_FLUX_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(SAD_XRAY_FLUX_VISIBLE_KEY, c, 'solar')} />
                <ToggleSwitch id={SAD_SOLAR_FLARES_VISIBLE_KEY} label="Latest Solar Flares List" checked={sadSectionVisibility[SAD_SOLAR_FLARES_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(SAD_SOLAR_FLARES_VISIBLE_KEY, c, 'solar')} />
                <ToggleSwitch id={SAD_CCOR1_VIDEO_VISIBLE_KEY} label="CCOR1 Coronagraph Video" checked={sadSectionVisibility[SAD_CCOR1_VIDEO_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(SAD_CCOR1_VIDEO_VISIBLE_KEY, c, 'solar')} />
                <ToggleSwitch id={SAD_PROTON_FLUX_VISIBLE_KEY} label="GOES Proton Flux Chart" checked={sadSectionVisibility[SAD_PROTON_FLUX_VISIBLE_KEY] ?? true} onChange={(c) => handleDashboardSectionToggle(SAD_PROTON_FLUX_VISIBLE_KEY, c, 'solar')} />
              </div>
            </div>
          </section>

          {/* Location Settings Section (NEW) */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3 flex items-center gap-2">
              <LocationIcon className="w-6 h-6" /> Location Settings
            </h3>
            <p className="text-sm text-neutral-400 mb-4">Manage locations for a more personalized aurora forecast. If no specific location is active, GPS auto-detection will be used.</p>
            
            <ToggleSwitch id={LOCATION_PREF_KEY} label="Auto-detect Location (GPS)" checked={useGpsAutoDetect} onChange={handleGpsToggle} />
            <p className="text-xs text-neutral-500 mt-2 mb-4">When enabled, the app will try to use your device's GPS for the forecast. Selecting a custom location below will override GPS auto-detection.</p>

            <h4 className="text-lg font-semibold text-neutral-200 mb-3 border-b border-neutral-600 pb-2">Saved Locations</h4>
            <div className="space-y-2 mb-4">
              {savedLocations.length === 0 ? (
                <p className="text-sm text-neutral-400 italic">No locations saved yet.</p>
              ) : (
                <ul className="space-y-2">
                  {savedLocations.map(loc => (
                    <li key={loc.id} className="flex justify-between items-center bg-neutral-800/50 p-3 rounded-md border border-neutral-700/50">
                      <div>
                        {/* Radio button for active location */}
                        <input
                          type="radio"
                          id={`loc-${loc.id}`}
                          name="activeLocation"
                          // A location is "checked" if it's the active one AND GPS auto-detect is OFF
                          checked={activeLocationId === loc.id && !useGpsAutoDetect}
                          onChange={() => {
                              handleSetActiveLocation(loc.id);
                              setUseGpsAutoDetect(false); // If custom is chosen, turn off GPS auto-detect
                              localStorage.setItem(LOCATION_PREF_KEY, JSON.stringify(false));
                          }}
                          className="mr-2 accent-sky-500"
                        />
                        <label htmlFor={`loc-${loc.id}`} className="text-neutral-200 text-sm font-medium">{loc.name}</label>
                        <p className="text-xs text-neutral-400">{loc.lat.toFixed(2)}, {loc.lng.toFixed(2)}</p>
                      </div>
                      <div className="flex space-x-2">
                        <button onClick={() => handleEditLocation(loc.id)} className="p-1 rounded-full text-blue-400 hover:bg-blue-900/50" title="Edit Location">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                        </button>
                        <button onClick={() => handleDeleteLocation(loc.id)} className="p-1 rounded-full text-red-400 hover:bg-red-900/50" title="Delete Location">
                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2 mb-4">
              <button onClick={handleAddCurrentLocation} className="flex-grow px-4 py-2 bg-blue-600/20 border border-blue-500/50 rounded-md text-blue-300 hover:bg-blue-500/30 hover:border-blue-400 transition-colors text-sm">
                Add Current GPS Location
              </button>
              <button onClick={() => setIsAddingCustomLocation(true)} className="flex-grow px-4 py-2 bg-blue-600/20 border border-blue-500/50 rounded-md text-blue-300 hover:bg-blue-500/30 hover:border-blue-400 transition-colors text-sm">
                Add Custom Location
              </button>
            </div>

            {isAddingCustomLocation && (
              <div className="bg-neutral-900/50 p-4 rounded-lg border border-neutral-700/60 space-y-3">
                <h4 className="text-lg font-semibold text-neutral-200">{editingLocationId ? 'Edit Location' : 'New Custom Location'}</h4>
                <input
                  type="text"
                  placeholder="Location Name (e.g., Hokitika Beach)"
                  value={newLocationName}
                  onChange={(e) => setNewLocationName(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
                />
                <div className="flex gap-3">
                  <input
                    type="number"
                    step="0.0001"
                    placeholder="Latitude"
                    value={newLocationLat}
                    onChange={(e) => setNewLocationLat(parseFloat(e.target.value))}
                    className="w-1/2 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
                  />
                  <input
                    type="number"
                    step="0.0001"
                    placeholder="Longitude"
                    value={newLocationLng}
                    onChange={(e) => setNewLocationLng(parseFloat(e.target.value))}
                    className="w-1/2 bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={handleCancelEditOrAdd} className="px-3 py-1.5 bg-neutral-700 rounded-md text-neutral-200 hover:bg-neutral-600 transition-colors text-sm">Cancel</button>
                  <button onClick={editingLocationId ? handleSaveEditedLocation : handleAddCustomLocation} className="px-3 py-1.5 bg-sky-600 text-white rounded-md hover:bg-sky-500 transition-colors text-sm">
                    {editingLocationId ? 'Save Changes' : 'Add Location'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Notification Section */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3 flex items-center gap-2">
              <MailIcon className="w-6 h-6" /> Notifications
            </h3>
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
                        For now, you are set to receive critical notifications.
                    </p>
                </div>
              </div>
            )}
          </section>

          {/* Help & Support Section */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3 flex items-center gap-2">
              <HelpIcon className="w-6 h-6" /> Help & Support
            </h3>
            <p className="text-sm text-neutral-400 mb-4">
              Have feedback, a feature request, or need support? Restart the welcome tutorial or send an email.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <button 
                onClick={onShowTutorial} 
                className="flex items-center space-x-2 px-4 py-2 bg-neutral-700/80 border border-neutral-600/80 rounded-md text-neutral-200 hover:bg-neutral-600/90 transition-colors"
              >
                <HelpIcon className="w-5 h-5" />
                <span>Show App Tutorial</span>
              </button>
              <a 
                href="mailto:help@spottheaurora.co.nz?subject=Spot%20The%20Aurora%20Support"
                className="flex items-center space-x-2 px-4 py-2 bg-neutral-700/80 border border-neutral-600/80 rounded-md text-neutral-200 hover:bg-neutral-600/90 transition-colors"
              >
                <MailIcon className="w-5 h-5" />
                <span>Email for Support</span>
              </a>
            </div>
          </section>

          {/* Reset All Settings (NEW) */}
          <section>
            <h3 className="text-xl font-semibold text-neutral-300 mb-3">
              Reset All Settings
            </h3>
            <p className="text-sm text-neutral-400 mb-4">
              If you wish to reset all app preferences, themes, and saved locations to their default state.
            </p>
            <button
              onClick={handleClearAllSettings}
              className="px-4 py-2 bg-red-800/50 border border-red-700/50 rounded-md text-red-300 hover:bg-red-700/50 hover:border-red-600 transition-colors text-sm font-semibold"
            >
              Reset All Settings
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

// --- END OF FILE src/components/SettingsModal.tsx (FULL CODE) ---