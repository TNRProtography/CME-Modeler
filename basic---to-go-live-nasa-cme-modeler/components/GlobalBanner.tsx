import React, { useState, useEffect, useCallback, useRef } from 'react';
import CloseIcon from './icons/CloseIcon'; // Assuming CloseIcon exists in your icons directory

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
  id?: string; // Optional unique ID for more precise dismissal tracking (if worker sends one)
  expiresAt?: string; // Expiry date/time as ISO string (e.g., "2024-07-25T10:00:00Z")
}

// URL for your banner API worker.
// This should be the public endpoint your worker exposes for fetching the banner.
const BANNER_API_URL = 'https://banner-api.thenamesrock.workers.dev/banner';

// Prefix for unique banner IDs stored in local storage for dismissal
const LOCAL_STORAGE_DISMISS_KEY_PREFIX = 'globalBannerDismissed_';

interface GlobalBannerProps {
  // Props for internal, app-specific alerts (e.g., from real-time data)
  // These will be displayed only if no global banner is active or it's dismissed/expired.
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
  // State for the admin-set global banner data fetched from the Worker
  const [globalBanner, setGlobalBanner] = useState<BannerData | null>(null);
  // State to track if the *currently active* global banner has been dismissed by the user
  const [isGlobalBannerDismissed, setIsGlobalBannerDismissed] = useState(false);

  // States for internal, app-specific alerts (independent of the global banner)
  const [isInternalAlertVisible, setIsInternalAlertVisible] = useState(true);
  const [internalAlertClosedManually, setInternalAlertClosedManually] = useState(false);

  // Effect to fetch the global banner data from the Cloudflare Worker
  useEffect(() => {
    const fetchGlobalBanner = async () => {
      try {
        console.log('GlobalBanner: Attempting to fetch from:', BANNER_API_URL);
        const response = await fetch(BANNER_API_URL, {
            headers: {
                // 'Cache-Control: no-cache' tells the browser to re-validate with the server (your Worker)
                // before using its own cache. Your Worker itself handles CDN caching (`s-maxage`).
                'Cache-Control': 'no-cache' 
            }
        });
        if (!response.ok) {
          console.error(`GlobalBanner: Failed to fetch (HTTP ${response.status} ${response.statusText})`);
          setGlobalBanner(null); // Clear any old banner on fetch failure
          return;
        }
        const data: BannerData = await response.json();
        console.log('GlobalBanner: Fetched data:', data);

        // Determine a unique ID for the fetched banner. This is used for local storage dismissal.
        // If the worker doesn't send an 'id', we fall back to using the message content.
        const currentBannerUniqueId = data.id || data.message; 
        
        // Update the component's state with the newly fetched banner data
        setGlobalBanner(data);

        // --- Core Logic for User Dismissal State Management ---
        if (data.isActive) {
          // If the banner is currently marked as 'active' by the admin (via the Worker):
          // Check if *this specific version/ID* of the banner was previously dismissed by the user.
          const wasPreviouslyDismissedByUser = localStorage.getItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerUniqueId) === 'true';
          setIsGlobalBannerDismissed(wasPreviouslyDismissedByUser);
          console.log(`GlobalBanner: Admin says ACTIVE. Unique ID: "${currentBannerUniqueId}". Was dismissed by user: ${wasPreviouslyDismissedByUser}`);
        } else {
          // If the banner is currently marked as 'inactive' by the admin:
          // We must assume it's "new" or "irrelevant" if it gets reactivated later.
          // Therefore, we reset its dismissal status for the user.
          setIsGlobalBannerDismissed(false);
          console.log(`GlobalBanner: Admin says INACTIVE. Resetting user dismissal state for future activations.`);
          // Optionally, clean up the local storage entry for this inactive banner.
          localStorage.removeItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerUniqueId);
        }
        
      } catch (error) {
        console.error('GlobalBanner: Error during fetch:', error);
        setGlobalBanner(null); // Clear banner data if there's a fetch error
        setIsGlobalBannerDismissed(false); // Ensure it's not considered dismissed on network/fetch errors
      }
    };

    // Call fetch immediately on component mount
    fetchGlobalBanner();
    // Set up an interval to re-fetch the banner periodically (e.g., every minute)
    // This allows banner changes from the admin panel to appear without a full page refresh.
    const interval = setInterval(fetchGlobalBanner, 60 * 1000); 
    
    // Cleanup function: Clear the interval when the component unmounts
    return () => clearInterval(interval);
  }, []); // Empty dependency array means this effect runs only once on mount.

  // Effect for internal alerts visibility (independent of the global banner's state)
  useEffect(() => {
    // An internal alert is visible if any of its conditions are true AND it hasn't been manually dismissed
    setIsInternalAlertVisible((isFlareAlert || isAuroraAlert || isSubstormAlert) && !internalAlertClosedManually);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, internalAlertClosedManually]);

  // Callback for when the user clicks to dismiss the global banner
  const handleGlobalBannerDismiss = useCallback(() => {
    setIsGlobalBannerDismissed(true); // Update local state to hide it immediately
    // Persist the dismissal to local storage using the banner's unique ID
    if (globalBanner) {
      const uniqueId = globalBanner.id || globalBanner.message; 
      localStorage.setItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + uniqueId, 'true');
      console.log('GlobalBanner: Banner dismissed by user and state saved to local storage for ID:', uniqueId);
    }
  }, [globalBanner]); // Re-create this callback if `globalBanner` changes (to get the correct ID)

  // Callback for when the user clicks to dismiss an internal alert
  const handleInternalAlertClose = useCallback(() => {
    setIsInternalAlertVisible(false); // Update local state to hide it immediately
    setInternalAlertClosedManually(true); // Mark it as manually closed (persistent across refreshes)
  }, []);

  // --- Render Logic ---

  // Use a memoized value to determine if the global banner should *truly* be displayed.
  // This combines isActive, dismissal state, and expiry time.
  const isGlobalBannerTrulyActive = useMemo(() => {
    // If no banner data is loaded, or it's explicitly inactive, or it's dismissed by the user
    if (!globalBanner || !globalBanner.isActive || isGlobalBannerDismissed) {
      return false; 
    }
    // If an expiry time is set, check if it's in the future
    if (globalBanner.expiresAt) {
      const expiryDate = new Date(globalBanner.expiresAt);
      const now = new Date();
      if (isNaN(expiryDate.getTime()) || expiryDate <= now) {
        console.log('GlobalBanner: Banner is active by admin, but has expired:', globalBanner.expiresAt);
        return false; // Invalid or past expiry date means don't show
      }
    }
    return true; // Banner is active, not dismissed, and not expired
  }, [globalBanner, isGlobalBannerDismissed]);


  // 1. Prioritize displaying the global banner if it's truly active
  if (isGlobalBannerTrulyActive) {
    console.log('GlobalBanner: Rendering active global banner:', globalBanner?.message); 
    const isCustom = globalBanner!.type === 'custom'; 
    const bgColor = globalBanner!.backgroundColor; 
    const textColor = globalBanner!.textColor;

    let predefinedClass = '';
    
    // Apply Tailwind gradient classes based on predefined type
    if (!isCustom) {
      if (globalBanner!.type === 'info') {
        predefinedClass = 'bg-gradient-to-r from-blue-600 via-sky-500 to-sky-600';
      } else if (globalBanner!.type === 'warning') {
        predefinedClass = 'bg-gradient-to-r from-yellow-500 via-orange-400 to-orange-500';
      } else if (globalBanner!.type === 'alert') {
        predefinedClass = 'bg-gradient-to-r from-red-600 via-pink-500 to-pink-600';
      }
    }

    // Determine final text color for both the main message and the link.
    // If 'custom', use the provided hex codes. If 'warning', use dark text. Otherwise, use white.
    const finalTextColorForContent = isCustom ? (textColor || '#ffffff') : (globalBanner!.type === 'warning' ? '#1a202c' : '#ffffff');
    const finalLinkColorClass = (globalBanner!.type === 'warning' && !isCustom) ? 'text-blue-800' : 'text-blue-200 hover:text-blue-50'; // Tailwind classes for link


    return (
      <div 
        // Apply base styling, predefined gradient classes, and ensure text contrast
        className={`text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center ${predefinedClass}`}
        // Apply custom background and text color directly via style prop if 'custom' type
        style={isCustom ? { backgroundColor: bgColor || '#000000', color: textColor || '#ffffff' } : {}} 
      >
        <div className="container mx-auto flex items-center justify-center gap-2" style={{ color: finalTextColorForContent }}>
          {globalBanner!.emojis && <span role="img" aria-label="Emoji">{globalBanner!.emojis}</span>}
          <span>{globalBanner!.message}</span>
          {globalBanner!.link && globalBanner!.link.url && globalBanner!.link.text && (
            <a href={globalBanner!.link.url} target="_blank" rel="noopener noreferrer" 
               // Apply link color: custom if custom banner, otherwise a specific Tailwind class
               className={`underline ml-2 ${isCustom ? '' : finalLinkColorClass}`}
               style={isCustom ? {color: finalTextColorForContent } : {}} // Ensure link color works with custom banners
               >
              {globalBanner!.link.text}
            </a>
          )}
        </div>
        {globalBanner!.dismissible && (
          <button
            onClick={handleGlobalBannerDismiss}
            className={`absolute top-1 right-2 p-1 rounded-full transition-colors 
                        ${isCustom 
                           ? (finalTextColorForContent === '#ffffff' ? 'text-white hover:bg-white/20' : 'text-gray-900 hover:bg-gray-900/20') 
                           : (globalBanner!.type === 'warning' ? 'text-gray-900 hover:bg-gray-900/20' : 'text-white hover:bg-white/20')}`}
            title="Dismiss Banner"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        )}
      </div>
    );
  }

  // 2. Fallback: If no global banner is truly active (inactive, dismissed, or expired),
  //    then display the internal app-specific alerts if they are active.
  if (isInternalAlertVisible) {
    console.log('GlobalBanner: Displaying internal alert.');
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

  // 3. If neither global nor internal alerts are active, render nothing.
  console.log('GlobalBanner: No banner or internal alert to display.');
  return null; 
};

export default GlobalBanner;