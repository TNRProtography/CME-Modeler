// --- START OF FILE App.tsx ---

import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';

/**
 * Wraps React.lazy() with automatic stale-chunk recovery.
 *
 * After a new deployment, Vite generates new content-hashed filenames for every
 * JS chunk. If a user still has the old HTML loaded in their tab, any subsequent
 * lazy import will try to fetch the old (now-deleted) filename and throw
 * "Failed to fetch dynamically imported module". This wrapper catches that error
 * and reloads the page once — which fetches the fresh HTML and correct new URLs.
 * A sessionStorage flag prevents an infinite reload loop if the error persists
 * for an unrelated reason.
 */
const CHUNK_RELOAD_KEY = 'sta_chunk_reload_attempted';
function retryLazyLoad<T extends React.ComponentType<any>>(
  importFn: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return lazy(() =>
    importFn().catch((err: unknown) => {
      const isChunkError =
        err instanceof Error &&
        (err.message.includes('Failed to fetch dynamically imported module') ||
          err.message.includes('Importing a module script failed') ||
          err.message.includes('error loading dynamically imported module'));

      if (isChunkError && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
        window.location.reload();
        // Return a never-resolving promise — the reload will take over
        return new Promise<{ default: T }>(() => {});
      }
      // Not a chunk error, or already retried — clear flag and re-throw so
      // the ErrorBoundary can display the real problem
      sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      throw err;
    })
  );
}

// Modeler-page-only components — lazy loaded so they never touch the initial bundle
// for users landing on the forecast or solar activity pages.
const SimulationCanvas = retryLazyLoad(() => import('./components/SimulationCanvas'));
const ControlsPanel = retryLazyLoad(() => import('./components/ControlsPanel'));
const CMEListPanel = retryLazyLoad(() => import('./components/CMEListPanel'));
const TimelineControls = retryLazyLoad(() => import('./components/TimelineControls'));
const PlanetLabel = retryLazyLoad(() => import('./components/PlanetLabel'));
const TutorialModal = retryLazyLoad(() => import('./components/TutorialModal'));
const LoadingOverlay = retryLazyLoad(() => import('./components/LoadingOverlay'));
// MediaViewerModal is used across all pages but returns null until media is set,
// so lazy-loading it is safe and removes it from the critical path.
const MediaViewerModal = retryLazyLoad(() => import('./components/MediaViewerModal'));
import { fetchCMEData } from './services/nasaService';
import { refreshLocationOnServer } from './utils/notifications';
import { ProcessedCME, ViewMode, FocusTarget, TimeRange, PlanetLabelInfo, CMEFilter, SimulationCanvasHandle, InteractionMode, SubstormActivity, InterplanetaryShock, ImpactDataPoint } from './types';

// Icon Imports
import SettingsIcon from './components/icons/SettingsIcon';
import ListIcon from './components/icons/ListIcon';
import MoveIcon from './components/icons/MoveIcon';
import SelectIcon from './components/icons/SelectIcon';
import GlobeIcon from './components/icons/GlobeIcon';
import CameraResetIcon from './components/icons/CameraResetIcon';
import { AuroraBadgeIcon, SolarBadgeIcon, ModelerBadgeIcon } from './components/icons/NavBadgeIcons';

// Dashboard and Banner Imports — heavy pages are lazy-loaded to avoid
// blocking the initial paint for users landing on any page.
const ForecastDashboard = retryLazyLoad(() => import('./components/ForecastDashboard'));
const SolarActivityDashboard = retryLazyLoad(() => import('./components/SolarActivityDashboard'));
const UnifiedDashboardMode = retryLazyLoad(() => import('./components/UnifiedDashboardMode'));
import GlobalBanner from './components/GlobalBanner';
import OnboardingBanner from './components/OnboardingBanner';
import AppDocumentation from './components/AppDocumentation';
import InitialLoadingScreen from './components/InitialLoadingScreen';

// Modal Imports — also lazy to keep the initial bundle lean
const SettingsModal = retryLazyLoad(() => import('./components/SettingsModal'));
const FirstVisitTutorial = retryLazyLoad(() => import('./components/FirstVisitTutorial'));
const CmeModellerTutorial = retryLazyLoad(() => import('./components/CmeModellerTutorial'));
const ForecastModelsModal = retryLazyLoad(() => import('./components/ForecastModelsModal'));
import { calculateStats, getPageViewStorageMode, loadPageViewStats, PageViewStats, recordPageView } from './utils/pageViews';
import { registerDatasetTicker } from './utils/pollingScheduler';
import { startAppPreload } from './utils/appPreloader';
import {
  DEFAULT_FORECAST_VIEW_KEY,
  DEFAULT_MAIN_PAGE_KEY,
  DEBUG_PATH,
  getForecastViewFromSearch,
  getPageFromPathname,
  PAGE_PATHS,
  SETTINGS_PATH,
  TUTORIAL_PATH,
} from './utils/navigation';
import { useCoronalHoles } from './hooks/useCoronalHoles';

const RefreshIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 9a7 7 0 0112-4.9M20 15a7 7 0 01-12 4.9" />
    </svg>
);

type ViewerMedia =
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'image_with_labels', url: string, labels: { id: string; xPercent: number; yPercent: number; text: string }[] }
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

type InitialLoadTaskKey =
  | 'forecastData'
  | 'forecastApi'
  | 'solarWindApi'
  | 'goes18Api'
  | 'goes19Api'
  | 'ipsApi'
  | 'nzMagApi'
  | 'solarData'
  | 'solarXray'
  | 'solarProton'
  | 'solarFlares'
  | 'solarRegions'
  | 'modelerCmeData';

type ForecastLoadPoint = 'forecastApi' | 'solarWindApi' | 'goes18Api' | 'goes19Api' | 'ipsApi' | 'nzMagApi';
type SolarLoadPoint = 'solarXray' | 'solarProton' | 'solarFlares' | 'solarRegions';

// Only block the loader on the 4 APIs that feed the core aurora score and solar wind display.
// forecastData is structurally redundant (it fires milliseconds after the last API anyway).
// ipsApi (IPS shocks) and nzMagApi (NZ magnetometer) feed secondary widgets — they load
// silently in the background so the user reaches the forecast as fast as possible.
const FORECAST_INITIAL_TASKS: InitialLoadTaskKey[] = [
  'forecastApi',
  'solarWindApi',
  'goes18Api',
  'goes19Api',
];

const SOLAR_INITIAL_TASKS: InitialLoadTaskKey[] = [
  'solarData',
  'solarXray',
  'solarProton',
  'solarFlares',
  'solarRegions',
];

const MODELER_INITIAL_TASKS: InitialLoadTaskKey[] = ['modelerCmeData'];

const getInitialRequiredTasks = (page: 'forecast' | 'modeler' | 'solar-activity'): Set<InitialLoadTaskKey> => {
  // Only require the tasks that belong to the page the user actually landed on.
  // Previously this ignored `page` and required ALL tasks from all three pages,
  // which caused the loader to hang forever once ForecastDashboard and
  // SolarActivityDashboard became lazy — their callbacks never fired for unvisited pages.
  switch (page) {
    case 'forecast':      return new Set(FORECAST_INITIAL_TASKS);
    case 'solar-activity': return new Set(SOLAR_INITIAL_TASKS);
    case 'modeler':
    default:              return new Set(MODELER_INITIAL_TASKS);
  }
};

const logDev = (...args: unknown[]) => {
  if (!import.meta.env.DEV) return;
  console.info('[preload]', ...args);
};


const NAVIGATION_TUTORIAL_KEY = 'hasSeenNavigationTutorial_v1';
const CME_TUTORIAL_KEY = 'hasSeenCmeTutorial_v1';
const APP_VERSION = 'V1.6';
const DASHBOARD_MODE_KEY = 'dashboard_mode_enabled_v1';

const BANNER_XRAY_URLS = [
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/xrays-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json',
];

const parseLatestShortBandFlux = (raw: any[]): number | null => {
  if (!Array.isArray(raw)) return null;

  const latestByTimestamp = new Map<number, number>();
  raw.forEach((row: any) => {
    if (row?.energy !== '0.1-0.8nm') return;
    const t = new Date(row.time_tag).getTime();
    const flux = Number.parseFloat(row.flux);
    if (!Number.isFinite(t) || !Number.isFinite(flux)) return;
    latestByTimestamp.set(t, flux);
  });

  if (!latestByTimestamp.size) return null;
  const latestTs = Math.max(...latestByTimestamp.keys());
  return latestByTimestamp.get(latestTs) ?? null;
};

const SolarSurferGame = retryLazyLoad(() => import('./components/SolarSurferGame'));
const ImpactGraphModal = retryLazyLoad(() => import('./components/ImpactGraphModal'));
const DebugPanel = retryLazyLoad(() => import('./components/DebugPanel'));


const App: React.FC = () => {
  const getStoredMainPage = () => {
    const stored = localStorage.getItem(DEFAULT_MAIN_PAGE_KEY);
    return stored === 'solar-activity' || stored === 'modeler' ? stored : 'forecast';
  };

  const getStoredForecastView = () => {
    const stored = localStorage.getItem(DEFAULT_FORECAST_VIEW_KEY);
    return stored === 'advanced' ? 'advanced' : 'simple';
  };

  const getStoredDashboardMode = () => localStorage.getItem(DASHBOARD_MODE_KEY) === 'true';

  const [defaultMainPage, setDefaultMainPage] = useState<'forecast' | 'modeler' | 'solar-activity'>(() =>
    getStoredMainPage()
  );

  const [defaultForecastView, setDefaultForecastView] = useState<'simple' | 'advanced'>(() =>
    getStoredForecastView()
  );

  const [isDashboardMode, setIsDashboardMode] = useState<boolean>(() => getStoredDashboardMode());

  const [activePage, setActivePage] = useState<'forecast' | 'modeler' | 'solar-activity'>(
    () => getPageFromPathname(window.location.pathname) ?? getStoredMainPage()
  );
  const [cmeData, setCmeData] = useState<ProcessedCME[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [dataVersion, setDataVersion] = useState<number>(0);
  const [activeTimeRange, setActiveTimeRange] = useState<TimeRange>(TimeRange.D3);
  const [activeView, setActiveView] = useState<ViewMode>(ViewMode.SIDE);
  const [activeFocus, setActiveFocus] = useState<FocusTarget | null>(FocusTarget.EARTH);
  const [currentlyModeledCMEId, setCurrentlyModeledCMEId] = useState<string | null>(null);
  const [selectedCMEForInfo, setSelectedCMEForInfo] = useState<ProcessedCME | null>(null);
  const [sharedCmeExpired, setSharedCmeExpired] = useState<string | null>(null); // holds the id if expired
  // Capture the shared CME id at mount time so URL changes never lose it
  const initialSharedCmeIdRef = useRef<string | null>(
    new URLSearchParams(window.location.search).get('cme')
  );
  const sharedCmeRangeExpandedRef = useRef<boolean>(false);
  const [sharedCmeSearching, setSharedCmeSearching] = useState<boolean>(
    () => !!new URLSearchParams(window.location.search).get('cme')
  );
  const [isControlsOpen, setIsControlsOpen] = useState(false);
  const [isCmeListOpen, setIsCmeListOpen] = useState(false);
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [viewerMedia, setViewerMedia] = useState<ViewerMedia | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
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
  const [showHss, setShowHss] = useState(false);
  const [rerunHssInteraction] = useState(true);
  const [rerunToken, setRerunToken] = useState(0);
  const [rerunAwaitingHssData, setRerunAwaitingHssData] = useState(false);
  const [sharedSuvi195Url, setSharedSuvi195Url] = useState<string | null>(null);
  const { coronalHoles, detectionStatus: chDetectionStatus, chEvolutions, lastDetectedAt } = useCoronalHoles({
    enabled: showHss,
    sourceImageUrl: sharedSuvi195Url,
  });
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
  const clockStartRef = useRef<number>(performance.now());
  const canvasRef = useRef<SimulationCanvasHandle>(null);
  const apiKey = import.meta.env.VITE_NASA_API_KEY || 'DEMO_KEY';
  const [latestXrayFlux, setLatestXrayFlux] = useState<number | null>(null);
  const [currentAuroraScore, setCurrentAuroraScore] = useState<number | null>(null);
  const [substormActivityStatus, setSubstormActivityStatus] = useState<SubstormActivity | null>(null);
  const [ipsAlertData, setIpsAlertData] = useState<IpsAlertData | null>(null);
  /** Latest measured solar wind speed at L1 (km/s) — fed to the propagation engine */
  const [measuredWindSpeedKms, setMeasuredWindSpeedKms] = useState<number | undefined>(undefined);

  const [showIabBanner, setShowIabBanner] = useState(false);
  const [isIOSIab, setIsIOSIab] = useState(false);
  const [isAndroidIab, setIsAndroidIab] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<Event | null>(null);
  const [showDocumentation, setShowDocumentation] = useState(false);
  const CANONICAL_ORIGIN = 'https://www.spottheaurora.co.nz';

  const CME_TIMELINE_FUTURE_DAYS = 7;
  const CME_SELECTION_FUTURE_DAYS = 7;

  const [isDashboardReady, setIsDashboardReady] = useState(false);
  const [isMinTimeElapsed, setIsMinTimeElapsed] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [showInitialLoader, setShowInitialLoader] = useState(true);
  const initialPageRef = useRef<'forecast' | 'modeler' | 'solar-activity'>(activePage);
  const initialRequiredTasks = useRef<Set<InitialLoadTaskKey>>(getInitialRequiredTasks(initialPageRef.current));
  const [initialLoadTasks, setInitialLoadTasks] = useState<Record<InitialLoadTaskKey, boolean>>(() => {
    const required = getInitialRequiredTasks(initialPageRef.current);
    return {
      forecastData: !required.has('forecastData'),
      forecastApi: !required.has('forecastApi'),
      solarWindApi: !required.has('solarWindApi'),
      goes18Api: !required.has('goes18Api'),
      goes19Api: !required.has('goes19Api'),
      ipsApi: !required.has('ipsApi'),
      nzMagApi: !required.has('nzMagApi'),
      solarData: !required.has('solarData'),
      solarXray: !required.has('solarXray'),
      solarProton: !required.has('solarProton'),
      solarFlares: !required.has('solarFlares'),
      solarRegions: !required.has('solarRegions'),
      modelerCmeData: !required.has('modelerCmeData'),
    };
  });
  const [reloadNotice, setReloadNotice] = useState<string | null>(null);
  const [reloadCountdown, setReloadCountdown] = useState<number | null>(null);
  const reloadScheduledRef = useRef(false);
  const lastProgressRef = useRef(0);
  const lastProgressAtRef = useRef(Date.now());
  const cmePageLoadedOnce = useRef(false);
  const lastMainPageRef = useRef<'forecast' | 'modeler' | 'solar-activity'>(activePage);
  const [forecastViewMode, setForecastViewMode] = useState<'simple' | 'advanced'>(() => {
    const viewFromSearch = getForecastViewFromSearch(window.location.search);
    if (viewFromSearch) return viewFromSearch;
    return getStoredForecastView();
  });
  const [pageViewStats, setPageViewStats] = useState<PageViewStats>(() => calculateStats());
  const [pageViewStorageMode] = useState<'server' | 'local'>(() => getPageViewStorageMode());
  const [manualRefreshKey, setManualRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const markInitialTaskDone = useCallback((task: InitialLoadTaskKey) => {
    setInitialLoadTasks((prev) => {
      if (prev[task]) return prev;
      return { ...prev, [task]: true };
    });
  }, []);

  const initialLoadProgress = useMemo(() => {
    const required = Array.from(initialRequiredTasks.current);
    const completed = required.filter((task) => initialLoadTasks[task]).length;
    const total = required.length;
    if (total === 0) return 100;
    return Math.round((completed / total) * 100);
  }, [initialLoadTasks]);


  useEffect(() => {
    if (!isDashboardMode) return;
    setInitialLoadTasks((prev) => ({
      ...prev,
      forecastData: true,
      forecastApi: true,
      solarWindApi: true,
      goes18Api: true,
      goes19Api: true,
      ipsApi: true,
      nzMagApi: true,
      solarData: true,
      solarXray: true,
      solarProton: true,
      solarFlares: true,
      solarRegions: true,
      modelerCmeData: true,
    }));
  }, [isDashboardMode]);

  const initialLoadStatus = useMemo(() => {
    if (!initialLoadTasks.forecastApi) return 'Loading forecast core feed…';
    if (!initialLoadTasks.solarWindApi) return 'Loading solar wind feed…';
    if (!initialLoadTasks.goes18Api || !initialLoadTasks.goes19Api) return 'Loading GOES magnetometer feeds…';
    if (!initialLoadTasks.solarXray || !initialLoadTasks.solarProton) return 'Loading solar flux feeds…';
    if (!initialLoadTasks.solarFlares || !initialLoadTasks.solarRegions) return 'Loading active region and flare feeds…';
    if (!initialLoadTasks.modelerCmeData) return 'Loading CME model data…';
    return 'Finalizing dashboard…';
  }, [initialLoadTasks]);

  const syncStateWithPath = useCallback(
    (path: string, replaceHistory = false) => {
      const url = new URL(path, window.location.origin);
      const mainPage = getPageFromPathname(url.pathname);
      const isSettingsPath = url.pathname === SETTINGS_PATH;
      const isTutorialPath = url.pathname === TUTORIAL_PATH;
      const isDebugPath = url.pathname === DEBUG_PATH;

      if (mainPage) {
        lastMainPageRef.current = mainPage;
        setActivePage(mainPage);
        if (mainPage === 'forecast') {
          const viewFromUrl = getForecastViewFromSearch(url.search);
          const targetView = viewFromUrl ?? defaultForecastView;
          setForecastViewMode(targetView);

          if (!viewFromUrl) {
            const updated = new URL(url.href);
            updated.searchParams.set('view', targetView);
            const updatedPath = updated.pathname + updated.search;
            const method: 'replaceState' | 'pushState' = replaceHistory ? 'replaceState' : 'pushState';
            if (updatedPath !== path) {
              window.history[method]({}, '', updatedPath);
            }
          }
        }
      } else if (!isSettingsPath && !isTutorialPath && !isDebugPath) {
        // If a ?cme= param is present on an unrecognised path, route to the
        // modeler so shared CME links always land in the right place.
        const hasCmeParam = url.searchParams.has('cme');
        const fallbackPath = hasCmeParam
          ? PAGE_PATHS.modeler
          : lastMainPageRef.current === 'forecast'
            ? `${PAGE_PATHS.forecast}?view=${forecastViewMode}`
            : PAGE_PATHS[lastMainPageRef.current] ?? PAGE_PATHS.forecast;
        if (path !== fallbackPath) {
          const method: 'replaceState' | 'pushState' = replaceHistory ? 'replaceState' : 'pushState';
          window.history[method]({}, '', fallbackPath);
        }
        lastMainPageRef.current = getPageFromPathname(fallbackPath) ?? lastMainPageRef.current;
        setActivePage(lastMainPageRef.current);
      } else {
        setActivePage(lastMainPageRef.current);
      }

      setIsSettingsOpen(isSettingsPath);
      setIsTutorialOpen(isTutorialPath);
      setIsDebugOpen(isDebugPath);
    },
    [defaultForecastView, forecastViewMode]
  );

  const navigateToPath = useCallback(
    (path: string, replaceHistory = false) => {
      const method: 'replaceState' | 'pushState' = replaceHistory ? 'replaceState' : 'pushState';
      const currentPath = window.location.pathname + window.location.search;
      if (currentPath !== path) {
        window.history[method]({}, '', path);
      }
      syncStateWithPath(path, true);
    },
    [syncStateWithPath]
  );

  const navigateToPage = useCallback(
    (page: 'forecast' | 'solar-activity' | 'modeler', replaceHistory = false) => {
      if (page === 'forecast') {
        const url = new URL(window.location.href);
        url.pathname = PAGE_PATHS.forecast;
        url.search = '';
        url.searchParams.set('view', forecastViewMode);
        navigateToPath(url.pathname + url.search, replaceHistory);
        return;
      }

      navigateToPath(PAGE_PATHS[page], replaceHistory);
    },
    [forecastViewMode, navigateToPath]
  );

  useEffect(() => {
    syncStateWithPath(window.location.href, true);
    const onPopState = () => syncStateWithPath(window.location.href, true);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [syncStateWithPath]);

  useEffect(() => {
    lastMainPageRef.current = activePage;
  }, [activePage]);

  const [visitedPages, setVisitedPages] = useState<Record<'forecast' | 'modeler' | 'solar-activity', boolean>>(() => ({
    forecast: initialPageRef.current === 'forecast',
    modeler: initialPageRef.current === 'modeler',
    'solar-activity': initialPageRef.current === 'solar-activity',
  }));

  useEffect(() => {
    setVisitedPages((prev) => (prev[activePage] ? prev : { ...prev, [activePage]: true }));
  }, [activePage]);

  useEffect(() => {
    let isCancelled = false;
    loadPageViewStats().then(stats => {
      if (!isCancelled) setPageViewStats(stats);
    });
    return () => { isCancelled = true; };
  }, []);

  useEffect(() => {
    let isCancelled = false;
    recordPageView().then(stats => {
      if (!isCancelled) setPageViewStats(stats);
    });
    return () => { isCancelled = true; };
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

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e);
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

  const handleInstallClick = useCallback(async () => {
    if (!deferredInstallPrompt) return;
    (deferredInstallPrompt as any).prompt();
    const { outcome } = await (deferredInstallPrompt as any).userChoice;
    if (outcome === 'accepted') setDeferredInstallPrompt(null);
  }, [deferredInstallPrompt]);

  const handleIabCopyLink = useCallback(async () => {
    const url = window.location.href.split('#')[0];
    try {
      await navigator.clipboard.writeText(url);
      alert('Link copied. Open it in your browser to install.');
    } catch {
      prompt('Copy this URL:', url);
    }
  }, []);

  // Keep GlobalBanner flare state warm from app start so users do not need
  // to open the Solar Activity page before flare alerts appear.
  useEffect(() => {
    let cancelled = false;

    const fetchBannerXray = async () => {
      for (const url of BANNER_XRAY_URLS) {
        try {
          const response = await fetch(`${url}?_=${Date.now()}`);
          if (!response.ok) continue;
          const raw = await response.json();
          const latestFlux = parseLatestShortBandFlux(raw);
          if (latestFlux !== null) {
            if (!cancelled) setLatestXrayFlux(latestFlux);
            return;
          }
        } catch {
          // Try fallback URL silently.
        }
      }
    };

    void fetchBannerXray();
    const id = window.setInterval(() => { void fetchBannerXray(); }, 60 * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    // Show the loader for at least 600ms so the animation isn't a jarring flash,
    // but don't hold it longer than needed — dismiss as soon as data is ready.
    const minTimer = setTimeout(() => setIsMinTimeElapsed(true), 600);
    // Defer non-critical preloads until after first paint so they don't compete
    // with the initial render and inflate Total Blocking Time.
    const preloadTimer = setTimeout(() => {
      logDev('initial preload start');
      startAppPreload();
    }, 300);

    const hasSeenTutorial = localStorage.getItem(NAVIGATION_TUTORIAL_KEY);
    if (!hasSeenTutorial) {
      // Delay the tutorial so new users can orient themselves before being interrupted
      const tutorialTimer = setTimeout(() => setIsFirstVisitTutorialOpen(true), 30000);
      return () => { clearTimeout(minTimer); clearTimeout(preloadTimer); clearTimeout(tutorialTimer); };
    }
    return () => { clearTimeout(minTimer); clearTimeout(preloadTimer); };
  }, []);

  // Silently refresh GPS location for push notification worker on every app load.
  // Non-blocking — if GPS is denied or there's no subscription, this is a no-op.
  useEffect(() => {
    const t = setTimeout(() => refreshLocationOnServer(), 3000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const allReady = Array.from(initialRequiredTasks.current).every((task) => initialLoadTasks[task]);
    if (allReady && !isDashboardReady) {
      setIsDashboardReady(true);
    }
  }, [initialLoadTasks, isDashboardReady]);

  useEffect(() => {
    if (isDashboardReady && isMinTimeElapsed) {
      setIsFadingOut(true);
      logDev('initial preload complete');
      setTimeout(() => setShowInitialLoader(false), 300);
    }
  }, [isDashboardReady, isMinTimeElapsed]);

  useEffect(() => {
    if (!showInitialLoader || isFadingOut || reloadScheduledRef.current) return;

    const now = Date.now();
    if (initialLoadProgress !== lastProgressRef.current) {
      lastProgressRef.current = initialLoadProgress;
      lastProgressAtRef.current = now;
      setReloadNotice(null);
      setReloadCountdown(null);
      return;
    }

    const stagnantForMs = now - lastProgressAtRef.current;
    if (initialLoadProgress < 100 && stagnantForMs > 20000) {
      reloadScheduledRef.current = true;
      setReloadNotice(`Loading is taking longer than expected at ${initialLoadProgress}%. We will refresh automatically.`);
      setReloadCountdown(3);
    }
  }, [showInitialLoader, isFadingOut, initialLoadProgress]);

  useEffect(() => {
    if (!reloadScheduledRef.current || reloadCountdown === null) return;
    if (reloadCountdown <= 0) {
      window.location.reload();
      return;
    }
    const timer = setTimeout(() => setReloadCountdown((prev) => (prev == null ? prev : prev - 1)), 1000);
    return () => clearTimeout(timer);
  }, [reloadCountdown]);

  useEffect(() => {
    if (
      activePage === 'modeler' &&
      !isLoading &&
      !isFirstVisitTutorialOpen &&
      !isTutorialOpen
    ) {
      const hasSeenCmeTutorial = localStorage.getItem(CME_TUTORIAL_KEY);
      if (!hasSeenCmeTutorial) {
        setTimeout(() => setIsCmeTutorialOpen(true), 200);
      }
    }
  }, [activePage, isLoading, isFirstVisitTutorialOpen, isTutorialOpen]);

  useEffect(() => {
    if (navigationTarget) {
      navigateToPage(navigationTarget.page);
      const scrollTimer = setTimeout(() => {
        const element = document.getElementById(navigationTarget.elementId);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        setNavigationTarget(null);
      }, 100);
      return () => clearTimeout(scrollTimer);
    }
  }, [navigateToPage, navigationTarget]);
  
  const handleCloseFirstVisitTutorial = useCallback(() => {
    localStorage.setItem(NAVIGATION_TUTORIAL_KEY, 'true');
    setIsFirstVisitTutorialOpen(false);
    setHighlightedElementId(null);
    if (window.location.pathname === TUTORIAL_PATH) {
      navigateToPage(lastMainPageRef.current);
    }
  }, [navigateToPage]);

  const handleCloseCmeTutorial = useCallback(() => {
    localStorage.setItem(CME_TUTORIAL_KEY, 'true');
    setIsCmeTutorialOpen(false);
    setHighlightedElementId(null);
  }, []);

  const handleTutorialStepChange = useCallback((id: string | null) => {
    setHighlightedElementId(id);
  }, []);

  const handleForecastViewChange = useCallback(
    (mode: 'simple' | 'advanced') => {
      setForecastViewMode(mode);
      const url = new URL(window.location.href);
      url.pathname = PAGE_PATHS.forecast;
      url.search = '';
      url.searchParams.set('view', mode);
      navigateToPath(url.pathname + url.search);
    },
    [navigateToPath]
  );

  const handleDefaultMainPageChange = useCallback((page: 'forecast' | 'solar-activity' | 'modeler') => {
    setDefaultMainPage(page);
    localStorage.setItem(DEFAULT_MAIN_PAGE_KEY, page);
  }, []);

  const handleDefaultForecastViewChange = useCallback((view: 'simple' | 'advanced') => {
    setDefaultForecastView(view);
    localStorage.setItem(DEFAULT_FORECAST_VIEW_KEY, view);
  }, []);

  const handleDashboardModeChange = useCallback((enabled: boolean) => {
    setIsDashboardMode(enabled);
    localStorage.setItem(DASHBOARD_MODE_KEY, String(enabled));
  }, []);

  const handleOpenSettings = useCallback(() => {
    navigateToPath(SETTINGS_PATH);
  }, [navigateToPath]);

  const handleCloseSettings = useCallback(() => {
    setIsSettingsOpen(false);
    navigateToPage(lastMainPageRef.current);
  }, [navigateToPage]);

  const handleCloseDebug = useCallback(() => {
    setIsDebugOpen(false);
    navigateToPage(lastMainPageRef.current);
  }, [navigateToPage]);

  const handleOpenTutorial = useCallback(() => {
    setIsFirstVisitTutorialOpen(false);
    setIsCmeTutorialOpen(false);
    navigateToPath(TUTORIAL_PATH);
    setIsTutorialOpen(true);
  }, [navigateToPath]);

  const handleCloseTutorial = useCallback(() => {
    setIsTutorialOpen(false);
    if (window.location.pathname === TUTORIAL_PATH) {
      navigateToPage(lastMainPageRef.current);
    }
  }, [navigateToPage]);

  const getClockElapsedTime = useCallback(() => (performance.now() - clockStartRef.current) / 1000, []);
  const resetClock = useCallback(() => { clockStartRef.current = performance.now(); }, []);

  const getDefaultTimelineRange = useCallback((days: TimeRange) => {
    const endDate = new Date();
    const startDate = new Date(endDate);
    const futureDate = new Date(endDate);
    // Past follows the controls-panel date range (1d / 3d / 7d).
    startDate.setDate(endDate.getDate() - days);
    // Future is always fixed to 7 days so forecast horizon stays consistent.
    futureDate.setDate(endDate.getDate() + 7);
    return {
      minDate: startDate.getTime(),
      maxDate: futureDate.getTime(),
    };
  }, []);

  const getTimelineRangeFromData = useCallback((data: ProcessedCME[], days: TimeRange) => {
    if (data.length === 0) {
      return getDefaultTimelineRange(days);
    }

    const defaultRange = getDefaultTimelineRange(days);
    // Allow timeline to extend back if a CME started before the selected range,
    // but never shrink below the controls-panel lookback window.
    const earliestCMEStartTime = data.reduce((min: number, cme: ProcessedCME) => Math.min(min, cme.startTime.getTime()), defaultRange.minDate);

    return {
      minDate: Math.min(defaultRange.minDate, earliestCMEStartTime),
      maxDate: defaultRange.maxDate,
    };
  }, [getDefaultTimelineRange]);

  const getScrubberValueForNow = useCallback((minDate: number, maxDate: number): number => {
    if (maxDate <= minDate) return 0;
    const t = (Date.now() - minDate) / (maxDate - minDate);
    return Math.max(0, Math.min(1000, t * 1000));
  }, []);

  const loadCMEData = useCallback(async (days: TimeRange, options: { silent?: boolean } = {}) => {
    const { silent = false } = options;
    if (!silent) {
      setIsLoading(true);
      setCurrentlyModeledCMEId(null);
      setSelectedCMEForInfo(null);
      setTimelineActive(false);
      setTimelinePlaying(false);
      setTimelineScrubberValue(0);
      resetClock();
    }
    setFetchError(null);
    setDataVersion((v: number) => v + 1);
    try {
      const data = await fetchCMEData(days, apiKey);
      setCmeData(data);
      const { minDate, maxDate } = getTimelineRangeFromData(data, days);
      setTimelineMinDate(minDate);
      setTimelineMaxDate(maxDate);
      if (!currentlyModeledCMEId) {
        setTimelineScrubberValue(getScrubberValueForNow(minDate, maxDate));
      }
    } catch (err) {
      console.error(err);
      if (err instanceof Error && err.message.includes('429')) {
        setFetchError('NASA API rate limit exceeded. Please wait a moment and try again.');
      } else {
        setFetchError((err as Error).message || "Unknown error fetching data.");
      }
      setCmeData([]);
      const { minDate, maxDate } = getDefaultTimelineRange(days);
      setTimelineMinDate(minDate);
      setTimelineMaxDate(maxDate);
      if (!currentlyModeledCMEId) {
        setTimelineScrubberValue(getScrubberValueForNow(minDate, maxDate));
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
        if (initialPageRef.current === 'modeler') {
          markInitialTaskDone('modelerCmeData');
        }
      }
    }
  }, [resetClock, apiKey, markInitialTaskDone, getTimelineRangeFromData, getDefaultTimelineRange, currentlyModeledCMEId, getScrubberValueForNow]);


  useEffect(() => {
    if (initialLoadTasks.modelerCmeData) return;
    loadCMEData(activeTimeRange, { silent: true })
      .finally(() => {
        markInitialTaskDone('modelerCmeData');
        logDev('modeler preload complete');
      });
  }, [activeTimeRange, initialLoadTasks.modelerCmeData, loadCMEData, markInitialTaskDone]);

  const handleRefreshAppData = useCallback(async () => {
    setIsRefreshing(true);
    setManualRefreshKey((v) => v + 1);
    // Force CME data re-fetch regardless of page
    cmePageLoadedOnce.current = false;
    await Promise.allSettled([
      loadCMEData(activeTimeRange, { silent: true }),
    ]);
    cmePageLoadedOnce.current = true;
    setIsRefreshing(false);
  }, [activeTimeRange, loadCMEData]);


  useEffect(() => {
    if (!isDashboardMode) return;

    const runCycle = () => {
      loadCMEData(activeTimeRange, { silent: true });
      window.setTimeout(() => {
        setManualRefreshKey((v) => v + 1);
      }, 20000);
    };

    const interval = window.setInterval(runCycle, 60000);
    return () => window.clearInterval(interval);
  }, [isDashboardMode, activeTimeRange, loadCMEData]);

  const handleShowTutorial = useCallback(() => {
    setIsTutorialOpen(false);
    setIsCmeTutorialOpen(false);
    setIsFirstVisitTutorialOpen(true);
    navigateToPath(TUTORIAL_PATH);
  }, [navigateToPath]);

  useEffect(() => {
    if (activePage !== 'modeler') return;
    // Load CME data when navigating TO the modeler page (first time only).
    // There is NO auto-refresh ticker here — data only refreshes when:
    //   1. The user navigates to this page from another page (cmePageLoadedOnce resets on page leave)
    //   2. The user presses the manual refresh button (top-right)
    // This prevents mid-playback data updates that would reset the timeline controls.
    if (!cmePageLoadedOnce.current) {
      loadCMEData(activeTimeRange).then(() => {
        cmePageLoadedOnce.current = true;
      });
    }
  }, [activePage, activeTimeRange, loadCMEData]);

  // Reset loaded flag when leaving the modeler page so navigating back always gets fresh data
  useEffect(() => {
    if (activePage !== 'modeler') {
      cmePageLoadedOnce.current = false;
    }
  }, [activePage]);

  const handleTimeRangeChange = (range: TimeRange) => {
      setActiveTimeRange(range);
      loadCMEData(range);
  };

  const handleShowHssChange = useCallback((next: boolean) => {
    setShowHss(next);
    if (!next) setRerunAwaitingHssData(false);
  }, []);

  const filteredCmes = useMemo(() => { if (cmeFilter === CMEFilter.ALL) return cmeData; return cmeData.filter((cme: ProcessedCME) => cmeFilter === CMEFilter.EARTH_DIRECTED ? cme.isEarthDirected : !cme.isEarthDirected); }, [cmeData, cmeFilter]);
  
  const cmesToRender = useMemo(() => {
    if (currentlyModeledCMEId) {
      const selected = filteredCmes.find((c) => c.id === currentlyModeledCMEId);
      return selected ? [selected] : [];
    }
    return filteredCmes;
  }, [currentlyModeledCMEId, filteredCmes]);

  const shouldShowTimelineControls = activePage === 'modeler';

  useEffect(() => {
    if (!currentlyModeledCMEId) return;

    const ready = chDetectionStatus === 'detected' || chDetectionStatus === 'empty' || chDetectionStatus === 'error';
    if (!ready) return;

    setRerunToken((v) => v + 1);
    setRerunAwaitingHssData(false);
    resetClock();
  }, [currentlyModeledCMEId, chDetectionStatus, resetClock]);

  useEffect(() => { if (currentlyModeledCMEId && !filteredCmes.find((c: ProcessedCME) => c.id === currentlyModeledCMEId)) { setCurrentlyModeledCMEId(null); setSelectedCMEForInfo(null); } }, [filteredCmes, currentlyModeledCMEId]);

  useEffect(() => {
    if (!currentlyModeledCMEId) return;
    setRerunAwaitingHssData(true);
  }, [currentlyModeledCMEId]);

  // Auto-select CME from ?cme= URL param once data has loaded.
  // Uses a ref so the ID is never lost when navigation strips the URL param.
  // If not found in the current range, automatically expands to 7 days first
  // by directly calling loadCMEData — setting activeTimeRange alone is not
  // enough because the reload effects guard against re-running once done.
  useEffect(() => {
    const sharedId = initialSharedCmeIdRef.current;
    if (!sharedId) return;
    if (!cmeData || cmeData.length === 0) return;
    if (currentlyModeledCMEId === sharedId) {
      setSharedCmeSearching(false);
      return;
    }

    const found = cmeData.find((c: ProcessedCME) => c.id === sharedId);
    if (found) {
      setSharedCmeExpired(null);
      setSharedCmeSearching(false);
      handleSelectCMEForModeling(found);
      initialSharedCmeIdRef.current = null; // stop watching — user can change range freely now
    } else if (!sharedCmeRangeExpandedRef.current && activeTimeRange < TimeRange.D7) {
      // Not found in the current narrow window — expand to 7 days once only.
      // After this point the ref is set so user range changes won't be overridden.
      sharedCmeRangeExpandedRef.current = true;
      setSharedCmeSearching(true);
      setActiveTimeRange(TimeRange.D7);
      loadCMEData(TimeRange.D7, { silent: true });
    } else {
      // Already expanded or already at max range — genuinely expired or never existed
      setSharedCmeExpired(sharedId);
      setSharedCmeSearching(false);
      initialSharedCmeIdRef.current = null; // stop retrying
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmeData]);
  
  const handleViewChange = (view: ViewMode) => setActiveView(view);
  const handleFocusChange = (target: FocusTarget) => setActiveFocus(target);
  const handleResetView = useCallback(() => { setActiveView(ViewMode.TOP); setActiveFocus(FocusTarget.EARTH); canvasRef.current?.resetView(); }, []);
  
  const handleSelectCMEForModeling = useCallback((cme: ProcessedCME | null) => {
    setCurrentlyModeledCMEId(cme ? cme.id : null);
    setSelectedCMEForInfo(cme);
    // Write CME id to URL so it can be shared
    const url = new URL(window.location.href);
    if (cme) {
      url.searchParams.set('cme', cme.id);
    } else {
      url.searchParams.delete('cme');
    }
    window.history.replaceState({}, '', url.pathname + url.search);
    setIsCmeListOpen(false);

    if (cme) {
      setTimelineActive(true);
      setTimelinePlaying(true);
      setTimelineScrubberValue(0);
      setTimelineMinDate(cme.startTime.getTime());
      const minFutureDate = new Date(cme.startTime);
      minFutureDate.setDate(minFutureDate.getDate() + CME_SELECTION_FUTURE_DAYS);

      if (cme.predictedArrivalTime) {
        const predictedWindowEnd = cme.predictedArrivalTime.getTime() + (12 * 3600 * 1000);
        setTimelineMaxDate(Math.max(predictedWindowEnd, minFutureDate.getTime()));
      } else {
        setTimelineMaxDate(minFutureDate.getTime());
      }
    } else {
      setTimelineActive(false);
      setTimelinePlaying(false);
      const { minDate, maxDate } = getTimelineRangeFromData(cmeData, activeTimeRange);
      setTimelineMinDate(minDate);
      setTimelineMaxDate(maxDate);
      setTimelineScrubberValue(getScrubberValueForNow(minDate, maxDate));
    }
  }, [cmeData, activeTimeRange, getTimelineRangeFromData, getScrubberValueForNow]);

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
    setTimelineActive(true);

    if (timelineMaxDate <= timelineMinDate) {
      const source = filteredCmes.length > 0 ? filteredCmes : cmeData;
      const { minDate, maxDate } = source.length > 0
        ? {
            minDate: Math.min(...source.map((c) => c.startTime.getTime())),
            maxDate: Math.max(...source.map((c) => c.predictedArrivalTime?.getTime() ?? (c.startTime.getTime() + 72 * 3600_000))),
          }
        : getDefaultTimelineRange(activeTimeRange);
      setTimelineMinDate(minDate);
      setTimelineMaxDate(maxDate);
    }

    const isAtEnd = timelineScrubberValue >= 999;
    const isAtStart = timelineScrubberValue < 1;
    const isPlaying = timelinePlaying;

    if (isAtEnd) {
      setTimelineSpeed(5);
      setTimelineScrubberValue(0);
      resetClock();
      canvasRef.current?.resetAnimationTimer();
      setTimelinePlaying(true);
    } else if (!isPlaying) {
      setTimelineSpeed(5);
      if (isAtStart) {
        resetClock();
        canvasRef.current?.resetAnimationTimer();
      }
      setTimelinePlaying(true);
    } else {
      setTimelinePlaying(false);
    }
  }, [filteredCmes, cmeData, timelineScrubberValue, timelinePlaying, timelineMaxDate, timelineMinDate, resetClock, getDefaultTimelineRange, activeTimeRange]);

  const handleTimelineScrub = useCallback((value: number) => {
    setTimelineActive(true);
    setTimelinePlaying(false);
    setTimelineScrubberValue(value);
  }, []);

  const handleTimelineStep = useCallback((direction: -1 | 1) => {
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
  }, [timelineMinDate, timelineMaxDate]);

  const handleTimelineSetSpeed = useCallback((speed: number) => setTimelineSpeed(speed), []);
  const handleScrubberChangeByAnim = useCallback((value: number) => {
    if (timelinePlaying) return;
    setTimelineScrubberValue(value);
  }, [timelinePlaying]);
  const handleTimelineEnd = useCallback(() => setTimelinePlaying(false), []);
  useEffect(() => {
    if (!timelineActive || !timelinePlaying) return;

    const timelineRangeMs = timelineMaxDate - timelineMinDate;
    if (timelineRangeMs <= 0) return;

    let animationFrameId = 0;
    let lastTickAt = performance.now();

    const tick = (now: number) => {
      const deltaSeconds = (now - lastTickAt) / 1000;
      lastTickAt = now;

      setTimelineScrubberValue((prev) => {
        if (prev >= 1000) {
          setTimelinePlaying(false);
          return 1000;
        }

        const next = prev + (deltaSeconds * (3 * timelineSpeed * 3600 * 1000) / timelineRangeMs) * 1000;
        if (next >= 1000) {
          setTimelinePlaying(false);
          return 1000;
        }
        return next;
      });

      animationFrameId = window.requestAnimationFrame(tick);
    };

    animationFrameId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [timelineActive, timelinePlaying, timelineSpeed, timelineMinDate, timelineMaxDate]);

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

  // --- NEW: Handler for opening the impact graph modal ---
  const handleOpenImpactGraph = useCallback(() => {
    if (canvasRef.current) {
      const data = canvasRef.current.calculateImpactProfile();
      if (data) {
        setImpactGraphData(data);
        setIsImpactGraphOpen(true);
      }
    }
  }, []);

  const handleViewCMEInVisualization = useCallback((cmeId: string) => {
    navigateToPage('modeler');
    const cmeToModel = cmeData.find(cme => cme.id === cmeId);
    if (cmeToModel) {
      handleSelectCMEForModeling(cmeToModel);
    }
    setIsCmeListOpen(true);
  }, [cmeData, handleSelectCMEForModeling, navigateToPage]);

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
      markInitialTaskDone('forecastData');
  }, [markInitialTaskDone]);

  const handleForecastLoadPoint = useCallback((task: ForecastLoadPoint) => {
    markInitialTaskDone(task);
  }, [markInitialTaskDone]);

  const handleSolarInitialLoad = useCallback(() => {
      markInitialTaskDone('solarData');
  }, [markInitialTaskDone]);

  const handleSolarLoadPoint = useCallback((task: SolarLoadPoint) => {
    markInitialTaskDone(task);
  }, [markInitialTaskDone]);
  
  return (
    <>
      {showInitialLoader && (
        <InitialLoadingScreen
          isFadingOut={isFadingOut}
          progress={initialLoadProgress}
          statusText={initialLoadStatus}
          reloadNotice={reloadNotice}
          reloadCountdown={reloadCountdown}
        />
      )}
      <div className={`w-screen h-screen bg-black flex flex-col text-neutral-300 overflow-hidden transition-opacity duration-300 ${showInitialLoader ? 'opacity-0' : 'opacity-100'}`}>
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
          {showDocumentation && (
            <AppDocumentation onClose={() => setShowDocumentation(false)} />
          )}
          <OnboardingBanner
              deferredInstallPrompt={deferredInstallPrompt}
              onInstallClick={handleInstallClick}
          />

          <header className="flex-shrink-0 p-1.5 md:p-3 bg-gradient-to-r from-black/80 via-neutral-900/80 to-black/70 backdrop-blur-xl border-b border-white/10 flex items-center gap-2 sm:gap-3 relative z-[2001] shadow-2xl soft-appear">
              <div className={`flex-1 min-w-0 ${isDashboardMode ? 'hidden' : ''}`}>
                  <div className="flex flex-nowrap items-stretch justify-start gap-1 sm:gap-2 max-w-full overflow-hidden">
                      <button
                        id="nav-forecast"
                        onClick={() => navigateToPage('forecast')}
                        className={`min-w-0 flex-1 basis-[31%] max-w-[33%] sm:flex-none sm:max-w-none overflow-hidden flex items-center gap-0.5 sm:gap-1 px-1 py-0.5 sm:px-1.5 sm:py-1 rounded-lg sm:rounded-xl text-neutral-50 font-semibold shadow-xl transition-all active:scale-95 backdrop-blur-lg border modern-cta ${activePage === 'forecast' ? 'bg-gradient-to-r from-sky-500/80 via-sky-400/80 to-indigo-500/80 border-white/30 ring-2 ring-white/40 drop-shadow-lg' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${highlightedElementId === 'nav-forecast' ? 'tutorial-highlight' : ''}`}
                        title="View Live Aurora Forecasts"
                      >
                          <div className="w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-md sm:rounded-lg bg-white/10 border border-white/15 shadow-inner flex items-center justify-center overflow-hidden flex-shrink-0">
                            <AuroraBadgeIcon className="w-3 h-3 sm:w-4.5 sm:h-4.5" />
                          </div>
                          <div className="flex flex-col items-start leading-[1.05] min-w-0 w-full">
                            <span className="text-[6px] sm:text-[8px] uppercase tracking-[0.18em] text-white/70 truncate">Forecast</span>
                            <span className="text-[8px] sm:text-[10px] font-semibold text-white truncate">Aurora Forecast</span>
                          </div>
                      </button>
                      <button
                        id="nav-solar-activity"
                        onClick={() => navigateToPage('solar-activity')}
                        className={`min-w-0 flex-1 basis-[31%] max-w-[33%] sm:flex-none sm:max-w-none overflow-hidden flex items-center gap-0.5 sm:gap-1 px-1 py-0.5 sm:px-1.5 sm:py-1 rounded-lg sm:rounded-xl text-neutral-50 font-semibold shadow-xl transition-all active:scale-95 backdrop-blur-lg border modern-cta ${activePage === 'solar-activity' ? 'bg-gradient-to-r from-emerald-400/80 via-teal-400/80 to-cyan-400/80 border-white/30 ring-2 ring-white/40 drop-shadow-lg' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${highlightedElementId === 'nav-solar-activity' ? 'tutorial-highlight' : ''}`}
                        title="View Solar Activity"
                      >
                          <div className="w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-md sm:rounded-lg bg-white/10 border border-white/15 shadow-inner flex items-center justify-center overflow-hidden flex-shrink-0">
                            <SolarBadgeIcon className="w-3 h-3 sm:w-4.5 sm:h-4.5" />
                          </div>
                          <div className="flex flex-col items-start leading-[1.05] min-w-0 w-full">
                            <span className="text-[6px] sm:text-[8px] uppercase tracking-[0.18em] text-white/70 truncate">Dashboard</span>
                            <span className="text-[8px] sm:text-[10px] font-semibold text-white truncate">Solar Activity</span>
                          </div>
                      </button>
                      <button
                        id="nav-modeler"
                        onClick={() => navigateToPage('modeler')}
                        className={`min-w-0 flex-1 basis-[31%] max-w-[33%] sm:flex-none sm:max-w-none overflow-hidden flex items-center gap-0.5 sm:gap-1 px-1 py-0.5 sm:px-1.5 sm:py-1 rounded-lg sm:rounded-xl text-neutral-50 font-semibold shadow-xl transition-all active:scale-95 backdrop-blur-lg border modern-cta ${activePage === 'modeler' ? 'bg-gradient-to-r from-indigo-500/80 via-purple-500/80 to-fuchsia-500/80 border-white/30 ring-2 ring-white/40 drop-shadow-lg' : 'bg-white/5 border-white/10 hover:bg-white/10'} ${highlightedElementId === 'nav-modeler' ? 'tutorial-highlight' : ''}`}
                        title="View CME Visualization"
                      >
                          <div className="w-3.5 h-3.5 sm:w-5 sm:h-5 rounded-md sm:rounded-lg bg-white/10 border border-white/15 shadow-inner flex items-center justify-center overflow-hidden flex-shrink-0">
                            <ModelerBadgeIcon className="w-3 h-3 sm:w-4.5 sm:h-4.5" />
                          </div>
                          <div className="flex flex-col items-start leading-[1.05] min-w-0 w-full">
                            <span className="text-[6px] sm:text-[8px] uppercase tracking-[0.18em] text-white/70 truncate">3D Lab</span>
                            <span className="text-[8px] sm:text-[10px] font-semibold text-white truncate">CME Visualization</span>
                          </div>
                      </button>
                  </div>
              </div>
              <div className="flex items-center gap-1.5 sm:gap-2">
                  {isDashboardMode && (
                    <button
                      onClick={() => handleDashboardModeChange(false)}
                      className="px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl text-xs sm:text-sm text-white shadow-xl transition-all active:scale-95 bg-gradient-to-r from-rose-500/70 to-orange-500/70 border border-white/20 hover:-translate-y-0.5 modern-cta"
                      title="Exit Dashboard Mode"
                    >
                      Exit Dashboard
                    </button>
                  )}
                  <button
                    onClick={handleRefreshAppData}
                    className={`p-1.5 sm:p-2 rounded-xl text-white shadow-xl transition-all active:scale-95 bg-gradient-to-r from-white/15 via-white/10 to-white/5 border border-white/15 hover:-translate-y-0.5 modern-cta ${isRefreshing ? 'opacity-80' : ''}`}
                    title="Refresh data"
                    aria-label="Refresh data"
                  >
                    <RefreshIcon className={`w-3.5 h-3.5 sm:w-4 sm:h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    id="nav-settings"
                    onClick={handleOpenSettings}
                    className={`p-1.5 sm:p-2 rounded-xl text-white shadow-xl transition-all active:scale-95 bg-gradient-to-r from-white/15 via-white/10 to-white/5 border border-white/15 hover:-translate-y-0.5 modern-cta ${highlightedElementId === 'nav-settings' ? 'tutorial-highlight' : ''}`}
                    title="Open Settings"
                  >
                    <SettingsIcon className="w-3 h-3 sm:w-4 sm:h-4" />
                  </button>
              </div>
          </header>

          <div className="flex flex-grow min-h-0">
              {isDashboardMode ? (
                <Suspense fallback={null}>
                  <UnifiedDashboardMode refreshSignal={manualRefreshKey} />
                </Suspense>
              ) : (
              <>
              {visitedPages.modeler && activePage === 'modeler' && (
              <Suspense fallback={null}>
              <div className="w-full h-full flex-grow min-h-0 flex">
                <div id="controls-panel-container" className={`flex-shrink-0 lg:p-5 lg:w-auto lg:max-w-xs fixed top-[4.25rem] left-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isControlsOpen ? 'translate-x-0' : '-translate-x-full'} lg:relative lg:top-auto lg:left-auto lg:h-auto lg:transform-none`}>
                    <ControlsPanel activeTimeRange={activeTimeRange} onTimeRangeChange={handleTimeRangeChange} activeView={activeView} onViewChange={handleViewChange} activeFocus={activeFocus} onFocusChange={handleFocusChange} isLoading={isLoading} onClose={() => setIsControlsOpen(false)} onOpenGuide={handleOpenTutorial} showLabels={showLabels} onShowLabelsChange={setShowLabels} showExtraPlanets={showExtraPlanets} onShowExtraPlanetsChange={setShowExtraPlanets} showMoonL1={showMoonL1} onShowMoonL1Change={setShowMoonL1} cmeFilter={cmeFilter} onCmeFilterChange={setCmeFilter} showFluxRope={showFluxRope} onShowFluxRopeChange={setShowFluxRope} showHss={showHss} onShowHssChange={handleShowHssChange} chDetectionStatus={chDetectionStatus} />
                </div>

                <main id="simulation-canvas-main" className="flex-1 relative min-w-0 h-full">
                    {/* Shared CME — searching or not found */}
                    {sharedCmeSearching && !sharedCmeExpired && (
                      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
                        <div className="bg-sky-900/90 border border-sky-600/60 rounded-xl p-4 shadow-2xl backdrop-blur-sm">
                          <div className="flex items-center gap-3">
                            <span className="text-2xl flex-shrink-0 animate-pulse">🔭</span>
                            <div>
                              <p className="text-sky-200 font-semibold text-sm">Looking for shared CME…</p>
                              <p className="text-sky-300/80 text-xs mt-1">Expanding search window to find this CME.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {sharedCmeExpired && (
                      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
                        <div className="bg-amber-900/90 border border-amber-600/60 rounded-xl p-4 shadow-2xl backdrop-blur-sm">
                          <div className="flex items-start gap-3">
                            <span className="text-2xl flex-shrink-0">⏱️</span>
                            <div>
                              <p className="text-amber-200 font-semibold text-sm">CME not found</p>
                              <p className="text-amber-300/80 text-xs mt-1">This shared CME no longer exists in the available data. CME visualizations are only valid for up to 7 days after the eruption. You can browse recent CMEs using the list below.</p>
                              <button
                                onClick={() => setSharedCmeExpired(null)}
                                className="mt-2 text-xs text-amber-400 hover:text-amber-200 underline"
                              >Browse recent CMEs</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Share this CME button */}
                    {currentlyModeledCMEId && !sharedCmeExpired && (() => {
                      const shareUrl = `${window.location.origin}/cme-visualization?cme=${encodeURIComponent(currentlyModeledCMEId)}`;
                      return (
                        <div className="absolute top-4 right-4 z-50">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(shareUrl).then(() => {
                                const btn = document.getElementById('share-cme-btn');
                                if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '🔗 Share CME'; }, 2000); }
                              });
                            }}
                            id="share-cme-btn"
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-black/60 border border-white/20 text-white hover:bg-black/80 backdrop-blur-sm transition-colors shadow-lg"
                          >
                            🔗 Share CME
                          </button>
                        </div>
                      );
                    })()}
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
                        showHss={showHss}
                        coronalHoles={coronalHoles}
                        chDetectedAtMs={lastDetectedAt?.getTime() ?? null}
                        chEvolutions={chEvolutions}
                        dataVersion={dataVersion}
                        interactionMode={InteractionMode.MOVE}
                        onSunClick={handleOpenGame}
                        measuredWindSpeedKms={measuredWindSpeedKms}
                        rerunToken={rerunToken}
                        rerunHssInteraction={rerunHssInteraction}
                    />
                    {showLabels && rendererDomElement && threeCamera && planetLabelInfos.filter((info: PlanetLabelInfo) => { const name = info.name.toUpperCase(); if (['MERCURY', 'VENUS', 'MARS'].includes(name)) return showExtraPlanets; if (['MOON', 'L1'].includes(name)) return showMoonL1; return true; }).map((info: PlanetLabelInfo) => (<PlanetLabel key={info.id} planetMesh={info.mesh} camera={threeCamera} rendererDomElement={rendererDomElement} label={info.name} sunMesh={sunInfo ? sunInfo.mesh : null} /> ))}
                    <div className="absolute top-0 left-0 right-0 z-40 flex items-start justify-between p-4 pointer-events-none">
                        <div className="flex items-start text-center space-x-3 pointer-events-auto">
                            <div className="flex flex-col items-center w-16 lg:hidden">
                                <button
                                  id="mobile-controls-button"
                                  onClick={() => setIsControlsOpen(true)}
                                  className="p-3 rounded-2xl bg-white/10 border border-white/15 text-white shadow-xl backdrop-blur-xl active:scale-95 transition-transform hover:-translate-y-0.5"
                                  title="Open Settings"
                                >
                                    <SettingsIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-200/80 mt-1">Settings</span>
                            </div>
                            <div className="flex flex-col items-center w-16">
                                <button
                                  id="reset-view-button"
                                  onClick={handleResetView}
                                  className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500/70 via-purple-500/70 to-fuchsia-500/70 border border-white/20 text-white shadow-xl backdrop-blur-xl active:scale-95 transition-transform hover:-translate-y-0.5"
                                  title="Reset View"
                                >
                                    <CameraResetIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-200/80 mt-1 lg:hidden">Reset Camera</span>
                            </div>
                            <div className="flex flex-col items-center w-16">
                                <button
                                  id="forecast-models-button"
                                  onClick={() => setIsForecastModelsModalOpen(true)}
                                  className="p-3 rounded-2xl bg-gradient-to-br from-sky-500/70 via-cyan-500/70 to-emerald-500/70 border border-white/20 text-white shadow-xl backdrop-blur-xl active:scale-95 transition-transform hover:-translate-y-0.5"
                                  title="Open CME Forecast Models"
                                >
                                    <GlobeIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-200/80 mt-1 lg:hidden">Forecast Models</span>
                            </div>
                        </div>
                        <div className="flex items-start text-center space-x-3 pointer-events-auto">
                            <div className="flex flex-col items-center w-16 lg:hidden">
                                <button
                                  id="mobile-cme-list-button"
                                  onClick={() => setIsCmeListOpen(true)}
                                  className="p-3 rounded-2xl bg-white/10 border border-white/15 text-white shadow-xl backdrop-blur-xl active:scale-95 transition-transform hover:-translate-y-0.5"
                                  title="Open CME List"
                                >
                                    <ListIcon className="w-6 h-6" />
                                </button>
                                <span className="text-xs text-neutral-200/80 mt-1">CME List</span>
                            </div>
                        </div>
                    </div>
                </main>

                <div id="cme-list-panel-container" className={`flex-shrink-0 lg:p-5 lg:w-auto lg:max-w-md fixed top-[4.25rem] right-0 h-[calc(100vh-4.25rem)] w-4/5 max-w-[320px] z-[2005] transition-transform duration-300 ease-in-out ${isCmeListOpen ? 'translate-x-0' : 'translate-x-full'} lg:relative lg:top-auto lg:right-auto lg:h-auto lg:transform-none`}>
                    <CMEListPanel cmes={filteredCmes} onSelectCME={handleSelectCMEForModeling} selectedCMEId={currentlyModeledCMEId} selectedCMEForInfo={selectedCMEForInfo} isLoading={isLoading} fetchError={fetchError} onClose={() => setIsCmeListOpen(false)} />
                </div>
                  
                  {(isControlsOpen || isCmeListOpen) && (<div className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[2004]" onClick={() => { setIsControlsOpen(false); setIsCmeListOpen(false); }} />)}
                  {isLoading && activePage === 'modeler' && <LoadingOverlay />}
                  <TutorialModal isOpen={isTutorialOpen} onClose={handleCloseTutorial} />
              </div>
              </Suspense>
              )}
              {visitedPages.forecast && (
                <div className={`w-full h-full ${activePage === 'forecast' ? 'block' : 'hidden'}`}>
                  <Suspense fallback={null}>
                    <ForecastDashboard
                        setViewerMedia={setViewerMedia}
                        setCurrentAuroraScore={setCurrentAuroraScore}
                        setSubstormActivityStatus={setSubstormActivityStatus}
                        setIpsAlertData={setIpsAlertData}
                        setMeasuredWindSpeedKms={setMeasuredWindSpeedKms}
                        navigationTarget={navigationTarget}
                        onInitialLoad={handleInitialLoad}
                        onInitialLoadProgress={handleForecastLoadPoint}
                        viewMode={forecastViewMode}
                        onViewModeChange={handleForecastViewChange}
                        refreshSignal={manualRefreshKey}
                    />
                  </Suspense>
                </div>
              )}
              {visitedPages['solar-activity'] && (
                <div className={`w-full h-full ${activePage === 'solar-activity' ? 'block' : 'hidden'}`}>
                  <Suspense fallback={null}>
                    <SolarActivityDashboard
                        setViewerMedia={setViewerMedia}
                        setLatestXrayFlux={setLatestXrayFlux}
                        onViewCMEInVisualization={handleViewCMEInVisualization}
                        onSuvi195ImageUrlChange={setSharedSuvi195Url}
                        navigationTarget={navigationTarget}
                        refreshSignal={manualRefreshKey}
                        onInitialLoad={handleSolarInitialLoad}
                        onInitialLoadProgress={handleSolarLoadPoint}
                    />
                  </Suspense>
                </div>
              )}
              </>
              )}
          </div>

          {/* TimelineControls rendered at top-level — outside all Suspense boundaries and
              stacking contexts so position:fixed works correctly on desktop AND mobile. */}
          <Suspense fallback={null}>
            <TimelineControls
              isVisible={shouldShowTimelineControls}
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
          </Suspense>

          <Suspense fallback={null}>
            <MediaViewerModal media={viewerMedia} onClose={() => setViewerMedia(null)} />
          </Suspense>
          <Suspense fallback={null}>
            <SettingsModal
              isOpen={isSettingsOpen}
              onClose={handleCloseSettings}
              appVersion={APP_VERSION}
              onShowTutorial={handleShowTutorial}
              onOpenDocumentation={() => { setShowDocumentation(true); handleCloseSettings(); }}
              defaultMainPage={defaultMainPage}
              defaultForecastView={defaultForecastView}
              onDefaultMainPageChange={handleDefaultMainPageChange}
              onDefaultForecastViewChange={handleDefaultForecastViewChange}
              pageViewStats={pageViewStats}
              pageViewStorageMode={pageViewStorageMode}
            />
          </Suspense>
          
          <Suspense fallback={null}>
            <DebugPanel isOpen={isDebugOpen} onClose={handleCloseDebug} />
          </Suspense>

          <Suspense fallback={null}>
            <FirstVisitTutorial
                isOpen={isFirstVisitTutorialOpen}
                onClose={handleCloseFirstVisitTutorial}
                onStepChange={handleTutorialStepChange}
            />
          </Suspense>

          <Suspense fallback={null}>
            <CmeModellerTutorial
                isOpen={isCmeTutorialOpen}
                onClose={handleCloseCmeTutorial}
                onStepChange={handleTutorialStepChange}
            />
          </Suspense>

          <Suspense fallback={null}>
            <ForecastModelsModal
                isOpen={isForecastModelsModalOpen}
                onClose={() => setIsForecastModelsModalOpen(false)}
                setViewerMedia={setViewerMedia}
            />
          </Suspense>

          <Suspense fallback={null}>
            {/* --- NEW: Render the ImpactGraphModal --- */}
            <ImpactGraphModal
              isOpen={isImpactGraphOpen}
              onClose={() => setIsImpactGraphOpen(false)}
              data={impactGraphData}
            />

            {isGameOpen && <SolarSurferGame onClose={handleCloseGame} />}
          </Suspense>

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
