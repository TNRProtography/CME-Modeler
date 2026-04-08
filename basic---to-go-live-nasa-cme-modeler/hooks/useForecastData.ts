//--- START OF FILE src/hooks/useForecastData.ts ---

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SubstormActivity,
  SubstormForecast,
  ActivitySummary,
} from '../types';

// --- Type Definitions ---
interface CelestialTimeData {
  moon?: { rise: number | null, set: number | null, illumination?: number; waxing?: boolean };
  sun?: { rise: number | null, set: number | null };
}

interface DailyHistoryEntry {
  date: string;
  sun?: { rise: number | null, set: number | null };
  moon?: { rise: number | null, set: number | null, illumination?: number; waxing?: boolean };
}

interface OwmDailyForecastEntry {
  dt: number;
  sunrise: number;
  sunset: number;
  moonrise: number;
  moonset: number;
  moon_phase: number;
}

interface RawHistoryRecord {
  timestamp: number;
  baseScore: number;
  finalScore: number;
  hemisphericPower: number;
}

interface InterplanetaryShock {
  activityID: string;
  catalog: string;
  eventTime: string;
  instruments: { displayName: string }[];
  location: string;
  link: string;
}

// --- NEW: Type for detected NZ Mag events ---
export interface NzMagEvent {
    start: number;
    end: number;
    maxDelta: number;
}

// --- Substorm Risk Worker response types ---
export interface SubstormRiskMetrics {
  geomag: {
    latest_dH_corrected: number;
    avg_5m_dH: number;
    avg_10m_dH: number;
    avg_15m_dH: number;
    max_15m_dH: number;
    ls_slope_5m_dH: number;
    ls_slope_10m_dH: number;
    h_bay_depth_nT: number;
    bay_onset_detected: boolean;
    geomag_score: number;
  };
  solar_wind: {
    bz: number;
    bt: number;
    avg_10m_bz: number;
    avg_30m_bz: number;
    avg_60m_bz: number;
    min_30m_bz: number;
    southward_minutes_30m: number;
    southward_minutes_60m: number;
    speed: number;
    avg_30m_speed: number;
    avg_60m_speed: number;
    density: number;
    avg_30m_density: number;
    dynamic_pressure_nPa: number;
    avg_30m_pressure_nPa: number;
    newell_coupling_now: number;
    newell_avg_30m: number;
    newell_avg_60m: number;
    temperature_K: number;
    temperature_expected_K: number;
    temperature_ratio: number;
    cme_sheath_flag: boolean;
    solar_loading_score: number;
  };
  l1_propagation_minutes: number;
}

export interface SubstormRiskCurrent {
  score: number;
  level: string;
  confidence: number | null;
  confidence_text: string;
  risk_increasing: boolean;
  risk_trend: 'Rapidly Increasing' | 'Increasing' | 'Stable' | 'Decreasing' | 'Rapidly Decreasing';
  bay_onset_flag: boolean;
  cme_sheath_flag: boolean;
  summary: string;
  timestamp_utc: string;
}

export interface SubstormRiskHistoryEntry extends SubstormRiskCurrent {
  metrics: SubstormRiskMetrics;
}

export interface SubstormRiskData {
  ok: boolean;
  updated_utc: string;
  resolution: string;
  l1_propagation_minutes: number;
  l1_propagation_note: string;
  current: SubstormRiskCurrent;
  metrics: SubstormRiskMetrics;
  history_24h: SubstormRiskHistoryEntry[];
}

type Status = "QUIET" | "WATCH" | "LIKELY_60" | "IMMINENT_30" | "ONSET";

// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const SUBSTORM_RISK_URL = 'https://aurora-index-sta.thenamesrock.workers.dev/api/substorm?resolution=5m';
const SOLAR_WIND_IMF_URL = 'https://imap-solar-data-test.thenamesrock.workers.dev/rtsw/merged-24h';
const NOAA_GOES18_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json';
const NOAA_GOES19_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/secondary/magnetometers-1-day.json';
const NASA_IPS_URL = 'https://spottheaurora.thenamesrock.workers.dev/ips';
const GEONET_API_URL = 'https://tilde.geonet.org.nz/v4/data';
const GREYMOUTH_LATITUDE = -42.45;

// --- Physics and Model Helpers ---
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function newellCoupling(V: number, By: number, Bz: number) {
  const BT = Math.sqrt((By ?? 0) ** 2 + (Bz ?? 0) ** 2);
  const theta = Math.atan2(By ?? 0, Bz ?? 0);
  const s = Math.sin(theta / 2);
  const val = Math.pow(V, 4 / 3) * Math.pow(BT, 2 / 3) * Math.pow(Math.abs(s), 8 / 3);
  return val / 1000;
}

function movingAvg(vals: number[], n: number) {
  if (!vals.length) return undefined;
  const m = Math.min(vals.length, n);
  const sub = vals.slice(vals.length - m);
  return sub.reduce((a, b) => a + b, 0) / m;
}

function sustainedSouth(bzSeries: number[], minutes = 15) {
  if (!bzSeries.length) return false;
  const m = Math.min(bzSeries.length, minutes);
  const sub = bzSeries.slice(bzSeries.length - m);
  // -5 nT threshold for sustained southward Bz: studies (e.g. Newell et al. 2007)
  // show meaningful dayside reconnection and energy loading begins at ~-5 nT.
  // -3 nT is too sensitive and flags weak coupling conditions as "sustained".
  const fracSouth = sub.filter(bz => bz <= -5).length / sub.length;
  return fracSouth >= 0.8;
}

function slopePerMin(series: { t: number; v: number }[], minutes = 2) {
  if (series.length < 2) return undefined;
  const end = series[series.length - 1];
  for (let i = series.length - 2; i >= 0; i--) {
    const dtm = (end.t - series[i].t) / 60000;
    if (dtm >= minutes - 0.5) return (end.v - series[i].v) / dtm;
  }
  return undefined;
}

function probabilityModel(dPhiNow: number, dPhiMean15: number, bzMean15: number) {
  const base = Math.tanh(0.015 * (dPhiMean15 || dPhiNow) + 0.01 * dPhiNow);
  const bzBoost = bzMean15 < -3 ? 0.10 : bzMean15 < -1 ? 0.05 : 0;
  // Floors reduced to reflect actual background substorm rate during quiet conditions.
  // Original 0.25/0.15 floors caused likelihood% to never drop below ~21% even on
  // completely quiet nights. True background rate during low coupling is ~5%.
  const P60 = Math.min(0.9, Math.max(0.01, 0.05 + 0.6 * base + bzBoost));
  const P30 = Math.min(0.9, Math.max(0.01, 0.03 + 0.7 * base + bzBoost));
  return { P30, P60 };
}

// IGRF-13 north magnetic dipole pole (geographic coordinates)
const POLE_LAT_RAD = 80.65 * Math.PI / 180;
const POLE_LON_RAD = -72.68 * Math.PI / 180;

// Convert geographic lat/lon to geomagnetic latitude using IGRF-13 dipole
function geoToGmagLat(latDeg: number, lonDeg: number): number {
  const phi = latDeg * Math.PI / 180;
  const lam = lonDeg * Math.PI / 180;
  const sinGmag = Math.sin(phi) * Math.sin(POLE_LAT_RAD) +
                  Math.cos(phi) * Math.cos(POLE_LAT_RAD) * Math.cos(lam - POLE_LON_RAD);
  return Math.asin(Math.max(-1, Math.min(1, sinGmag))) * 180 / Math.PI;
}

// Greymouth geomagnetic latitude (geographic: -42.45°, 171.21°E)
const GREYMOUTH_GMAG_LAT = geoToGmagLat(GREYMOUTH_LATITUDE, 171.21);

const calculateLocationAdjustment = (userLat: number, userLon: number = 171.21): number => {
  // Use geomagnetic latitude (IGRF-13) rather than geographic latitude.
  // Aurora visibility is governed by proximity to the auroral oval, which
  // is organised by geomagnetic (not geographic) latitude. In NZ the difference
  // is ~18–22°, so this is a meaningful correction for users far from Greymouth.
  const userGmagLat = geoToGmagLat(userLat, userLon);
  const isNorthOfGreymouth = userGmagLat > GREYMOUTH_GMAG_LAT;
  const R = 6371;
  const dLat = (userGmagLat - GREYMOUTH_GMAG_LAT) * (Math.PI / 180);
  const distanceKm = Math.abs(dLat) * R;
  const numberOfSegments = Math.floor(distanceKm / 10);
  const adjustmentFactor = numberOfSegments * 0.2;
  return isNorthOfGreymouth ? -adjustmentFactor : adjustmentFactor;
};

const formatNZTimestamp = (timestamp: number | string, options?: Intl.DateTimeFormatOptions) => {
  try {
    const d = new Date(timestamp);
    const defaultOptions: Intl.DateTimeFormatOptions = { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' };
    return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { ...defaultOptions, ...options });
  } catch {
    return "Invalid Date";
  }
};

const parseNOAATime = (s: string): number => {
  if (!s || typeof s !== 'string') return NaN;
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  const withZ = iso.endsWith('Z') ? iso : iso + 'Z';
  const t = Date.parse(withZ);
  return Number.isFinite(t) ? t : NaN;
};

const getSourceLabel = (source?: string | null) => {
  if (!source) return '—';
  return source.includes('IMAP') ? 'IMAP' : 'NOAA RTSW';
};

const toFiniteNumber = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

const pickSolarWindValue = (entry: any, key: string): { value: number | null; source: string } => {
  const read = (...candidates: unknown[]): number | null => {
    for (const candidate of candidates) {
      const parsed = toFiniteNumber(candidate);
      if (parsed !== null) return parsed;
    }
    return null;
  };

  const rtswValue = read(
    entry?.rtsw?.[key],
    entry?.noaa?.[key],
    entry?.[`${key}_rtsw`],
    entry?.[`rtsw_${key}`],
    entry?.[`noaa_${key}`]
  );
  if (rtswValue !== null) return { value: rtswValue, source: 'NOAA RTSW' };

  const imapValue = read(
    entry?.imap?.[key],
    entry?.[`${key}_imap`],
    entry?.[`imap_${key}`]
  );
  if (imapValue !== null) return { value: imapValue, source: 'IMAP' };

  const mergedValue = read(entry?.[key]);
  if (mergedValue !== null) {
    return { value: mergedValue, source: getSourceLabel(entry?.src?.[key] ?? entry?.src) };
  }

  return { value: null, source: '—' };
};

const combineSources = (...sources: Array<string | null | undefined>): string => {
  const normalized = Array.from(new Set(
    sources
      .map((source) => source?.trim())
      .filter((source): source is string => !!source && source !== '—')
  ));
  if (!normalized.length) return '—';
  if (normalized.length === 1) return normalized[0];
  if (normalized.includes('NOAA RTSW') && normalized.includes('IMAP')) return 'NOAA RTSW + IMAP';
  return normalized.join(' + ');
};

const splitTopLevelArrayEntries = (raw: string): string[] => {
  const entries: string[] = [];
  let current = '';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    current += ch;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth = Math.max(0, depth - 1);
    else if (ch === ',' && depth === 0) {
      const candidate = current.slice(0, -1).trim();
      if (candidate) entries.push(candidate);
      current = '';
    }
  }

  const trailing = current.trim();
  if (trailing) entries.push(trailing);
  return entries;
};

const parseJsonWithRowRecovery = (rawText: string) => {
  const text = rawText.trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    // fall through to row-level recovery
  }

  const parseArrayEntries = (arrayBody: string) => {
    const recovered: any[] = [];
    for (const entryText of splitTopLevelArrayEntries(arrayBody)) {
      try {
        recovered.push(JSON.parse(entryText));
      } catch {
        // Skip malformed row and continue
      }
    }
    return recovered;
  };

  if (text.startsWith('[') && text.endsWith(']')) {
    return parseArrayEntries(text.slice(1, -1));
  }

  const dataKeyIndex = text.indexOf('"data"');
  if (dataKeyIndex >= 0) {
    const arrayStart = text.indexOf('[', dataKeyIndex);
    if (arrayStart >= 0) {
      let depth = 0;
      let inString = false;
      let escaped = false;
      let arrayEnd = -1;

      for (let i = arrayStart; i < text.length; i++) {
        const ch = text[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') {
          inString = true;
          continue;
        }
        if (ch === '[') depth++;
        else if (ch === ']') {
          depth--;
          if (depth === 0) {
            arrayEnd = i;
            break;
          }
        }
      }

      if (arrayEnd > arrayStart) {
        const recoveredData = parseArrayEntries(text.slice(arrayStart + 1, arrayEnd));
        const okMatch = text.match(/"ok"\s*:\s*(true|false)/i);
        return { ok: okMatch ? okMatch[1].toLowerCase() === 'true' : recoveredData.length > 0, data: recoveredData };
      }
    }
  }

  return null;
};

const fetchJsonWithRecovery = async (url: string, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const raw = await response.text();
    const parsed = parseJsonWithRowRecovery(raw);
    if (parsed === null) {
      throw new Error(`Unable to parse JSON from ${url}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
};

const getVisibilityBlurb = (score: number | null): string => {
    if (score === null) return 'Potential visibility is unknown.';
    if (score >= 80) return 'Potential visibility is high, with a significant display likely.';
    if (score >= 60) return 'Potential visibility is good for naked-eye viewing.';
    if (score >= 50) return 'Potential visibility includes faint naked-eye glows.';
    if (score >= 40) return 'Potential visibility is good for phone cameras.';
    if (score >= 25) return 'Potential visibility is for cameras only.';
    return 'Potential visibility is low.';
};

export const useForecastData = (
  setCurrentAuroraScore: (score: number | null) => void,
  setSubstormActivityStatus: (status: SubstormActivity | null) => void,
  onInitialLoadProgress?: (task: 'forecastApi' | 'solarWindApi' | 'goes18Api' | 'goes19Api' | 'ipsApi' | 'nzMagApi') => void
) => {
  const [isLoading, setIsLoading] = useState(true);
  const [auroraScore, setAuroraScore] = useState<number | null>(null);
  const [baseAuroraScore, setBaseAuroraScore] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('Loading...');
  const [gaugeData, setGaugeData] = useState<Record<string, { value: string; unit: string; emoji: string; percentage: number; lastUpdated: string; color: string; source?: string }>>({
    bt: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080', source: '—' },
    bz: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080', source: '—' },
    power: { value: '...', unit: 'GW', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    moon: { value: '...', unit: '%', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    speed: { value: '...', unit: 'km/s', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080', source: '—' },
    density: { value: '...', unit: 'p/cm³', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080', source: '—' },
    temp: { value: '...', unit: 'K', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080', source: '—' },
  });
  const [celestialTimes, setCelestialTimes] = useState<CelestialTimeData>({});
  const [isDaylight, setIsDaylight] = useState(false);
  const [allSpeedData, setAllSpeedData] = useState<any[]>([]);
  const [allDensityData, setAllDensityData] = useState<any[]>([]);
  const [allTempData, setAllTempData] = useState<any[]>([]);
  const [allImfClockData, setAllImfClockData] = useState<any[]>([]);
  const [allMagneticData, setAllMagneticData] = useState<any[]>([]);
  const [goes18Data, setGoes18Data] = useState<{ time: number; hp: number; }[]>([]);
  const [goes19Data, setGoes19Data] = useState<{ time: number; hp: number; }[]>([]);
  const [loadingMagnetometer, setLoadingMagnetometer] = useState<string | null>('Loading data...');
  const [nzMagData, setNzMagData] = useState<any[]>([]);
  const [loadingNzMag, setLoadingNzMag] = useState<string | null>('Loading data...');
  const [auroraScoreHistory, setAuroraScoreHistory] = useState<{ timestamp: number; baseScore: number; finalScore: number; }[]>([]);
  const [hemisphericPowerHistory, setHemisphericPowerHistory] = useState<{ timestamp: number; hemisphericPower: number; }[]>([]);
  const [dailyCelestialHistory, setDailyCelestialHistory] = useState<DailyHistoryEntry[]>([]);
  const [owmDailyForecast, setOwmDailyForecast] = useState<OwmDailyForecastEntry[]>([]);
  const [interplanetaryShockData, setInterplanetaryShockData] = useState<InterplanetaryShock[]>([]);
  const [locationAdjustment, setLocationAdjustment] = useState<number>(0);
  const [locationBlurb, setLocationBlurb] = useState<string>('Getting location for a more accurate forecast...');
  const [userLatitude, setUserLatitude] = useState<number | null>(null);
  const [userLongitude, setUserLongitude] = useState<number | null>(null);
  const [locationFailed, setLocationFailed] = useState<boolean>(false);
  const [isOutsideNZ, setIsOutsideNZ] = useState<boolean>(false);
  const [substormForecast, setSubstormForecast] = useState<SubstormForecast>({
    status: 'QUIET',
    likelihood: 0,
    windowLabel: '30 – 90 min',
    action: 'Low chance for now.',
    p30: 0,
    p60: 0,
  });
  const [substormRiskData, setSubstormRiskData] = useState<SubstormRiskData | null>(null);
  const [nzMagSubstormEvents, setNzMagSubstormEvents] = useState<NzMagEvent[]>([]);

  const reportInitialProgress = useCallback((task: 'forecastApi' | 'solarWindApi' | 'goes18Api' | 'goes19Api' | 'ipsApi' | 'nzMagApi') => {
    onInitialLoadProgress?.(task);
  }, [onInitialLoadProgress]);

  const getMoonData = useCallback((illumination: number | null, rise: number | null, set: number | null, forecast: OwmDailyForecastEntry[]) => {
    const moonIllumination = Math.max(0, (illumination ?? 0));
    let moonEmoji = '🌑'; if (moonIllumination > 95) moonEmoji = '🌕'; else if (moonIllumination > 55) moonEmoji = '🌖'; else if (moonIllumination > 45) moonEmoji = '🌗'; else if (moonIllumination > 5) moonEmoji = '🌒';
    const now = Date.now(); const today = new Date(); const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    const findNextEvent = (times: (number | null)[]) => times.filter((t): t is number => t !== null && !isNaN(t)).sort((a, b) => a - b).find(t => t > now) || null;
    const allRises = [rise, ...forecast.map(d => d.moonrise ? d.moonrise * 1000 : null)]; const allSets = [set, ...forecast.map(d => d.moonset ? d.moonset * 1000 : null)];
    const nextRise = findNextEvent(allRises); const nextSet = findNextEvent(allSets);
    const formatTime = (ts: number | null) => {
      if (!ts) return 'N/A'; const d = new Date(ts);
      const dayLabel = d.toDateString() === today.toDateString() ? 'Today' : d.toDateString() === tomorrow.toDateString() ? 'Tomorrow' : d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
      return `${dayLabel} ${d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}`;
    };
    const riseStr = formatTime(nextRise); const setStr = formatTime(nextSet);
    
    const value = `${moonIllumination.toFixed(0)}% <span class='text-xs block'>Rise: ${riseStr} | Set: ${setStr}</span>`;

    return { value, unit: '', emoji: moonEmoji, percentage: moonIllumination, lastUpdated: `Updated: ${formatNZTimestamp(Date.now())}`, color: '#A9A9A9' };
  }, []);

  const recentL1Data = useMemo(() => {
    if (!allMagneticData.length || !allSpeedData.length) return null;
    const mapV = new Map<number, number>();
    allSpeedData.forEach((p: { x: number, y: number }) => mapV.set(p.x, p.y));

    const joined: { t: number; By: number; Bz: number; V: number }[] = [];
    for (const m of allMagneticData) {
      const V = mapV.get(m.time);
      if (V && m.by != null && m.bz != null) {
        joined.push({ t: m.time, By: m.by, Bz: m.bz, V });
      }
    }

    const cutoff = Date.now() - 120 * 60_000;
    const win = joined.filter(x => x.t >= cutoff);
    const dPhi = win.map(w => newellCoupling(w.V, w.By, w.Bz));
    const bz = win.map(w => w.Bz);

    return {
      dPhiSeries: dPhi,
      bzSeries: bz,
      dPhiNow: dPhi.at(-1) ?? 0,
      dPhiMean15: movingAvg(dPhi, 15) ?? (dPhi.at(-1) ?? 0),
      bzMean15: movingAvg(bz, 15) ?? (bz.at(-1) ?? 0),
      sustained: sustainedSouth(bz, 15)
    };
  }, [allMagneticData, allSpeedData]);

  const goesOnset = useMemo(() => {
    if (!goes18Data.length) return false;
    const cutoff = Date.now() - 15 * 60_000;
    const series = goes18Data.filter((g) => g.time >= cutoff && g.hp)
      .map((g) => ({ t: g.time, v: g.hp }));
    const slope = slopePerMin(series, 2);
    return typeof slope === "number" && slope >= 8;
  }, [goes18Data]);

  const nzMagOnset = useMemo(() => {
      if (!nzMagData.length) return false;
      const data = nzMagData[0]?.data;
      if (!data || data.length < 5) return false;
      const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
      const recentData = data.filter((p: any) => p.x >= thirtyMinsAgo);
      if (recentData.length < 5) return false;
      // Require at least 3 consecutive readings above 10 nT/min for a genuine bay onset.
      // A single spike above 5 nT/min can be a sensor glitch or minor disturbance —
      // real substorm bays are sustained rapid deflections.
      let consecutiveCount = 0;
      for (const p of recentData) {
          if (Math.abs(p.y) >= 10) {
              consecutiveCount++;
              if (consecutiveCount >= 3) return true;
          } else {
              consecutiveCount = 0;
          }
      }
      return false;
  }, [nzMagData]);

  // --- NEW: Analyze NZ Mag data for past events ---
  useMemo(() => {
    if (!nzMagData.length || !nzMagData[0]?.data) {
        setNzMagSubstormEvents([]);
        return;
    }
    const data = nzMagData[0].data;
    const events: NzMagEvent[] = [];
    let currentEvent: NzMagEvent | null = null;
    const THRESHOLD = 5; // nT/min
    const COOLDOWN_MINS = 10;

    for (const point of data) {
        const isVolatile = Math.abs(point.y) >= THRESHOLD;

        if (isVolatile && !currentEvent) {
            // Start a new event
            currentEvent = { start: point.x, end: point.x, maxDelta: Math.abs(point.y) };
        } else if (isVolatile && currentEvent) {
            // Continue the current event
            currentEvent.end = point.x;
            currentEvent.maxDelta = Math.max(currentEvent.maxDelta, Math.abs(point.y));
        } else if (!isVolatile && currentEvent) {
            // End the current event if it's been quiet for a while
            if (point.x - currentEvent.end > COOLDOWN_MINS * 60 * 1000) {
                events.push(currentEvent);
                currentEvent = null;
            }
        }
    }
    // Add the last event if it's still ongoing
    if (currentEvent) {
        events.push(currentEvent);
    }
    setNzMagSubstormEvents(events);
  }, [nzMagData]);

  useEffect(() => {
    if (!recentL1Data) return;

    const probs = probabilityModel(recentL1Data.dPhiNow, recentL1Data.dPhiMean15, recentL1Data.bzMean15);
    const P30_ALERT = 0.60, P60_ALERT = 0.60;
    let status: Status = 'QUIET';

    if (nzMagOnset) {
        status = "ONSET";
    } else if (goesOnset) {
      status = "ONSET";
    } else if (recentL1Data.sustained && probs.P30 >= P30_ALERT && (auroraScore ?? 0) >= 25) {
      status = "IMMINENT_30";
    } else if (recentL1Data.sustained && probs.P60 >= P60_ALERT && (auroraScore ?? 0) >= 20) {
      status = "LIKELY_60";
    } else if (recentL1Data.sustained && recentL1Data.dPhiNow >= (movingAvg(recentL1Data.dPhiSeries, 60) ?? 0) && (auroraScore ?? 0) >= 15) {
      status = "WATCH";
    }

    const likelihood = Math.round((0.4 * clamp01(probs.P30) + 0.6 * clamp01(probs.P60)) * 100);

    let windowLabel = '30 – 90 min';
    if (status === "ONSET") windowLabel = "Now – 10 min";
    else if (status === "IMMINENT_30") windowLabel = "0 – 30 min";
    else if (status === "LIKELY_60") windowLabel = "10 – 60 min";
    else if (status === "WATCH") windowLabel = "20 – 90 min";
    
    let action = 'Default action message.';
    const now = Date.now();
    const sunsetTime = celestialTimes.sun?.set;
    const isPreSunsetHour = sunsetTime ? (now > (sunsetTime - 60 * 60 * 1000) && now < sunsetTime) : false;

    if (isDaylight) {
        action = "The sun is up. Aurora viewing is not possible until after dark.";
    } else if (isPreSunsetHour && (baseAuroraScore ?? 0) >= 50) {
        const viewingTime = sunsetTime ? sunsetTime + 85 * 60 * 1000 : 0;
        action = `Activity is high before sunset! There is good potential for an aurora display after dark, from around ${formatNZTimestamp(viewingTime, {timeStyle: 'short'})}.`;
    } else {
        const visibility = getVisibilityBlurb(auroraScore);
        switch (status) {
            case 'ONSET':
                action = nzMagOnset 
                    ? `Substorm onset detected by NZ ground stations! Look south now! ${visibility}`
                    : `An eruption is underway! Look south now! ${visibility}`;
                break;
            case 'IMMINENT_30':
                action = `Get to your viewing site now! An eruption is expected within 30 minutes. ${visibility}`;
                break;
            case 'LIKELY_60':
                action = `Prepare to go out. An eruption is likely within the hour. ${visibility}`;
                break;
            case 'WATCH':
                action = `Energy is building. Wait for this to upgrade to an Alert if your viewing wishes align with the score. ${visibility}`;
                break;
            case 'QUIET':
                action = 'Conditions are quiet. Not worth leaving home for at this moment.';
                break;
        }
    }

    setSubstormForecast({ status, likelihood, windowLabel, action, p30: probs.P30, p60: probs.P60 });

    setSubstormActivityStatus({
      isStretching: status === 'WATCH' || status === 'LIKELY_60' || status === 'IMMINENT_30',
      isErupting: status === 'ONSET',
      probability: likelihood,
      predictedStartTime: status !== 'QUIET' ? Date.now() : undefined,
      predictedEndTime: status !== 'QUIET' ? Date.now() + 60 * 60 * 1000 : undefined,
      text: action,
      color: ''
    });

  }, [recentL1Data, goesOnset, nzMagOnset, auroraScore, baseAuroraScore, isDaylight, celestialTimes, setSubstormActivityStatus]);

  const fetchAllData = useCallback(async (isInitialLoad = false, getGaugeStyle: Function) => {
    if (isInitialLoad) setIsLoading(true);
    const nzMagUrl = `${GEONET_API_URL}/geomag/EY2M/magnetic-field-rate-of-change/50/60s/dH/latest/1d?aggregationPeriod=1m&aggregationFunction=mean`;
    
    const withInitialProgress = async <T,>(promise: Promise<T>, task: 'forecastApi' | 'solarWindApi' | 'goes18Api' | 'goes19Api' | 'ipsApi' | 'nzMagApi') => {
      try {
        return await promise;
      } finally {
        if (isInitialLoad) reportInitialProgress(task);
      }
    };

    const results = await Promise.allSettled([
      withInitialProgress(fetchJsonWithRecovery(`${FORECAST_API_URL}?_=${Date.now()}`), 'forecastApi'),
      withInitialProgress(fetchJsonWithRecovery(`${SOLAR_WIND_IMF_URL}?_=${Date.now()}`), 'solarWindApi'),
      withInitialProgress(fetchJsonWithRecovery(`${NOAA_GOES18_MAG_URL}?_=${Date.now()}`), 'goes18Api'),
      withInitialProgress(fetchJsonWithRecovery(`${NOAA_GOES19_MAG_URL}?_=${Date.now()}`), 'goes19Api'),
      // ipsApi and nzMagApi are non-blocking (not in FORECAST_INITIAL_TASKS) so they don't
      // hold the loader. Give them tighter timeouts since they feed secondary widgets only.
      withInitialProgress(fetchJsonWithRecovery(`${NASA_IPS_URL}?_=${Date.now()}`, 7000), 'ipsApi'),
      withInitialProgress(fetchJsonWithRecovery(nzMagUrl, 5000), 'nzMagApi'),
      // Substorm risk worker — non-blocking, plain fetch to avoid the row-recovery
      // parser mangling the object-format JSON response from this worker.
      (async () => {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 15000);
          console.log('[SubstormWorker] Fetching:', SUBSTORM_RISK_URL);
          const res = await fetch(`${SUBSTORM_RISK_URL}&_=${Date.now()}`, { signal: controller.signal });
          clearTimeout(timer);
          console.log('[SubstormWorker] HTTP status:', res.status, res.ok);
          if (!res.ok) {
            console.warn('[SubstormWorker] Non-OK response:', res.status);
            return null;
          }
          const json = await res.json();
          console.log('[SubstormWorker] Keys:', json ? Object.keys(json) : 'null');
          console.log('[SubstormWorker] ok:', json?.ok, '| current:', !!json?.current, '| history_24h:', Array.isArray(json?.history_24h) ? json.history_24h.length + ' entries' : 'NOT ARRAY');
          return json;
        } catch (err) {
          console.error('[SubstormWorker] Error:', err);
          return null;
        }
      })(),
    ]);
    const [forecastResult, solarWindResult, goes18Result, goes19Result, ipsResult, nzMagResult, substormRiskResult] = results;

    if (forecastResult.status === 'fulfilled' && forecastResult.value) {
      const { currentForecast, historicalData, dailyHistory, owmDailyForecast, rawHistory } = forecastResult.value;
      const todayMoonPhase = Array.isArray(owmDailyForecast) && owmDailyForecast[0]?.moon_phase != null
        ? owmDailyForecast[0].moon_phase
        : null;
      const moonWaxing = todayMoonPhase != null ? todayMoonPhase < 0.5 : null;
      setCelestialTimes({
        sun: currentForecast?.sun,
        moon: currentForecast?.moon
          ? { ...currentForecast.moon, waxing: moonWaxing ?? undefined }
          : undefined,
      });

      const baseScore = currentForecast?.spotTheAuroraForecast ?? null;
      setBaseAuroraScore(baseScore);

      const rawAdjusted = baseScore !== null ? Math.max(0, Math.min(100, baseScore + locationAdjustment)) : null;
      // Compute daylight directly from the freshly received sun times rather than
      // relying on the isDaylight state, which may not have updated yet on first load.
      const freshSun = currentForecast?.sun;
      const nowTs = Date.now();
      const freshIsDaylight = freshSun?.rise && freshSun?.set
        ? (nowTs > freshSun.rise && nowTs < freshSun.set)
        : false;
      const initialAdjustedScore = freshIsDaylight ? 0 : rawAdjusted;
      setAuroraScore(initialAdjustedScore);
      setCurrentAuroraScore(initialAdjustedScore);

      setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`);
      if (Array.isArray(dailyHistory)) setDailyCelestialHistory(dailyHistory); else setDailyCelestialHistory([]);
      if (Array.isArray(owmDailyForecast)) setOwmDailyForecast(owmDailyForecast); else setOwmDailyForecast([]);
      setGaugeData((prev) => ({
        ...prev,
        power: { ...prev.power, value: currentForecast?.inputs?.hemisphericPower?.toFixed(1) ?? 'N/A', ...getGaugeStyle(currentForecast?.inputs?.hemisphericPower ?? null, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
        moon: getMoonData(currentForecast?.moon?.illumination ?? null, currentForecast?.moon?.rise ?? null, currentForecast?.moon?.set ?? null, owmDailyForecast || [])
      }));
      if (Array.isArray(historicalData)) setAuroraScoreHistory(historicalData.filter((d: any) => d.timestamp != null && d.baseScore != null).sort((a, b) => a.timestamp - b.timestamp)); else setAuroraScoreHistory([]);
      if (Array.isArray(rawHistory)) setHemisphericPowerHistory(rawHistory.filter((d: any) => d.timestamp && d.hemisphericPower && !isNaN(d.hemisphericPower)).map((d: RawHistoryRecord) => ({ timestamp: d.timestamp, hemisphericPower: d.hemisphericPower })).sort((a: any, b: any) => a.timestamp - b.timestamp)); else setHemisphericPowerHistory([]);
    }

    // ── Substorm Risk Worker ──────────────────────────────────────────────────
    // Non-blocking — a failure here never breaks the rest of the app.
    // The fetch uses .catch(() => null) so substormRiskResult is always
    // 'fulfilled' — the actual data or null is in .value directly.
    const substormRiskValue =
      substormRiskResult?.status === 'fulfilled'
        ? substormRiskResult.value
        : null;

    console.log('[SubstormWorker] substormRiskResult status:', substormRiskResult?.status);
    console.log('[SubstormWorker] substormRiskValue:', substormRiskValue === null ? 'null' : substormRiskValue === undefined ? 'undefined' : 'object with keys: ' + Object.keys(substormRiskValue));
    console.log('[SubstormWorker] Validation:', {
      notNull: substormRiskValue !== null && substormRiskValue !== undefined,
      okTrue: substormRiskValue?.ok === true,
      hasCurrents: substormRiskValue?.current != null,
      historyIsArray: Array.isArray(substormRiskValue?.history_24h),
      historyLength: Array.isArray(substormRiskValue?.history_24h) ? substormRiskValue.history_24h.length : 'n/a',
    });

    if (
      substormRiskValue !== null &&
      substormRiskValue !== undefined &&
      substormRiskValue?.ok === true &&
      substormRiskValue?.current != null &&
      Array.isArray(substormRiskValue?.history_24h)
    ) {
      console.log('[SubstormWorker] ✅ Setting substormRiskData');
      setSubstormRiskData(substormRiskValue as SubstormRiskData);
    } else {
      console.warn('[SubstormWorker] ❌ Validation failed — substormRiskData NOT set');
    }

    if (solarWindResult.status === 'fulfilled') {
      const solarWindPayload = solarWindResult.value;
      const solarWindRows = Array.isArray(solarWindPayload)
        ? solarWindPayload
        : (solarWindPayload?.ok && Array.isArray(solarWindPayload.data) ? solarWindPayload.data : []);
      if (Array.isArray(solarWindRows) && solarWindRows.length > 0) {

      const solarWindData = solarWindRows as Array<{
        time_utc?: string;
        time_nz?: string;
        speed?: number | null;
        density?: number | null;
        temp?: number | null;
        angle?: number | null;
        clock?: number | null;
        bt?: number | null;
        by?: number | null;
        bx?: number | null;
        bz?: number | null;
        src?: { speed?: string | null; density?: string | null; temp?: string | null; angle?: string | null; clock?: string | null; bt?: string | null; by?: string | null; bx?: string | null; bz?: string | null };
      }>;

      const speedPoints: { time: number; value: number; source: string }[] = [];
      const densityPoints: { time: number; value: number; source: string }[] = [];
      const tempPoints: { time: number; value: number; source: string }[] = [];
      const clockPoints: { time: number; value: number; source: string }[] = [];
      const magneticPoints: { time: number; bt: number; bz: number; by: number; bx: number; clock: number | null }[] = [];

      for (const entry of solarWindData) {
        const timeValue = entry.time_utc ?? entry.time_nz;
        const t = timeValue ? new Date(timeValue).getTime() : NaN;
        if (!Number.isFinite(t)) continue;

        const speedReading = pickSolarWindValue(entry, 'speed');
        if (speedReading.value !== null && speedReading.value >= 0) {
          speedPoints.push({ time: t, value: speedReading.value, source: speedReading.source });
        }
        const densityReading = pickSolarWindValue(entry, 'density');
        if (densityReading.value !== null && densityReading.value >= 0) {
          densityPoints.push({ time: t, value: densityReading.value, source: densityReading.source });
        }
        const tempReading = pickSolarWindValue(entry, 'temp');
        if (tempReading.value !== null && tempReading.value >= 0) {
          tempPoints.push({ time: t, value: tempReading.value, source: tempReading.source });
        }

        const byReading = pickSolarWindValue(entry, 'by');
        const bzReading = pickSolarWindValue(entry, 'bz');
        const bxReading = pickSolarWindValue(entry, 'bx');
        const clockReading = pickSolarWindValue(entry, 'clock');
        const btReading = pickSolarWindValue(entry, 'bt');

        const by = byReading.value;
        const bz = bzReading.value;
        const bx = bxReading.value;
        const clock = clockReading.value != null
          ? clockReading.value
          : (by != null && bz != null ? (Math.atan2(by, bz) * 180 / Math.PI + 360) % 360 : null);
        const computedBt = btReading.value != null
          ? btReading.value
          : (by != null && bz != null ? Math.sqrt(by ** 2 + bz ** 2) : null);

        if (clock != null) {
          clockPoints.push({
            time: t,
            value: clock,
            source: combineSources(
              clockReading.source,
              byReading.source,
              bzReading.source,
              getSourceLabel(entry.src?.clock ?? entry.src?.by ?? entry.src?.bz)
            ),
          });
        }

        if (computedBt != null && by != null && bz != null && computedBt >= 0) {
          magneticPoints.push({ time: t, bt: computedBt, by, bz, bx: bx ?? 0, clock });
        }
      }

      speedPoints.sort((a, b) => a.time - b.time);
      densityPoints.sort((a, b) => a.time - b.time);
      tempPoints.sort((a, b) => a.time - b.time);
      clockPoints.sort((a, b) => a.time - b.time);
      magneticPoints.sort((a, b) => a.time - b.time);

      setAllSpeedData(speedPoints.map(p => ({ x: p.time, y: p.value })));
      setAllDensityData(densityPoints.map(p => ({ x: p.time, y: p.value })));
      setAllTempData(tempPoints.map(p => ({ x: p.time, y: p.value })));
      setAllImfClockData(clockPoints.map(p => ({ x: p.time, y: p.value })));
      setAllMagneticData(magneticPoints);

      const latestSpeed = speedPoints.at(-1);
      const latestDensity = densityPoints.at(-1);
      const latestTemp = tempPoints.at(-1);
      const latestMagneticPoint = magneticPoints.at(-1);
      const latestMagEntry = [...solarWindRows].reverse().find((entry: any) => {
        const bt = pickSolarWindValue(entry, 'bt').value;
        const by = pickSolarWindValue(entry, 'by').value;
        const bz = pickSolarWindValue(entry, 'bz').value;
        return bt != null || by != null || bz != null;
      });
      const latestBtSource = latestMagEntry ? pickSolarWindValue(latestMagEntry, 'bt').source : '—';
      const latestBzSource = latestMagEntry ? pickSolarWindValue(latestMagEntry, 'bz').source : '—';

      setGaugeData(prev => ({
        ...prev,
        speed: latestSpeed
          ? { ...prev.speed, value: latestSpeed.value.toFixed(0), ...getGaugeStyle(latestSpeed.value, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(latestSpeed.time)}`, source: latestSpeed.source }
          : { ...prev.speed, value: 'N/A', lastUpdated: 'Updated: N/A', source: '—' },
        density: latestDensity
          ? { ...prev.density, value: latestDensity.value.toFixed(1), ...getGaugeStyle(latestDensity.value, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(latestDensity.time)}`, source: latestDensity.source }
          : { ...prev.density, value: 'N/A', lastUpdated: 'Updated: N/A', source: '—' },
        temp: latestTemp
          ? { ...prev.temp, value: latestTemp.value.toFixed(0), emoji: latestTemp.value > 600000 ? '🔥' : latestTemp.value > 250000 ? '🌡️' : '🧊', percentage: 0, color: '#38bdf8', lastUpdated: `Updated: ${formatNZTimestamp(latestTemp.time)}`, source: latestTemp.source }
          : { ...prev.temp, value: 'N/A', emoji: '❓', lastUpdated: 'Updated: N/A', source: '—' },
        bt: latestMagneticPoint
          ? { ...prev.bt, value: latestMagneticPoint.bt.toFixed(1), ...getGaugeStyle(latestMagneticPoint.bt, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(latestMagneticPoint.time)}`, source: latestBtSource }
          : { ...prev.bt, value: 'N/A', lastUpdated: 'Updated: N/A', source: '—' },
        bz: latestMagneticPoint
          ? { ...prev.bz, value: latestMagneticPoint.bz.toFixed(1), ...getGaugeStyle(latestMagneticPoint.bz, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(latestMagneticPoint.time)}`, source: latestBzSource }
          : { ...prev.bz, value: 'N/A', lastUpdated: 'Updated: N/A', source: '—' }
      }));
      }
    }

    let anyGoesDataFound = false;
    if (goes18Result.status === 'fulfilled' && Array.isArray(goes18Result.value)) {
      const processed = goes18Result.value.filter((d: any) => d.Hp != null && !isNaN(d.Hp)).map((d: any) => ({ time: parseNOAATime(d.time_tag), hp: d.Hp as number })).sort((a, b) => a.time - b.time);
      setGoes18Data(processed);
      if (processed.length > 0) anyGoesDataFound = true;
    }

    if (goes19Result.status === 'fulfilled' && Array.isArray(goes19Result.value)) {
      const processed = goes19Result.value.filter((d: any) => d.Hp != null && !isNaN(d.Hp)).map((d: any) => ({ time: parseNOAATime(d.time_tag), hp: d.Hp as number })).sort((a, b) => a.time - b.time);
      setGoes19Data(processed); if (processed.length > 0) anyGoesDataFound = true;
    }
    
    if (nzMagResult.status === 'fulfilled' && Array.isArray(nzMagResult.value) && nzMagResult.value.length > 0) {
        const processed = nzMagResult.value.map((series: any) => ({
            ...series,
            data: series.data.map((d: any) => ({ x: new Date(d.ts).getTime(), y: d.val }))
        }));
        setNzMagData(processed);
        setLoadingNzMag(null);
    } else {
        setLoadingNzMag('No NZ magnetometer data available.');
        if(nzMagResult.status === 'rejected') {
          console.error("GeoNet API Error:", nzMagResult.reason);
        } else if (nzMagResult.status === 'fulfilled' && (!Array.isArray(nzMagResult.value) || nzMagResult.value.length === 0)) {
            console.warn("GeoNet API returned empty or invalid data:", nzMagResult.value);
        }
    }

    if (!anyGoesDataFound) setLoadingMagnetometer('No valid GOES Magnetometer data available.'); else setLoadingMagnetometer(null);
    if (ipsResult.status === 'fulfilled' && Array.isArray(ipsResult.value)) setInterplanetaryShockData(ipsResult.value); else setInterplanetaryShockData([]);

    if (isInitialLoad) setIsLoading(false);
  }, [locationAdjustment, getMoonData, reportInitialProgress, setCurrentAuroraScore, setSubstormActivityStatus]);

  const activitySummary: ActivitySummary | null = useMemo(() => {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const recentHistory = auroraScoreHistory.filter(h => h.timestamp >= twentyFourHoursAgo);
    
    if (recentHistory.length === 0) {
      return null;
    }
    
    const highestScore = recentHistory.reduce((max, current) => {
        return current.finalScore > max.finalScore ? current : max;
    }, { finalScore: -1, timestamp: 0 });

    // --- MODIFICATION: Use nzMagSubstormEvents for the summary ---
    const substormEvents = nzMagSubstormEvents.map(event => ({
        start: event.start,
        end: event.end,
        peakProbability: 0, // Placeholder as this is historical data
        peakStatus: 'Detected' // Placeholder
    }));
    // --- END MODIFICATION ---

    return {
        highestScore: {
            finalScore: highestScore.finalScore,
            timestamp: highestScore.timestamp,
        },
        substormEvents,
    };
  }, [auroraScoreHistory, nzMagSubstormEvents]); // --- MODIFICATION: Added nzMagSubstormEvents dependency ---

  useEffect(() => {
    // Defer geolocation request so it doesn't fire immediately on page load,
    // which PageSpeed flags as a Best Practices violation. Using requestIdleCallback
    // (with setTimeout fallback) gives the browser time to finish initial paint first,
    // and avoids triggering the permission prompt before the user has oriented themselves.
    const requestLocation = () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const adjustment = calculateLocationAdjustment(position.coords.latitude, position.coords.longitude);
            setLocationAdjustment(adjustment);
            setUserLatitude(position.coords.latitude);
            setUserLongitude(position.coords.longitude);
            const direction = adjustment >= 0 ? 'south' : 'north';
            const distance = Math.abs(adjustment / 3 * 150);
            setLocationBlurb(`Forecast adjusted by ${adjustment.toFixed(1)}% for your location (${distance.toFixed(0)}km ${direction} of Greymouth).`);
            // Check if user is far outside NZ — approximate nearest point on NZ landmass
            // using a simple great-circle distance to Greymouth as proxy centre.
            const userLat = position.coords.latitude;
            const userLon = position.coords.longitude;
            const R = 6371;
            const dLat = (userLat - GREYMOUTH_LATITUDE) * Math.PI / 180;
            const dLon = (userLon - 171.21) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 + Math.cos(userLat * Math.PI/180) * Math.cos(GREYMOUTH_LATITUDE * Math.PI/180) * Math.sin(dLon/2)**2;
            const distanceFromNZ = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            setIsOutsideNZ(distanceFromNZ > 1000);
          },
          () => {
            setLocationBlurb('Location unavailable. Showing default forecast for Greymouth.');
            setLocationFailed(true);
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 1800000 }
        );
      } else {
        setLocationBlurb('Geolocation is not supported. Showing default forecast for Greymouth.');
      }
    };

    // Use requestIdleCallback when available, otherwise fall back to a 2s delay.
    // This prevents the geolocation prompt from firing during initial page load.
    let handle: number | ReturnType<typeof setTimeout>;
    if ('requestIdleCallback' in window) {
      handle = (window as any).requestIdleCallback(requestLocation, { timeout: 5000 });
      return () => (window as any).cancelIdleCallback(handle);
    } else {
      handle = setTimeout(requestLocation, 2000);
      return () => clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  }, []);

  useEffect(() => {
    if (baseAuroraScore !== null) {
      // Zero the displayed score during daylight — solar conditions don't matter
      // if the sun is up. The baseAuroraScore is preserved so it recovers at sunset.
      const adjustedScore = isDaylight
        ? 0
        : Math.max(0, Math.min(100, baseAuroraScore + locationAdjustment));
      setAuroraScore(adjustedScore);
      setCurrentAuroraScore(adjustedScore);
    }
  }, [locationAdjustment, baseAuroraScore, isDaylight, setCurrentAuroraScore]);

  // Keep history finalScore location-adjusted whenever location changes.
  // baseScore = raw Greymouth value (from server), finalScore = location-adjusted.
  useEffect(() => {
    if (locationAdjustment === 0) return; // no adjustment needed, server finalScore is already correct
    setAuroraScoreHistory(prev =>
      prev.map(d => ({
        ...d,
        finalScore: Math.max(0, Math.min(100, d.baseScore + locationAdjustment)),
      }))
    );
  }, [locationAdjustment]);

  useEffect(() => {
    const now = Date.now();
    const { sun } = celestialTimes;
    if (sun?.rise && sun?.set) {
      // If we have the user's GPS latitude, adjust the Greymouth-based sun times
      // to better reflect their actual sunrise/sunset. Sunset gets later as you
      // go south in NZ (higher absolute latitude = longer summer days / shorter
      // winter days). Approx ~1 min per degree of latitude difference.
      // This prevents showing a non-zero score to a user south of Greymouth
      // while isDaylight is still true based on Greymouth's sunset time.
      let rise = sun.rise;
      let set = sun.set;
      if (userLatitude !== null) {
        const latDiff = userLatitude - GREYMOUTH_LATITUDE; // negative = further south
        const adjustMs = latDiff * 60 * 1000; // ~1 min per degree
        rise = sun.rise + adjustMs;
        set  = sun.set  - adjustMs; // further south = later sunset (subtract negative = add)
      }
      setIsDaylight(now > rise && now < set);
    } else {
      setIsDaylight(false);
    }
  }, [celestialTimes, lastUpdated, userLatitude]);

  return {
    isLoading,
    auroraScore,
    lastUpdated,
    gaugeData,
    celestialTimes,
    isDaylight,
    allSpeedData,
    allDensityData,
    allTempData,
    allImfClockData,
    allMagneticData,
    goes18Data,
    goes19Data,
    loadingMagnetometer,
    nzMagData, 
    loadingNzMag, 
    nzMagSubstormEvents, // NEW
    substormForecast,
    substormRiskData,
    auroraScoreHistory,
    hemisphericPowerHistory,
    dailyCelestialHistory,
    owmDailyForecast,
    interplanetaryShockData,
    locationBlurb,
    userLatitude,
    userLongitude,
    locationFailed,
    isOutsideNZ,
    fetchAllData,
    activitySummary,
  };

};
//--- END OF FILE src/hooks/useForecastData.ts ---
