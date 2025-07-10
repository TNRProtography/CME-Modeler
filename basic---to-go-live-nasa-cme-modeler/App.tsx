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
import FlareIcon from './components/icons/FlareIcon';
import ForecastModal from './components/ForecastModal';
import SolarFlaresPage from './components/SolarFlaresPage';

const App: React.FC = () => {
  // --- A single state to manage the current view ---
  const [activePage, setActivePage] = useState<'forecast' | 'flares' | 'modeler'>('forecast');
  
  // All other state declarations are the same...
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
      if (err instanceof Error && err.message.includes('429')) {
        setFetchError('NASA API rate limit exceeded. Please wait a moment and try again.');
      } else {
        setFetchError((err as Error).message || "Unknown error fetching data.");
      }
      setCmeData([]);
    } finally {
      setIsLoading(false);
    }
  }, [resetClock]);

  useEffect(() => {
    if (activePage === 'modeler') {
      loadCMEData(activeTimeRange);
    }
  }, [activeTimeRange, loadCMEData, activePage]);

  // ... (the rest of the component functions are the same)
  
  // --- This is the main render logic based on the activePage state ---
  if (activePage === 'flares') {
    return <SolarFlaresPage onNavChange={setActivePage} />;
  }

  if (activePage === 'forecast') {
    return <ForecastModal onNavChange={setActivePage} />;
  }

  // Otherwise, render the modeler
  return (
    <div className="w-screen h-screen bg-black text-neutral-300 overflow-hidden flex">
      {/* ... (left controls panel is the same) */}
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
            showLabels={showLabels} onShowLabelsChange={setShowLabels}
            showExtraPlanets={showExtraPlanets} onShowExtraPlanetsChange={setShowExtraPlanets}
            showMoonL1={showMoonL1} onShowMoonL1Change={setShowMoonL1}
            cmeFilter={cmeFilter} onCmeFilterChange={setCmeFilter}
        />
      </div>

      <main className="flex-1 relative min-w-0 h-full">
        {/* ... (SimulationCanvas and PlanetLabel sections are the same) */}
        
        <div className="absolute top-0 left-0 right-0 z-40 flex items-center justify-between p-4 pointer-events-none">
          <div className="flex items-center space-x-2 pointer-events-auto">
            <button onClick={() => setIsControlsOpen(true)} className="lg:hidden p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Open Settings">
                <SettingsIcon className="w-6 h-6" />
            </button>
            <button onClick={handleResetView} className="p-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg active:scale-95 transition-transform" title="Reset View">
                <HomeIcon className="w-6 h-6" />
            </button>
          </div>
          {/* --- MODIFIED: Navigation buttons in the center --- */}
          <div className="flex items-center space-x-2 pointer-events-auto">
            <button 
              onClick={() => setActivePage('forecast')}
              className="flex items-center space-x-2 px-4 py-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-800/90 transition-colors"
              title="View Live Aurora Forecasts">
                <ForecastIcon className="w-5 h-5" />
                <span className="text-sm font-semibold">Aurora Forecast</span>
            </button>
            <button 
              onClick={() => setActivePage('flares')}
              className="flex items-center space-x-2 px-4 py-2 bg-neutral-900/80 backdrop-blur-sm border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-800/90 transition-colors"
              title="View Solar Activity">
                <FlareIcon className="w-5 h-5" />
                <span className="text-sm font-semibold">Solar Activity</span>
            </button>
          </div>
          {/* ... (right-side buttons are the same) */}
        </div>
        {/* ... (rest of modeler page is the same) ... */}
      </main>
    </div>
  );
};

export default App;