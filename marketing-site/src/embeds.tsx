/* Spot The Aurora, marketing site
   Real embeds. These mount the app's own components, imported straight from the
   app source next door, so there is one implementation of each model rather than
   a copy that can drift.

     CME scene + coronal holes -> @app/components/SimulationCanvas
     Coronal hole detection    -> @app/hooks/useCoronalHoles
     Magnetotail               -> @app/components/MagnetotailStatus
     Forecast data             -> @app/hooks/useForecastData
     Sunspot + CH trackers     -> @app/components/SolarActivityDashboard (embed mode)
     Advanced View panels      -> @app/components/AdvancedForecastPanels
     The whole app, per device -> the live app in a frame, with ?embed

   Mount points are plain divs in the static HTML:
     <div data-app-embed="cme"></div>
     <div data-app-embed="coronalhole"></div>
     <div data-app-embed="magnetotail"></div>
     <div data-app-embed="forecast"></div>
     <div data-app-embed="solartrackers"></div>
     <div data-app-embed="advanced"></div>
     <div data-app-embed="moonarc"></div>
     <div data-app-embed="substorm"></div>
     <div data-app-embed="devices"></div>
*/
import './embed.css';
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

import SimulationCanvas from '@app/components/SimulationCanvas';
import MagnetotailStatus from '@app/components/MagnetotailStatus';
import MediaViewerModal from '@app/components/MediaViewerModal';
import { useCoronalHoles } from '@app/hooks/useCoronalHoles';
import { useForecastData } from '@app/hooks/useForecastData';
import {
  getGaugeStyle, ImfPanel, HemisphericPowerPanel, SolarWindSpeedPanel, SolarWindDensityPanel,
  MoonArcPanel, SubstormIndexPanel,
} from '@app/components/AdvancedForecastPanels';
import { fetchCMEData } from '@app/services/nasaService';
import { ViewMode, FocusTarget, InteractionMode } from '@app/types';
import type { ProcessedCME, PlanetLabelInfo } from '@app/types';

const APP_URL = 'https://www.spottheaurora.co.nz';

// No controls on these embeds. They loop: 3 days of history, 4 days ahead, 5x speed.
const DAYS_OF_CMES = 3;
const FUTURE_DAYS = 4;
const LOOP_SPEED = 5;

/* SimulationCanvas loads Three, OrbitControls and GSAP itself, and its
   loadScript resolves as soon as a <script> with that src exists in the DOM,
   whether or not it has finished loading. The app only ever mounts one scene so
   that is fine there. This page mounts two, and they raced: the second saw the
   first one's three.min.js tag, resolved immediately, and injected OrbitControls
   before THREE existed, which left both canvases blank.

   So we load the same three files once, strictly in order, before mounting any
   scene. By the time SimulationCanvas runs its own loader the globals are real
   and its early-exit is safe. */
const THREE_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js',
  'https://cdn.jsdelivr.net/npm/gsap@3.12.2/dist/gsap.min.js'
];
let threePromise: Promise<void> | null = null;
function ensureThree(): Promise<void> {
  if (threePromise) return threePromise;
  threePromise = THREE_URLS.reduce(
    (chain, src) => chain.then(() => new Promise<void>((resolve, reject) => {
      const el = document.createElement('script');
      el.src = src;
      el.async = false;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(el);
    })),
    Promise.resolve()
  );
  return threePromise;
}

/* Two WebGL scenes on one page is a lot for a phone, so a scene is only
   mounted once it scrolls into view. */
function useInView<T extends HTMLElement>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return;
    if (!('IntersectionObserver' in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '250px' });
    io.observe(node);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}


/* ------------------------------------------------------------------ *
 * Shared forecast data.
 *
 * useForecastData does NOT fetch on its own. In the app, ForecastDashboard
 * calls fetchAllData(true, getGaugeStyle) in an effect and then re-runs it on a
 * ticker. Nothing here was doing that, so the hook sat at isLoading forever and
 * both the forecast and the magnetotail stayed on their loading messages.
 *
 * One provider runs the hook and calls fetchAllData, and both embeds subscribe,
 * so the whole page makes one set of requests rather than two.
 * ------------------------------------------------------------------ */
type Forecast = ReturnType<typeof useForecastData>;
let latest: Forecast | null = null;
const listeners = new Set<(d: Forecast) => void>();
function publish(d: Forecast) { latest = d; listeners.forEach(fn => fn(d)); }

function useSharedForecast(): Forecast | null {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force(n => n + 1);
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);
  return latest;
}

function ForecastProvider() {
  const [, setScore] = useState<number | null>(null);
  const [, setActivity] = useState<any>(null);
  const d = useForecastData(setScore as any, setActivity as any);

  useEffect(() => {
    let alive = true;
    const run = (first: boolean) => { if (alive) d.fetchAllData(first, getGaugeStyle); };
    run(true);
    const id = setInterval(() => run(false), 60000);
    return () => { alive = false; clearInterval(id); };
  }, [d.fetchAllData]);

  useEffect(() => { publish(d); });
  return null;
}

/* ------------------------------------------------------------------ *
 * Shared: the app's 3D scene, configured per embed.
 * ------------------------------------------------------------------ */
function SceneEmbed({
  showHss, showExtraPlanets, caption
}: { showHss: boolean; showExtraPlanets: boolean; caption: string }) {
  const [hostRef, inView] = useInView<HTMLDivElement>();
  const [libsReady, setLibsReady] = useState(false);
  /* Same live inputs the app hands the scene. bzSouth colours the Bz indicator,
     and the measured wind speed calibrates the drag model, which is what makes a
     CME decelerate correctly. Earth's day, normal, specular and cloud textures
     and the auroral oval shader are built into SimulationCanvas itself and need
     no props: the oval brightens on CME impact through its own uniforms. */
  const fc = useSharedForecast();
  const latestBz = fc && fc.allMagneticData && fc.allMagneticData.length
    ? fc.allMagneticData[fc.allMagneticData.length - 1].bz : null;
  const latestSpeed = fc && fc.allSpeedData && fc.allSpeedData.length
    ? fc.allSpeedData[fc.allSpeedData.length - 1].y : undefined;
  /* SIDE view with the Earth focus is the app's own "behind Earth, looking at
     the Sun" camera (see moveCamera in SimulationCanvas: Sun -> Earth -> Camera).
     That effect only runs when activeView or focusTarget change, and on mount the
     scene does not exist yet, so the focus is applied once the libraries are up. */
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const [cmeData, setCmeData] = useState<ProcessedCME[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!inView) return;
    let alive = true;
    ensureThree()
      .then(() => { if (alive) setLibsReady(true); })
      .catch(() => { if (alive) setError('3D libraries unavailable'); });
    return () => { alive = false; };
  }, [inView]);

  // Coronal holes come from the app's real SUVI detector, which runs the whole
  // ten step pipeline in the browser. Only enabled where the embed shows them.
  const { coronalHoles, lastDetectedAt, chEvolutions } = useCoronalHoles({ enabled: showHss });

  useEffect(() => {
    if (!inView) return;
    let alive = true;
    fetchCMEData(DAYS_OF_CMES, 'DEMO_KEY')
      .then(d => { if (alive) { setCmeData(d); setReady(true); } })
      .catch(() => { if (alive) setError('CME data unavailable'); });
    const id = setInterval(() => {
      fetchCMEData(DAYS_OF_CMES, 'DEMO_KEY').then(d => { if (alive) setCmeData(d); }).catch(() => {});
    }, 15 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [inView]);

  // The timeline runs on a loop so the embed always has something moving,
  // rather than sitting on a single frozen frame.
  const minDate = useMemo(() => Date.now() - DAYS_OF_CMES * 86400000, []);
  const maxDate = useMemo(() => Date.now() + FUTURE_DAYS * 86400000, []);
  const [scrub, setScrub] = useState(0);
  const clockStart = useRef(performance.now());
  const getClockElapsedTime = useCallback(() => (performance.now() - clockStart.current) / 1000, []);
  const resetClock = useCallback(() => { clockStart.current = performance.now(); }, []);

  /* Applying the focus on a timer was racy: moveCamera bails if the camera and
     controls do not exist yet. onCameraReady is the component's own signal that
     the scene is built, so the focus is applied from there instead. */
  const handleCameraReady = useCallback(() => {
    setFocus(f => (f === FocusTarget.EARTH ? f : FocusTarget.EARTH));
  }, []);

  const noop = useCallback(() => {}, []);
  const setLabels = useCallback((_: PlanetLabelInfo[]) => {}, []);
  const setDom = useCallback((_: HTMLCanvasElement | null) => {}, []);

  return (
    <>
      <div className="embed-stage" ref={hostRef}>
        {!(ready && libsReady) && !error && <div className="embed-note">Loading the live scene</div>}
        {error && <div className="embed-note">{error}</div>}
        {libsReady && <SimulationCanvas
          cmeData={cmeData}
          activeView={ViewMode.SIDE}
          focusTarget={focus}
          currentlyModeledCMEId={null}
          onCMEClick={noop as any}
          timelineActive={true}
          timelinePlaying={true}
          timelineSpeed={LOOP_SPEED}
          timelineValue={scrub}
          timelineMinDate={minDate}
          timelineMaxDate={maxDate}
          setPlanetMeshesForLabels={setLabels}
          setRendererDomElement={setDom}
          onCameraReady={handleCameraReady}
          getClockElapsedTime={getClockElapsedTime}
          resetClock={resetClock}
          onScrubberChangeByAnim={setScrub}
          onTimelineEnd={() => { setScrub(0); resetClock(); }}
          showExtraPlanets={showExtraPlanets}
          showMoonL1={false}
          showFluxRope={false}
          showHss={showHss}
          coronalHoles={showHss ? coronalHoles : []}
          chDetectedAtMs={lastDetectedAt ? lastDetectedAt.getTime() : null}
          chEvolutions={showHss ? chEvolutions : []}
          dataVersion={cmeData.length}
          interactionMode={InteractionMode.MOVE}
          bzSouth={typeof latestBz === 'number' ? latestBz < 0 : false}
          measuredWindSpeedKms={typeof latestSpeed === 'number' ? latestSpeed : undefined}
        />}
      </div>
      <p className="scene-cap embed-caption">{caption}</p>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Magnetotail: the app's component, fed by the app's data hook.
 * ------------------------------------------------------------------ */
function MagnetotailEmbed() {
  const d = useSharedForecast();
  const noop = useCallback(() => {}, []);

  if (!d || !d.substormRiskData) {
    return (
      <>
        <div className="embed-stage"><div className="embed-note">Loading live substorm data</div></div>
        <p className="scene-cap">The tail loading, snapping, and firing aurora onto the pole</p>
      </>
    );
  }

  return (
    <>
      <div className="embed-loose">
        <MagnetotailStatus
          substormRiskData={d.substormRiskData}
          substormForecast={d.substormForecast}
          onOpenModal={noop}
          proxyMagneticData={d.allMagneticData}
          proxyPressureData={d.allPressureData}
          proxyNewellData={d.allNewellData}
        />
      </div>
      <p className="scene-cap">Driven by the solar wind being measured at L1 right now</p>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Forecast slots: the app's data hook, the app's slot maths.
 * Derivation matches ForecastDashboard.tsx simpleTimelineSlots exactly.
 * ------------------------------------------------------------------ */
function phraseFor(score: number, confidence: 'high' | 'medium' | 'low', label: string) {
  const timeRef = label === 'Now' ? 'right now'
    : label === '15 min' ? 'in the next 15 minutes'
    : label === '30 min' ? 'in the next 30 minutes'
    : label === '1 hour' ? 'over the next hour'
    : 'over the next two hours';
  if (score >= 80) return { tier: 'Naked eye', c: '#ef4444', phrase:
    confidence === 'high' ? 'Go outside now, this could be one of the best displays in years'
    : confidence === 'medium' ? 'Conditions look exceptional, well worth heading out to have a look'
    : 'Could turn into something special, keep a close eye on this' };
  if (score >= 65) return { tier: 'Naked eye', c: '#f97316', phrase:
    confidence === 'high' ? 'You should be able to see it with your own eyes, look south'
    : confidence === 'medium' ? 'Good chance of seeing it with your own eyes in a dark spot'
    : 'Might be visible with your own eyes if conditions stay this way' };
  if (score >= 50) return { tier: 'Naked eye', c: '#eab308', phrase:
    confidence === 'high' ? 'A faint green glow should be visible to the south, find somewhere dark'
    : confidence === 'medium' ? 'A faint glow to the south is possible, get away from street lights'
    : 'Might just be visible to the eye if you find somewhere dark enough' };
  if (score >= 35) return { tier: 'Phone camera', c: '#84cc16', phrase:
    confidence === 'high' ? 'Your phone camera will pick it up, point it south and take a photo'
    : confidence === 'medium' ? 'Worth taking a photo to the south, your phone may surprise you'
    : 'Your phone camera might pick something up if conditions improve' };
  if (score >= 20) return { tier: 'Camera only', c: '#3ddc97', phrase:
    confidence === 'high' ? 'Very faint, only a long exposure camera shot would show anything'
    : confidence === 'medium' ? 'Very faint if anything, not worth going out specially'
    : 'Unlikely to show up even on camera at this stage' };
  return { tier: 'Nothing', c: '#1d9c68', phrase:
    confidence === 'high' ? `Nothing to see, the sky will look completely normal ${timeRef}`
    : confidence === 'medium' ? `Very quiet ${timeRef}, not worth going out`
    : `Quiet ${timeRef}, come back later` };
}

function ForecastEmbed() {
  const d = useSharedForecast();

  const slots = useMemo(() => {
    if (!d) return [];
    const risk = d.substormRiskData;
    const workerScore = risk?.current?.score ?? null;
    const workerTrend = risk?.current?.risk_trend;
    const nowNewell = d.allNewellData?.length ? d.allNewellData[d.allNewellData.length - 1].y : 0;
    const cutoff = Date.now() - 30 * 60000;
    const pts = (d.allNewellData || []).filter((p: any) => p.x >= cutoff);
    const avg30 = pts.length ? pts.reduce((s: number, p: any) => s + p.y, 0) / pts.length : nowNewell;
    const newellNow = nowNewell || (risk?.metrics?.solar_wind?.newell_coupling_now ?? 0);
    const newellAvg30 = avg30 || (risk?.metrics?.solar_wind?.newell_avg_30m ?? 0);
    const base = workerScore ?? d.auroraScore ?? 0;
    const spotScore = d.auroraScore ?? 0;

    const trendMult =
      workerTrend === 'Rapidly Increasing' ? 1.15 :
      workerTrend === 'Increasing' ? 1.07 :
      workerTrend === 'Decreasing' ? 0.90 :
      workerTrend === 'Rapidly Decreasing' ? 0.75 : 1.0;
    const newellBoost = newellNow > 0 && newellAvg30 > 0 && newellNow > newellAvg30 * 1.2 ? 1.08 : 1.0;
    const applyMods = (s: number) => Math.min(100, Math.max(0, s * trendMult * newellBoost));

    const { status, p30, p60 } = d.substormForecast;
    const boostFromP = (p: number, b: number) => Math.min(100, b + p * (100 - b) * 0.75);

    let raw15: number, raw30: number, raw60: number;
    switch (status) {
      case 'ONSET':       raw15 = Math.min(100, base * 1.05); raw30 = base * 0.90; raw60 = base * 0.65; break;
      case 'IMMINENT_30': raw15 = boostFromP(p30, base); raw30 = boostFromP(p30, base) * 1.05; raw60 = boostFromP(p60, base) * 0.80; break;
      case 'LIKELY_60':   raw15 = base * 1.10; raw30 = boostFromP(p30 * 0.7, base); raw60 = boostFromP(p60, base); break;
      case 'WATCH':       raw15 = base * 1.05; raw30 = base * 1.15; raw60 = boostFromP(p60 * 0.5, base); break;
      default:            raw15 = base * 0.95; raw30 = base * 0.85; raw60 = base * 0.70;
    }
    const slotConf = (slot: '15m' | '30m' | '1h'): 'high' | 'medium' | 'low' => {
      if (status === 'ONSET') return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
      if (status === 'IMMINENT_30') return slot === '1h' ? 'medium' : 'high';
      if (status === 'LIKELY_60') return slot === '1h' ? 'high' : 'medium';
      if (status === 'WATCH') return slot === '15m' ? 'medium' : 'low';
      return slot === '15m' ? 'high' : slot === '30m' ? 'medium' : 'low';
    };

    return [
      { label: 'Now',     score: Math.round(workerScore ?? d.auroraScore ?? 0), conf: 'high' as const },
      { label: '15 min',  score: Math.round(applyMods(raw15)), conf: slotConf('15m') },
      { label: '30 min',  score: Math.round(applyMods(raw30)), conf: slotConf('30m') },
      { label: '1 hour',  score: Math.round(applyMods(raw60)), conf: slotConf('1h') },
      { label: '2 hours', score: Math.round(spotScore), conf: 'low' as const }
    ].map(s => ({ label: s.label, ...phraseFor(s.score, s.conf, s.label) }));
  }, [d]);

  if (!d || (d.isLoading && d.auroraScore == null)) {
    return <div className="lf-head"><span className="lf-status">Loading the live forecast</span></div>;
  }

  const power = d.gaugeData?.power?.value;
  const moon = d.gaugeData?.moon?.percentage;

  return (
    <>
      <div className="lf-head">
        <span className="lf-status">{d.lastUpdated?.replace('Last Updated:', 'Live, updated') || 'Live'}</span>
        <span className="lf-where">{d.locationBlurb || 'Referenced to Greymouth, West Coast'}</span>
      </div>
      <div className="fc-slots">
        {slots.map((s, i) => (
          <div className={'fc-slot' + (i === 0 ? ' is-now' : '')} key={s.label}>
            <span className="fc-when">{s.label}</span>
            <span className="fc-tier" style={{ color: s.c }}>{s.tier}</span>
            <span className="fc-phrase">{s.phrase}</span>
          </div>
        ))}
      </div>
      <div className="lf-meta">
        {power && power !== 'N/A' && <span className="lf-stat"><b>{power} GW</b> auroral power</span>}
        {typeof moon === 'number' && <span className="lf-stat"><b>{Math.round(moon)}%</b> moon lit</span>}
      </div>
      <div className="lf-actions">
        <a className="btn btn-primary btn-sm" href="https://www.spottheaurora.co.nz" target="_blank" rel="noopener">Open the full forecast</a>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The Active Sunspot Tracker and the Coronal Hole Tracker, exactly as the
 * app has them: the app's Solar Activity dashboard in embed mode, which
 * renders only those two panels and loads only what they need. Loaded when
 * scrolled to - it is the largest thing on the page.
 * ------------------------------------------------------------------ */
const SolarActivityDashboard = React.lazy(() => import('@app/components/SolarActivityDashboard'));

function SolarTrackersEmbed() {
  const [hostRef, inView] = useInView<HTMLDivElement>();
  // The app's fullscreen viewer, for the imagery the trackers open.
  const [media, setMedia] = useState<any>(null);
  const noop = useCallback(() => {}, []);
  const openVisualisation = useCallback(() => {
    window.open(`${APP_URL}/cme-visualization`, '_blank', 'noopener');
  }, []);
  const loading = <div className="embed-note" style={{ position: 'relative', minHeight: 240 }}>Loading the live trackers</div>;

  return (
    <div className="embed-loose app-page" ref={hostRef}>
      {inView ? (
        <React.Suspense fallback={loading}>
          <SolarActivityDashboard
            embed
            setViewerMedia={setMedia}
            setLatestXrayFlux={noop}
            onViewCMEInVisualization={openVisualisation}
            onViewCoronalHolesInVisualization={openVisualisation}
            refreshSignal={0}
            navigationTarget={null}
          />
        </React.Suspense>
      ) : loading}
      {media && <MediaViewerModal media={media} onClose={() => setMedia(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Advanced View panels: the app's own chart panels, fed by the shared
 * forecast data. Their "?" opens the full explanation in the app.
 * ------------------------------------------------------------------ */
const openAppForecast = () => { window.open(`${APP_URL}/spot-the-aurora-forecast`, '_blank', 'noopener'); };

function PanelEmbed({ children, note }: { children: (fc: Forecast) => React.ReactNode; note: string }) {
  const [hostRef, inView] = useInView<HTMLDivElement>();
  const fc = useSharedForecast();
  const ready = fc && fc.gaugeData && !(fc.isLoading && fc.auroraScore == null);
  return (
    <div className="embed-loose app-page app-panels" ref={hostRef}>
      {inView && ready
        ? children(fc!)
        : <div className="embed-note" style={{ position: 'relative', minHeight: 240 }}>{note}</div>}
    </div>
  );
}

const ADVANCED_TABS = [
  { key: 'imf', label: 'Bz / Bt', Panel: ImfPanel },
  { key: 'speed', label: 'Speed', Panel: SolarWindSpeedPanel },
  { key: 'density', label: 'Density', Panel: SolarWindDensityPanel },
  { key: 'power', label: 'Power', Panel: HemisphericPowerPanel },
] as const;

function AdvancedEmbed() {
  const [tab, setTab] = useState<(typeof ADVANCED_TABS)[number]['key']>('imf');
  const { Panel } = ADVANCED_TABS.find(t => t.key === tab)!;
  return (
    <>
      <div className="adv-tabs" role="tablist">
        {ADVANCED_TABS.map(t => (
          <button key={t.key} role="tab" aria-selected={t.key === tab}
            className={'adv-tab' + (t.key === tab ? ' is-on' : '')} onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>
      <PanelEmbed note="Loading the live charts">
        {fc => <Panel fc={fc} openModal={openAppForecast} />}
      </PanelEmbed>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The app on a phone, a tablet and a desktop: the live app itself in
 * three frames, each laid out at that device's real width and scaled
 * down to fit. Frames load only when scrolled to.
 * ------------------------------------------------------------------ */
const DEVICES = [
  { key: 'phone', label: 'Phone', w: 390, h: 844 },
  { key: 'tablet', label: 'Tablet', w: 820, h: 1180 },
  { key: 'desktop', label: 'Desktop', w: 1440, h: 900 },
] as const;

function DeviceFrame({ w, h, label, load }: { w: number; h: number; label: string; load: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const node = boxRef.current;
    if (!node) return;
    const fit = () => setScale(node.clientWidth / w);
    fit();
    if (!('ResizeObserver' in window)) return;
    const ro = new ResizeObserver(fit);
    ro.observe(node);
    return () => ro.disconnect();
  }, [w]);
  return (
    <figure className={'device device-' + label.toLowerCase()}>
      <div className="device-screen" ref={boxRef} style={{ aspectRatio: `${w} / ${h}` }}>
        {load && scale > 0 && (
          <iframe
            title={`Spot The Aurora on a ${label.toLowerCase()}`}
            src={`${APP_URL}/spot-the-aurora-forecast?embed`}
            loading="lazy"
            style={{ width: w, height: h, transform: `scale(${scale})` }}
          />
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function DevicesEmbed() {
  const [hostRef, inView] = useInView<HTMLDivElement>();
  return (
    <div className="devices" ref={hostRef}>
      {DEVICES.map(d => <DeviceFrame key={d.key} w={d.w} h={d.h} label={d.label} load={inView} />)}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Mounting
 * ------------------------------------------------------------------ */
const EMBEDS: Record<string, () => JSX.Element> = {
  cme: () => <SceneEmbed showHss={false} showExtraPlanets={true}
    caption="The app's own 3D scene, running live on NASA's current CME catalogue" />,
  coronalhole: () => <SceneEmbed showHss={true} showExtraPlanets={false}
    caption="Coronal holes detected in your browser from the live SUVI image, with their high speed streams on the Parker spiral" />,
  magnetotail: () => <MagnetotailEmbed />,
  forecast: () => <ForecastEmbed />,
  solartrackers: () => <SolarTrackersEmbed />,
  advanced: () => <AdvancedEmbed />,
  moonarc: () => <PanelEmbed note="Loading tonight's moon">{fc => <MoonArcPanel fc={fc} openModal={openAppForecast} />}</PanelEmbed>,
  substorm: () => <PanelEmbed note="Loading the live substorm index">{fc => <SubstormIndexPanel fc={fc} openModal={openAppForecast} />}</PanelEmbed>,
  devices: () => <DevicesEmbed />
};

function mountAll() {
  // One hidden provider drives every data-backed embed on the page.
  if (document.querySelector('[data-app-embed]')) {
    const host = document.createElement('div');
    host.style.display = 'none';
    document.body.appendChild(host);
    createRoot(host).render(<ForecastProvider />);
  }
  document.querySelectorAll<HTMLElement>('[data-app-embed]').forEach(node => {
    const kind = node.getAttribute('data-app-embed') || '';
    const make = EMBEDS[kind];
    if (!make) return;
    try {
      createRoot(node).render(make());
    } catch (e) {
      console.error('[embed] failed to mount', kind, e);
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll);
else mountAll();
