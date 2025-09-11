// --- START OF FILE src/pages/ModelerPage.tsx ---

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

// Component Imports
import SimulationCanvas from '../components/SimulationCanvas';
import ControlsPanel from '../components/ControlsPanel';
import CMEListPanel from '../components/CMEListPanel';
import TimelineControls from '../components/TimelineControls';
import PlanetLabel from '../components/PlanetLabel';
import LoadingOverlay from '../components/LoadingOverlay';
import ForecastModelsModal from '../components/ForecastModelsModal';
import CmeModellerTutorial from '../components/CmeModellerTutorial';

// Service and Type Imports
import { fetchCMEData } from '../services/nasaService';
import { ProcessedCME, ViewMode, FocusTarget, TimeRange, PlanetLabelInfo, CMEFilter, SimulationCanvasHandle, InteractionMode } from '../types';
import { SCENE_SCALE } from '../constants';

// Icon Imports
import SettingsIcon from '../components/icons/SettingsIcon';
import ListIcon from '../components/icons/ListIcon';
import GlobeIcon from '../components/icons/GlobeIcon';
import CmeIcon from '../components/icons/CmeIcon';

const DownloadIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
);

type ViewerMedia =
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'animation', urls: string[] };

interface ModelerPageProps {
  setViewerMedia: (media: ViewerMedia | null) => void;
}

const CME_TUTORIAL_KEY = 'hasSeenCmeTutorial_v1';

const ModelerPage: React.FC<ModelerPageProps> = ({ setViewerMedia }) => {
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
  const [isForecastModelsOpen, setIsForecastModelsOpen] = useState(false);
  const [isCmeTutorialOpen, setIsCmeTutorialOpen] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);

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
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (!clockRef.current && (window as any).THREE) {
      clockRef.current = new (window as any).THREE.Clock();
    }
  }, []);

  useEffect(() => {
    if (!isLoading) {
      const hasSeenCmeTutorial = localStorage.getItem(CME_TUTORIAL_KEY);
      if (!hasSeenCmeTutorial) {
        setTimeout(() => setIsCmeTutorialOpen(true), 200);
      }
    }
  }, [isLoading]);

  const handleCloseCmeTutorial = useCallback(() => {
    localStorage.setItem(CME_TUTORIAL_KEY, 'true');
    setIsCmeTutorialOpen(false);
    setHighlightedElementId(null);
  }, []);

  const handleTutorialStepChange = useCallback((id: string | null) => {
    setHighlightedElementId(id);
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

  useEffect(() => { loadCMEData(activeTimeRange); }, [activeTimeRange, loadCMEData]);
  
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

  // --- NEW EFFECT TO HANDLE INCOMING CME ID ---
  useEffect(() => {
    const cmeIdFromState = location.state?.cmeIdToModel;
    if (cmeIdFromState && cmeData.length > 0) {
      const cmeToModel = cmeData.find(cme => cme.id === cmeIdFromState);
      if (cmeToModel) {
        handleSelectCMEForModeling(cmeToModel);
        setIsCmeListOpen(true); // Open the list to show the selected CME
        // Clear the state so it doesn't re-trigger on hot reload
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state, cmeData, handleSelectCMEForModeling, navigate, location.pathname]);


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
          if (info.name === 'Moon' || info.name === 'L1' || !info.mesh.visible) { return; }
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

  return (
    <div className="w-full h-full flex">
        <div id="controls-panel-container" className={`flex-shrink-0 lg:p-5 lg:relative lg:translate-x-0 lg:w-auto lg:max-w-xs fixed top-[4.25rem] left-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isControlsOpen ? 'translate-x-0' : '-translate-x-full'}`}>
            <ControlsPanel activeTimeRange={activeTimeRange} onTimeRangeChange={handleTimeRangeChange} activeView={activeView} onViewChange={handleViewChange} activeFocus={activeFocus} onFocusChange={handleFocusChange} isLoading={isLoading} onClose={() => setIsControlsOpen(false)} onOpenGuide={() => setIsCmeTutorialOpen(true)} showLabels={showLabels} onShowLabelsChange={setShowLabels} showExtraPlanets={showExtraPlanets} onShowExtraPlanetsChange={setShowExtraPlanets} showMoonL1={showMoonL1} onShowMoonL1Change={setShowMoonL1} cmeFilter={cmeFilter} onCmeFilterChange={setCmeFilter} />
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
        
        <ForecastModelsModal 
            isOpen={isForecastModelsOpen} 
            onClose={() => setIsForecastModelsOpen(false)} 
            setViewerMedia={setViewerMedia} 
            shouldPreload={true} 
        />

        <CmeModellerTutorial
            isOpen={isCmeTutorialOpen}
            onClose={handleCloseCmeTutorial}
            onStepChange={handleTutorialStepChange}
        />
    </div>
  );
};

export default ModelerPage;
// --- END OF FILE src/pages/ModelerPage.tsx ---