// --- START OF FILE src/components/SolarActivityDashboard.tsx ---

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import { enNZ } from 'date-fns/locale';
import CloseIcon from './icons/CloseIcon';
import '../utils/chartSetup'; // registers Chart.js scales/plugins — must run before any <Line> renders
// Import only flare functions/types (IPS removed)
import { 
  fetchFlareData, 
  SolarFlare
} from '../services/nasaService';
import { stableHash } from '../utils/dataFreshness';
import { registerDatasetTicker } from '../utils/pollingScheduler';
import { workerStatePreload } from '../utils/appPreloader';

interface SolarActivityDashboardProps {
  setViewerMedia: (media: { url: string, type: 'image' | 'video' | 'animation' } | { type: 'image_with_labels'; url: string; labels: { id: string; xPercent: number; yPercent: number; text: string }[] } | null) => void;
  setLatestXrayFlux: (flux: number | null) => void;
  onViewCMEInVisualization: (cmeId: string) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
  refreshSignal: number;
  onSuvi195ImageUrlChange?: (url: string | null) => void;
  onInitialLoad?: () => void;
  onInitialLoadProgress?: (task: 'solarXray' | 'solarProton' | 'solarFlares' | 'solarRegions') => void;
  modalSlug?: string | null;
  onModalSlugChange?: (slug: string | null) => void;
}

interface SolarActivitySummary {
  highestXray: { flux: number; class: string; timestamp: number; };
  highestProton: { flux: number; class: string; timestamp: number; };
  flareCounts: { x: number; m: number; potentialCMEs: number; };
}


interface ActiveSunspotRegion {
  region: string;
  location: string;
  area: number | null;
  magneticClass: string | null;
  spotCount: number | null;
  latitude: number | null;
  longitude: number | null;
  observedTime: number | null;
  trend: 'Growing' | 'Shrinking' | 'Stable';
  cFlareProbability: number | null;
  mFlareProbability: number | null;
  xFlareProbability: number | null;
  protonProbability: number | null;
  cFlareEvents24h: number | null;
  mFlareEvents24h: number | null;
  xFlareEvents24h: number | null;
  previousActivity: string | null;
  classification: string | null;
  source: string | null;
}

type CoronagraphSourceKey = 'soho_c2' | 'soho_c3' | 'stereo_cor2' | 'ccor1';
type SuviWorkerSourceKey = 'suvi_195_primary' | 'suvi_304_secondary' | 'suvi_131_secondary';
interface CoronagraphFrame {
  key: string;
  ts: string;
  fetched_at?: string | null;
  url: string;
}
interface CoronagraphSourceState {
  label: string;
  frames: CoronagraphFrame[];
  latest_meta?: { ts?: string | null } | null;
}
interface CoronagraphStateResponse {
  ok: boolean;
  updated_utc?: string;
  sources?: Partial<Record<CoronagraphSourceKey, CoronagraphSourceState>>;
}
interface SuviWorkerFrame {
  key: string;
  ts: string;
  fetched_at?: string | null;
  url: string;
}
interface SuviWorkerSourceState {
  label: string;
  frames: SuviWorkerFrame[];
}
interface SuviWorkerStateResponse {
  ok: boolean;
  updated_utc?: string;
  sources?: Partial<Record<SuviWorkerSourceKey, SuviWorkerSourceState>>;
}

const isValidSunspotRegion = (value: any): value is Omit<ActiveSunspotRegion, 'trend'> & { _sourceIndex?: number } => {
  return Boolean(value && typeof value === 'object' && typeof value.region === 'string' && value.region.length > 0);
};

const isEarthVisibleCoordinate = (latitude: number | null, longitude: number | null): boolean => {
  if (latitude === null || longitude === null) return false;
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 90;
};

const isEarthFacingCoordinate = (latitude: number | null, longitude: number | null): boolean => {
  if (latitude === null || longitude === null) return false;
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 80;
};


const parseNoaaUtcTimestamp = (value: unknown): number | null => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // NOAA feeds are UTC; if the timestamp lacks an explicit zone, force UTC.
  const hasExplicitZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = hasExplicitZone ? raw : `${raw}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const getNzOffsetMs = (timestamp: number): number => {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    timeZoneName: 'shortOffset',
    hour: '2-digit',
  }).formatToParts(new Date(timestamp));
  const label = parts.find((part) => part.type === 'timeZoneName')?.value || 'UTC+0';
  const match = label.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2]) || 0;
  const minutes = Number(match[3] || '0');
  return sign * ((hours * 60 + minutes) * 60 * 1000);
};

const toNzEpochMs = (timestamp: number): number => timestamp + getNzOffsetMs(timestamp);

const normalizeSolarLongitude = (value: number | null): number | null => {
  if (value === null || !Number.isFinite(value)) return null;
  let normalized = value;
  if (Math.abs(normalized) > 360) return null;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return Math.max(-180, Math.min(180, normalized));
};


type SolarImageryMode = 'SUVI_131' | 'SUVI_195' | 'SUVI_304' | 'SDO_HMIBC_1024' | 'SDO_HMIIF_1024';
type SunspotImageryMode = 'colorized' | 'magnetogram' | 'intensity';
type PlaybackSpeedOption = 0.5 | 1 | 2 | 5 | 10;

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
const NOAA_ACTIVE_REGIONS_TEXT_URL = 'https://services.swpc.noaa.gov/text/solar-regions.txt';
const NOAA_SOLAR_PROBABILITIES_URL = 'https://services.swpc.noaa.gov/json/solar_probabilities.json';
const NOAA_ACTIVE_REGIONS_URLS = [
  'https://services.swpc.noaa.gov/json/sunspot_report.json',
  'https://services.swpc.noaa.gov/json/solar_regions.json',
  'https://services.swpc.noaa.gov/products/solar-region-summary.json',
];
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const SUVI_304_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png';
const SUVI_195_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/latest.png';
const SUVI_131_INDEX_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/';
const SUVI_304_INDEX_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/';
const SUVI_195_INDEX_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/195/';
const SUVI_FRAME_INTERVAL_MINUTES = 4;
const CORONAGRAPHY_WORKER_BASE = 'https://coronagraphy-processing.thenamesrock.workers.dev';
const SUVI_DIFF_WORKER_BASE = 'https://suvi-difference-imagery.thenamesrock.workers.dev';
const SOLO_BASE = 'https://solo-worker.thenamesrock.workers.dev';
const CORONAGRAPH_SOURCES: { key: CoronagraphSourceKey; label: string }[] = [
  { key: 'ccor1', label: 'GOES-19 CCOR-1' },
  { key: 'soho_c2', label: 'SOHO LASCO C2' },
  { key: 'soho_c3', label: 'SOHO LASCO C3' },
  { key: 'stereo_cor2', label: 'STEREO-A COR2' },
];
// HMI images — JSOC primary, NASA SDO fallback
const JSOC_HMI_BASE = 'https://jsoc1.stanford.edu/data/hmi/images/latest';
const NASA_SDO_BASE = 'https://sdo.gsfc.nasa.gov/assets/img/latest';

// Primary URLs (used for display)
const SDO_HMI_BC_1024_URL = `${JSOC_HMI_BASE}/HMI_latest_color_Mag_1024x1024.jpg`;
const SDO_HMI_B_1024_URL  = `${JSOC_HMI_BASE}/HMI_latest_Mag_1024x1024.gif`;
const SDO_HMI_IF_1024_URL = `${JSOC_HMI_BASE}/HMI_latest_colInt_1024x1024.jpg`;
const SDO_HMI_BC_4096_URL = `${JSOC_HMI_BASE}/HMI_latest_color_Mag_4096x4096.jpg`;
const SDO_HMI_B_4096_URL  = `${JSOC_HMI_BASE}/HMI_latest_Mag_4096x4096.gif`;
const SDO_HMI_IF_4096_URL = `${JSOC_HMI_BASE}/HMI_latest_colInt_4096x4096.jpg`;

// Fallback URLs (NASA SDO direct — old version source that worked)
const SDO_HMI_BC_1024_FALLBACK = `${NASA_SDO_BASE}/latest_1024_HMIBC.jpg`;
const SDO_HMI_B_1024_FALLBACK  = `${NASA_SDO_BASE}/latest_1024_HMIB.jpg`;
const SDO_HMI_IF_1024_FALLBACK = `${NASA_SDO_BASE}/latest_1024_HMII.jpg`;
const SDO_HMI_BC_4096_FALLBACK = `${NASA_SDO_BASE}/latest_4096_HMIBC.jpg`;
const SDO_HMI_B_4096_FALLBACK  = `${NASA_SDO_BASE}/latest_4096_HMIB.jpg`;
const SDO_HMI_IF_4096_FALLBACK = `${NASA_SDO_BASE}/latest_4096_HMII.jpg`;

// Load directly — no Worker dependency, no domain-matching issues.
const resolveSdoImageUrl = (rawUrl: string, _forceDirect?: boolean) => rawUrl;
const REFRESH_INTERVAL_MS = 60 * 1000; // Refresh every minute
const HMI_IMAGE_SIZE = 4096;
const SDO_HMI_NATIVE_CX = 2048;
const SDO_HMI_NATIVE_CY = 2048;
const SDO_HMI_NATIVE_RADIUS = 1980;
const DISK_LABEL_OFFSET_X_PX = 200;
const DISK_LABEL_OFFSET_Y_PX = -200;
const CLOSEUP_OFFSET_X_PX = 200;
const CLOSEUP_OFFSET_Y_PX = -200;
const ACTIVE_REGION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ACTIVE_REGION_MIN_AREA_MSH = 0;
const SOLAR_IMAGE_CACHE_TTL_MS = 60 * 60 * 1000;
const solarImageCache = new Map<string, { url: string; fetchedAt: number }>();

const FETCH_TIMEOUT_MS = 12000;
const MAX_FETCH_RETRIES = 2;
const SUVI_WORKER_FETCH_TIMEOUT_MS = 30000;
const DIFF_WATERMARK_URL = '/icons/icon-default.png';
const IMAGE_CONCURRENCY_LIMIT = 4;
let inFlightImageLoads = 0;
const queuedImageLoads: Array<() => void> = [];
const PLAYBACK_SPEED_OPTIONS: PlaybackSpeedOption[] = [0.5, 1, 2, 5, 10];
const DIFF_LEGEND_GRADIENT = 'linear-gradient(90deg, #000000 0%, #22d3ee 22%, #fde047 48%, #f97316 68%, #ef4444 84%, #ffffff 100%)';

const devLog = (...args: unknown[]) => {
  if (!import.meta.env.DEV) return;
  console.info('[solar-preload]', ...args);
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Thrown when a proxy request gets a definitive 404 — no point retrying.
class ProxyUnavailableError extends Error {
  constructor(url: string) {
    super(`Proxy unavailable (404) for ${url}`);
    this.name = 'ProxyUnavailableError';
  }
}

type FetchRetryOptions = {
  timeoutMs?: number;
  retries?: number;
  cache?: RequestCache;
};

const fetchWithTimeoutAndRetry = async (
  url: string,
  parseAs: 'json' | 'text' | 'blob' = 'json',
  options: FetchRetryOptions = {}
) => {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxRetries = options.retries ?? MAX_FETCH_RETRIES;
  const cacheMode = options.cache ?? 'default';
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: cacheMode });
      if (!response.ok) {
        // 404 on a proxy URL means the Worker isn't deployed on this domain — skip retries.
        if (response.status === 404 && url.includes('/api/proxy/')) {
          throw new ProxyUnavailableError(url);
        }
        throw new Error(`HTTP ${response.status} for ${url}`);
      }
      if (parseAs === 'json') return await response.json();
      if (parseAs === 'blob') return await response.blob();
      return await response.text();
    } catch (error) {
      if (controller.signal.aborted) {
        lastError = new Error(`Request timed out after ${timeoutMs}ms for ${url}`);
      } else {
        lastError = error instanceof Error ? error : new Error('Unknown fetch error');
      }
      // Don't retry proxy 404s — fall through immediately to the direct-URL fallback.
      if (lastError instanceof ProxyUnavailableError) break;
      if (attempt < maxRetries) await wait(350 * (attempt + 1));
    } finally {
      window.clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error(`Failed to fetch ${url}`);
};

const enqueueImageLoad = (task: () => void) => {
  if (inFlightImageLoads < IMAGE_CONCURRENCY_LIMIT) {
    inFlightImageLoads++;
    task();
    return;
  }
  queuedImageLoads.push(task);
};


const extractTargetUrlFromProxy = (url: string): string | null => {
  try {
    const parsed = new URL(url, window.location.origin);
    const encoded = parsed.searchParams.get('url');
    return encoded ? decodeURIComponent(encoded) : null;
  } catch {
    return null;
  }
};

const isLikelySameOriginOrProxy = (url: string): boolean => {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.origin === window.location.origin
      || parsed.pathname.startsWith('/api/proxy/');
  } catch {
    return false;
  }
};

const releaseImageLoadSlot = () => {
  inFlightImageLoads = Math.max(0, inFlightImageLoads - 1);
  const next = queuedImageLoads.shift();
  if (next) {
    inFlightImageLoads++;
    next();
  }
};


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


const parseLatitudeLongitude = (location?: string | null): { latitude: number | null; longitude: number | null } => {
  if (!location) return { latitude: null, longitude: null };
  const normalized = String(location).toUpperCase().replace(/\s+/g, '');
  const m = normalized.match(/([NS])(\d{1,2})([EW])(\d{1,3})/i);
  if (!m) return { latitude: null, longitude: null };
  const latMag = parseInt(m[2], 10);
  const lonMag = parseInt(m[4], 10);
  if (!Number.isFinite(latMag) || !Number.isFinite(lonMag)) return { latitude: null, longitude: null };
  const latitude = m[1].toUpperCase() === 'N' ? latMag : -latMag;
  const longitude = m[3].toUpperCase() === 'W' ? lonMag : -lonMag;
  return { latitude, longitude };
};

const clampToRange = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const constrainToSolarDiskBounds = (
  x: number,
  y: number,
  geometry: { cx: number; cy: number; radius: number }
): { x: number; y: number } => {
  const minX = geometry.cx - geometry.radius;
  const maxX = geometry.cx + geometry.radius;
  const minY = geometry.cy - geometry.radius;
  const maxY = geometry.cy + geometry.radius;
  return {
    x: clampToRange(x, minX, maxX),
    y: clampToRange(y, minY, maxY),
  };
};

const solarCoordsToPixel = (latitude: number, longitude: number, cx: number, cy: number, radius: number) => {
  const latRad = latitude * (Math.PI / 180);
  const lonRad = longitude * (Math.PI / 180);
  const x = cx + radius * Math.cos(latRad) * Math.sin(lonRad);
  const y = cy - radius * Math.sin(latRad);
  const visibleHemisphere = Math.cos(latRad) * Math.cos(lonRad) >= 0;
  const onDisk = visibleHemisphere && ((x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2);
  return { x, y, onDisk };
};

const detectSolarDiskGeometry = (source: HTMLImageElement): { width: number; height: number; cx: number; cy: number; radius: number } => {
  const width = source.naturalWidth || HMI_IMAGE_SIZE;
  const height = source.naturalHeight || HMI_IMAGE_SIZE;
  const fallback = { width, height, cx: width / 2, cy: height / 2, radius: Math.min(width, height) * 0.48 };

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;

    ctx.drawImage(source, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height).data;
    const step = Math.max(1, Math.floor(Math.min(width, height) / 512));

    const isDiskPixel = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      const r = imageData[i];
      const g = imageData[i + 1];
      const b = imageData[i + 2];
      const a = imageData[i + 3];
      return a > 0 && (r + g + b) > 24;
    };

    let left = width;
    let right = 0;
    let top = height;
    let bottom = 0;

    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        if (isDiskPixel(x, y)) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }

    if (left >= right || top >= bottom) return fallback;
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const radius = Math.max((right - left), (bottom - top)) / 2;
    return { width, height, cx, cy, radius };
  } catch {
    return fallback;
  }
};

const getSunspotClassColor = (magneticClass?: string | null): string => {
  const c = String(magneticClass || '').toUpperCase();
  if (c.includes('DELTA') || c.includes('GAMMA')) return '#ef4444';
  if (c.includes('BETA')) return '#f97316';
  if (c.includes('ALPHA')) return '#22c55e';
  return '#facc15';
};

const getSunspotLabelStyle = (region: ActiveSunspotRegion): { background: string; text: string } => {
  const magneticTone = getSunspotClassColor(region.magneticClass);
  const maxFlareOdds = Math.max(region.cFlareProbability ?? 0, region.mFlareProbability ?? 0, region.xFlareProbability ?? 0);

  if (maxFlareOdds >= 50 || (region.magneticClass || '').toUpperCase().includes('DELTA')) {
    return { background: '#ef4444', text: '#ffffff' };
  }
  if (maxFlareOdds >= 25 || (region.magneticClass || '').toUpperCase().includes('GAMMA')) {
    return { background: '#f97316', text: '#111827' };
  }
  if (maxFlareOdds >= 10) {
    return { background: '#facc15', text: '#111827' };
  }

  return { background: magneticTone, text: magneticTone === '#22c55e' ? '#052e16' : '#111827' };
};

const getSunspotRiskBand = (region: ActiveSunspotRegion): { label: string; color: string } => {
  const c = String(region.magneticClass || '').toUpperCase();
  const m = region.mFlareProbability ?? 0;
  const x = region.xFlareProbability ?? 0;
  if (c.includes('DELTA') || x >= 10 || m >= 50) return { label: 'HIGH', color: '#ef4444' };
  if (c.includes('GAMMA') || m >= 20 || x >= 3) return { label: 'MODERATE', color: '#f97316' };
  if (c.includes('BETA') || m >= 10) return { label: 'LOW', color: '#facc15' };
  return { label: 'MINIMAL', color: '#22c55e' };
};

const normalizeMagneticClass = (value?: string | null): string | null => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  const compact = raw.replace(/[^A-Z]/g, '');
  const map: Record<string, string> = {
    A: 'ALPHA',
    ALPHA: 'ALPHA',
    B: 'BETA',
    BETA: 'BETA',
    BG: 'BETA-GAMMA',
    BETAGAMMA: 'BETA-GAMMA',
    BD: 'BETA-DELTA',
    BETADELTA: 'BETA-DELTA',
    BGD: 'BETA-GAMMA-DELTA',
    BETAGAMMADELTA: 'BETA-GAMMA-DELTA',
    G: 'GAMMA',
    GAMMA: 'GAMMA',
    D: 'DELTA',
    DELTA: 'DELTA',
  };
  return map[compact] || raw;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/%/g, '').replace(/,/g, '');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const getNumberFromAliases = (item: Record<string, unknown>, aliases: string[]): number | null => {
  const keysByNormalized = new Map<string, string>();
  Object.keys(item).forEach((key) => keysByNormalized.set(key.toLowerCase().replace(/[^a-z0-9]/g, ''), key));

  for (const alias of aliases) {
    const directValue = item[alias];
    const directParsed = toNumberOrNull(directValue);
    if (directParsed !== null) return directParsed;

    const normalizedAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, '');
    const matchedKey = keysByNormalized.get(normalizedAlias);
    if (matchedKey) {
      const parsed = toNumberOrNull(item[matchedKey]);
      if (parsed !== null) return parsed;
    }
  }

  return null;
};

const deriveProbabilityFromMagneticClass = (
  magneticClass: string | null,
  flareType: 'c' | 'm' | 'x',
): number | null => {
  if (!magneticClass) return null;
  const normalized = magneticClass.toUpperCase().replace(/[^A-Z]/g, '');
  const hasDelta = normalized.includes('DELTA') || normalized.endsWith('D');
  const hasGamma = normalized.includes('GAMMA') || normalized.includes('G');
  const hasBeta = normalized.includes('BETA') || normalized.includes('B');

  if (flareType === 'x') {
    if (hasDelta && hasGamma) return 15;
    if (hasDelta) return 8;
    if (hasGamma) return 4;
    return hasBeta ? 1 : 0;
  }

  if (flareType === 'm') {
    if (hasDelta && hasGamma) return 55;
    if (hasDelta) return 35;
    if (hasGamma) return 18;
    return hasBeta ? 8 : 3;
  }

  if (hasDelta && hasGamma) return 85;
  if (hasDelta) return 70;
  if (hasGamma) return 55;
  return hasBeta ? 35 : 15;
};

const extractRegionFromAny = (item: any): string => {
  const rawRegion = item?.region ?? item?.region_number ?? item?.regionNum ?? item?.noaa ?? item?.ar ?? item?.activeRegionNum;
  return rawRegion !== undefined && rawRegion !== null ? String(rawRegion).replace(/[^0-9A-Za-z]/g, '') : '';
};

const extractActiveRegionEntries = (raw: any, source: string) => {
  const regionArray = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.regions)
      ? raw.regions
      : Array.isArray(raw?.activeRegions)
        ? raw.activeRegions
        : [];

  return regionArray
    .map((item: any, idx: number) => {
      const region = extractRegionFromAny(item);
      if (!region) return null;

      const location = (item?.location ?? item?.lat_long ?? item?.latLong ?? '').toString().trim().toUpperCase();
      const coords = parseLatitudeLongitude(location);

      const lat = toNumberOrNull(item?.latitude ?? item?.lat ?? item?.helio_lat ?? item?.hpc_lat ?? item?.latitude_heliographic);
      const lon = normalizeSolarLongitude(toNumberOrNull(item?.longitude ?? item?.lon ?? item?.helio_lon ?? item?.hpc_lon ?? item?.longitude_heliographic));
      const observedTime = parseNoaaUtcTimestamp(item?.observed ?? item?.observed_time ?? item?.obs_time ?? item?.issue_datetime ?? item?.issue_time ?? item?.time_tag ?? item?.date);

      const magneticClass = normalizeMagneticClass(item?.magnetic_classification ?? item?.mag_class ?? item?.magneticClass ?? item?.zurich_classification);

      const cFlareProbability = getNumberFromAliases(item, [
        'c_flare_probability', 'cFlareProbability', 'cflare_probability', 'flare_probability_c', 'prob_c', 'c_prob', 'cclass_probability'
      ]) ?? deriveProbabilityFromMagneticClass(magneticClass, 'c');

      const mFlareProbability = getNumberFromAliases(item, [
        'm_flare_probability', 'mFlareProbability', 'mflare_probability', 'flare_probability_m', 'prob_m', 'm_prob', 'mclass_probability'
      ]) ?? deriveProbabilityFromMagneticClass(magneticClass, 'm');

      const xFlareProbability = getNumberFromAliases(item, [
        'x_flare_probability', 'xFlareProbability', 'xflare_probability', 'flare_probability_x', 'prob_x', 'x_prob', 'xclass_probability'
      ]) ?? deriveProbabilityFromMagneticClass(magneticClass, 'x');

      return {
        region,
        location: location || 'N/A',
        area: toNumberOrNull(item?.area ?? item?.spot_area ?? item?.spotArea ?? item?.area_millionths),
        spotCount: toNumberOrNull(item?.spot_count ?? item?.spotCount ?? item?.number_spots),
        magneticClass,
        classification: (item?.classification ?? item?.region_classification ?? item?.zurich_classification ?? '').toString().trim() || null,
        latitude: coords.latitude ?? lat,
        longitude: normalizeSolarLongitude(coords.longitude ?? lon),
        observedTime,
        cFlareProbability,
        mFlareProbability,
        xFlareProbability,
        protonProbability: getNumberFromAliases(item, ['proton_probability', 'protonProbability', 's1_probability', 'sep_probability', 'prob_s1', 's1_prob']),
        cFlareEvents24h: toNumberOrNull(item?.c_flare_events_24h ?? item?.c_flare_events ?? item?.cflare_events_24h ?? item?.c_events_24h ?? item?.c_event_count),
        mFlareEvents24h: toNumberOrNull(item?.m_flare_events_24h ?? item?.m_flare_events ?? item?.mflare_events_24h ?? item?.m_events_24h ?? item?.m_event_count),
        xFlareEvents24h: toNumberOrNull(item?.x_flare_events_24h ?? item?.x_flare_events ?? item?.xflare_events_24h ?? item?.x_events_24h ?? item?.x_event_count),
        previousActivity: (item?.previous_activity ?? item?.recent_activity ?? item?.activity_summary ?? item?.flare_history ?? item?.recent_events ?? '').toString().trim() || null,
        _sourceIndex: idx,
        source,
      };
    })
    .filter(isValidSunspotRegion);
};

const parseNoaaSolarRegionsText = (raw: string): (Omit<ActiveSunspotRegion, 'trend'> & { _sourceIndex?: number })[] => {
  const lines = raw.split(/\r?\n/);
  return lines
    .map((line, idx) => {
      const l = line.trim();
      if (!/^\d{4,5}\s+/.test(l)) return null;
      const parts = l.split(/\s+/);
      if (parts.length < 8) return null;

      const region = String(parts[0]).replace(/[^0-9A-Za-z]/g, '');
      const location = String(parts[1] || '').toUpperCase();
      const coords = parseLatitudeLongitude(location);

      const area = Number.isFinite(Number(parts[3])) ? Number(parts[3]) : null;
      const spotCount = Number.isFinite(Number(parts[6])) ? Number(parts[6]) : null;
      const magneticClass = normalizeMagneticClass(parts[7] || null);

      if (!region || coords.latitude === null || coords.longitude === null) return null;

      return {
        region,
        location,
        area,
        magneticClass,
        spotCount,
        latitude: coords.latitude,
        longitude: normalizeSolarLongitude(coords.longitude),
        observedTime: null,
        cFlareProbability: null,
        mFlareProbability: null,
        xFlareProbability: null,
        protonProbability: null,
        cFlareEvents24h: null,
        mFlareEvents24h: null,
        xFlareEvents24h: null,
        previousActivity: null,
        classification: null,
        source: 'solar-regions.txt',
        _sourceIndex: idx,
      };
    })
    .filter((item): item is Omit<ActiveSunspotRegion, 'trend'> => Boolean(item));
};

// Heuristic: Potential earth-directed if a CME is linked and source longitude within ±30°
const isPotentialEarthDirected = (flare: SolarFlare): boolean => {
  // @ts-ignore - we compute hasCME when processing flares
  if (!flare.hasCME) return false;
  const lon = parseLongitude(flare.sourceLocation);
  if (lon === null) return false;
  return Math.abs(lon) <= 30; // tweak if you want stricter/looser
};


const getFirstNumber = (entries: Array<any>, selector: (entry: any) => number | null): number | null => {
  for (const entry of entries) {
    const value = selector(entry);
    if (value !== null && Number.isFinite(value)) return value;
  }
  return null;
};

const getFirstText = (entries: Array<any>, selector: (entry: any) => string | null): string | null => {
  for (const entry of entries) {
    const value = selector(entry);
    if (value && value.trim()) return value;
  }
  return null;
};


const getSunspotDetailCompleteness = (entry: Omit<ActiveSunspotRegion, 'trend'>): number => {
  let score = 0;
  if (entry.magneticClass) score++;
  if (entry.classification) score++;
  if (entry.area !== null) score++;
  if (entry.spotCount !== null) score++;
  if (entry.mFlareProbability !== null) score++;
  if (entry.xFlareProbability !== null) score++;
  if (entry.protonProbability !== null) score++;
  if (entry.previousActivity) score++;
  if (entry.cFlareEvents24h !== null || entry.mFlareEvents24h !== null || entry.xFlareEvents24h !== null) score++;
  return score;
};

// --- REUSABLE COMPONENTS ---

// Time-window selector for imagery sections (SUVI + Coronagraph)
// 12h and 24h are flagged BETA — they load many more frames and
// diff computation is slower on lower-end devices.
const ImageryTimeRangeButtons: React.FC<{
  selected: number;
  onSelect: (hours: number) => void;
}> = ({ selected, onSelect }) => {
  const options = [
    { label: '3h',  hours: 3 },
    { label: '6h',  hours: 6 },
    { label: '12h', hours: 12, beta: true },
    { label: '24h', hours: 24, beta: true },
  ] as const;
  return (
    <div className="flex gap-2 flex-wrap items-center">
      {options.map(({ label, hours, beta }) => (
        <button
          key={hours}
          onClick={() => onSelect(hours)}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs rounded transition-colors ${
            selected === hours
              ? 'bg-sky-600 text-white'
              : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-200'
          }`}
        >
          {label}
          {beta && (
            <span className="inline-flex items-center px-1 py-px rounded text-[9px] font-bold bg-amber-400 text-neutral-900 leading-none tracking-wide">
              BETA
            </span>
          )}
        </button>
      ))}
    </div>
  );
};

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
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (<div dangerouslySetInnerHTML={{ __html: content }} />) : (content)}
        </div>
      </div>
    </div>,
    document.body
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

const SolarActivitySummaryDisplay: React.FC<{ summary: SolarActivitySummary | null; onOpenModal: (id: string) => void }> = ({ summary, onOpenModal }) => {
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
      <div className="flex items-center justify-center gap-2">
        <h2 className="text-2xl font-bold text-white text-center">24-Hour Solar Summary</h2>
        <button onClick={() => onOpenModal('solar-summary')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="About 24-hour summary metrics">?</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center" title="Peak X-ray class over the last 24h. Higher classes indicate stronger flare energy and elevated CME risk context.">
          <h3 className="text-lg font-semibold text-neutral-200 mb-2">Peak X-ray Flux</h3>
          <p className="text-5xl font-bold" style={{ color: getColorForFlux(summary.highestXray.flux) }}>
            {summary.highestXray.class}
          </p>
          <p className="text-sm text-neutral-400 mt-1">at {formatTime(summary.highestXray.timestamp)}</p>
        </div>

        <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center" title="Counts of stronger flares and potential Earth-directed CME-linked events in the last 24h.">
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

        <div className="bg-neutral-900/70 p-4 rounded-lg border border-neutral-700/60 text-center" title="Peak >10 MeV proton flux over the last 24h. Elevated proton environments indicate disturbed heliospheric conditions.">
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
const SolarActivityDashboard: React.FC<SolarActivityDashboardProps> = ({ setViewerMedia, setLatestXrayFlux, onViewCMEInVisualization, refreshSignal, onSuvi195ImageUrlChange, onInitialLoad, onInitialLoadProgress, modalSlug, onModalSlugChange }) => {
  const isInitialLoad = useRef(true);
  const reportedInitialTasks = useRef<Set<'solarXray' | 'solarProton' | 'solarFlares' | 'solarRegions'>>(new Set());

  const reportInitialTask = useCallback((task: 'solarXray' | 'solarProton' | 'solarFlares' | 'solarRegions') => {
    if (!isInitialLoad.current || reportedInitialTasks.current.has(task)) return;
    reportedInitialTasks.current.add(task);
    onInitialLoadProgress?.(task);
  }, [onInitialLoadProgress]);
  // Imagery state — url starts null (no placeholder); spinner shows until fetch completes.
  const [suvi131, setSuvi131] = useState({ url: null as string | null, loading: 'Loading image...' });
  const [suvi304, setSuvi304] = useState({ url: null as string | null, loading: 'Loading image...' });
  const [sdoHmiBc1024, setSdoHmiBc1024] = useState({ url: null as string | null, loading: 'Loading image...' });
  const [sdoHmiB1024, setSdoHmiB1024] = useState({ url: null as string | null, loading: 'Loading image...' });
  const [sdoHmiIf1024, setSdoHmiIf1024] = useState({ url: null as string | null, loading: 'Loading image...' });
  const [sdoHmiBc4096, setSdoHmiBc4096] = useState({ url: null as string | null, loading: 'Loading image...' });
  const [sdoHmiB4096, setSdoHmiB4096] = useState({ url: null as string | null, loading: 'Loading image...' });
  const [sdoHmiIf4096, setSdoHmiIf4096] = useState({ url: null as string | null, loading: 'Loading image...' });
  const [suvi195, setSuvi195] = useState({ url: null as string | null, loading: 'Loading image...' });
  const [suviWorkerState, setSuviWorkerState] = useState<SuviWorkerStateResponse | null>(null);
  const [suviWorkerLoading, setSuviWorkerLoading] = useState<string | null>('Loading SUVI timeline...');
  const [suviFrameIndex, setSuviFrameIndex] = useState<number>(0);
  const [suviDifference, setSuviDifference] = useState<boolean>(false);
  const [suviPlaying, setSuviPlaying] = useState<boolean>(false);
  const [suviPlaybackSpeed, setSuviPlaybackSpeed] = useState<PlaybackSpeedOption>(1);
  const [suviFrameWindowHours, setSuviFrameWindowHours] = useState<number>(3);
  const [suviFrameLoading, setSuviFrameLoading] = useState<boolean>(false);
  const suviCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const diffWatermarkRef = useRef<HTMLImageElement | null>(null);
  const [coronagraphState, setCoronagraphState] = useState<CoronagraphStateResponse | null>(null);
  const [coronagraphLoading, setCoronagraphLoading] = useState<string | null>('Loading coronagraph data...');
  const [coronagraphSource, setCoronagraphSource] = useState<CoronagraphSourceKey>('ccor1');
  const [coronagraphIndex, setCoronagraphIndex] = useState<number>(0);
  const [coronagraphDifference, setCoronagraphDifference] = useState<boolean>(true);
  const [coronagraphPlaying, setCoronagraphPlaying] = useState<boolean>(false);
  const [coronagraphPlaybackSpeed, setCoronagraphPlaybackSpeed] = useState<PlaybackSpeedOption>(1);
  const [coronagraphFrameWindowHours, setCoronagraphFrameWindowHours] = useState<number>(3);
  const [coronagraphFrameLoading, setCoronagraphFrameLoading] = useState<boolean>(false);
  const [stereoEarthSeparationDeg, setStereoEarthSeparationDeg] = useState<number | null>(null);
  const coronagraphCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedFrameUrlsRef = useRef<Set<string>>(new Set());
  // Refs so playback interval closures always see the latest loading state
  const suviFrameLoadingRef = useRef<boolean>(false);
  const coronagraphFrameLoadingRef = useRef<boolean>(false);
  const [activeSunImage, setActiveSunImage] = useState<SolarImageryMode>('SUVI_131');

  // Difference-imagery defaults tuned to match provided reference settings.
  // GOES-19 CCOR-1
  const CORONAGRAPH_DIFF_GAIN = 11.5;
  const CORONAGRAPH_DIFF_NOISE_FLOOR = 0;
  const CORONAGRAPH_DIFF_GAMMA = 0.8;
  // SUVI defaults are channel-specific (195 / 304 / 131).
  const SUVI_DIFF_CONFIG_BY_SOURCE: Record<SuviWorkerSourceKey, { gain: number; noiseFloor: number; gamma: number }> = {
    suvi_195_primary:   { gain: 13.0, noiseFloor: 1, gamma: 0.30 },
    suvi_304_secondary: { gain: 9.0,  noiseFloor: 1, gamma: 0.30 },
    suvi_131_secondary: { gain: 15.5, noiseFloor: 7, gamma: 0.90 },
  };

  const colorizeCoronagraphDelta = useCallback((normalized: number): [number, number, number] => {
    const t = Math.min(1, Math.max(0, normalized));
    // Multi-stop heat map: black → navy → cyan → yellow → orange → red → white.
    if (t < 0.16) {
      const k = t / 0.16;
      return [0, Math.round(20 * k), Math.round(90 * k)];
    }
    if (t < 0.36) {
      const k = (t - 0.16) / 0.20;
      return [0, Math.round(20 + 170 * k), Math.round(90 + 140 * k)];
    }
    if (t < 0.58) {
      const k = (t - 0.36) / 0.22;
      return [Math.round(255 * k), Math.round(190 + 65 * k), Math.round(230 - 200 * k)];
    }
    if (t < 0.80) {
      const k = (t - 0.58) / 0.22;
      return [255, Math.round(255 - 120 * k), Math.round(30 - 30 * k)];
    }
    const k = (t - 0.80) / 0.20;
    return [255, Math.round(135 + 120 * k), Math.round(255 * k)];
  }, []);

  useEffect(() => {
    onSuvi195ImageUrlChange?.(suvi195.url);
  }, [onSuvi195ImageUrlChange, suvi195.url]);

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

  const [activeSunspotRegions, setActiveSunspotRegions] = useState<ActiveSunspotRegion[]>([]);
  const [loadingSunspotRegions, setLoadingSunspotRegions] = useState<string | null>('Loading active sunspot regions...');
  const [lastSunspotRegionsUpdate, setLastSunspotRegionsUpdate] = useState<string | null>(null);
  const [sunspotImageryMode, setSunspotImageryMode] = useState<SunspotImageryMode>('colorized');
  const [selectedSunspotRegion, setSelectedSunspotRegion] = useState<ActiveSunspotRegion | null>(null);
  const [noaaOverallFlareProbabilities, setNoaaOverallFlareProbabilities] = useState<{ c: number; m: number; x: number; sourceDate: string | null } | null>(null);
  const [selectedSunspotCloseupUrl, setSelectedSunspotCloseupUrl] = useState<string | null>(null);
  const [isCloseupImageLoading, setIsCloseupImageLoading] = useState(false);
  const [overviewGeometry, setOverviewGeometry] = useState<{ width: number; height: number; cx: number; cy: number; radius: number } | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const closeupImgRef = useRef<HTMLImageElement | null>(null);

  // General state
  const [modalState, setModalState] = useState<{isOpen: boolean; title: string; content: string | React.ReactNode} | null>(null);
  const [currentXraySummary, setCurrentXraySummary] = useState<{ flux: number | null, class: string | null }>({ flux: null, class: null });
  const [currentProtonSummary, setCurrentProtonSummary] = useState<{ flux: number | null, class: string | null }>({ flux: null, class: null });
  const [latestRelevantEvent, setLatestRelevantEvent] = useState<string | null>(null);
  const [lastXrayUpdate, setLastXrayUpdate] = useState<string | null>(null);
  const [lastProtonUpdate, setLastProtonUpdate] = useState<string | null>(null);
  const [lastFlaresUpdate, setLastFlaresUpdate] = useState<string | null>(null);
  const [lastImagesUpdate, setLastImagesUpdate] = useState<string | null>(null);
  const [activitySummary, setActivitySummary] = useState<SolarActivitySummary | null>(null);
  const initialLoadNotifiedRef = useRef(false);
  const forceDirectSdoRef = useRef(false);
  const lastHashRef = useRef<Record<string, string>>({});

  const stampIfChanged = useCallback((key: string, payload: unknown, setter: (value: string) => void) => {
    const hash = stableHash(payload);
    if (lastHashRef.current[key] === hash) return false;
    lastHashRef.current[key] = hash;
    setter(new Date().toLocaleTimeString('en-NZ'));
    if (import.meta.env.DEV) console.info('[data-change]', key, 'changed');
    return true;
  }, []);

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

  const buildSuviFrameCandidateGroups = useCallback((mode: 'SUVI_131' | 'SUVI_195' | 'SUVI_304') => {
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
      // Try ±1 and ±2 minute offsets to catch frames that don't land on exact
      // 4-minute boundaries. Only used during background probing, not as the
      // immediate fallback (which uses exact timestamps only to keep it fast).
      const OFFSETS_MS = [0, 60000, -60000, 120000, -120000];
      const candidates: string[] = [];
      for (const offset of OFFSETS_MS) {
        const s = toToken(startMs + offset);
        const e = toToken(endMs + offset);
        candidates.push(
          `${root}or_suvi-l2-ci${channel}_g19_s${s}_e${e}_v1-0-2.png`,
          `${root}or_suvi-l2-ci${channel}_g18_s${s}_e${e}_v1-0-2.png`,
          `${root}or_suvi-l2-ci${channel}_g19_s${s}_e${e}_v1-0-1.png`,
          `${root}or_suvi-l2-ci${channel}_g18_s${s}_e${e}_v1-0-1.png`,
        );
      }
      return candidates;
    });
  }, []);

  const probeImageUrl = useCallback((url: string, timeoutMs: number = 3000) => (
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

  const buildSuviFallbackUrls = useCallback((mode: 'SUVI_131' | 'SUVI_195' | 'SUVI_304') => {
    const groups = buildSuviFrameCandidateGroups(mode);
    // Use only the first candidate per group (exact timestamp, g19, v1-0-2)
    // as an immediate placeholder. The directory listing will replace this
    // with confirmed URLs once it loads. Keeps initial count at ~90, not 1800.
    return groups.map((group) => group[0]).filter(Boolean);
  }, [buildSuviFrameCandidateGroups]);

  const buildSuviFrameUrls = useCallback(async (mode: 'SUVI_131' | 'SUVI_195' | 'SUVI_304') => {
    const groups = buildSuviFrameCandidateGroups(mode);
    const resolved = await Promise.all(groups.map(async (group) => {
      const attempts = await Promise.all(group.map((url) => probeImageUrl(url)));
      return attempts.find(Boolean) ?? null;
    }));
    return resolved.filter((url): url is string => Boolean(url));
  }, [buildSuviFrameCandidateGroups, probeImageUrl]);

  const fetchSuviAnimationFrames = useCallback(async (mode: 'SUVI_131' | 'SUVI_195' | 'SUVI_304') => {
    const indexUrl = mode === 'SUVI_131' ? SUVI_131_INDEX_URL : mode === 'SUVI_195' ? SUVI_195_INDEX_URL : SUVI_304_INDEX_URL;

    try {
      const controller = new AbortController();
      // Increased from 1800ms — directory listing can be slow on first load
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const response = await fetch(`${indexUrl}?_=${Date.now()}`, { signal: controller.signal });
      window.clearTimeout(timeout);
      if (response.ok) {
        const html = await response.text();
        const parsed = extractSuviFramesFromIndex(html, indexUrl);
        if (parsed.length > 1) return parsed;
      }
    } catch (error) {
      console.warn('SUVI directory listing unavailable, falling back to generated SUVI filenames.', error);
    }

    const generated = await buildSuviFrameUrls(mode);
    if (generated.length > 1) return generated;

    return [];
  }, [buildSuviFrameUrls, extractSuviFramesFromIndex]);

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

    if (mode === 'SUVI_131' || mode === 'SUVI_195' || mode === 'SUVI_304') {
      setViewerMedia({
        type: 'animation',
        urls: buildSuviFallbackUrls(mode),
      });

      const resolved = await fetchSuviAnimationFrames(mode);
      if (resolved.length > 0) {
        setViewerMedia({
          type: 'animation',
          urls: resolved,
        });
      }
      return;
    }

    const quickFallbackUrls = buildSixHourAnimationUrls(sourceUrl, SUVI_FRAME_INTERVAL_MINUTES);
    setViewerMedia({
      type: 'animation',
      urls: quickFallbackUrls,
    });
  }, [buildSixHourAnimationUrls, buildSuviFallbackUrls, fetchSuviAnimationFrames, setViewerMedia, solarAnimationSources]);

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
    'current-status': buildStatTooltip(
      'Current Solar Status',
      'A blended now-cast combining live X-ray class, flare probabilities, and active-region load.',
      'Higher status tiers generally mean a more eruption-prone Sun and greater chance of aurora-relevant CME/solar-wind disturbances in coming days.',
      'This is a context score (not a direct aurora forecast): Earth impact still depends on CME trajectory, speed, and IMF orientation on arrival.'
    ),
    'solar-summary': buildStatTooltip(
      '24-Hour Solar Summary',
      'A compact digest of the strongest X-ray activity, strongest proton conditions, and flare/CME counts from the last day.',
      'Helps quickly gauge whether the Sun has recently been quiet, moderately active, or highly eruptive.',
      'Use with coronagraph and in-situ solar-wind data: strong recent activity can raise risk windows, but timing and geoeffectiveness vary.'
    ),
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
    'coronagraphy': buildStatTooltip(
      'Multi-source Coronagraphy',
      'A 6-hour rolling stack of coronagraph frames from CCOR-1, SOHO LASCO, and STEREO-A COR2.',
      'Lets you inspect CME fronts and compare viewpoints to assess possible Earth-directed structure.',
      'Difference imagery highlights motion, but off-axis viewpoints (especially STEREO when far from Earth longitude) can mislead halo interpretation.'
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
    ),
    'active-sunspots': buildStatTooltip(
      'Active Sunspot Regions',
      'NOAA active region telemetry including location and magnetic complexity indicators.',
      'Complex, large regions increase the chance of major flares and CME launches that can impact auroral conditions.',
      'Processed imagery overlays map heliographic region coordinates onto the visible disk and add labelled close-up tiles.'
    )
  }), []);

  const openModal = useCallback((id: string) => {
    const contentData = tooltipContent[id as keyof typeof tooltipContent];
    if (contentData) {
      let title = '';
      if (id === 'current-status') title = 'About Current Solar Status';
      else if (id === 'solar-summary') title = 'About 24-Hour Solar Summary';
      else if (id === 'xray-flux') title = 'About GOES X-ray Flux';
      else if (id === 'proton-flux') title = 'About GOES Proton Flux (>=10 MeV)';
      else if (id === 'suvi-131') title = 'About SUVI 131Å Imagery';
      else if (id === 'suvi-304') title = 'About SUVI 304Å Imagery';
      else if (id === 'sdo-hmibc-1024') title = 'About SDO HMI Continuum Imagery';
      else if (id === 'sdo-hmiif-1024') title = 'About SDO HMI Intensitygram Imagery';
      else if (id === 'suvi-195') title = 'About SUVI 195Å Imagery';
      else if (id === 'coronagraphy') title = 'About Multi-source Coronagraphy';
      else if (id === 'solar-flares') title = 'About Solar Flares';
      else if (id === 'solar-imagery') title = 'About Solar Imagery Types';
      else if (id === 'active-sunspots') title = 'About Active Sunspot Regions';
      else title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();
      setModalState({ isOpen: true, title: title, content: contentData });
      onModalSlugChange?.(`${id}-tooltip`);
    }
  }, [onModalSlugChange, tooltipContent]);

  const closeModal = useCallback(() => {
    setModalState(null);
    onModalSlugChange?.(null);
  }, [onModalSlugChange]);

  useEffect(() => {
    if (!modalSlug) {
      setModalState(null);
      return;
    }
    const id = modalSlug.endsWith('-tooltip')
      ? modalSlug.slice(0, -'-tooltip'.length)
      : modalSlug;
    const contentData = tooltipContent[id as keyof typeof tooltipContent];
    if (!contentData) return;

    let title = '';
    if (id === 'current-status') title = 'About Current Solar Status';
    else if (id === 'solar-summary') title = 'About 24-Hour Solar Summary';
    else if (id === 'xray-flux') title = 'About GOES X-ray Flux';
    else if (id === 'proton-flux') title = 'About GOES Proton Flux (>=10 MeV)';
    else if (id === 'suvi-131') title = 'About SUVI 131Å Imagery';
    else if (id === 'suvi-304') title = 'About SUVI 304Å Imagery';
    else if (id === 'sdo-hmibc-1024') title = 'About SDO HMI Continuum Imagery';
    else if (id === 'sdo-hmiif-1024') title = 'About SDO HMI Intensitygram Imagery';
    else if (id === 'suvi-195') title = 'About SUVI 195Å Imagery';
    else if (id === 'coronagraphy') title = 'About Multi-source Coronagraphy';
    else if (id === 'solar-flares') title = 'About Solar Flares';
    else if (id === 'solar-imagery') title = 'About Solar Imagery Types';
    else if (id === 'active-sunspots') title = 'About Active Sunspot Regions';
    else title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();

    setModalState({ isOpen: true, title, content: contentData });
  }, [modalSlug, tooltipContent]);

  const fetchImage = useCallback(async (url: string, setState: React.Dispatch<React.SetStateAction<{url: string | null, loading: string | null}>>, isVideo: boolean = false, addCacheBuster: boolean = true, fallbackUrl?: string) => {
    const cacheKey = `${url}::${isVideo ? 'video' : 'image'}`;
    const cached = solarImageCache.get(cacheKey);
    const now = Date.now();

    // Already cached and fresh — update state immediately.
    if (cached && now - cached.fetchedAt < SOLAR_IMAGE_CACHE_TTL_MS) {
      setState({ url: cached.url, loading: null });
      setLastImagesUpdate(new Date(cached.fetchedAt).toLocaleTimeString('en-NZ'));
      return;
    }

    // Mark as loading without wiping url — caller decides what to show while waiting.
    setState(prev => ({ url: prev.url, loading: `Loading ${isVideo ? 'video' : 'image'}...` }));

    const fetchUrl = addCacheBuster ? `${url}?_=${now}` : url;

    if (isVideo) {
      solarImageCache.set(cacheKey, { url, fetchedAt: now });
      setState({ url, loading: null });
      stampIfChanged('solar-image-'+url, { url: fetchUrl }, setLastImagesUpdate);
      return;
    }

    enqueueImageLoad(() => {
      const loadAttempt = async (attempt: number) => {
        try {
          if (isLikelySameOriginOrProxy(fetchUrl)) {
            // Same-origin or explicit proxy URL — fetch as blob to get an objectURL.
            const blob = await fetchWithTimeoutAndRetry(fetchUrl, 'blob') as Blob;
            if (!blob.type.startsWith('image/')) {
              throw new Error(`Expected image blob but got ${blob.type || 'unknown'}`);
            }
            const objectUrl = URL.createObjectURL(blob);
            solarImageCache.set(cacheKey, { url: objectUrl, fetchedAt: Date.now() });
            setState({ url: objectUrl, loading: null });
          } else {
            // Cross-origin image (JSOC, NOAA SUVI, etc.) — set as img src directly.
            solarImageCache.set(cacheKey, { url: fetchUrl, fetchedAt: Date.now() });
            setState({ url: fetchUrl, loading: null });
          }
          stampIfChanged('solar-image-'+url, { url: fetchUrl }, setLastImagesUpdate);
          if (import.meta.env.DEV) console.info('[solar-preload] image loaded', url);
          releaseImageLoadSlot();
        } catch {
          if (attempt < MAX_FETCH_RETRIES) {
            // Keep loading state, retry silently — don't flash an error to the user.
            setState(prev => ({ url: prev.url, loading: 'Retrying…' }));
            window.setTimeout(() => { void loadAttempt(attempt + 1); }, 350 * (attempt + 1));
            return;
          }
          const proxyTarget = extractTargetUrlFromProxy(fetchUrl);
          if (proxyTarget) {
            forceDirectSdoRef.current = true;
            solarImageCache.set(cacheKey, { url: proxyTarget, fetchedAt: Date.now() });
            setState({ url: proxyTarget, loading: null });
            releaseImageLoadSlot();
            return;
          }
          // Try fallback URL if primary failed
          if (fallbackUrl && fallbackUrl !== url) {
            console.info('[solar-image] primary failed, trying fallback:', fallbackUrl);
            const fallbackFetchUrl = addCacheBuster ? `${fallbackUrl}?_=${Date.now()}` : fallbackUrl;
            const fallbackCacheKey = `${fallbackUrl}::image`;
            solarImageCache.set(fallbackCacheKey, { url: fallbackFetchUrl, fetchedAt: Date.now() });
            setState({ url: fallbackFetchUrl, loading: null });
            stampIfChanged('solar-image-'+fallbackUrl, { url: fallbackFetchUrl }, setLastImagesUpdate);
            releaseImageLoadSlot();
            return;
          }
          setState(prev => ({ url: prev.url, loading: 'Failed to load — tap to retry' }));
          releaseImageLoadSlot();
        }
      };
      void loadAttempt(0);
    });
  }, [stampIfChanged, forceDirectSdoRef]);


  const prefetchSolarImage = useCallback((url: string) => {
    const cacheKey = `${url}::image`;
    const now = Date.now();
    const cached = solarImageCache.get(cacheKey);
    if (cached && now - cached.fetchedAt < SOLAR_IMAGE_CACHE_TTL_MS) return;

    const fetchUrl = `${url}?_=${now}`;
    const img = new Image();
    img.onload = () => {
      solarImageCache.set(cacheKey, { url: fetchUrl, fetchedAt: Date.now() });
    };
    img.onerror = () => {
      solarImageCache.set(cacheKey, { url: fetchUrl, fetchedAt: Date.now() });
    };
    img.src = fetchUrl;
  }, []);


  const fetchFirstAvailableJson = useCallback(async (urls: string[]) => {
    let lastError: Error | null = null;
    for (const url of urls) {
      try {
        return await fetchWithTimeoutAndRetry(`${url}?_=${Date.now()}`, 'json');
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown fetch error');
      }
    }
    throw lastError ?? new Error('No data endpoint available');
  }, []);

  const fetchFirstAvailableText = useCallback(async (urls: string[]) => {
    let lastError: Error | null = null;
    for (const url of urls) {
      try {
        return await fetchWithTimeoutAndRetry(`${url}?_=${Date.now()}`, 'text') as string;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error('Unknown fetch error');
      }
    }
    throw lastError ?? new Error('No text endpoint available');
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
          stampIfChanged('solar-xray', processedData, setLastXrayUpdate);
          return;
        }
        setAllXrayData(processedData);
        setLoadingXray(null);
        const latestFluxValue = processedData[processedData.length - 1].short;
        setLatestXrayFlux(latestFluxValue);
        setCurrentXraySummary({ flux: latestFluxValue, class: getXrayClass(latestFluxValue) });
        stampIfChanged('solar-xray', processedData, setLastXrayUpdate);
    } catch (e: any) {
      console.error('Error fetching X-ray flux:', e);
      setLoadingXray(`Error: ${e?.message || 'Unknown error'}`);
      setLatestXrayFlux(null);
      setCurrentXraySummary({ flux: null, class: 'N/A' });
      // keep previous last-changed timestamp on failed fetch
    } finally {
      reportInitialTask('solarXray');
    }
  }, [fetchFirstAvailableJson, reportInitialTask, setLatestXrayFlux, stampIfChanged]);

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
          stampIfChanged('solar-proton', processedData, setLastProtonUpdate);
          return;
        }
        setAllProtonData(processedData);
        setLoadingProton(null);
        const latestFluxValue = processedData[processedData.length - 1].flux;
        setCurrentProtonSummary({ flux: latestFluxValue, class: getProtonClass(latestFluxValue) });
        stampIfChanged('solar-proton', processedData, setLastProtonUpdate);
    } catch (e: any) {
      console.error('Error fetching proton flux:', e);
      setLoadingProton(`Error: ${e?.message || 'Unknown error'}`);
      setCurrentProtonSummary({ flux: null, class: 'N/A' });
      // keep previous last-changed timestamp on failed fetch
    } finally {
      reportInitialTask('solarProton');
    }
  }, [fetchFirstAvailableJson, reportInitialTask, stampIfChanged]);

  const fetchFlares = useCallback(async () => {
    if (isInitialLoad.current) {
        setLoadingFlares('Loading solar flares...');
    }
    try {
      const data = await fetchFlareData();
      if (!data || data.length === 0) {
        setSolarFlares([]);
        setLoadingFlares(null);
        stampIfChanged('solar-flares', [], setLastFlaresUpdate);
        return;
      }
      const processedData = data.map((flare: SolarFlare) => ({
        ...flare,
        // add derived property for convenience
        hasCME: flare.linkedEvents?.some((e: any) => e.activityID.includes('CME')) ?? false,
      })) as (SolarFlare & { hasCME: boolean })[];
      setSolarFlares(processedData);
      setLoadingFlares(null);
      stampIfChanged('solar-flares', processedData, setLastFlaresUpdate);
      const firstStrong = processedData.find(f => f.classType?.startsWith('M') || f.classType?.startsWith('X'));
      if (firstStrong) setLatestRelevantEvent(`${firstStrong.classType} flare at ${formatNZTimestamp(firstStrong.peakTime)}`);
    } catch (error) {
      console.error('Error fetching flares:', error);
      setLoadingFlares(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      stampIfChanged('solar-flares', processedData, setLastFlaresUpdate);
    } finally {
      reportInitialTask('solarFlares');
    }
  }, [reportInitialTask, stampIfChanged]);

  const fetchNoaaSolarProbabilities = useCallback(async () => {
    try {
      const raw = await fetchFirstAvailableJson([NOAA_SOLAR_PROBABILITIES_URL]);
      const rows = Array.isArray(raw) ? raw : [];
      const latest = [...rows].sort((a, b) => {
        const ta = parseNoaaUtcTimestamp(a?.date) ?? 0;
        const tb = parseNoaaUtcTimestamp(b?.date) ?? 0;
        return tb - ta;
      })[0];

      if (!latest) {
        setNoaaOverallFlareProbabilities(null);
        return;
      }

      const c = toNumberOrNull(latest?.c_class_1_day ?? latest?.c_class) ?? 0;
      const m = toNumberOrNull(latest?.m_class_1_day ?? latest?.m_class) ?? 0;
      const x = toNumberOrNull(latest?.x_class_1_day ?? latest?.x_class) ?? 0;

      setNoaaOverallFlareProbabilities({
        c: Math.max(0, Math.min(100, c)),
        m: Math.max(0, Math.min(100, m)),
        x: Math.max(0, Math.min(100, x)),
        sourceDate: latest?.date ? String(latest.date) : null,
      });
    } catch (error) {
      console.error('Error fetching NOAA solar probabilities:', error);
      setNoaaOverallFlareProbabilities(null);
    }
  }, [fetchFirstAvailableJson]);

  const fetchSunspotRegions = useCallback(async () => {
    if (isInitialLoad.current) {
      setLoadingSunspotRegions('Loading active sunspot regions...');
    }

    try {
      // ── Step 1: TXT file is authoritative ──────────────────────────────────
      // solar-regions.txt defines which regions exist and provides:
      // region number, location (lat/lon), area, spot count, magnetic class.
      // Only regions in this file are shown — JSON is supplementary only.
      const rawText = await fetchFirstAvailableText([NOAA_ACTIVE_REGIONS_TEXT_URL]);
      const textRegions = parseNoaaSolarRegionsText(rawText);

      if (textRegions.length === 0) {
        setActiveSunspotRegions([]);
        setLoadingSunspotRegions(null);
        stampIfChanged('solar-regions', [], setLastSunspotRegionsUpdate);
        return;
      }

      // Build a lookup by region number for fast merging
      const txtByRegion = new Map<string, Omit<ActiveSunspotRegion, 'trend'>>();
      textRegions.forEach(r => txtByRegion.set(r.region, r));

      // ── Step 2: JSON for supplementary data — one entry per region ─────────
      // sunspot_report.json: flare probabilities, spot count, magnetic class
      // solar_regions.json:  same, different field names — both tried, latest wins
      const [sunspotReportRaw, solarRegionsRaw] = await Promise.all([
        fetchFirstAvailableJson(['https://services.swpc.noaa.gov/json/sunspot_report.json']).catch(() => null),
        fetchFirstAvailableJson(['https://services.swpc.noaa.gov/json/solar_regions.json']).catch(() => null),
      ]);

      // Extract JSON entries, keyed by region — keep only the LATEST entry per region
      const jsonByRegion = new Map<string, any>();
      const processJsonSource = (raw: any, source: string) => {
        if (!raw) return;
        const entries = extractActiveRegionEntries(raw, source);
        entries.forEach(entry => {
          if (!txtByRegion.has(entry.region)) return; // only augment regions from TXT
          const existing = jsonByRegion.get(entry.region);
          // Keep the latest entry by observedTime
          if (!existing || (entry.observedTime ?? 0) > (existing.observedTime ?? 0)) {
            jsonByRegion.set(entry.region, entry);
          }
        });
      };
      processJsonSource(sunspotReportRaw, 'sunspot_report.json');
      processJsonSource(solarRegionsRaw, 'solar_regions.json');

      // ── Step 3: Merge — TXT is primary, JSON fills in extras ───────────────
      const merged: ActiveSunspotRegion[] = textRegions.map(txt => {
        const json = jsonByRegion.get(txt.region) ?? null;

        // Trend: compare TXT area with JSON area if available
        let trend: ActiveSunspotRegion['trend'] = 'Stable';
        if (txt.area !== null && json?.area !== null && json?.area !== undefined) {
          const delta = (txt.area as number) - (json.area as number);
          if (delta >= 15) trend = 'Growing';
          else if (delta <= -15) trend = 'Shrinking';
        }

        return {
          // TXT fields are authoritative for identity and position
          region: txt.region,
          location: txt.location,
          latitude: txt.latitude,
          longitude: txt.longitude,
          area: txt.area,
          spotCount: txt.spotCount ?? json?.spotCount ?? null,
          magneticClass: txt.magneticClass ?? json?.magneticClass ?? null,
          classification: json?.classification ?? null,
          observedTime: txt.observedTime ?? json?.observedTime ?? Date.now(),
          // JSON supplements probability data
          cFlareProbability: json?.cFlareProbability ?? null,
          mFlareProbability: json?.mFlareProbability ?? null,
          xFlareProbability: json?.xFlareProbability ?? null,
          protonProbability: json?.protonProbability ?? null,
          cFlareEvents24h: json?.cFlareEvents24h ?? null,
          mFlareEvents24h: json?.mFlareEvents24h ?? null,
          xFlareEvents24h: json?.xFlareEvents24h ?? null,
          previousActivity: json?.previousActivity ?? null,
          source: 'solar-regions.txt',
          trend,
        };
      })
      .filter(r => isEarthFacingCoordinate(r.latitude, r.longitude))
      .filter(r => (r.area ?? 0) >= ACTIVE_REGION_MIN_AREA_MSH)
      .sort((a, b) => (b.area ?? -1) - (a.area ?? -1));

      const dedupedLatest = merged;

      setActiveSunspotRegions(dedupedLatest);
      setLoadingSunspotRegions(null);
      stampIfChanged('solar-regions', dedupedLatest, setLastSunspotRegionsUpdate);
    } catch (error) {
      console.error('Error fetching active sunspot regions:', error);
      setActiveSunspotRegions([]);
      setLoadingSunspotRegions(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      reportInitialTask('solarRegions');
    }
  }, [fetchFirstAvailableJson, fetchFirstAvailableText, reportInitialTask, stampIfChanged]);

  const runAllUpdates = useCallback(() => {
    fetchImage(SUVI_131_URL, setSuvi131);
    fetchImage(SUVI_304_URL, setSuvi304);
    fetchImage(resolveSdoImageUrl(SDO_HMI_BC_1024_URL, forceDirectSdoRef.current), setSdoHmiBc1024, false, false, SDO_HMI_BC_1024_FALLBACK);
    fetchImage(resolveSdoImageUrl(SDO_HMI_B_1024_URL, forceDirectSdoRef.current), setSdoHmiB1024, false, false, SDO_HMI_B_1024_FALLBACK);
    fetchImage(resolveSdoImageUrl(SDO_HMI_IF_1024_URL, forceDirectSdoRef.current), setSdoHmiIf1024, false, false, SDO_HMI_IF_1024_FALLBACK);
    fetchImage(SUVI_195_URL, setSuvi195);
    fetchXrayFlux();
    fetchProtonFlux();
    fetchFlares();
    fetchSunspotRegions();
    fetchNoaaSolarProbabilities();
  }, [fetchFlares, fetchImage, fetchNoaaSolarProbabilities, fetchProtonFlux, fetchSunspotRegions, fetchXrayFlux, stampIfChanged]);

  const fetchCoronagraphState = useCallback(async () => {
    try {
      setCoronagraphLoading((prev) => prev ?? 'Refreshing coronagraph data...');
      // Use the preloaded promise if available (started during loading screen) to
      // avoid a cold duplicate fetch. Consume it once, then null it out.
      const preload = workerStatePreload.coronagraph;
      workerStatePreload.coronagraph = null;
      const data = (preload ? await preload : await fetchWithTimeoutAndRetry(`${CORONAGRAPHY_WORKER_BASE}/api/state`, 'json')) as CoronagraphStateResponse;
      if (!data?.ok) throw new Error('Worker state returned not-ok response');
      setCoronagraphState(data);
      setCoronagraphLoading(null);
    } catch (error) {
      console.error('Error fetching coronagraph worker state:', error);
      setCoronagraphLoading(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, []);

  const fetchSuviWorkerState = useCallback(async () => {
    try {
      setSuviWorkerLoading((prev) => prev ?? 'Refreshing SUVI timeline...');
      // Use the preloaded promise if available (started during loading screen).
      const preload = workerStatePreload.suvi;
      workerStatePreload.suvi = null;
      const data = (preload ? await preload : await fetchWithTimeoutAndRetry(
        `${SUVI_DIFF_WORKER_BASE}/api/state`,
        'json',
        { timeoutMs: SUVI_WORKER_FETCH_TIMEOUT_MS, retries: 1, cache: 'no-store' }
      )) as SuviWorkerStateResponse;
      if (!data?.ok) throw new Error('SUVI worker state returned not-ok response');
      setSuviWorkerState(data);
      setSuviWorkerLoading(null);
    } catch (error) {
      console.error('Error fetching SUVI worker state:', error);
      setSuviWorkerLoading(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, []);

  const fetchStereoEarthSeparation = useCallback(async () => {
    try {
      const data = await fetchWithTimeoutAndRetry(`${SOLO_BASE}/solo/position`, 'json') as any;
      const sep = data?.positions?.derived?.stereo_earth_lon_sep_deg;
      setStereoEarthSeparationDeg(Number.isFinite(sep) ? Number(sep) : null);
    } catch {
      setStereoEarthSeparationDeg(null);
    }
  }, []);

  useEffect(() => {
    runAllUpdates();
    fetchCoronagraphState();
    fetchSuviWorkerState();
    fetchStereoEarthSeparation();
    return registerDatasetTicker('solar-activity-data', () => {
      runAllUpdates();
      fetchCoronagraphState();
      fetchSuviWorkerState();
      fetchStereoEarthSeparation();
    }, REFRESH_INTERVAL_MS);
  }, [runAllUpdates, fetchCoronagraphState, fetchSuviWorkerState, fetchStereoEarthSeparation]);


  useEffect(() => {
    const timer = window.setTimeout(() => {
      prefetchSolarImage(resolveSdoImageUrl(SDO_HMI_BC_4096_URL, forceDirectSdoRef.current));
      prefetchSolarImage(resolveSdoImageUrl(SDO_HMI_B_4096_URL, forceDirectSdoRef.current));
      prefetchSolarImage(resolveSdoImageUrl(SDO_HMI_IF_4096_URL, forceDirectSdoRef.current));
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [prefetchSolarImage]);

  useEffect(() => {
    runAllUpdates();
    fetchCoronagraphState();
    fetchSuviWorkerState();
    fetchStereoEarthSeparation();
  }, [refreshSignal, runAllUpdates, fetchCoronagraphState, fetchSuviWorkerState, fetchStereoEarthSeparation]);


  useEffect(() => {
    if (reportedInitialTasks.current.size >= 4) {
      isInitialLoad.current = false;
    }
  }, [lastXrayUpdate, lastProtonUpdate, lastFlaresUpdate, lastSunspotRegionsUpdate]);

  useEffect(() => {
    if (!selectedSunspotRegion) return;
    fetchImage(resolveSdoImageUrl(SDO_HMI_BC_4096_URL, forceDirectSdoRef.current), setSdoHmiBc4096, false, false, SDO_HMI_BC_4096_FALLBACK);
    fetchImage(resolveSdoImageUrl(SDO_HMI_B_4096_URL, forceDirectSdoRef.current), setSdoHmiB4096, false, false, SDO_HMI_B_4096_FALLBACK);
    fetchImage(resolveSdoImageUrl(SDO_HMI_IF_4096_URL, forceDirectSdoRef.current), setSdoHmiIf4096, false, false, SDO_HMI_IF_4096_FALLBACK);
  }, [fetchImage, selectedSunspotRegion]);

  useEffect(() => {
    if (!onInitialLoad || initialLoadNotifiedRef.current) return;

    // Core data is sufficient — imagery is supplementary and can be slow/unavailable
    const hasInitialCoreData = !!lastXrayUpdate && !!lastProtonUpdate && !!lastFlaresUpdate;

    if (hasInitialCoreData) {
      initialLoadNotifiedRef.current = true;
      onInitialLoad();
    }
  }, [
    onInitialLoad,
    lastXrayUpdate,
    lastProtonUpdate,
    lastFlaresUpdate,
  ]);

  const sunspotOverviewImage = sunspotImageryMode === 'intensity'
    ? sdoHmiIf1024
    : sunspotImageryMode === 'magnetogram'
      ? sdoHmiB1024
      : sdoHmiBc1024;

  const sunspotOverviewImage4k = sunspotImageryMode === 'intensity'
    ? sdoHmiIf4096
    : sunspotImageryMode === 'magnetogram'
      ? sdoHmiB4096
      : sdoHmiBc4096;

  const selectedSunspotPreview = useMemo(() => {
    if (!selectedSunspotRegion || selectedSunspotRegion.latitude === null || selectedSunspotRegion.longitude === null) {
      return null;
    }

    const geometry = overviewGeometry ?? { width: HMI_IMAGE_SIZE, height: HMI_IMAGE_SIZE, cx: HMI_IMAGE_SIZE / 2, cy: HMI_IMAGE_SIZE / 2, radius: HMI_IMAGE_SIZE * 0.46 };
    const pos = solarCoordsToPixel(
      selectedSunspotRegion.latitude,
      selectedSunspotRegion.longitude,
      geometry.cx,
      geometry.cy,
      geometry.radius
    );
    const constrained = constrainToSolarDiskBounds(pos.x, pos.y, geometry);

    return {
      xPercent: (constrained.x / geometry.width) * 100,
      yPercent: (constrained.y / geometry.height) * 100,
      xPx: constrained.x,
      yPx: constrained.y,
    };
  }, [selectedSunspotRegion, overviewGeometry]);

  const [closeupLightbox, setCloseupLightbox] = useState(false);

  const openSunspotCloseupInViewer = useCallback(() => {
    setCloseupLightbox(true);
  }, []);

  useEffect(() => {
    if (!sunspotOverviewImage.url) {
      setOverviewGeometry(null);
      return;
    }

    let cancelled = false;
    const source = new Image();

    source.onload = () => {
      if (cancelled) return;

      const width = source.naturalWidth || HMI_IMAGE_SIZE;
      const height = source.naturalHeight || HMI_IMAGE_SIZE;

      // Use known native SDO HMI geometry scaled to actual image size.
      // detectSolarDiskGeometry is unreliable on colorized/magnetogram images
      // (false pixel edges from colour mapping throw off boundary detection).
      // The native constants are stable across all HMI products.
      const scaleX = width / HMI_IMAGE_SIZE;
      const scaleY = height / HMI_IMAGE_SIZE;
      const scale = Math.min(scaleX, scaleY);
      setOverviewGeometry({
        width,
        height,
        cx: SDO_HMI_NATIVE_CX * scaleX,
        cy: SDO_HMI_NATIVE_CY * scaleY,
        radius: SDO_HMI_NATIVE_RADIUS * scale,
      });
    };

    source.onerror = () => {
      if (!cancelled) setOverviewGeometry(null);
    };

    source.src = sunspotOverviewImage.url;

    return () => {
      cancelled = true;
    };
  }, [sunspotOverviewImage.url]);

  const plottedSunspots = useMemo(() => {
    const geometry = overviewGeometry ?? { width: HMI_IMAGE_SIZE, height: HMI_IMAGE_SIZE, cx: HMI_IMAGE_SIZE / 2, cy: HMI_IMAGE_SIZE / 2, radius: HMI_IMAGE_SIZE * 0.46 };

    return activeSunspotRegions
      .filter((region) => region.latitude !== null && region.longitude !== null)
      .map((region) => {
        const pos = solarCoordsToPixel(region.latitude as number, region.longitude as number, geometry.cx, geometry.cy, geometry.radius);
        const scaleX = geometry.width / HMI_IMAGE_SIZE;
        const scaleY = geometry.height / HMI_IMAGE_SIZE;
        const shifted = {
          x: pos.x + DISK_LABEL_OFFSET_X_PX * scaleX,
          y: pos.y + DISK_LABEL_OFFSET_Y_PX * scaleY,
        };
        const constrained = constrainToSolarDiskBounds(shifted.x, shifted.y, geometry);
        return {
          ...region,
          xPercent: (constrained.x / geometry.width) * 100,
          yPercent: (constrained.y / geometry.height) * 100,
          onDisk: pos.onDisk,
          labelStyle: getSunspotLabelStyle(region),
        };
      })
      .filter((region) => region.onDisk && Number.isFinite(region.xPercent) && Number.isFinite(region.yPercent));
  }, [activeSunspotRegions, overviewGeometry]);

  const displayedSunspotRegions = useMemo(() => {
    return activeSunspotRegions
      .filter((region): region is ActiveSunspotRegion => Boolean(region))
      .sort((a, b) => (b?.area ?? -1) - (a?.area ?? -1));
  }, [activeSunspotRegions]);

  // Build a lookup map: last-4-digits of activeRegionNum → flares[]
  // NASA DONKI uses 5-digit cycle numbers (e.g. 14403) while NOAA regions use 4-digit (e.g. 4403).
  // Normalising by taking the last 4 digits aligns both sources.
  const flaresByRegion = useMemo(() => {
    const map = new Map<string, SolarFlare[]>();
    solarFlares.forEach((flare) => {
      if (!flare.activeRegionNum) return;
      const key = String(flare.activeRegionNum).slice(-4);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(flare);
    });
    return map;
  }, [solarFlares]);

  const cycleSunspotImageryMode = useCallback((direction: 1 | -1) => {
    const modes: SunspotImageryMode[] = ['colorized', 'magnetogram', 'intensity'];
    const currentIndex = modes.indexOf(sunspotImageryMode);
    const nextIndex = (currentIndex + direction + modes.length) % modes.length;
    setSunspotImageryMode(modes[nextIndex]);
  }, [sunspotImageryMode]);

  const goToNextSunspot = useCallback(() => {
    if (displayedSunspotRegions.length === 0) return;
    if (!selectedSunspotRegion) {
      setSelectedSunspotRegion(displayedSunspotRegions[0]);
      return;
    }

    const currentIndex = displayedSunspotRegions.findIndex((region) => region.region === selectedSunspotRegion.region);
    const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % displayedSunspotRegions.length : 0;
    setSelectedSunspotRegion(displayedSunspotRegions[nextIndex]);
  }, [displayedSunspotRegions, selectedSunspotRegion]);


  useEffect(() => {
    if (!selectedSunspotRegion) {
      setSelectedSunspotCloseupUrl(null);
      return;
    }

    if (!sunspotOverviewImage4k.url) {
      setSelectedSunspotCloseupUrl(null);
      return;
    }

    setSelectedSunspotCloseupUrl(sunspotOverviewImage4k.url);
  }, [selectedSunspotRegion, sunspotOverviewImage4k.url]);


  useEffect(() => {
    if (selectedSunspotCloseupUrl) {
      setIsCloseupImageLoading(true);
      return;
    }
    setIsCloseupImageLoading(false);
  }, [selectedSunspotCloseupUrl]);

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
      const t = flare.peakTime ?? flare.startTime ?? flare.endTime;
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



  const solarStatus = useMemo(() => {
    const xrayFlux = currentXraySummary.flux ?? 0;
    const xrayScore = xrayFlux >= 1e-4 ? 4 : xrayFlux >= 1e-5 ? 3 : xrayFlux >= 1e-6 ? 2 : xrayFlux >= 1e-7 ? 1 : 0;

    const overallCFlareProbability = noaaOverallFlareProbabilities?.c ?? 0;
    const overallMFlareProbability = noaaOverallFlareProbabilities?.m ?? 0;
    const overallXFlareProbability = noaaOverallFlareProbabilities?.x ?? 0;
    const effectiveFlareProbability = Math.max(overallMFlareProbability, overallXFlareProbability);
    const flareScore = effectiveFlareProbability >= 70 ? 4 : effectiveFlareProbability >= 45 ? 3 : effectiveFlareProbability >= 25 ? 2 : effectiveFlareProbability >= 10 ? 1 : 0;

    const sunspotCount = displayedSunspotRegions.length;
    const sunspotScore = sunspotCount >= 10 ? 4 : sunspotCount >= 7 ? 3 : sunspotCount >= 4 ? 2 : sunspotCount >= 1 ? 1 : 0;

    const combined = xrayScore * 0.45 + flareScore * 0.35 + sunspotScore * 0.2;

    let label: 'Quiet' | 'Moderate' | 'High' | 'Very High' = 'Quiet';
    if (combined >= 3.2) label = 'Very High';
    else if (combined >= 2.3) label = 'High';
    else if (combined >= 1.3) label = 'Moderate';

    return {
      label,
      overallCFlareProbability,
      overallMFlareProbability,
      overallXFlareProbability,
      sunspotCount,
    };
  }, [currentXraySummary.flux, displayedSunspotRegions, noaaOverallFlareProbabilities]);

  const coronagraphSourceState = coronagraphState?.sources?.[coronagraphSource] ?? null;
  const coronagraphFrames = useMemo(() => {
    const all = coronagraphSourceState?.frames ?? [];
    if (coronagraphFrameWindowHours >= 24) return all;
    const cutoff = Date.now() - coronagraphFrameWindowHours * 3600 * 1000;
    return all.filter((f) => f.ts && new Date(f.ts).getTime() >= cutoff);
  }, [coronagraphSourceState?.frames, coronagraphFrameWindowHours]);
  const latestCoronagraphFrame = useMemo(() => {
    if (coronagraphFrames.length === 0) return null;
    return coronagraphFrames.reduce((latest, frame) => {
      const latestTs = latest?.ts ? new Date(latest.ts).getTime() : -Infinity;
      const frameTs = frame?.ts ? new Date(frame.ts).getTime() : -Infinity;
      return frameTs > latestTs ? frame : latest;
    }, coronagraphFrames[0] ?? null);
  }, [coronagraphFrames]);
  const clampedCoronagraphIndex = Math.min(coronagraphIndex, Math.max(0, coronagraphFrames.length - 1));
  const activeCoronagraphFrame = coronagraphFrames[clampedCoronagraphIndex] ?? null;
  const previousCoronagraphFrame = coronagraphFrames[Math.max(0, clampedCoronagraphIndex - 1)] ?? null;

  const resolveCoronagraphUrl = useCallback((url: string | null | undefined): string | null => {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${CORONAGRAPHY_WORKER_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
  }, []);

  const activeCoronagraphUrl = resolveCoronagraphUrl(activeCoronagraphFrame?.url);
  const previousCoronagraphUrl = resolveCoronagraphUrl(previousCoronagraphFrame?.url);

  const suviSourceKeyByMode: Record<'SUVI_131' | 'SUVI_195' | 'SUVI_304', SuviWorkerSourceKey> = {
    SUVI_131: 'suvi_131_secondary',
    SUVI_195: 'suvi_195_primary',
    SUVI_304: 'suvi_304_secondary',
  };
  const activeSuviSourceKey: SuviWorkerSourceKey = activeSunImage === 'SUVI_195'
    ? suviSourceKeyByMode.SUVI_195
    : activeSunImage === 'SUVI_304'
      ? suviSourceKeyByMode.SUVI_304
      : suviSourceKeyByMode.SUVI_131;
  const activeSuviDiffConfig = SUVI_DIFF_CONFIG_BY_SOURCE[activeSuviSourceKey] ?? SUVI_DIFF_CONFIG_BY_SOURCE.suvi_131_secondary;
  const activeSuviSourceState = suviWorkerState?.sources?.[activeSuviSourceKey] ?? null;
  const suviFrames = useMemo(() => {
    const all = activeSuviSourceState?.frames ?? [];
    if (suviFrameWindowHours >= 24) return all;
    const cutoff = Date.now() - suviFrameWindowHours * 3600 * 1000;
    return all.filter((f) => f.ts && new Date(f.ts).getTime() >= cutoff);
  }, [activeSuviSourceState?.frames, suviFrameWindowHours]);
  const clampedSuviFrameIndex = Math.min(suviFrameIndex, Math.max(0, suviFrames.length - 1));
  const activeSuviFrame = suviFrames[clampedSuviFrameIndex] ?? null;
  const previousSuviFrame = suviFrames[Math.max(0, clampedSuviFrameIndex - 1)] ?? null;
  const resolveSuviWorkerUrl = useCallback((url: string | null | undefined): string | null => {
    if (!url) return null;
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${SUVI_DIFF_WORKER_BASE}${url.startsWith('/') ? '' : '/'}${url}`;
  }, []);
  const activeSuviFrameUrl = resolveSuviWorkerUrl(activeSuviFrame?.url);
  const previousSuviFrameUrl = resolveSuviWorkerUrl(previousSuviFrame?.url);
  const latestCoronagraphAgeMs = useMemo(() => {
    if (!latestCoronagraphFrame?.ts) return null;
    const ts = new Date(latestCoronagraphFrame.ts).getTime();
    if (Number.isNaN(ts)) return null;
    return Math.max(0, Date.now() - ts);
  }, [latestCoronagraphFrame?.ts]);
  const coronagraphStalenessNotice = useMemo(() => {
    if (latestCoronagraphAgeMs == null || latestCoronagraphAgeMs < 60 * 60 * 1000) return null;
    const totalMinutes = Math.floor(latestCoronagraphAgeMs / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const ageLabel = hours > 0
      ? `${hours}h${minutes > 0 ? ` ${minutes}m` : ''}`
      : `${minutes}m`;
    return `Latest available frame is ${ageLabel} old. Coronagraph feeds commonly have outages or delays for a few hours, and occasionally up to about a day.`;
  }, [latestCoronagraphAgeMs]);

  const stereoAlignmentLabel = useMemo(() => {
    if (stereoEarthSeparationDeg == null) return 'STEREO-A alignment unknown right now.';
    if (stereoEarthSeparationDeg <= 25) return `STEREO-A is near Earth line (${stereoEarthSeparationDeg.toFixed(1)}°) — halo interpretation is more reliable.`;
    if (stereoEarthSeparationDeg <= 60) return `STEREO-A is moderately off-axis (${stereoEarthSeparationDeg.toFixed(1)}°) — halo shape can be skewed.`;
    return `STEREO-A is strongly off-axis (${stereoEarthSeparationDeg.toFixed(1)}°) — poor for Earth-directed halo signatures.`;
  }, [stereoEarthSeparationDeg]);

  useEffect(() => {
    if (coronagraphFrames.length === 0) {
      setCoronagraphIndex(0);
      setCoronagraphPlaying(false);
      return;
    }
    setCoronagraphIndex(coronagraphFrames.length - 1);
    setCoronagraphPlaying(false);
  }, [coronagraphSource, coronagraphFrames.length]);

  useEffect(() => {
    if (suviFrames.length === 0) {
      setSuviFrameIndex(0);
      setSuviPlaying(false);
      return;
    }
    setSuviFrameIndex(suviFrames.length - 1);
    setSuviPlaying(false);
  }, [activeSuviSourceKey, suviFrames.length]);

  // Reset to latest frame when time window changes
  useEffect(() => {
    setSuviFrameIndex(Math.max(0, suviFrames.length - 1));
    setSuviPlaying(false);
  }, [suviFrameWindowHours, suviFrames.length]);

  useEffect(() => {
    setCoronagraphIndex(Math.max(0, coronagraphFrames.length - 1));
    setCoronagraphPlaying(false);
  }, [coronagraphFrameWindowHours, coronagraphFrames.length]);

  // Keep loading refs in sync so interval closures see current values
  useEffect(() => { suviFrameLoadingRef.current = suviFrameLoading; }, [suviFrameLoading]);
  useEffect(() => { coronagraphFrameLoadingRef.current = coronagraphFrameLoading; }, [coronagraphFrameLoading]);

  useEffect(() => {
    if (!suviPlaying || suviFrames.length < 2) return;
    const frameIntervalMs = Math.max(40, Math.round(200 / suviPlaybackSpeed));
    const timer = window.setInterval(() => {
      // Don't advance until the current frame has finished loading — keeps
      // the scrubber and the displayed frame in sync at all playback speeds.
      if (suviFrameLoadingRef.current) return;
      setSuviFrameIndex((prev) => (prev + 1) % suviFrames.length);
    }, frameIntervalMs);
    return () => window.clearInterval(timer);
  }, [suviPlaying, suviFrames.length, suviPlaybackSpeed]);

  const canStepSuviFrames = suviFrames.length > 1;
  const goToPreviousSuviFrame = useCallback(() => {
    if (!canStepSuviFrames) return;
    setSuviPlaying(false);
    setSuviFrameIndex((prev) => (prev - 1 + suviFrames.length) % suviFrames.length);
  }, [canStepSuviFrames, suviFrames.length]);

  const goToNextSuviFrame = useCallback(() => {
    if (!canStepSuviFrames) return;
    setSuviPlaying(false);
    setSuviFrameIndex((prev) => (prev + 1) % suviFrames.length);
  }, [canStepSuviFrames, suviFrames.length]);

  const downloadSuviFrame = useCallback(() => {
    if (suviDifference && suviCanvasRef.current) {
      const sourceLabel = activeSuviSourceState?.label ?? activeSuviSourceKey;
      const timestampPart = activeSuviFrame?.ts
        ? activeSuviFrame.ts.replace(/[:.]/g, '-')
        : String(Date.now());
      const fileName = `${sourceLabel.replace(/\s+/g, '-').toLowerCase()}-${timestampPart}-diff.png`;
      const link = document.createElement('a');
      link.href = suviCanvasRef.current.toDataURL('image/png');
      link.download = fileName;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    if (!activeSuviFrameUrl) return;
    const sourceLabel = activeSuviSourceState?.label ?? activeSuviSourceKey;
    const timestampPart = activeSuviFrame?.ts
      ? activeSuviFrame.ts.replace(/[:.]/g, '-')
      : String(Date.now());
    const fileName = `${sourceLabel.replace(/\s+/g, '-').toLowerCase()}-${timestampPart}.png`;
    const link = document.createElement('a');
    link.href = activeSuviFrameUrl;
    link.download = fileName;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [activeSuviFrame?.ts, activeSuviFrameUrl, activeSuviSourceKey, activeSuviSourceState?.label, suviDifference]);

  useEffect(() => {
    if (!coronagraphPlaying || coronagraphFrames.length < 2) return;
    const frameIntervalMs = Math.max(40, Math.round(200 / coronagraphPlaybackSpeed));
    const timer = window.setInterval(() => {
      if (coronagraphFrameLoadingRef.current) return;
      setCoronagraphIndex((prev) => (prev + 1) % coronagraphFrames.length);
    }, frameIntervalMs);
    return () => window.clearInterval(timer);
  }, [coronagraphPlaying, coronagraphFrames.length, coronagraphPlaybackSpeed]);

  useEffect(() => {
    if (!activeSuviFrameUrl) {
      setSuviFrameLoading(false);
      return;
    }
    let cancelled = false;
    const urlsToLoad: string[] = [activeSuviFrameUrl];
    if (suviDifference && previousSuviFrameUrl && previousSuviFrameUrl !== activeSuviFrameUrl) {
      urlsToLoad.push(previousSuviFrameUrl);
    }
    const pendingUrls = urlsToLoad.filter((url) => !loadedFrameUrlsRef.current.has(url));
    if (pendingUrls.length === 0) {
      setSuviFrameLoading(false);
      return;
    }
    setSuviFrameLoading(true);

    const loadImage = (src: string) => new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loadedFrameUrlsRef.current.add(src);
        resolve();
      };
      img.onerror = reject;
      img.src = src;
    });

    (async () => {
      try {
        await Promise.all(pendingUrls.map((url) => loadImage(url)));
      } catch {
        // Non-blocking: image element/canvas will still attempt rendering.
      } finally {
        if (!cancelled) setSuviFrameLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeSuviFrameUrl, previousSuviFrameUrl, suviDifference]);

  useEffect(() => {
    if (!activeCoronagraphUrl) {
      setCoronagraphFrameLoading(false);
      return;
    }
    let cancelled = false;
    const urlsToLoad: string[] = [activeCoronagraphUrl];
    if (coronagraphDifference && previousCoronagraphUrl && previousCoronagraphUrl !== activeCoronagraphUrl) {
      urlsToLoad.push(previousCoronagraphUrl);
    }
    const pendingUrls = urlsToLoad.filter((url) => !loadedFrameUrlsRef.current.has(url));
    if (pendingUrls.length === 0) {
      setCoronagraphFrameLoading(false);
      return;
    }
    setCoronagraphFrameLoading(true);

    const loadImage = (src: string) => new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        loadedFrameUrlsRef.current.add(src);
        resolve();
      };
      img.onerror = reject;
      img.src = src;
    });

    (async () => {
      try {
        await Promise.all(pendingUrls.map((url) => loadImage(url)));
      } catch {
        // Non-blocking: image element/canvas will still attempt rendering.
      } finally {
        if (!cancelled) setCoronagraphFrameLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [activeCoronagraphUrl, previousCoronagraphUrl, coronagraphDifference]);

  useEffect(() => {
    if (suviFrames.length === 0) return;
    const controller = new AbortController();

    const loadOne = (url: string) => new Promise<void>((resolve) => {
      if (loadedFrameUrlsRef.current.has(url)) { resolve(); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { loadedFrameUrlsRef.current.add(url); resolve(); };
      img.onerror = () => resolve(); // resilient — skip failures
      img.src = url;
    });

    const preload = async () => {
      const BATCH = 8;
      const urls = suviFrames
        .map((f) => resolveSuviWorkerUrl(f?.url))
        .filter((u): u is string => !!u);
      for (let i = 0; i < urls.length; i += BATCH) {
        if (controller.signal.aborted) return;
        await Promise.all(urls.slice(i, i + BATCH).map(loadOne));
      }
    };

    void preload();
    return () => controller.abort();
  }, [suviFrames, resolveSuviWorkerUrl]);

  useEffect(() => {
    if (coronagraphFrames.length === 0) return;
    const controller = new AbortController();

    const loadOne = (url: string) => new Promise<void>((resolve) => {
      if (loadedFrameUrlsRef.current.has(url)) { resolve(); return; }
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { loadedFrameUrlsRef.current.add(url); resolve(); };
      img.onerror = () => resolve(); // resilient — skip failures
      img.src = url;
    });

    const preload = async () => {
      const BATCH = 8;
      const urls = coronagraphFrames
        .map((f) => resolveCoronagraphUrl(f?.url))
        .filter((u): u is string => !!u);
      for (let i = 0; i < urls.length; i += BATCH) {
        if (controller.signal.aborted) return;
        await Promise.all(urls.slice(i, i + BATCH).map(loadOne));
      }
    };

    void preload();
    return () => controller.abort();
  }, [coronagraphFrames, resolveCoronagraphUrl]);

  const canStepCoronagraphFrames = coronagraphFrames.length > 1;
  const goToPreviousCoronagraphFrame = useCallback(() => {
    if (!canStepCoronagraphFrames) return;
    setCoronagraphPlaying(false);
    setCoronagraphIndex((prev) => (prev - 1 + coronagraphFrames.length) % coronagraphFrames.length);
  }, [canStepCoronagraphFrames, coronagraphFrames.length]);

  const goToNextCoronagraphFrame = useCallback(() => {
    if (!canStepCoronagraphFrames) return;
    setCoronagraphPlaying(false);
    setCoronagraphIndex((prev) => (prev + 1) % coronagraphFrames.length);
  }, [canStepCoronagraphFrames, coronagraphFrames.length]);

  const downloadCoronagraphFrame = useCallback(() => {
    if (coronagraphDifference && coronagraphCanvasRef.current) {
      const sourceLabel = coronagraphSourceState?.label ?? coronagraphSource;
      const timestampPart = activeCoronagraphFrame?.ts
        ? activeCoronagraphFrame.ts.replace(/[:.]/g, '-')
        : String(Date.now());
      const fileName = `${sourceLabel.replace(/\s+/g, '-').toLowerCase()}-${timestampPart}-diff.png`;
      const link = document.createElement('a');
      link.href = coronagraphCanvasRef.current.toDataURL('image/png');
      link.download = fileName;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    if (!activeCoronagraphUrl) return;
    const sourceLabel = coronagraphSourceState?.label ?? coronagraphSource;
    const timestampPart = activeCoronagraphFrame?.ts
      ? activeCoronagraphFrame.ts.replace(/[:.]/g, '-')
      : String(Date.now());
    const fileName = `${sourceLabel.replace(/\s+/g, '-').toLowerCase()}-${timestampPart}.jpg`;
    const link = document.createElement('a');
    link.href = activeCoronagraphUrl;
    link.download = fileName;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [activeCoronagraphFrame?.ts, activeCoronagraphUrl, coronagraphSource, coronagraphSourceState?.label, coronagraphDifference]);

  useEffect(() => {
    const canvas = suviCanvasRef.current;
    if (!canvas || !activeSuviFrameUrl || !previousSuviFrameUrl || activeSuviFrameUrl === previousSuviFrameUrl) return;
    let cancelled = false;

    const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

    (async () => {
      try {
        const getWatermark = () => new Promise<HTMLImageElement>((resolve, reject) => {
          if (diffWatermarkRef.current?.complete) {
            resolve(diffWatermarkRef.current);
            return;
          }
          const img = diffWatermarkRef.current ?? new Image();
          diffWatermarkRef.current = img;
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          if (!img.src) img.src = DIFF_WATERMARK_URL;
        });
        const [prevImg, currImg] = await Promise.all([loadImage(previousSuviFrameUrl), loadImage(activeSuviFrameUrl)]);
        if (cancelled) return;
        const width = Math.min(prevImg.naturalWidth || prevImg.width, currImg.naturalWidth || currImg.width);
        const height = Math.min(prevImg.naturalHeight || prevImg.height, currImg.naturalHeight || currImg.height);
        if (!width || !height) return;

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const tempA = document.createElement('canvas');
        const tempB = document.createElement('canvas');
        tempA.width = tempB.width = width;
        tempA.height = tempB.height = height;
        const aCtx = tempA.getContext('2d', { willReadFrequently: true });
        const bCtx = tempB.getContext('2d', { willReadFrequently: true });
        if (!aCtx || !bCtx) return;
        aCtx.drawImage(prevImg, 0, 0, width, height);
        bCtx.drawImage(currImg, 0, 0, width, height);

        const dataA = aCtx.getImageData(0, 0, width, height);
        const dataB = bCtx.getImageData(0, 0, width, height);
        const out = ctx.createImageData(width, height);
        for (let i = 0; i < dataA.data.length; i += 4) {
          const aGray = (dataA.data[i] + dataA.data[i + 1] + dataA.data[i + 2]) / 3;
          const bGray = (dataB.data[i] + dataB.data[i + 1] + dataB.data[i + 2]) / 3;
          const rawDelta = Math.abs(bGray - aGray);
          const aboveNoise = Math.max(0, rawDelta - activeSuviDiffConfig.noiseFloor);
          const amplified = Math.min(255, aboveNoise * activeSuviDiffConfig.gain);
          const normalized = Math.pow(amplified / 255, activeSuviDiffConfig.gamma);
          const [r, g, b] = colorizeCoronagraphDelta(normalized);
          out.data[i] = r;
          out.data[i + 1] = g;
          out.data[i + 2] = b;
          out.data[i + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);

        const watermark = await getWatermark();
        if (!cancelled && watermark?.naturalWidth && watermark?.naturalHeight) {
          const targetWidth = Math.max(48, Math.round(width * 0.12));
          const ratio = watermark.naturalHeight / watermark.naturalWidth;
          const targetHeight = Math.max(20, Math.round(targetWidth * ratio));
          const pad = Math.max(8, Math.round(width * 0.015));
          const x = width - targetWidth - pad;
          const y = height - targetHeight - pad;
          ctx.save();
          ctx.globalAlpha = 0.88;
          ctx.drawImage(watermark, x, y, targetWidth, targetHeight);
          ctx.restore();
        }
      } catch {
        // Silent fallback: UI remains on raw frame if diff generation fails.
      }
    })();

    return () => { cancelled = true; };
  }, [activeSuviFrameUrl, previousSuviFrameUrl, colorizeCoronagraphDelta, activeSuviDiffConfig]);

  useEffect(() => {
    const canvas = coronagraphCanvasRef.current;
    if (!canvas || !activeCoronagraphUrl || !previousCoronagraphUrl || activeCoronagraphUrl === previousCoronagraphUrl) return;
    let cancelled = false;

    const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

    (async () => {
      try {
        const getWatermark = () => new Promise<HTMLImageElement>((resolve, reject) => {
          if (diffWatermarkRef.current?.complete) {
            resolve(diffWatermarkRef.current);
            return;
          }
          const img = diffWatermarkRef.current ?? new Image();
          diffWatermarkRef.current = img;
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve(img);
          img.onerror = reject;
          if (!img.src) img.src = DIFF_WATERMARK_URL;
        });
        const [prevImg, currImg] = await Promise.all([loadImage(previousCoronagraphUrl), loadImage(activeCoronagraphUrl)]);
        if (cancelled) return;
        const width = Math.min(prevImg.naturalWidth || prevImg.width, currImg.naturalWidth || currImg.width);
        const height = Math.min(prevImg.naturalHeight || prevImg.height, currImg.naturalHeight || currImg.height);
        if (!width || !height) return;

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const tempA = document.createElement('canvas');
        const tempB = document.createElement('canvas');
        tempA.width = tempB.width = width;
        tempA.height = tempB.height = height;
        const aCtx = tempA.getContext('2d', { willReadFrequently: true });
        const bCtx = tempB.getContext('2d', { willReadFrequently: true });
        if (!aCtx || !bCtx) return;
        aCtx.drawImage(prevImg, 0, 0, width, height);
        bCtx.drawImage(currImg, 0, 0, width, height);

        const dataA = aCtx.getImageData(0, 0, width, height);
        const dataB = bCtx.getImageData(0, 0, width, height);
        const out = ctx.createImageData(width, height);
        for (let i = 0; i < dataA.data.length; i += 4) {
          const aGray = (dataA.data[i] + dataA.data[i + 1] + dataA.data[i + 2]) / 3;
          const bGray = (dataB.data[i] + dataB.data[i + 1] + dataB.data[i + 2]) / 3;
          const rawDelta = Math.abs(bGray - aGray);
          const aboveNoise = Math.max(0, rawDelta - CORONAGRAPH_DIFF_NOISE_FLOOR);
          const amplified = Math.min(255, aboveNoise * CORONAGRAPH_DIFF_GAIN);
          const normalized = Math.pow(amplified / 255, CORONAGRAPH_DIFF_GAMMA);
          const [r, g, b] = colorizeCoronagraphDelta(normalized);
          out.data[i] = r;
          out.data[i + 1] = g;
          out.data[i + 2] = b;
          out.data[i + 3] = 255;
        }
        ctx.putImageData(out, 0, 0);

        const watermark = await getWatermark();
        if (!cancelled && watermark?.naturalWidth && watermark?.naturalHeight) {
          const targetWidth = Math.max(48, Math.round(width * 0.12));
          const ratio = watermark.naturalHeight / watermark.naturalWidth;
          const targetHeight = Math.max(20, Math.round(targetWidth * ratio));
          const pad = Math.max(8, Math.round(width * 0.015));
          const x = width - targetWidth - pad;
          const y = height - targetHeight - pad;
          ctx.save();
          ctx.globalAlpha = 0.88;
          ctx.drawImage(watermark, x, y, targetWidth, targetHeight);
          ctx.restore();
        }
      } catch {
        // Silent fallback: UI remains on raw frame if diff generation fails.
      }
    })();

    return () => { cancelled = true; };
  }, [activeCoronagraphUrl, previousCoronagraphUrl, colorizeCoronagraphDelta]);

  // --- RENDER ---
  return (
    <div
      className="w-full h-full bg-neutral-900 text-neutral-300 relative"
      style={{ backgroundImage: `url('/background-solar.jpg')`, backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed' }}
    >
      <div className="absolute inset-0 bg-black/50 z-0"></div>
      <div className="w-full h-full overflow-y-auto p-5 relative z-10 styled-scrollbar">
        <style>{`body { overflow-y: auto !important; } .styled-scrollbar::-webkit-scrollbar { width: 8px; } .styled-scrollbar::-webkit-scrollbar-track { background: #262626; } .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; } @keyframes sunspotPulse { 0%{transform:scale(1);opacity:.95} 100%{transform:scale(2.25);opacity:0} }`}</style>
        <div className="container mx-auto">
          <header className="text-center mb-8">
            <h1 className="text-3xl font-bold text-neutral-100">Solar Activity Dashboard</h1>
          </header>

          <main className="grid grid-cols-12 gap-5">
            <div className="col-span-12 card bg-neutral-950/80 p-4 mb-4 flex flex-col sm:flex-row justify-between items-center text-sm">
              <div className="flex-1 text-center sm:text-left mb-2 sm:mb-0">
                <div className="flex items-center gap-2 justify-center sm:justify-start mb-1">
                  <h3 className="text-neutral-200 font-semibold">
                  Current Status: <span className={`font-bold ${
                    solarStatus.label === 'Quiet' ? 'text-green-400' :
                    solarStatus.label === 'Moderate' ? 'text-yellow-400' :
                    solarStatus.label === 'High' ? 'text-orange-400' : 'text-red-500'
                  }`}>{solarStatus.label}</span>
                  </h3>
                  <button onClick={() => openModal('current-status')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="About current solar status">?</button>
                </div>
                <p>X-ray Flux: <span className="font-mono text-cyan-300">{currentXraySummary.flux !== null ? currentXraySummary.flux.toExponential(2) : 'N/A'}</span> ({currentXraySummary.class || 'N/A'})</p>
                <p>Overall C flare probability: <span className="font-mono text-yellow-300">{solarStatus.overallCFlareProbability.toFixed(0)}%</span> · Overall M flare probability: <span className="font-mono text-orange-300">{solarStatus.overallMFlareProbability.toFixed(0)}%</span> · Overall X flare probability: <span className="font-mono text-red-300">{solarStatus.overallXFlareProbability.toFixed(0)}%</span></p>
                <p>Sunspot regions: <span className="font-mono text-emerald-300">{solarStatus.sunspotCount}</span></p>
              </div>
              <div className="flex-1 text-center sm:text-right">
                <h3 className="text-neutral-200 font-semibold mb-1">Latest Event:</h3>
                <p className="text-orange-300 italic">{latestRelevantEvent || 'No significant events recently.'}</p>
              </div>
            </div>

            <SolarActivitySummaryDisplay summary={activitySummary} onOpenModal={openModal} />

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

            {/* --- SOLAR IMAGERY (Full Width) --- */}
            <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
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
              </div>

              {/* Controls row: time window + mobile diff toggle + source label */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="flex flex-wrap items-center gap-3">
                  <ImageryTimeRangeButtons selected={suviFrameWindowHours} onSelect={setSuviFrameWindowHours} />
                  {/* Slider toggle — hidden on desktop where both panels are always visible */}
                  <label className="lg:hidden flex items-center gap-3 cursor-pointer select-none">
                    <div className="relative">
                      <input type="checkbox" className="sr-only" checked={suviDifference} onChange={(e) => setSuviDifference(e.target.checked)} />
                      <div className={`block w-10 h-6 rounded-full transition-colors ${suviDifference ? 'bg-indigo-600' : 'bg-neutral-600'}`} />
                      <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${suviDifference ? 'translate-x-full' : ''}`} />
                    </div>
                    <span className="text-sm font-medium text-neutral-300">Difference imagery</span>
                  </label>
                </div>
                <span className="text-xs text-neutral-500">{activeSuviSourceState?.label ?? '—'} · {suviFrames.length} frame(s)</span>
              </div>

              {/* Viewer — flex-row on desktop (side by side), stacked on mobile */}
              <div className="flex flex-col lg:flex-row gap-3 flex-grow">
                {/* Raw panel: always visible on desktop; hidden on mobile when diff is active */}
                <div className={`flex-1 flex flex-col min-h-[220px] sm:min-h-[260px] ${suviDifference ? 'hidden lg:flex' : 'flex'}`}>
                  <div className="hidden lg:block text-xs text-center text-neutral-500 mb-1 font-medium tracking-wide uppercase">Raw</div>
                  <div className="flex-1 rounded-lg border border-neutral-800 bg-black overflow-hidden relative">
                    {suviWorkerLoading && !activeSuviFrameUrl && <LoadingSpinner message={suviWorkerLoading} />}
                    {!suviWorkerLoading && !activeSuviFrameUrl && (
                      <div className="w-full h-full flex items-center justify-center text-neutral-400 italic">No SUVI imagery available.</div>
                    )}
                    {activeSuviFrameUrl && (
                      <div className="w-full h-full relative cursor-pointer" onClick={() => setViewerMedia({ url: activeSuviFrameUrl, type: 'image' })}>
                        <img src={activeSuviFrameUrl} alt={`${imageryModeLabels[activeSunImage]} frame`} className="w-full h-full object-contain" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Diff panel: always visible on desktop; shown on mobile only when diff toggle is on */}
                <div className={`flex-1 flex flex-col min-h-[220px] sm:min-h-[260px] ${suviDifference ? 'flex' : 'hidden lg:flex'}`}>
                  <div className="hidden lg:block text-xs text-center text-neutral-500 mb-1 font-medium tracking-wide uppercase">Difference</div>
                  <div className="flex-1 rounded-lg border border-neutral-800 bg-black overflow-hidden relative">
                    {suviWorkerLoading && !activeSuviFrameUrl && <LoadingSpinner message={suviWorkerLoading} />}
                    {!suviWorkerLoading && !activeSuviFrameUrl && (
                      <div className="w-full h-full flex items-center justify-center text-neutral-400 italic">No SUVI imagery available.</div>
                    )}
                    {activeSuviFrameUrl && (
                      <div className="w-full h-full relative cursor-pointer" onClick={() => setViewerMedia({ url: activeSuviFrameUrl, type: 'image' })}>
                        <canvas ref={suviCanvasRef} className="w-full h-full object-contain" />
                        {!previousSuviFrameUrl && (
                          <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-400 bg-black/40">Need at least 2 frames for difference view.</div>
                        )}
                      </div>
                    )}
                    {suviFrameLoading && activeSuviFrameUrl && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-neutral-200 bg-black/45">Loading selected frame…</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Diff legend — always shown on desktop, mobile only when toggle is on */}
              <div className={`mt-2 rounded border border-neutral-700/70 bg-neutral-900/70 px-3 py-2 ${suviDifference ? 'block' : 'hidden lg:block'}`}>
                <div className="text-[11px] text-neutral-300 mb-1">Difference intensity (colour guide)</div>
                <div className="mt-2 h-3 w-full rounded" style={{ background: DIFF_LEGEND_GRADIENT }} />
                <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
                  <span>None / very low</span>
                  <span>Low</span>
                  <span>Moderate</span>
                  <span>High</span>
                  <span>Extreme</span>
                </div>
              </div>

              <div className="mt-3 space-y-2 flex-shrink-0">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={goToPreviousSuviFrame}
                    disabled={!canStepSuviFrames}
                    className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Previous frame"
                  >
                    ◀ Prev
                  </button>
                  <button
                    onClick={() => setSuviPlaying((prev) => !prev)}
                    disabled={!canStepSuviFrames}
                    className="px-3 py-1.5 text-xs rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                    title={suviPlaying ? 'Pause' : 'Play'}
                  >
                    {suviPlaying ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button
                    onClick={goToNextSuviFrame}
                    disabled={!canStepSuviFrames}
                    className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Next frame"
                  >
                    Next ▶
                  </button>
                  <button
                    onClick={downloadSuviFrame}
                    disabled={!activeSuviFrameUrl}
                    className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                    title="Download current frame"
                  >
                    ⬇ Download frame
                  </button>
                  <label className="ml-auto flex items-center gap-2 text-xs text-neutral-300">
                    Speed
                    <select
                      value={suviPlaybackSpeed}
                      onChange={(e) => setSuviPlaybackSpeed(Number(e.target.value) as PlaybackSpeedOption)}
                      className="rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
                      title="Playback speed"
                    >
                      {PLAYBACK_SPEED_OPTIONS.map((speed) => (
                        <option key={`suvi-speed-${speed}`} value={speed}>
                          {speed}x
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, suviFrames.length - 1)}
                  value={clampedSuviFrameIndex}
                  onChange={(e) => {
                    setSuviPlaying(false);
                    setSuviFrameIndex(Number(e.target.value));
                  }}
                  className="w-full accent-sky-500"
                />
                <div className="mt-1 text-xs text-neutral-500 text-right">
                  {activeSuviFrame ? `Frame: ${formatNZTimestamp(activeSuviFrame.ts)} · fetched ${activeSuviFrame.fetched_at ? formatNZTimestamp(activeSuviFrame.fetched_at) : '—'}` : 'No frame selected'}
                </div>
                <div className="text-[11px] text-neutral-500 leading-relaxed">
                  Imagery source: NOAA SWPC SUVI via suvi-difference-imagery.thenamesrock.workers.dev. Difference imagery processing and visualization by TNR Protography.
                </div>
              </div>

              <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastImagesUpdate || 'N/A'}</div>
            </div>

            <div id="active-sunspots-section" className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col min-h-0 lg:min-h-[680px]">
              <div className="flex justify-between items-center gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">Active Sunspot Tracker</h2>
                  <button onClick={() => openModal('active-sunspots')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about active sunspot overlays.">?</button>
                </div>
                <div className="text-[11px] text-neutral-500">NOAA + SDO mapped to visible disk</div>
              </div>

              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <button onClick={() => setSunspotImageryMode('colorized')} className={`px-3 py-1 text-xs rounded transition-colors ${sunspotImageryMode === 'colorized' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>HMI Colorized</button>
                <button onClick={() => setSunspotImageryMode('magnetogram')} className={`px-3 py-1 text-xs rounded transition-colors ${sunspotImageryMode === 'magnetogram' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>HMI Magnetogram</button>
                <button onClick={() => setSunspotImageryMode('intensity')} className={`px-3 py-1 text-xs rounded transition-colors ${sunspotImageryMode === 'intensity' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>HMI Intensity</button>
                <div className="ml-auto text-[11px] text-neutral-500">{displayedSunspotRegions.length} Earth-facing regions</div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 flex-grow">
                <div className="lg:col-span-7 rounded-lg border border-neutral-800 bg-black/80 p-3 min-h-0 flex items-center justify-center">
                  <div
                    className="relative aspect-square w-full max-w-[700px] max-h-[70vh] md:max-h-[680px] mx-auto cursor-zoom-in"
                    title={`${tooltipContent['active-sunspots']} (click for 4K)`}
                    onClick={() => {
                      if (!sunspotOverviewImage.url && !sunspotOverviewImage.loading) {
                        fetchImage(
                          resolveSdoImageUrl(sunspotImageryMode === 'intensity' ? SDO_HMI_IF_1024_URL : sunspotImageryMode === 'magnetogram' ? SDO_HMI_B_1024_URL : SDO_HMI_BC_1024_URL, forceDirectSdoRef.current),
                          sunspotImageryMode === 'intensity' ? setSdoHmiIf1024 : sunspotImageryMode === 'magnetogram' ? setSdoHmiB1024 : setSdoHmiBc1024,
                          false,
                          false,
                        );
                        return;
                      }
                      if (!sunspotOverviewImage4k.url) return;
                      setViewerMedia({
                        url: sunspotOverviewImage4k.url,
                        type: 'image_with_labels',
                        labels: plottedSunspots.map((region) => ({
                          id: region.region,
                          xPercent: region.xPercent,
                          yPercent: region.yPercent,
                          text: `AR ${region.region}`,
                        })),
                      });
                    }}
                  >
                    {sunspotOverviewImage.url && (
                      <img
                        src={sunspotOverviewImage.url}
                        alt="SDO sunspot overview"
                        className="w-full h-full object-contain rounded-lg"
                      />
                    )}
                    {(loadingSunspotRegions || sunspotOverviewImage.loading) && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-black/60">
                        <svg className="animate-spin h-8 w-8 text-neutral-300" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <p className="mt-2 text-sm text-neutral-300 italic">{sunspotOverviewImage.loading || loadingSunspotRegions}</p>
                      </div>
                    )}
                    {(!sunspotOverviewImage.url && !sunspotOverviewImage.loading) && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/60 text-amber-200 text-sm">Failed to load — tap to retry</div>
                    )}

                    {plottedSunspots.map((region) => {
                      const isSelected = selectedSunspotRegion?.region === region.region;
                      const riskBand = getSunspotRiskBand(region);
                      return (
                        <button
                          key={`${region.region}-${region.location}`}
                          onClick={(e) => { e.stopPropagation(); setSelectedSunspotRegion(region); }}
                          className="absolute -translate-x-1/2 -translate-y-1/2 group"
                          style={{ left: `${region.xPercent}%`, top: `${region.yPercent}%` }}
                          title={`AR ${region.region} · ${region.magneticClass || 'Unknown'} · ${region.location}`}
                        >
                          <span
                            className="relative z-10 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap bg-black/80 opacity-90 group-hover:opacity-100 transition-opacity"
                            style={{
                              color: riskBand.color,
                              border: `1px solid ${riskBand.color}40`,
                              boxShadow: isSelected ? `0 0 8px ${riskBand.color}60` : 'none',
                            }}
                          >
                            AR {region.region}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="lg:col-span-5 rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 flex flex-col min-h-0 lg:min-h-[480px]">
                  {selectedSunspotRegion ? (
                    <>
                      <div className="flex items-start justify-between mb-3 gap-2">
                        <div>
                          <div className="text-lg text-amber-300 font-bold">AR {selectedSunspotRegion.region}</div>
                          <div className="text-xs text-neutral-400">{selectedSunspotRegion.location || 'Unknown location'}</div>
                        </div>
                        <button className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setSelectedSunspotRegion(null)}>Back to all sunspots</button>
                      </div>

                      <div className="flex gap-2 mb-3">
                        <button className="text-xs px-2 py-1 rounded bg-sky-700 hover:bg-sky-600" onClick={goToNextSunspot}>Next sunspot</button>
                        <span className="text-[11px] text-neutral-400 self-center">Swipe close-up to switch imagery</span>
                      </div>

                      {closeupLightbox && selectedSunspotCloseupUrl && selectedSunspotPreview && (
                        <div
                          className="fixed inset-0 z-[3000] bg-black/95 flex items-center justify-center cursor-zoom-out"
                          onClick={() => setCloseupLightbox(false)}
                        >
                          <div className="relative w-[90vw] h-[90vw] max-w-[90vh] max-h-[90vh] overflow-hidden rounded-lg">
                            {(() => {
                              const offsetXPercent = (CLOSEUP_OFFSET_X_PX / HMI_IMAGE_SIZE) * 100;
                              const offsetYPercent = (CLOSEUP_OFFSET_Y_PX / HMI_IMAGE_SIZE) * 100;
                              const adjustedX = Math.max(0, Math.min(100, selectedSunspotPreview.xPercent + offsetXPercent));
                              const adjustedY = Math.max(0, Math.min(100, selectedSunspotPreview.yPercent + offsetYPercent));
                              return (
                                <img
                                  src={selectedSunspotCloseupUrl}
                                  alt={`AR ${selectedSunspotRegion?.region} fullscreen closeup`}
                                  className="absolute"
                                  style={{
                                    width: '420%',
                                    height: '420%',
                                    left: `${50 - adjustedX * 4.2}%`,
                                    top: `${50 - adjustedY * 4.2}%`,
                                    objectFit: 'contain',
                                    maxWidth: 'none',
                                  }}
                                />
                              );
                            })()}
                          </div>
                          <div className="absolute top-4 right-4 text-white/60 text-sm">Click anywhere to close</div>
                          <div className="absolute bottom-4 text-white/60 text-sm">AR {selectedSunspotRegion?.region} · {selectedSunspotRegion?.location}</div>
                        </div>
                      )}

                      <div
                        className="rounded-md border border-neutral-800 bg-black/70 aspect-square w-full max-w-[320px] lg:max-w-none mx-auto overflow-hidden mb-3 cursor-zoom-in"
                        onClick={openSunspotCloseupInViewer}
                        onTouchStart={(event) => {
                          touchStartXRef.current = event.touches[0]?.clientX ?? null;
                        }}
                        onTouchEnd={(event) => {
                          const startX = touchStartXRef.current;
                          const endX = event.changedTouches[0]?.clientX ?? null;
                          touchStartXRef.current = null;
                          if (startX === null || endX === null) return;
                          const delta = endX - startX;
                          if (Math.abs(delta) < 40) return;
                          cycleSunspotImageryMode(delta < 0 ? 1 : -1);
                        }}
                      >
                        {selectedSunspotCloseupUrl && selectedSunspotPreview ? (
                          <div className="relative w-full h-full overflow-hidden bg-black">
                            {(() => {
                              const offsetXPercent = (CLOSEUP_OFFSET_X_PX / HMI_IMAGE_SIZE) * 100;
                              const offsetYPercent = (CLOSEUP_OFFSET_Y_PX / HMI_IMAGE_SIZE) * 100;
                              const adjustedX = Math.max(0, Math.min(100, selectedSunspotPreview.xPercent + offsetXPercent));
                              const adjustedY = Math.max(0, Math.min(100, selectedSunspotPreview.yPercent + offsetYPercent));
                              return (
                                <img
                                  ref={closeupImgRef}
                                  src={selectedSunspotCloseupUrl}
                                  alt={`AR ${selectedSunspotRegion.region} closeup`}
                                  className="absolute"
                                  onLoad={() => setIsCloseupImageLoading(false)}
                                  onError={() => setIsCloseupImageLoading(false)}
                                  style={{
                                    width: '420%',
                                    height: '420%',
                                    left: `${50 - adjustedX * 4.2}%`,
                                    top: `${50 - adjustedY * 4.2}%`,
                                    objectFit: 'contain',
                                    maxWidth: 'none',
                                  }}
                                />
                              );
                            })()}
                            {isCloseupImageLoading && (
                              <div className="absolute inset-0 flex items-center justify-center bg-black/45">
                                <LoadingSpinner message="Loading close-up image..." />
                              </div>
                            )}
                          </div>
                        ) : sunspotOverviewImage4k.loading || !sunspotOverviewImage4k.url ? (
                          <div className="w-full h-full flex items-center justify-center">
                            <LoadingSpinner message="Loading close-up image..." />
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-neutral-500">Close-up unavailable</div>
                        )}
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-neutral-500">Magnetic Class</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.magneticClass || '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Area</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.area ? `${selectedSunspotRegion.area} MSH` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Spot Count</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.spotCount ?? '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Trend</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.trend}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">M-flare probability</span><span className="text-orange-300 font-semibold">{selectedSunspotRegion.mFlareProbability != null ? `${selectedSunspotRegion.mFlareProbability}%` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">X-flare probability</span><span className="text-red-300 font-semibold">{selectedSunspotRegion.xFlareProbability != null ? `${selectedSunspotRegion.xFlareProbability}%` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Proton probability</span><span className="text-fuchsia-300 font-semibold">{selectedSunspotRegion.protonProbability != null ? `${selectedSunspotRegion.protonProbability}%` : '—'}</span></div>
                        {(() => {
                          const regionKey = String(selectedSunspotRegion.region).slice(-4);
                          const matched = flaresByRegion.get(regionKey) ?? [];
                          const mCount = matched.filter(f => f.classType?.toUpperCase().startsWith('M')).length;
                          const xCount = matched.filter(f => f.classType?.toUpperCase().startsWith('X')).length;
                          return (
                            <div className="flex justify-between">
                              <span className="text-neutral-500">7-day flare events</span>
                              <span className="text-neutral-100 font-semibold">
                                M <span className={mCount > 0 ? 'text-orange-300' : ''}>{mCount > 0 ? mCount : '—'}</span>
                                {' · '}
                                X <span className={xCount > 0 ? 'text-red-300' : ''}>{xCount > 0 ? xCount : '—'}</span>
                              </span>
                            </div>
                          );
                        })()}
                        <div className="flex justify-between gap-3"><span className="text-neutral-500">Previous activity</span><span className="text-neutral-100 font-semibold text-right max-w-[65%]">{selectedSunspotRegion.previousActivity || '—'}</span></div>
                      </div>

                      {/* ── Flares from NASA DONKI matched to this region ── */}
                      {(() => {
                        const regionKey = String(selectedSunspotRegion.region).slice(-4);
                        const matched = flaresByRegion.get(regionKey) ?? [];
                        return (
                          <div className="mt-3">
                            <div className="text-[11px] uppercase tracking-widest text-neutral-500 mb-1.5">
                              Flares from this region
                              <span className="ml-2 text-neutral-400 normal-case tracking-normal">
                                ({matched.length} in last 7 days)
                              </span>
                            </div>
                            {matched.length === 0 ? (
                              <div className="text-xs text-neutral-600 italic">No flares recorded for AR {selectedSunspotRegion.region} in the last 7 days.</div>
                            ) : (
                              <div className="space-y-1 max-h-[160px] overflow-y-auto styled-scrollbar pr-1">
                                {matched.map((flare, i) => {
                                  const colors = getColorForFlareClass(flare.classType);
                                  const peakDate = flare.peakTime ? new Date(flare.peakTime) : null;
                                  const peakStr = peakDate
                                    ? `${peakDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${peakDate.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })} UTC`
                                    : '—';
                                  return (
                                    <div
                                      key={flare.flrID ?? i}
                                      className="flex items-center justify-between rounded px-2 py-1 bg-neutral-900/60 border border-neutral-800"
                                    >
                                      <div className="flex items-center gap-2">
                                        <span
                                          className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${colors.text}`}
                                          style={{ backgroundColor: colors.background }}
                                        >
                                          {flare.classType}
                                        </span>
                                        {(flare as any).hasCME && (
                                          <span className="text-[10px] text-sky-400 border border-sky-700 rounded px-1">CME</span>
                                        )}
                                      </div>
                                      <span className="text-[11px] text-neutral-400">{peakStr}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <div className="flex-1 overflow-y-auto styled-scrollbar pr-1">
                      <div className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-2">Active Regions</div>
                      {displayedSunspotRegions.map((region) => {
                        const riskBand = getSunspotRiskBand(region);
                        return (
                          <button
                            key={`list-${region.region}-${region.location}`}
                            className="w-full text-left rounded-md border border-neutral-800 bg-neutral-950/70 p-2.5 mb-2 hover:bg-neutral-800/90 transition-colors"
                            onClick={() => setSelectedSunspotRegion(region)}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-neutral-100">AR {region.region}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded border" style={{ color: riskBand.color, borderColor: `${riskBand.color}80`, backgroundColor: `${riskBand.color}20` }}>{riskBand.label}</span>
                            </div>
                            <div className="text-[11px] text-neutral-400 mt-1">{region.location || 'Unknown'} · {region.magneticClass || 'Unclassified'}</div>
                          </button>
                        );
                      })}
                      {!loadingSunspotRegions && displayedSunspotRegions.length === 0 && (
                        <div className="text-xs text-neutral-500 text-center py-8">No Earth-facing regions available right now.</div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="text-right text-xs text-neutral-500 mt-2">Last updated: {lastSunspotRegionsUpdate || 'N/A'}</div>
            </div>

            {/* IPS section removed entirely */}


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

            <div className="col-span-12 card bg-neutral-950/80 p-4 min-h-[620px] flex flex-col">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold text-white">Coronagraphy — Multi Source</h2>
                  <button onClick={() => openModal('coronagraphy')} className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700" title="Information about Coronagraphy.">?</button>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {CORONAGRAPH_SOURCES.map((src) => (
                    <button
                      key={src.key}
                      onClick={() => setCoronagraphSource(src.key)}
                      className={`px-3 py-1 text-xs rounded transition-colors ${coronagraphSource === src.key ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}
                    >
                      {src.label}
                    </button>
                  ))}
                </div>
              </div>

              {coronagraphSource === 'stereo_cor2' && (
                <div className="mb-3 px-3 py-2 rounded border border-violet-700/40 bg-violet-900/20 text-xs text-violet-200">
                  {stereoAlignmentLabel}
                </div>
              )}

              {/* Controls row: time window + mobile diff toggle + source label */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className="flex flex-wrap items-center gap-3">
                  <ImageryTimeRangeButtons selected={coronagraphFrameWindowHours} onSelect={setCoronagraphFrameWindowHours} />
                  <label className="lg:hidden flex items-center gap-3 cursor-pointer select-none">
                    <div className="relative">
                      <input type="checkbox" className="sr-only" checked={coronagraphDifference} onChange={(e) => setCoronagraphDifference(e.target.checked)} />
                      <div className={`block w-10 h-6 rounded-full transition-colors ${coronagraphDifference ? 'bg-indigo-600' : 'bg-neutral-600'}`} />
                      <div className={`dot absolute left-1 top-1 bg-white w-4 h-4 rounded-full transition-transform ${coronagraphDifference ? 'translate-x-full' : ''}`} />
                    </div>
                    <span className="text-sm font-medium text-neutral-300">Difference imagery</span>
                  </label>
                </div>
                <span className="text-xs text-neutral-500">{coronagraphSourceState?.label ?? '—'} · {coronagraphFrames.length} frame(s)</span>
              </div>
              {coronagraphStalenessNotice && (
                <div className="mb-2 px-3 py-2 rounded border border-amber-700/50 bg-amber-900/20 text-xs text-amber-200">
                  {coronagraphStalenessNotice}
                </div>
              )}

              <div className="flex flex-col lg:flex-row gap-3 flex-grow">
                {/* Raw panel */}
                <div className={`flex-1 flex flex-col min-h-[220px] sm:min-h-[260px] ${coronagraphDifference ? 'hidden lg:flex' : 'flex'}`}>
                  <div className="hidden lg:block text-xs text-center text-neutral-500 mb-1 font-medium tracking-wide uppercase">Raw</div>
                  <div className="flex-1 rounded-lg border border-neutral-800 bg-black overflow-hidden relative">
                    {coronagraphLoading && !activeCoronagraphUrl && <LoadingSpinner message={coronagraphLoading} />}
                    {!coronagraphLoading && !activeCoronagraphUrl && (
                      <div className="w-full h-full flex items-center justify-center text-neutral-400 italic">No coronagraph imagery available.</div>
                    )}
                    {activeCoronagraphUrl && (
                      <div className="w-full h-full relative cursor-pointer" onClick={() => setViewerMedia({ url: activeCoronagraphUrl, type: 'image' })}>
                        <img src={activeCoronagraphUrl} alt="Coronagraph frame" className="w-full h-full object-contain" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Diff panel */}
                <div className={`flex-1 flex flex-col min-h-[220px] sm:min-h-[260px] ${coronagraphDifference ? 'flex' : 'hidden lg:flex'}`}>
                  <div className="hidden lg:block text-xs text-center text-neutral-500 mb-1 font-medium tracking-wide uppercase">Difference</div>
                  <div className="flex-1 rounded-lg border border-neutral-800 bg-black overflow-hidden relative">
                    {coronagraphLoading && !activeCoronagraphUrl && <LoadingSpinner message={coronagraphLoading} />}
                    {!coronagraphLoading && !activeCoronagraphUrl && (
                      <div className="w-full h-full flex items-center justify-center text-neutral-400 italic">No coronagraph imagery available.</div>
                    )}
                    {activeCoronagraphUrl && (
                      <div className="w-full h-full relative cursor-pointer" onClick={() => setViewerMedia({ url: activeCoronagraphUrl, type: 'image' })}>
                        <canvas ref={coronagraphCanvasRef} className="w-full h-full object-contain" />
                        {!previousCoronagraphUrl && (
                          <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-400 bg-black/40">Need at least 2 frames for difference view.</div>
                        )}
                      </div>
                    )}
                    {coronagraphFrameLoading && activeCoronagraphUrl && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center text-xs text-neutral-200 bg-black/45">Loading selected frame…</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Diff legend */}
              <div className={`mt-2 rounded border border-neutral-700/70 bg-neutral-900/70 px-3 py-2 ${coronagraphDifference ? 'block' : 'hidden lg:block'}`}>
                <div className="text-[11px] text-neutral-300 mb-1">Difference intensity (colour guide)</div>
                <div className="mt-2 h-3 w-full rounded" style={{ background: DIFF_LEGEND_GRADIENT }} />
                <div className="mt-1 flex justify-between text-[10px] text-neutral-400">
                  <span>None / very low</span>
                  <span>Low</span>
                  <span>Moderate</span>
                  <span>High</span>
                  <span>Extreme</span>
                </div>
              </div>

              <div className="mt-3 space-y-2 flex-shrink-0">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={goToPreviousCoronagraphFrame}
                    disabled={!canStepCoronagraphFrames}
                    className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Previous frame"
                  >
                    ◀ Prev
                  </button>
                  <button
                    onClick={() => setCoronagraphPlaying((prev) => !prev)}
                    disabled={!canStepCoronagraphFrames}
                    className="px-3 py-1.5 text-xs rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                    title={coronagraphPlaying ? 'Pause' : 'Play'}
                  >
                    {coronagraphPlaying ? '⏸ Pause' : '▶ Play'}
                  </button>
                  <button
                    onClick={goToNextCoronagraphFrame}
                    disabled={!canStepCoronagraphFrames}
                    className="px-3 py-1.5 text-xs rounded bg-neutral-700 hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="Next frame"
                  >
                    Next ▶
                  </button>
                  <button
                    onClick={downloadCoronagraphFrame}
                    disabled={!activeCoronagraphUrl}
                    className="px-3 py-1.5 text-xs rounded bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors"
                    title="Download current frame"
                  >
                    ⬇ Download frame
                  </button>
                  <label className="ml-auto flex items-center gap-2 text-xs text-neutral-300">
                    Speed
                    <select
                      value={coronagraphPlaybackSpeed}
                      onChange={(e) => setCoronagraphPlaybackSpeed(Number(e.target.value) as PlaybackSpeedOption)}
                      className="rounded bg-neutral-800 border border-neutral-700 px-2 py-1 text-xs text-neutral-200"
                      title="Playback speed"
                    >
                      {PLAYBACK_SPEED_OPTIONS.map((speed) => (
                        <option key={`coronagraph-speed-${speed}`} value={speed}>
                          {speed}x
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, coronagraphFrames.length - 1)}
                  value={clampedCoronagraphIndex}
                  onChange={(e) => {
                    setCoronagraphPlaying(false);
                    setCoronagraphIndex(Number(e.target.value));
                  }}
                  className="w-full accent-sky-500"
                />
                <div className="mt-1 text-xs text-neutral-500 text-right">
                  {activeCoronagraphFrame ? `Frame: ${formatNZTimestamp(activeCoronagraphFrame.ts)} · fetched ${activeCoronagraphFrame.fetched_at ? formatNZTimestamp(activeCoronagraphFrame.fetched_at) : '—'}` : 'No frame selected'}
                </div>
                <div className="text-[11px] text-neutral-500 leading-relaxed">
                  Imagery credits: NOAA SWPC (GOES-19 CCOR-1), NASA/ESA SOHO LASCO (C2/C3), and NASA STEREO-A SECCHI (COR2). Difference imagery processing and visualization by TNR Protography.
                </div>
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
              <p className="mt-2">Visualization and Development by <a href="https://www.tnrprotography.co.nz" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">TNR Protography</a></p>
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
              <p><strong>Begin Time (NZT):</strong> {formatNZTimestamp(selectedFlare.startTime)}</p>
              <p><strong>Peak Time (NZT):</strong> {formatNZTimestamp(selectedFlare.peakTime)}</p>
              <p><strong>End Time (NZT):</strong> {formatNZTimestamp(selectedFlare.endTime)}</p>
              <p><strong>Source Location:</strong> {selectedFlare.sourceLocation}</p>
              <p><strong>Active Region:</strong> {(() => {
                if (!selectedFlare.activeRegionNum) return 'N/A';
                const displayNum = String(selectedFlare.activeRegionNum).slice(-4);
                const matchedRegion = activeSunspotRegions.find(
                  r => String(r.region).slice(-4) === displayNum
                );
                if (!matchedRegion) return `AR ${displayNum}`;
                return (
                  <button
                    className="text-amber-300 hover:text-amber-200 underline underline-offset-2 font-semibold transition-colors"
                    title={`Jump to AR ${displayNum} in Active Sunspot Tracker`}
                    onClick={() => {
                      setSelectedFlare(null);
                      setSelectedSunspotRegion(matchedRegion);
                      setTimeout(() => {
                        document.getElementById('active-sunspots-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 50);
                    }}
                  >
                    AR {displayNum} ↑
                  </button>
                );
              })()}</p>
              <p><strong>CME Associated:</strong> {(selectedFlare as any).hasCME ? 'Yes' : 'No'}</p>
              <p><a href={selectedFlare.link} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">View on NASA DONKI</a></p>
              {(selectedFlare as any).hasCME && selectedFlare.linkedEvents?.find((e: any) => e.activityID.includes('CME')) && (() => {
                const linkedCME = selectedFlare.linkedEvents!.find((e: any) => e.activityID.includes('CME'))!;
                const cmeId = linkedCME.activityID;
                return (
                  <button
                    onClick={() => {
                      onViewCMEInVisualization(cmeId);
                      setSelectedFlare(null);
                    }}
                    className="mt-4 w-full px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-semibold hover:bg-indigo-500 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></svg>
                    View CME in Visualization
                    <span className="text-indigo-300 text-xs font-normal opacity-80 truncate max-w-[160px]">{cmeId.replace(/^.*?(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-CME-\d+)$/, '$1')}</span>
                  </button>
                );
              })()}
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
