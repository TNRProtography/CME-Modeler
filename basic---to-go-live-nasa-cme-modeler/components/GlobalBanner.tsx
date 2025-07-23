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
}

// URL for your banner API worker (adjust if different)
const BANNER_API_URL = 'https://banner-api.thenamesrock.workers.dev/banner';

interface GlobalBannerProps {
  // REMOVED: isSiteDownAlert?: boolean; // This prop is no longer needed
  isFlareAlert: boolean;
  flareClass?: string;
  isAuroraAlert: boolean;
  auroraScore?: number;
  isSubstormAlert: boolean;
  substormText?: string;
}

const GlobalBanner: React.FC<GlobalBannerProps> = ({
  // REMOVED: isSiteDownAlert, // No longer destructure this prop
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

  // State for other dynamic alerts (flare, aurora, substorm)
  const [isInternalAlertVisible, setIsInternalAlertVisible] = useState(true);
  const [internalAlertClosedManually, setInternalAlertClosedManually] = useState(false);

  // Fetch the global banner data from the worker
  useEffect(() => {
    const fetchGlobalBanner = async () => {
      try {
        const response = await fetch(BANNER_API_URL, {
            headers: {
                'Cache-Control': 'no-cache', // Ensure we get the latest from worker (worker handles its own caching)
            }
        });
        if (!response.ok) {
          console.error(`Failed to fetch global banner: HTTP ${response.status} ${response.statusText}`);
          setGlobalBanner(null);
          return;
        }
        const data: BannerData = await response.json();
        setGlobalBanner(data);
        // Reset dismissal state if banner content/activity changes (simple check based on message)
        // A more robust solution might use a unique ID for each banner version from the worker.
        if (data.message !== globalBanner?.message || data.isActive !== globalBanner?.isActive) {
            setIsGlobalBannerDismissed(false);
        }
      } catch (error) {
        console.error('Error fetching global banner:', error);
        setGlobalBanner(null);
      }
    };

    fetchGlobalBanner();
    const interval = setInterval(fetchGlobalBanner, 60 * 1000); // Fetch every minute for global banner changes
    return () => clearInterval(interval);
  }, [globalBanner?.message, globalBanner?.isActive]); // Added dependencies to re-run effect only when relevant globalBanner props change

  // Effect for internal alerts visibility
  useEffect(() => {
    setIsInternalAlertVisible((isFlareAlert || isAuroraAlert || isSubstormAlert) && !internalAlertClosedManually);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, internalAlertClosedManually]);

  const handleGlobalBannerDismiss = useCallback(() => {
    setIsGlobalBannerDismissed(true);
    // Optionally, store a flag in local storage to prevent it from reappearing on next page load
    // localStorage.setItem('dismissedBannerId', globalBanner.id); // Requires 'id' in BannerData
  }, []);

  const handleInternalAlertClose = useCallback(() => {
    setIsInternalAlertVisible(false);
    setInternalAlertClosedManually(true);
  }, []);

  // --- Render Logic ---

  // 1. Prioritize the global banner if active and not dismissed
  if (globalBanner && globalBanner.isActive && !isGlobalBannerDismissed) {
    const isCustom = globalBanner.type === 'custom';
    const bgColor = globalBanner.backgroundColor; // Can be undefined if not custom
    const textColor = globalBanner.textColor; // Can be undefined if not custom

    let predefinedClass = '';
    let defaultTextColorClass = 'text-white';
    if (!isCustom) {
      // Adjusted gradient classes to match Tailwind's utility class structure more broadly
      // and explicitly set text color for contrast.
      if (globalBanner.type === 'info') {
        predefinedClass = 'bg-gradient-to-r from-blue-600 via-sky-500 to-sky-600';
      } else if (globalBanner.type === 'warning') {
        predefinedClass = 'bg-gradient-to-r from-yellow-500 via-orange-400 to-orange-500';
        defaultTextColorClass = 'text-gray-900'; // Dark text for warning
      } else if (globalBanner.type === 'alert') {
        predefinedClass = 'bg-gradient-to-r from-red-600 via-pink-500 to-pink-600';
      }
    }

    return (
      <div 
        className={`text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center ${predefinedClass}`}
        style={isCustom ? { backgroundColor: bgColor, color: textColor } : {}}
      >
        <div className={`container mx-auto flex items-center justify-center gap-2 ${defaultTextColorClass}`}>
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

  return null; // Nothing to show
};

export default GlobalBanner;