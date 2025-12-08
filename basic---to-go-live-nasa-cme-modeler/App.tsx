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
import ImpactGraphModal from './components/ImpactGraphModal'; // --- NEW: Import the graph modal ---

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

// --- NEW: Type for impact graph data points ---
interface ImpactDataPoint {
    time: number;
    speed: number;
    density: number;
}


const NAVIGATION_TUTORIAL_KEY = 'hasSeenNavigationTutorial_v1';
const CME_TUTORIAL_KEY = 'hasSeenCmeTutorial_v1';
const APP_VERSION = 'V1.0';

type PageKey = 'forecast' | 'modeler' | 'solar-activity';

const pageFromPath = (pathname: string): PageKey => {
  if (pathname.startsWith('/modeler')) return 'modeler';
  if (pathname.startsWith('/solar') || pathname.startsWith('/solar-activity')) return 'solar-activity';
  return 'forecast';
};

const pageToPath = (page: PageKey) => {
  switch (page) {
    case 'modeler':
      return '/modeler';
    case 'solar-activity':
      return '/solar-activity';
    case 'forecast':
    default:
      return '/forecast';
  }
};

const App: React.FC = () => {
  const [activePage, setActivePage] = useState<PageKey>('forecast');
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
  const [viewerMedia, setViewerMedia] = useState<ViewerMedia | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFirstVisitTutorialOpen, setIsFirstVisitTutorialOpen] = useState(false);
  const [isCmeTutorialOpen, setIsCmeTutorialOpen] = useState(false);
  const [isForecastModelsModalOpen, setIsForecastModelsModalOpen] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  const [navigationTarget, setNavigationTarget] = useState<NavigationTarget | null>(null);
  const [isGameOpen, setIsGameOpen] = useState(false);

  // --- NEW: State for the impact graph modal ---
  const [isImpactGraphOpen, setIsImpactGraphOpen] = useState(false);
  const [impactGraphData, setImpactGraphData] = useState<ImpactDataPoint[]>([]);

  const [showLabels, setShowLabels] = useState(true);
  const [showExtraPlanets, setShowExtraPlanets] = useState(true);
  const [showMoonL1, setShowMoonL1] = useState(false);
  const [showFluxRope, setShowFluxRope] = useState(false); 
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
  const historyNavigationRef = useRef(false);

  const pageTheme = useMemo(() => {
    const themeMap: Record<PageKey, { title: string; subtitle: string; accent: string; gradient: string; focusHint: string }> = {
      forecast: {
        title: 'Spot the Aurora',
        subtitle: 'Realtime visibility, alerts, and destination guidance built for aurora chasers.',
        accent: 'from-cyan-400/60 via-sky-500/40 to-indigo-500/20',
        gradient: 'bg-[radial-gradient(circle_at_20%_20%,rgba(56,189,248,0.22),transparent_35%),radial-gradient(circle_at_80%_15%,rgba(99,102,241,0.25),transparent_40%),radial-gradient(circle_at_50%_80%,rgba(34,211,238,0.18),transparent_38%)]',
        focusHint: 'Live forecast layers, auroral oval strength, and travel-ready insights.',
      },
      'solar-activity': {
        title: 'Solar Activity',
        subtitle: 'Monitor flares, shocks, and heliophysics at a glance with cinematic clarity.',
        accent: 'from-amber-400/60 via-orange-500/40 to-rose-500/20',
        gradient: 'bg-[radial-gradient(circle_at_25%_25%,rgba(251,191,36,0.2),transparent_36%),radial-gradient(circle_at_70%_15%,rgba(251,146,60,0.25),transparent_40%),radial-gradient(circle_at_60%_70%,rgba(236,72,153,0.18),transparent_38%)]',
        focusHint: 'GOES X-ray flux, interplanetary shocks, and solar wind dynamics.',
      },
      modeler: {
        title: 'CME Visualizer',
        subtitle: 'Fly through modeled CMEs with cinematic lighting and timeline choreography.',
        accent: 'from-indigo-400/60 via-violet-500/40 to-fuchsia-500/20',
        gradient: 'bg-[radial-gradient(circle_at_20%_30%,rgba(129,140,248,0.22),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(217,70,239,0.2),transparent_40%),radial-gradient(circle_at_50%_80%,rgba(56,189,248,0.16),transparent_40%)]',
        focusHint: '3D simulation controls, label overlays, and impact timing.',
      },
    };

    return themeMap[activePage];
  }, [activePage]);

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

  return (
    <>
      {showInitialLoader && <InitialLoadingScreen isFadingOut={isFadingOut} />}
      <div className={`min-h-screen w-full bg-[#05070a] text-neutral-200 overflow-x-hidden transition-opacity duration-500 relative ${showInitialLoader ? 'opacity-0' : 'opacity-100'}`}>
        <div className="absolute inset-0 opacity-90 blur-[110px] transition-all duration-700 pointer-events-none" aria-hidden="true">
          <div className={`absolute inset-0 ${pageTheme.gradient}`} />
        </div>

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

        <header className="relative z-[2001] px-4 md:px-8 pt-6 pb-4">
          <div className="max-w-6xl mx-auto rounded-3xl border border-white/10 bg-black/60 backdrop-blur-2xl shadow-2xl shadow-black/40 overflow-hidden">
            <div className="bg-gradient-to-r from-white/5 via-white/0 to-white/5">
              <div className="p-6 md:p-8 space-y-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-neutral-400">
                      <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
                      Live heliophysics lab
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${pageTheme.accent} flex items-center justify-center shadow-xl shadow-black/40 border border-white/10`}>
                        <span className="text-lg font-extrabold tracking-tight">CME</span>
                      </div>
                      <div>
                        <h1 className="text-3xl md:text-4xl font-black text-white drop-shadow-lg">{pageTheme.title}</h1>
                        <p className="text-neutral-300 max-w-3xl">{pageTheme.subtitle}</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center text-sm min-w-[260px]">
                    <div className="px-4 py-3 rounded-2xl border border-white/10 bg-white/5">
                      <p className="text-[11px] uppercase tracking-wide text-neutral-400">Aurora</p>
                      <p className="text-lg font-semibold text-emerald-200">{currentAuroraScore ?? '—'}</p>
                    </div>
                    <div className="px-4 py-3 rounded-2xl border border-white/10 bg-white/5">
                      <p className="text-[11px] uppercase tracking-wide text-neutral-400">X-ray Flux</p>
                      <p className="text-lg font-semibold text-amber-200">{latestXrayFlux ? `${latestXrayFlux.toFixed(2)} W/m²` : '—'}</p>
                    </div>
                    <div className="px-4 py-3 rounded-2xl border border-white/10 bg-white/5">
                      <p className="text-[11px] uppercase tracking-wide text-neutral-400">Substorms</p>
                      <p className="text-lg font-semibold">{isSubstormAlert ? <span className="text-rose-200">Active</span> : <span className="text-neutral-100">Calm</span>}</p>
                    </div>
                    <div className="px-4 py-3 rounded-2xl border border-white/10 bg-white/5">
                      <p className="text-[11px] uppercase tracking-wide text-neutral-400">Focus</p>
                      <p className="text-sm font-semibold text-neutral-100">{pageTheme.focusHint}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3 text-sm">
                  <button
                    id="nav-forecast"
                    onClick={() => setActivePage('forecast')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${activePage === 'forecast' ? 'bg-white/15 border-sky-400/60 text-white shadow-lg shadow-sky-500/20' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${highlightedElementId === 'nav-forecast' ? 'tutorial-highlight' : ''}`}
                  >
                    <ForecastIcon className="w-4 h-4" /> Forecasts
                  </button>
                  <button
                    id="nav-solar-activity"
                    onClick={() => setActivePage('solar-activity')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${activePage === 'solar-activity' ? 'bg-white/15 border-amber-400/60 text-white shadow-lg shadow-amber-500/20' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${highlightedElementId === 'nav-solar-activity' ? 'tutorial-highlight' : ''}`}
                  >
                    <SunIcon className="w-4 h-4" /> Solar activity
                  </button>
                  <button
                    id="nav-modeler"
                    onClick={() => setActivePage('modeler')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border transition-all ${activePage === 'modeler' ? 'bg-white/15 border-indigo-400/60 text-white shadow-lg shadow-indigo-500/20' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${highlightedElementId === 'nav-modeler' ? 'tutorial-highlight' : ''}`}
                  >
                    <CmeIcon className="w-4 h-4" /> CME visualizer
                  </button>
                  <button
                    onClick={handleShowTutorial}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all"
                  >
                    <ListIcon className="w-4 h-4" /> Guided tour
                  </button>
                  <button
                    id="nav-settings"
                    onClick={() => setIsSettingsOpen(true)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all ${highlightedElementId === 'nav-settings' ? 'tutorial-highlight' : ''}`}
                  >
                    <SettingsIcon className="w-4 h-4" /> Settings
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-neutral-300">
                  <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">Realtime layers</span>
                  <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">Smooth navigation</span>
                  <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">Dedicated routes</span>
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="relative z-[2001] px-4 md:px-8 pb-16 space-y-8">
          <div className="grid xl:grid-cols-12 gap-6 items-start">
            <div className="xl:col-span-9 space-y-6">
              <section className={`rounded-3xl border border-white/10 bg-black/65 backdrop-blur-2xl shadow-2xl shadow-black/40 p-4 md:p-6 ${activePage === 'forecast' ? 'block' : 'hidden'}`}>
                <ForecastDashboard
                  setViewerMedia={setViewerMedia}
                  setCurrentAuroraScore={setCurrentAuroraScore}
                  setSubstormActivityStatus={setSubstormActivityStatus}
                  setIpsAlertData={setIpsAlertData}
                  navigationTarget={navigationTarget}
                  onInitialLoad={handleInitialLoad}
                />
              </section>

              <section className={`rounded-3xl border border-white/10 bg-black/65 backdrop-blur-2xl shadow-2xl shadow-black/40 p-4 md:p-6 ${activePage === 'solar-activity' ? 'block' : 'hidden'}`}>
                <SolarActivityDashboard
                  setViewerMedia={setViewerMedia}
                  setLatestXrayFlux={setLatestXrayFlux}
                  onViewCMEInVisualization={handleViewCMEInVisualization}
                  navigationTarget={navigationTarget}
                />
              </section>

              <section className={`rounded-3xl border border-white/10 bg-black/65 backdrop-blur-2xl shadow-2xl shadow-black/40 p-4 md:p-6 space-y-4 ${activePage === 'modeler' ? 'block' : 'hidden'}`}>
                <div className="flex flex-wrap gap-3">
                  <button onClick={() => setIsControlsOpen(true)} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2">
                    <SettingsIcon className="w-4 h-4" /> Controls
                  </button>
                  <button onClick={() => setIsCmeListOpen(true)} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2">
                    <ListIcon className="w-4 h-4" /> CME list
                  </button>
                  <button onClick={handleResetView} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2">
                    <MoveIcon className="w-4 h-4" /> Reset camera
                  </button>
                  <button onClick={() => setIsForecastModelsModalOpen(true)} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2">
                    <GlobeIcon className="w-4 h-4" /> Forecast models
                  </button>
                  <button onClick={handleDownloadImage} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2">
                    <DownloadIcon className="w-4 h-4" /> Download image
                  </button>
                  <button onClick={handleOpenImpactGraph} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all flex items-center gap-2">
                    <ForecastIcon className="w-4 h-4" /> Impact chart
                  </button>
                </div>

                <div className="grid lg:grid-cols-12 gap-4 items-start">
                  <div className="lg:col-span-3">
                    <div className={`lg:sticky lg:top-6 ${isControlsOpen ? 'block' : 'hidden lg:block'}`}>
                      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl shadow-xl">
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
                        />
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-6">
                    <div className="relative rounded-2xl border border-white/10 bg-black/50 backdrop-blur-xl shadow-2xl overflow-hidden min-h-[520px]">
                      <SimulationCanvas
                        ref={canvasRef}
                        cmeData={cmesToRender}
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
                        dataVersion={dataVersion}
                        interactionMode={InteractionMode.MOVE}
                        onSunClick={handleOpenGame}
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
                      <TimelineControls
                        isVisible={!isLoading && cmesToRender.length > 0}
                        isPlaying={timelinePlaying}
                        onPlayPause={handleTimelinePlayPause}
                        onScrub={handleTimelineScrub}
                        scrubberValue={timelineScrubberValue}
                        onStepFrame={handleTimelineStep}
                        playbackSpeed={timelineSpeed}
                        onSetSpeed={handleTimelineSetSpeed}
                        minDate={timelineMinDate}
                        maxDate={timelineMaxDate}
                        onOpenImpactGraph={handleOpenImpactGraph}
                      />
                    </div>
                  </div>

                  <div className="lg:col-span-3">
                    <div className={`lg:sticky lg:top-6 ${isCmeListOpen ? 'block' : 'hidden lg:block'}`}>
                      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur-xl shadow-xl">
                        <CMEListPanel
                          cmes={filteredCmes}
                          onSelectCME={handleSelectCMEForModeling}
                          selectedCMEId={currentlyModeledCMEId}
                          selectedCMEForInfo={selectedCMEForInfo}
                          isLoading={isLoading}
                          fetchError={fetchError}
                          onClose={() => setIsCmeListOpen(false)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {(isControlsOpen || isCmeListOpen) && (
                  <div
                    className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[2004]"
                    onClick={() => {
                      setIsControlsOpen(false);
                      setIsCmeListOpen(false);
                    }}
                  />
                )}
                {isLoading && activePage === 'modeler' && <LoadingOverlay />}
                <TutorialModal isOpen={isTutorialOpen} onClose={() => setIsTutorialOpen(false)} />
              </section>
            </div>

            <aside className="xl:col-span-3 space-y-4">
              <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-black/20 backdrop-blur-2xl shadow-2xl shadow-black/40 p-4 space-y-3">
                <p className="text-xs uppercase tracking-wide text-neutral-400">Quick links</p>
                <div className="flex flex-col gap-2 text-sm">
                  <button onClick={() => setNavigationTarget({ page: 'forecast', elementId: 'unified-forecast-section' })} className="px-3 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-left">Jump to aurora outlook</button>
                  <button onClick={() => setNavigationTarget({ page: 'solar-activity', elementId: 'goes-xray-flux-section' })} className="px-3 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-left">View current solar flares</button>
                  <button onClick={() => setNavigationTarget({ page: 'solar-activity', elementId: 'ips-shocks-section' })} className="px-3 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-left">Inspect IPS shocks</button>
                  <button onClick={() => setActivePage('modeler')} className="px-3 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-left">Open cinematic modeler</button>
                  <button onClick={handleDownloadImage} className="px-3 py-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all text-left">Download screenshot</button>
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-black/60 backdrop-blur-2xl shadow-2xl shadow-black/40 p-4 space-y-3">
                <p className="text-xs uppercase tracking-wide text-neutral-400">Live signals</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-neutral-400">Aurora score</span><span className="font-semibold text-emerald-200">{currentAuroraScore ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-neutral-400">X-Ray flux</span><span className="font-semibold text-amber-200">{latestXrayFlux ? `${latestXrayFlux.toFixed(2)} W/m²` : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-neutral-400">Substorms</span><span className={`font-semibold ${isSubstormAlert ? 'text-rose-200' : 'text-neutral-100'}`}>{isSubstormAlert ? 'Active' : 'Calm'}</span></div>
                </div>
                <button
                  onClick={() => setIsGameOpen(true)}
                  className="w-full px-3 py-3 rounded-xl bg-gradient-to-r from-emerald-400/40 to-cyan-500/30 border border-emerald-300/50 text-sm font-semibold text-emerald-50 shadow-lg shadow-emerald-500/20"
                >
                  Solar Surfer break
                </button>
              </div>
            </aside>
          </div>
        </main>

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

        {/* --- NEW: Render the ImpactGraphModal --- */}
        <ImpactGraphModal
          isOpen={isImpactGraphOpen}
          onClose={() => setIsImpactGraphOpen(false)}
          data={impactGraphData}
        />

        {isGameOpen && <SolarSurferGame onClose={handleCloseGame} />}

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
    </>
  );
};

export default App;
// --- END OF FILE App.tsx ---