// --- START OF FILE App.tsx ---

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';

// Page Components (will be created in next steps)
import ModelerPage from './pages/ModelerPage';
import ForecastPage from './pages/ForecastPage';
import SolarActivityPage from './pages/SolarActivityPage';

// Shared Components
import Header from './components/Header'; // A new component for navigation
import MediaViewerModal from './components/MediaViewerModal';
import SettingsModal from './components/SettingsModal';
import FirstVisitTutorial from './components/FirstVisitTutorial';
import GlobalBanner from './components/GlobalBanner';
import { SubstormActivity } from './types';

// Viewer Media Type
type ViewerMedia =
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'animation', urls: string[] };

// --- CONSTANTS ---
const NAVIGATION_TUTORIAL_KEY = 'hasSeenNavigationTutorial_v1';
const APP_VERSION = 'V1.0';

const App: React.FC = () => {
  // --- State for shared components (modals, global banner data) ---
  const [viewerMedia, setViewerMedia] = useState<ViewerMedia | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFirstVisitTutorialOpen, setIsFirstVisitTutorialOpen] = useState(false);
  const [highlightedElementId, setHighlightedElementId] = useState<string | null>(null);
  
  // State to pass data up from child pages to the global banner
  const [latestXrayFlux, setLatestXrayFlux] = useState<number | null>(null);
  const [currentAuroraScore, setCurrentAuroraScore] = useState<number | null>(null);
  const [substormActivityStatus, setSubstormActivityStatus] = useState<SubstormActivity | null>(null);

  // --- In-app browser detection (remains global) ---
  const [showIabBanner, setShowIabBanner] = useState(false);
  const [isIOSIab, setIsIOSIab] = useState(false);
  const [isAndroidIab, setIsAndroidIab] = useState(false);
  const deferredInstallPromptRef = useRef<any>(null);
  const CANONICAL_ORIGIN = 'https://www.spottheaurora.co.nz';

  const location = useLocation();

  useEffect(() => {
    // Scroll to top on page change
    window.scrollTo(0, 0);
  }, [location.pathname]);

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
  }, [isAndroidIab, location]);

  const handleIabCopyLink = useCallback(async () => {
    const url = window.location.href.split('#')[0];
    try {
      await navigator.clipboard.writeText(url);
      alert('Link copied. Open it in your browser to install.');
    } catch {
      prompt('Copy this URL:', url);
    }
  }, []);

  // --- Tutorial Logic ---
  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem(NAVIGATION_TUTORIAL_KEY);
    if (!hasSeenTutorial) {
      setIsFirstVisitTutorialOpen(true);
    }
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

  // --- Banner Alert Calculation ---
  const isFlareAlert = useMemo(() => latestXrayFlux !== null && latestXrayFlux >= 1e-5, [latestXrayFlux]);
  const flareClass = useMemo(() => { if (latestXrayFlux === null) return undefined; if (latestXrayFlux >= 1e-4) return `X${(latestXrayFlux / 1e-4).toFixed(1)}`; if (latestXrayFlux >= 1e-5) return `M${(latestXrayFlux / 1e-5).toFixed(1)}`; return undefined; }, [latestXrayFlux]);
  const isAuroraAlert = useMemo(() => currentAuroraScore !== null && currentAuroraScore >= 50, [currentAuroraScore]);
  const isSubstormAlert = useMemo(() =>
    substormActivityStatus?.isStretching &&
    !substormActivityStatus?.isErupting &&
    (substormActivityStatus.probability ?? 0) > 0,
  [substormActivityStatus]);

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
      />

      <Header 
        onOpenSettings={() => setIsSettingsOpen(true)}
        highlightedElementId={highlightedElementId}
      />

      <div className="flex-grow min-h-0">
        <Routes>
          <Route path="/" element={
            <ForecastPage
              setViewerMedia={setViewerMedia}
              setCurrentAuroraScore={setCurrentAuroraScore}
              setSubstormActivityStatus={setSubstormActivityStatus}
            />
          } />
          <Route path="/solar-activity" element={
            <SolarActivityPage
              setViewerMedia={setViewerMedia}
              setLatestXrayFlux={setLatestXrayFlux}
            />
          } />
          <Route path="/3d-cme-visualization" element={
            <ModelerPage setViewerMedia={setViewerMedia} />
          } />
        </Routes>
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

      {/* --- In-app browser (FB/IG) guidance banner --- */}
      {showIabBanner && (
        <div
          className="pointer-events-auto"
          style={{
            position: 'fixed', left: '1rem', right: '1rem', bottom: '1rem', zIndex: 2147483647, background: '#171717', color: '#fff',
            border: '1px solid #2a2a2a', borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.45)', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
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
              aria-label="Close" onClick={() => setShowIabBanner(false)}
              style={{ background: 'transparent', border: 0, color: '#bbb', fontSize: 20, lineHeight: 1, cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <a
              href="#" onClick={(e) => { e.preventDefault(); handleIabOpenInBrowser(); }}
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