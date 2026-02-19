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
  setViewerMedia: (media: { url: string, type: 'image' | 'video' | 'animation' } | { type: 'image_with_labels'; url: string; labels: { id: string; xPercent: number; yPercent: number; text: string }[] } | null) => void;
  setLatestXrayFlux: (flux: number | null) => void;
  onViewCMEInVisualization: (cmeId: string) => void;
  navigationTarget: { page: string; elementId: string; expandId?: string; } | null;
  refreshSignal: number;
  onInitialLoad?: () => void;
  onInitialLoadProgress?: (task: 'solarXray' | 'solarProton' | 'solarFlares' | 'solarRegions') => void;
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
const CCOR1_VIDEO_URL = 'https://services.swpc.noaa.gov/products/ccor1/mp4s/ccor1_last_24hrs.mp4';
const SDO_HMI_BC_1024_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIBC.jpg';
const SDO_HMI_B_1024_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIB.jpg';
const SDO_HMI_IF_1024_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMII.jpg';
const SDO_HMI_BC_4096_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_4096_HMIBC.jpg';
const SDO_HMI_B_4096_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_4096_HMIB.jpg';
const SDO_HMI_IF_4096_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_4096_HMII.jpg';
const REFRESH_INTERVAL_MS = 30 * 1000; // Refresh every 30 seconds
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
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

      return {
        region,
        location: location || 'N/A',
        area: toNumberOrNull(item?.area ?? item?.spot_area ?? item?.spotArea ?? item?.area_millionths),
        spotCount: toNumberOrNull(item?.spot_count ?? item?.spotCount ?? item?.number_spots),
        magneticClass: normalizeMagneticClass(item?.magnetic_classification ?? item?.mag_class ?? item?.magneticClass ?? item?.zurich_classification),
        classification: (item?.classification ?? item?.region_classification ?? item?.zurich_classification ?? '').toString().trim() || null,
        latitude: coords.latitude ?? lat,
        longitude: normalizeSolarLongitude(coords.longitude ?? lon),
        observedTime,
        cFlareProbability: toNumberOrNull(item?.c_flare_probability ?? item?.cFlareProbability ?? item?.cflare_probability ?? item?.flare_probability_c),
        mFlareProbability: toNumberOrNull(item?.m_flare_probability ?? item?.mFlareProbability ?? item?.mflare_probability ?? item?.flare_probability_m),
        xFlareProbability: toNumberOrNull(item?.x_flare_probability ?? item?.xFlareProbability ?? item?.xflare_probability ?? item?.flare_probability_x),
        protonProbability: toNumberOrNull(item?.proton_probability ?? item?.protonProbability ?? item?.s1_probability ?? item?.sep_probability),
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
        observedTime: Date.now(),
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
const SolarActivityDashboard: React.FC<SolarActivityDashboardProps> = ({ setViewerMedia, setLatestXrayFlux, onViewCMEInVisualization, refreshSignal, onInitialLoad, onInitialLoadProgress }) => {
  const isInitialLoad = useRef(true);
  const reportedInitialTasks = useRef<Set<'solarXray' | 'solarProton' | 'solarFlares' | 'solarRegions'>>(new Set());

  const reportInitialTask = useCallback((task: 'solarXray' | 'solarProton' | 'solarFlares' | 'solarRegions') => {
    if (!isInitialLoad.current || reportedInitialTasks.current.has(task)) return;
    reportedInitialTasks.current.add(task);
    onInitialLoadProgress?.(task);
  }, [onInitialLoadProgress]);
  // Imagery state
  const [suvi131, setSuvi131] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [suvi304, setSuvi304] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [sdoHmiBc1024, setSdoHmiBc1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [sdoHmiB1024, setSdoHmiB1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [sdoHmiIf1024, setSdoHmiIf1024] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [sdoHmiBc4096, setSdoHmiBc4096] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [sdoHmiB4096, setSdoHmiB4096] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
  const [sdoHmiIf4096, setSdoHmiIf4096] = useState({ url: '/placeholder.png', loading: 'Loading image...' });
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

  const [activeSunspotRegions, setActiveSunspotRegions] = useState<ActiveSunspotRegion[]>([]);
  const [loadingSunspotRegions, setLoadingSunspotRegions] = useState<string | null>('Loading active sunspot regions...');
  const [lastSunspotRegionsUpdate, setLastSunspotRegionsUpdate] = useState<string | null>(null);
  const [sunspotImageryMode, setSunspotImageryMode] = useState<SunspotImageryMode>('colorized');
  const [selectedSunspotRegion, setSelectedSunspotRegion] = useState<ActiveSunspotRegion | null>(null);
  const [selectedSunspotCloseupUrl, setSelectedSunspotCloseupUrl] = useState<string | null>(null);
  const [overviewGeometry, setOverviewGeometry] = useState<{ width: number; height: number; cx: number; cy: number; radius: number } | null>(null);
  const touchStartXRef = useRef<number | null>(null);

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

  const probeImageUrl = useCallback((url: string, timeoutMs: number = 1400) => (
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
    return groups.flatMap((group) => group);
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
      const timeout = window.setTimeout(() => controller.abort(), 1800);
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
      else if (id === 'active-sunspots') title = 'About Active Sunspot Regions';
      else title = (id.charAt(0).toUpperCase() + id.slice(1)).replace(/([A-Z])/g, ' $1').trim();
      setModalState({ isOpen: true, title: title, content: contentData });
    }
  }, [tooltipContent]);

  const closeModal = useCallback(() => setModalState(null), []);

  const fetchImage = useCallback(async (url: string, setState: React.Dispatch<React.SetStateAction<{url: string, loading: string | null}>>, isVideo: boolean = false, addCacheBuster: boolean = true) => {
    if (isInitialLoad.current) {
        setState({ url: isVideo ? '' : '/placeholder.png', loading: `Loading ${isVideo ? 'video' : 'image'}...` });
    }

    const cacheKey = `${url}::${isVideo ? 'video' : 'image'}`;
    const cached = solarImageCache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.fetchedAt < SOLAR_IMAGE_CACHE_TTL_MS) {
      setState({ url: cached.url, loading: null });
      setLastImagesUpdate(new Date(cached.fetchedAt).toLocaleTimeString('en-NZ'));
      return;
    }

    const fetchUrl = addCacheBuster ? `${url}?_=${now}` : url;

    if (isVideo) {
      solarImageCache.set(cacheKey, { url, fetchedAt: now });
      setState({ url, loading: null });
      setLastImagesUpdate(new Date().toLocaleTimeString('en-NZ'));
      return;
    }

    // Preload immediately so switching modes is instant once loaded.
    const img = new Image();
    img.onload = () => {
      solarImageCache.set(cacheKey, { url: fetchUrl, fetchedAt: Date.now() });
      setState({ url: fetchUrl, loading: null });
      setLastImagesUpdate(new Date().toLocaleTimeString('en-NZ'));
    };
    img.onerror = () => {
      // Keep direct URL as fallback even if preload handshake fails (some hosts block probe requests).
      solarImageCache.set(cacheKey, { url: fetchUrl, fetchedAt: Date.now() });
      setState({ url: fetchUrl, loading: null });
      setLastImagesUpdate(new Date().toLocaleTimeString('en-NZ'));
    };
    img.src = fetchUrl;
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

  const fetchFirstAvailableText = useCallback(async (urls: string[]) => {
    let lastError: Error | null = null;
    for (const url of urls) {
      try {
        const res = await fetch(`${url}?_=${Date.now()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
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
    } finally {
      reportInitialTask('solarXray');
    }
  }, [fetchFirstAvailableJson, reportInitialTask, setLatestXrayFlux]);

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
    } finally {
      reportInitialTask('solarProton');
    }
  }, [fetchFirstAvailableJson, reportInitialTask]);

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
    } finally {
      reportInitialTask('solarFlares');
    }
  }, [reportInitialTask]);

  const fetchSunspotRegions = useCallback(async () => {
    if (isInitialLoad.current) {
      setLoadingSunspotRegions('Loading active sunspot regions...');
    }

    try {
      const rawText = await fetchFirstAvailableText([NOAA_ACTIVE_REGIONS_TEXT_URL]);
      const textRegions = parseNoaaSolarRegionsText(rawText);
      const textRegionIds = new Set(textRegions.map((region) => region.region));

      const [sunspotReportRaw, solarRegionsRaw] = await Promise.all([
        fetchFirstAvailableJson(['https://services.swpc.noaa.gov/json/sunspot_report.json']),
        fetchFirstAvailableJson(['https://services.swpc.noaa.gov/json/solar_regions.json']),
      ]);

      const combined = [
        ...extractActiveRegionEntries(sunspotReportRaw, 'sunspot_report.json'),
        ...extractActiveRegionEntries(solarRegionsRaw, 'solar_regions.json'),
        ...textRegions,
      ].filter((entry) => textRegionIds.has(entry.region));

      const nzNow = toNzEpochMs(Date.now());
      const cutoff = nzNow - ACTIVE_REGION_MAX_AGE_MS;

      const grouped = combined.reduce((acc, item) => {
        if (!isValidSunspotRegion(item)) return acc;
        const bucket = acc.get(item.region) ?? [];
        bucket.push(item);
        acc.set(item.region, bucket);
        return acc;
      }, new Map<string, Omit<ActiveSunspotRegion, 'trend'>[]>());

      const dedupedLatest: ActiveSunspotRegion[] = Array.from(grouped.values())
        .map((entries) => {
          if (!Array.isArray(entries) || entries.length === 0) return null;

          const sorted = [...entries]
            .filter(isValidSunspotRegion)
            .sort((a, b) => {
              const ta = a?.observedTime ?? 0;
              const tb = b?.observedTime ?? 0;
              if (tb !== ta) return tb - ta;
              return ((b as any)?._sourceIndex ?? 0) - ((a as any)?._sourceIndex ?? 0);
            });

          const latest = sorted[0];
          if (!isValidSunspotRegion(latest)) return null;

          const fallbackWithCoords = sorted.find((entry) => (entry?.latitude ?? null) !== null && (entry?.longitude ?? null) !== null);
          const fallbackWithLocation = sorted.find((entry) => Boolean(entry?.location && entry.location !== 'N/A'));
          const previousWithArea = sorted.slice(1).find((entry) => (entry?.area ?? null) !== null);

          let trend: ActiveSunspotRegion['trend'] = 'Stable';
          if ((latest?.area ?? null) !== null && (previousWithArea?.area ?? null) !== null) {
            const delta = (latest.area as number) - (previousWithArea!.area as number);
            if (delta >= 15) trend = 'Growing';
            else if (delta <= -15) trend = 'Shrinking';
          }

          const observed = latest.observedTime ?? null;
          const observedNz = observed ? toNzEpochMs(observed) : null;
          if (observedNz !== null && (observedNz < cutoff || observedNz > nzNow + 60 * 60 * 1000)) return null;

          const { _sourceIndex, ...cleanLatest } = latest as any;
          return {
            ...cleanLatest,
            location: cleanLatest.location || fallbackWithLocation?.location || 'N/A',
            latitude: (() => {
              const lat = cleanLatest.latitude ?? fallbackWithCoords?.latitude ?? null;
              return lat !== null && Math.abs(lat) <= 90 ? lat : null;
            })(),
            longitude: (() => {
              const lon = cleanLatest.longitude ?? fallbackWithCoords?.longitude ?? null;
              return lon !== null && Math.abs(lon) <= 90 ? lon : null;
            })(),
            classification: cleanLatest.classification ?? null,
            protonProbability: getFirstNumber(sorted, (entry) => entry?.protonProbability ?? null),
            cFlareEvents24h: getFirstNumber(sorted, (entry) => entry?.cFlareEvents24h ?? null),
            mFlareEvents24h: getFirstNumber(sorted, (entry) => entry?.mFlareEvents24h ?? null),
            xFlareEvents24h: getFirstNumber(sorted, (entry) => entry?.xFlareEvents24h ?? null),
            previousActivity: getFirstText(sorted, (entry) => entry?.previousActivity ?? null),
            source: cleanLatest.source ?? 'NOAA',
            trend,
          };
        })
        .filter((region): region is ActiveSunspotRegion => Boolean(region && typeof region === 'object'))
        .filter((region) => isEarthFacingCoordinate(region.latitude, region.longitude))
        .filter((region) => (region.area ?? 0) >= ACTIVE_REGION_MIN_AREA_MSH)
        .sort((a, b) => (b?.area ?? -1) - (a?.area ?? -1));

      setActiveSunspotRegions(dedupedLatest);
      setLoadingSunspotRegions(null);
      setLastSunspotRegionsUpdate(new Date().toLocaleTimeString('en-NZ'));
    } catch (error) {
      console.error('Error fetching active sunspot regions:', error);
      setActiveSunspotRegions([]);
      setLoadingSunspotRegions(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setLastSunspotRegionsUpdate(new Date().toLocaleTimeString('en-NZ'));
    } finally {
      reportInitialTask('solarRegions');
    }
  }, [fetchFirstAvailableJson, fetchFirstAvailableText, reportInitialTask]);

  const runAllUpdates = useCallback(() => {
    fetchImage(SUVI_131_URL, setSuvi131);
    fetchImage(SUVI_304_URL, setSuvi304);
    fetchImage(SDO_HMI_BC_1024_URL, setSdoHmiBc1024, false, false);
    fetchImage(SDO_HMI_B_1024_URL, setSdoHmiB1024, false, false);
    fetchImage(SDO_HMI_IF_1024_URL, setSdoHmiIf1024, false, false);
    fetchImage(SUVI_195_URL, setSuvi195);
    fetchImage(CCOR1_VIDEO_URL, setCcor1Video, true);
    fetchXrayFlux();
    fetchProtonFlux();
    fetchFlares();
    fetchSunspotRegions();
  }, [fetchFlares, fetchImage, fetchProtonFlux, fetchSunspotRegions, fetchXrayFlux]);

  useEffect(() => {
    runAllUpdates();
    const interval = setInterval(runAllUpdates, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runAllUpdates]);

  useEffect(() => {
    runAllUpdates();
  }, [refreshSignal, runAllUpdates]);


  useEffect(() => {
    if (reportedInitialTasks.current.size >= 4) {
      isInitialLoad.current = false;
    }
  }, [lastXrayUpdate, lastProtonUpdate, lastFlaresUpdate, lastSunspotRegionsUpdate]);

  useEffect(() => {
    if (!selectedSunspotRegion) return;
    fetchImage(SDO_HMI_BC_4096_URL, setSdoHmiBc4096, false, false);
    fetchImage(SDO_HMI_B_4096_URL, setSdoHmiB4096, false, false);
    fetchImage(SDO_HMI_IF_4096_URL, setSdoHmiIf4096, false, false);
  }, [fetchImage, selectedSunspotRegion]);

  useEffect(() => {
    if (!onInitialLoad || initialLoadNotifiedRef.current) return;

    const hasInitialCoreData = !!lastXrayUpdate && !!lastProtonUpdate && !!lastFlaresUpdate;
    const hasAnyImagery = [suvi131, suvi195, suvi304, sdoHmiBc1024, sdoHmiB1024, sdoHmiIf1024]
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
    sdoHmiB1024,
    sdoHmiIf1024,
    sdoHmiBc4096,
    sdoHmiB4096,
    sdoHmiIf4096,
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

  const openSunspotCloseupInViewer = useCallback(async () => {
    if (!selectedSunspotCloseupUrl || !selectedSunspotRegion || selectedSunspotRegion.latitude === null || selectedSunspotRegion.longitude === null) return;

    const geometry = overviewGeometry ?? { width: HMI_IMAGE_SIZE, height: HMI_IMAGE_SIZE, cx: HMI_IMAGE_SIZE / 2, cy: HMI_IMAGE_SIZE / 2, radius: HMI_IMAGE_SIZE * 0.46 };
    const pos = solarCoordsToPixel(
      selectedSunspotRegion.latitude,
      selectedSunspotRegion.longitude,
      geometry.cx,
      geometry.cy,
      geometry.radius
    );
    const constrained = constrainToSolarDiskBounds(pos.x, pos.y, geometry);
    const preview = {
      xPercent: (constrained.x / geometry.width) * 100,
      yPercent: (constrained.y / geometry.height) * 100,
    };

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const loaded = await new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = selectedSunspotCloseupUrl;
      });

      if (!loaded) {
        setViewerMedia({ url: selectedSunspotCloseupUrl, type: 'image' });
        return;
      }

      const canvas = document.createElement('canvas');
      const cropSize = 900;
      canvas.width = cropSize;
      canvas.height = cropSize;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setViewerMedia({ url: selectedSunspotCloseupUrl, type: 'image' });
        return;
      }

      const sourceW = img.naturalWidth || HMI_IMAGE_SIZE;
      const sourceH = img.naturalHeight || HMI_IMAGE_SIZE;
      const centerX = (preview.xPercent / 100) * sourceW;
      const centerY = (preview.yPercent / 100) * sourceH;
      const size = Math.min(sourceW, sourceH) * 0.24;
      const half = size / 2;
      const sx = Math.max(0, Math.min(sourceW - size, centerX - half));
      const sy = Math.max(0, Math.min(sourceH - size, centerY - half));

      ctx.drawImage(img, sx, sy, size, size, 0, 0, cropSize, cropSize);
      setViewerMedia({ url: canvas.toDataURL('image/jpeg', 0.95), type: 'image' });
    } catch {
      setViewerMedia({ url: selectedSunspotCloseupUrl, type: 'image' });
    }
  }, [overviewGeometry, selectedSunspotCloseupUrl, selectedSunspotRegion, setViewerMedia]);

  useEffect(() => {
    if (!sunspotOverviewImage.url || sunspotOverviewImage.url === '/placeholder.png' || sunspotOverviewImage.url === '/error.png') {
      setOverviewGeometry(null);
      return;
    }

    let cancelled = false;
    const source = new Image();

    source.onload = () => {
      if (cancelled) return;

      const width = source.naturalWidth || HMI_IMAGE_SIZE;
      const height = source.naturalHeight || HMI_IMAGE_SIZE;

      // SDO HMI products (1024/4096) have stable native disk geometry.
      // Scale from 4096-native geometry so markers align in both dashboard 1K and 4K sources.
      if (width >= 900 && height >= 900) {
        const scaleX = width / HMI_IMAGE_SIZE;
        const scaleY = height / HMI_IMAGE_SIZE;
        const scale = Math.min(scaleX, scaleY);
        const detected = detectSolarDiskGeometry(source);
        setOverviewGeometry({
          width,
          height,
          cx: (SDO_HMI_NATIVE_CX * scaleX + detected.cx) / 2,
          cy: (SDO_HMI_NATIVE_CY * scaleY + detected.cy) / 2,
          radius: (SDO_HMI_NATIVE_RADIUS * scale + detected.radius) / 2,
        });
        return;
      }

      const fallback = { width, height, cx: width / 2, cy: height / 2, radius: Math.min(width, height) * 0.48 };
      setOverviewGeometry(fallback);
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

  useEffect(() => {
    if (!selectedSunspotRegion) {
      setSelectedSunspotCloseupUrl(null);
      return;
    }

    if (!sunspotOverviewImage4k.url || sunspotOverviewImage4k.url === '/placeholder.png' || sunspotOverviewImage4k.url === '/error.png') {
      setSelectedSunspotCloseupUrl(null);
      return;
    }

    setSelectedSunspotCloseupUrl(sunspotOverviewImage4k.url);
  }, [selectedSunspotRegion, sunspotOverviewImage4k.url]);

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
        <style>{`body { overflow-y: auto !important; } .styled-scrollbar::-webkit-scrollbar { width: 8px; } .styled-scrollbar::-webkit-scrollbar-track { background: #262626; } .styled-scrollbar::-webkit-scrollbar-thumb { background: #525252; } @keyframes sunspotPulse { 0%{transform:scale(1);opacity:.95} 100%{transform:scale(2.25);opacity:0} }`}</style>
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
                  <div onClick={() => sdoHmiBc4096.url !== '/placeholder.png' && sdoHmiBc4096.url !== '/error.png' && setViewerMedia({ url: sdoHmiBc4096.url, type: 'image' })}
                       className="w-full h-full flex justify-center items-center cursor-pointer"
                       title={tooltipContent['sdo-hmibc-1024']}>
                    <img src={sdoHmiBc1024.url} alt="SDO HMI Continuum" className="w-full h-full object-contain rounded-lg" />
                    {sdoHmiBc1024.loading && <LoadingSpinner message={sdoHmiBc1024.loading} />}
                  </div>
                )}
                {activeSunImage === 'SDO_HMIIF_1024' && (
                  <div onClick={() => sdoHmiIf4096.url !== '/placeholder.png' && sdoHmiIf4096.url !== '/error.png' && setViewerMedia({ url: sdoHmiIf4096.url, type: 'image' })}
                       className="w-full h-full flex justify-center items-center cursor-pointer"
                       title={tooltipContent['sdo-hmiif-1024']}>
                    <img src={sdoHmiIf1024.url} alt="SDO HMI Intensitygram" className="w-full h-full object-contain rounded-lg" />
                    {sdoHmiIf1024.loading && <LoadingSpinner message={sdoHmiIf1024.loading} />}
                  </div>
                )}
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
                      if (sunspotOverviewImage4k.url === '/placeholder.png' || sunspotOverviewImage4k.url === '/error.png') return;
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
                    <img
                      src={sunspotOverviewImage.url}
                      alt="SDO sunspot overview"
                      className="w-full h-full object-contain rounded-lg"
                    />
                    {loadingSunspotRegions && <LoadingSpinner message={loadingSunspotRegions} />}

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
                          {isSelected && (
                            <span
                              className="absolute inset-0 w-4 h-4 rounded-full -translate-x-1/2 -translate-y-1/2 left-1/2 top-1/2"
                              style={{ border: `1px solid ${riskBand.color}`, animation: 'sunspotPulse 1.5s ease-out infinite' }}
                            />
                          )}
                          <span
                            className="relative z-10 block w-3 h-3 rounded-full border border-white/40"
                            style={{ backgroundColor: riskBand.color, boxShadow: `0 0 12px ${riskBand.color}` }}
                          />
                          <span className="absolute left-3 -top-2 px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap bg-black/75 text-sky-200 border border-sky-500/40 opacity-90 group-hover:opacity-100">
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
                                  src={selectedSunspotCloseupUrl}
                                  alt={`AR ${selectedSunspotRegion.region} closeup`}
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
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-neutral-500">Close-up unavailable</div>
                        )}
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-neutral-500">Magnetic Class</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.magneticClass || '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Classification</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.classification || '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Area</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.area ? `${selectedSunspotRegion.area} MSH` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Spot Count</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.spotCount ?? '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Trend</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.trend}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Observed (NZ)</span><span className="text-neutral-100 font-semibold">{formatNZTimestamp(selectedSunspotRegion.observedTime)}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">M-flare probability</span><span className="text-orange-300 font-semibold">{selectedSunspotRegion.mFlareProbability != null ? `${selectedSunspotRegion.mFlareProbability}%` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">X-flare probability</span><span className="text-red-300 font-semibold">{selectedSunspotRegion.xFlareProbability != null ? `${selectedSunspotRegion.xFlareProbability}%` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Proton probability</span><span className="text-fuchsia-300 font-semibold">{selectedSunspotRegion.protonProbability != null ? `${selectedSunspotRegion.protonProbability}%` : '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">24h flare events</span><span className="text-neutral-100 font-semibold">C {selectedSunspotRegion.cFlareEvents24h ?? '—'} · M {selectedSunspotRegion.mFlareEvents24h ?? '—'} · X {selectedSunspotRegion.xFlareEvents24h ?? '—'}</span></div>
                        <div className="flex justify-between gap-3"><span className="text-neutral-500">Previous activity</span><span className="text-neutral-100 font-semibold text-right max-w-[65%]">{selectedSunspotRegion.previousActivity || '—'}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Source</span><span className="text-neutral-100 font-semibold">{selectedSunspotRegion.source || 'NOAA'}</span></div>
                      </div>
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
