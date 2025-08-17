// --- START OF FILE src/hooks/useForecastData.ts ---

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  SubstormActivity,
  SubstormForecast, // richer forecast object
} from '../types';

/* =======================================================================================
   Types
======================================================================================= */
interface CelestialTimeData {
  moon?: { rise: number | null; set: number | null; illumination?: number };
  sun?: { rise: number | null; set: number | null };
}

interface DailyHistoryEntry {
  date: string;
  sun?: { rise: number | null; set: number | null };
  moon?: { rise: number | null; set: number | null; illumination?: number };
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

// NZ Geomag (Tilde) types
type NZSeries = { time: number; value: number };
type NZStationCode = 'EYR' | 'SBA' | 'API';
type NZStationBundle = { X: NZSeries[]; Y: NZSeries[]; Z: NZSeries[]; H: NZSeries[]; dH: NZSeries[] };
type NZGeomagMap = Record<string, NZStationBundle>;

// Predictive model
type Status = 'QUIET' | 'WATCH' | 'LIKELY_60' | 'IMMINENT_30' | 'ONSET';

/* =======================================================================================
   Constants
======================================================================================= */
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const NOAA_GOES18_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json';
const NOAA_GOES19_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/secondary/magnetometers-1-day.json';
const NASA_IPS_URL = 'https://spottheaurora.thenamesrock.workers.dev/ips';
const GREYMOUTH_LATITUDE = -42.45;

/* =======================================================================================
   Math / helpers
======================================================================================= */
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function newellCoupling(V: number, By: number, Bz: number) {
  const BT = Math.sqrt((By ?? 0) ** 2 + (Bz ?? 0) ** 2);
  const theta = Math.atan2(By ?? 0, Bz ?? 0);
  const s = Math.sin(theta / 2);
  const val = Math.pow(Math.max(V, 0), 4 / 3) * Math.pow(BT, 2 / 3) * Math.pow(Math.abs(s), 8 / 3);
  return isFinite(val) ? val / 1000 : 0;
}

function movingAvg(vals: number[], n: number) {
  if (!Array.isArray(vals) || !vals.length) return undefined;
  const m = Math.min(vals.length, n);
  const sub = vals.slice(vals.length - m);
  const sum = sub.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  return m ? sum / m : undefined;
}

function sustainedSouth(bzSeries: number[], minutes = 15) {
  if (!bzSeries.length) return false;
  const m = Math.min(bzSeries.length, minutes);
  const sub = bzSeries.slice(-m);
  const fracSouth = sub.filter((bz) => Number.isFinite(bz) && bz <= -3).length / sub.length;
  return fracSouth >= 0.8;
}

function slopePerMin(series: { t: number; v: number }[], minutes = 2) {
  if (series.length < 2) return undefined;
  const end = series[series.length - 1];
  for (let i = series.length - 2; i >= 0; i--) {
    const dtm = (end.t - series[i].t) / 60000;
    if (dtm >= minutes - 0.5) {
      const slope = (end.v - series[i].v) / dtm;
      return Number.isFinite(slope) ? slope : undefined;
    }
  }
  return undefined;
}

function probabilityModel(dPhiNow: number, dPhiMean15: number, bzMean15: number) {
  const base = Math.tanh(0.015 * (dPhiMean15 || dPhiNow) + 0.01 * dPhiNow);
  const bzBoost = bzMean15 < -3 ? 0.1 : bzMean15 < -1 ? 0.05 : 0;
  const P60 = Math.min(0.9, Math.max(0.01, 0.25 + 0.6 * base + bzBoost));
  const P30 = Math.min(0.9, Math.max(0.01, 0.15 + 0.7 * base + bzBoost));
  return { P30, P60 };
}

// Location tweak
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
    return isNaN(d.getTime())
      ? 'Invalid Date'
      : d.toLocaleString('en-NZ', {
          timeZone: 'Pacific/Auckland',
          dateStyle: 'short',
          timeStyle: 'short',
        });
  } catch {
    return 'Invalid Date';
  }
};

/* =======================================================================================
   NZ GeoNet (Tilde) — robust client with fallbacks
======================================================================================= */
const TILDE_BASE = 'https://tilde.geonet.org.nz/v3/series';

type TildeName = 'magnetic-field-component' | 'magnetic-field-rate-of-change';
type TildeAspect = 'X' | 'Y' | 'Z' | 'H' | 'dH';

function buildTildeUrl(
  station: NZStationCode | string,
  name: TildeName,
  aspect: TildeAspect,
  startMs: number,
  endMs: number,
  method: string = '60s'
) {
  const start = new Date(startMs).toISOString();
  const end = new Date(endMs).toISOString();
  const qs = new URLSearchParams({
    domain: 'geomag',
    name,
    station,
    method, // we will try '60s' then '1m'
    aspect,
    start,
    end,
  }).toString();
  return `${TILDE_BASE}?${qs}`;
}

function normalizeTildeSeries(json: any): NZSeries[] {
  if (!json) return [];
  // Typical: { series: [{ values: [[iso, number], ...] }] }
  const series = Array.isArray(json.series) ? json.series[0] : null;
  const values = series?.values ?? json.values ?? json.data ?? [];
  if (!Array.isArray(values)) return [];
  return values
    .map((row: any) => {
      if (Array.isArray(row)) {
        const t = Date.parse(row[0]);
        const v = Number(row[1]);
        return Number.isFinite(t) && Number.isFinite(v) ? { time: t, value: v } : null;
      }
      if (row && row.time && row.value != null) {
        const t = Date.parse(row.time);
        const v = Number(row.value);
        return Number.isFinite(t) && Number.isFinite(v) ? { time: t, value: v } : null;
      }
      return null;
    })
    .filter(Boolean) as NZSeries[];
}

async function fetchTildeOnce(url: string): Promise<NZSeries[]> {
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    return normalizeTildeSeries(json);
  } catch {
    return [];
  }
}

/**
 * Try several permutations to avoid 400s:
 * - 6h window → if empty, shrink to 3h
 * - method '60s' → if empty, method '1m'
 * - component aspects (X/Y/Z/H) → if empty for H, fall back to X
 * Returns whatever it can get; never throws.
 */
async function fetchNZGeomag(hours = 6): Promise<NZGeomagMap> {
  const end = Date.now();
  const start = end - hours * 3600_000;

  const stations: NZStationCode[] = ['EYR', 'SBA', 'API'];
  const out: NZGeomagMap = {};

  for (const st of stations) {
    const bundle: NZStationBundle = { X: [], Y: [], Z: [], H: [], dH: [] };

    // try helper for a single series with fallbacks
    const trySeries = async (
      name: TildeName,
      aspect: TildeAspect,
      preferXFallback = false
    ): Promise<NZSeries[]> => {
      // attempt order:
      // 1) 6h + 60s
      // 2) 3h + 60s
      // 3) 3h + 1m
      // 4) if aspect is H/dH and preferXFallback, try X equivalent
      const urls: string[] = [];
      urls.push(buildTildeUrl(st, name, aspect, start, end, '60s'));
      urls.push(buildTildeUrl(st, name, aspect, end - 3 * 3600_000, end, '60s'));
      urls.push(buildTildeUrl(st, name, aspect, end - 3 * 3600_000, end, '1m'));

      if (preferXFallback && (aspect === 'H' || aspect === 'dH')) {
        urls.push(buildTildeUrl(st, name, 'X', end - 3 * 3600_000, end, '60s'));
        urls.push(buildTildeUrl(st, name, 'X', end - 3 * 3600_000, end, '1m'));
      }

      for (const url of urls) {
        const data = await fetchTildeOnce(url);
        if (data.length) return data;
      }
      return [];
    };

    const [X, Y, Z, H] = await Promise.all([
      trySeries('magnetic-field-component', 'X'),
      trySeries('magnetic-field-component', 'Y'),
      trySeries('magnetic-field-component', 'Z'),
      trySeries('magnetic-field-component', 'H', true),
    ]);
    const dH = await trySeries('magnetic-field-rate-of-change', 'dH', true);

    if ([X, Y, Z, H, dH].some((s) => s.length)) {
      bundle.X = X;
      bundle.Y = Y;
      bundle.Z = Z;
      bundle.H = H;
      bundle.dH = dH;
      out[st] = bundle;
    }
  }
  return out;
}

/* =======================================================================================
   Hook
======================================================================================= */
export const useForecastData = (
  setCurrentAuroraScore: (score: number | null) => void,
  setSubstormActivityStatus: (status: SubstormActivity | null) => void
) => {
  const [isLoading, setIsLoading] = useState(true);
  const [auroraScore, setAuroraScore] = useState<number | null>(null);
  const [baseAuroraScore, setBaseAuroraScore] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string>('Loading...');
  const [gaugeData, setGaugeData] = useState<
    Record<
      string,
      { value: string; unit: string; emoji: string; percentage: number; lastUpdated: string; color: string }
    >
  >({
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
  const [auroraScoreHistory, setAuroraScoreHistory] = useState<
    { timestamp: number; baseScore: number; finalScore: number }[]
  >([]);
  const [hemisphericPowerHistory, setHemisphericPowerHistory] = useState<{ timestamp: number; hemisphericPower: number }[]>(
    []
  );
  const [dailyCelestialHistory, setDailyCelestialHistory] = useState<DailyHistoryEntry[]>([]);
  const [owmDailyForecast, setOwmDailyForecast] = useState<OwmDailyForecastEntry[]>([]);
  const [interplanetaryShockData, setInterplanetaryShockData] = useState<InterplanetaryShock[]>([]);
  const [locationAdjustment, setLocationAdjustment] = useState<number>(0);
  const [locationBlurb, setLocationBlurb] = useState<string>('Getting location for a more accurate forecast...');
  const [nzMagnometer, setNzMagnometer] = useState<NZGeomagMap>({});

  // Predictive model
  const [substormForecast, setSubstormForecast] = useState<SubstormForecast>({
    status: 'QUIET',
    likelihood: 0,
    windowLabel: '30 – 90 min',
    action: 'Low chance for now.',
    p30: 0,
    p60: 0,
  });

  const getMoonData = useCallback((illumination: number | null, rise: number | null, set: number | null, forecast: OwmDailyForecastEntry[]) => {
    const moonIllumination = Math.max(0, Math.min(100, (illumination ?? 0)));
    let moonEmoji = '🌑';
    if (moonIllumination > 95) moonEmoji = '🌕';
    else if (moonIllumination > 55) moonEmoji = '🌖';
    else if (moonIllumination > 45) moonEmoji = '🌗';
    else if (moonIllumination > 5) moonEmoji = '🌒';

    const now = Date.now();
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);
    const findNextEvent = (times: (number | null)[]) =>
      times
        .filter((t): t is number => t !== null && !isNaN(t))
        .sort((a, b) => a - b)
        .find((t) => t > now) || null;

    const allRises = [rise, ...forecast.map((d) => (d.moonrise ? d.moonrise * 1000 : null))];
    const allSets = [set, ...forecast.map((d) => (d.moonset ? d.moonset * 1000 : null))];

    const nextRise = findNextEvent(allRises);
    const nextSet = findNextEvent(allSets);

    const formatTime = (ts: number | null) => {
      if (!ts) return 'N/A';
      const d = new Date(ts);
      const dayLabel =
        d.toDateString() === today.toDateString()
          ? 'Today'
          : d.toDateString() === tomorrow.toDateString()
          ? 'Tomorrow'
          : d.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' });
      return `${dayLabel} ${d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}`;
    };

    const riseStr = formatTime(nextRise);
    const setStr = formatTime(nextSet);
    const caretPath = `M19.5 8.25l-7.5 7.5-7.5-7.5`;
    const upSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle" style="transform: rotate(180deg);"><path stroke-linecap="round" stroke-linejoin="round" d="${caretPath}" /></svg>`;
    const downSVG = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" class="w-3 h-3 inline-block align-middle"><path stroke-linecap="round" stroke-linejoin="round" d="${caretPath}" /></svg>`;
    const value = `<span class="text-xl">${moonIllumination.toFixed(0)}%</span><br/><span class='text-xs'>${upSVG} ${riseStr}   ${downSVG} ${setStr}</span>`;
    return {
      value,
      unit: '',
      emoji: moonEmoji,
      percentage: moonIllumination,
      lastUpdated: `Updated: ${formatNZTimestamp(Date.now())}`,
      color: '#A9A9A9',
    };
  }, []);

  /* ---------------------------------------------------------------------------
     Derived L1 features for model
  --------------------------------------------------------------------------- */
  const recentL1Data = useMemo(() => {
    if (!allMagneticData.length || !allSpeedData.length) return null;

    // Map plasma speed by (rounded) minute timestamp to tolerate slight skew
    const mapV = new Map<number, number>();
    for (const p of allSpeedData) {
      const t = Math.round(p.x / 60_000) * 60_000;
      if (Number.isFinite(p.y)) mapV.set(t, p.y);
    }

    const joined: { t: number; By: number; Bz: number; V: number }[] = [];
    for (const m of allMagneticData) {
      const t = Math.round(m.time / 60_000) * 60_000;
      const V = mapV.get(t);
      if (V != null && Number.isFinite(V) && m.by != null && m.bz != null) {
        joined.push({ t: m.time, By: m.by, Bz: m.bz, V });
      }
    }

    const cutoff = Date.now() - 120 * 60_000;
    const win = joined.filter((x) => x.t >= cutoff);
    if (!win.length) return null;

    const dPhi = win.map((w) => newellCoupling(w.V, w.By, w.Bz));
    const bz = win.map((w) => (Number.isFinite(w.Bz) ? w.Bz : 0));

    const dPhiNow = dPhi.at(-1) ?? 0;
    const dPhiMean15 = movingAvg(dPhi, 15) ?? dPhiNow;
    const bzMean15 = movingAvg(bz, 15) ?? (bz.at(-1) ?? 0);

    return {
      dPhiSeries: dPhi,
      bzSeries: bz,
      dPhiNow,
      dPhiMean15,
      bzMean15,
      sustained: sustainedSouth(bz, 15),
    };
  }, [allMagneticData, allSpeedData]);

  // GOES onset-like slope (Hp)
  const goesOnset = useMemo(() => {
    if (!goes18Data.length) return false;
    const cutoff = Date.now() - 15 * 60_000;
    const series = goes18Data
      .filter((g) => g.time >= cutoff && g.hp != null)
      .map((g) => ({ t: g.time, v: g.hp }));
    const slope = slopePerMin(series, 2);
    return typeof slope === 'number' && slope >= 8;
  }, [goes18Data]);

  // Substorm forecast evaluation
  useEffect(() => {
    if (!recentL1Data) return;

    const probs = probabilityModel(recentL1Data.dPhiNow, recentL1Data.dPhiMean15, recentL1Data.bzMean15);
    const P30_ALERT = 0.6,
      P60_ALERT = 0.6;
    let status: Status = 'QUIET';

    // NZ dH spike check (~5 min slope)
    const nzSpike = (() => {
      try {
        const now = Date.now();
        const windowStart = now - 5 * 60_000;
        for (const st of Object.keys(nzMagnometer)) {
          const dH = nzMagnometer[st]?.dH || [];
          const win = dH.filter((p) => p.time >= windowStart);
          if (win.length >= 2) {
            const s =
              (win[win.length - 1].value - win[0].value) /
              Math.max(0.5, (win[win.length - 1].time - win[0].time) / 60000);
            if (Number.isFinite(s) && Math.abs(s) >= 2) return true;
          }
        }
      } catch {
        // ignore
      }
      return false;
    })();

    if (goesOnset || nzSpike) {
      status = 'ONSET';
    } else if (recentL1Data.sustained && probs.P30 >= P30_ALERT && (auroraScore ?? 0) >= 25) {
      status = 'IMMINENT_30';
    } else if (recentL1Data.sustained && probs.P60 >= P60_ALERT && (auroraScore ?? 0) >= 20) {
      status = 'LIKELY_60';
    } else if (
      recentL1Data.sustained &&
      recentL1Data.dPhiNow >= (movingAvg(recentL1Data.dPhiSeries, 60) ?? 0) &&
      (auroraScore ?? 0) >= 15
    ) {
      status = 'WATCH';
    }

    const likelihood = Math.round((0.4 * clamp01(probs.P30) + 0.6 * clamp01(probs.P60)) * 100);

    let windowLabel = '30 – 90 min';
    if (status === 'ONSET') windowLabel = 'Now – 10 min';
    else if (status === 'IMMINENT_30') windowLabel = '0 – 30 min';
    else if (status === 'LIKELY_60') windowLabel = '10 – 60 min';
    else if (status === 'WATCH') windowLabel = '20 – 90 min';

    let action = 'Low chance for now.';
    if (status === 'ONSET') action = 'Look now — activity is underway.';
    else if (status === 'IMMINENT_30' || likelihood >= 65) action = 'Head outside or to a darker spot now.';
    else if (status === 'LIKELY_60' || likelihood >= 50) action = 'Prepare to go; check the sky within the next hour.';
    else if (status === 'WATCH')
      action =
        "Energy is building in Earth's magnetic field. The forecast will upgrade to an Alert if an eruption becomes likely.";

    setSubstormForecast({ status, likelihood, windowLabel, action, p30: probs.P30, p60: probs.P60 });

    // Banner state for the app
    setSubstormActivityStatus({
      isStretching: status === 'WATCH' || status === 'LIKELY_60' || status === 'IMMINENT_30',
      isErupting: status === 'ONSET',
      probability: likelihood,
      predictedStartTime: status !== 'QUIET' ? Date.now() : undefined,
      predictedEndTime: status !== 'QUIET' ? Date.now() + 60 * 60 * 1000 : undefined,
      text: action,
      color: '', // resolved by banner styles
    });
  }, [recentL1Data, goesOnset, auroraScore, nzMagnometer, setSubstormActivityStatus]);

  const getMoonGauge = useCallback(
    (illum: number | null, rise: number | null, setT: number | null, fc: OwmDailyForecastEntry[], lastTs: number) => {
      const g = getMoonData(illum, rise, setT, fc);
      return { ...g, lastUpdated: `Updated: ${formatNZTimestamp(lastTs)}` };
    },
    [getMoonData]
  );

  const fetchAllData = useCallback(
    async (isInitialLoad = false, getGaugeStyle: Function) => {
      if (isInitialLoad) setIsLoading(true);

      const results = await Promise.allSettled([
        fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then((res) => res.json()),
        fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then((res) => res.json()),
        fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then((res) => res.json()),
        fetch(`${NOAA_GOES18_MAG_URL}?_=${Date.now()}`).then((res) => res.json()),
        fetch(`${NOAA_GOES19_MAG_URL}?_=${Date.now()}`).then((res) => res.json()),
        fetch(`${NASA_IPS_URL}?_=${Date.now()}`).then((res) => res.json()),
        fetchNZGeomag(6), // NZ geomag (robust)
      ]);

      const [forecastResult, plasmaResult, magResult, goes18Result, goes19Result, ipsResult, nzMagResult] = results;

      // Forecast bucket
      if (forecastResult.status === 'fulfilled' && forecastResult.value) {
        const { currentForecast, historicalData, dailyHistory, owmDailyForecast, rawHistory } = forecastResult.value ?? {};
        setCelestialTimes({ moon: currentForecast?.moon, sun: currentForecast?.sun });

        const baseScore = Number.isFinite(currentForecast?.spotTheAuroraForecast)
          ? currentForecast.spotTheAuroraForecast
          : null;
        setBaseAuroraScore(baseScore);

        const initialAdjustedScore =
          baseScore !== null ? Math.max(0, Math.min(100, baseScore + locationAdjustment)) : null;
        setAuroraScore(initialAdjustedScore);
        setCurrentAuroraScore(initialAdjustedScore);

        const lastTs = currentForecast?.lastUpdated ?? Date.now();
        setLastUpdated(`Last Updated: ${formatNZTimestamp(lastTs)}`);

        const { bt, bz } = currentForecast?.inputs?.magneticField ?? {};
        const hemi = Number.isFinite(currentForecast?.inputs?.hemisphericPower)
          ? currentForecast.inputs.hemisphericPower
          : null;

        setDailyCelestialHistory(Array.isArray(dailyHistory) ? dailyHistory : []);
        setOwmDailyForecast(Array.isArray(owmDailyForecast) ? owmDailyForecast : []);

        setGaugeData((prev) => ({
          ...prev,
          bt: {
            ...prev.bt,
            value: Number.isFinite(bt) ? (bt as number).toFixed(1) : 'N/A',
            ...getGaugeStyle(Number.isFinite(bt) ? (bt as number) : null, 'bt'),
            lastUpdated: `Updated: ${formatNZTimestamp(lastTs)}`,
          },
          bz: {
            ...prev.bz,
            value: Number.isFinite(bz) ? (bz as number).toFixed(1) : 'N/A',
            ...getGaugeStyle(Number.isFinite(bz) ? (bz as number) : null, 'bz'),
            lastUpdated: `Updated: ${formatNZTimestamp(lastTs)}`,
          },
          power: {
            ...prev.power,
            value: Number.isFinite(hemi) ? (hemi as number).toFixed(1) : 'N/A',
            ...getGaugeStyle(Number.isFinite(hemi) ? (hemi as number) : null, 'power'),
            lastUpdated: `Updated: ${formatNZTimestamp(lastTs)}`,
          },
          moon: getMoonGauge(
            currentForecast?.moon?.illumination ?? null,
            currentForecast?.moon?.rise ?? null,
            currentForecast?.moon?.set ?? null,
            owmDailyForecast || [],
            lastTs
          ),
        }));

        setAuroraScoreHistory(
          Array.isArray(historicalData)
            ? historicalData
                .filter((d: any) => d?.timestamp != null && d?.baseScore != null)
                .sort((a, b) => a.timestamp - b.timestamp)
            : []
        );

        setHemisphericPowerHistory(
          Array.isArray(rawHistory)
            ? rawHistory
                .filter((d: any) => d?.timestamp && Number.isFinite(d?.hemisphericPower))
                .map((d: RawHistoryRecord) => ({ timestamp: d.timestamp, hemisphericPower: d.hemisphericPower }))
                .sort((a: any, b: any) => a.timestamp - b.timestamp)
            : []
        );
      }

      // Plasma (speed/density)
      if (plasmaResult.status === 'fulfilled' && Array.isArray(plasmaResult.value) && plasmaResult.value.length > 1) {
        const plasmaData = plasmaResult.value;
        const headers = plasmaData[0];
        const speedIdx = headers.indexOf('speed');
        const densityIdx = headers.indexOf('density');
        const timeIdx = headers.indexOf('time_tag');

        const processed = plasmaData
          .slice(1)
          .map((r: any[]) => {
            if (!r || !r[timeIdx]) return null;
            const t = new Date(String(r[timeIdx]).replace(' ', 'T') + 'Z').getTime();
            const speed = parseFloat(r[speedIdx]);
            const density = parseFloat(r[densityIdx]);
            return {
              time: t,
              speed: Number.isFinite(speed) && speed > -9999 ? speed : null,
              density: Number.isFinite(density) && density > -9999 ? density : null,
            };
          })
          .filter(Boolean) as { time: number; speed: number | null; density: number | null }[];

        setAllSpeedData(processed.filter((p) => p.speed != null).map((p) => ({ x: p.time, y: p.speed })));
        setAllDensityData(processed.filter((p) => p.density != null).map((p) => ({ x: p.time, y: p.density })));

        const latest = plasmaData
          .slice(1)
          .reverse()
          .find((r: any[]) => {
            const s = parseFloat(r?.[speedIdx]);
            return Number.isFinite(s) && s > -9999;
          });

        const speedVal = latest ? parseFloat(latest[speedIdx]) : null;
        const densityVal = latest ? parseFloat(latest[densityIdx]) : null;
        const time =
          latest?.[timeIdx] ? new Date(String(latest[timeIdx]).replace(' ', 'T') + 'Z').getTime() : Date.now();

        setGaugeData((prev) => ({
          ...prev,
          speed: {
            ...prev.speed,
            value: Number.isFinite(speedVal) ? (speedVal as number).toFixed(1) : 'N/A',
            ...getGaugeStyle(Number.isFinite(speedVal) ? (speedVal as number) : null, 'speed'),
            lastUpdated: `Updated: ${formatNZTimestamp(time)}`,
          },
          density: {
            ...prev.density,
            value: Number.isFinite(densityVal) ? (densityVal as number).toFixed(1) : 'N/A',
            ...getGaugeStyle(Number.isFinite(densityVal) ? (densityVal as number) : null, 'density'),
            lastUpdated: `Updated: ${formatNZTimestamp(time)}`,
          },
        }));
      }

      // IMF (Bt/Bz/By)
      if (magResult.status === 'fulfilled' && Array.isArray(magResult.value) && magResult.value.length > 1) {
        const magData = magResult.value;
        const headers = magData[0];
        const btIdx = headers.indexOf('bt');
        const bzIdx = headers.indexOf('bz_gsm');
        const byIdx = headers.indexOf('by_gsm');
        const timeIdx = headers.indexOf('time_tag');

        const processed = magData
          .slice(1)
          .map((r: any[]) => {
            if (!r || !r[timeIdx]) return null;
            const t = new Date(String(r[timeIdx]).replace(' ', 'T') + 'Z').getTime();
            const bt = parseFloat(r[btIdx]);
            const bz = parseFloat(r[bzIdx]);
            const by = byIdx > -1 ? parseFloat(r[byIdx]) : NaN;
            return {
              time: t,
              bt: Number.isFinite(bt) && bt > -9999 ? bt : null,
              bz: Number.isFinite(bz) && bz > -9999 ? bz : null,
              by: Number.isFinite(by) && by > -9999 ? by : null,
            };
          })
          .filter(Boolean);

        setAllMagneticData(processed as any[]);
      }

      // GOES 18/19 Hp
      let anyGoesDataFound = false;
      if (goes18Result.status === 'fulfilled' && Array.isArray(goes18Result.value)) {
        const processed = goes18Result.value
          .filter((d: any) => d?.Hp != null && !isNaN(d.Hp) && d.time_tag)
          .map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp }))
          .sort((a, b) => a.time - b.time);
        setGoes18Data(processed);
        if (processed.length > 0) anyGoesDataFound = true;
      }
      if (goes19Result.status === 'fulfilled' && Array.isArray(goes19Result.value)) {
        const processed = goes19Result.value
          .filter((d: any) => d?.Hp != null && !isNaN(d.Hp) && d.time_tag)
          .map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp }))
          .sort((a, b) => a.time - b.time);
        setGoes19Data(processed);
        if (processed.length > 0) anyGoesDataFound = true;
      }
      setLoadingMagnetometer(anyGoesDataFound ? null : 'No valid GOES Magnetometer data available.');

      // IPS
      if (ipsResult.status === 'fulfilled' && Array.isArray(ipsResult.value)) setInterplanetaryShockData(ipsResult.value);
      else setInterplanetaryShockData([]);

      // NZ Geomag (Tilde)
      if (nzMagResult.status === 'fulfilled') {
        setNzMagnometer(nzMagResult.value || {});
      } else {
        setNzMagnometer({});
      }

      if (isInitialLoad) setIsLoading(false);
    },
    [locationAdjustment, getMoonGauge, setCurrentAuroraScore, setSubstormActivityStatus]
  );

  // Location tweak
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const adjustment = calculateLocationAdjustment(position.coords.latitude);
          setLocationAdjustment(adjustment);
          const direction = adjustment >= 0 ? 'south' : 'north';
          const distance = Math.abs((adjustment / 3) * 150);
          setLocationBlurb(
            `Forecast adjusted by ${adjustment.toFixed(1)}% for your location (${distance.toFixed(0)}km ${direction} of Greymouth).`
          );
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

  // Apply location adjustment on base score update
  useEffect(() => {
    if (baseAuroraScore !== null) {
      const adjustedScore = Math.max(0, Math.min(100, baseAuroraScore + locationAdjustment));
      setAuroraScore(adjustedScore);
      setCurrentAuroraScore(adjustedScore);
    }
  }, [locationAdjustment, baseAuroraScore, setCurrentAuroraScore]);

  // Daylight calc
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
    substormForecast, // richer forecast object
    auroraScoreHistory,
    hemisphericPowerHistory,
    dailyCelestialHistory,
    owmDailyForecast,
    interplanetaryShockData,
    locationBlurb,
    // NZ data
    nzMagnometer,
    fetchAllData,
  };
};

// --- END OF FILE src/hooks/useForecastData.ts ---
