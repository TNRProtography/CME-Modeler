// --- START OF FILE src/components/GlobalBanner.tsx ---

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import CloseIcon from './icons/CloseIcon';
import { SubstormPrediction } from '../types'; // Import the new type

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
const LOCAL_STORAGE_DISMISS_KEY_PREFIX = 'globalBannerDismissed_';

interface GlobalBannerProps {
  isFlareAlert: boolean;
  flareClass?: string;
  isAuroraAlert: boolean;
  auroraScore?: number;
  isSubstormAlert: boolean;
  substormText?: string;
  hideForTutorial?: boolean; 
  onFlareAlertClick: () => void;
  onAuroraAlertClick: () => void;
  onSubstormAlertClick: () => void;
  // --- NEW: Prop to receive prediction data ---
  substormPrediction: SubstormPrediction | null;
}

// --- NEW: Helper function to determine visibility level ---
const getVisibilityLevel = (score: number | undefined): string => {
    if (score === undefined || score === null) return 'unknown';
    if (score >= 80) return 'clear eye visible';
    if (score >= 50) return 'faint eye visible';
    if (score >= 40) return 'Phone camera visible';
    if (score >= 25) return 'camera visibility';
    return 'insignificant';
};


const GlobalBanner: React.FC<GlobalBannerProps> = ({
  isFlareAlert,
  flareClass,
  isAuroraAlert,
  auroraScore,
  isSubstormAlert,
  substormText,
  hideForTutorial = false,
  onFlareAlertClick,
  onAuroraAlertClick,
  onSubstormAlertClick,
  substormPrediction, // Destructure the new prop
}) => {
  if (hideForTutorial) {
    return null;
  }

  const [globalBanner, setGlobalBanner] = useState<BannerData | null>(null);
  const [isGlobalBannerDismissed, setIsGlobalBannerDismissed] = useState(false);
  const [isInternalAlertVisible, setIsInternalAlertVisible] = useState(true);
  const [internalAlertClosedManually, setInternalAlertClosedManually] = useState(false);

  useEffect(() => {
    const fetchGlobalBanner = async () => {
      try {
        const response = await fetch(BANNER_API_URL, { headers: { 'Cache-Control': 'no-cache' } });
        if (!response.ok) {
          console.error(`GlobalBanner: Failed to fetch (HTTP ${response.status} ${response.statusText})`);
          setGlobalBanner(null);
          return;
        }
        const data: BannerData = await response.json();
        const currentBannerUniqueId = data.id || data.message; 
        setGlobalBanner(data);

        if (data.isActive) {
          const wasPreviouslyDismissedByUser = localStorage.getItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerUniqueId) === 'true';
          setIsGlobalBannerDismissed(wasPreviouslyDismissedByUser);
        } else {
          setIsGlobalBannerDismissed(false);
          localStorage.removeItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + currentBannerUniqueId);
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
    setIsInternalAlertVisible((isFlareAlert || isAuroraAlert || isSubstormAlert) && !internalAlertClosedManually);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, internalAlertClosedManually]);

  const handleGlobalBannerDismiss = useCallback(() => {
    setIsGlobalBannerDismissed(true);
    if (globalBanner) {
      const uniqueId = globalBanner.id || globalBanner.message;
      localStorage.setItem(LOCAL_STORAGE_DISMISS_KEY_PREFIX + uniqueId, 'true');
    }
  }, [globalBanner]);

  const handleInternalAlertClose = useCallback(() => {
    setIsInternalAlertVisible(false);
    setInternalAlertClosedManually(true);
  }, []);

  const activeAlerts = useMemo(() => {
    const alerts = [];
    if (isFlareAlert) {
      alerts.push({
        key: 'flare',
        onClick: onFlareAlertClick,
        content: (
          <>
            <span role="img" aria-label="Solar Flare">💥</span>
            <strong>{flareClass} Flare Alert</strong>
          </>
        ),
      });
    }
    if (isAuroraAlert) {
      alerts.push({
        key: 'aurora',
        onClick: onAuroraAlertClick,
        content: (
          <>
            <span role="img" aria-label="Aurora">✨</span>
            <strong>Aurora Forecast: {auroraScore?.toFixed(0)}%</strong>
          </>
        ),
      });
    }
    if (isSubstormAlert) {
      // --- MODIFIED: Substorm alert now shows detailed prediction ---
      const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
      const visibility = getVisibilityLevel(auroraScore);

      let substormContent;
      if (substormPrediction) {
        substormContent = (
          <>
            <span role="img" aria-label="Magnetic Field">⚡</span>
            <strong>Substorm Watch:</strong>
            <span className="hidden sm:inline-block mx-1">~{substormPrediction.chance.toFixed(0)}% chance of</span>
             activity between {formatTime(substormPrediction.startTime)} - {formatTime(substormPrediction.endTime)}.
            <span className="hidden md:inline-block mx-1">Expected visibility: {visibility}.</span>
          </>
        );
      } else {
        substormContent = (
          <>
            <span role="img" aria-label="Magnetic Field">⚡</span>
            <strong>Substorm Watch:</strong>
            <span className="hidden sm:inline-block ml-1">Field is stretching.</span>
          </>
        );
      }
      
      alerts.push({
        key: 'substorm',
        onClick: onSubstormAlertClick,
        content: substormContent,
      });
    }
    return alerts;
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, flareClass, auroraScore, substormPrediction, onFlareAlertClick, onAuroraAlertClick, onSubstormAlertClick]);


  // --- Render Logic ---

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
               style={isCustom ? {color: (textColor || '#ffffff') } : {}}
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

  if (isInternalAlertVisible && activeAlerts.length > 0) {
    return (
      <div className="bg-gradient-to-r from-purple-800 via-indigo-600 to-sky-600 text-white p-3 text-center relative z-50 flex items-center justify-center">
        <div className="container mx-auto flex flex-col sm:flex-row items-center justify-center gap-y-2 gap-x-2 sm:gap-x-3">
          {activeAlerts.map((alert, index) => (
            <React.Fragment key={alert.key}>
              <button 
                onClick={alert.onClick} 
                className="flex items-center gap-2 bg-black/20 border border-white/20 hover:bg-white/20 rounded-md p-1.5 text-xs sm:text-sm font-semibold transition-colors text-left"
              >
                {alert.content}
              </button>
              {index < activeAlerts.length - 1 && (
                <span className="hidden sm:inline text-white/50">|</span>
              )}
            </React.Fragment>
          ))}
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

  return null;
};

export default GlobalBanner;
// --- END OF FILE src/components/GlobalBanner.tsx ---