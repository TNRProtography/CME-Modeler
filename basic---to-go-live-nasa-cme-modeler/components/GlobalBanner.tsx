import React, { useState, useEffect, useCallback } from 'react';
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
  // Add a unique ID for the banner if your worker provides one,
  // useful for more precise dismissal tracking
  id?: string; 
}

// URL for your banner API worker (adjust if different)
const BANNER_API_URL = 'https://banner-api.thenamesrock.workers.dev/banner';
const LOCAL_STORAGE_DISMISS_KEY_PREFIX = 'globalBannerDismissed_'; // Prefix for unique banner IDs

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
  const previousBannerIdRef = React.useRef<string | undefined>(undefined); // To track if banner content changed

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
                // 'Cache-Control': 'no-cache' // This sends Cache-Control: no-cache to the worker
                                            // The worker itself handles `s-maxage` for CDN and `max-age` for browser
                                            // Leaving this line out might be fine, or you can explicitly use
                                            // Cache-Control: no-cache on the client side if you always want fresh.
                                            // For debugging, `no-cache` ensures you bypass browser cache.
            }
        });
        if (!response.ok) {
          console.error(`Failed to fetch global banner: HTTP ${response.status} ${response.statusText}`);
          setGlobalBanner(null);
          return;
        }
        const data: BannerData = await response.json();
        console.log('Fetched global banner data:', data);

        // Check if the banner content has truly changed or if it's a new banner (if it has an ID)
        const currentBannerId = data.id || data.message; // Use message as ID if no explicit ID
        const wasPreviouslyDismissed = localStorage.getItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerId) === 'true';

        // Only update dismissal state if the banner content is truly different
        // or if it's a fresh banner that wasn't previously dismissed
        if (previousBannerIdRef.current !== currentBannerId || (data.isActive && !wasPreviouslyDismissed)) {
            setIsGlobalBannerDismissed(wasPreviouslyDismissed);
        }
        
        setGlobalBanner(data);
        previousBannerIdRef.current = currentBannerId; // Update ref for next render cycle
        
      } catch (error) {
        console.error('Error fetching global banner:', error);
        setGlobalBanner(null);
      }
    };

    fetchGlobalBanner();
    // Fetch every minute to pick up changes from the admin panel
    const interval = setInterval(fetchGlobalBanner, 60 * 1000); 
    return () => clearInterval(interval);
  }, []); // Empty dependency array, as banner content change is handled internally

  // Effect for internal alerts visibility
  useEffect(() => {
    setIsInternalAlertVisible((isFlareAlert || isAuroraAlert || isSubstormAlert) && !internalAlertClosedManually);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, internalAlertClosedManually]);

  const handleGlobalBannerDismiss = useCallback(() => {
    setIsGlobalBannerDismissed(true);
    // Persist dismissal to local storage
    if (globalBanner && (globalBanner.id || globalBanner.message)) {
      const currentBannerId = globalBanner.id || globalBanner.message;
      localStorage.setItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerId, 'true');
      console.log('Banner dismissed and saved to local storage:', currentBannerId);
    }
  }, [globalBanner]);

  const handleInternalAlertClose = useCallback(() => {
    setIsInternalAlertVisible(false);
    setInternalAlertClosedManually(true);
  }, []);

  // --- Render Logic ---

  // 1. Prioritize the global banner if active and not dismissed
  if (globalBanner && globalBanner.isActive && !isGlobalBannerDismissed) {
    const isCustom = globalBanner.type === 'custom';
    const bgColor = globalBanner.backgroundColor; 
    const textColor = globalBanner.textColor;

    let predefinedClass = '';
    let defaultTextColorClass = 'text-white'; // Default for predefined types

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

    // Apply the correct text color class based on type
    const finalTextColor = isCustom ? textColor : (defaultTextColorClass === 'text-gray-900' ? '#1a202c' : '#ffffff'); // Use specific hex for custom/tailwind fallback

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