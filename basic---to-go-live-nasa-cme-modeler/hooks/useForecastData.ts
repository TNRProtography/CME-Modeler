// --- START OF FILE src/hooks/useForecastData.ts ---

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  SubstormActivity,
  SightingReport,
} from '../types';

// --- Type Definitions (copied from the top of ForecastDashboard) ---
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

// --- Constants (copied from ForecastDashboard) ---
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const NOAA_GOES18_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json';
const NOAA_GOES19_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/secondary/magnetometers-1-day.json';
const NASA_IPS_URL = 'https://spottheaurora.thenamesrock.workers.dev/ips';
const REFRESH_INTERVAL_MS = 60 * 1000;
const GREYMOUTH_LATITUDE = -42.45;

// Helper functions (copied from ForecastDashboard)
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
    const [goes18Data, setGoes18Data] = useState<any[]>([]);
    const [goes19Data, setGoes19Data] = useState<any[]>([]);
    const [loadingMagnetometer, setLoadingMagnetometer] = useState<string | null>('Loading data...');
    const [substormBlurb, setSubstormBlurb] = useState<{ text: string; color: string }>({ text: 'Analyzing magnetic field stability...', color: 'text-neutral-400' });
    const [auroraScoreHistory, setAuroraScoreHistory] = useState<{ timestamp: number; baseScore: number; finalScore: number; }[]>([]);
    const [hemisphericPowerHistory, setHemisphericPowerHistory] = useState<{ timestamp: number; hemisphericPower: number; }[]>([]);
    const [dailyCelestialHistory, setDailyCelestialHistory] = useState<DailyHistoryEntry[]>([]);
    const [owmDailyForecast, setOwmDailyForecast] = useState<OwmDailyForecastEntry[]>([]);
    const [interplanetaryShockData, setInterplanetaryShockData] = useState<InterplanetaryShock[]>([]);
    const [locationAdjustment, setLocationAdjustment] = useState<number>(0);
    const [locationBlurb, setLocationBlurb] = useState<string>('Getting location for a more accurate forecast...');
    const [stretchingPhaseStartTime, setStretchingPhaseStartTime] = useState<number | null>(null);
    const previousSubstormStatusRef = useRef<string | null>(null);

    // This remains to pass notifications up to App.tsx
    const previousAuroraScoreRef = useRef<number | null>(null);

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

    const analyzeMagnetometerData = useCallback((data: any[], currentAdjustedScore: number | null, getGaugeStyle: Function) => {
        const prevSubstormStatusText = previousSubstormStatusRef.current;
        if (data.length < 30) {
            const status: SubstormActivity = { text: 'Awaiting more magnetic field data...', color: 'text-neutral-500', isStretching: false, isErupting: false };
            setSubstormBlurb(status);
            setSubstormActivityStatus(status);
            setStretchingPhaseStartTime(null);
            return;
        }

        const latestPoint = data[data.length - 1];
        const tenMinAgoPoint = data.find((p: any) => p.time >= latestPoint.time - 600000);
        const oneHourAgoPoint = data.find((p: any) => p.time >= latestPoint.time - 3600000);

        if (!latestPoint || !tenMinAgoPoint || !oneHourAgoPoint || isNaN(latestPoint.hp) || isNaN(tenMinAgoPoint.hp) || isNaN(oneHourAgoPoint.hp)) {
            const status: SubstormActivity = { text: 'Analyzing magnetic field stability...', color: 'text-neutral-400', isStretching: false, isErupting: false };
            setSubstormBlurb(status);
            setSubstormActivityStatus(status);
            return;
        }

        const jump = latestPoint.hp - tenMinAgoPoint.hp;
        const drop = latestPoint.hp - oneHourAgoPoint.hp;
        const isErupting = jump > 20;
        const isStretching = drop < -15;

        let newStatusText: string, newStatusColor: string, shouldNotify = false;
        let newStretchingStartTime = stretchingPhaseStartTime;
        let finalSubstormActivity: SubstormActivity;

        if (isErupting) {
            const eruptionTime = new Date(latestPoint.time).toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
            newStatusText = `Substorm signature detected at ${eruptionTime}! A sharp field increase suggests a recent or ongoing eruption. Look south!`;
            newStatusColor = 'text-green-400 font-bold animate-pulse';
            newStretchingStartTime = null;
            finalSubstormActivity = { text: newStatusText, color: newStatusColor, isErupting: true, isStretching: false };
        } else if (isStretching) {
            let probability = 0;
            let predictedStart, predictedEnd;
            if (stretchingPhaseStartTime === null) {
                newStretchingStartTime = latestPoint.time;
                newStatusText = 'The magnetic field has begun stretching, storing energy for a potential substorm.';
            } else {
                const durationMinutes = (latestPoint.time - stretchingPhaseStartTime) / 60000;
                const baseProbability = Math.min(80, Math.max(20, 20 + (durationMinutes - 30) * (60 / 90)));
                const dropBonus = Math.min(15, Math.max(0, (Math.abs(drop) - 15)));
                const auroraScoreMultiplier = currentAdjustedScore ? Math.min(1.25, Math.max(1.0, 1 + (currentAdjustedScore - 40) * (0.25 / 40))) : 1.0;
                probability = Math.min(95, (baseProbability + dropBonus) * auroraScoreMultiplier);
                predictedStart = new Date(stretchingPhaseStartTime + 60 * 60 * 1000);
                predictedEnd = new Date(stretchingPhaseStartTime + 90 * 60 * 1000);
                const formatTime = (d: Date) => d.toLocaleTimeString('en-NZ', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
                newStatusText = `The magnetic field is stretching. There is a ~${probability.toFixed(0)}% chance of a substorm predicted between ${formatTime(predictedStart)} and ${formatTime(predictedEnd)}.`;
            }
            newStatusColor = 'text-yellow-400';
            finalSubstormActivity = { 
                text: newStatusText, color: newStatusColor, isErupting: false, isStretching: true, 
                probability, predictedStartTime: predictedStart?.getTime(), predictedEndTime: predictedEnd?.getTime() 
            };
        } else {
            newStatusText = 'The magnetic field appears stable. No immediate signs of substorm development.';
            newStatusColor = 'text-neutral-400';
            newStretchingStartTime = null;
            finalSubstormActivity = { text: newStatusText, color: newStatusColor, isErupting: false, isStretching: false };
        }
        
        if (newStretchingStartTime !== stretchingPhaseStartTime) {
            setStretchingPhaseStartTime(newStretchingStartTime);
        }
        
        setSubstormBlurb({ text: newStatusText, color: newStatusColor });
        setSubstormActivityStatus(finalSubstormActivity);
        previousSubstormStatusRef.current = newStatusText;
    }, [setSubstormActivityStatus, stretchingPhaseStartTime]);

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
            let adjustedScore = baseScore;
            if (baseScore !== null) adjustedScore = Math.max(0, Math.min(100, baseScore + locationAdjustment));
            setAuroraScore(adjustedScore);
            setCurrentAuroraScore(adjustedScore);
            setLastUpdated(`Last Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`);
            const { bt, bz } = currentForecast?.inputs?.magneticField ?? {};
            previousAuroraScoreRef.current = adjustedScore;
            if (Array.isArray(dailyHistory)) setDailyCelestialHistory(dailyHistory); else setDailyCelestialHistory([]);
            if (Array.isArray(owmDailyForecast)) setOwmDailyForecast(owmDailyForecast); else setOwmDailyForecast([]);
            setGaugeData(prev => ({ 
                ...prev, 
                bt: { ...prev.bt, value: bt?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bt, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`},
                bz: { ...prev.bz, value: bz?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bz, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`},
                power: { ...prev.power, value: currentForecast?.inputs?.hemisphericPower?.toFixed(1) ?? 'N/A', ...getGaugeStyle(currentForecast?.inputs?.hemisphericPower ?? null, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}`},
                moon: getMoonData(currentForecast?.moon?.illumination ?? null, currentForecast?.moon?.rise ?? null, currentForecast?.moon?.set ?? null, owmDailyForecast || []) 
            }));
            if (Array.isArray(historicalData)) setAuroraScoreHistory(historicalData.filter((d: any) => d.timestamp != null && d.baseScore != null).sort((a, b) => a.timestamp - b.timestamp)); else setAuroraScoreHistory([]);
            if (Array.isArray(rawHistory)) setHemisphericPowerHistory(rawHistory.filter((d: any) => d.timestamp && d.hemisphericPower && !isNaN(d.hemisphericPower)).map((d: RawHistoryRecord) => ({ timestamp: d.timestamp, hemisphericPower: d.hemisphericPower })).sort((a:any, b:any) => a.timestamp - b.timestamp)); else setHemisphericPowerHistory([]);
        }

        if (plasmaResult.status === 'fulfilled' && Array.isArray(plasmaResult.value) && plasmaResult.value.length > 1) {
            const plasmaData = plasmaResult.value; const headers = plasmaData[0]; const speedIdx = headers.indexOf('speed'); const densityIdx = headers.indexOf('density'); const timeIdx = headers.indexOf('time_tag');
            const processed = plasmaData.slice(1).map((r:any[]) => ({ time: new Date(r[timeIdx].replace(' ', 'T') + 'Z').getTime(), speed: parseFloat(r[speedIdx]) > -9999 ? parseFloat(r[speedIdx]) : null, density: parseFloat(r[densityIdx]) > -9999 ? parseFloat(r[densityIdx]) : null }));
            setAllSpeedData(processed.map(p => ({ x: p.time, y: p.speed }))); setAllDensityData(processed.map(p => ({ x: p.time, y: p.density })));
            const latest = plasmaData.slice(1).reverse().find((r: any[]) => parseFloat(r?.[speedIdx]) > -9999);
            const speedVal = latest ? parseFloat(latest[speedIdx]) : null; const densityVal = latest ? parseFloat(latest[densityIdx]) : null; const time = latest?.[timeIdx] ? new Date(latest[timeIdx].replace(' ', 'T') + 'Z').getTime() : Date.now();
            setGaugeData(prev => ({ 
                ...prev, 
                speed: {...prev.speed, value: speedVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(speedVal, 'speed'), lastUpdated: `Updated: ${formatNZTimestamp(time)}`}, 
                density: {...prev.density, value: densityVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(densityVal, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(time)}`} 
            }));
        }

        if (magResult.status === 'fulfilled' && Array.isArray(magResult.value) && magResult.value.length > 1) {
            const magData = magResult.value; const headers = magData[0]; const btIdx = headers.indexOf('bt'); const bzIdx = headers.indexOf('bz_gsm'); const timeIdx = headers.indexOf('time_tag');
            setAllMagneticData(magData.slice(1).map((r: any[]) => ({ time: new Date(r[timeIdx].replace(' ', 'T') + 'Z').getTime(), bt: parseFloat(r[btIdx]) > -9999 ? parseFloat(r[btIdx]) : null, bz: parseFloat(r[bzIdx]) > -9999 ? parseFloat(r[bzIdx]) : null })));
        }

        let anyGoesDataFound = false;
        if (goes18Result.status === 'fulfilled' && Array.isArray(goes18Result.value)) {
            const processed = goes18Result.value.filter((d: any) => d.Hp != null && !isNaN(d.Hp)).map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp })).sort((a, b) => a.time - b.time);
            setGoes18Data(processed);
            const currentAdjustedScore = (forecastResult.status === 'fulfilled' && forecastResult.value.currentForecast?.spotTheAuroraForecast !== null) ? Math.max(0, Math.min(100, forecastResult.value.currentForecast.spotTheAuroraForecast + locationAdjustment)) : null;
            analyzeMagnetometerData(processed, currentAdjustedScore, getGaugeStyle);
            if (processed.length > 0) anyGoesDataFound = true;
        }

        if (goes19Result.status === 'fulfilled' && Array.isArray(goes19Result.value)) {
            const processed = goes19Result.value.filter((d: any) => d.Hp != null && !isNaN(d.Hp)).map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp })).sort((a, b) => a.time - b.time);
            setGoes19Data(processed); if (processed.length > 0) anyGoesDataFound = true;
        }

        if (!anyGoesDataFound) setLoadingMagnetometer('No valid GOES Magnetometer data available.'); else setLoadingMagnetometer(null);
        if (ipsResult.status === 'fulfilled' && Array.isArray(ipsResult.value)) setInterplanetaryShockData(ipsResult.value); else setInterplanetaryShockData([]);
        
        if (isInitialLoad) setIsLoading(false);
    }, [locationAdjustment, getMoonData, analyzeMagnetometerData, setCurrentAuroraScore]);

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
                (error) => {
                    setLocationBlurb('Location unavailable. Showing default forecast for Greymouth.');
                },
                { enableHighAccuracy: false, timeout: 10000, maximumAge: 1800000 }
            );
        } else {
            setLocationBlurb('Geolocation is not supported. Showing default forecast for Greymouth.');
        }
    }, []);

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
        substormBlurb,
        auroraScoreHistory,
        hemisphericPowerHistory,
        dailyCelestialHistory,
        owmDailyForecast,
        interplanetaryShockData,
        locationBlurb,
        fetchAllData,
        previousAuroraScoreRef,
    };
};
// --- END OF FILE src/hooks/useForecastData.ts ---