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
  dismissible?: boolean; // ignored now (banners are never user-dismissible)
  link?: { url: string; text: string };
  id?: string;
}

// URL for your banner API worker (adjust if different)
const BANNER_API_URL = 'https://banner-api.thenamesrock.workers.dev/banner';
// NOTE: local dismissal is no longer used to ensure banners cannot be closed by users
// const LOCAL_STORAGE_DISMISS_KEY_PREFIX = 'globalBannerDismissed_';

interface GlobalBannerProps {
  isFlareAlert: boolean;
  flareClass?: string;
  isAuroraAlert: boolean;
  auroraScore?: number;
  isSubstormAlert: boolean;
  substormActivity?: SubstormActivity;
  hideForTutorial?: boolean;
  // --- Click handlers for automated alerts ---
  onFlareAlertClick: () => void;
  onAuroraAlertClick: () => void;
  onSubstormAlertClick: () => void;
}

// Helper to format timestamp to HH:mm (NZ local time, no TZ label)
const formatTime = (timestamp?: number): string => {
  if (!timestamp) return '...';
  return new Date(timestamp).toLocaleTimeString('en-NZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Pacific/Auckland',
  });
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
  onFlareAlertClick,
  onAuroraAlertClick,
  onSubstormAlertClick,
}) => {
  if (hideForTutorial) return null;

  // State for the admin-set global banner
  const [globalBanner, setGlobalBanner] = useState<BannerData | null>(null);
  const [isGlobalBannerDismissed, setIsGlobalBannerDismissed] = useState(false); // will always be forced false when active
  const lastProcessedBannerUniqueIdRef = useRef<string | undefined>(undefined);

  // State for other dynamic alerts (flare, aurora, substorm)
  const [isInternalAlertVisible, setIsInternalAlertVisible] = useState(
    isFlareAlert || isAuroraAlert || isSubstormAlert
  );

  // Fetch the global banner data from the worker
  useEffect(() => {
    const fetchGlobalBanner = async () => {
      try {
        console.log('GlobalBanner: Attempting to fetch from:', BANNER_API_URL);
        const response = await fetch(BANNER_API_URL, {
          headers: {
            'Cache-Control': 'no-cache', // fresh data; worker controls its own cache
          },
        });
        if (!response.ok) {
          console.error(`GlobalBanner: Failed to fetch (HTTP ${response.status} ${response.statusText})`);
          setGlobalBanner(null);
          setIsGlobalBannerDismissed(false);
          return;
        }
        const data: BannerData = await response.json();
        console.log('GlobalBanner: Fetched data:', data);

        const currentBannerUniqueId = data.id || data.message;
        lastProcessedBannerUniqueIdRef.current = currentBannerUniqueId;

        setGlobalBanner(data);

        // NEW: If admin says active, it is ALWAYS visible (cannot be dismissed by user)
        if (data.isActive) {
          setIsGlobalBannerDismissed(false);
        } else {
          // When inactive, ensure we treat as not-dismissed so it can reappear if re-activated
          setIsGlobalBannerDismissed(false);
        }
      } catch (error) {
        console.error('GlobalBanner: Error during fetch:', error);
        setGlobalBanner(null);
        setIsGlobalBannerDismissed(false);
      }
    };

    fetchGlobalBanner();
    const interval = setInterval(fetchGlobalBanner, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // Internal alerts are visible strictly based on current alert props (no manual close)
  useEffect(() => {
    setIsInternalAlertVisible(isFlareAlert || isAuroraAlert || isSubstormAlert);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert]);

  // Dismiss handlers are now no-ops (kept for type stability / future use if needed)
  const handleGlobalBannerDismiss = useCallback(() => {
    // Intentionally disabled: banners are not user-dismissible
    console.log('GlobalBanner: Dismiss attempted, ignored (banners are sticky until condition ends).');
  }, []);

  // --- Render Logic ---

  // 1. Prioritize the global banner if active (never dismissible by user)
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
      } else if (globalBanner.type === 'alert') {
        predefinedClass = 'bg-gradient-to-r from-red-600 via-pink-500 to-pink-600';
      }
    }

    const finalTextColorStyle = isCustom ? { color: textColor || '#ffffff' } : {};
    const finalTextColorClass = globalBanner.type === 'warning' && !isCustom ? 'text-gray-900' : 'text-white';

    return (
      <div
        className={`text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center ${predefinedClass} ${finalTextColorClass}`}
        style={isCustom ? { backgroundColor: bgColor || '#000000', color: textColor || '#ffffff' } : {}}
      >
        <div className="container mx-auto flex items-center justify-center gap-2">
          {globalBanner.emojis && <span role="img" aria-label="Emoji">{globalBanner.emojis}</span>}
          <span>{globalBanner.message}</span>
          {globalBanner.link && globalBanner.link.url && globalBanner.link.text && (
            <a
              href={globalBanner.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline ml-2 ${isCustom ? '' : (globalBanner.type === 'warning' ? 'text-blue-800' : 'text-blue-200 hover:text-blue-50')}`}
              style={isCustom ? { color: textColor || '#ffffff' } : {}}
            >
              {globalBanner.link.text}
            </a>
          )}
        </div>

        {/* CLOSE BUTTON REMOVED: banners cannot be dismissed by users */}
      </div>
    );
  }

  // 2. Fallback to original internal alerts if no global banner
  if (isInternalAlertVisible) {
    console.log('GlobalBanner: Displaying internal alert.');
    return (
      <div className="bg-gradient-to-r from-purple-800 via-indigo-600 to-sky-600 text-white text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-center gap-x-4 gap-y-2">
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

        {/* CLOSE BUTTON REMOVED: internal alerts cannot be dismissed by users */}
      </div>
    );
  }

  console.log('GlobalBanner: No banner or internal alert to display.');
  return null;
};

export default GlobalBanner;
// --- END OF FILE src/components/GlobalBanner.tsx ---
