// --- START OF FILE App.tsx ---

import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react'; // ADD Suspense

// Lazy load large components for code splitting
const SimulationCanvas = React.lazy(() => import('./components/SimulationCanvas'));
const ControlsPanel = React.lazy(() => import('./components/ControlsPanel'));
const CMEListPanel = React.lazy(() => import('./components/CMEListPanel'));
const TimelineControls = React.lazy(() => import('./components/TimelineControls'));
const PlanetLabel = React.lazy(() => import('./components/PlanetLabel'));
const TutorialModal = React.lazy(() => import('./components/TutorialModal'));
const ForecastModelsModal = React.lazy(() => import('./components/ForecastModelsModal'));
const ForecastDashboard = React.lazy(() => import('./components/ForecastDashboard'));
const SolarActivityDashboard = React.lazy(() => import('./components/SolarActivityDashboard'));
const SettingsModal = React.lazy(() => import('./components/SettingsModal'));
const FirstVisitTutorial = React.lazy(() => import('./components/FirstVisitTutorial'));


import LoadingOverlay from './components/LoadingOverlay'; // Keep eager for initial loading states
import MediaViewerModal from './components/MediaViewerModal'; // Keep eager for quick media viewing
import GlobalBanner from './components/GlobalBanner'; // Keep eager for immediate visibility

// Icon Imports (these are small and fine to be eagerly loaded)
import SettingsIcon from './components/icons/SettingsIcon';
import ListIcon from './components/icons/ListIcon';
import MoveIcon from './components/icons/MoveIcon';
import SelectIcon from './components/icons/SelectIcon';
import ForecastIcon from './components/icons/ForecastIcon';
import GlobeIcon from './components/icons/GlobeIcon';
import SunIcon from './components/icons/SunIcon';
import CmeIcon from './components/icons/CmeIcon';

import { fetchCMEData } from './services/nasaService';
import { ProcessedCME, ViewMode, FocusTarget, TimeRange, PlanetLabelInfo, CMEFilter, SimulationCanvasHandle, InteractionMode } from './types';

type ViewerMedia = 
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'animation', urls: string[] };

const NAVIGATION_TUTORIAL_KEY = 'hasSeenNavigationTutorial_v1';
const APP_VERSION = 'v0.3beta';

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
  const [threeCamera, setThreeCamera] = useState<any>(null); // THREE.Camera type is tricky with React state due to type inference

  const canvasRef = useRef<SimulationCanvasHandle>(null);
  const apiKey = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY';
  const [latestXrayFlux, setLatestXrayFlux] = useState<number | null>(null);
  const [currentAuroraScore, setCurrentAuroraScore] = useState<number | null>(null);
  const [substormActivityStatus, setSubstormActivityStatus] = useState<{ text: string; color: string } | null>(null);

  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem(NAVIGATION_TUTORIAL_KEY);
    if (!hasSeenTutorial) {
      setIsFirstVisitTutorialOpen(true);
    }
    // REMOVED: clockRef.current = new window.THREE.Clock(); as clock is now internal to SimulationCanvas
  }, []);
  
  const handleCloseFirstVisitTutorial = useCallback(() => {
    localStorage.setItem(NAVIGATION_TUTORIAL_KEY, 'true');
    setIsFirstVisitTutorialOpen(false);
    setHighlightedElementId(null);
  }, []);

  const handleTutorialStepChange = useCallback((id: string | null) => {
    setHighlightedElementId(id);
  }, []);

  const handleShowTutorial = useCallback(() => {
    setIsSettingsOpen(false);
    setIsFirstVisitTutorialOpen(true);
  }, []);

  // REMOVED: getClockElapsedTime and resetClock as they are now internal to SimulationCanvas

  const loadCMEData = useCallback(async (days: TimeRange) => {
    setIsLoading(true);
    setFetchError(null);
    setCurrentlyModeledCMEId(null);
    setSelectedCMEForInfo(null);
    setTimelineActive(false);
    setTimelinePlaying(false);
    setTimelineScrubberValue(0);
    // REMOVED: resetClock() here as it's now internal to SimulationCanvas
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
  }, [apiKey]);

  // Only load CME data if the 'modeler' page is active
  useEffect(() => {
    if (activePage === 'modeler') { 
        loadCMEData(activeTimeRange); 
    }
  }, [activeTimeRange, loadCMEData, activePage]);

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
    setCurrentlyModeledCMEId(cmeId);
    setIsCmeListOpen(true);
  }, []);

  return (
    <div className="w-screen h-screen bg-black flex flex-col text-neutral-300 overflow-hidden">
        <style>{`
          .tutorial-highlight {
            position: relative;
            z-index: 2003 !important;
            box-shadow: 0 0 15px 5px rgba(59, 130, 246, 0.7);
            border-color: #3b82f6 !important;
          }
        `}</style>
        
        <GlobalBanner 
            isFlareAlert={isFlareAlert} 
            flareClass={flareClass} 
            isAuroraAlert={isAuroraAlert} 
            auroraScore={currentAuroraScore ?? undefined} 
            isSubstormAlert={isSubstormAlert} 
            substormText={substormActivityStatus?.text ?? undefined}
            hideForTutorial={isFirstVisitTutorialOpen}
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
            {/* Wrap conditionally rendered pages in Suspense for code splitting */}
            <Suspense fallback={<LoadingOverlay />}> {/* ADDED Suspense fallback */}
                {activePage === 'modeler' && ( <>
                    <div id="controls-panel-container" className={`flex-shrink-0 lg:p-5 lg:relative lg:translate-x-0 lg:w-auto lg:max-w-xs fixed top-[4.25rem] left-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isControlsOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                        <ControlsPanel activeTimeRange={activeTimeRange} onTimeRangeChange={handleTimeRangeChange} activeView={activeView} onViewChange={handleViewChange} activeFocus={activeFocus} onFocusChange={handleFocusChange} isLoading={isLoading} onClose={() => setIsControlsOpen(false)} onOpenGuide={() => setIsTutorialOpen(true)} showLabels={showLabels} onShowLabelsChange={setShowLabels} showExtraPlanets={showExtraPlanets} onShowExtraPlanetsChange={setShowExtraPlanets} showMoonL1={showMoonL1} onShowMoonL1Change={setShowMoonL1} cmeFilter={cmeFilter} onCmeFilterChange={setCmeFilter} />
                    </div>
                    <main className="flex-1 relative min-w-0 h-full">
                        <SimulationCanvas 
                            ref={canvasRef} 
                            cmeData={filteredCmes} 
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
                            onScrubberChangeByAnim={handleScrubberChangeByAnim} 
                            onTimelineEnd={handleTimelineEnd} 
                            showExtraPlanets={showExtraPlanets} 
                            showMoonL1={showMoonL1} 
                            dataVersion={dataVersion} 
                            interactionMode={InteractionMode.MOVE} 
                        />
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
            </Suspense> {/* END Suspense */}
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
    </div>
  );
};

export default App;

// --- END OF FILE App.tsx ---