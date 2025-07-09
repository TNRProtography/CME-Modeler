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

import SettingsIcon from './components/icons/SettingsIcon';
import ListIcon from './components/icons/ListIcon';
import MoveIcon from './components/icons/MoveIcon';
import SelectIcon from './components/icons/SelectIcon';
import HomeIcon from './components/icons/HomeIcon';
import ForecastIcon from './components/icons/ForecastIcon';
import ForecastModal from './components/ForecastModal';

const App: React.FC = () => {
  // All state remains the same
  const [cmeData, setCmeData] = useState<ProcessedCME[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState<number>(0);
  
  const [activeTimeRange, setActiveTimeRange] = useState<TimeRange>(TimeRange.D3);
  const [activeView, setActiveView] = useState<ViewMode>(ViewMode.TOP);
  const [activeFocus, setActiveFocus] = useState<FocusTarget | null>(FocusTarget.EARTH);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(InteractionMode.MOVE);
  
  const [currentlyModeledCMEId, setCurrentlyModeledCMEId] = useState<string | null>(null);
  const [selectedCMEForInfo, setSelectedCMEForInfo] = useState<ProcessedCME | null>(null);

  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isCmeListOpen, setIsCmeListOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isForecastModalOpen, setIsForecastModalOpen] = useState(false);

  const [showLabels, setShowLabels] = useState(true);
  const [showExtraPlanets, setShowExtraPlanets] = useState(true);
  const [showMoonL1, setShowMoonL1] = useState(true);
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

  // --- UPDATED: useEffect to ALWAYS open the modal on load ---
  useEffect(() => {
    setIsForecastModalOpen(true);
  }, []); // The empty array ensures this runs only once when the app first renders

  // All other useEffects and functions remain the same
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
    setDataVersion(v => v + 1);

    try {
      const data = await fetchCMEData(days);
      setCmeData(data);
      if (data.length > 0) {
        const endDate = new Date();
        const futureDate = new Date();
        futureDate.setDate(endDate.getDate() + 3);
        const earliestCMEStartTime = data.reduce((min, cme) => Math.min(min, cme.startTime.getTime()), Date.now());
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
      setFetchError((err as Error).message || "Unknown error fetching data.");
      setCmeData([]);
    } finally {
      setIsLoading(false);
    }
  }, [resetClock]);

  useEffect(() => {
    loadCMEData(activeTimeRange);
  }, [activeTimeRange, loadCMEData]);

  const filteredCmes = useMemo(() => {
    if (cmeFilter === CMEFilter.ALL) return cmeData;
    return cmeData.filter(cme => cmeFilter === CMEFilter.EARTH_DIRECTED ? cme.isEarthDirected : !cme.isEarthDirected);
  }, [cmeData, cmeFilter]);

  useEffect(() => {
    if (currentlyModeledCMEId && !filteredCmes.find(c => c.id === currentlyModeledCMEId)) {
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
    setTimelinePlaying(prev => !prev);
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
      setTimelineScrubberValue(prev => Math.max(0, Math.min(1000, prev + direction * oneHourScrubberStep)));
    } else {
      setTimelineScrubberValue(prev => Math.max(0, Math.min(1000, prev + direction * 10)));
    }
    setCurrentlyModeledCMEId(null);
    setSelectedCMEForInfo(null);
  }, [filteredCmes, timelineMinDate, timelineMaxDate]);

  const handleTimelineSetSpeed = useCallback((speed: number) => setTimelineSpeed(speed), []);
  const handleScrubberChangeByAnim = useCallback((value: number) => setTimelineScrubberValue(value), []);
  const handleTimelineEnd = useCallback(() => setTimelinePlaying(false), []);
  const handleSetPlanetMeshes = useCallback((infos: PlanetLabelInfo[]) => setPlanetLabelInfos(infos), []);
  const sunInfo = planetLabelInfos.find(info => info.name === 'Sun');

  return (
    <div className="relative w-screen h-screen bg-black text-neutral-300 overflow-hidden">
      
      {isLoading && <LoadingOverlay />}

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
        .filter(info => {
            const name = info.name.toUpperCase();
            if (['MERCURY', 'VENUS', 'MARS'].includes(name)) return showExtraPlanets;
            if (['MOON', 'L1'].includes(name)) return showMoonL1;
            return true;
        })
        .map(info => (
          <PlanetLabel 
              key={info.id} 
              planetMesh={info.mesh} 
              camera={threeCamera}
              rendererDomElement={rendererDomElement}
              label={info.name} 
              sunMesh={sunInfo ? sunInfo.mesh : null}
          />
      ))}
      
      <div className="absolute top-0 left-0 right-0 bottom-0 p-0 lg:p-5 flex justify-between items-stretch pointer-events-none">
        <div className={`flex flex-col justify-between h-full pointer-events-auto lg:h-[calc(100vh-40px)] lg:relative lg:w-auto lg:max-w-xs lg:bg-transparent lg:translate-x-0 lg:z-auto fixed top-0 left-0 w-4/5 max-w-[320px] bg-neutral-950 shadow-2xl z-50 transition-transform duration-300 ease-in-out ${isControlsOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <ControlsPanel
              activeTimeRange={activeTimeRange} onTimeRangeChange={handleTimeRangeChange}
              activeView={activeView} onViewChange={handleViewChange}
              activeFocus={activeFocus} onFocusChange={handleFocusChange}
              isLoading={isLoading}
              onClose={() => setIsControlsOpen(false)}
              onOpenGuide={() => setIsTutorialOpen(true)}
              showLabels={showLabels} onShowLabelsChange={setShowLabels}
              showExtraPlanets={showExtraPlanets} onShowExtraPlanetsChange={setShowExtraPlanets}
              showMoonL1={showMoonL1} onShowMoonL1Change={setShowMoonL1}
              cmeFilter={cmeFilter} onCmeFilterChange={setCmeFilter}
          />
        </div>
        <div className={`pointer-events-auto lg:block lg:h-[calc(100vh-40px)] lg:max-h-[calc(100vh-40px)] lg:relative lg:w-auto lg:max-w-md lg:bg-transparent lg:translate-x-0 lg:z-auto fixed top-0 right-0 h-full w-4/5 max-w-[320px] bg-neutral-950 shadow-2xl z-50 transition-transform duration-300 ease-in-out ${isCmeListOpen ? 'translate-x-0' : 'translate-x-full'}`}>
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
      </div>

      <div className="fixed top-4 left-4 z-50 flex items-center space-x-2">
        <button onClick={() => setIsControlsOpen(true)} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Open Settings">
            <SettingsIcon className="w-6 h-6" />
        </button>
        <button onClick={handleResetView} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Reset View">
            <HomeIcon className="w-6 h-6" />
        </button>
      </div>

      <button 
         onClick={() => setIsForecastModalOpen(true)}
         className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-2 px-4 py-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-800/90 transition-colors"
         title="View Live Aurora Forecasts">
          <ForecastIcon className="w-5 h-5" />
          <span className="text-sm font-semibold">Live Aurora Forecast</span>
      </button>

      <div className="fixed top-4 right-4 z-50 flex items-center space-x-2">
        <button 
            onClick={() => setInteractionMode(prev => prev === InteractionMode.MOVE ? InteractionMode.SELECT : InteractionMode.MOVE)} 
            className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform"
            title={interactionMode === InteractionMode.MOVE ? 'Switch to Select Mode' : 'Switch to Move Mode'}
        >
            {interactionMode === InteractionMode.MOVE ? <SelectIcon className="w-6 h-6" /> : <MoveIcon className="w-6 h-6" />}
        </button>
        <button onClick={() => setIsCmeListOpen(true)} className="lg:hidden p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform">
            <ListIcon className="w-6 h-6" />
        </button>
      </div>

      <TimelineControls
        isVisible={!isLoading && filteredCmes.length > 0}
        isPlaying={timelinePlaying} onPlayPause={handleTimelinePlayPause}
        onScrub={handleTimelineScrub} scrubberValue={timelineScrubberValue}
        onStepFrame={handleTimelineStep}
        playbackSpeed={timelineSpeed} onSetSpeed={handleTimelineSetSpeed}
        minDate={timelineMinDate} maxDate={timelineMaxDate}
      />

      <TutorialModal isOpen={isTutorialOpen} onClose={() => setIsTutorialOpen(false)} />
      <ForecastModal isOpen={isForecastModalOpen} onClose={() => setIsForecastModalOpen(false)} />

    </div>
  );
};

export default App;