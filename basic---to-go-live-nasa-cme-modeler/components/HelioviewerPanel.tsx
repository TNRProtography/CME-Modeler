// components/HelioviewerPanel.tsx
// Multi-wavelength solar imagery — mobile-first, desktop-enhanced.
// Layout: single column stacked (mobile) → sidebar + viewer (lg+)
// Data: api.helioviewer.org (NASA / ESA — no API key)
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────
interface HVSource {
  id: number; obs: string; inst: string; label: string; wave: number | null;
  color: string; ion: string | null; tempK: string | null;
  bestFor: string; keyFeatures: string[]; colorMeaning: string;
}
interface Layer  { source: HVSource; opacity: number; }
interface FovOpt { label: string; scale: number; desc: string; }

// ── Source catalogue ──────────────────────────────────────────────────────────
const SOURCES: HVSource[] = [
  { id:8,  obs:'SDO', inst:'AIA', label:'94 Å',      wave:94,   color:'#00ff7f', ion:'Fe XVIII',         tempK:'~6 MK',
    bestFor:'Flare loop arcades & superhot plasma',
    keyFeatures:['Post-flare arcade formation','Pre-flare sigmoid heating','Coronal rain on cooling loops','Flare kernel brightening'],
    colorMeaning:'Green-white = superhot plasma (6 MK+). Stays dark unless a flare is happening — if it lights up, something significant is underway.' },
  { id:9,  obs:'SDO', inst:'AIA', label:'131 Å',     wave:131,  color:'#00e5ff', ion:'Fe VIII/XXI',      tempK:'~10 MK',
    bestFor:'Impulsive flare phase & magnetic reconnection sites',
    keyFeatures:['Flare ribbons at peak phase','Current sheet formation','Superhot reconnection outflows','Pre-eruption flux rope brightening'],
    colorMeaning:'Cyan-white = flare plasma. Two thermal peaks: 0.4 MK (quiet) and 10 MK (flare). Non-flaring times look dim and texture-rich.' },
  { id:10, obs:'SDO', inst:'AIA', label:'171 Å',     wave:171,  color:'#6eb4ff', ion:'Fe IX',            tempK:'~1 MK',
    bestFor:'Coronal loops, coronal holes & EUV wave propagation',
    keyFeatures:['Coronal loop topology footpoints→apex','Coronal holes appear dark','EUV waves rippling from flare sites','Filament channels as dark lanes'],
    colorMeaning:'Blue = 1 MK quiet corona. Dark patches = coronal holes. Bright = dense hot loops. Best all-round channel for coronal structure.' },
  { id:11, obs:'SDO', inst:'AIA', label:'193 Å',     wave:193,  color:'#7fff00', ion:'Fe XII/XXIV',      tempK:'~1.5 MK',
    bestFor:'Coronal hole mapping, EUV waves & active region corona',
    keyFeatures:['Coronal holes — very dark, best channel for CH detection','EUV wave bright fronts','Post-CME dimming','Flare onset brightening'],
    colorMeaning:'Green = 1.5 MK corona. Very dark = coronal holes (source of fast solar wind). Very bright = flare plasma at >10 MK secondary peak.' },
  { id:12, obs:'SDO', inst:'AIA', label:'211 Å',     wave:211,  color:'#cc44ff', ion:'Fe XIV',           tempK:'~2 MK',
    bestFor:'Hot active region loops & pre-eruption filament channels',
    keyFeatures:['Active region loops at 2 MK','Filament channels as dark winding lanes','Post-flare arcade cooling','Coronal loop oscillations'],
    colorMeaning:'Purple-magenta = 2 MK active region plasma. Dark = coronal holes. Combine with 171 + 304 for a full-temperature composite.' },
  { id:13, obs:'SDO', inst:'AIA', label:'304 Å',     wave:304,  color:'#ff4500', ion:'He II',            tempK:'~50 kK',
    bestFor:'Filaments, prominences & chromospheric eruptions',
    keyFeatures:['On-disk filaments — dark snaking ribbons','Off-limb prominences — bright orange','Erupting filaments / flux rope launch','Chromospheric flare ribbons','Surge jets & spicules'],
    colorMeaning:'Orange-red = 50 kK chromospheric plasma. Dark filaments = cool dense material blocking emission. Prominences are bright off-limb but dark on-disk.' },
  { id:14, obs:'SDO', inst:'AIA', label:'335 Å',     wave:335,  color:'#1e90ff', ion:'Fe XVI',           tempK:'~2.5 MK',
    bestFor:'Pre-flare hot loop heating & active region thermal structure',
    keyFeatures:['Hot active region loops pre-flare','Thermal evolution of post-flare loops','Large-scale hot coronal structures'],
    colorMeaning:'Blue-white = 2.5 MK hot plasma. Best paired with 171 Å — the contrast reveals multi-temperature loop layering.' },
  { id:15, obs:'SDO', inst:'AIA', label:'1600 Å',    wave:1600, color:'#ffd700', ion:'C IV + UV cont.',  tempK:'~0.1 MK',
    bestFor:'UV flare ribbons, chromospheric network & plage',
    keyFeatures:['UV flare ribbons — most dramatic brightening in strong flares','Two-ribbon pattern straddling the neutral line','Ribbon separation rate = energy release speed proxy','Plage around sunspot groups'],
    colorMeaning:'Gold = UV chromospheric emission. Very bright white = flare ribbon. Quiet sun shows bright network. Saturates in X-class flares.' },
  { id:16, obs:'SDO', inst:'AIA', label:'1700 Å',    wave:1700, color:'#fff8e7', ion:'UV continuum',     tempK:null,
    bestFor:'Photospheric UV, sunspot penumbra & granulation',
    keyFeatures:['Sunspot umbra and penumbra visible','Photospheric granulation texture','Near-UV reference against hotter EUV layers'],
    colorMeaning:'Pale yellow = photospheric emission. Dark spots = sunspot umbra. Most "true-colour"-like of any AIA channel.' },
  { id:18, obs:'SDO', inst:'HMI', label:'Continuum',   wave:null, color:'#fff8dc', ion:'Visible 617 nm', tempK:'~5,700 K',
    bestFor:'Sunspot morphology, size, evolution & penumbra structure',
    keyFeatures:['Sunspot umbra (dark core) and penumbra (filamentary)','Light bridges — signal stability or imminent breakup','Pores preceding sunspot formation','Spatial layout key for flare probability'],
    colorMeaning:'White = photosphere. Dark grey-black = sunspot umbra (~3,500 K). Mid-grey = penumbra. Compare with Magnetogram to link structure to field polarity.' },
  { id:19, obs:'SDO', inst:'HMI', label:'Magnetogram', wave:null, color:'#4a90d9', ion:'LOS B-field',    tempK:null,
    bestFor:'Magnetic polarity, active region complexity & CME trigger risk',
    keyFeatures:['Bipolar active region layout','Delta-class complexity → highest flare/CME risk','Magnetic neutral line — where eruptions start','Flux emergence over time'],
    colorMeaning:'White = positive (north) polarity. Black = negative (south) polarity. Grey = weak field. Complexity of the mixed region predicts flare class.' },
  { id:4,  obs:'SOHO', inst:'LASCO', label:'C2',      wave:null, color:'#c0c0c0', ion:'White light',     tempK:null,
    bestFor:'CME detection, speed & angular width — 1.5 to 6 R☉',
    keyFeatures:['Halo CME = 360° bright ring = Earth-directed event','CME leading edge speed measurement','Angular width: partial vs full halo','Helmet streamer blowout events'],
    colorMeaning:'Bright arcs = dense plasma (CME or streamer). Dark cavity = flux rope interior. Running-difference makes moving CMEs pop.' },
  { id:5,  obs:'SOHO', inst:'LASCO', label:'C3',      wave:null, color:'#808080', ion:'White light',     tempK:null,
    bestFor:'CME propagation & heliospheric transients — 3.7 to 30 R☉',
    keyFeatures:['CME speed profile at distance','Halo reaching C3 = major fast event','Heliospheric current sheet disconnections','Sun-grazing comets'],
    colorMeaning:'Bright arc/bubble = CME front at distance. Stars provide speed reference. Planet transits visible over longer timescales.' },
  { id:0,  obs:'SOHO', inst:'EIT', label:'171 Å',     wave:171, color:'#6eb4ff', ion:'Fe IX (legacy)',   tempK:'~1 MK',
    bestFor:'Historical quiet corona — full solar cycle archive from 1996',
    keyFeatures:['30+ years of EUV data from 1996','Historical coronal hole tracking','Long-baseline cross-calibration with SDO/AIA'],
    colorMeaning:'Same physics as AIA 171 Å at lower resolution (2.6 arcsec/px vs 0.6). Invaluable for historical context.' },
  { id:1,  obs:'SOHO', inst:'EIT', label:'195 Å',     wave:195, color:'#7fff00', ion:'Fe XII (legacy)',  tempK:'~1.5 MK',
    bestFor:'Historical coronal hole mapping & active region EUV',
    keyFeatures:['Long-baseline coronal hole area evolution','Historical EUV wave catalogue','Solar min/max contrast comparisons'],
    colorMeaning:'Similar to AIA 193 Å. Coronal holes very dark vs bright active regions.' },
  { id:2,  obs:'SOHO', inst:'EIT', label:'284 Å',     wave:284, color:'#ff69b4', ion:'Fe XV (legacy)',   tempK:'~2 MK',
    bestFor:'Historical hot active region plasma — legacy 2 MK channel',
    keyFeatures:['Hot active region loops from solar cycle 23+','Multi-thermal context with EIT 171/195'],
    colorMeaning:'Pink-magenta = 2 MK plasma. Active regions bright, quiet sun dim.' },
  { id:3,  obs:'SOHO', inst:'EIT', label:'304 Å',     wave:304, color:'#ff4500', ion:'He II (legacy)',   tempK:'~50 kK',
    bestFor:'Historical filament & prominence archive — from 1996',
    keyFeatures:['Decades of prominence/filament data','Long-term filament channel evolution'],
    colorMeaning:'Same chromospheric physics as AIA 304 Å at coarser resolution.' },
  { id:20, obs:'STEREO-A', inst:'EUVI', label:'171 Å', wave:171, color:'#6eb4ff', ion:'Fe IX',           tempK:'~1 MK',
    bestFor:'Far-side corona, off-limb loops & 360° context with SDO',
    keyFeatures:['Far-side active regions — early warning before Earth-view','Off-limb loop height measurements','CME initiation from STEREO-A perspective'],
    colorMeaning:'Same physics as AIA 171 Å. Far-side disk is limb from Earth — eruptions edge-on from Earth are face-on from here.' },
  { id:21, obs:'STEREO-A', inst:'EUVI', label:'195 Å', wave:195, color:'#7fff00', ion:'Fe XII',          tempK:'~1.5 MK',
    bestFor:'Far-side coronal hole detection & EUV wave context',
    keyFeatures:['Coronal holes on far side — predicts fast solar wind','EUV waves from second perspective','CME source region identification'],
    colorMeaning:'Similar to AIA 193 Å. Far-side coronal holes very dark.' },
  { id:22, obs:'STEREO-A', inst:'EUVI', label:'284 Å', wave:284, color:'#ff69b4', ion:'Fe XV',           tempK:'~2 MK',
    bestFor:'Far-side hot active region plasma from the east or west',
    keyFeatures:['Hot loops of far-side regions not visible from Earth','Pre-eruption heating from another angle'],
    colorMeaning:'Pink = 2 MK plasma from STEREO-A vantage.' },
  { id:23, obs:'STEREO-A', inst:'EUVI', label:'304 Å', wave:304, color:'#ff4500', ion:'He II',           tempK:'~50 kK',
    bestFor:'Off-limb prominence heights & far-side filament eruptions',
    keyFeatures:['Prominence height above limb','Far-side filament eruptions before rotating into Earth view'],
    colorMeaning:'Orange-red = chromospheric plasma. Prominences bright above the STEREO-A limb.' },
  { id:32, obs:'Proba-2', inst:'SWAP', label:'174 Å',  wave:174, color:'#6eb4ff', ion:'Fe IX/Fe X',      tempK:'~1 MK',
    bestFor:'Wide-field EUV corona & post-CME coronal dimming',
    keyFeatures:["Post-CME dimming — SWAP's wide 54-arcmin FOV captures the full extent AIA misses",'EUV wave propagation to large distances','Large-scale coronal connectivity'],
    colorMeaning:'Similar to AIA 171 Å. Larger FOV is the key advantage — shows how eruptions affect the global corona.' },
  { id:38, obs:'Hinode', inst:'XRT', label:'X-Ray',    wave:null, color:'#ff9900', ion:'Soft X-ray',      tempK:'>1 MK',
    bestFor:'X-ray bright points, coronal jets & hot loop brightening before flares',
    keyFeatures:['X-ray bright points — ubiquitous small-scale heating','Collimated X-ray jets from coronal holes','Sigmoid (S-shaped) pre-eruption structures','Flare arcade formation'],
    colorMeaning:'Orange-white = hot soft X-ray (>1 MK). Very bright = flare. Linear bright = X-ray jets.' },
];

const OBS_LIST = ['SDO', 'SOHO', 'STEREO-A', 'Proba-2', 'Hinode'];

const PRESETS = [
  { name:'AIA Classic',   ids:[10,13,11], ops:[100,80,60], desc:'171+304+193 Å',    science:'Corona (blue) + filaments/chromosphere (orange) + hot active regions (green) — three temperature regimes in one.' },
  { name:'Flare Tracker', ids:[8,9,15],   ops:[100,90,55], desc:'94+131+1600 Å',    science:'UV ribbons mark energy deposition; 94 and 131 show superhot reconnection above. Watch ribbons separate during flares.' },
  { name:'CME Watch',     ids:[4,5],      ops:[100,85],    desc:'LASCO C2+C3',       science:'Both coronagraphs stacked. C2 detects CMEs 1.5–6 R☉; C3 tracks to 30 R☉. Switch FOV to Extended/Far Heliosphere.' },
  { name:'Full Context',  ids:[10,4],     ops:[100,90],    desc:'AIA 171+C2',        science:'Disk eruption source (AIA) + early CME in the corona (C2) in one frame. Switch to Inner Corona FOV.' },
  { name:'Chromosphere',  ids:[13,15],    ops:[100,70],    desc:'304+1600 Å',        science:'Filament and flare ribbon science. 304 shows cool plasma; 1600 shows UV ribbons where energy is deposited.' },
  { name:'Active Regions',ids:[12,14,19], ops:[100,85,55], desc:'211+335+Magneto',   science:'Hot EUV loops overlaid with magnetic field map — trace field topology and spot Delta-class complexity.' },
  { name:'Coronal Holes', ids:[11,10],    ops:[100,70],    desc:'193+171 Å',         science:'193 gives best coronal hole contrast (very dark). 171 adds loop structure context. CH are source of fast solar wind.' },
  { name:'Side+Disk',     ids:[20,10],    ops:[100,75],    desc:'STEREO 171+AIA 171',science:'STEREO-A far-side + AIA Earth-facing disk — both at 171 Å — for near-360° coronal coverage.' },
];

const FOV_OPTIONS: FovOpt[] = [
  { label:'Solar Disk',      scale:4.8,  desc:'±1.3 R☉ — AIA / EIT / HMI' },
  { label:'Inner Corona',    scale:9.6,  desc:'±2.5 R☉ — LASCO C2 / prominences' },
  { label:'Extended Corona', scale:19.2, desc:'±5 R☉ — CME tracking / C2+C3' },
  { label:'Far Heliosphere', scale:48.0, desc:'±12.5 R☉ — LASCO C3 full field' },
];

const WINDOW_OPTIONS = [
  { hours:3,  label:'3h',  cadenceMin:15 },
  { hours:6,  label:'6h',  cadenceMin:30 },
  { hours:12, label:'12h', cadenceMin:30 },
  { hours:24, label:'24h', cadenceMin:60 },
] as const;

const LATENCY_HOURS = 3;

// ── API helpers ───────────────────────────────────────────────────────────────
const HV_API = 'https://api.helioviewer.org/v2';

function buildScreenshotUrl(layers: Layer[], iso: string, scale: number): string {
  if (!layers.length) return '';
  const ls   = layers.map(l => `[${l.source.id},1,${l.opacity}]`).join(',');
  const half = (512 / 2) * scale;
  return `${HV_API}/takeScreenshot/?date=${encodeURIComponent(iso)}&imageScale=${scale}&layers=${ls}&x1=${-half}&y1=${-half}&x2=${half}&y2=${half}&display=true`;
}

function buildShareUrl(layers: Layer[], iso: string, scale: number): string {
  const ls = layers.map(l => `[${l.source.id},1,${l.opacity}]`).join(',');
  return `https://helioviewer.org/?date=${encodeURIComponent(iso)}&imageScale=${scale}&layers=${encodeURIComponent(ls)}&centerX=0&centerY=0`;
}

function toISO(d: Date): string { return d.toISOString().replace('.000Z','Z'); }

function computeTimeSteps(windowHours: number, cadenceMin: number): Date[] {
  const endMs = Date.now() - LATENCY_HOURS * 3_600_000;
  const count = Math.round((windowHours * 60) / cadenceMin);
  return Array.from({ length: count + 1 }, (_, i) => new Date(endMs - (count - i) * cadenceMin * 60_000));
}

function formatScrubLabel(d: Date): string {
  const p = (n: number) => String(n).padStart(2,'0');
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const ha = (Date.now() - d.getTime()) / 3_600_000;
  const ago = ha < 1 ? `${Math.round(ha*60)} min ago` : `${ha.toFixed(1)} h ago`;
  return `${p(d.getUTCDate())} ${M[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC  (${ago})`;
}

// ── Mini components ───────────────────────────────────────────────────────────
const Dot: React.FC<{ color: string; size?: number }> = ({ color, size = 8 }) => (
  <span className="rounded-full flex-shrink-0 inline-block" style={{ width:size, height:size, backgroundColor:color }} />
);
const Spinner: React.FC<{ cls?: string }> = ({ cls = 'border-sky-500' }) => (
  <div className={`w-5 h-5 border-2 ${cls} border-t-transparent rounded-full animate-spin`} />
);

// ── Science panel ─────────────────────────────────────────────────────────────
const SciencePanel: React.FC<{ layers: Layer[]; compact?: boolean }> = ({ layers, compact }) => {
  const [tab, setTab] = useState(0);
  useEffect(() => { setTab(0); }, [layers.length]);
  const idx = Math.min(tab, layers.length - 1);
  const src = layers[idx]?.source;
  if (!src) return null;

  return (
    <div className="border-t border-neutral-800 bg-neutral-900/50">
      {layers.length > 1 && (
        <div className="flex gap-1 px-3 pt-2 overflow-x-auto">
          {layers.map((l, i) => (
            <button key={i} onClick={() => setTab(i)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-t text-[10px] border-b-2 whitespace-nowrap transition-colors flex-shrink-0 ${idx === i ? 'border-sky-500 text-white bg-neutral-800/60' : 'border-transparent text-neutral-500 hover:text-neutral-300'}`}>
              <Dot color={l.source.color} size={6} />
              {l.source.obs} {l.source.label}
            </button>
          ))}
        </div>
      )}

      {/* Mobile: single column. Desktop: three columns */}
      <div className={`px-3 py-3 ${compact ? 'space-y-3' : 'grid grid-cols-1 sm:grid-cols-3 gap-4'}`}>
        <div>
          <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1.5 font-semibold flex items-center gap-1.5">
            <Dot color={src.color} size={6} />{src.obs} / {src.inst} {src.label}
          </p>
          <p className="text-sm font-semibold text-neutral-100 leading-snug mb-1">{src.bestFor}</p>
          {src.ion && (
            <p className="text-[10px] text-neutral-500 mt-1">
              Ion: <span className="text-neutral-300 font-mono">{src.ion}</span>
              {src.tempK && <span className="ml-2 text-amber-400/80">{src.tempK}</span>}
            </p>
          )}
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1.5 font-semibold">What to look for</p>
          <ul className="space-y-0.5">
            {src.keyFeatures.map((f,i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-neutral-300 leading-snug">
                <span className="text-sky-600 flex-shrink-0 mt-0.5">›</span>{f}
              </li>
            ))}
          </ul>
        </div>
        {!compact && (
          <div>
            <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1.5 font-semibold">Reading the colours</p>
            <p className="text-[11px] text-neutral-300 leading-relaxed">{src.colorMeaning}</p>
          </div>
        )}
        {compact && (
          <div>
            <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1 font-semibold">Colours</p>
            <p className="text-[10px] text-neutral-400 leading-snug line-clamp-3">{src.colorMeaning}</p>
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main ──────────────────────────────────────────────────────────────────────
const HelioviewerPanel: React.FC = () => {
  const [selectedObs, setSelectedObs]   = useState('SDO');
  const [hoveredSrc,  setHoveredSrc]    = useState<HVSource|null>(null);
  const [layers, setLayers]             = useState<Layer[]>([
    { source: SOURCES.find(s => s.id === 10)!, opacity: 100 },
    { source: SOURCES.find(s => s.id === 13)!, opacity: 80  },
  ]);
  const [fovIdx,      setFovIdx]        = useState(0);
  const [showGuide,   setShowGuide]     = useState(false); // collapsed by default on mobile
  const [showPicker,  setShowPicker]    = useState(false); // mobile wavelength drawer

  // Timeline
  const [windowHours, setWindowHours]   = useState<3|6|12|24>(3);
  const [scrubberIdx, setScrubberIdx]   = useState(0);
  const [currentDate, setCurrentDate]   = useState(() => new Date(Date.now() - LATENCY_HOURS * 3_600_000));

  const windowCfg = WINDOW_OPTIONS.find(w => w.hours === windowHours)!;
  const timeSteps = useMemo(() => computeTimeSteps(windowHours, windowCfg.cadenceMin), [windowHours]); // eslint-disable-line

  useEffect(() => {
    const steps = computeTimeSteps(windowHours, WINDOW_OPTIONS.find(w => w.hours === windowHours)!.cadenceMin);
    const last  = steps.length - 1;
    setScrubberIdx(last);
    setCurrentDate(steps[last]);
  }, [windowHours]);

  // Viewer
  const [imgUrl,    setImgUrl]    = useState('');
  const [imgKey,    setImgKey]    = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [imgError,  setImgError]  = useState(false);

  // Animation
  const [animMode,     setAnimMode]     = useState(false);
  const [animFrames,   setAnimFrames]   = useState<string[]>([]);
  const [animFrame,    setAnimFrame]    = useState(0);
  const [animPlaying,  setAnimPlaying]  = useState(false);
  const [animBuilding, setAnimBuilding] = useState(false);
  const [animLoaded,   setAnimLoaded]   = useState(0);
  const [animFps,      setAnimFps]      = useState(8);
  const animRef    = useRef<number|null>(null);
  const cancelRef  = useRef(false);
  const debounceRef = useRef<number|null>(null);

  const fov = FOV_OPTIONS[fovIdx];

  const applyView = useCallback(() => {
    if (!layers.length) { setImgUrl(''); return; }
    setImgUrl(buildScreenshotUrl(layers, toISO(currentDate), fov.scale));
    setImgKey(k => k + 1);
    setIsLoading(true);
    setImgError(false);
  }, [layers, currentDate, fov.scale]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(applyView, 600);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [applyView]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { applyView(); }, []);

  const handleScrub = useCallback((idx: number) => {
    if (animMode) return;
    setScrubberIdx(idx);
    setCurrentDate(timeSteps[idx]);
  }, [animMode, timeSteps]);

  const stepScrubber = useCallback((dir: -1|1) => {
    setScrubberIdx(prev => {
      const next = Math.max(0, Math.min(timeSteps.length - 1, prev + dir));
      setCurrentDate(timeSteps[next]);
      return next;
    });
  }, [timeSteps]);

  // Layers
  const addLayer    = (src: HVSource) => { if (layers.length >= 3 || layers.some(l => l.source.id === src.id)) return; setLayers(p => [...p, {source:src, opacity:80}]); };
  const removeLayer = (i: number) => setLayers(p => p.filter((_,j) => j !== i));
  const setOpacity  = (i: number, v: number) => setLayers(p => p.map((l,j) => j === i ? {...l,opacity:v} : l));
  const moveLayer   = (i: number, dir: -1|1) => {
    const n = i + dir;
    if (n < 0 || n >= layers.length) return;
    setLayers(p => { const a=[...p]; [a[i],a[n]]=[a[n],a[i]]; return a; });
  };
  const applyPreset = (p: typeof PRESETS[0]) =>
    setLayers(p.ids.map((id,i) => { const src=SOURCES.find(s=>s.id===id); return src ? {source:src,opacity:p.ops[i]} : null; }).filter(Boolean) as Layer[]);

  // Animation
  const stopAnim = useCallback(() => {
    cancelRef.current = true;
    setAnimPlaying(false); setAnimMode(false); setAnimFrames([]); setAnimFrame(0); setAnimBuilding(false); setAnimLoaded(0);
    if (animRef.current) { clearInterval(animRef.current); animRef.current = null; }
  }, []);

  const buildAnim = useCallback(async () => {
    if (!layers.length) return;
    cancelRef.current = false;
    setAnimMode(true); setAnimBuilding(true); setAnimFrames([]); setAnimFrame(0); setAnimLoaded(0); setAnimPlaying(false);
    const urls = timeSteps.map(d => buildScreenshotUrl(layers, toISO(d), fov.scale));
    const loaded: string[] = [];
    for (const url of urls) {
      if (cancelRef.current) return;
      await new Promise<void>(resolve => {
        const img = new Image();
        img.onload = img.onerror = () => { loaded.push(url); setAnimLoaded(n => n+1); resolve(); };
        img.src = url;
      });
    }
    if (cancelRef.current) return;
    setAnimFrames(loaded); setAnimBuilding(false); setAnimPlaying(true);
  }, [layers, timeSteps, fov.scale]);

  useEffect(() => {
    if (animPlaying && animFrames.length > 0) {
      animRef.current = window.setInterval(() => setAnimFrame(p => (p+1) % animFrames.length), 1000/animFps);
    } else { if (animRef.current) { clearInterval(animRef.current); animRef.current = null; } }
    return () => { if (animRef.current) { clearInterval(animRef.current); animRef.current = null; } };
  }, [animPlaying, animFrames.length, animFps]);

  useEffect(() => { if (animMode && animFrames.length > 0) setScrubberIdx(animFrame); }, [animMode, animFrame, animFrames.length]);

  const displayUrl    = animMode && animFrames.length > 0 ? animFrames[animFrame] : imgUrl;
  const obsSourceList = SOURCES.filter(s => s.obs === selectedObs);
  const instGroups    = [...new Set(obsSourceList.map(s => s.inst))];
  const shareUrl      = layers.length ? buildShareUrl(layers, toISO(currentDate), fov.scale) : 'https://helioviewer.org';
  const scrubLabel    = timeSteps[scrubberIdx] ? formatScrubLabel(timeSteps[scrubberIdx]) : '';

  // ── Shared wavelength picker content (used in both mobile drawer and desktop sidebar)
  const WavelengthPicker = (
    <>
      {/* Observatory tabs */}
      <div className="p-2.5 border-b border-neutral-800 flex-shrink-0">
        <p className="text-[9px] uppercase tracking-widest text-neutral-500 mb-1.5 font-semibold">🛰 Observatory</p>
        <div className="flex flex-wrap gap-1">
          {OBS_LIST.map(obs => (
            <button key={obs} onClick={() => setSelectedObs(obs)}
              className={`px-2 py-0.5 text-[9px] rounded border transition-colors font-mono ${selectedObs === obs ? 'bg-sky-800/80 border-sky-600 text-white' : 'bg-neutral-800 border-neutral-700 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200'}`}>
              {obs}
            </button>
          ))}
        </div>
      </div>

      {/* Source list */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {instGroups.map(inst => (
          <div key={inst} className="mb-3">
            <p className="text-[9px] uppercase tracking-widest text-neutral-600 mb-1 font-semibold px-0.5">{inst}</p>
            <div className="flex flex-col gap-0.5">
              {obsSourceList.filter(s => s.inst === inst).map(src => {
                const ai = layers.findIndex(l => l.source.id === src.id);
                const isActive = ai !== -1;
                const canAdd   = layers.length < 3;
                return (
                  <button key={src.id}
                    onClick={() => { isActive ? removeLayer(ai) : addLayer(src); }}
                    onMouseEnter={() => setHoveredSrc(src)}
                    onMouseLeave={() => setHoveredSrc(null)}
                    disabled={!isActive && !canAdd}
                    className={`flex items-start gap-1.5 px-2 py-1.5 rounded text-left border transition-colors ${isActive ? 'bg-sky-900/50 border-sky-700/70 text-sky-200' : canAdd ? 'bg-neutral-800/60 border-neutral-700/50 hover:bg-neutral-700 text-neutral-300 hover:text-white' : 'bg-neutral-900/30 border-neutral-800 text-neutral-600 cursor-not-allowed'}`}>
                    <Dot color={src.color} size={7} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-[10px]">{src.label}</span>
                        {src.tempK && <span className="text-[8px] text-neutral-500">{src.tempK}</span>}
                        {isActive && <span className="text-sky-400 text-[8px] ml-auto">✓</span>}
                      </div>
                      <p className="text-[9px] text-neutral-500 leading-tight mt-0.5 line-clamp-2">{src.bestFor}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {hoveredSrc && (
          <div className="hidden lg:block mt-1 p-2 rounded-md bg-neutral-800 border border-neutral-700">
            <div className="flex items-center gap-1.5 mb-1"><Dot color={hoveredSrc.color} size={7} />
              <span className="text-[10px] font-bold text-white">{hoveredSrc.obs}/{hoveredSrc.inst} {hoveredSrc.label}</span>
            </div>
            {hoveredSrc.ion && <p className="text-[9px] text-amber-400/90 mb-1 font-mono">{hoveredSrc.ion}{hoveredSrc.tempK ? ` · ${hoveredSrc.tempK}` : ''}</p>}
            <p className="text-[9px] text-neutral-200 leading-snug font-medium mb-1.5">{hoveredSrc.bestFor}</p>
            {hoveredSrc.keyFeatures.slice(0,3).map((f,i) => <p key={i} className="text-[9px] text-neutral-400 leading-snug">› {f}</p>)}
          </div>
        )}
      </div>

      {/* Active layers */}
      <div className="border-t border-neutral-800 p-2.5 flex-shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[9px] uppercase tracking-widest text-neutral-500 font-semibold">🎞 Active Layers</p>
          <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${layers.length === 3 ? 'bg-amber-900/40 border-amber-800 text-amber-400' : 'bg-neutral-800 border-neutral-700 text-neutral-500'}`}>{layers.length}/3</span>
        </div>
        {layers.length === 0 && <p className="text-[10px] text-neutral-600 italic">Select a wavelength above</p>}
        {layers.map((layer, idx) => (
          <div key={`${layer.source.id}-${idx}`} className="mb-2 bg-neutral-800/50 rounded-md p-1.5 border border-neutral-700/40">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <Dot color={layer.source.color} size={7} />
                <span className="text-[10px] font-semibold text-neutral-200">{layer.source.obs}/{layer.source.inst} {layer.source.label}</span>
              </div>
              <div className="flex items-center gap-0.5">
                <button onClick={() => moveLayer(idx,-1)} disabled={idx===0} className="w-4 h-4 flex items-center justify-center text-[9px] text-neutral-500 hover:text-neutral-200 disabled:opacity-20">↑</button>
                <button onClick={() => moveLayer(idx,1)} disabled={idx===layers.length-1} className="w-4 h-4 flex items-center justify-center text-[9px] text-neutral-500 hover:text-neutral-200 disabled:opacity-20">↓</button>
                <button onClick={() => removeLayer(idx)} className="w-4 h-4 flex items-center justify-center text-[9px] text-neutral-500 hover:text-red-400">×</button>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-neutral-500 w-10 flex-shrink-0">Opacity</span>
              <input type="range" min={10} max={100} step={5} value={layer.opacity}
                onChange={e => setOpacity(idx, Number(e.target.value))}
                className="flex-1 h-1 cursor-pointer" style={{ accentColor: layer.source.color }} />
              <span className="text-[9px] text-neutral-400 w-7 text-right">{layer.opacity}%</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );

  // ── Timeline controls (shared between mobile and desktop)
  const TimelineControls = (
    <div className="px-3 py-2 border-b border-neutral-800 bg-neutral-900/50 flex-shrink-0">
      {/* Row 1: window buttons + FOV */}
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-[9px] uppercase tracking-widest text-neutral-500 font-semibold flex-shrink-0">🕐 Timeline</span>
        <div className="flex gap-1">
          {WINDOW_OPTIONS.map(opt => (
            <button key={opt.hours} onClick={() => { setWindowHours(opt.hours as 3|6|12|24); if (animMode) stopAnim(); }}
              className={`px-3 py-1 text-xs rounded transition-colors ${windowHours === opt.hours ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200'}`}>
              {opt.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          <span className="text-[9px] text-neutral-500 hidden sm:inline">FOV</span>
          <select value={fovIdx} onChange={e => setFovIdx(Number(e.target.value))} title={fov.desc}
            className="bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-[10px] text-neutral-200">
            {FOV_OPTIONS.map((f,i) => <option key={f.label} value={i}>{f.label}</option>)}
          </select>
        </div>
      </div>

      {/* Row 2: Scrubber */}
      <div className="flex items-center gap-2">
        <button onClick={() => { stepScrubber(-1); if(animMode) stopAnim(); }} disabled={scrubberIdx === 0}
          className="px-2 py-1 text-[10px] rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-30 touch-manipulation">◀</button>
        <input type="range" min={0} max={Math.max(0, timeSteps.length-1)} value={scrubberIdx}
          onChange={e => { handleScrub(Number(e.target.value)); if(animMode) stopAnim(); }}
          className="flex-1 accent-sky-500 touch-manipulation" style={{ minHeight: 20 }} />
        <button onClick={() => { stepScrubber(1); if(animMode) stopAnim(); }} disabled={scrubberIdx === timeSteps.length-1}
          className="px-2 py-1 text-[10px] rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 disabled:opacity-30 touch-manipulation">▶</button>
      </div>

      {/* Row 3: timestamp + animation controls */}
      <div className="flex items-center justify-between mt-1.5 gap-2 flex-wrap">
        <span className="text-[10px] text-neutral-400 font-mono truncate flex-1">{scrubLabel}</span>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap">
          {!animMode ? (
            <button onClick={buildAnim} disabled={!layers.length}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded border bg-neutral-800 border-neutral-700 text-neutral-300 hover:bg-amber-900/50 hover:border-amber-700 hover:text-amber-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed touch-manipulation">
              🎬 {windowHours}h anim
            </button>
          ) : (
            <>
              {!animBuilding && (
                <button onClick={() => setAnimPlaying(p => !p)}
                  className="px-2.5 py-1 text-[10px] rounded bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 touch-manipulation">
                  {animPlaying ? '⏸' : '▶'}
                </button>
              )}
              <div className="flex items-center gap-1">
                <label className="text-[9px] text-neutral-500">FPS</label>
                <select value={animFps} onChange={e => setAnimFps(Number(e.target.value))}
                  className="bg-neutral-800 border border-neutral-700 rounded px-1 py-0.5 text-[10px] text-neutral-200">
                  {[4,6,8,12,15].map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <button onClick={stopAnim}
                className="px-2.5 py-1 text-[10px] rounded border bg-red-900/50 border-red-700 text-red-300 hover:bg-red-800 touch-manipulation">
                ⏹ Stop
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  // ── Image viewer
  const ImageViewer = (
    <div className="relative bg-black flex items-center justify-center overflow-hidden"
      style={{ minHeight: 260 }}>

      {isLoading && !animMode && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10 gap-3">
          <Spinner />
          <p className="text-[11px] text-neutral-400">Fetching from Helioviewer…</p>
          <p className="text-[9px] text-neutral-600">First request may take 5–15 s</p>
        </div>
      )}
      {animBuilding && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10 gap-3">
          <Spinner cls="border-amber-500" />
          <p className="text-[11px] text-neutral-300">Building {windowHours}h animation…</p>
          <div className="w-40 bg-neutral-800 rounded-full h-1.5 overflow-hidden">
            <div className="bg-amber-500 h-full transition-all duration-200"
              style={{ width:`${(animLoaded/timeSteps.length)*100}%` }} />
          </div>
          <p className="text-[10px] text-neutral-500">{animLoaded} / {timeSteps.length} frames</p>
          <button onClick={stopAnim} className="px-3 py-1 text-[10px] rounded bg-red-900/60 border border-red-700 text-red-300">Cancel</button>
        </div>
      )}
      {imgError && !isLoading && !animMode && (
        <div className="text-center p-6 max-w-xs">
          <p className="text-neutral-400 mb-2">⚠️ No imagery found</p>
          <p className="text-neutral-600 text-[10px] leading-relaxed">Helioviewer may not have data for this time / wavelength. Try scrubbing to a different position or switching instrument.</p>
          <button onClick={applyView} className="mt-3 px-3 py-1.5 text-xs bg-sky-800 hover:bg-sky-700 rounded border border-sky-700 touch-manipulation">Retry</button>
        </div>
      )}
      {!displayUrl && !isLoading && !imgError && (
        <p className="text-neutral-600 text-sm p-4 text-center">Select at least one wavelength to view imagery</p>
      )}
      {displayUrl && !imgError && (
        <img key={`${imgKey}-${animMode ? animFrame : 'still'}`}
          src={displayUrl} alt="Solar imagery composite"
          className="w-full h-full object-contain"
          style={{ imageRendering:'crisp-edges', maxHeight: 480 }}
          onLoad={() => setIsLoading(false)}
          onError={() => { setIsLoading(false); if (!animMode) setImgError(true); }} />
      )}

      {/* Layer badges — top-left */}
      {layers.length > 0 && (
        <div className="absolute top-2 left-2 flex flex-col gap-1 pointer-events-none">
          {layers.map((l,i) => (
            <div key={i} className="flex items-center gap-1.5 bg-black/60 backdrop-blur-sm rounded px-1.5 py-0.5">
              <Dot color={l.source.color} size={6} />
              <span className="text-[9px] text-neutral-200 font-mono">{l.source.obs} {l.source.label}</span>
              <span className="text-[8px] text-neutral-500">{l.opacity}%</span>
            </div>
          ))}
        </div>
      )}

      {/* FOV label — top-right */}
      <div className="absolute top-2 right-2 pointer-events-none">
        <span className="text-[8px] text-neutral-600 bg-black/50 px-1.5 py-0.5 rounded">{fov.label}</span>
      </div>

      {/* Anim frame counter — bottom-left */}
      {animMode && animFrames.length > 0 && (
        <div className="absolute bottom-2 left-2 pointer-events-none">
          <span className="text-[8px] text-neutral-400 bg-black/60 px-1.5 py-0.5 rounded font-mono">{animFrame+1}/{animFrames.length}</span>
        </div>
      )}

      {/* Spot The Aurora watermark — bottom-right */}
      <div className="absolute bottom-3 right-3 pointer-events-none flex flex-col items-end gap-0.5">
        <img src="/icons/icon-default.png" alt="Spot The Aurora"
          className="w-8 h-8 rounded-full opacity-50"
          style={{ filter:'brightness(1.15) drop-shadow(0 1px 3px rgba(0,0,0,0.8))' }} />
        <span className="text-[7px] text-white/40 tracking-wide font-semibold">Spot The Aurora</span>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="col-span-12 card bg-neutral-950/80 p-0 overflow-hidden flex flex-col">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-neutral-800 flex-shrink-0 gap-2">
        <div>
          <h2 className="text-base sm:text-xl font-semibold text-white leading-tight">☀️ Helioviewer</h2>
          <p className="text-[9px] sm:text-[10px] text-neutral-500 leading-tight">Multi-wavelength solar imagery · NASA / ESA</p>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0 flex-wrap justify-end">
          <button onClick={() => setShowGuide(g => !g)}
            className={`px-2 py-1 text-[9px] sm:text-[10px] rounded border transition-colors touch-manipulation ${showGuide ? 'bg-sky-900/60 border-sky-700 text-sky-300' : 'bg-neutral-800 border-neutral-700 text-neutral-400'}`}>
            📖 {showGuide ? 'Guide ▲' : 'Guide ▼'}
          </button>
          <button onClick={applyView}
            className="px-2 py-1 text-[9px] sm:text-[10px] rounded border border-neutral-700 bg-neutral-800 text-neutral-300 touch-manipulation">
            ⟳
          </button>
          <a href={shareUrl} target="_blank" rel="noopener noreferrer"
            className="hidden sm:inline px-2 py-1 text-[10px] rounded border border-neutral-700 bg-neutral-800 hover:bg-sky-900 hover:border-sky-700 text-sky-400 transition-colors">
            Helioviewer ↗
          </a>
        </div>
      </div>

      {/* ── Presets — horizontal scroll on mobile ──────────────────────────── */}
      <div className="px-3 sm:px-4 py-2 border-b border-neutral-800 bg-neutral-900/30 flex items-center gap-2 flex-shrink-0 overflow-x-auto">
        <span className="text-[9px] uppercase tracking-widest text-neutral-500 font-semibold flex-shrink-0">⚡</span>
        {PRESETS.map(p => (
          <button key={p.name} onClick={() => applyPreset(p)} title={`${p.desc} — ${p.science}`}
            className="flex items-center gap-1 px-2.5 py-1 text-[10px] rounded bg-neutral-800 hover:bg-sky-900/50 border border-neutral-700 hover:border-sky-700 text-neutral-300 hover:text-white transition-colors flex-shrink-0 touch-manipulation">
            <span className="flex gap-0.5">
              {p.ids.slice(0,3).map(id => { const s=SOURCES.find(x=>x.id===id); return s?<Dot key={id} color={s.color} size={5}/>:null; })}
            </span>
            {p.name}
          </button>
        ))}
      </div>

      {/* ── MOBILE LAYOUT: stacked ──────────────────────────────────────────── */}
      <div className="lg:hidden flex flex-col">

        {/* Timeline controls */}
        {TimelineControls}

        {/* Image viewer */}
        {ImageViewer}

        {/* Mobile wavelength picker toggle */}
        <div className="border-t border-neutral-800 bg-neutral-900/40">
          <button onClick={() => setShowPicker(p => !p)}
            className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-medium text-neutral-300 hover:text-white touch-manipulation">
            <span className="flex items-center gap-2">
              🔭 Configure Layers
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${layers.length === 3 ? 'bg-amber-900/40 border-amber-800 text-amber-400' : 'bg-neutral-800 border-neutral-700 text-neutral-500'}`}>
                {layers.length}/3
              </span>
              {/* Show current layer dots */}
              <span className="flex gap-1">
                {layers.map((l,i) => <Dot key={i} color={l.source.color} size={8} />)}
              </span>
            </span>
            <span className="text-neutral-500">{showPicker ? '▲' : '▼'}</span>
          </button>

          {showPicker && (
            <div className="border-t border-neutral-800 flex flex-col" style={{ maxHeight: 420, overflow: 'hidden' }}>
              {WavelengthPicker}
            </div>
          )}
        </div>

        {/* Science guide (mobile — compact single column) */}
        {showGuide && layers.length > 0 && <SciencePanel layers={layers} compact />}
      </div>

      {/* ── DESKTOP LAYOUT: sidebar + main ─────────────────────────────────── */}
      <div className="hidden lg:flex flex-1 min-h-0 overflow-hidden" style={{ minHeight: 560 }}>

        {/* Sidebar */}
        <div className="w-64 flex-shrink-0 border-r border-neutral-800 flex flex-col overflow-hidden">
          {WavelengthPicker}
        </div>

        {/* Main viewer column */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {TimelineControls}
          <div className="flex-1 min-h-0 overflow-hidden">
            {ImageViewer}
          </div>
          {showGuide && layers.length > 0 && <SciencePanel layers={layers} />}
        </div>
      </div>

    </div>
  );
};

export default HelioviewerPanel;
