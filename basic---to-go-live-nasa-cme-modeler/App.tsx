// --- START OF FILE App.tsx ---

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import SimulationCanvas from './components/SimulationCanvas';
import ControlsPanel from './components/ControlsPanel';
import CMEListPanel from './components/CMEListPanel';
import TimelineControls from './components/TimelineControls';
import PlanetLabel from './components/PlanetLabel';
import TutorialModal from './components/TutorialModal';
import LoadingOverlay from './components/LoadingOverlay';
import MediaViewerModal from './components/MediaViewerModal';
import { fetchCMEData, fetchHSSData } from './services/nasaService';
import { ProcessedCME, ProcessedHSS, ViewMode, FocusTarget, TimeRange, PlanetLabelInfo, CMEFilter, SimulationCanvasHandle, InteractionMode, SubstormActivity, InterplanetaryShock } from './types';
import { SCENE_SCALE } from './constants';

// Icon Imports
import SettingsIcon from './components/icons/SettingsIcon';
import ListIcon from './components/icons/ListIcon';
import ForecastIcon from './components/icons/ForecastIcon';
import SunIcon from './components/icons/SunIcon';
import CmeIcon from './components/icons/CmeIcon';

// Dashboard and Banner Imports
import ForecastDashboard from './components/ForecastDashboard';
import SolarActivityDashboard from './components/SolarActivityDashboard';
import GlobalBanner from './components/GlobalBanner';
import InitialLoadingScreen from './components/InitialLoadingScreen';

// Modal Imports
import SettingsModal from './components/SettingsModal';
import FirstVisitTutorial from './components/FirstVisitTutorial';
import CmeModellerTutorial from './components/CmeModellerTutorial';
import ForecastModelsModal from './components/ForecastModelsModal';
import SolarSurferGame from './components/SolarSurferGame';
import ImpactGraphModal from './components/ImpactGraphModal';

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

interface IpsAlertData {
    shock: InterplanetaryShock;
    solarWind: {
        speed: string;
        bt: string;
        bz: string;
    };
}

interface ImpactDataPoint {
    time: number;
    speed: number;
    density: number;
}

const NAVIGATION_TUTORIAL_KEY = 'hasSeenNavigationTutorial_v1';
const CME_TUTORIAL_KEY = 'hasSeenCmeTutorial_v1';
const APP_VERSION = 'V1.0';

const App: React.FC = () => {
  const [activePage, setActivePage] = useState<'forecast' | 'modeler' | 'solar-activity'>('forecast');
  
  // Data States
  const [cmeData, setCmeData] = useState<ProcessedCME[]>([]);
  const [hssData, setHssData] = useState<ProcessedHSS[]>([]); // HSS Data
  
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState<number>(0);
  const [activeTimeRange, setActiveTimeRange] = useState<TimeRange>(TimeRange.D3);
  const [activeView, setActiveView] = useState<ViewMode>(ViewMode.TOP);
  const [activeFocus, setActiveFocus] = useState<FocusTarget | null>(FocusTarget.EARTH);
  const [currentlyModeledCMEId, setCurrentlyModeledCMEId] = useState<string | null>(null);
  const [selectedCMEForInfo, setSelectedCMEForInfo] = useState<ProcessedCME | null>(null);
  
  // UI States
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isCmeListOpen, setIsCmeListOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [viewerMedia, setViewerMedia] = useState<ViewerMedia | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFirstVisitTutorialOpen, setIsFirstVisitTutorialOpen] = useState(false);
  const [isCmeTutorialOpen, setIsCmeTutorialOpen] = useState(false);
  const [isForecastModelsModalOpen, setIsForecastModelsModalOpen] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget | null>(null);
  const [isGameOpen, setIsGameOpen] = useState(false);
  const [isImpactGraphOpen, setIsImpactGraphOpen] = useState(false);
  const [impactGraphData, setImpactGraphData] = useState<ImpactDataPoint[]>([]);

  // Visual Toggle States
  const [showLabels, setShowLabels] = useState(true);
  const [showExtraPlanets, setShowExtraPlanets] = useState(true);
  const [showMoonL1, setShowMoonL1] = useState(false);
  const [showFluxRope, setShowFluxRope] = useState(false);
  const [showHSS, setShowHSS] = useState(true);
  
  const [cmeFilter, setCmeFilter] = useState<CMEFilter>(CMEFilter.ALL);
  
  // Timeline States
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
  
  // Alert States
  const [latestXrayFlux, setLatestXrayFlux] = useState<number | null>(null);
  const [currentAuroraScore, setCurrentAuroraScore] = useState<number | null>(null);
  const [substormActivityStatus, setSubstormActivityStatus] = useState<SubstormActivity | null>(null);
  const [ipsAlertData, setIpsAlertData] = useState<IpsAlertData | null>(null);

  const [showIabBanner, setShowIabBanner] = useState(false);
  const [isIOSIab, setIsIOSIab] = useState(false);
  const [isAndroidIab, setIsAndroidIab] = useState(false);
  const deferredInstallPromptRef = useRef<any>(null);
  const CANONICAL_ORIGIN = 'https://www.spottheaurora.co.nz';

  const [isDashboardReady, setIsDashboardReady] = useState(false);
  const [isMinTimeElapsed, setIsMinTimeElapsed] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [showInitialLoader, setShowInitialLoader] = useState(true);
  const cmePageLoadedOnce = useRef(false);

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
    setTimeout(() => setIsMinTimeElapsed(true), 3500);

    const hasSeenTutorial = localStorage.getItem(NAVIGATION_TUTORIAL_KEY);
    if (!hasSeenTutorial) {
      setIsFirstVisitTutorialOpen(true);
    }
    if (!clockRef.current && (window as any).THREE) {
      clockRef.current = new (window as any).THREE.Clock();
    }
  }, []);
  
  useEffect(() => {
    if (isDashboardReady && isMinTimeElapsed) {
      setIsFadingOut(true);
      setTimeout(() => setShowInitialLoader(false), 1000);
    }
  }, [isDashboardReady, isMinTimeElapsed]);

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
      const [cmeResults, hssResults] = await Promise.all([
        fetchCMEData(days, apiKey),
        fetchHSSData() 
      ]);

      setCmeData(cmeResults);
      setHssData(hssResults);

      if (cmeResults.length > 0) {
        const endDate = new Date();
        const futureDate = new Date();
        futureDate.setDate(endDate.getDate() + 3);
        const earliestCMEStartTime = cmeResults.reduce((min: number, cme: ProcessedCME) => Math.min(min, cme.startTime.getTime()), Date.now());
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
      setHssData([]);
    } finally {
      setIsLoading(false);
    }
  }, [resetClock, apiKey]);

  useEffect(() => {
    if (activePage === 'modeler' && !cmePageLoadedOnce.current) {
        loadCMEData(activeTimeRange);
        cmePageLoadedOnce.current = true;
    }
  }, [activePage, activeTimeRange, loadCMEData]);

  const handleTimeRangeChange = (range: TimeRange) => {
      setActiveTimeRange(range);
      loadCMEData(range);
  };

  const filteredCmes = useMemo(() => { if (cmeFilter === CMEFilter.ALL) return cmeData; return cmeData.filter((cme: ProcessedCME) => cmeFilter === CMEFilter.EARTH_DIRECTED ? cme.isEarthDirected : !cme.isEarthDirected); }, [cmeData, cmeFilter]);
  
  const cmesToRender = useMemo(() => {
    if (currentlyModeledCMEId) {
      const singleCME = cmeData.find(c => c.id === currentlyModeledCMEId);
      return singleCME ? [singleCME] : [];
    }
    return filteredCmes;
  }, [currentlyModeledCMEId, cmeData, filteredCmes]);

  useEffect(() => { if (currentlyModeledCMEId && !filteredCmes.find((c: ProcessedCME) => c.id === currentlyModeledCMEId)) { setCurrentlyModeledCMEId(null); setSelectedCMEForInfo(null); } }, [filteredCmes, currentlyModeledCMEId]);
  
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

  const handleOpenGame = useCallback(() => {
    setIsGameOpen(true);
  }, []);

  const handleCloseGame = useCallback(() => {
    setIsGameOpen(false);
  }, []);


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

  const handleOpenImpactGraph = useCallback(() => {
    if (canvasRef.current) {
      const data = canvasRef.current.calculateImpactProfile();
      if (data) {
        setImpactGraphData(data);
        setIsImpactGraphOpen(true);
      }
    }
  }, []);

  const handleDownloadImage = useCallback(() => {
      const dataUrl = canvasRef.current?.captureCanvasAsDataURL();
      if (!dataUrl || !rendererDomElement || !threeCamera) return;
      
      const mainImage = new Image();
      mainImage.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = mainImage.width;
        canvas.height = mainImage.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(mainImage, 0, 0);
        
        const link = document.createElement('a');
        link.download = `spottheaurora-cme.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      }
      mainImage.src = dataUrl;
  }, [rendererDomElement, threeCamera]);

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

  const handleIpsAlertClick = useCallback(() => {
    setNavigationTarget({
        page: 'solar-activity',
        elementId: 'ips-shocks-section'
    });
  }, []);

  const handleInitialLoad = useCallback(() => {
      setIsDashboardReady(true);
  }, []);
  
  return (
    <>
      {showInitialLoader && <InitialLoadingScreen isFadingOut={isFadingOut} />}
      <div className={`w-screen h-screen bg-black flex flex-col text-neutral-300 overflow-hidden transition-opacity duration-500 ${showInitialLoader ? 'opacity-0' : 'opacity-100'}`}>
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
              <div className={`w-full h-full flex-grow min-h-0 ${activePage === 'modeler' ? 'flex' : 'hidden'}`}>
                <div id="controls-panel-container" className={`flex-shrink-0 lg:p-5 lg:w-auto lg:max-w-xs fixed top-[4.25rem] left-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isControlsOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:top-auto lg:left-auto lg:h-auto lg:transform-none`}>
                    <ControlsPanel 
                        activeTimeRange={activeTimeRange} 
                        onTimeRangeChange={handleTimeRangeChange} 
                        activeView={activeView} 
                        onViewChange={handleViewChange} 
                        activeFocus={activeFocus} 
                        onFocusChange={handleFocusChange} 
                        isLoading={isLoading} 
                        onClose={() => setIsControlsOpen(false)} 
                        onOpenGuide={() => setIsTutorialOpen(true)} 
                        showLabels={showLabels} 
                        onShowLabelsChange={setShowLabels} 
                        showExtraPlanets={showExtraPlanets} 
                        onShowExtraPlanetsChange={setShowExtraPlanets} 
                        showMoonL1={showMoonL1} 
                        onShowMoonL1Change={setShowMoonL1} 
                        cmeFilter={cmeFilter} 
                        onCmeFilterChange={setCmeFilter} 
                        showFluxRope={showFluxRope} 
                        onShowFluxRopeChange={setShowFluxRope}
                        showHSS={showHSS}
                        onShowHSSChange={setShowHSS}
                    />
                </div>

                <main id="simulation-canvas-main" className="flex-1 relative min-w-0 h-full">
                    <SimulationCanvas
                        ref={canvasRef}
                        cmeData={cmesToRender}
                        hssData={hssData} 
                        activeView={activeView}
                        focusTarget={activeFocus}
                        currentlyModeledCMEId={currentlyModeledCMEId}
                        onCMEClick={handleCMEClickFromCanvas}
                        timelineActive={timelineActive}
                        timelinePlaying={timelinePlaying}
                        timelineSpeed={timelineSpeed}
                        timelineValue={timelineScrubberValue}
                        timelineMinDate={timelineMinDate}
                        timelineMaxDate={timelineMaxDate}
                        setPlanetMeshesForLabels={handleSetPlanetMeshes}
                        setRendererDomElement={setRendererDomElement}
                        onCameraReady={setThreeCamera}
                        getClockElapsedTime={getClockElapsedTime}
                        resetClock={resetClock}
                        onScrubberChangeByAnim={handleScrubberChangeByAnim}
                        onTimelineEnd={handleTimelineEnd}
                        showExtraPlanets={showExtraPlanets}
                        showMoonL1={showMoonL1}
                        showFluxRope={showFluxRope}
                        showHSS={showHSS} 
                        dataVersion={dataVersion}
                        interactionMode={InteractionMode.MOVE}
                        onSunClick={handleOpenGame}
                    />
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
                                <button id="forecast-models-button" onClick={() => setIsForecastModelsModalOpen(true)} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Open CME Forecast Models">
                                    <GlobeIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-400 mt-1 lg:hidden">Forecast Models</span>
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
                    <TimelineControls isVisible={!isLoading && (cmesToRender.length > 0)} isPlaying={timelinePlaying} onPlayPause={handleTimelinePlayPause} onScrub={handleTimelineScrub} scrubberValue={timelineScrubberValue} onStepFrame={handleTimelineStep} playbackSpeed={timelineSpeed} onSetSpeed={handleTimelineSetSpeed} minDate={timelineMinDate} maxDate={timelineMaxDate} onOpenImpactGraph={handleOpenImpactGraph} />
                </main>

                <div id="cme-list-panel-container" className={`flex-shrink-0 lg:p-5 lg:w-auto lg:max-w-md fixed top-[4.25rem] right-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isCmeListOpen ? 'translate-x-0' : 'translate-x-full'} lg:relative lg:top-auto lg:right-auto lg:h-auto lg:transform-none`}>
                    <CMEListPanel cmes={filteredCmes} onSelectCME={handleSelectCMEForModeling} selectedCMEId={currentlyModeledCMEId} selectedCMEForInfo={selectedCMEForInfo} isLoading={isLoading} fetchError={fetchError} onClose={() => setIsCmeListOpen(false)} />
                </div>
                  
                  {(isControlsOpen || isCmeListOpen) && (<div className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[2004]" onClick={() => { setIsControlsOpen(false); setIsCmeListOpen(false); }} />)}
                  {isLoading && activePage === 'modeler' && <LoadingOverlay />}
                  <TutorialModal isOpen={isTutorialOpen} onClose={() => setIsTutorialOpen(false)} />
              </div>
              <div className={`w-full h-full ${activePage === 'forecast' ? 'block' : 'hidden'}`}>
                  <ForecastDashboard
                      setViewerMedia={setViewerMedia}
                      setCurrentAuroraScore={setCurrentAuroraScore}
                      setSubstormActivityStatus={setSubstormActivityStatus}
                      setIpsAlertData={setIpsAlertData}
                      navigationTarget={navigationTarget}
                      onInitialLoad={handleInitialLoad}
                  />
              </div>
              <div className={`w-full h-full ${activePage === 'solar-activity' ? 'block' : 'hidden'}`}>
                  <SolarActivityDashboard
                      setViewerMedia={setViewerMedia}
                      setLatestXrayFlux={setLatestXrayFlux}
                      onViewCMEInVisualization={handleViewCMEInVisualization}
                      navigationTarget={navigationTarget}
                  />
              </div>
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

          <ForecastModelsModal
              isOpen={isForecastModelsModalOpen}
              onClose={() => setIsForecastModelsModalOpen(false)}
              setViewerMedia={setViewerMedia}
          />

          <ImpactGraphModal
            isOpen={isImpactGraphOpen}
            onClose={() => setIsImpactGraphOpen(false)}
            data={impactGraphData}
          />

          {isGameOpen && <SolarSurferGame onClose={handleCloseGame} />}

          {showIabBanner && (
             <div className="pointer-events-auto" style={{ position: 'fixed', bottom: '1rem', left: '1rem', right: '1rem', background: '#171717', padding: '1rem', zIndex: 9999, borderRadius: '12px' }}>
                 <p>Install App</p>
                 <button onClick={() => setShowIabBanner(false)}>Close</button>
             </div>
          )}
      </div>
    </>
  );
};

export default App;
// --- END OF FILE App.tsx ---