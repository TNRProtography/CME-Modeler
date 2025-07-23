import React, { useState, useEffect, useCallback, useRef } from 'react';
import CloseIcon from './icons/CloseIcon';

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
  substormText?: string;
}

const GlobalBanner: React.FC<GlobalBannerProps> = ({
  isFlareAlert,
  flareClass,
  isAuroraAlert,
  auroraScore,
  isSubstormAlert,
  substormText,
}) => {
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
        console.log('Fetching global banner from:', BANNER_API_URL);
        const response = await fetch(BANNER_API_URL, {
            headers: {
                'Cache-Control': 'no-cache' // Ensure we bypass browser cache for fresh data
            }
        });
        if (!response.ok) {
          console.error(`Failed to fetch global banner: HTTP ${response.status} ${response.statusText}`);
          setGlobalBanner(null);
          return;
        }
        const data: BannerData = await response.json();
        console.log('Fetched global banner data:', data);

        // Determine a unique ID for the fetched banner. Prefer 'id' if provided.
        const currentBannerUniqueId = data.id || data.message; 
        
        // Update the global banner state with the new data
        setGlobalBanner(data);

        // --- NEW LOGIC FOR DISMISSAL ---
        if (data.isActive) {
          // If the banner is active according to the admin:
          // Check if *this specific banner ID* was previously dismissed by the user.
          const wasPreviouslyDismissedByUser = localStorage.getItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerUniqueId) === 'true';
          setIsGlobalBannerDismissed(wasPreviouslyDismissedByUser);
          console.log(`Banner active by admin. Unique ID: "${currentBannerUniqueId}". Was dismissed by user: ${wasPreviouslyDismissedByUser}`);
        } else {
          // If the banner is NOT active according to the admin:
          // It should never be considered "dismissed" by the user at this point.
          // This clears any lingering dismissal status for this banner,
          // ensuring it will show again if the admin re-activates it later.
          setIsGlobalBannerDismissed(false);
          console.log(`Banner inactive by admin. Clearing user dismissal state for this banner.`);
          // Optionally, also remove from local storage to keep it clean, though not strictly necessary.
          localStorage.removeItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerUniqueId);
        }
        // Update the ref to track the unique ID of the banner just processed
        lastProcessedBannerUniqueIdRef.current = currentBannerUniqueId;

      } catch (error) {
        console.error('Error fetching global banner:', error);
        setGlobalBanner(null);
        // On error, we might want to also ensure it's not dismissed if it was active
        setIsGlobalBannerDismissed(false); // Assume not dismissed on error loading
      }
    };

    fetchGlobalBanner();
    const interval = setInterval(fetchGlobalBanner, 60 * 1000); // Fetch every minute
    return () => clearInterval(interval);
  }, []); // Empty dependency array, as the effect itself manages re-evaluation based on data.id/message

  // Effect for internal alerts visibility
  useEffect(() => {
    setIsInternalAlertVisible((isFlareAlert || isAuroraAlert || isSubstormAlert) && !internalAlertClosedManually);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, internalAlertClosedManually]);

  const handleGlobalBannerDismiss = useCallback(() => {
    setIsGlobalBannerDismissed(true);
    // Persist dismissal to local storage using the banner's unique ID
    if (globalBanner) {
      const uniqueId = globalBanner.id || globalBanner.message;
      localStorage.setItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + uniqueId, 'true');
      console.log('Banner dismissed and saved to local storage:', uniqueId);
    }
  }, [globalBanner]);

  const handleInternalAlertClose = useCallback(() => {
    setIsInternalAlertVisible(false);
    setInternalAlertClosedManually(true);
  }, []);

  // --- Render Logic ---

  // 1. Prioritize the global banner if active and not dismissed
  if (globalBanner && globalBanner.isActive && !isGlobalBannerDismissed) {
    console.log('Rendering global banner:', globalBanner.message);
    const isCustom = globalBanner.type === 'custom';
    const bgColor = globalBanner.backgroundColor; 
    const textColor = globalBanner.textColor;

    let predefinedClass = '';
    let defaultTextColorClass = 'text-white'; 

    if (!isCustom) {
      if (globalBanner.type === 'info') {
        predefinedClass = 'bg-gradient-to-r from-blue-600 via-sky-500 to-sky-600';
      } else if (globalBanner.type === 'warning') {
        predefinedClass = 'bg-gradient-to-r from-yellow-500 via-orange-400 to-orange-500';
        defaultTextColorClass = 'text-gray-900'; 
      } else if (globalBanner.type === 'alert') {
        predefinedClass = 'bg-gradient-to-r from-red-600 via-pink-500 to-pink-600';
      }
    }

    // Apply the correct text color. Use specific hex for custom; default class or derived hex for predefined.
    const finalTextColor = isCustom ? (textColor || '#ffffff') : (defaultTextColorClass === 'text-gray-900' ? '#1a202c' : '#ffffff');

    return (
      <div 
        className={`text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center ${predefinedClass}`}
        style={isCustom ? { backgroundColor: bgColor || '#000000', color: textColor || '#ffffff' } : {}} 
      >
        <div className={`container mx-auto flex items-center justify-center gap-2`} style={isCustom ? {} : { color: finalTextColor }}>
          {globalBanner.emojis && <span role="img" aria-label="Emoji">{globalBanner.emojis}</span>}
          <span>{globalBanner.message}</span>
          {globalBanner.link && globalBanner.link.url && globalBanner.link.text && (
            <a href={globalBanner.link.url} target="_blank" rel="noopener noreferrer" 
               className={`underline ml-2 ${isCustom ? '' : (globalBanner.type === 'warning' ? 'text-blue-800' : 'text-blue-200 hover:text-blue-50')}`}>
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
    console.log('Displaying internal alert.');
    return (
      <div className="bg-gradient-to-r from-purple-800 via-indigo-600 to-sky-600 text-white text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-center gap-2">
          {isFlareAlert && (
            <span className="flex items-center gap-1">
              <span role="img" aria-label="Solar Flare">💥</span>
              <strong>Solar Flare Alert:</strong> An active {flareClass} flare is in progress. Higher-class flares (M, X) can cause radio blackouts and enhanced aurora!
            </span>
          )}
          {isAuroraAlert && (
            <span className="flex items-center gap-1">
              {isFlareAlert && <span className="hidden sm:inline">|</span>}
              <span role="img" aria-label="Aurora">✨</span>
              <strong>Aurora Forecast:</strong> Spot The Aurora Forecast is at {auroraScore?.toFixed(1)}%! Keep an eye on the southern sky!
            </span>
          )}
          {isSubstormAlert && (
            <span className="flex items-center gap-1">
              {(isFlareAlert || isAuroraAlert) && <span className="hidden sm:inline">|</span>}
              <span role="img" aria-label="Magnetic Field">⚡</span>
              <strong>Substorm Watch:</strong> Magnetic field is stretching! {substormText}
            </span>
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

  console.log('No banner or internal alert to display.');
  return null; // Nothing to show
};

export default GlobalBanner;