// --- START OF FILE src/components/SolarActivityDashboard.tsx ---

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import CloseIcon from './icons/CloseIcon';
// Import only flare functions/types (IPS removed)
import { 
  fetchFlareData, 
  SolarFlare
} from '../services/nasaService';

interface SolarActivityDashboardProps {
  setViewerMedia: (media: { url: string, type: 'image' | 'video' | 'animation' } | null) => void;
  setLatestXrayFlux: (flux: number | null) => void;
  onViewCMEInVisualization: (cmeId: string) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
  refreshSignal: number;
  onInitialLoad?: () => void;
}

interface SolarActivitySummary {
  highestXray: { flux: number; class: string; timestamp: number; };
  highestProton: { flux: number; class: string; timestamp: number; };
  flareCounts: { x: number; m: number; potentialCMEs: number; };
}

type SolarImageryMode = 'SUVI_131' | 'SUVI_195' | 'SUVI_304' | 'SDO_HMIBC_1024' | 'SDO_HMIIF_1024';

// --- CONSTANTS ---
const NOAA_XRAY_FLUX_URLS = [
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/xrays-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json',
];
const NOAA_PROTON_FLUX_URLS = [
  'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/integral-protons-plot-7-day.json',
  'https://services.swpc.noaa.gov/json/goes/primary/integral-protons-plot-1-day.json',
];
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
const SUVI_195_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/latest.png';
const SUVI_131_INDEX_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/';
const SUVI_304_INDEX_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/';
const SUVI_195_INDEX_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/';
const SUVI_FRAME_INTERVAL_MINUTES = 10;
const CCOR1_VIDEO_URL = 'https://services.swpc.noaa.gov/products/ccor1/mp4s/ccor1_last_24hrs.mp4';
const SDO_PROXY_BASE_URL = 'https://sdo-imagery-proxy.thenamesrock.workers.dev';
const SDO_HMI_BC_1024_URL = `${SDO_PROXY_BASE_URL}/sdo-hmibc-1024`;
const SDO_HMI_IF_1024_URL = `${SDO_PROXY_BASE_URL}/sdo-hmiif-1024`;
const REFRESH_INTERVAL_MS = 30 * 1000; // Refresh every 30 seconds

// --- HELPERS ---
const getCssVar = (name: string): string => {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch { return ''; }
};

const getColorForFlux = (value: number, opacity: number = 1): string => {
  let rgb = getCssVar('--solar-flare-ab-rgb') || '34, 197, 94';
  if (value >= 5e-4) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180';
  else if (value >= 1e-4) rgb = getCssVar('--solar-flare-x-rgb') || '147, 112, 219';
  else if (value >= 1e-5) rgb = getCssVar('--solar-flare-m-rgb') || '255, 69, 0';
  else if (value >= 1e-6) rgb = getCssVar('--solar-flare-c-rgb') || '245, 158, 11';
  return `rgba(${rgb}, ${opacity})`;
};

const getColorForProtonFlux = (value: number, opacity: number = 1): string => {
  let rgb = getCssVar('--solar-flare-ab-rgb') || '34, 197, 94';
  if (value >= 10) rgb = getCssVar('--solar-flare-c-rgb') || '245, 158, 11';
  if (value >= 100) rgb = getCssVar('--solar-flare-m-rgb') || '255, 69, 0';
  if (value >= 1000) rgb = getCssVar('--solar-flare-x-rgb') || '147, 112, 219';
  if (value >= 10000) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180';
  if (value >= 100000) rgb = getCssVar('--solar-flare-x5plus-rgb') || '255, 20, 147';
  return `rgba(${rgb}, ${opacity})`;
};

const getColorForFlareClass = (classType: string): { background: string, text: string } => {
  const type = classType ? classType[0].toUpperCase() : 'U';
  const magnitude = parseFloat(classType.substring(1));
  if (type === 'X') {
    if (magnitude >= 5) return { background: `rgba(${getCssVar('--solar-flare-x5plus-rgb') || '255, 105, 180'}, 1)`, text: 'text-white' };
    return { background: `rgba(${getCssVar('--solar-flare-x-rgb') || '147, 112, 219'}, 1)`, text: 'text-white' };
  }
  if (type === 'M') return { background: `rgba(${getCssVar('--solar-flare-m-rgb') || '255, 69, 0'}, 1)`, text: 'text-white' };
  if (type === 'C') return { background: `rgba(${getCssVar('--solar-flare-c-rgb') || '245, 158, 11'}, 1)`, text: 'text-black' };
  return { background: `rgba(${getCssVar('--solar-flare-ab-rgb') || '34, 197, 94'}, 1)`, text: 'text-white' };
};

const formatNZTimestamp = (isoString: string | null | number) => {
  if (!isoString) return 'N/A';
  try { 
    const d = new Date(isoString); 
    return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' }); 
  } catch { 
    return "Invalid Date"; 
  }
};

const getXrayClass = (value: number | null): string => {
  if (value === null) return 'N/A';
  if (value >= 1e-4) return `X${(value / 1e-4).toFixed(1)}`;
  if (value >= 1e-5) return `M${(value / 1e-5).toFixed(1)}`;
  if (value >= 1e-6) return `C${(value / 1e-6).toFixed(1)}`;
  if (value >= 1e-7) return `B${(value / 1e-7).toFixed(1)}`;
  return `A${(value / 1e-8).toFixed(1)}`;
};

const getProtonClass = (value: number | null): string => {
  if (value === null) return 'N/A';
  if (value >= 100000) return 'S5';
  if (value >= 10000) return 'S4';
  if (value >= 1000) return 'S3';
  if (value >= 100) return 'S2';
  if (value >= 10) return 'S1';
  return 'S0';
};

const getOverallActivityStatus = (xrayClass: string, protonClass: string): 'Quiet' | 'Moderate' | 'High' | 'Very High' | 'N/A' => {
  if (xrayClass === 'N/A' && protonClass === 'N/A') return 'N/A';
  let activityLevel: 'Quiet' | 'Moderate' | 'High' | 'Very High' = 'Quiet';
  if (xrayClass.startsWith('X')) activityLevel = 'Very High';
  else if (xrayClass.startsWith('M')) activityLevel = 'High';
  else if (xrayClass.startsWith('C')) activityLevel = 'Moderate';

  if (protonClass === 'S5' || protonClass === 'S4') activityLevel = 'Very High';
  else if (protonClass === 'S3' || protonClass === 'S2') {
    if (activityLevel !== 'Very High') activityLevel = 'High';
  } else if (protonClass === 'S1') {
    if (activityLevel === 'Quiet') activityLevel = 'Moderate';
  }
  return activityLevel;
};

// Parse source location like "N12W15", "S18E05" to a signed longitude in degrees (E negative, W positive)
const parseLongitude = (loc?: string | null): number | null => {
  if (!loc) return null;
  const m = String(loc).match(/^[NS]\d{1,2}(E|W)(\d{1,3})$/i);
  if (!m) return null;
  const hemi = m[1].toUpperCase();
  const deg = parseInt(m[2], 10);
  if (isNaN(deg)) return null;
  // Define East as negative, West as positive relative to Earth view (central meridian at 0)
  return hemi === 'W' ? +deg : -deg;
};

// Heuristic: Potential earth-directed if a CME is linked and source longitude within ±30°
const isPotentialEarthDirected = (flare: SolarFlare): boolean => {
  // @ts-ignore - we compute hasCME when processing flares
  if (!flare.hasCME) return false;
  const lon = parseLongitude(flare.sourceLocation);
  if (lon === null) return false;
  return Math.abs(lon) <= 30; // tweak if you want stricter/looser
};

// --- REUSABLE COMPONENTS ---
const TimeRangeButtons: React.FC<{ onSelect: (duration: number) => void; selected: number }> = ({ onSelect, selected }) => {
  const timeRanges = [
    { label: '1 Hr', hours: 1 },
    { label: '3 Hr', hours: 3 },
    { label: '6 Hr', hours: 6 },
    { label: '12 Hr', hours: 12 },
    { label: '1 Day', hours: 24 },
    { label: '3 Day', hours: 72 },
    { label: '5 Day', hours: 120 },
    { label: '7 Day', hours: 168 },
  ];
  return (
    <div className="flex justify-center gap-2 my-2 flex-wrap">
      {timeRanges.map(({ label, hours }) => (
        <button
          key={hours}
          onClick={() => onSelect(hours * 3600000)}
          className={`px-3 py-1 text-xs rounded transition-colors ${selected === hours * 3600000 ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
          title={`Show data for the last ${hours} hours`}
        >
          {label}
        </button>
      ))}
    </div>
  );
};

interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string | React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[2100] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (<div dangerouslySetInnerHTML={{ __html: content }} />) : (content)}
        </div>
      </div>
    </div>
  );
};

const LoadingSpinner: React.FC<{ message?: string }> = ({ message }) => (
  <div className="flex flex-col items-center justify-center h-full min-h-[150px] text-neutral-400 italic">
    <svg className="animate-spin h-8 w-8 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
    {message && <p className="mt-2 text-sm">{message}</p>}
  </div>
);

const SolarActivitySummaryDisplay: React.FC<{ summary: SolarActivitySummary | null }> = ({ summary }) => {
  if (!summary) {
    return (
      <div className="col-span-12 card bg-neutral-950/80 p-6 text-center text-neutral-400 italic">
        Calculating 24-hour summary...
      </div>
    );
  }
  const formatTime = (ts: number) => new Date(ts).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-6 space-y-4">
      <h2 className="text-2xl font-bold text-white text-center">24-Hour Solar Summary</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center">
          <h3 className="text-lg font-semibold text-neutral-200 mb-2">Peak X-ray Flux</h3>
          <p className="text-5xl font-bold" style={{ color: getColorForFlux(summary.highestXray.flux) }}>
            {summary.highestXray.class}
          </p>
          <p className="text-sm text-neutral-400 mt-1">at {formatTime(summary.highestXray.timestamp)}</p>
        </div>

        <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center">
          <h3 className="text-lg font-semibold text-neutral-200 mb-2">Solar Flares</h3>
          <div className="flex justify-center items-center gap-6 text-2xl font-bold">
            <div>
              <p style={{ color: `rgba(${getCssVar('--solar-flare-x-rgb')})` }}>{summary.flareCounts.x}</p>
              <p className="text-sm font-normal">X-Class</p>
            </div>
            <div>
              <p style={{ color: `rgba(${getCssVar('--solar-flare-m-rgb')})` }}>{summary.flareCounts.m}</p>
              <p className="text-sm font-normal">M-Class</p>
            </div>
            <div>
              <p className="text-sky-300">{summary.flareCounts.potentialCMEs}</p>
              <p className="text-sm font-normal">Potential Earth-Directed CMEs</p>
            </div>
          </div>
        </div>

        <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center">
          <h3 className="text-lg font-semibold text-neutral-200 mb-2">Peak Proton Flux</h3>
          <p className="text-5xl font-bold" style={{ color: getColorForProtonFlux(summary.highestProton.flux) }}>
            {summary.highestProton.class}
          </p>
          <p className="text-sm text-neutral-400 mt-1">at {formatTime(summary.highestProton.timestamp)}</p>
        </div>
      </div>
    </div>
  );
};

// --- COMPONENT ---
const SolarActivityDashboard: React.FC<SolarActivityDashboardProps> = ({ setViewerMedia, setLatestXrayFlux, onViewCMEInVisualization, refreshSignal, onInitialLoad }) => {
  const isInitialLoad = useRef(true);
  // Imagery state
  const [suvi131, setSuvi131] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [suvi304, setSuvi304] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [sdoHmiBc1024, setSdoHmiBc1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [sdoHmiIf1024, setSdoHmiIf1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [suvi195, setSuvi195] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [ccor1Video, setCcor1Video] = useState({ url: '', loading: 'Loading video...' });
  const [activeSunImage, setActiveSunImage] = useState<SolarImageryMode>('SUVI_131');

  // Chart state
  const [allXrayData, setAllXrayData] = useState<any[]>([]);
  const [loadingXray, setLoadingXray] = useState<string | null>('Loading X-ray flux data...');
  const [xrayTimeRange, setXrayTimeRange] = useState<number>(7 * 24 * 60 * 60 * 1000);
  const [allProtonData, setAllProtonData] = useState<any[]>([]);
  const [loadingProton, setLoadingProton] = useState<string | null>('Loading proton flux data...');
  const [protonTimeRange, setProtonTimeRange] = useState<number>(7 * 24 * 60 * 60 * 1000);

  // Flares
  const [solarFlares, setSolarFlares] = useState<SolarFlare[]>([]);
  const [loadingFlares, setLoadingFlares] = useState<string | null>('Loading solar flares...');
  const [selectedFlare, setSelectedFlare] = useState<SolarFlare | null>(null);

  // General state
  const [modalState, setModalState] = useState<{isOpen: boolean; title: string; content: string | React.ReactNode} | null>(null);
  const [currentXraySummary, setCurrentXraySummary] = useState<{ flux: number | null, class: string | null }>({ flux: null, class: null });
  const [currentProtonSummary, setCurrentProtonSummary] = useState<{ flux: number | null, class: string | null }>({ flux: null, class: null });
  const [latestRelevantEvent, setLatestRelevantEvent] = useState<string | null>(null);
  const [overallActivityStatus, setOverallActivityStatus] = useState<'Quiet' | 'Moderate' | 'High' | 'Very High' | 'N/A'>('N/A');
  const [lastXrayUpdate, setLastXrayUpdate] = useState<string | null>(null);
  const [lastProtonUpdate, setLastProtonUpdate] = useState<string | null>(null);
  const [lastFlaresUpdate, setLastFlaresUpdate] = useState<string | null>(null);
  const [lastImagesUpdate, setLastImagesUpdate] = useState<string | null>(null);
  const [activitySummary, setActivitySummary] = useState<SolarActivitySummary | null>(null);
  const initialLoadNotifiedRef = useRef(false);

  const buildSixHourAnimationUrls = useCallback((baseUrl: string, stepMinutes: number = 10) => {
    const now = Date.now();
    const sixHoursAgo = now - (6 * 60 * 60 * 1000);
    const urls: string[] = [];

    for (let ts = sixHoursAgo; ts <= now; ts += stepMinutes * 60 * 1000) {
      const u = new URL(baseUrl);
      u.searchParams.set('_', String(ts));
      urls.push(u.toString());
    }

    return urls;
  }, []);

  const probeImageUrl = useCallback((url: string, timeoutMs: number = 1200) => (
    new Promise<string | null>((resolve) => {
      const img = new Image();
      const timer = window.setTimeout(() => resolve(null), timeoutMs);
      img.onload = () => {
        window.clearTimeout(timer);
        resolve(url);
      };
      img.onerror = () => {
        window.clearTimeout(timer);
        resolve(null);
      };
      img.src = url;
    })
  ), []);

  const extractSuviFramesFromIndex = useCallback((html: string, indexUrl: string) => {
    const regex = /href="([^"]+\.png)"/gi;
    const now = Date.now();
    const sixHoursAgo = now - (6 * 60 * 60 * 1000);
    const frames: { url: string; t: number }[] = [];
    let match: RegExpExecArray | null;

    while ((match = regex.exec(html)) !== null) {
      const name = match[1];
      if (name === 'latest.png') continue;
      const startToken = name.match(/_s(\d{8}T\d{6})_/i)?.[1];
      if (!startToken) continue;
      const iso = `${startToken.slice(0,4)}-${startToken.slice(4,6)}-${startToken.slice(6,8)}T${startToken.slice(9,11)}:${startToken.slice(11,13)}:${startToken.slice(13,15)}Z`;
      const t = Date.parse(iso);
      if (!Number.isFinite(t) || t < sixHoursAgo || t > now + 10 * 60 * 1000) continue;
      frames.push({ url: `${indexUrl}${name}`, t });
    }

    return frames.sort((a, b) => a.t - b.t).map((f) => f.url);
  }, []);

  const buildSuviFrameCandidates = useCallback((mode: 'SUVI_131' | 'SUVI_195' | 'SUVI_304') => {
    const channel = mode === 'SUVI_131' ? '131' : mode === 'SUVI_195' ? '195' : '304';
    const root = mode === 'SUVI_131' ? SUVI_131_INDEX_URL : mode === 'SUVI_195' ? SUVI_195_INDEX_URL : SUVI_304_INDEX_URL;
    const now = Date.now();
    const sixHoursAgo = now - (6 * 60 * 60 * 1000);
    const intervalMs = SUVI_FRAME_INTERVAL_MINUTES * 60 * 1000;
    const roundedStart = Math.floor(sixHoursAgo / intervalMs) * intervalMs;
    const frameTimes: number[] = [];

    for (let t = roundedStart; t <= now; t += intervalMs) {
      frameTimes.push(t);
    }

    const toToken = (timestamp: number) => {
      const d = new Date(timestamp);
      const y = d.getUTCFullYear();
      const mo = `${d.getUTCMonth() + 1}`.padStart(2, '0');
      const day = `${d.getUTCDate()}`.padStart(2, '0');
      const h = `${d.getUTCHours()}`.padStart(2, '0');
      const m = `${d.getUTCMinutes()}`.padStart(2, '0');
      const s = `${d.getUTCSeconds()}`.padStart(2, '0');
      return `${y}${mo}${day}T${h}${m}${s}Z`;
    };

    return frameTimes.map((startMs) => {
      const endMs = startMs + intervalMs;
      const startToken = toToken(startMs);
      const endToken = toToken(endMs);
      return [
        `${root}or_suvi-l2-ci${channel}_g19_s${startToken}_e${endToken}_v1-0-2.png`,
        `${root}or_suvi-l2-ci${channel}_g18_s${startToken}_e${endToken}_v1-0-2.png`,
        `${root}or_suvi-l2-ci${channel}_g19_s${startToken}_e${endToken}_v1-0-1.png`,
        `${root}or_suvi-l2-ci${channel}_g18_s${startToken}_e${endToken}_v1-0-1.png`,
      ];
    });
  }, []);

  const fetchSuviAnimationFrames = useCallback(async (mode: 'SUVI_131' | 'SUVI_195' | 'SUVI_304', latestUrl: string) => {
    const indexUrl = mode === 'SUVI_131' ? SUVI_131_INDEX_URL : mode === 'SUVI_195' ? SUVI_195_INDEX_URL : SUVI_304_INDEX_URL;

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 1800);
      const response = await fetch(`${indexUrl}?_=${Date.now()}`, { signal: controller.signal });
      window.clearTimeout(timeout);
      if (response.ok) {
        const html = await response.text();
        const parsed = extractSuviFramesFromIndex(html, indexUrl);
        if (parsed.length > 1) return parsed;
      }
    } catch (error) {
      console.warn('SUVI directory listing unavailable, falling back to candidate probing.', error);
    }

    const candidateGroups = buildSuviFrameCandidates(mode);
    const resolved = (await Promise.all(
      candidateGroups.map(async (group) => {
        const attempts = await Promise.all(group.map((url) => probeImageUrl(url)));
        return attempts.find(Boolean) ?? null;
      })
    )).filter((url): url is string => Boolean(url));

    if (resolved.length > 1) return resolved;

    return buildSixHourAnimationUrls(latestUrl, SUVI_FRAME_INTERVAL_MINUTES);
  }, [buildSixHourAnimationUrls, buildSuviFrameCandidates, extractSuviFramesFromIndex, probeImageUrl]);

  const solarAnimationSources = useMemo<Record<SolarImageryMode, string>>(() => ({
    SUVI_131: SUVI_131_URL,
    SUVI_304: SUVI_304_URL,
    SUVI_195: SUVI_195_URL,
    SDO_HMIBC_1024: `${SDO_HMI_BC_1024_URL}?hours=6&format=gif`,
    SDO_HMIIF_1024: `${SDO_HMI_IF_1024_URL}?hours=6&format=gif`,
  }), []);

  const imageryModeLabels: Record<SolarImageryMode, string> = {
    SUVI_131: 'SUVI 131Å',
    SUVI_304: 'SUVI 304Å',
    SUVI_195: 'SUVI 195Å',
    SDO_HMIBC_1024: 'SDO HMI Continuum',
    SDO_HMIIF_1024: 'SDO HMI Intensitygram',
  };

  const openSolarImageryAnimation = useCallback(async (mode: SolarImageryMode) => {
    const sourceUrl = solarAnimationSources[mode];
    if (!sourceUrl) return;

    const quickFallbackUrls = buildSixHourAnimationUrls(sourceUrl, SUVI_FRAME_INTERVAL_MINUTES);
    setViewerMedia({
      type: 'animation',
      urls: quickFallbackUrls,
    });

    if (mode === 'SUVI_131' || mode === 'SUVI_195' || mode === 'SUVI_304') {
      const resolved = await fetchSuviAnimationFrames(mode, sourceUrl);
      if (resolved.length > 1) {
        setViewerMedia({
          type: 'animation',
          urls: resolved,
        });
      }
    }
  }, [buildSixHourAnimationUrls, fetchSuviAnimationFrames, setViewerMedia, solarAnimationSources]);

  // Tooltips
  const buildStatTooltip = (title: string, whatItIs: string, auroraEffect: string, advanced: string) => `
    <div class='space-y-3 text-left'>
      <p><strong>${title}</strong></p>
      <p><strong>What this is:</strong> ${whatItIs}</p>
      <p><strong>Why it matters for aurora:</strong> ${auroraEffect}</p>
      <p class='text-xs text-neutral-400'><strong>Advanced:</strong> ${advanced}</p>
    </div>
  `;

  const tooltipContent = useMemo(() => ({
    'xray-flux': buildStatTooltip(
      'GOES X-ray Flux',
      'A live measure of solar X-ray output from flares.',
      'Large spikes mean stronger flares and a higher chance of downstream CME-driven aurora risk in coming days.',
      'Flare classes scale logarithmically (B/C/M/X) from 1–8 Å flux; geoeffectiveness depends on associated CME speed, direction, and IMF coupling at Earth.'
    ),
    'proton-flux': buildStatTooltip(
      'GOES Proton Flux (>=10 MeV)',
      'Counts high-energy protons arriving near Earth.',
      'Raised proton levels indicate energetic solar activity and disturbed space-weather context, sometimes around CME/shock periods.',
      'SEP flux is not a direct aurora brightness metric; use with solar-wind/IMF and geomagnetic indices for operational interpretation.'
    ),
    'suvi-131': buildStatTooltip(
      'SUVI 131Å',
      'Ultraviolet view highlighting very hot flare regions in the corona.',
      'Helps identify active regions likely to produce flare/CME events that can later enhance aurora.',
      'Dominated by high-temperature Fe lines; useful for impulsive heating diagnostics and flare morphology.'
    ),
    'suvi-304': buildStatTooltip(
      'SUVI 304Å',
      'Ultraviolet view of cooler chromospheric/transition-region plasma, including prominences.',
      'Erupting prominences seen here can be linked to CME launches that may influence aurora after transit.',
      'Primarily He II 304 Å emission; useful for filament channel and prominence eruption tracking.'
    ),
    'sdo-hmibc-1024': buildStatTooltip(
      'SDO HMI Continuum',
      'White-light style image showing sunspots and photospheric structure.',
      'Large/complex sunspot groups are often tied to stronger flare potential, which can precede aurora-driving events.',
      'Continuum intensity maps photospheric brightness; active region complexity is often combined with magnetograms for forecast confidence.'
    ),
    'sdo-hmiif-1024': buildStatTooltip(
      'SDO HMI Intensitygram',
      'Image emphasizing photospheric intensity and active-region structure.',
      'Tracks evolving active regions that can produce eruptions relevant to aurora risk windows.',
      'Used alongside line-of-sight magnetic products to infer magnetic stress and flare productivity potential.'
    ),
    'suvi-195': buildStatTooltip(
      'SUVI 195Å',
      'EUV view that highlights coronal structures and large-scale solar atmospheric changes.',
      'Helpful for monitoring evolving coronal regions and disturbances that can precede space-weather changes.',
      '195 Å imagery is useful for tracking coronal morphology over time and identifying evolving active regions.'
    ),
    'ccor1-video': buildStatTooltip(
      'CCOR1 Coronagraph',
      'A coronagraph view that reveals CMEs leaving the Sun.',
      'Earth-directed CMEs are one of the main drivers of major aurora episodes after 1–3 days travel time.',
      'Coronagraph kinematics (plane-of-sky speed/width) require projection-aware interpretation for true geoeffective trajectory.'
    ),
    'solar-flares': buildStatTooltip(
      'Solar Flares List',
      'Recent flare detections and classes from monitoring feeds.',
      'More frequent and stronger flares usually mean a more active Sun and greater chance of aurora-supporting disturbances.',
      'Flare class alone is insufficient; CME association, source longitude, and magnetic orientation govern Earth impact potential.'
    ),
    'solar-imagery': buildStatTooltip(
      'Solar Imagery Types',
      'Different wavelengths show different layers and temperatures of the Sun.',
      'Using several layers together improves confidence in spotting features that can lead to aurora-driving events.',
      'Multi-wavelength context supports feature cross-identification (flares, filaments, coronal holes, active-region evolution).'
    )
  }), []);

  const openModal = useCallback((id: string) => {
    const contentData = tooltipContent[id as keyof typeof tooltipContent];
    if (contentData) {
      let title = '';
      if (id === 'xray-flux') title = 'About GOES X-ray Flux';
      else if (id === 'proton-flux') title = 'About GOES Proton Flux (>=10 MeV)';
      else if (id === 'suvi-131') title = 'About SUVI 131Å Imagery';
      else if (id === 'suvi-304') title = 'About SUVI 304Å Imagery';
      else if (id === 'sdo-hmibc-1024') title = 'About SDO HMI Continuum Imagery';
      else if (id === 'sdo-hmiif-1024') title = 'About SDO HMI Intensitygram Imagery';
      else if (id === 'suvi-195') title = 'About SUVI 195Å Imagery';
      else if (id === 'ccor1-video') title = 'About CCOR1 Coronagraph Video';
      else if (id === 'solar-flares') title = 'About Solar Flares';
      else if (id === 'solar-imagery') title = 'About Solar Imagery Types';
      else title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();
      setModalState({ isOpen: true, title: title, content: contentData });
    }
  }, [tooltipContent]);

  const closeModal = useCallback(() => setModalState(null), []);

  const fetchImage = useCallback(async (url: string, setState: React.Dispatch<React.SetStateAction<{url: string, loading: string | null}>>, isVideo: boolean = false, addCacheBuster: boolean = true) => {
    if (isInitialLoad.current) {
        setState({ url: isVideo ? '' : '/placeholder.png', loading: `Loading ${isVideo ? 'video' : 'image'}...` });
    }
    try {
      const fetchUrl = addCacheBuster ? `${url}?_=${new Date().getTime()}` : url;
      const res = await fetch(fetchUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      if (isVideo) {
        setState({ url: url, loading: null });
      } else {
        const blob = await res.blob();
        const objectURL = URL.createObjectURL(blob);
        setState({ url: objectURL, loading: null });
      }
      setLastImagesUpdate(new Date().toLocaleTimeString('en-NZ'));
    } catch (error) {
      console.error(`Error fetching ${url}:`, error);
      setState({ url: isVideo ? '' : '/error.png', loading: `${isVideo ? 'Video' : 'Image'} failed to load.` });
    }
  }, []);


  const fetchFirstAvailableJson = useCallback(async (urls: string[]) => {
    let lastError: Error | null = null;
    for (const url of urls) {
      try {
        const res = await fetch(`${url}?_=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.json();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown fetch error');
      }
    }
    throw lastError ?? new Error('No data endpoint available');
  }, []);

  const fetchXrayFlux = useCallback(async () => {
    if (isInitialLoad.current) {
        setLoadingXray('Loading X-ray flux data...');
    }
    try {
      const rawData = await fetchFirstAvailableJson(NOAA_XRAY_FLUX_URLS);
        const groupedData = new Map();
        rawData.forEach((d: any) => {
          const time = new Date(d.time_tag).getTime();
          if (!groupedData.has(time)) groupedData.set(time, { time, short: null });
          if (d.energy === "0.1-0.8nm") groupedData.get(time).short = parseFloat(d.flux);
        });
        const processedData = Array.from(groupedData.values())
          .filter(d => d.short !== null && !isNaN(d.short))
          .sort((a,b) => a.time - b.time);
        if (!processedData.length) {
          setLoadingXray('No valid X-ray data.');
          setAllXrayData([]);
          setLatestXrayFlux(null);
          setCurrentXraySummary({ flux: null, class: 'N/A' });
          setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ'));
          return;
        }
        setAllXrayData(processedData);
        setLoadingXray(null);
        const latestFluxValue = processedData[processedData.length - 1].short;
        setLatestXrayFlux(latestFluxValue);
        setCurrentXraySummary({ flux: latestFluxValue, class: getXrayClass(latestFluxValue) });
        setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ'));
    } catch (e: any) {
      console.error('Error fetching X-ray flux:', e);
      setLoadingXray(`Error: ${e?.message || 'Unknown error'}`);
      setLatestXrayFlux(null);
      setCurrentXraySummary({ flux: null, class: 'N/A' });
      setLastXrayUpdate(new Date().toLocaleTimeString('en-NZ'));
    }
  }, [fetchFirstAvailableJson, setLatestXrayFlux]);

  const fetchProtonFlux = useCallback(async () => {
    if (isInitialLoad.current) {
        setLoadingProton('Loading proton flux data...');
    }
    try {
      const rawData = await fetchFirstAvailableJson(NOAA_PROTON_FLUX_URLS);
        const processedData = rawData
          .filter((d: any) => d.energy === ">=10 MeV" && d.flux !== null && !isNaN(d.flux))
          .map((d: any) => ({ time: new Date(d.time_tag).getTime(), flux: parseFloat(d.flux) }))
          .sort((a: any, b: any) => a.time - b.time);
        if (!processedData.length) {
          setLoadingProton('No valid >=10 MeV proton data.');
          setAllProtonData([]);
          setCurrentProtonSummary({ flux: null, class: 'N/A' });
          setLastProtonUpdate(new Date().toLocaleTimeString('en-NZ'));
          return;
        }
        setAllProtonData(processedData);
        setLoadingProton(null);
        const latestFluxValue = processedData[processedData.length - 1].flux;
        setCurrentProtonSummary({ flux: latestFluxValue, class: getProtonClass(latestFluxValue) });
        setLastProtonUpdate(new Date().toLocaleTimeString('en-NZ'));
    } catch (e: any) {
      console.error('Error fetching proton flux:', e);
      setLoadingProton(`Error: ${e?.message || 'Unknown error'}`);
      setCurrentProtonSummary({ flux: null, class: 'N/A' });
      setLastProtonUpdate(new Date().toLocaleTimeString('en-NZ'));
    }
  }, [fetchFirstAvailableJson]);

  const fetchFlares = useCallback(async () => {
    if (isInitialLoad.current) {
        setLoadingFlares('Loading solar flares...');
    }
    try {
      const data = await fetchFlareData();
      if (!data || data.length === 0) {
        setSolarFlares([]);
        setLoadingFlares(null);
        setLastFlaresUpdate(new Date().toLocaleTimeString('en-NZ'));
        return;
      }
      const processedData = data.map((flare: SolarFlare) => ({
        ...flare,
        // add derived property for convenience
        hasCME: flare.linkedEvents?.some((e: any) => e.activityID.includes('CME')) ?? false,
      })) as (SolarFlare & { hasCME: boolean })[];
      setSolarFlares(processedData);
      setLoadingFlares(null);
      setLastFlaresUpdate(new Date().toLocaleTimeString('en-NZ'));
      const firstStrong = processedData.find(f => f.classType?.startsWith('M') || f.classType?.startsWith('X'));
      if (firstStrong) setLatestRelevantEvent(`${firstStrong.classType} flare at ${formatNZTimestamp(firstStrong.peakTime)}`);
    } catch (error) {
      console.error('Error fetching flares:', error);
      setLoadingFlares(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setLastFlaresUpdate(new Date().toLocaleTimeString('en-NZ'));
    }
  }, []);

  const runAllUpdates = useCallback(() => {
    fetchImage(SUVI_131_URL, setSuvi131);
    fetchImage(SUVI_304_URL, setSuvi304);
    fetchImage(SDO_HMI_BC_1024_URL, setSdoHmiBc1024);
    fetchImage(SDO_HMI_IF_1024_URL, setSdoHmiIf1024);
    fetchImage(SUVI_195_URL, setSuvi195);
    fetchImage(CCOR1_VIDEO_URL, setCcor1Video, true);
    fetchXrayFlux();
    fetchProtonFlux();
    fetchFlares();
  }, [fetchFlares, fetchImage, fetchProtonFlux, fetchXrayFlux]);

  useEffect(() => {
    runAllUpdates();
    isInitialLoad.current = false; // Mark initial load as done after the first run
    const interval = setInterval(runAllUpdates, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runAllUpdates]);

  useEffect(() => {
    runAllUpdates();
  }, [refreshSignal, runAllUpdates]);

  useEffect(() => {
    if (!onInitialLoad || initialLoadNotifiedRef.current) return;

    const hasInitialCoreData = !!lastXrayUpdate && !!lastProtonUpdate && !!lastFlaresUpdate;
    const hasAnyImagery = [suvi131, suvi195, suvi304, sdoHmiBc1024, sdoHmiIf1024]
      .some((img) => !img.loading && !!img.url);

    if (hasInitialCoreData && hasAnyImagery) {
      initialLoadNotifiedRef.current = true;
      onInitialLoad();
    }
  }, [
    onInitialLoad,
    lastXrayUpdate,
    lastProtonUpdate,
    lastFlaresUpdate,
    suvi131,
    suvi304,
    suvi195,
    sdoHmiBc1024,
    sdoHmiIf1024,
  ]);

  // Chart options/data
  const xrayChartOptions = useMemo((): ChartOptions<'line'> => {
    const now = Date.now();
    const startTime = now - xrayTimeRange;
    const midnightAnnotations: any = {};
    const nzOffset = 12 * 3600000;
    const startDayNZ = new Date(startTime - nzOffset).setUTCHours(0,0,0,0) + nzOffset;
    for (let d = startDayNZ; d < now + 24 * 3600000; d += 24 * 3600000) {
      const midnight = new Date(d).setUTCHours(12,0,0,0);
      if (midnight > startTime && midnight < now) {
        midnightAnnotations[`midnight-${midnight}`] = {
          type: 'line', xMin: midnight, xMax: midnight,
          borderColor: 'rgba(156, 163, 175, 0.5)', borderWidth: 1, borderDash: [5, 5],
          label: { content: 'Midnight', display: true, position: 'start', color: 'rgba(156, 163, 175, 0.7)', font: { size: 10 } }
        };
      }
    }
    return {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: (c: any) => `Flux: ${c.parsed.y.toExponential(2)} (${c.parsed.y >= 1e-4 ? 'X' : c.parsed.y >= 1e-5 ? 'M' : c.parsed.y >= 1e-6 ? 'C' : c.parsed.y >= 1e-7 ? 'B' : 'A'}-class)`
        }},
        annotation: { annotations: midnightAnnotations }
      },
      scales: {
        x: { type: 'time', adapters: { date: { locale: enNZ } }, time: { unit: xrayTimeRange > 3 * 24 * 3600000 ? 'day' : 'hour', tooltipFormat: 'dd MMM HH:mm', displayFormats: { hour: 'HH:mm', day: 'dd MMM' } }, min: startTime, max: now, ticks: { color: '#71717a' }, grid: { color: '#3f3f46' } },
        y: { type: 'logarithmic', min: 1e-9, max: 1e-3, ticks: { color: '#71717a', callback: (v: any) => { if(v===1e-4) return 'X'; if(v===1e-5) return 'M'; if(v===1e-6) return 'C'; if(v===1e-7) return 'B'; if(v===1e-8) return 'A'; return null; } }, grid: { color: '#3f3f46' } }
      }
    };
  }, [xrayTimeRange]);

  const xrayChartData = useMemo(() => {
    if (allXrayData.length === 0) return { datasets: [] };
    return {
      datasets: [{
        label: 'Short Flux (0.1-0.8 nm)',
        data: allXrayData.map(d => ({x: d.time, y: d.short})),
        pointRadius: 0, tension: 0.1, spanGaps: true, fill: 'origin', borderWidth: 2,
        segment: { borderColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 1), backgroundColor: (ctx: any) => getColorForFlux(ctx.p1.parsed.y, 0.2) }
      }],
    };
  }, [allXrayData]);

  const protonChartOptions = useMemo((): ChartOptions<'line'> => {
    const now = Date.now();
    const startTime = now - protonTimeRange;
    const midnightAnnotations: any = {};
    const nzOffset = 12 * 3600000;
    const startDayNZ = new Date(startTime - nzOffset).setUTCHours(0,0,0,0) + nzOffset;
    for (let d = startDayNZ; d < now + 24 * 3600000; d += 24 * 3600000) {
      const midnight = new Date(d).setUTCHours(12,0,0,0);
      if (midnight > startTime && midnight < now) {
        midnightAnnotations[`midnight-${midnight}`] = {
          type: 'line', xMin: midnight, xMax: midnight,
          borderColor: 'rgba(156, 163, 175, 0.5)', borderWidth: 1, borderDash: [5, 5],
          label: { content: 'Midnight', display: true, position: 'start', color: 'rgba(156, 163, 175, 0.7)', font: { size: 10 } }
        };
      }
    }
    return {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: (c: any) => {
            const flux = c.parsed.y;
            let sClass = 'S0';
            if (flux >= 100000) sClass = 'S5'; else if (flux >= 10000) sClass = 'S4'; else if (flux >= 1000) sClass = 'S3'; else if (flux >= 100) sClass = 'S2'; else if (flux >= 10) sClass = 'S1';
            return `Flux: ${flux.toFixed(2)} pfu (${sClass}-class)`;
          }
        }},
        annotation: { annotations: midnightAnnotations }
      },
      scales: {
        x: { type: 'time', adapters: { date: { locale: enNZ } }, time: { unit: protonTimeRange > 3 * 24 * 3600000 ? 'day' : 'hour', tooltipFormat: 'dd MMM HH:mm', displayFormats: { hour: 'HH:mm', day: 'dd MMM' } }, min: startTime, max: now, ticks: { color: '#71717a' }, grid: { color: '#3f3f46' } },
        y: { type: 'logarithmic', min: 1e-4, max: 1000000, ticks: { color: '#71717a', callback: (value: any) => { if (value === 100000) return 'S5'; if (value === 10000) return 'S4'; if (value === 1000) return 'S3'; if (value === 100) return 'S2'; if (value === 10) return 'S1'; if (value === 1) return 'S0'; if (value === 0.1 || value === 0.01 || value === 0.001 || value === 0.0001) return value.toString(); return null; } }, grid: { color: '#3f3f46' } }
      }
    };
  }, [protonTimeRange]);

  const protonChartData = useMemo(() => {
    if (allProtonData.length === 0) return { datasets: [] };
    return {
      datasets: [{
        label: 'Proton Flux (>=10 MeV)',
        data: allProtonData.map(d => ({x: d.time, y: d.flux})),
        pointRadius: 0, tension: 0.1, spanGaps: true, fill: 'origin', borderWidth: 2,
        segment: { borderColor: (ctx: any) => getColorForProtonFlux(ctx.p1.parsed.y, 1), backgroundColor: (ctx: any) => getColorForProtonFlux(ctx.p1.parsed.y, 0.2) }
      }],
    };
  }, [allProtonData]);

  // --- Build the 24h summary strictly from the last 24 hours ---
  useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;

    const xray24 = allXrayData.filter(d => d.time >= dayAgo && d.time <= now);
    const proton24 = allProtonData.filter(d => d.time >= dayAgo && d.time <= now);

    const flares24 = (solarFlares as (SolarFlare & { hasCME?: boolean })[]).filter(flare => {
      const t = flare.peakTime ?? flare.beginTime ?? flare.endTime;
      const ts = t ? new Date(t).getTime() : NaN;
      return !isNaN(ts) && ts >= dayAgo && ts <= now;
    });

    if (xray24.length === 0 && proton24.length === 0 && flares24.length === 0) {
      setActivitySummary(null);
      return;
    }

    const highestXray = xray24.reduce(
      (max, current) => (current.short > max.short ? current : max),
      { short: 0, time: 0 }
    );

    const highestProton = proton24.reduce(
      (max, current) => (current.flux > max.flux ? current : max),
      { flux: 0, time: 0 }
    );

    const flareCounts = { x: 0, m: 0, potentialCMEs: 0 };
    flares24.forEach(flare => {
      const type = flare.classType?.[0]?.toUpperCase();
      if (type === 'X') flareCounts.x++;
      else if (type === 'M') flareCounts.m++;
      if (isPotentialEarthDirected(flare as any)) flareCounts.potentialCMEs++;
    });

    setActivitySummary({
      highestXray: {
        flux: highestXray.short,
        class: getXrayClass(highestXray.short),
        timestamp: highestXray.time,
      },
      highestProton: {
        flux: highestProton.flux,
        class: getProtonClass(highestProton.flux),
        timestamp: highestProton.time,
      },
      flareCounts,
    });
  }, [allXrayData, allProtonData, solarFlares]);

  // --- RENDER ---
  return (
    <div
      className="w-full h-full bg-neutral-900 text-neutral-300 relative"
      style={{ backgroundImage: `url('/background-solar.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}
    >
      <div className="absolute inset-0 bg-black/50 z-0"></div>
      <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
        <style>{`body { overflow-y: auto !important; } .styled-scrollbar::-webkit-scrollbar { width: 8px; } .styled-scrollbar::-webkit-scrollbar-track { background: #262626; } .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; }`}</style>
        <div className="container mx-auto">
          <header className="text-center mb-8">
            <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer">
              <img src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" alt="TNR Protography Logo" className="mx-auto w-full max-w-[250px] mb-4"/>
            </a>
            <h1 className="text-3xl font-bold text-neutral-100">Solar Activity Dashboard</h1>
          </header>

          <main className="grid grid-cols-12 gap-5">
            <div className="col-span-12 card bg-neutral-950/80 p-4 mb-4 flex flex-col sm:flex-row justify-between items-center text-sm">
              <div className="flex-1 text-center sm:text-left mb-2 sm:mb-0">
                <h3 className="text-neutral-200 font-semibold mb-1">
                  Current Status: <span className={`font-bold ${
                    overallActivityStatus === 'Quiet' ? 'text-green-400' :
                    overallActivityStatus === 'Moderate' ? 'text-yellow-400' :
                    overallActivityStatus === 'High' ? 'text-orange-400' : 'text-red-500'
                  }`}>{overallActivityStatus}</span>
                </h3>
                <p>X-ray Flux: <span className="font-mono text-cyan-300">{currentXraySummary.flux !== null ? currentXraySummary.flux.toExponential(2) : 'N/A'}</span> ({currentXraySummary.class || 'N/A'})</p>
                <p>Proton Flux: <span className="font-mono text-yellow-400">{currentProtonSummary.flux !== null ? currentProtonSummary.flux.toFixed(2) : 'N/A'}</span> pfu ({currentProtonSummary.class || 'N/A'})</p>
              </div>
              <div className="flex-1 text-center sm:text-right">
                <h3 className="text-neutral-200 font-semibold mb-1">Latest Event:</h3>
                <p className="text-orange-300 italic">{latestRelevantEvent || 'No significant events recently.'}</p>
              </div>
            </div>

            <SolarActivitySummaryDisplay summary={activitySummary} />

            {/* --- SOLAR IMAGERY (Full Width) --- */}
            <div className="col-span-12 card bg-neutral-950/80 p-4 h-[700px] flex flex-col">
              <div className="flex justify-center items-center gap-2">
                <h2 className="text-xl font-semibold text-white mb-2">Solar Imagery</h2>
                <button
                  onClick={() => openModal('solar-imagery')}
                  className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
                  title="Information about Solar Imagery types."
                >
                  ?
                </button>
              </div>

              <div className="flex justify-center gap-2 my-2 flex-wrap mb-4">
                <button onClick={() => setActiveSunImage('SUVI_131')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SUVI_131' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SUVI 131Å</button>
                <button onClick={() => setActiveSunImage('SUVI_304')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SUVI_304' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SUVI 304Å</button>
                <button onClick={() => setActiveSunImage('SUVI_195')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SUVI_195' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SUVI 195Å</button>
                <button onClick={() => setActiveSunImage('SDO_HMIBC_1024')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_HMIBC_1024' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SDO HMI Cont.</button>
                <button onClick={() => setActiveSunImage('SDO_HMIIF_1024')} className={`px-3 py-1 text-xs rounded transition-colors ${activeSunImage === 'SDO_HMIIF_1024' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>SDO HMI Int.</button>
              </div>

              <div className="flex justify-center mb-3">
                <button
                  onClick={() => openSolarImageryAnimation(activeSunImage)}
                  className="px-4 py-2 text-xs sm:text-sm rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-semibold transition-colors"
                  title="Play a generated 6-hour animation for the selected solar imagery mode"
                >
                  Animate last 6 hours ({imageryModeLabels[activeSunImage]})
                </button>
              </div>

              <div className="flex-grow flex justify-center items-center relative w-full h-full min-h-[500px]">
                {activeSunImage === 'SUVI_131' && (
                  <div onClick={() => suvi131.url !== '/placeholder.png' && suvi131.url !== '/error.png' && setViewerMedia({ url: suvi131.url, type: 'image' })}
                       className="w-full h-full flex justify-center items-center cursor-pointer"
                       title={tooltipContent['suvi-131']}>
                    <img src={suvi131.url} alt="SUVI 131Å" className="w-full h-full object-contain rounded-lg" />
                    {suvi131.loading && <LoadingSpinner message={suvi131.loading} />}
                  </div>
                )}
                {activeSunImage === 'SUVI_304' && (
                  <div onClick={() => suvi304.url !== '/placeholder.png' && suvi304.url !== '/error.png' && setViewerMedia({ url: suvi304.url, type: 'image' })}
                       className="w-full h-full flex justify-center items-center cursor-pointer"
                       title={tooltipContent['suvi-304']}>
                    <img src={suvi304.url} alt="SUVI 304Å" className="w-full h-full object-contain rounded-lg" />
                    {suvi304.loading && <LoadingSpinner message={suvi304.loading} />}
                  </div>
                )}
                {activeSunImage === 'SUVI_195' && (
                  <div onClick={() => suvi195.url !== '/placeholder.png' && suvi195.url !== '/error.png' && setViewerMedia({ url: suvi195.url, type: 'image' })}
                       className="w-full h-full flex justify-center items-center cursor-pointer"
                       title={tooltipContent['suvi-195']}>
                    <img src={suvi195.url} alt="SUVI 195Å" className="w-full h-full object-contain rounded-lg" />
                    {suvi195.loading && <LoadingSpinner message={suvi195.loading} />}
                  </div>
                )}
                {activeSunImage === 'SDO_HMIBC_1024' && (
                  <div onClick={() => sdoHmiBc1024.url !== '/placeholder.png' && sdoHmiBc1024.url !== '/error.png' && setViewerMedia({ url: sdoHmiBc1024.url, type: 'image' })}
                       className="w-full h-full flex justify-center items-center cursor-pointer"
                       title={tooltipContent['sdo-hmibc-1024']}>
                    <img src={sdoHmiBc1024.url} alt="SDO HMI Continuum" className="w-full h-full object-contain rounded-lg" />
                    {sdoHmiBc1024.loading && <LoadingSpinner message={sdoHmiBc1024.loading} />}
                  </div>
                )}
                {activeSunImage === 'SDO_HMIIF_1024' && (
                  <div onClick={() => sdoHmiIf1024.url !== '/placeholder.png' && sdoHmiIf1024.url !== '/error.png' && setViewerMedia({ url: sdoHmiIf1024.url, type: 'image' })}
                       className="w-full h-full flex justify-center items-center cursor-pointer"
                       title={tooltipContent['sdo-hmiif-1024']}>
                    <img src={sdoHmiIf1024.url} alt="SDO HMI Intensitygram" className="w-full h-full object-contain rounded-lg" />
                    {sdoHmiIf1024.loading && <LoadingSpinner message={sdoHmiIf1024.loading} />}
                  </div>
                )}
              </div>

              <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastImagesUpdate || 'N/A'}</div>
            </div>

            {/* IPS section removed entirely */}

            <div id="goes-xray-flux-section" className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
              <div className="flex justify-center items-center gap-2">
                <h2 className="text-xl font-semibold text-white mb-2">GOES X-ray Flux</h2>
                <button onClick={() => openModal('xray-flux')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about X-ray Flux.">?</button>
              </div>
              <TimeRangeButtons onSelect={setXrayTimeRange} selected={xrayTimeRange} />
              <div className="flex-grow relative mt-2" title={tooltipContent['xray-flux']}>
                {xrayChartData.datasets[0]?.data.length > 0 ? <Line data={xrayChartData} options={xrayChartOptions} /> : <LoadingSpinner message={loadingXray} />}
              </div>
              <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastXrayUpdate || 'N/A'}</div>
            </div>

            <div id="solar-flares-section" className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col min-h-[400px]">
              <div className="flex justify-center items-center gap-2">
                <h2 className="text-xl font-semibold text-white text-center mb-4">Latest Solar Flares (Last 7 Days)</h2>
                <button onClick={() => openModal('solar-flares')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Solar Flares.">?</button>
              </div>
              <div className="flex-grow overflow-y-auto max-h-96 styled-scrollbar pr-2">
                {loadingFlares ? (
                  <LoadingSpinner message={loadingFlares} />
                ) : solarFlares.length > 0 ? (
                  <ul className="space-y-2">
                    {solarFlares.map((flare: any) => {
                      const { background, text } = getColorForFlareClass(flare.classType);
                      const cmeHighlight = flare.hasCME ? 'border-sky-400 shadow-lg shadow-sky-500/10' : 'border-transparent';
                      return (
                        <li key={flare.flrID} onClick={() => setSelectedFlare(flare)} className={`bg-neutral-800 p-2 rounded text-sm cursor-pointer transition-all hover:bg-neutral-700 border-2 ${cmeHighlight}`}>
                          <div className="flex justify-between items-center">
                            <span>
                              <strong className={`px-2 py-0.5 rounded ${text}`} style={{ backgroundColor: background }}>{flare.classType}</strong>
                              <span className="ml-2">at {formatNZTimestamp(flare.peakTime)}</span>
                            </span>
                            {flare.hasCME && <span className="text-xs font-bold text-sky-400 animate-pulse">CME Event</span>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-center text-neutral-400 italic">No solar flares detected recently.</p>
                  </div>
                )}
              </div>
              <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastFlaresUpdate || 'N/A'}</div>
            </div>

            <div className="col-span-12 card bg-neutral-950/80 p-4 h-[400px] flex flex-col">
              <div className="flex justify-center items-center gap-2">
                <h2 className="text-xl font-semibold text-white text-center mb-4">CCOR1 Coronagraph Video</h2>
                <button onClick={() => openModal('ccor1-video')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about CCOR1 Coronagraph Video.">?</button>
              </div>
              <div
                onClick={() => ccor1Video.url && setViewerMedia({ url: ccor1Video.url, type: 'video' })}
                className="flex-grow flex justify-center items-center cursor-pointer relative min-h-0 w-full h-full"
                title={tooltipContent['ccor1-video']}
              >
                {ccor1Video.loading && <LoadingSpinner message={ccor1Video.loading} />}
                {ccor1Video.url && !ccor1Video.loading ? (
                  <video controls muted loop className="max-w-full max-h-full object-contain rounded-lg">
                    <source src={ccor1Video.url} type="video/mp4" />
                    Your browser does not support the video tag.
                  </video>
                ) : (!ccor1Video.loading && <p className="text-neutral-400 italic">Video not available.</p>)}
              </div>
            </div>

            <div className="col-span-12 card bg-neutral-950/80 p-4 h-[500px] flex flex-col">
              <div className="flex justify-center items-center gap-2">
                <h2 className="text-xl font-semibold text-white mb-2">GOES Proton Flux ({'>'}=10 MeV)</h2>
                <button onClick={() => openModal('proton-flux')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Proton Flux.">?</button>
              </div>
              <TimeRangeButtons onSelect={setProtonTimeRange} selected={protonTimeRange} />
              <div className="flex-grow relative mt-2" title={tooltipContent['proton-flux']}>
                {protonChartData.datasets[0]?.data.length > 0 ? <Line data={protonChartData} options={protonChartOptions} /> : <LoadingSpinner message={loadingProton} />}
              </div>
              <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastProtonUpdate || 'N/A'}</div>
            </div>
          </main>

          <footer className="page-footer mt-10 pt-8 border-t border-neutral-700 text-center text-neutral-400 text-sm">
            <h3 className="text-lg font-semibold text-neutral-200 mb-4">About This Dashboard</h3>
            <p className="max-w-3xl mx-auto leading-relaxed">This dashboard provides real-time information on solar X-ray flux, proton flux, solar flares, and related space weather phenomena. Data is sourced directly from official NASA and NOAA APIs.</p>
            <p className="max-w-3xl mx-auto leading-relaxed mt-4"><strong>Disclaimer:</strong> Solar activity can be highly unpredictable. While this dashboard provides the latest available data, interpretations are for informational purposes only.</p>
            <div className="mt-8 text-xs text-neutral-500">
              <p>Data provided by <a href="https://www.swpc.noaa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a> & <a href="https://api.nasa.gov/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a></p>
              <p className="mt-2">Visualization and Development by TNR Protography</p>
            </div>
          </footer>
        </div>
      </div>

      {/* Flare Modal */}
      <InfoModal
        isOpen={!!selectedFlare}
        onClose={() => setSelectedFlare(null)}
        title={`Flare Details: ${selectedFlare?.flrID || ''}`}
        content={
          selectedFlare && (
            <div className="space-y-2">
              <p><strong>Class:</strong> {selectedFlare.classType}</p>
              <p><strong>Begin Time (NZT):</strong> {formatNZTimestamp(selectedFlare.beginTime)}</p>
              <p><strong>Peak Time (NZT):</strong> {formatNZTimestamp(selectedFlare.peakTime)}</p>
              <p><strong>End Time (NZT):</strong> {formatNZTimestamp(selectedFlare.endTime)}</p>
              <p><strong>Source Location:</strong> {selectedFlare.sourceLocation}</p>
              <p><strong>Active Region:</strong> {selectedFlare.activeRegionNum || 'N/A'}</p>
              <p><strong>CME Associated:</strong> {(selectedFlare as any).hasCME ? 'Yes' : 'No'}</p>
              <p><a href={selectedFlare.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">View on NASA DONKI</a></p>
              {(selectedFlare as any).hasCME && selectedFlare.linkedEvents?.find((e: any) => e.activityID.includes('CME')) && (
                <button
                  onClick={() => {
                    const id = selectedFlare.linkedEvents!.find((e: any) => e.activityID.includes('CME'))!.activityID;
                    onViewCMEInVisualization(id);
                    setSelectedFlare(null);
                  }}
                  className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-semibold hover:bg-indigo-500 transition-colors"
                >
                  View in CME Visualization
                </button>
              )}
            </div>
          )
        }
      />

      {/* General Info Modal */}
      {modalState && (
        <InfoModal
          isOpen={modalState.isOpen}
          onClose={closeModal}
          title={modalState.title}
          content={modalState.content}
        />
      )}
    </div>
  );
};

export default SolarActivityDashboard;
// --- END OF FILE src/components/SolarActivityDashboard.tsx ---