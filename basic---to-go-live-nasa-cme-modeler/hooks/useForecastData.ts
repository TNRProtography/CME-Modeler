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

type Status = "QUIET" | "WATCH" | "LIKELY_60" | "IMMINENT_30" | "ONSET";


// --- Constants ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
// THESE ARE THE CORRECT, MODERN NOAA URLs
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/json/solar-wind/plasma.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/json/solar-wind/mag.json';
const NOAA_GOES18_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json';
const NOAA_GOES19_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/secondary/magnetometers-1-day.json';
const NASA_IPS_URL = 'https://spottheaurora.thenamesrock.workers.dev/ips';
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

const formatNZTimestamp = (timestamp: number | string) => {
try {
const d = new Date(timestamp);
return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', dateStyle: 'short', timeStyle: 'short' });
} catch {
return "Invalid Date";
}
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
    const caretPath = `M19.5 8.25l-7.5 7.5-7.5-7.5`;
    const upSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle" style="transform: rotate(180deg);"><path stroke-linecap="round" stroke-linejoin="round" d="${caretPath}" /></svg>`;
    const downSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle"><path stroke-linecap="round" stroke-linejoin="round" d="${caretPath}" /></svg>`;
    const value = `<span class="text-xl">${moonIllumination.toFixed(0)}%</span><br/><span class='text-xs'>${upSVG} ${riseStr}   ${downSVG} ${setStr}</span>`;
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

useEffect(() => {
    if (!recentL1Data) return;

    const probs = probabilityModel(recentL1Data.dPhiNow, recentL1Data.dPhiMean15, recentL1Data.bzMean15);
    const P30_ALERT = 0.60, P60_ALERT = 0.60;
    let status: Status = 'QUIET';

    if (goesOnset) {
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

    let action = 'Low chance for now.';
    if (status === "ONSET") action = "Look now — activity is underway.";
    else if (status === "IMMINENT_30" || likelihood >= 65) action = "Head outside or to a darker spot now.";
    else if (status === "LIKELY_60" || likelihood >= 50) action = "Prepare to go; check the sky within the next hour.";
    else if (status === "WATCH") action = "Energy is building in Earth's magnetic field. The forecast will upgrade to an Alert if an eruption becomes likely.";

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

}, [recentL1Data, goesOnset, auroraScore, setSubstormActivityStatus]);

const fetchAllData = useCallback(async (isInitialLoad = false, getGaugeStyle: Function) => {
    if (isInitialLoad) setIsLoading(true);
    const results = await Promise.allSettled([
        fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then(res => res.json()),
        fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then(res => res.json()),
        fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
        fetch(`${NOAA_GOES18_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
        fetch(`${NOAA_GOES19_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
        fetch(`${NASA_IPS_URL}?_=${Date.now()}`).then(res => res.json())
    ]);
    const [forecastResult, plasmaResult, magResult, goes18Result, goes19Result, ipsResult] = results;
    
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
            bt: { ...prev.bt, value: bt?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bt, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`},
            bz: { ...prev.bz, value: bz?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bz, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`},
            power: { ...prev.power, value: currentForecast?.inputs?.hemisphericPower?.toFixed(1) ?? 'N/A', ...getGaugeStyle(currentForecast?.inputs?.hemisphericPower ?? null, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`},
            moon: getMoonData(currentForecast?.moon?.illumination ?? null, currentForecast?.moon?.rise ?? null, currentForecast?.moon?.set ?? null, owmDailyForecast || []) 
        }));
        if (Array.isArray(historicalData)) setAuroraScoreHistory(historicalData.filter((d: any) => d.timestamp != null && d.baseScore != null).sort((a, b) => a.timestamp - b.timestamp)); else setAuroraScoreHistory([]);
        if (Array.isArray(rawHistory)) setHemisphericPowerHistory(rawHistory.filter((d: any) => d.timestamp && d.hemisphericPower && !isNaN(d.hemisphericPower)).map((d: RawHistoryRecord) => ({ timestamp: d.timestamp, hemisphericPower: d.hemisphericPower })).sort((a:any, b:any) => a.timestamp - b.timestamp)); else setHemisphericPowerHistory([]);
    }

    if (plasmaResult.status === 'fulfilled' && Array.isArray(plasmaResult.value)) {
        const plasmaData = plasmaResult.value;
        const processed = plasmaData
            .map((row: any) => {
                const speed = row.speed ? parseFloat(row.speed) : null;
                const density = row.density ? parseFloat(row.density) : null;
                if (!row.time_tag || speed === null || density === null || speed < 0 || density < 0) return null;
                return {
                    // FINAL FIX: Ensure timestamp is parsed as UTC by appending 'Z'
                    time: new Date(row.time_tag + 'Z').getTime(),
                    speed,
                    density
                };
            })
            .filter((p): p is NonNullable<typeof p> => p !== null);

        const sortedForCharts = [...processed].sort((a,b) => a.time - b.time);
        setAllSpeedData(sortedForCharts.map(p => ({ x: p.time, y: p.speed })));
        setAllDensityData(sortedForCharts.map(p => ({ x: p.time, y: p.density })));
        
        const latest = processed[0]; // The API returns newest first.
        if (latest) {
            setGaugeData((prev) => ({
                ...prev,
                speed: { ...prev.speed, value: latest.speed.toFixed(1), ...getGaugeStyle(latest.speed, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(latest.time)}` },
                density: { ...prev.density, value: latest.density.toFixed(1), ...getGaugeStyle(latest.density, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(latest.time)}` }
            }));
        }
    }

    if (magResult.status === 'fulfilled' && Array.isArray(magResult.value)) {
        const magData = magResult.value;
        const processed = magData
            .map((row: any) => {
                const bt = row.bt ? parseFloat(row.bt) : null;
                const bz = row.bz_gsm ? parseFloat(row.bz_gsm) : null;
                const by = row.by_gsm ? parseFloat(row.by_gsm) : null;
                if (!row.time_tag || bt === null || bz === null || by === null || bt < 0) return null;
                return {
                    // FINAL FIX: Ensure timestamp is parsed as UTC by appending 'Z'
                    time: new Date(row.time_tag + 'Z').getTime(),
                    bt,
                    bz,
                    by
                };
            })
            .filter((p): p is NonNullable<typeof p> => p !== null);

        const sortedForCharts = [...processed].sort((a,b) => a.time - b.time);
        setAllMagneticData(sortedForCharts);
    }

    let anyGoesDataFound = false;
    if (goes18Result.status === 'fulfilled' && Array.isArray(goes18Result.value)) {
        const processed = goes18Result.value.filter((d: any) => d.Hp != null && !isNaN(d.Hp)).map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp })).sort((a, b) => a.time - b.time);
        setGoes18Data(processed);
        if (processed.length > 0) anyGoesDataFound = true;
    }

    if (goes19Result.status === 'fulfilled' && Array.isArray(goes19Result.value)) {
        const processed = goes19Result.value.filter((d: any) => d.Hp != null && !isNaN(d.Hp)).map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp })).sort((a, b) => a.time - b.time);
        setGoes19Data(processed); if (processed.length > 0) anyGoesDataFound = true;
    }

    if (!anyGoesDataFound) setLoadingMagnetometer('No valid GOES Magnetometer data available.'); else setLoadingMagnetometer(null);
    if (ipsResult.status === 'fulfilled' && Array.isArray(ipsResult.value)) setInterplanetaryShockData(ipsResult.value); else setInterplanetaryShockData([]);
    
    if (isInitialLoad) setIsLoading(false);
}, [locationAdjustment, getMoonData, setCurrentAuroraScore, setSubstormActivityStatus]);

const activitySummary: ActivitySummary | null = useMemo(() => {
    const now = Date.now();
    const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
    const recentHistory = auroraScoreHistory.filter(h => h.timestamp >= twentyFourHoursAgo);
    if (recentHistory.length === 0) { return null; }
    const highestScore = recentHistory.reduce((max, current) => { return current.finalScore > max.finalScore ? current : max; }, { finalScore: -1, timestamp: 0 });
    const substormEvents: ActivitySummary['substormEvents'] = [];
    let currentEvent: ActivitySummary['substormEvents'][0] | null = null;
    const SUBSTORM_PROXY_THRESHOLD = 30;
    recentHistory.forEach((point, index) => {
        const isWatchCondition = point.baseScore >= SUBSTORM_PROXY_THRESHOLD;
        if (isWatchCondition && !currentEvent) {
            currentEvent = { start: point.timestamp, end: point.timestamp, peakProbability: 0, peakStatus: 'WATCH' };
        } else if (isWatchCondition && currentEvent) {
            currentEvent.end = point.timestamp;
        } else if (!isWatchCondition && currentEvent) {
            substormEvents.push(currentEvent);
            currentEvent = null;
        }
        if (index === recentHistory.length - 1 && currentEvent) {
            substormEvents.push(currentEvent);
        }
    });
    return { highestScore: { finalScore: highestScore.finalScore, timestamp: highestScore.timestamp, }, substormEvents, };
}, [auroraScoreHistory]);


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