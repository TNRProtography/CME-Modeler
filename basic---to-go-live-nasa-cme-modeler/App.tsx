import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import SimulationCanvas from './components/SimulationCanvas';
import ControlsPanel from './components/ControlsPanel';
import CMEListPanel from './components/CMEListPanel';
import TimelineControls from './components/TimelineControls';
import PlanetLabel from './components/PlanetLabel';
import TutorialModal from './components/TutorialModal';
import LoadingOverlay from './components/LoadingOverlay';
import { fetchCMEData } from './services/nasaService';
import { ProcessedCME, ViewMode, FocusTarget, TimeRange, PlanetLabelInfo, CMEFilter, InteractionMode, SimulationCanvasHandle } from './types';

// Icon and Page Imports
import SettingsIcon from './components/icons/SettingsIcon';
import ListIcon from './components/icons/ListIcon';
import MoveIcon from './components/icons/MoveIcon';
import SelectIcon from './components/icons/SelectIcon';
import HomeIcon from './components/icons/HomeIcon';
import ForecastIcon from './components/icons/ForecastIcon';
import FlareIcon from './components/icons/FlareIcon';
import ForecastModal from './components/ForecastModal';
import SolarActivityPage from './components/SolarActivityPage';
import ForecastModelsModal from './components/ForecastModelsModal'; // NEW: Import the new modal

const App: React.FC = () => {
  // Page and data state
  const [activePage, setActivePage] = useState<'forecast' | 'modeler' | 'solar-activity'>('forecast');
  const [cmeData, setCmeData] = useState<ProcessedCME[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState<number>(0);
  
  // Simulation controls state
  const [activeTimeRange, setActiveTimeRange] = useState<TimeRange>(TimeRange.D3);
  const [activeView, setActiveView] = useState<ViewMode>(ViewMode.TOP);
  const [activeFocus, setActiveFocus] = useState<FocusTarget | null>(FocusTarget.EARTH);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(InteractionMode.MOVE);
  
  // CME-specific state
  const [currentlyModeledCMEId, setCurrentlyModeledCMEId] = useState<string | null>(null);
  const [selectedCMEForInfo, setSelectedCMEForInfo] = useState<ProcessedCME | null>(null);

  // UI visibility state
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isCmeListOpen, setIsCmeListOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isForecastModelsOpen, setIsForecastModelsOpen] = useState(false); // NEW: State for the forecast models modal

  // Display options state
  const [showLabels, setShowLabels] = useState(true);
  const [showExtraPlanets, setShowExtraPlanets] = useState(true);
  const [showMoonL1, setShowMoonL1] = useState(false);
  const [cmeFilter, setCmeFilter] = useState<CMEFilter>(CMEFilter.ALL);

  // Timeline state
  const [timelineActive, setTimelineActive] = useState<boolean>(false);
  const [timelinePlaying, setTimelinePlaying] = useState<boolean>(false);
  const [timelineScrubberValue, setTimelineScrubberValue] = useState<number>(0);
  const [timelineSpeed, setTimelineSpeed] = useState<number>(1);
  const [timelineMinDate, setTimelineMinDate] = useState<number>(0);
  const [timelineMaxDate, setTimelineMaxDate] = useState<number>(0);

  // Three.js related state
  const [planetLabelInfos, setPlanetLabelInfos] = useState<PlanetLabelInfo[]>([]);
  const [rendererDomElement, setRendererDomElement] = useState<HTMLCanvasElement | null>(null);
  const [threeCamera, setThreeCamera] = useState<any>(null);

  // Refs
  const clockRef = useRef<any>(null);
  const canvasRef = useRef<SimulationCanvasHandle>(null);

  // API Key
  const apiKey = import.meta.env.VITE_NASA_API_KEY || '';
  
  useEffect(() => {
    if (!clockRef.current && window.THREE) {
        clockRef.current = new window.THREE.Clock();
    }
  }, []);

  const getClockElapsedTime = useCallback(() => {
    return clockRef.current ? clockRef.current.getElapsedTime() : 0;
  }, []);
  
  const resetClock = useCallback(() => {
    if (clockRef.current) {
        clockRef.current.stop();
        clockRef.current.start();
    }
  }, []);

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

  useEffect(() => {
    if (activePage === 'modeler') {
      loadCMEData(activeTimeRange);
    }
  }, [activeTimeRange, loadCMEData, activePage]);

  const filteredCmes = useMemo(() => {
    if (cmeFilter === CMEFilter.ALL) return cmeData;
    return cmeData.filter((cme: ProcessedCME) => cmeFilter === CMEFilter.EARTH_DIRECTED ? cme.isEarthDirected : !cme.isEarthDirected);
  }, [cmeData, cmeFilter]);

  useEffect(() => {
    if (currentlyModeledCMEId && !filteredCmes.find((c: ProcessedCME) => c.id === currentlyModeledCMEId)) {
      setCurrentlyModeledCMEId(null);
      setSelectedCMEForInfo(null);
    }
  }, [filteredCmes, currentlyModeledCMEId]);

  const handleTimeRangeChange = (range: TimeRange) => setActiveTimeRange(range);
  const handleViewChange = (view: ViewMode) => setActiveView(view);
  const handleFocusChange = (target: FocusTarget) => setActiveFocus(target);

  const handleResetView = useCallback(() => {
    setActiveView(ViewMode.TOP);
    setActiveFocus(FocusTarget.EARTH);
    canvasRef.current?.resetView();
  }, []);

  const handleSelectCMEForModeling = useCallback((cme: ProcessedCME | null) => {
    setCurrentlyModeledCMEId(cme ? cme.id : null);
    setSelectedCMEForInfo(cme);
    if (cme) {
        setTimelineActive(false);
        setTimelinePlaying(false);
    } else {
        setInteractionMode(InteractionMode.MOVE);
    }
    setIsCmeListOpen(false);
  }, []);

  const handleCMEClickFromCanvas = useCallback((cme: ProcessedCME) => {
    setCurrentlyModeledCMEId(cme.id);
    setSelectedCMEForInfo(cme);
    setTimelineActive(false);
    setTimelinePlaying(false);
    setIsCmeListOpen(true); 
  }, []);

  const handleTimelinePlayPause = useCallback(() => {
    if (filteredCmes.length === 0) return;
    setTimelineActive(true);
    setTimelinePlaying((prev: boolean) => !prev);
    setCurrentlyModeledCMEId(null);
    setSelectedCMEForInfo(null);
  }, [filteredCmes]);

  const handleTimelineScrub = useCallback((value: number) => {
    if (filteredCmes.length === 0) return;
    setTimelineActive(true);
    setTimelinePlaying(false);
    setTimelineScrubberValue(value);
    setCurrentlyModeledCMEId(null);
    setSelectedCMEForInfo(null);
  }, [filteredCmes]);

  const handleTimelineStep = useCallback((direction: -1 | 1) => {
    if (filteredCmes.length === 0) return;
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
    setCurrentlyModeledCMEId(null);
    setSelectedCMEForInfo(null);
  }, [filteredCmes, timelineMinDate, timelineMaxDate]);

  const handleTimelineSetSpeed = useCallback((speed: number) => setTimelineSpeed(speed), []);
  const handleScrubberChangeByAnim = useCallback((value: number) => setTimelineScrubberValue(value), []);
  const handleTimelineEnd = useCallback(() => setTimelinePlaying(false), []);
  const handleSetPlanetMeshes = useCallback((infos: PlanetLabelInfo[]) => setPlanetLabelInfos(infos), []);
  const sunInfo = planetLabelInfos.find((info: PlanetLabelInfo) => info.name === 'Sun');

  return (
    <div className="w-screen h-screen bg-black flex flex-col text-neutral-300 overflow-hidden">
        {/* Unified Header Bar for Navigation */}
        <header className="flex-shrink-0 p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-center items-center gap-4">
            <div className="flex items-center space-x-2">
                <button 
                onClick={() => setActivePage('forecast')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-neutral-200 shadow-lg transition-colors
                            ${activePage === 'forecast' 
                                ? 'bg-sky-500/30 border border-sky-400' 
                                : 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90'}`}
                title="View Live Aurora Forecasts">
                    <ForecastIcon className="w-5 h-5" />
                    <span className="text-sm font-semibold hidden md:inline">Aurora Forecast</span>
                </button>
                <button 
                onClick={() => setActivePage('solar-activity')} 
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-neutral-200 shadow-lg transition-colors
                            ${activePage === 'solar-activity' 
                                ? 'bg-amber-500/30 border border-amber-400' 
                                : 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90'}`}
                title="View Solar Activity">
                    <FlareIcon className="w-5 h-5" />
                    <span className="text-sm font-semibold hidden md:inline">Solar Activity</span>
                </button>
                 <button 
                onClick={() => setActivePage('modeler')}
                className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-neutral-200 shadow-lg transition-colors
                            ${activePage === 'modeler' 
                                ? 'bg-indigo-500/30 border border-indigo-400' 
                                : 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90'}`}
                title="View CME Modeler">
                    <HomeIcon className="w-5 h-5" />
                    <span className="text-sm font-semibold hidden md:inline">CME Modeler</span>
                </button>
            </div>
        </header>

        {/* Main Content Area */}
        <div className="flex flex-grow min-h-0">
            {/* Conditional Rendering for Main Content */}
            {activePage === 'modeler' && (
                <>
                    <div className={`
                        flex-shrink-0 lg:p-5
                        lg:relative lg:translate-x-0 lg:w-auto lg:max-w-xs
                        fixed top-0 left-0 h-full w-4/5 max-w-[320px] z-50 
                        transition-transform duration-300 ease-in-out
                        ${isControlsOpen ? 'translate-x-0' : '-translate-x-full'}
                    `}>
                        <ControlsPanel
                            activeTimeRange={activeTimeRange} onTimeRangeChange={handleTimeRangeChange}
                            activeView={activeView} onViewChange={handleViewChange}
                            activeFocus={activeFocus} onFocusChange={handleFocusChange}
                            isLoading={isLoading}
                            onClose={() => setIsControlsOpen(false)}
                            onOpenGuide={() => setIsTutorialOpen(true)}
                            onOpenForecastModels={() => setIsForecastModelsOpen(true)} // Pass handler to open modal
                            showLabels={showLabels} onShowLabelsChange={setShowLabels}
                            showExtraPlanets={showExtraPlanets} onShowExtraPlanetsChange={setShowExtraPlanets}
                            showMoonL1={showMoonL1} onShowMoonL1Change={setShowMoonL1}
                            cmeFilter={cmeFilter} onCmeFilterChange={setCmeFilter}
                        />
                    </div>

                    <main className="flex-1 relative min-w-0 h-full">
                        <SimulationCanvas
                        ref={canvasRef}
                        cmeData={filteredCmes}
                        activeView={activeView}
                        focusTarget={activeFocus}
                        currentlyModeledCmeId={currentlyModeledCMEId}
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
                        dataVersion={dataVersion}
                        interactionMode={interactionMode}
                        />

                        {showLabels && rendererDomElement && threeCamera && planetLabelInfos
                        .filter((info: PlanetLabelInfo) => {
                            const name = info.name.toUpperCase();
                            if (['MERCURY', 'VENUS', 'MARS'].includes(name)) return showExtraPlanets; 
                            if (['MOON', 'L1'].includes(name)) return showMoonL1;
                            return true;
                        })
                        .map((info: PlanetLabelInfo) => (
                            <PlanetLabel 
                                key={info.id} 
                                planetMesh={info.mesh} 
                                camera={threeCamera}
                                rendererDomElement={rendererDomElement}
                                label={info.name} 
                                sunMesh={sunInfo ? sunInfo.mesh : null}
                            />
                        ))}
                        
                        {/* Floating UI Controls Over Canvas */}
                        <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between p-4 pointer-events-none">
                            <div className="flex items-center space-x-2 pointer-events-auto">
                                <button onClick={() => setIsControlsOpen(true)} className="lg:hidden p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Open Settings">
                                    <SettingsIcon className="w-6 h-6" />
                                </button>
                                <button onClick={handleResetView} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Reset View">
                                    <HomeIcon className="w-6 h-6" />
                                </button>
                            </div>
                            <div className="flex items-center space-x-2 pointer-events-auto">
                                <button 
                                    onClick={() => setInteractionMode((prev: InteractionMode) => prev === InteractionMode.MOVE ? InteractionMode.SELECT : InteractionMode.MOVE)} 
                                    className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform"
                                    title={interactionMode === InteractionMode.MOVE ? 'Switch to Select Mode' : 'Switch to Move Mode'}
                                >
                                    {interactionMode === InteractionMode.MOVE ? <SelectIcon className="w-6 h-6" /> : <MoveIcon className="w-6 h-6" />}
                                </button>
                                <button onClick={() => setIsCmeListOpen(true)} className="lg:hidden p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform">
                                    <ListIcon className="w-6 h-6" />
                                </button>
                            </div>
                        </div>

                        <TimelineControls
                        isVisible={!isLoading && filteredCmes.length > 0}
                        isPlaying={timelinePlaying} onPlayPause={handleTimelinePlayPause}
                        onScrub={handleTimelineScrub} scrubberValue={timelineScrubberValue}
                        onStepFrame={handleTimelineStep}
                        playbackSpeed={timelineSpeed} onSetSpeed={handleTimelineSetSpeed}
                        minDate={timelineMinDate} maxDate={timelineMaxDate}
                        />
                    </main>

                    <div className={`
                        flex-shrink-0 lg:p-5
                        lg:relative lg:translate-x-0 lg:w-auto lg:max-w-md
                        fixed top-0 right-0 h-full w-4/5 max-w-[320px] z-50 
                        transition-transform duration-300 ease-in-out
                        ${isCmeListOpen ? 'translate-x-0' : 'translate-x-full'}
                    `}>
                        <CMEListPanel
                            cmes={filteredCmes} onSelectCME={handleSelectCMEForModeling}
                            selectedCMEId={currentlyModeledCMEId} selectedCMEForInfo={selectedCMEForInfo}
                            isLoading={isLoading} fetchError={fetchError}
                            onClose={() => setIsCmeListOpen(false)}
                        />
                    </div>
                    
                    {(isControlsOpen || isCmeListOpen) && (
                        <div 
                            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                            onClick={() => { setIsControlsOpen(false); setIsCmeListOpen(false); }}
                        />
                    )}

                    {isLoading && <LoadingOverlay />}
                    <TutorialModal isOpen={isTutorialOpen} onClose={() => setIsTutorialOpen(false)} />
                    {/* Render the new modal */}
                    <ForecastModelsModal isOpen={isForecastModelsOpen} onClose={() => setIsForecastModelsOpen(false)} />
                </>
            )}

            {activePage === 'forecast' && (
                <iframe
                    src="/forecast.html"
                    title="Live West Coast Aurora Forecast by TNR Protography"
                    className="w-full h-full border-none"
                />
            )}

            {activePage === 'solar-activity' && (
                <iframe
                    src="/solar-activity.html"
                    title="Solar Activity Dashboard"
                    className="w-full h-full border-none"
                />
            )}
        </div>
    </div>
  );
};

export default App;