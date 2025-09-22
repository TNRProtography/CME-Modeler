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
  id?: string;
}

const BANNER_API_URL = 'https://banner-api.thenamesrock.workers.dev/banner';

interface GlobalBannerProps {
  isFlareAlert: boolean;
  flareClass?: string;
  isAuroraAlert: boolean;
  auroraScore?: number;
  isSubstormAlert: boolean;
  substormActivity?: SubstormActivity;
  hideForTutorial?: boolean;
  onFlareAlertClick: () => void;
  onAuroraAlertClick: () => void;
  onSubstormAlertClick: () => void;
  isIpsAlert: boolean;
  ipsAlertTime?: number;
  onIpsAlertClick: () => void;
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
  isIpsAlert,
  ipsAlertTime,
  onIpsAlertClick,
}) => {
  if (hideForTutorial) return null;

  const [globalBanner, setGlobalBanner] = useState<BannerData | null>(null);
  const [isGlobalBannerDismissed, setIsGlobalBannerDismissed] = useState(false);
  const lastProcessedBannerUniqueIdRef = useRef<string | undefined>(undefined);

  const [isInternalAlertVisible, setIsInternalAlertVisible] = useState(
    isFlareAlert || isAuroraAlert || isSubstormAlert || isIpsAlert
  );

  useEffect(() => {
    const fetchGlobalBanner = async () => {
      try {
        const response = await fetch(BANNER_API_URL, { headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) {
          setGlobalBanner(null);
          setIsGlobalBannerDismissed(false);
          return;
        }
        const data: BannerData = await response.json();
        const currentBannerUniqueId = data.id || data.message;
        lastProcessedBannerUniqueIdRef.current = currentBannerUniqueId;
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
    setIsInternalAlertVisible(isFlareAlert || isAuroraAlert || isSubstormAlert || isIpsAlert);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, isIpsAlert]);


  // 1. Prioritize the global banner if active
  if (globalBanner && globalBanner.isActive && !isGlobalBannerDismissed) {
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
          {globalBanner.link?.url && globalBanner.link?.text && (
            <a href={globalBanner.link.url} target="_blank" rel="noopener noreferrer" className={`underline ml-2 ${isCustom ? '' : (globalBanner.type === 'warning' ? 'text-blue-800' : 'text-blue-200 hover:text-blue-50')}`} style={isCustom ? { color: textColor || '#ffffff' } : {}}>
              {globalBanner.link.text}
            </a>
          )}
        </div>
      </div>
    );
  }

  // 2. Fallback to internal alerts
  if (isInternalAlertVisible) {
    const hasMultipleAlerts = [isIpsAlert, isFlareAlert, isAuroraAlert, isSubstormAlert].filter(Boolean).length > 1;
    return (
      <div className="bg-gradient-to-r from-purple-800 via-indigo-600 to-sky-600 text-white text-sm font-semibold p-3 text-center relative z-50 flex items-center justify-center">
        <div className={`container mx-auto flex items-center justify-center gap-x-4 ${hasMultipleAlerts ? 'flex-col sm:flex-row gap-y-2' : 'flex-row'}`}>
          {isIpsAlert && (
            <button onClick={onIpsAlertClick} className="flex items-center gap-2 hover:bg-white/10 p-1 rounded-md transition-colors">
              <span role="img" aria-label="Shockwave">💥</span>
              <strong>Interplanetary Shock Arrived at {formatTime(ipsAlertTime)}!</strong>
            </button>
          )}

          {isFlareAlert && (
            <button onClick={onFlareAlertClick} className="flex items-center gap-1 hover:bg-white/10 p-1 rounded-md transition-colors">
              {isIpsAlert && <span className="hidden sm:inline">|</span>}
              <span role="img" aria-label="Solar Flare">🔥</span>
              <strong>Solar Flare:</strong> {flareClass} event in progress.
            </button>
          )}
          {isAuroraAlert && (
            <button onClick={onAuroraAlertClick} className="flex items-center gap-1 hover:bg-white/10 p-1 rounded-md transition-colors">
              {(isIpsAlert || isFlareAlert) && <span className="hidden sm:inline">|</span>}
              <span role="img" aria-label="Aurora">✨</span>
              <strong>Aurora Forecast:</strong> {auroraScore?.toFixed(1)}%
            </button>
          )}
          {isSubstormAlert && substormActivity && (
            <button onClick={onSubstormAlertClick} className="flex items-center gap-1 hover:bg-white/10 p-1 rounded-md transition-colors text-left">
              {(isIpsAlert || isFlareAlert || isAuroraAlert) && <span className="hidden sm:inline">|</span>}
              <span role="img" aria-label="Magnetic Field" className="self-start mt-1 sm:self-center">⚡</span>
              <div>
                <strong>Substorm Watch:</strong> ~{substormActivity.probability?.toFixed(0) ?? '...'}% chance between <strong>{formatTime(substormActivity.predictedStartTime)}</strong> - <strong>{formatTime(substormActivity.predictedEndTime)}</strong>.
                <span className="opacity-80 ml-1">Expected: <strong>{getVisibilityLevel(auroraScore)}</strong>.</span>
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