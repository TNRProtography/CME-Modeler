// --- START OF FILE src/App.tsx (MODIFIED) ---

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
import { ProcessedCME, ViewMode, FocusTarget, TimeRange, PlanetLabelInfo, CMEFilter, SimulationCanvasHandle, InteractionMode } from './types';

// Icon Imports
import SettingsIcon from './components/icons/SettingsIcon';
import ListIcon from './components/icons/ListIcon';
import MoveIcon from './components/icons/MoveIcon';
import SelectIcon from './components/icons/SelectIcon';
import ForecastIcon from './components/icons/ForecastIcon';
import GlobeIcon from './components/icons/GlobeIcon';
import SunIcon from './components/icons/SunIcon';
import CmeIcon from './components/icons/CmeIcon';
import ForecastModelsModal from './components/ForecastModelsModal';

// Dashboard and Banner Imports
import ForecastDashboard from './components/ForecastDashboard';
import SolarActivityDashboard from './components/SolarActivityDashboard';
import GlobalBanner from './components/GlobalBanner';

// Modal Imports
import SettingsModal from './components/SettingsModal'; // This is the global app settings modal
import FirstVisitTutorial from './components/FirstVisitTutorial'; // This is the first visit tutorial modal

type ViewerMedia = 
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'animation', urls: string[] };

const NAVIGATION_TUTORIAL_KEY = 'hasSeenNavigationTutorial_v1';
const APP_VERSION = 'v0.2beta'; // Define your app version here
const THEME_KEY = 'app_theme';

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
  const [isTutorialOpen, setIsTutorialOpen] = useState(false); // For the CME Page Guide
  const [isForecastModelsOpen, setIsForecastModelsOpen] = useState(false);
  const [viewerMedia, setViewerMedia] = useState<ViewerMedia | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFirstVisitTutorialOpen, setIsFirstVisitTutorialOpen] = useState(false); // For the First Visit Tour
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);

  const [showLabels, setShowLabels] = useState(true);
  const [showExtraPlanets, setShowExtraPlanets] = useState(true);
  const [showMoonL1, setShowMoonL1] = useState(false);
  const [cmeFilter, setCmeFilter] = useState<CMEFilter>(CMEFilter.ALL);
  const [timelineActive, setTimelineActive] = useState<boolean>(false);
  const [timelinePlaying, setTimelinePlaying] = useState<boolean>(false);
  const [timelineScrubberValue, setTimelineScrubberValue] = useState<number>(0);
  const [timelineSpeed, setTimelineSpeed] = useState<number>(1);
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
  const [substormActivityStatus, setSubstormActivityStatus] = useState<{ text: string; color: string } | null>(null);
  const [theme, setTheme] = useState<string>(localStorage.getItem(THEME_KEY) || 'default');

  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem(NAVIGATION_TUTORIAL_KEY);
    if (!hasSeenTutorial) {
      setIsFirstVisitTutorialOpen(true);
    }
    if (!clockRef.current && window.THREE) {
      clockRef.current = new window.THREE.Clock();
    }
  }, []);
  
  // Apply theme to the body class
  useEffect(() => {
      document.body.className = `theme-${theme}`;
  }, [theme]);

  const handleCloseFirstVisitTutorial = useCallback(() => {
    localStorage.setItem(NAVIGATION_TUTORIAL_KEY, 'true');
    setIsFirstVisitTutorialOpen(false);
    setHighlightedElementId(null);
  }, []);

  const handleTutorialStepChange = useCallback((id: string | null) => {
    setHighlightedElementId(id);
  }, []);

  // NEW: Handler for the "Show Tutorial" button in settings
  const handleShowTutorial = useCallback(() => {
    setIsSettingsOpen(false); // Close the settings modal
    setIsFirstVisitTutorialOpen(true); // Open the tutorial modal
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
  useEffect(() => { if (currentlyModeledCMEId && !filteredCmes.find((c: ProcessedCME) => c.id === currentlyModeledCMEId)) { setCurrentlyModeledCMEId(null); setSelectedCMEForInfo(null); } }, [filteredCmes, currentlyModeledCMEId]);
  const handleTimeRangeChange = (range: TimeRange) => setActiveTimeRange(range);
  const handleViewChange = (view: ViewMode) => setActiveView(view);
  const handleFocusChange = (target: FocusTarget) => setActiveFocus(target);
  const handleResetView = useCallback(() => { setActiveView(ViewMode.TOP); setActiveFocus(FocusTarget.EARTH); canvasRef.current?.resetView(); }, []);
  const handleSelectCMEForModeling = useCallback((cme: ProcessedCME | null) => { setCurrentlyModeledCMEId(cme ? cme.id : null); setSelectedCMEForInfo(cme); if (cme) { setTimelineActive(false); setTimelinePlaying(false); } setIsCmeListOpen(false); }, []);
  const handleCMEClickFromCanvas = useCallback((cme: ProcessedCME) => { setCurrentlyModeledCMEId(cme.id); setSelectedCMEForInfo(cme); setTimelineActive(false); setTimelinePlaying(false); setIsCmeListOpen(true); }, []);
  const handleTimelinePlayPause = useCallback(() => { if (filteredCmes.length === 0) return; setTimelineActive(true); setTimelinePlaying((prev: boolean) => !prev); setCurrentlyModeledCMEId(null); setSelectedCMEForInfo(null); }, [filteredCmes]);
  const handleTimelineScrub = useCallback((value: number) => { if (filteredCmes.length === 0) return; setTimelineActive(true); setTimelinePlaying(false); setTimelineScrubberValue(value); setCurrentlyModeledCMEId(null); setSelectedCMEForInfo(null); }, [filteredCmes]);
  const handleTimelineStep = useCallback((direction: -1 | 1) => { if (filteredCmes.length === 0) return; setTimelineActive(true); setTimelinePlaying(false); const timeRange = timelineMaxDate - timelineMinDate; if (timeRange > 0) { const oneHourInMillis = 3600_000; const oneHourScrubberStep = (oneHourInMillis / timeRange) * 1000; setTimelineScrubberValue((prev: number) => Math.max(0, Math.min(1000, prev + direction * oneHourScrubberStep))); } else { setTimelineScrubberValue((prev: number) => Math.max(0, Math.min(1000, prev + direction * 10))); } setCurrentlyModeledCMEId(null); setSelectedCMEForInfo(null); }, [filteredCmes, timelineMinDate, timelineMaxDate]);
  const handleTimelineSetSpeed = useCallback((speed: number) => setTimelineSpeed(speed), []);
  const handleScrubberChangeByAnim = useCallback((value: number) => setTimelineScrubberValue(value), []);
  const handleTimelineEnd = useCallback(() => setTimelinePlaying(false), []);
  const handleSetPlanetMeshes = useCallback((infos: PlanetLabelInfo[]) => setPlanetLabelInfos(infos), []);
  const sunInfo = planetLabelInfos.find((info: PlanetLabelInfo) => info.name === 'Sun');
  const isFlareAlert = useMemo(() => latestXrayFlux !== null && latestXrayFlux >= 1e-5, [latestXrayFlux]);
  const flareClass = useMemo(() => { if (latestXrayFlux === null) return undefined; if (latestXrayFlux >= 1e-4) return `X${(latestXrayFlux / 1e-4).toFixed(1)}`; if (latestXrayFlux >= 1e-5) return `M${(latestXrayFlux / 1e-5).toFixed(1)}`; return undefined; }, [latestXrayFlux]);
  const isAuroraAlert = useMemo(() => currentAuroraScore !== null && currentAuroraScore >= 50, [currentAuroraScore]);
  const isSubstormAlert = useMemo(() => substormActivityStatus !== null && substormActivityStatus.text.includes('stretching') && !substormActivityStatus.text.includes('substorm signature detected'), [substormActivityStatus]);

  const handleViewCMEInVisualization = useCallback((cmeId: string) => {
    setActivePage('modeler');
    setCurrentlyModeledCmeId(cmeId);
    setIsCmeListOpen(true);
  }, []);

  return (
    // Apply the theme class to the root div or body
    <div className={`w-screen h-screen bg-black flex flex-col text-neutral-300 overflow-hidden theme-${theme}`}>
        <style>{`
          .tutorial-highlight {
            position: relative;
            z-index: 2003 !important; /* Increased z-index to be above banners */
            box-shadow: 0 0 15px 5px rgba(59, 130, 246, 0.7);
            border-color: #3b82f6 !important;
          }
          /* Theme-specific styles, defined globally */
          body.theme-default {
              /* Defaults already largely covered by Tailwind. */
          }
          body.theme-light .bg-black { background-color: #f0f0f0; }
          body.theme-light .text-neutral-300 { color: #333333; }
          body.theme-light .bg-neutral-900\\/80 { background-color: rgba(240, 240, 240, 0.8); }
          body.theme-light .border-neutral-700\\/60 { border-color: rgba(200, 200, 200, 0.6); }
          body.theme-light .bg-neutral-800\\/80 { background-color: rgba(220, 220, 220, 0.8); }
          body.theme-light .hover\\:bg-neutral-700\\/90:hover { background-color: rgba(200, 200, 200, 0.9); }
          body.theme-light .bg-neutral-950\\/80 { background-color: rgba(250, 250, 250, 0.8); }
          body.theme-light .bg-neutral-900\\/70 { background-color: rgba(245, 245, 245, 0.7); }
          body.theme-light .border-neutral-700\\/80 { border-color: rgba(200, 200, 200, 0.8); }
          body.theme-light .text-neutral-400 { color: #666666; }
          body.theme-light .text-neutral-500 { color: #888888; }
          body.theme-light .text-neutral-100 { color: #111111; }
          body.theme-light .card { background-color: rgba(255, 255, 255, 0.9); border-color: rgba(200, 200, 200, 0.9); }
          body.theme-light .styled-scrollbar::-webkit-scrollbar-track { background: #e0e0e0; }
          body.theme-light .styled-scrollbar::-webkit-scrollbar-thumb { background: #a0a0a0; }
          body.theme-light .leaflet-container { background-color: #f0f0f0 !important; }
          body.theme-light .leaflet-popup-content-wrapper, body.theme-light .leaflet-popup-tip { background: #ffffff; color: #333333; box-shadow: 0 3px 14px rgba(0,0,0,0.2); }
          body.theme-light input, body.theme-light button.bg-neutral-800, body.theme-light .bg-neutral-800\\/50 { background-color: rgba(230, 230, 230, 0.8); }
          body.theme-light .border-neutral-600 { border-color: #cccccc; }
          body.theme-light .hover\\:bg-neutral-700\\/60:hover { background-color: rgba(210, 210, 210, 0.6); }

          body.theme-high-contrast {
              /* Darker backgrounds, brighter text */
              background-color: #000000;
              color: #ffffff;
          }
          body.theme-high-contrast .bg-neutral-900\/80 { background-color: rgba(10, 10, 10, 0.9); }
          body.theme-high-contrast .border-neutral-700\/60 { border-color: rgba(50, 50, 50, 0.8); }
          body.theme-high-contrast .bg-neutral-800\/80 { background-color: rgba(20, 20, 20, 0.9); }
          body.theme-high-contrast .hover\:bg-neutral-700\/90:hover { background-color: rgba(40, 40, 40, 0.9); }
          body.theme-high-contrast .bg-neutral-950\/80 { background-color: rgba(0, 0, 0, 0.95); }
          body.theme-high-contrast .bg-neutral-900\/70 { background-color: rgba(15, 15, 15, 0.8); }
          body.theme-high-contrast .border-neutral-700\/80 { border-color: rgba(60, 60, 60, 0.8); }
          body.theme-high-contrast .text-neutral-300 { color: #f0f0f0; }
          body.theme-high-contrast .text-neutral-400 { color: #aaaaaa; }
          body.theme-high-contrast .text-neutral-500 { color: #888888; }
          body.theme-high-contrast .text-neutral-100 { color: #ffffff; }
          body.theme-high-contrast .card { background-color: rgba(0, 0, 0, 0.98); border-color: rgba(50, 50, 50, 0.9); }
          body.theme-high-contrast .styled-scrollbar::-webkit-scrollbar-track { background: #1a1a1a; }
          body.theme-high-contrast .styled-scrollbar::-webkit-scrollbar-thumb { background: #666666; }
          body.theme-high-contrast .leaflet-container { background-color: #111111 !important; }
          body.theme-high-contrast .leaflet-popup-content-wrapper, body.theme-high-contrast .leaflet-popup-tip { background: #222222; color: #ffffff; box-shadow: 0 3px 14px rgba(0,0,0,0.6); }
          body.theme-high-contrast input, body.theme-high-contrast button.bg-neutral-800, body.theme-high-contrast .bg-neutral-800\/50 { background-color: rgba(30, 30, 30, 0.8); }
          body.theme-high-contrast .border-neutral-600 { border-color: #888888; }
          body.theme-high-contrast .hover\:bg-neutral-700\/60:hover { background-color: rgba(50, 50, 50, 0.6); }

        `}</style>
        
        <GlobalBanner 
            isFlareAlert={isFlareAlert} 
            flareClass={flareClass} 
            isAuroraAlert={isAuroraAlert} 
            auroraScore={currentAuroraScore ?? undefined} 
            isSubstormAlert={isSubstormAlert} 
            substormText={substormActivityStatus?.text ?? undefined}
            hideForTutorial={isFirstVisitTutorialOpen} // Hide banners during first-time tutorial
        />

        <header className="flex-shrink-0 p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-center items-center gap-4 relative z-[2001]">
            <div className="flex items-center space-x-2">
                <button 
                id="nav-forecast" onClick={() => setActivePage('forecast')}
                className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-lg text-neutral-200 shadow-lg transition-all
                            ${activePage === 'forecast' ? 'bg-sky-500/30 border border-sky-400' : 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90'}
                            ${highlightedElementId === 'nav-forecast' ? 'tutorial-highlight' : ''}`}
                title="View Live Aurora Forecasts">
                    <ForecastIcon className="w-5 h-5" />
                    <span className="text-sm font-semibold hidden md:inline">Aurora Forecast</span>
                </button>
                <button 
                id="nav-solar-activity" onClick={() => setActivePage('solar-activity')} 
                className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-lg text-neutral-200 shadow-lg transition-all
                            ${activePage === 'solar-activity' ? 'bg-amber-500/30 border border-amber-400' : 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90'}
                            ${highlightedElementId === 'nav-solar-activity' ? 'tutorial-highlight' : ''}`}
                title="View Solar Activity">
                    <SunIcon className="w-5 h-5" />
                    <span className="text-sm font-semibold hidden md:inline">Solar Activity</span>
                </button>
                 <button 
                id="nav-modeler" onClick={() => setActivePage('modeler')}
                className={`flex items-center justify-center space-x-2 px-4 py-2 rounded-lg text-neutral-200 shadow-lg transition-all
                            ${activePage === 'modeler' ? 'bg-indigo-500/30 border border-indigo-400' : 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90'}
                            ${highlightedElementId === 'nav-modeler' ? 'tutorial-highlight' : ''}`}
                title="View CME Visualization">
                    <CmeIcon className="w-5 h-5" />
                    <span className="text-sm font-semibold hidden md:inline">CME Visualization</span>
                </button>
            </div>
            <div className="flex-grow flex justify-end">
                <button 
                    id="nav-settings" onClick={() => setIsSettingsOpen(true)}
                    className={`p-2 bg-neutral-800/80 border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg transition-all hover:bg-neutral-700/90
                               ${highlightedElementId === 'nav-settings' ? 'tutorial-highlight' : ''}`}
                    title="Open Settings">
                    <SettingsIcon className="w-6 h-6" />
                </button>
            </div>
        </header>

        <div className="flex flex-grow min-h-0">
            {activePage === 'modeler' && ( <>
                <div id="controls-panel-container" className={`flex-shrink-0 lg:p-5 lg:relative lg:translate-x-0 lg:w-auto lg:max-w-xs fixed top-[4.25rem] left-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isControlsOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                    <ControlsPanel activeTimeRange={activeTimeRange} onTimeRangeChange={handleTimeRangeChange} activeView={activeView} onViewChange={handleViewChange} activeFocus={activeFocus} onFocusChange={handleFocusChange} isLoading={isLoading} onClose={() => setIsControlsOpen(false)} onOpenGuide={() => setIsTutorialOpen(true)} showLabels={showLabels} onShowLabelsChange={setShowLabels} showExtraPlanets={showExtraPlanets} onShowExtraPlanetsChange={setShowExtraPlanets} showMoonL1={showMoonL1} onShowMoonL1Change={setShowMoonL1} cmeFilter={cmeFilter} onCmeFilterChange={setCmeFilter} />
                </div>
                <main className="flex-1 relative min-w-0 h-full">
                    <SimulationCanvas ref={canvasRef} cmeData={filteredCmes} activeView={activeView} focusTarget={activeFocus} currentlyModeledCMEId={currentlyModeledCmeId} onCMEClick={handleCMEClickFromCanvas} timelineActive={timelineActive} timelinePlaying={timelinePlaying} timelineSpeed={timelineSpeed} timelineValue={timelineScrubberValue} timelineMinDate={timelineMinDate} timelineMaxDate={timelineMaxDate} setPlanetMeshesForLabels={handleSetPlanetMeshes} setRendererDomElement={setRendererDomElement} onCameraReady={setThreeCamera} getClockElapsedTime={getClockElapsedTime} resetClock={resetClock} onScrubberChangeByAnim={handleScrubberChangeByAnim} onTimelineEnd={handleTimelineEnd} showExtraPlanets={showExtraPlanets} showMoonL1={showMoonL1} dataVersion={dataVersion} interactionMode={InteractionMode.MOVE} />
                    {showLabels && rendererDomElement && threeCamera && planetLabelInfos.filter((info: PlanetLabelInfo) => { const name = info.name.toUpperCase(); if (['MERCURY', 'VENUS', 'MARS'].includes(name)) return showExtraPlanets; if (['MOON', 'L1'].includes(name)) return showMoonL1; return true; }).map((info: PlanetLabelInfo) => (<PlanetLabel key={info.id} planetMesh={info.mesh} camera={threeCamera} rendererDomElement={rendererDomElement} label={info.name} sunMesh={sunInfo ? sunInfo.mesh : null} /> ))}
                    <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between p-4 pointer-events-none">
                        <div className="flex items-center space-x-2 pointer-events-auto">
                            <button id="mobile-controls-button" onClick={() => setIsControlsOpen(true)} className="lg:hidden p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Open Settings"><SettingsIcon className="w-6 h-6" /></button>
                            <button id="reset-view-button" onClick={handleResetView} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Reset View"><CmeIcon className="w-6 h-6" /></button>
                            <button id="forecast-models-button" onClick={() => setIsForecastModelsOpen(true)} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Other CME Forecast Models"><GlobeIcon className="w-6 h-6" /></button>
                        </div>
                        <div className="flex items-center space-x-2 pointer-events-auto">
                            <button id="mobile-cme-list-button" onClick={() => setIsCmeListOpen(true)} className="lg:hidden p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform"><ListIcon className="w-6 h-6" /></button>
                        </div>
                    </div>
                    <TimelineControls isVisible={!isLoading && filteredCmes.length > 0} isPlaying={timelinePlaying} onPlayPause={handleTimelinePlayPause} onScrub={handleTimelineScrub} scrubberValue={timelineScrubberValue} onStepFrame={handleTimelineStep} playbackSpeed={timelineSpeed} onSetSpeed={handleTimelineSetSpeed} minDate={timelineMinDate} maxDate={timelineMaxDate} />
                </main>
                <div id="cme-list-panel-container" className={`flex-shrink-0 lg:p-5 lg:relative lg:translate-x-0 lg:w-auto lg:max-w-md fixed top-[4.25rem] right-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isCmeListOpen ? 'translate-x-0' : 'translate-x-full'}`}>
                    <CMEListPanel cmes={filteredCmes} onSelectCME={handleSelectCMEForModeling} selectedCMEId={currentlyModeledCMEId} selectedCMEForInfo={selectedCMEForInfo} isLoading={isLoading} fetchError={fetchError} onClose={() => setIsCmeListOpen(false)} />
                </div>
                {(isControlsOpen || isCmeListOpen) && (<div className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[2004]" onClick={() => { setIsControlsOpen(false); setIsCmeListOpen(false); }} />)}
                {isLoading && <LoadingOverlay />}
                <TutorialModal isOpen={isTutorialOpen} onClose={() => setIsTutorialOpen(false)} />
                <ForecastModelsModal isOpen={isForecastModelsOpen} onClose={() => setIsForecastModelsOpen(false)} setViewerMedia={setViewerMedia} />
            </> )}
            {activePage === 'forecast' && (<ForecastDashboard setViewerMedia={setViewerMedia} setCurrentAuroraScore={setCurrentAuroraScore} setSubstormActivityStatus={setSubstormActivityStatus} />)}
            {activePage === 'solar-activity' && (
                <SolarActivityDashboard 
                    setViewerMedia={setViewerMedia} 
                    apiKey={apiKey} 
                    setLatestXrayFlux={setLatestXrayFlux} 
                    onViewCMEInVisualization={handleViewCMEInVisualization}
                />
            )}
        </div>
        
        <MediaViewerModal media={viewerMedia} onClose={() => setViewerMedia(null)} />
        <SettingsModal 
          isOpen={isSettingsOpen} 
          onClose={() => setIsSettingsOpen(false)} 
          appVersion={APP_VERSION} 
          onShowTutorial={handleShowTutorial}
          currentTheme={theme}
          onThemeChange={setTheme}
        /> 
        
        <FirstVisitTutorial
            isOpen={isFirstVisitTutorialOpen}
            onClose={handleCloseFirstVisitTutorial}
            onStepChange={handleTutorialStepChange}
        />
    </div>
  );
};

export default App;

// --- END OF FILE src/App.tsx (MODIFIED) ---