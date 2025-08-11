// --- START OF FILE src/components/GlobalBanner.tsx ---

import React, { useState, useEffect, useCallback, useRef } from 'react';
import CloseIcon from './icons/CloseIcon';
import { SubstormActivity } from '../types';

// Define the shape of the banner object returned by your worker
interface BannerData {
  isActive: boolean;
  message: string;
  type?: 'info' | 'warning' | 'alert' | 'custom';
  backgroundColor?: string;
  textColor?: string;
  emojis?: string;
  dismissible?: boolean;
  link?: { url: string; text: string };
  id?: string; // Added an optional ID for more precise dismissal tracking
}

// URL for your banner API worker (adjust if different)
const BANNER_API_URL = 'https://banner-api.thenamesrock.workers.dev/banner';
const LOCAL_STORAGE_DISMISS_KEY_PREFIX = 'globalBannerDismissed_'; // Prefix for unique banner IDs in local storage

interface GlobalBannerProps {
  isFlareAlert: boolean;
  flareClass?: string;
  isAuroraAlert: boolean;
  auroraScore?: number;
  isSubstormAlert: boolean;
  substormActivity?: SubstormActivity;
  hideForTutorial?: boolean; 
  // --- NEW: Click handlers for automated alerts ---
  onFlareAlertClick: () => void;
  onAuroraAlertClick: () => void;
  onSubstormAlertClick: () => void;
}

// Helper to format timestamp to HH:mm
const formatTime = (timestamp?: number): string => {
  if (!timestamp) return '...';
  return new Date(timestamp).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false });
};

// Helper to get visibility level from aurora score
const getVisibilityLevel = (score?: number): string => {
  if (score === undefined || score === null) return 'Insignificant';
  if (score >= 80) return 'Clear Eye Visible';
  if (score >= 50) return 'Faint Eye Visible';
  if (score >= 40) return 'Phone Camera Visible';
  if (score >= 25) return 'Camera Visible';
  return 'Insignificant';
};


const GlobalBanner: React.FC<GlobalBannerProps> = ({
  isFlareAlert,
  flareClass,
  isAuroraAlert,
  auroraScore,
  isSubstormAlert,
  substormActivity,
  hideForTutorial = false,
  // --- NEW: Destructure new props ---
  onFlareAlertClick,
  onAuroraAlertClick,
  onSubstormAlertClick,
}) => {
  // If hideForTutorial is true, render nothing
  if (hideForTutorial) {
    return null;
  }

  // State for the admin-set global banner
  const [globalBanner, setGlobalBanner] = useState<BannerData | null>(null);
  const [isGlobalBannerDismissed, setIsGlobalBannerDismissed] = useState(false);
  // Ref to keep track of the *last processed* banner's unique ID for comparison
  const lastProcessedBannerUniqueIdRef = useRef<string | undefined>(undefined);

  // State for other dynamic alerts (flare, aurora, substorm)
  const [isInternalAlertVisible, setIsInternalAlertVisible] = useState(true);
  const [internalAlertClosedManually, setInternalAlertClosedManually] = useState(false);

  // Fetch the global banner data from the worker
  useEffect(() => {
    const fetchGlobalBanner = async () => {
      try {
        console.log('GlobalBanner: Attempting to fetch from:', BANNER_API_URL);
        const response = await fetch(BANNER_API_URL, {
            headers: {
                // Ensure we bypass browser cache for fresh data from the worker (worker handles its own caching with s-maxage)
                'Cache-Control': 'no-cache' 
            }
        });
        if (!response.ok) {
          console.error(`GlobalBanner: Failed to fetch (HTTP ${response.status} ${response.statusText})`);
          setGlobalBanner(null);
          return;
        }
        const data: BannerData = await response.json();
        console.log('GlobalBanner: Fetched data:', data);

        // Determine a unique ID for the fetched banner. Prefer 'id' if provided, otherwise use message.
        const currentBannerUniqueId = data.id || data.message; 
        
        // Update the global banner state with the new data
        setGlobalBanner(data);

        // --- CORE LOGIC FOR DISMISSAL ---
        if (data.isActive) {
          // If the banner is active from the Worker:
          // Check local storage for dismissal *only for this specific banner ID*.
          const wasPreviouslyDismissedByUser = localStorage.getItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerUniqueId) === 'true';
          setIsGlobalBannerDismissed(wasPreviouslyDismissedByUser);
          console.log(`GlobalBanner: Admin says ACTIVE. Unique ID: "${currentBannerUniqueId}". Was dismissed by user: ${wasPreviouslyDismissedByUser}`);
        } else {
          // If the banner is NOT active from the Worker (admin turned it off):
          // It should never be considered "dismissed" by the user at this point for its current state.
          // This ensures that if the admin later *re-activates* the banner, it will show up again for users.
          setIsGlobalBannerDismissed(false);
          console.log(`GlobalBanner: Admin says INACTIVE. Resetting user dismissal state for this banner.`);
          // Optionally, also remove from local storage to keep it clean, though not strictly necessary for functionality.
          localStorage.removeItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerUniqueId);
        }
        
      } catch (error) {
        console.error('GlobalBanner: Error during fetch:', error);
        setGlobalBanner(null); // Clear banner on error
        setIsGlobalBannerDismissed(false); // Ensure it's not considered dismissed on error
      }
    };

    fetchGlobalBanner();
    // Fetch every minute to pick up changes from the admin panel
    const interval = setInterval(fetchGlobalBanner, 60 * 1000); 
    return () => clearInterval(interval);
  }, []); // Empty dependency array means this effect runs once on mount. It re-fetches via setInterval.

  // Effect for internal alerts visibility (independent of global banner)
  useEffect(() => {
    setIsInternalAlertVisible((isFlareAlert || isAuroraAlert || isSubstormAlert) && !internalAlertClosedManually);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, internalAlertClosedManually]);

  const handleGlobalBannerDismiss = useCallback(() => {
    setIsGlobalBannerDismissed(true);
    // Persist dismissal to local storage using the banner's unique ID
    if (globalBanner) {
      const uniqueId = globalBanner.id || globalBanner.message; // Use current banner's unique ID
      localStorage.setItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + uniqueId, 'true');
      console.log('GlobalBanner: Banner dismissed by user and state saved to local storage for ID:', uniqueId);
    }
  }, [globalBanner]); // Dependency on globalBanner to get its ID/message

  const handleInternalAlertClose = useCallback(() => {
    setIsInternalAlertVisible(false);
    setInternalAlertClosedManually(true);
  }, []);

  // --- Render Logic ---

  // 1. Prioritize the global banner if active and not dismissed
  if (globalBanner && globalBanner.isActive && !isGlobalBannerDismissed) {
    console.log('GlobalBanner: Rendering active global banner.');
    const isCustom = globalBanner.type === 'custom';
    const bgColor = globalBanner.backgroundColor; 
    const textColor = globalBanner.textColor;

    let predefinedClass = '';
    
    if (!isCustom) {
      if (globalBanner.type === 'info') {
        predefinedClass = 'bg-gradient-to-r from-blue-600 via-sky-500 to-sky-600';
      } else if (globalBanner.type === 'warning') {
        predefinedClass = 'bg-gradient-to-r from-yellow-500 via-orange-400 to-orange-500';
        // Note: For warning, text is handled by the inline style if not custom
      } else if (globalBanner.type === 'alert') {
        predefinedClass = 'bg-gradient-to-r from-red-600 via-pink-500 to-pink-600';
      }
    }

    // Determine final text color: custom hex, or a predefined Tailwind class if not custom
    const finalTextColorStyle = isCustom ? { color: textColor || '#ffffff' } : {};
    const finalTextColorClass = (globalBanner.type === 'warning' && !isCustom) ? 'text-gray-900' : 'text-white';


    return (
      <div 
        className={`text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center ${predefinedClass} ${finalTextColorClass}`}
        style={isCustom ? { backgroundColor: bgColor || '#000000', color: textColor || '#ffffff' } : {}} 
      >
        <div className={`container mx-auto flex items-center justify-center gap-2`}>
          {globalBanner.emojis && <span role="img" aria-label="Emoji">{globalBanner.emojis}</span>}
          <span>{globalBanner.message}</span>
          {globalBanner.link && globalBanner.link.url && globalBanner.link.text && (
            <a href={globalBanner.link.url} target="_blank" rel="noopener noreferrer" 
               className={`underline ml-2 ${isCustom ? '' : (globalBanner.type === 'warning' ? 'text-blue-800' : 'text-blue-200 hover:text-blue-50')}`}
               style={isCustom ? {color: (textColor || '#ffffff') } : {}} // Ensure link color works with custom banners
               >
              {globalBanner.link.text}
            </a>
          )}
        </div>
        {globalBanner.dismissible && (
          <button
            onClick={handleGlobalBannerDismiss}
            className={`absolute top-1 right-2 p-1 rounded-full transition-colors ${isCustom ? (textColor === '#ffffff' ? 'text-white hover:bg-white/20' : 'text-gray-900 hover:bg-gray-900/20') : (globalBanner.type === 'warning' ? 'text-gray-900 hover:bg-gray-900/20' : 'text-white hover:bg-white/20')}`}
            title="Dismiss Banner"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  // 2. Fallback to original internal alerts if no global banner or it's dismissed
  if (isInternalAlertVisible) {
    console.log('GlobalBanner: Displaying internal alert.');
    return (
      <div className="bg-gradient-to-r from-purple-800 via-indigo-600 to-sky-600 text-white text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-center gap-x-4 gap-y-2">
          {/* --- MODIFIED: Each alert is now a clickable button --- */}
          {isFlareAlert && (
            <button onClick={onFlareAlertClick} className="flex items-center gap-1 hover:bg-white/10 p-1 rounded-md transition-colors">
              <span role="img" aria-label="Solar Flare">💥</span>
              <strong>Solar Flare Alert:</strong> An active {flareClass} flare is in progress.
            </button>
          )}
          {isAuroraAlert && (
            <button onClick={onAuroraAlertClick} className="flex items-center gap-1 hover:bg-white/10 p-1 rounded-md transition-colors">
              {isFlareAlert && <span className="hidden sm:inline">|</span>}
              <span role="img" aria-label="Aurora">✨</span>
              <strong>Aurora Forecast:</strong> Spot The Aurora Forecast is at {auroraScore?.toFixed(1)}%!
            </button>
          )}
          {isSubstormAlert && substormActivity && (
             <button onClick={onSubstormAlertClick} className="flex items-center gap-1 hover:bg-white/10 p-1 rounded-md transition-colors text-left">
              {(isFlareAlert || isAuroraAlert) && <span className="hidden sm:inline">|</span>}
              <span role="img" aria-label="Magnetic Field" className="self-start mt-1 sm:self-center">⚡</span>
              <div>
                <strong>Substorm Watch:</strong> There is a&nbsp;
                <strong>~{substormActivity.probability?.toFixed(0) ?? '...'}% chance</strong> of activity between&nbsp;
                <strong>{formatTime(substormActivity.predictedStartTime)}</strong> and&nbsp;
                <strong>{formatTime(substormActivity.predictedEndTime)}</strong>.
                <br className="sm:hidden" />
                <span className="opacity-80 ml-1 sm:ml-0">
                  Expected visibility: <strong>{getVisibilityLevel(auroraScore)}</strong>.
                </span>
              </div>
            </button>
          )}
        </div>
        <button
          onClick={handleInternalAlertClose}
          className="absolute top-1 right-2 p-1 text-white hover:bg-white/20 rounded-full transition-colors"
          title="Dismiss Alert"
        >
          <CloseIcon className="w-4 h-4" />
        </button>
      </div>
    );
  }

  console.log('GlobalBanner: No banner or internal alert to display.');
  return null; // Nothing to show
};

export default GlobalBanner;
// --- END OF FILE src/components/GlobalBanner.tsx ---