// --- START OF FILE App.tsx ---

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import SimulationCanvas from './components/SimulationCanvas';
import ControlsPanel from './components/ControlsPanel';
import CMEListPanel from './components/CMEListPanel';
import TimelineControls from './components/TimelineControls';
import PlanetLabel from './components/PlanetLabel';
import TutorialModal from './components/TutorialModal'; // This is the general tutorial modal
import LoadingOverlay from './components/LoadingOverlay';
import MediaViewerModal from './components/MediaViewerModal';
import { fetchCMEData } from './services/nasaService';
import { ProcessedCME, ViewMode, FocusTarget, TimeRange, PlanetLabelInfo, CMEFilter, SimulationCanvasHandle, InteractionMode, SubstormActivity, InterplanetaryShock } from './types';
import { SCENE_SCALE } from './constants'; // Import SCENE_SCALE for occlusion check

// Icon Imports
import SettingsIcon from './components/icons/SettingsIcon';
import ListIcon from './components/icons/ListIcon';
import MoveIcon from './components/icons/MoveIcon';
import SelectIcon from './components/icons/SelectIcon';
import ForecastIcon from './components/icons/ForecastIcon'; // Now points to your custom file
import GlobeIcon from './components/icons/GlobeIcon';
import SunIcon from './components/icons/SunIcon';
import CmeIcon from './components/icons/CmeIcon';
import ForecastModelsModal from './components/ForecastModelsModal';

// Dashboard and Banner Imports
import ForecastDashboard from './components/ForecastDashboard';
import SolarActivityDashboard from './components/SolarActivityDashboard';
import GlobalBanner from './components/GlobalBanner';

// Modal Imports
import SettingsModal from './components/SettingsModal';
import FirstVisitTutorial from './components/FirstVisitTutorial';
import CmeModellerTutorial from './components/CmeModellerTutorial';

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
);

type ViewerMedia =
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'animation', urls: string[] };

interface NavigationTarget {
  page: 'forecast' | 'solar-activity';
  elementId: string;
  expandId?: string;
}

// --- MODIFICATION: Added type for IPS Alert Data ---
interface IpsAlertData {
    shock: InterplanetaryShock;
    solarWind: {
        speed: string;
        bt: string;
        bz: string;
    };
}

const NAVIGATION_TUTORIAL_KEY = 'hasSeenNavigationTutorial_v1';
const CME_TUTORIAL_KEY = 'hasSeenCmeTutorial_v1';
const APP_VERSION = 'V1.0';

const App: React.FC = () => {
  const [activePage, setActivePage] = useState<'forecast' | 'modeler' | 'solar-activity'>('forecast');
  const [cmeData, setCmeData] = useState<ProcessedCME[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState<number>(0);
  const [activeTimeRange, setActiveTimeRange] = useState<TimeRange>(TimeRange.D3);
  const [activeView, setActiveView] = useState<ViewMode>(ViewMode.TOP);
  const [activeFocus, setActiveFocus] = useState<FocusTarget | null>(FocusTarget.EARTH);
  const [currentlyModeledCMEId, setCurrentlyModeledCMEId] = useState<string | null>(null);
  const [selectedCMEForInfo, setSelectedCMEForInfo] = useState<ProcessedCME | null>(null);
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isCmeListOpen, setIsCmeListOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isForecastModelsOpen, setIsForecastModelsOpen] = useState(false);
  const [viewerMedia, setViewerMedia] = useState<ViewerMedia | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFirstVisitTutorialOpen, setIsFirstVisitTutorialOpen] = useState(false);
  const [isCmeTutorialOpen, setIsCmeTutorialOpen] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget | null>(null);

  const [showLabels, setShowLabels] = useState(true);
  const [showExtraPlanets, setShowExtraPlanets] = useState(true);
  const [showMoonL1, setShowMoonL1] = useState(false);
  const [cmeFilter, setCmeFilter] = useState<CMEFilter>(CMEFilter.ALL);
  const [timelineActive, setTimelineActive] = useState<boolean>(false);
  const [timelinePlaying, setTimelinePlaying] = useState<boolean>(false);
  const [timelineScrubberValue, setTimelineScrubberValue] = useState<number>(0);
  const [timelineSpeed, setTimelineSpeed] = useState<number>(5);
  const [timelineMinDate, setTimelineMinDate] = useState<number>(0);
  const [timelineMaxDate, setTimelineMaxDate] = useState<number>(0);
  const [planetLabelInfos, setPlanetLabelInfos] = useState<PlanetLabelInfo[]>([]);
  const [rendererDomElement, setRendererDomElement] = useState<HTMLCanvasElement | null>(null);
  const [threeCamera, setThreeCamera] = useState<any>(null);
  const clockRef = useRef<any>(null);
  const canvasRef = useRef<SimulationCanvasHandle>(null);
  const apiKey = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY';
  const [latestXrayFlux, setLatestXrayFlux] = useState<number | null>(null);
  const [currentAuroraScore, setCurrentAuroraScore] = useState<number | null>(null);
  const [substormActivityStatus, setSubstormActivityStatus] = useState<SubstormActivity | null>(null);
  
  // --- NEW: State for IPS alert data ---
  const [ipsAlertData, setIpsAlertData] = useState<IpsAlertData | null>(null);

  const [showIabBanner, setShowIabBanner] = useState(false);
  const [isIOSIab, setIsIOSIab] = useState(false);
  const [isAndroidIab, setIsAndroidIab] = useState(false);
  const deferredInstallPromptRef = useRef<any>(null);
  const CANONICAL_ORIGIN = 'https://www.spottheaurora.co.nz';

  useEffect(() => {
    const ua = navigator.userAgent || '';
    const isFB = /(FBAN|FBAV|FB_IAB|FBIOS|FBAN\/Messenger)/i.test(ua);
    const isIG = /Instagram/i.test(ua);
    const inIAB = isFB || isIG;
    const isIOS = /iPad|iPhone|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);

    if (inIAB) {
      setShowIabBanner(true);
      setIsIOSIab(isIOS);
      setIsAndroidIab(isAndroid);
    }

    const onBip = (e: any) => {
      if (inIAB) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      deferredInstallPromptRef.current = e;
      (window as any).spotTheAuroraCanInstall = true;
    };

    window.addEventListener('beforeinstallprompt', onBip);
    return () => window.removeEventListener('beforeinstallprompt', onBip);
  }, []);

  const handleIabOpenInBrowser = useCallback(() => {
    const here = new URL(window.location.href);
    const target =
      here.origin === CANONICAL_ORIGIN
        ? here.href
        : CANONICAL_ORIGIN + here.pathname + here.search + here.hash;

    if (isAndroidIab) {
      const intent = `intent://${location.host}${location.pathname}${location.search}#Intent;scheme=https;package=com.android.chrome;end`;
      window.location.href = intent;
      setTimeout(() => window.open(target, '_blank', 'noopener,noreferrer'), 400);
    } else {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }, [isAndroidIab]);

  const handleIabCopyLink = useCallback(async () => {
    const url = window.location.href.split('#')[0];
    try {
      await navigator.clipboard.writeText(url);
      alert('Link copied. Open it in your browser to install.');
    } catch {
      prompt('Copy this URL:', url);
    }
  }, []);

  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem(NAVIGATION_TUTORIAL_KEY);
    if (!hasSeenTutorial) {
      setIsFirstVisitTutorialOpen(true);
    }
    if (!clockRef.current && (window as any).THREE) {
      clockRef.current = new (window as any).THREE.Clock();
    }
  }, []);

  useEffect(() => {
    if (activePage === 'modeler' && !isLoading) {
      const hasSeenCmeTutorial = localStorage.getItem(CME_TUTORIAL_KEY);
      if (!hasSeenCmeTutorial) {
        setTimeout(() => setIsCmeTutorialOpen(true), 200);
      }
    }
  }, [activePage, isLoading]);

  useEffect(() => {
    if (navigationTarget) {
      setActivePage(navigationTarget.page);
      const scrollTimer = setTimeout(() => {
        const element = document.getElementById(navigationTarget.elementId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setNavigationTarget(null);
      }, 100);
      return () => clearTimeout(scrollTimer);
    }
  }, [navigationTarget]);
  
  const handleCloseFirstVisitTutorial = useCallback(() => {
    localStorage.setItem(NAVIGATION_TUTORIAL_KEY, 'true');
    setIsFirstVisitTutorialOpen(false);
    setHighlightedElementId(null);
  }, []);

  const handleCloseCmeTutorial = useCallback(() => {
    localStorage.setItem(CME_TUTORIAL_KEY, 'true');
    setIsCmeTutorialOpen(false);
    setHighlightedElementId(null);
  }, []);

  const handleTutorialStepChange = useCallback((id: string | null) => {
    setHighlightedElementId(id);
  }, []);

  const handleShowTutorial = useCallback(() => {
    setIsSettingsOpen(false);
    setIsFirstVisitTutorialOpen(true);
  }, []);

  const getClockElapsedTime = useCallback(() => (clockRef.current ? clockRef.current.getElapsedTime() : 0), []);
  const resetClock = useCallback(() => { if (clockRef.current) { clockRef.current.stop(); clockRef.current.start(); } }, []);

  const loadCMEData = useCallback(async (days: TimeRange) => {
    setIsLoading(true);
    setFetchError(null);
    setCurrentlyModeledCMEId(null);
    setSelectedCMEForInfo(null);
    setTimelineActive(false);
    setTimelinePlaying(false);
    setTimelineScrubberValue(0);
    resetClock();
    setDataVersion((v: number) => v + 1);
    try {
      const data = await fetchCMEData(days, apiKey);
      setCmeData(data);
      if (data.length > 0) {
        const endDate = new Date();
        const futureDate = new Date();
        futureDate.setDate(endDate.getDate() + 3);
        const earliestCMEStartTime = data.reduce((min: number, cme: ProcessedCME) => Math.min(min, cme.startTime.getTime()), Date.now());
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - days);
        setTimelineMinDate(Math.min(startDate.getTime(), earliestCMEStartTime));
        setTimelineMaxDate(futureDate.getTime());
      } else {
        setTimelineMinDate(0);
        setTimelineMaxDate(0);
      }
    } catch (err) {
      console.error(err);
      if (err instanceof Error && err.message.includes('429')) {
        setFetchError('NASA API rate limit exceeded. Please wait a moment and try again.');
      } else {
        setFetchError((err as Error).message || "Unknown error fetching data.");
      }
      setCmeData([]);
    } finally {
      setIsLoading(false);
    }
  }, [resetClock, apiKey]);

  useEffect(() => { if (activePage === 'modeler') { loadCMEData(activeTimeRange); } }, [activeTimeRange, loadCMEData, activePage]);
  const filteredCmes = useMemo(() => { if (cmeFilter === CMEFilter.ALL) return cmeData; return cmeData.filter((cme: ProcessedCME) => cmeFilter === CMEFilter.EARTH_DIRECTED ? cme.isEarthDirected : !cme.isEarthDirected); }, [cmeData, cmeFilter]);
  
  const cmesToRender = useMemo(() => {
    if (currentlyModeledCMEId) {
      const singleCME = cmeData.find(c => c.id === currentlyModeledCMEId);
      return singleCME ? [singleCME] : [];
    }
    return filteredCmes;
  }, [currentlyModeledCMEId, cmeData, filteredCmes]);

  useEffect(() => { if (currentlyModeledCMEId && !filteredCmes.find((c: ProcessedCME) => c.id === currentlyModeledCMEId)) { setCurrentlyModeledCMEId(null); setSelectedCMEForInfo(null); } }, [filteredCmes, currentlyModeledCMEId]);
  const handleTimeRangeChange = (range: TimeRange) => setActiveTimeRange(range);
  const handleViewChange = (view: ViewMode) => setActiveView(view);
  const handleFocusChange = (target: FocusTarget) => setActiveFocus(target);
  const handleResetView = useCallback(() => { setActiveView(ViewMode.TOP); setActiveFocus(FocusTarget.EARTH); canvasRef.current?.resetView(); }, []);
  
  const handleSelectCMEForModeling = useCallback((cme: ProcessedCME | null) => {
    setCurrentlyModeledCMEId(cme ? cme.id : null);
    setSelectedCMEForInfo(cme);
    setIsCmeListOpen(false);

    if (cme) {
      setTimelineActive(true);
      setTimelinePlaying(true);
      setTimelineScrubberValue(0);
      setTimelineMinDate(cme.startTime.getTime());
      if (cme.predictedArrivalTime) {
        setTimelineMaxDate(cme.predictedArrivalTime.getTime() + (12 * 3600 * 1000));
      } else {
        const futureDate = new Date(cme.startTime);
        futureDate.setDate(futureDate.getDate() + 4);
        setTimelineMaxDate(futureDate.getTime());
      }
    } else {
      setTimelineActive(false);
      setTimelinePlaying(false);
      setTimelineScrubberValue(0);
      if (cmeData.length > 0) {
        const endDate = new Date();
        const futureDate = new Date();
        futureDate.setDate(endDate.getDate() + 3);
        const earliestCMEStartTime = cmeData.reduce((min: number, cme_item: ProcessedCME) => Math.min(min, cme_item.startTime.getTime()), Date.now());
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - activeTimeRange);
        setTimelineMinDate(Math.min(startDate.getTime(), earliestCMEStartTime));
        setTimelineMaxDate(futureDate.getTime());
      } else {
        setTimelineMinDate(0);
        setTimelineMaxDate(0);
      }
    }
  }, [cmeData, activeTimeRange]);

  const handleCMEClickFromCanvas = useCallback((cme: ProcessedCME) => {
    handleSelectCMEForModeling(cme);
    setIsCmeListOpen(true);
  }, [handleSelectCMEForModeling]);

  const handleTimelinePlayPause = useCallback(() => {
    if (filteredCmes.length === 0 && !currentlyModeledCMEId) return;
    setTimelineActive(true);

    const isAtEnd = timelineScrubberValue >= 999;
    const isAtStart = timelineScrubberValue < 1;
    const isPlaying = timelinePlaying;

    if (isAtEnd) {
      setTimelineScrubberValue(0);
      resetClock();
      canvasRef.current?.resetAnimationTimer();
      setTimelinePlaying(true);
    } else if (!isPlaying) {
      if (isAtStart) {
        resetClock();
        canvasRef.current?.resetAnimationTimer();
      }
      setTimelinePlaying(true);
    } else {
      setTimelinePlaying(false);
    }
  }, [filteredCmes, currentlyModeledCMEId, timelineScrubberValue, timelinePlaying, resetClock]);

  const handleTimelineScrub = useCallback((value: number) => {
    if (filteredCmes.length === 0 && !currentlyModeledCMEId) return;
    setTimelineActive(true);
    setTimelinePlaying(false);
    setTimelineScrubberValue(value);
  }, [filteredCmes, currentlyModeledCMEId]);

  const handleTimelineStep = useCallback((direction: -1 | 1) => {
    if (filteredCmes.length === 0 && !currentlyModeledCMEId) return;
    setTimelineActive(true);
    setTimelinePlaying(false);
    const timeRange = timelineMaxDate - timelineMinDate;
    if (timeRange > 0) {
      const oneHourInMillis = 3600_000;
      const oneHourScrubberStep = (oneHourInMillis / timeRange) * 1000;
      setTimelineScrubberValue((prev: number) => Math.max(0, Math.min(1000, prev + direction * oneHourScrubberStep)));
    } else {
      setTimelineScrubberValue((prev: number) => Math.max(0, Math.min(1000, prev + direction * 10)));
    }
  }, [filteredCmes, currentlyModeledCMEId, timelineMinDate, timelineMaxDate]);

  const handleTimelineSetSpeed = useCallback((speed: number) => setTimelineSpeed(speed), []);
  const handleScrubberChangeByAnim = useCallback((value: number) => setTimelineScrubberValue(value), []);
  const handleTimelineEnd = useCallback(() => setTimelinePlaying(false), []);
  const handleSetPlanetMeshes = useCallback((infos: PlanetLabelInfo[]) => setPlanetLabelInfos(infos), []);
  const sunInfo = planetLabelInfos.find((info: PlanetLabelInfo) => info.name === 'Sun');
  const isFlareAlert = useMemo(() => latestXrayFlux !== null && latestXrayFlux >= 1e-5, [latestXrayFlux]);
  const flareClass = useMemo(() => { if (latestXrayFlux === null) return undefined; if (latestXrayFlux >= 1e-4) return `X${(latestXrayFlux / 1e-4).toFixed(1)}`; if (latestXrayFlux >= 1e-5) return `M${(latestXrayFlux / 1e-5).toFixed(1)}`; return undefined; }, [latestXrayFlux]);
  const isAuroraAlert = useMemo(() => currentAuroraScore !== null && currentAuroraScore >= 50, [currentAuroraScore]);

  const isSubstormAlert = useMemo(() =>
    substormActivityStatus?.isStretching &&
    !substormActivityStatus?.isErupting &&
    (substormActivityStatus.probability ?? 0) > 0,
  [substormActivityStatus]);

  const handleDownloadImage = useCallback(() => {
    const dataUrl = canvasRef.current?.captureCanvasAsDataURL();
    if (!dataUrl || !rendererDomElement || !threeCamera) {
      console.error("Could not capture canvas image: canvas, renderer, or camera is not ready.");
      return;
    }

    const mainImage = new Image();
    mainImage.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = mainImage.width;
      canvas.height = mainImage.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(mainImage, 0, 0);

      if (showLabels && (window as any).THREE) {
        const THREE = (window as any).THREE;
        const cameraPosition = new THREE.Vector3();
        threeCamera.getWorldPosition(cameraPosition);

        planetLabelInfos.forEach(info => {
          if (info.name === 'Moon' || info.name === 'L1' || !info.mesh.visible) {
            return;
          }

          const planetWorldPos = new THREE.Vector3();
          info.mesh.getWorldPosition(planetWorldPos);

          const projectionVector = planetWorldPos.clone().project(threeCamera);
          if (projectionVector.z > 1) return;

          const dist = planetWorldPos.distanceTo(cameraPosition);
          const minVisibleDist = SCENE_SCALE * 0.2;
          const maxVisibleDist = SCENE_SCALE * 15;
          if (dist < minVisibleDist || dist > maxVisibleDist) return;

          if (sunInfo && info.name !== 'Sun') {
            const sunWorldPos = new THREE.Vector3();
            sunInfo.mesh.getWorldPosition(sunWorldPos);
            const distToPlanetSq = planetWorldPos.distanceToSquared(cameraPosition);
            const distToSunSq = sunWorldPos.distanceToSquared(cameraPosition);
            if (distToPlanetSq > distToSunSq) {
              const vecToPlanet = planetWorldPos.clone().sub(cameraPosition);
              const vecToSun = sunWorldPos.clone().sub(cameraPosition);
              const angle = vecToPlanet.angleTo(vecToSun);
              const sunRadius = (sunInfo.mesh.geometry.parameters?.radius) || (0.1 * SCENE_SCALE);
              const sunAngularRadius = Math.atan(sunRadius / Math.sqrt(distToSunSq));
              if (angle < sunAngularRadius) return;
            }
          }

          const x = (projectionVector.x * 0.5 + 0.5) * canvas.width;
          const y = (-projectionVector.y * 0.5 + 0.5) * canvas.height;
          const fontSize = THREE.MathUtils.mapLinear(dist, minVisibleDist, maxVisibleDist, 16, 10);

          ctx.font = `${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
          ctx.shadowBlur = 6;
          
          ctx.fillText(info.name, x + 15, y - 10);
        });
      }

      const padding = 25;
      const fontSize = Math.max(24, mainImage.width / 65);
      const textGap = 10;
      ctx.font = `bold ${fontSize}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 7;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';

      const totalDuration = timelineMaxDate - timelineMinDate;
      const currentTimeOffset = totalDuration * (timelineScrubberValue / 1000);
      const simulationDate = new Date(timelineMinDate + currentTimeOffset);
      const dateString = `Simulated Time: ${simulationDate.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'medium', timeStyle: 'long' })}`;
      
      const watermarkText = "SpotTheAurora.co.nz";
      
      const icon = new Image();
      icon.onload = () => {
        const iconSize = (fontSize * 2) + textGap;
        const iconPadding = 15;
        
        const iconX = canvas.width - padding - iconSize;
        const iconY = canvas.height - padding - iconSize;
        
        const textX = iconX - iconPadding;
        
        ctx.fillText(dateString, textX, canvas.height - padding - fontSize - textGap);
        ctx.fillText(watermarkText, textX, canvas.height - padding);
        
        ctx.drawImage(icon, iconX, iconY, iconSize, iconSize);

        const link = document.createElement('a');
        link.download = `spottheaurora-cme-${simulationDate.toISOString().replace(/:/g, '-')}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      };
      icon.src = '/icons/android-chrome-192x192.png';
    };
    mainImage.src = dataUrl;
  }, [timelineMinDate, timelineMaxDate, timelineScrubberValue, showLabels, rendererDomElement, threeCamera, planetLabelInfos, sunInfo]);

  const handleViewCMEInVisualization = useCallback((cmeId: string) => {
    setActivePage('modeler');
    const cmeToModel = cmeData.find(cme => cme.id === cmeId);
    if (cmeToModel) {
      handleSelectCMEForModeling(cmeToModel);
    }
    setIsCmeListOpen(true);
  }, [cmeData, handleSelectCMEForModeling]);

  const handleFlareAlertClick = useCallback(() => {
    setNavigationTarget({ page: 'solar-activity', elementId: 'goes-xray-flux-section' });
  }, []);

  const handleAuroraAlertClick = useCallback(() => {
    setNavigationTarget({ page: 'forecast', elementId: 'unified-forecast-section' });
  }, []);

  const handleSubstormAlertClick = useCallback(() => {
    setNavigationTarget({
      page: 'forecast',
      elementId: 'unified-forecast-section',
    });
  }, []);

  // --- NEW: Handler for IPS Alert Clicks ---
  const handleIpsAlertClick = useCallback(() => {
    setNavigationTarget({
        page: 'solar-activity',
        elementId: 'ips-shocks-section'
    });
  }, []);

  return (
    <div className="w-screen h-screen bg-black flex flex-col text-neutral-300 overflow-hidden">
        <style>{`.tutorial-highlight { position: relative; z-index: 2003 !important; box-shadow: 0 0 15px 5px rgba(59, 130, 246, 0.7); border-color: #3b82f6 !important; }`}</style>
        
        <GlobalBanner
            isFlareAlert={isFlareAlert}
            flareClass={flareClass}
            isAuroraAlert={isAuroraAlert}
            auroraScore={currentAuroraScore ?? undefined}
            isSubstormAlert={isSubstormAlert}
            substormActivity={substormActivityStatus ?? undefined}
            isIpsAlert={!!ipsAlertData}
            ipsAlertData={ipsAlertData}
            onFlareAlertClick={handleFlareAlertClick}
            onAuroraAlertClick={handleAuroraAlertClick}
            onSubstormAlertClick={handleSubstormAlertClick}
            onIpsAlertClick={handleIpsAlertClick}
        />

        <header className="flex-shrink-0 p-2 md:p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-center items-center gap-4 relative z-[2001]">
            <div className="flex items-center space-x-2">
                <button id="nav-forecast" onClick={() => setActivePage('forecast')} className={`flex flex-col md:flex-row items-center justify-center md:space-x-2 px-3 py-1 md:px-4 md:py-2 rounded-lg text-neutral-200 shadow-lg transition-all ${activePage === 'forecast' ? 'bg-sky-500/30 border border-sky-400' : 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90'} ${highlightedElementId === 'nav-forecast' ? 'tutorial-highlight' : ''}`} title="View Live Aurora Forecasts">
                    <ForecastIcon className="w-5 h-5" />
                    <span className="text-xs md:text-sm font-semibold mt-1 md:mt-0">Spot The Aurora</span>
                </button>
                <button id="nav-solar-activity" onClick={() => setActivePage('solar-activity')} className={`flex flex-col md:flex-row items-center justify-center md:space-x-2 px-3 py-1 md:px-4 md:py-2 rounded-lg text-neutral-200 shadow-lg transition-all ${activePage === 'solar-activity' ? 'bg-amber-500/30 border border-amber-400' : 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90'} ${highlightedElementId === 'nav-solar-activity' ? 'tutorial-highlight' : ''}`} title="View Solar Activity">
                    <SunIcon className="w-5 h-5" />
                    <span className="text-xs md:text-sm font-semibold mt-1 md:mt-0">Solar Activity</span>
                </button>
                 <button id="nav-modeler" onClick={() => setActivePage('modeler')} className={`flex flex-col md:flex-row items-center justify-center md:space-x-2 px-3 py-1 md:px-4 md:py-2 rounded-lg text-neutral-200 shadow-lg transition-all ${activePage === 'modeler' ? 'bg-indigo-500/30 border border-indigo-400' : 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90'} ${highlightedElementId === 'nav-modeler' ? 'tutorial-highlight' : ''}`} title="View CME Visualization">
                    <CmeIcon className="w-5 h-5" />
                    <span className="text-xs md:text-sm font-semibold mt-1 md:mt-0">CME Visualization</span>
                </button>
            </div>
            <div className="flex-grow flex justify-end">
                <button id="nav-settings" onClick={() => setIsSettingsOpen(true)} className={`p-2 bg-neutral-800/80 border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg transition-all hover:bg-neutral-700/90 ${highlightedElementId === 'nav-settings' ? 'tutorial-highlight' : ''}`} title="Open Settings"><SettingsIcon className="w-6 h-6" /></button>
            </div>
        </header>

        <div className="flex flex-grow min-h-0">
            {activePage === 'modeler' && ( <>
                <div id="controls-panel-container" className={`flex-shrink-0 lg:p-5 lg:relative lg:translate-x-0 lg:w-auto lg:max-w-xs fixed top-[4.25rem] left-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isControlsOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                    <ControlsPanel activeTimeRange={activeTimeRange} onTimeRangeChange={handleTimeRangeChange} activeView={activeView} onViewChange={handleViewChange} activeFocus={activeFocus} onFocusChange={handleFocusChange} isLoading={isLoading} onClose={() => setIsControlsOpen(false)} onOpenGuide={() => setIsTutorialOpen(true)} showLabels={showLabels} onShowLabelsChange={setShowLabels} showExtraPlanets={showExtraPlanets} onShowExtraPlanetsChange={setShowExtraPlanets} showMoonL1={showMoonL1} onShowMoonL1Change={setShowMoonL1} cmeFilter={cmeFilter} onCmeFilterChange={setCmeFilter} />
                </div>
                <main id="simulation-canvas-main" className="flex-1 relative min-w-0 h-full">
                    <SimulationCanvas ref={canvasRef} cmeData={cmesToRender} activeView={activeView} focusTarget={activeFocus} currentlyModeledCMEId={currentlyModeledCMEId} onCMEClick={handleCMEClickFromCanvas} timelineActive={timelineActive} timelinePlaying={timelinePlaying} timelineSpeed={timelineSpeed} timelineValue={timelineScrubberValue} timelineMinDate={timelineMinDate} timelineMaxDate={timelineMaxDate} setPlanetMeshesForLabels={handleSetPlanetMeshes} setRendererDomElement={setRendererDomElement} onCameraReady={setThreeCamera} getClockElapsedTime={getClockElapsedTime} resetClock={resetClock} onScrubberChangeByAnim={handleScrubberChangeByAnim} onTimelineEnd={handleTimelineEnd} showExtraPlanets={showExtraPlanets} showMoonL1={showMoonL1} dataVersion={dataVersion} interactionMode={InteractionMode.MOVE} />
                    {showLabels && rendererDomElement && threeCamera && planetLabelInfos.filter((info: PlanetLabelInfo) => { const name = info.name.toUpperCase(); if (['MERCURY', 'VENUS', 'MARS'].includes(name)) return showExtraPlanets; if (['MOON', 'L1'].includes(name)) return showMoonL1; return true; }).map((info: PlanetLabelInfo) => (<PlanetLabel key={info.id} planetMesh={info.mesh} camera={threeCamera} rendererDomElement={rendererDomElement} label={info.name} sunMesh={sunInfo ? sunInfo.mesh : null} /> ))}
                    <div className="absolute top-0 left-0 right-0 z-40 flex items-start justify-between p-4 pointer-events-none">
                        <div className="flex items-start text-center space-x-2 pointer-events-auto">
                            <div className="flex flex-col items-center w-14 lg:hidden">
                                <button id="mobile-controls-button" onClick={() => setIsControlsOpen(true)} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Open Settings">
                                    <SettingsIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-400 mt-1">Settings</span>
                            </div>
                            <div className="flex flex-col items-center w-14">
                                <button id="reset-view-button" onClick={handleResetView} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Reset View">
                                    <CmeIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-400 mt-1 lg:hidden">Reset Camera</span>
                            </div>
                            <div className="flex flex-col items-center w-14">
                                <button id="forecast-models-button" onClick={() => setIsForecastModelsOpen(true)} className={`p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform ${highlightedElementId === 'forecast-models-button' ? 'tutorial-highlight' : ''}`} title="Official CME Forecast Models">
                                    <GlobeIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-400 mt-1 lg:hidden">Official CME Models</span>
                            </div>
                            <div className="flex flex-col items-center w-14">
                                <button id="download-image-button" onClick={handleDownloadImage} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Download Screenshot">
                                    <DownloadIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-400 mt-1 lg:hidden">Download Image</span>
                            </div>
                        </div>
                        <div className="flex items-start text-center space-x-2 pointer-events-auto">
                            <div className="flex flex-col items-center w-14 lg:hidden">
                                <button id="mobile-cme-list-button" onClick={() => setIsCmeListOpen(true)} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Open CME List">
                                    <ListIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-400 mt-1">CME List</span>
                            </div>
                        </div>
                    </div>
                    <TimelineControls isVisible={!isLoading && (cmesToRender.length > 0)} isPlaying={timelinePlaying} onPlayPause={handleTimelinePlayPause} onScrub={handleTimelineScrub} scrubberValue={timelineScrubberValue} onStepFrame={handleTimelineStep} playbackSpeed={timelineSpeed} onSetSpeed={handleTimelineSetSpeed} minDate={timelineMinDate} maxDate={timelineMaxDate} />
                </main>
                <div id="cme-list-panel-container" className={`flex-shrink-0 lg:p-5 lg:relative lg:translate-x-0 lg:w-auto lg:max-w-md fixed top-[4.25rem] right-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isCmeListOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                    <CMEListPanel cmes={filteredCmes} onSelectCME={handleSelectCMEForModeling} selectedCMEId={currentlyModeledCMEId} selectedCMEForInfo={selectedCMEForInfo} isLoading={isLoading} fetchError={fetchError} onClose={() => setIsCmeListOpen(false)} />
                </div>
                {(isControlsOpen || isCmeListOpen) && (<div className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[2004]" onClick={() => { setIsControlsOpen(false); setIsCmeListOpen(false); }} />)}
                {isLoading && <LoadingOverlay />}
                <TutorialModal isOpen={isTutorialOpen} onClose={() => setIsTutorialOpen(false)} />
                <ForecastModelsModal 
                    isOpen={isForecastModelsOpen} 
                    onClose={() => setIsForecastModelsOpen(false)} 
                    setViewerMedia={setViewerMedia} 
                    shouldPreload={false} 
                />
            </> )}
            {activePage === 'forecast' && (
                <ForecastDashboard
                    setViewerMedia={setViewerMedia}
                    setCurrentAuroraScore={setCurrentAuroraScore}
                    setSubstormActivityStatus={setSubstormActivityStatus}
                    setIpsAlertData={setIpsAlertData}
                    navigationTarget={navigationTarget}
                />
            )}
            {activePage === 'solar-activity' && (
                <SolarActivityDashboard
                    setViewerMedia={setViewerMedia}
                    setLatestXrayFlux={setLatestXrayFlux}
                    onViewCMEInVisualization={handleViewCMEInVisualization}
                    navigationTarget={navigationTarget}
                />
            )}
        </div>
        
        <MediaViewerModal media={viewerMedia} onClose={() => setViewerMedia(null)} />
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          appVersion={APP_VERSION}
          onShowTutorial={handleShowTutorial}
        />
        
        <FirstVisitTutorial
            isOpen={isFirstVisitTutorialOpen}
            onClose={handleCloseFirstVisitTutorial}
            onStepChange={handleTutorialStepChange}
        />

        <CmeModellerTutorial
            isOpen={isCmeTutorialOpen}
            onClose={handleCloseCmeTutorial}
            onStepChange={handleTutorialStepChange}
        />

        {showIabBanner && (
          <div
            className="pointer-events-auto"
            style={{
              position: 'fixed',
              left: '1rem',
              right: '1rem',
              bottom: '1rem',
              zIndex: 2147483647,
              background: '#171717',
              color: '#fff',
              border: '1px solid #2a2a2a',
              borderRadius: 14,
              boxShadow: '0 10px 30px rgba(0,0,0,.45)',
              fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
              padding: '0.9rem 1rem 1rem 1rem'
            }}
          >
            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'center', marginBottom: '.5rem' }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: '#0ea5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>SA</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, letterSpacing: '.2px' }}>Install Spot The Aurora</div>
                <div style={{ opacity: .9, fontSize: '.95rem', marginTop: '.25rem', lineHeight: 1.4 }}>
                  {isIOSIab
                    ? <>Facebook/Instagram’s in-app browser can’t install this app.<br />Tap <b>•••</b> → <b>Open in Browser</b> (Safari), then Share → <b>Add to Home Screen</b>.</>
                    : <>Facebook/Instagram’s in-app browser can’t install this app.<br />Tap <b>⋮</b> → <b>Open in Chrome</b>, then choose <b>Install app</b>.</>}
                </div>
              </div>
              <button
                aria-label="Close"
                onClick={() => setShowIabBanner(false)}
                style={{ background: 'transparent', border: 0, color: '#bbb', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); handleIabOpenInBrowser(); }}
                style={{ flex: 1, textAlign: 'center', textDecoration: 'none', background: '#fff', color: '#111', padding: '.65rem .9rem', borderRadius: 10, fontWeight: 700 }}
              >
                Open in Browser
              </a>
              <button
                onClick={handleIabCopyLink}
                style={{ flex: 1, background: '#262626', color: '#fff', border: '1px solid #333', padding: '.65rem .9rem', borderRadius: 10, fontWeight: 700 }}
              >
                Copy Link
              </button>
            </div>
          </div>
        )}
    </div>
  );
};

export default App;
// --- END OF FILE App.tsx ---