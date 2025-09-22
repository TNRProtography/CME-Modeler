//--- START OF FILE src/hooks/useForecastData.ts ---

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SubstormActivity,
  SubstormForecast,
  ActivitySummary,
  InterplanetaryShock, // Import the type
} from '../types';
import { fetchIPSData } from '../services/nasaService'; // Import the new fetch function

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

export interface NzMagEvent {
    start: number;
    end: number;
    maxDelta: number;
}

type Status = "QUIET" | "WATCH" | "LIKELY_60" | "IMMINENT_30" | "ONSET";

// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const NOAA_GOES18_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json';
const NOAA_GOES19_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/secondary/magnetometers-1-day.json';
const GEONET_API_URL = 'https://tilde.geonet.org.nz/v4/data';
const GREYMOUTH_LATITUDE = -42.45;

// --- Physics and Model Helpers (Unchanged) ---
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
  setSubstormActivityStatus: (status: SubstormActivity | null) => void
) => {
  const [isLoading, setIsLoading] = useState(true);
  const [auroraScore, setAuroraScore] = useState<number | null>(null);
  const [baseAuroraScore, setBaseAuroraScore] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('Loading...');
  const [gaugeData, setGaugeData] = useState<Record<string, { value: string; unit: string; emoji: string; percentage: number; lastUpdated: string; color: string }>>({
    bt: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    bz: { value: '...', unit: 'nT', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    power: { value: '...', unit: 'GW', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    moon: { value: '...', unit: '%', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    speed: { value: '...', unit: 'km/s', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    density: { value: '...', unit: 'p/cm³', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
  });
  const [celestialTimes, setCelestialTimes] = useState<CelestialTimeData>({});
  const [isDaylight, setIsDaylight] = useState(false);
  const [allSpeedData, setAllSpeedData] = useState<any[]>([]);
  const [allDensityData, setAllDensityData] = useState<any[]>([]);
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
  
  // --- NEW: State for Interplanetary Shock Data ---
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
  const [nzMagSubstormEvents, setNzMagSubstormEvents] = useState<NzMagEvent[]>([]);

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

  useMemo(() => {
    if (!nzMagData.length || !nzMagData[0]?.data) {
        setNzMagSubstormEvents([]);
        return;
    }
    const data = nzMagData[0].data;
    const events: NzMagEvent[] = [];
    let currentEvent: NzMagEvent | null = null;
    const THRESHOLD = 5;
    const COOLDOWN_MINS = 10;
    for (const point of data) {
        const isVolatile = Math.abs(point.y) >= THRESHOLD;
        if (isVolatile && !currentEvent) {
            currentEvent = { start: point.x, end: point.x, maxDelta: Math.abs(point.y) };
        } else if (isVolatile && currentEvent) {
            currentEvent.end = point.x;
            currentEvent.maxDelta = Math.max(currentEvent.maxDelta, Math.abs(point.y));
        } else if (!isVolatile && currentEvent) {
            if (point.x - currentEvent.end > COOLDOWN_MINS * 60 * 1000) {
                events.push(currentEvent);
                currentEvent = null;
            }
        }
    }
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
    
    // --- MODIFICATION: Added fetchIPSData to the promise chain ---
    const results = await Promise.allSettled([
      fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then(res => res.json()),
      fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then(res => res.json()),
      fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
      fetch(`${NOAA_GOES18_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
      fetch(`${NOAA_GOES19_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
      fetchIPSData(), // NEW: Fetch IPS data
      fetch(nzMagUrl).then(res => res.json())
    ]);
    const [forecastResult, plasmaResult, magResult, goes18Result, goes19Result, ipsResult, nzMagResult] = results;
    
    // ... (rest of the data processing is mostly unchanged)
    if (ipsResult.status === 'fulfilled' && Array.isArray(ipsResult.value)) {
        setInterplanetaryShockData(ipsResult.value);
    } else {
        setInterplanetaryShockData([]);
    }
    
    // (The rest of the `fetchAllData` function remains the same as your previous version)
    if (forecastResult.status === 'fulfilled' && forecastResult.value) {
      const { currentForecast, historicalData, dailyHistory, owmDailyForecast, rawHistory } = forecastResult.value;
      setCelestialTimes({ moon: currentForecast?.moon, sun: currentForecast?.sun });
      const baseScore = currentForecast?.spotTheAuroraForecast ?? null;
      setBaseAuroraScore(baseScore);
      const initialAdjustedScore = baseScore !== null ? Math.max(0, Math.min(100, baseScore + locationAdjustment)) : null;
      setAuroraScore(initialAdjustedScore);
      setCurrentAuroraScore(initialAdjustedScore);
      setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`);
      const { bt, bz } = currentForecast?.inputs?.magneticField ?? {};
      if (Array.isArray(dailyHistory)) setDailyCelestialHistory(dailyHistory); else setDailyCelestialHistory([]);
      if (Array.isArray(owmDailyForecast)) setOwmDailyForecast(owmDailyForecast); else setOwmDailyForecast([]);
      setGaugeData((prev) => ({
        ...prev,
        bt: { ...prev.bt, value: bt?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bt, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
        bz: { ...prev.bz, value: bz?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bz, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
        power: { ...prev.power, value: currentForecast?.inputs?.hemisphericPower?.toFixed(1) ?? 'N/A', ...getGaugeStyle(currentForecast?.inputs?.hemisphericPower ?? null, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
        moon: getMoonData(currentForecast?.moon?.illumination ?? null, currentForecast?.moon?.rise ?? null, currentForecast?.moon?.set ?? null, owmDailyForecast || [])
      }));
      if (Array.isArray(historicalData)) setAuroraScoreHistory(historicalData.filter((d: any) => d.timestamp != null && d.baseScore != null).sort((a, b) => a.timestamp - b.timestamp)); else setAuroraScoreHistory([]);
      if (Array.isArray(rawHistory)) setHemisphericPowerHistory(rawHistory.filter((d: any) => d.timestamp && d.hemisphericPower && !isNaN(d.hemisphericPower)).map((d: RawHistoryRecord) => ({ timestamp: d.timestamp, hemisphericPower: d.hemisphericPower })).sort((a: any, b: any) => a.timestamp - b.timestamp)); else setHemisphericPowerHistory([]);
    }
    if (plasmaResult.status === 'fulfilled' && Array.isArray(plasmaResult.value) && plasmaResult.value.length > 1) {
      const plasmaData = plasmaResult.value;
      const header = plasmaData[0];
      const dataRows = plasmaData.slice(1);
      const timeIndex = header.indexOf('time_tag');
      const speedIndex = header.indexOf('speed');
      const densityIndex = header.indexOf('density');
      if (timeIndex !== -1 && speedIndex !== -1 && densityIndex !== -1) {
          const speedPoints: { time: number; value: number }[] = [];
          const densityPoints: { time: number; value: number }[] = [];
          for (const row of dataRows) {
              const t = parseNOAATime(row[timeIndex]);
              const s = (row[speedIndex] === null) ? NaN : Number(row[speedIndex]);
              const n = (row[densityIndex] === null) ? NaN : Number(row[densityIndex]);
              if (Number.isFinite(t)) {
                  if (Number.isFinite(s) && s >= 0) speedPoints.push({ time: t, value: s });
                  if (Number.isFinite(n) && n >= 0) densityPoints.push({ time: t, value: n });
              }
          }
          speedPoints.sort((a, b) => a.time - b.time);
          densityPoints.sort((a, b) => a.time - b.time);
          setAllSpeedData(speedPoints.map(p => ({ x: p.time, y: p.value })));
          setAllDensityData(densityPoints.map(p => ({ x: p.time, y: p.value })));
          const latestSpeed = speedPoints.at(-1);
          const latestDensity = densityPoints.at(-1);
          setGaugeData(prev => ({
              ...prev,
              speed: latestSpeed ? { ...prev.speed, value: latestSpeed.value.toFixed(0), ...getGaugeStyle(latestSpeed.value, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(latestSpeed.time)}` } : { ...prev.speed, value: 'N/A', lastUpdated: 'Updated: N/A' },
              density: latestDensity ? { ...prev.density, value: latestDensity.value.toFixed(1), ...getGaugeStyle(latestDensity.value, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(latestDensity.time)}` } : { ...prev.density, value: 'N/A', lastUpdated: 'Updated: N/A' }
          }));
      }
    }
    if (magResult.status === 'fulfilled' && Array.isArray(magResult.value) && magResult.value.length > 1) {
        const magData = magResult.value;
        const header = magData[0];
        const dataRows = magData.slice(1);
        const timeIndex = header.indexOf('time_tag');
        const btIndex = header.indexOf('bt');
        const bzIndex = header.indexOf('bz_gsm');
        const byIndex = header.indexOf('by_gsm');
        if (timeIndex !== -1 && btIndex !== -1 && bzIndex !== -1 && byIndex !== -1) {
            const processed = dataRows
                .map((row: any) => {
                    const t = parseNOAATime(row[timeIndex]);
                    const bt = row[btIndex] === null ? NaN : Number(row[btIndex]);
                    const bz = row[bzIndex] === null ? NaN : Number(row[bzIndex]);
                    const by = row[byIndex] === null ? NaN : Number(row[byIndex]);
                    if (!Number.isFinite(t) || !Number.isFinite(bt) || !Number.isFinite(bz) || !Number.isFinite(by) || bt < 0) return null;
                    return { time: t, bt, bz, by };
                })
                .filter((p): p is NonNullable<typeof p> => p !== null);
            const sortedForCharts = [...processed].sort((a, b) => a.time - b.time);
            setAllMagneticData(sortedForCharts);
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
        const processed = nzMagResult.value.map((series: any) => ({ ...series, data: series.data.map((d: any) => ({ x: new Date(d.ts).getTime(), y: d.val })) }));
        setNzMagData(processed);
        setLoadingNzMag(null);
    } else {
        setLoadingNzMag('No NZ magnetometer data available.');
        if(nzMagResult.status === 'rejected') console.error("GeoNet API Error:", nzMagResult.reason);
        else if (nzMagResult.status === 'fulfilled' && (!Array.isArray(nzMagResult.value) || nzMagResult.value.length === 0)) console.warn("GeoNet API returned empty or invalid data:", nzMagResult.value);
    }
    if (!anyGoesDataFound) setLoadingMagnetometer('No valid GOES Magnetometer data available.'); else setLoadingMagnetometer(null);
    if (isInitialLoad) setIsLoading(false);
  }, [locationAdjustment, getMoonData, setCurrentAuroraScore, setSubstormActivityStatus]);
  
  // --- MODIFICATION: Updated ActivitySummary to include the latest shock ---
  const activitySummary: ActivitySummary | null = useMemo(() => {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const recentHistory = auroraScoreHistory.filter(h => h.timestamp >= twentyFourHoursAgo);
    if (recentHistory.length === 0) { return null; }
    const highestScore = recentHistory.reduce((max, current) => { return current.finalScore > max.finalScore ? current : max; }, { finalScore: -1, timestamp: 0 });
    
    const recentShocks = interplanetaryShockData
        .filter(s => new Date(s.eventTime).getTime() >= twentyFourHoursAgo)
        .sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime());

    return { 
        highestScore: { finalScore: highestScore.finalScore, timestamp: highestScore.timestamp }, 
        substormEvents: nzMagSubstormEvents,
        latestShock: recentShocks.length > 0 ? recentShocks[0] : null,
    };
  }, [auroraScoreHistory, nzMagSubstormEvents, interplanetaryShockData]);

  // --- NEW: Function to generate chart annotations for IPS ---
  const getIPSAnnotations = useCallback((timeRangeMs: number) => {
    const now = Date.now();
    const startTime = now - timeRangeMs;
    const annotations: any = {};
    const recentShocks = interplanetaryShockData.filter(s => {
        const shockTime = new Date(s.eventTime).getTime();
        return shockTime >= startTime && shockTime <= now;
    });

    if (recentShocks.length > 0) {
        recentShocks.forEach(shock => {
            const shockTime = new Date(shock.eventTime).getTime();
            annotations[`shock-${shock.activityID}`] = {
                type: 'line',
                xMin: shockTime,
                xMax: shockTime,
                borderColor: 'rgba(255, 69, 0, 0.8)',
                borderWidth: 2,
                borderDash: [10, 5],
                label: {
                    content: `Shock Arrival`,
                    display: true,
                    position: 'start',
                    backgroundColor: 'rgba(255, 69, 0, 0.7)',
                    color: 'white',
                    font: { weight: 'bold', size: 10 },
                    yAdjust: -15,
                }
            };
        });
    }
    return annotations;
  }, [interplanetaryShockData]);
  
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
    allMagneticData,
    goes18Data,
    goes19Data,
    loadingMagnetometer,
    nzMagData, 
    loadingNzMag, 
    nzMagSubstormEvents,
    substormForecast,
    auroraScoreHistory,
    hemisphericPowerHistory,
    dailyCelestialHistory,
    owmDailyForecast,
    interplanetaryShockData,
    locationBlurb,
    fetchAllData,
    activitySummary,
    getIPSAnnotations, // Expose the new function
  };

};
//--- END OF FILE src/hooks/useForecastData.ts ---