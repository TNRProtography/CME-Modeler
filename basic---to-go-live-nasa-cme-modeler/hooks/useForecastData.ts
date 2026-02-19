//--- START OF FILE src/hooks/useForecastData.ts ---

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SubstormActivity,
  SubstormForecast,
  ActivitySummary,
} from '../types';

// --- Type Definitions ---
interface CelestialTimeData {
  moon?: { rise: number | null, set: number | null, illumination?: number };
  sun?: { rise: number | null, set: number | null };
}

interface DailyHistoryEntry {
  date: string;
  sun?: { rise: number | null, set: number | null };
  moon?: { rise: number | null, set: number | null, illumination?: number };
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

type Status = "QUIET" | "WATCH" | "LIKELY_60" | "IMMINENT_30" | "ONSET";

// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
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
  const fracSouth = sub.filter(bz => bz <= -3).length / sub.length;
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
  const P60 = Math.min(0.9, Math.max(0.01, 0.25 + 0.6 * base + bzBoost));
  const P30 = Math.min(0.9, Math.max(0.01, 0.15 + 0.7 * base + bzBoost));
  return { P30, P60 };
}

const calculateLocationAdjustment = (userLat: number): number => {
  const isNorthOfGreymouth = userLat > GREYMOUTH_LATITUDE;
  const R = 6371;
  const dLat = (userLat - GREYMOUTH_LATITUDE) * (Math.PI / 180);
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

const fetchJsonWithRecovery = async (url: string) => {
  const response = await fetch(url);
  const raw = await response.text();
  const parsed = parseJsonWithRowRecovery(raw);
  if (parsed === null) {
    throw new Error(`Unable to parse JSON from ${url}`);
  }
  return parsed;
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
  const [substormForecast, setSubstormForecast] = useState<SubstormForecast>({
    status: 'QUIET',
    likelihood: 0,
    windowLabel: '30 – 90 min',
    action: 'Low chance for now.',
    p30: 0,
    p60: 0,
  });
  const [nzMagSubstormEvents, setNzMagSubstormEvents] = useState<NzMagEvent[]>([]); // NEW

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
      const volatility = recentData.some((p: any) => Math.abs(p.y) > 5);
      return volatility;
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
      withInitialProgress(fetchJsonWithRecovery(`${NASA_IPS_URL}?_=${Date.now()}`), 'ipsApi'),
      withInitialProgress(fetchJsonWithRecovery(nzMagUrl), 'nzMagApi')
    ]);
    const [forecastResult, solarWindResult, goes18Result, goes19Result, ipsResult, nzMagResult] = results;

    if (forecastResult.status === 'fulfilled' && forecastResult.value) {
      const { currentForecast, historicalData, dailyHistory, owmDailyForecast, rawHistory } = forecastResult.value;
      setCelestialTimes({ moon: currentForecast?.moon, sun: currentForecast?.sun });

      const baseScore = currentForecast?.spotTheAuroraForecast ?? null;
      setBaseAuroraScore(baseScore);

      const initialAdjustedScore = baseScore !== null ? Math.max(0, Math.min(100, baseScore + locationAdjustment)) : null;
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

        if (Number.isFinite(entry.speed ?? NaN) && (entry.speed ?? 0) >= 0) {
          speedPoints.push({ time: t, value: entry.speed as number, source: getSourceLabel(entry.src?.speed) });
        }
        if (Number.isFinite(entry.density ?? NaN) && (entry.density ?? 0) >= 0) {
          densityPoints.push({ time: t, value: entry.density as number, source: getSourceLabel(entry.src?.density) });
        }
        if (Number.isFinite(entry.temp ?? NaN) && (entry.temp ?? 0) >= 0) {
          tempPoints.push({ time: t, value: entry.temp as number, source: getSourceLabel(entry.src?.temp) });
        }

        const by = Number.isFinite(entry.by ?? NaN) ? (entry.by as number) : null;
        const bz = Number.isFinite(entry.bz ?? NaN) ? (entry.bz as number) : null;
        const bx = Number.isFinite(entry.bx ?? NaN) ? (entry.bx as number) : null;
        const clock = Number.isFinite(entry.clock ?? NaN)
          ? (entry.clock as number)
          : (by != null && bz != null ? (Math.atan2(by, bz) * 180 / Math.PI + 360) % 360 : null);
        const computedBt = Number.isFinite(entry.bt ?? NaN)
          ? (entry.bt as number)
          : (by != null && bz != null ? Math.sqrt(by ** 2 + bz ** 2) : null);

        if (clock != null) {
          clockPoints.push({ time: t, value: clock, source: getSourceLabel(entry.src?.clock ?? entry.src?.by ?? entry.src?.bz) });
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
      const latestMagEntry = [...solarWindRows].reverse().find((entry: any) => entry && (entry.bt != null || entry.bz != null || entry.by != null));
      const latestMagSource = latestMagEntry?.src;

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
          ? { ...prev.bt, value: latestMagneticPoint.bt.toFixed(1), ...getGaugeStyle(latestMagneticPoint.bt, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(latestMagneticPoint.time)}`, source: getSourceLabel(latestMagSource?.bt) }
          : { ...prev.bt, value: 'N/A', lastUpdated: 'Updated: N/A', source: '—' },
        bz: latestMagneticPoint
          ? { ...prev.bz, value: latestMagneticPoint.bz.toFixed(1), ...getGaugeStyle(latestMagneticPoint.bz, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(latestMagneticPoint.time)}`, source: getSourceLabel(latestMagSource?.bz) }
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
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const adjustment = calculateLocationAdjustment(position.coords.latitude);
          setLocationAdjustment(adjustment);
          const direction = adjustment >= 0 ? 'south' : 'north';
          const distance = Math.abs(adjustment / 3 * 150);
          setLocationBlurb(`Forecast adjusted by ${adjustment.toFixed(1)}% for your location (${distance.toFixed(0)}km ${direction} of Greymouth).`);
        },
        () => {
          setLocationBlurb('Location unavailable. Showing default forecast for Greymouth.');
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 1800000 }
      );
    } else {
      setLocationBlurb('Geolocation is not supported. Showing default forecast for Greymouth.');
    }
  }, []);

  useEffect(() => {
    if (baseAuroraScore !== null) {
      const adjustedScore = Math.max(0, Math.min(100, baseAuroraScore + locationAdjustment));
      setAuroraScore(adjustedScore);
      setCurrentAuroraScore(adjustedScore);
    }
  }, [locationAdjustment, baseAuroraScore, setCurrentAuroraScore]);

  useEffect(() => {
    const now = Date.now();
    const { sun } = celestialTimes;
    if (sun?.rise && sun?.set) {
      setIsDaylight(now > sun.rise && now < sun.set);
    } else {
      setIsDaylight(false);
    }
  }, [celestialTimes, lastUpdated]);

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
    auroraScoreHistory,
    hemisphericPowerHistory,
    dailyCelestialHistory,
    owmDailyForecast,
    interplanetaryShockData,
    locationBlurb,
    fetchAllData,
    activitySummary,
  };

};
//--- END OF FILE src/hooks/useForecastData.ts ---
