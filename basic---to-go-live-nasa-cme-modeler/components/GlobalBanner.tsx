// --- START OF FILE src/components/GlobalBanner.tsx ---

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SubstormActivity, InterplanetaryShock } from '../types';
import type { SubstormRiskData } from '../hooks/useForecastData';

const SUBSTORM_URL = 'https://aurora-index-sta.thenamesrock.workers.dev/api/substorm?resolution=5m';

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

// --- MODIFICATION: Added IPS Alert props ---
interface GlobalBannerProps {
  isFlareAlert: boolean;
  flareClass?: string;
  isAuroraAlert: boolean;
  auroraScore?: number;
  isSubstormAlert: boolean;
  substormActivity?: SubstormActivity;
  isIpsAlert: boolean;
  ipsAlertData?: { shock: InterplanetaryShock; solarWind: { speed: string; bt: string; bz: string; } } | null;
  hideForTutorial?: boolean;
  onFlareAlertClick: () => void;
  onAuroraAlertClick: () => void;
  onSubstormAlertClick: () => void;
  onIpsAlertClick: () => void;
}

type AlertSlide = {
  id: string;
  content: React.ReactNode;
  backgroundClass: string;
  textClass?: string;
  style?: React.CSSProperties;
};

// Helper to format timestamp to HH:mm (NZ local time, no TZ label)
const formatTime = (timestamp?: number | string): string => {
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
  isIpsAlert,
  ipsAlertData,
  hideForTutorial = false,
  onFlareAlertClick,
  onAuroraAlertClick,
  onSubstormAlertClick,
  onIpsAlertClick,
}) => {
  if (hideForTutorial) return null;

  const [globalBanner, setGlobalBanner] = useState<BannerData | null>(null);
  const [substormRisk, setSubstormRisk] = useState<SubstormRiskData | null>(null);
  const [isGlobalBannerDismissed, setIsGlobalBannerDismissed] = useState(false);
  const [isDynamicDismissed, setIsDynamicDismissed] = useState(false);
  const lastProcessedBannerUniqueIdRef = useRef<string | undefined>(undefined);
  const [activeAlertIndex, setActiveAlertIndex] = useState(0);

  useEffect(() => {
    const fetchGlobalBanner = async () => {
      try {
        const response = await fetch(`${BANNER_API_URL}?_=${Date.now()}`);
        if (!response.ok) {
          setGlobalBanner(null);
          setIsGlobalBannerDismissed(false);
          return;
        }
        const data: BannerData = await response.json();
        lastProcessedBannerUniqueIdRef.current = data.id || data.message;
        setGlobalBanner(data);
        if (data.isActive) {
          setIsGlobalBannerDismissed(false);
        } else {
          setIsGlobalBannerDismissed(false);
        }
      } catch (error) {
        setGlobalBanner(null);
        setIsGlobalBannerDismissed(false);
      }
    };
    fetchGlobalBanner();
    const interval = setInterval(fetchGlobalBanner, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchSubstorm = async () => {
      try {
        const r = await fetch(SUBSTORM_URL);
        if (r.ok) setSubstormRisk(await r.json());
      } catch { /* non-critical */ }
    };
    fetchSubstorm();
    const interval = setInterval(fetchSubstorm, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setActiveAlertIndex(0);
    setIsDynamicDismissed(false);
  }, [isFlareAlert, isAuroraAlert, isSubstormAlert, isIpsAlert, globalBanner?.id]);

  const alerts: AlertSlide[] = [];

  if (globalBanner && globalBanner.isActive && !isGlobalBannerDismissed) {
    const isCustom = globalBanner.type === 'custom';
    const bgClass = isCustom
      ? ''
      : globalBanner.type === 'info'
        ? 'bg-gradient-to-r from-blue-600 via-sky-500 to-sky-600'
        : globalBanner.type === 'warning'
          ? 'bg-gradient-to-r from-yellow-400 via-amber-400 to-orange-500'
          : 'bg-gradient-to-r from-red-600 via-pink-500 to-pink-600';

    const textClass = globalBanner.type === 'warning' && !isCustom ? 'text-gray-900' : 'text-white';
    const style = isCustom
      ? { backgroundColor: globalBanner.backgroundColor || '#000000', color: globalBanner.textColor || '#ffffff' }
      : undefined;

    alerts.push({
      id: globalBanner.id || globalBanner.message,
      backgroundClass: bgClass,
      textClass,
      style,
      content: (
        <div className="flex items-center justify-center gap-2 flex-wrap">
          {globalBanner.emojis && <span role="img" aria-label="Emoji">{globalBanner.emojis}</span>}
          <span>{globalBanner.message}</span>
          {globalBanner.link && globalBanner.link.url && globalBanner.link.text && (
            <a
              href={globalBanner.link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline ml-1 ${isCustom ? '' : (globalBanner.type === 'warning' ? 'text-blue-800' : 'text-blue-100 hover:text-white')}`}
              style={isCustom ? { color: globalBanner.textColor || '#ffffff' } : {}}
            >
              {globalBanner.link.text}
            </a>
          )}
        </div>
      ),
    });
  }

  if (isIpsAlert && ipsAlertData) {
    alerts.push({
      id: 'ips-alert',
      backgroundClass: 'bg-gradient-to-r from-red-600 via-pink-500 to-pink-600 animate-pulse',
      textClass: 'text-white',
      content: (
        <button onClick={onIpsAlertClick} className="w-full flex flex-col sm:flex-row items-center justify-center gap-x-4 gap-y-1 hover:bg-white/10 p-1 rounded-md transition-colors">
          <div className="flex items-center gap-2">
            <span role="img" aria-label="Impact">💥</span>
            <strong>Interplanetary Shock Arrived at {formatTime(ipsAlertData.shock.eventTime)}!</strong>
          </div>
          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap justify-center">
            <span>Speed: <strong>{ipsAlertData.solarWind.speed}</strong> km/s</span>
            <span>Bt: <strong>{ipsAlertData.solarWind.bt}</strong> nT</span>
            <span>Bz: <strong>{ipsAlertData.solarWind.bz}</strong> nT</span>
          </div>
        </button>
      ),
    });
  }

  if (isFlareAlert) {
    alerts.push({
      id: 'flare-alert',
      backgroundClass: 'bg-gradient-to-r from-orange-600 via-amber-500 to-yellow-400',
      textClass: 'text-black',
      content: (
        <button onClick={onFlareAlertClick} className="flex items-center gap-2 hover:bg-black/10 px-2 py-1 rounded-md transition-colors text-sm sm:text-base">
          <span role="img" aria-label="Solar Flare">💥</span>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 text-center sm:text-left">
            <strong>Solar Flare Alert</strong>
            <span className="font-medium">An active {flareClass} flare is in progress.</span>
          </div>
        </button>
      ),
    });
  }

  if (isAuroraAlert) {
    alerts.push({
      id: 'aurora-alert',
      backgroundClass: 'bg-gradient-to-r from-green-600 via-emerald-500 to-sky-500',
      textClass: 'text-white',
      content: (
        <button onClick={onAuroraAlertClick} className="flex items-center gap-2 hover:bg-white/10 px-2 py-1 rounded-md transition-colors text-sm sm:text-base">
          <span role="img" aria-label="Aurora">✨</span>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 text-center sm:text-left">
            <strong>Aurora Forecast</strong>
            <span className="font-medium">Spot The Aurora Forecast is at {auroraScore?.toFixed(1)}%.</span>
          </div>
        </button>
      ),
    });
  }

  if (substormRisk?.current && substormRisk.current.score >= 30) {
    const score = substormRisk.current.score;
    const level = substormRisk.current.level ?? '';
    const trend = substormRisk.current.risk_trend ?? '';
    const bz = substormRisk.metrics?.solar_wind?.bz;
    const bayOnset = substormRisk.current.bay_onset_flag;
    const trendArrow = trend.includes('Rapidly Increasing') ? '⬆⬆' : trend.includes('Increasing') ? '⬆' : trend.includes('Rapidly Decreasing') ? '⬇⬇' : trend.includes('Decreasing') ? '⬇' : '→';
    alerts.push({
      id: `substorm-risk-${Math.round(score)}`,
      backgroundClass: score >= 70
        ? 'bg-gradient-to-r from-pink-800 via-purple-700 to-indigo-700'
        : score >= 50
          ? 'bg-gradient-to-r from-purple-800 via-indigo-600 to-sky-600'
          : 'bg-gradient-to-r from-indigo-900 via-blue-800 to-sky-800',
      textClass: 'text-white',
      content: (
        <button onClick={onSubstormAlertClick} className="flex items-center gap-2 hover:bg-white/10 px-2 py-1 rounded-md transition-colors text-left w-full justify-center">
          <span role="img" aria-label="Substorm">{bayOnset ? '🌩️' : '⚡'}</span>
          <div className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-3 text-center sm:text-left">
            <strong>{bayOnset ? 'Substorm Onset Detected' : `Substorm Risk: ${level}`}</strong>
            <span className="font-medium">Index {Math.round(score)} {trendArrow}{bz != null ? ` · Bz ${bz > 0 ? '+' : ''}${bz.toFixed(1)} nT` : ''}</span>
            <span className="opacity-80 text-xs">{getVisibilityLevel(auroraScore)} from your location</span>
          </div>
        </button>
      ),
    });
  }

  const activeSlide = alerts[activeAlertIndex];

  useEffect(() => {
    if (activeAlertIndex > alerts.length - 1) {
      setActiveAlertIndex(0);
    }
  }, [activeAlertIndex, alerts.length]);

  if (alerts.length === 0) return null;

  const goPrev = () => setActiveAlertIndex((idx) => (idx - 1 + alerts.length) % alerts.length);
  const goNext = () => setActiveAlertIndex((idx) => (idx + 1) % alerts.length);
  const hasMultiple = alerts.length > 1;

  // Separate remote banner from dynamic alerts so they render independently
  const remoteBannerSlide = alerts.find(a => a.id === (globalBanner?.id || globalBanner?.message));
  const dynamicAlerts = alerts.filter(a => a.id !== remoteBannerSlide?.id);
  const activeDynamic = dynamicAlerts[activeAlertIndex % Math.max(dynamicAlerts.length, 1)];
  const hasDynamicMultiple = dynamicAlerts.length > 1;

  return (
    <div className="w-full flex-shrink-0 relative z-50">
      {/* Remote banner — always visible when active, dismissible */}
      {remoteBannerSlide && !isGlobalBannerDismissed && (
        <div
          className={`w-full text-sm font-semibold ${remoteBannerSlide.backgroundClass} ${remoteBannerSlide.textClass ?? 'text-white'}`}
          style={remoteBannerSlide.style}
        >
          <div className="relative px-10 py-2.5 text-center leading-relaxed">
            {remoteBannerSlide.content}
            <button
              onClick={() => setIsGlobalBannerDismissed(true)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 transition-colors text-white/80 hover:text-white text-xs leading-none"
              title="Dismiss"
              aria-label="Dismiss banner"
            >✕</button>
          </div>
        </div>
      )}
      {/* Dynamic alert carousel — with counter, prev/next, and dismiss */}
      {activeDynamic && !isDynamicDismissed && (
        <div
          className={`w-full text-sm font-semibold ${activeDynamic.backgroundClass} ${activeDynamic.textClass ?? 'text-white'}`}
          style={activeDynamic.style}
        >
          <div className="relative px-10 py-2.5">
            {/* Content centred */}
            <div className="w-full text-center leading-relaxed">
              {activeDynamic.content}
            </div>
            {/* Counter + arrows inline, left of dismiss */}
            {hasDynamicMultiple && (
              <div className="flex items-center justify-center gap-1.5 mt-1">
                <button onClick={goPrev} className="w-5 h-5 flex items-center justify-center rounded bg-black/20 hover:bg-black/40 transition-colors text-white/80 hover:text-white text-xs">◀</button>
                <span className="px-2 py-0.5 rounded-full bg-black/20 text-white/90 text-xs tabular-nums">
                  {(activeAlertIndex % dynamicAlerts.length) + 1} / {dynamicAlerts.length}
                </span>
                <button onClick={goNext} className="w-5 h-5 flex items-center justify-center rounded bg-black/20 hover:bg-black/40 transition-colors text-white/80 hover:text-white text-xs">▶</button>
              </div>
            )}
            {/* Dismiss button */}
            <button
              onClick={() => setIsDynamicDismissed(true)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-full bg-black/20 hover:bg-black/40 transition-colors text-white/80 hover:text-white text-xs leading-none"
              title="Dismiss"
              aria-label="Dismiss alert"
            >✕</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default GlobalBanner;
// --- END OF FILE src/components/GlobalBanner.tsx ---