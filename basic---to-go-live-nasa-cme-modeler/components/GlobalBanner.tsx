// --- START OF FILE src/components/GlobalBanner.tsx ---

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

// URL for your banner API worker
const BANNER_API_URL = 'https://banner-api.thenamesrock.workers.dev/banner';

interface GlobalBannerProps {
  isFlareAlert: boolean;
  flareClass?: string;
  isAuroraAlert: boolean;
  auroraScore?: number;
  isSubstormAlert: boolean;
  substormActivity?: SubstormActivity;
  hideForTutorial?: boolean;
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
}) => {
  const navigate = useNavigate();

  // --- MODIFIED: Navigation Handlers using useNavigate ---
  const handleFlareAlertClick = useCallback(() => {
    navigate('/solar-activity', { state: { targetId: 'goes-xray-flux-section' } });
  }, [navigate]);

  const handleAuroraAlertClick = useCallback(() => {
    navigate('/', { state: { targetId: 'unified-forecast-section' } });
  }, [navigate]);

  const handleSubstormAlertClick = useCallback(() => {
    navigate('/', { state: { targetId: 'unified-forecast-section' } });
  }, [navigate]);

  if (hideForTutorial) return null;

  // State for the admin-set global banner
  const [globalBanner, setGlobalBanner] = useState<BannerData | null>(null);
  const [isGlobalBannerDismissed, setIsGlobalBannerDismissed] = useState(false);

  // State for other dynamic alerts
  const [isInternalAlertVisible, setIsInternalAlertVisible] = useState(
    isFlareAlert || isAuroraAlert || isSubstormAlert
  );

  useEffect(() => {
    const fetchGlobalBanner = async () => {
      try {
        const response = await fetch(BANNER_API_URL, { headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) { setGlobalBanner(null); setIsGlobalBannerDismissed(false); return; }
        const data: BannerData = await response.json();
        setGlobalBanner(data);
        if (data.isActive) {
          setIsGlobalBannerDismissed(false);
        } else {
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

  useEffect(() => {
    setIsInternalAlertVisible(isFlareAlert || isAuroraAlert || isSubstormAlert);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert]);

  // 1. Prioritize the global banner if active
  if (globalBanner && globalBanner.isActive && !isGlobalBannerDismissed) {
    // ... (Global banner rendering logic remains the same)
    const isCustom = globalBanner.type === 'custom';
    const bgColor = globalBanner.backgroundColor;
    const textColor = globalBanner.textColor;

    let predefinedClass = '';
    if (!isCustom) {
      if (globalBanner.type === 'info') predefinedClass = 'bg-gradient-to-r from-blue-600 via-sky-500 to-sky-600';
      else if (globalBanner.type === 'warning') predefinedClass = 'bg-gradient-to-r from-yellow-500 via-orange-400 to-orange-500';
      else if (globalBanner.type === 'alert') predefinedClass = 'bg-gradient-to-r from-red-600 via-pink-500 to-pink-600';
    }
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
              href={globalBanner.link.url} target="_blank" rel="noopener noreferrer"
              className={`underline ml-2 ${isCustom ? '' : (globalBanner.type === 'warning' ? 'text-blue-800' : 'text-blue-200 hover:text-blue-50')}`}
              style={isCustom ? { color: textColor || '#ffffff' } : {}}
            >
              {globalBanner.link.text}
            </a>
          )}
        </div>
      </div>
    );
  }

  // 2. Fallback to original internal alerts
  if (isInternalAlertVisible) {
    return (
      <div className="bg-gradient-to-r from-purple-800 via-indigo-600 to-sky-600 text-white text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-center gap-x-4 gap-y-2">
          {isFlareAlert && (
            <button onClick={handleFlareAlertClick} className="flex items-center gap-1 hover:bg-white/10 p-1 rounded-md transition-colors">
              <span role="img" aria-label="Solar Flare">💥</span>
              <strong>Solar Flare Alert:</strong> An active {flareClass} flare is in progress.
            </button>
          )}
          {isAuroraAlert && (
            <button onClick={handleAuroraAlertClick} className="flex items-center gap-1 hover:bg-white/10 p-1 rounded-md transition-colors">
              {isFlareAlert && <span className="hidden sm:inline">|</span>}
              <span role="img" aria-label="Aurora">✨</span>
              <strong>Aurora Forecast:</strong> Spot The Aurora Forecast is at {auroraScore?.toFixed(1)}%!
            </button>
          )}
          {isSubstormAlert && substormActivity && (
            <button onClick={handleSubstormAlertClick} className="flex items-center gap-1 hover:bg-white/10 p-1 rounded-md transition-colors text-left">
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
      </div>
    );
  }

  return null;
};

export default GlobalBanner;
// --- END OF FILE src/components/GlobalBanner.tsx ---