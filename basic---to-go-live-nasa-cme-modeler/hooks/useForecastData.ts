//--- START OF FILE src/hooks/useForecastData.ts ---

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  SubstormActivity,
  SightingReport,
  SubstormForecast, // richer forecast object you already use
} from '../types';

/* =========================
   Type Definitions
   ========================= */
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
  dt: number; sunrise: number; sunset: number;
  moonrise: number; moonset: number; moon_phase: number;
}
interface RawHistoryRecord {
  timestamp: number;
  baseScore: number;
  finalScore: number;
  hemisphericPower: number;
}
interface InterplanetaryShock {
  activityID: string; catalog: string; eventTime: string;
  instruments: { displayName: string }[]; location: string; link: string;
}
type SWRow = { t: number; by?: number; bz?: number; v?: number; };
type GOESRow = { t: number; hp?: number; };
type Status = "QUIET" | "WATCH" | "LIKELY_60" | "IMMINENT_30" | "ONSET";

/** NZ Magnetometer samples (aligned to minute) */
export type NZMagRow = {
  t: number;                // epoch ms
  H?: number | null;        // horizontal intensity (nT)
  X?: number | null;        // if present
  Y?: number | null;        // if present
  Z?: number | null;        // if present
  dHdt?: number | null;     // nT/min (derived if not provided)
};
export type NZMagSeries = {
  station: 'EY2M' | 'EYWM' | 'SBAM' | 'AHAM';
  rows: NZMagRow[];
  meta?: { lat?: number; lon?: number };
};

/* =========================
   Constants
   ========================= */
const FORECAST_API_URL = 'https://spottheaurora.thenamesrock.workers.dev/';
const NOAA_PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const NOAA_MAG_URL    = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';
const NOAA_GOES18_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json';
const NOAA_GOES19_MAG_URL = 'https://services.swpc.noaa.gov/json/goes/secondary/magnetometers-1-day.json';
const NASA_IPS_URL = 'https://spottheaurora.thenamesrock.workers.dev/ips';
const REFRESH_INTERVAL_MS = 60 * 1000;
const GREYMOUTH_LATITUDE = -42.45;

// GeoNet Tilde API (geomag domain). We’ll query series lists first, then pick H/X/Y/Z or dH/dt.
// Docs: /v4/data, /v4/dataSummary (JSON). Examples documented by GeoNet.
const TILDE_BASE = 'https://tilde.geonet.org.nz/v4';
const TILDE_DOMAIN = 'geomag';
// Stations: EYR (as EYWM), EY2M (West Melton 2), SBA (Scott Base), AHA (Arrival Heights)
const NZ_MAG_STATIONS: Array<'EY2M' | 'EYWM' | 'SBAM' | 'AHAM'> = ['EY2M','EYWM','SBAM','AHAM'];

/* =========================
   Math & Helpers
   ========================= */
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function newellCoupling(V: number, By: number, Bz: number) {
  const BT = Math.sqrt((By ?? 0) ** 2 + (Bz ?? 0) ** 2);
  const theta = Math.atan2(By ?? 0, Bz ?? 0);
  const s = Math.sin(theta / 2);
  const val = Math.pow(V, 4 / 3) * Math.pow(BT, 2 / 3) * Math.pow(Math.abs(s), 8 / 3);
  return val / 1000; // scale down for numeric stability
}

function movingAvg(vals: Array<number | null | undefined>, n: number) {
  const clean = vals.filter((v): v is number => typeof v === 'number' && isFinite(v));
  if (!clean.length) return undefined;
  const m = Math.min(clean.length, n);
  const sub = clean.slice(clean.length - m);
  return sub.reduce((a, b) => a + b, 0) / m;
}
function sustainedSouth(bzSeries: number[], minutes = 15) {
  if (!bzSeries.length) return false;
  const m = Math.min(bzSeries.length, minutes);
  const sub = bzSeries.slice(-m);
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
function nzTime(ts: number) {
  return new Date(ts).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit'
  });
}
function formatNZTimestamp(timestamp: number | string) {
  try {
    const d = new Date(timestamp);
    return isNaN(d.getTime())
      ? "Invalid Date"
      : d.toLocaleString('en-NZ', {
          timeZone: 'Pacific/Auckland',
          dateStyle: 'short', timeStyle: 'short'
        });
  } catch {
    return "Invalid Date";
  }
}

/** Basic probability model (kept from your earlier version, tuned slightly) */
function probabilityModel(dPhiNow: number, dPhiMean15: number, bzMean15: number) {
  const base = Math.tanh(0.015 * (dPhiMean15 || dPhiNow) + 0.01 * dPhiNow);
  const bzBoost = bzMean15 < -3 ? 0.12 : bzMean15 < -1 ? 0.05 : 0;
  const P60 = Math.min(0.95, Math.max(0.01, 0.22 + 0.62 * base + bzBoost));
  const P30 = Math.min(0.95, Math.max(0.01, 0.14 + 0.72 * base + bzBoost));
  return { P30, P60 };
}

/* =========================
   Location adjustment (your existing logic)
   ========================= */
const calculateLocationAdjustment = (userLat: number): number => {
  const isNorthOfGreymouth = userLat > GREYMOUTH_LATITUDE;
  const R = 6371;
  const dLat = (userLat - GREYMOUTH_LATITUDE) * (Math.PI / 180);
  const distanceKm = Math.abs(dLat) * R;
  const numberOfSegments = Math.floor(distanceKm / 10);
  const adjustmentFactor = numberOfSegments * 0.2;
  return isNorthOfGreymouth ? -adjustmentFactor : adjustmentFactor;
};

/* =========================
   React state
   ========================= */
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
    power:{ value: '...', unit: 'GW', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    moon:{ value: '...', unit: '%',  emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    speed:{ value: '...', unit: 'km/s', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
    density:{ value: '...', unit: 'p/cm³', emoji: '❓', percentage: 0, lastUpdated: '...', color: '#808080' },
  });
  const [celestialTimes, setCelestialTimes] = useState<CelestialTimeData>({});
  const [isDaylight, setIsDaylight]   = useState(false);
  const [allSpeedData, setAllSpeedData] = useState<any[]>([]);
  const [allDensityData, setAllDensityData] = useState<any[]>([]);
  const [allMagneticData, setAllMagneticData] = useState<any[]>([]);
  const [goes18Data, setGoes18Data]   = useState<any[]>([]);
  const [goes19Data, setGoes19Data]   = useState<any[]>([]);
  const [loadingMagnetometer, setLoadingMagnetometer] = useState<string | null>('Loading data...');
  const [auroraScoreHistory, setAuroraScoreHistory] = useState<{ timestamp: number; baseScore: number; finalScore: number; }[]>([]);
  const [hemisphericPowerHistory, setHemisphericPowerHistory] = useState<{ timestamp: number; hemisphericPower: number; }[]>([]);
  const [dailyCelestialHistory, setDailyCelestialHistory] = useState<DailyHistoryEntry[]>([]);
  const [owmDailyForecast, setOwmDailyForecast] = useState<OwmDailyForecastEntry[]>([]);
  const [interplanetaryShockData, setInterplanetaryShockData] = useState<InterplanetaryShock[]>([]);
  const [locationAdjustment, setLocationAdjustment] = useState<number>(0);
  const [locationBlurb, setLocationBlurb] = useState<string>('Getting location for a more accurate forecast...');

  // NEW: NZ magnetometer state
  const [nzMagSeries, setNzMagSeries] = useState<NZMagSeries[]>([]);
  const [loadingNZMag, setLoadingNZMag] = useState<string | null>('Loading NZ magnetometers…');

  // Substorm forecast object (you already render this)
  const [substormForecast, setSubstormForecast] = useState<SubstormForecast>({
    status: 'QUIET',
    likelihood: 0,
    windowLabel: '30 – 90 min',
    action: 'Low chance for now.',
    p30: 0,
    p60: 0,
  });

  /* =========================
     Moon display builder
     ========================= */
  const getMoonData = useCallback((illumination: number | null, rise: number | null, set: number | null, forecast: OwmDailyForecastEntry[]) => {
    const moonIllumination = Math.max(0, (illumination ?? 0));
    let moonEmoji = '🌑'; if (moonIllumination > 95) moonEmoji = '🌕'; else if (moonIllumination > 55) moonEmoji = '🌖'; else if (moonIllumination > 45) moonEmoji = '🌗'; else if (moonIllumination > 5) moonEmoji = '🌒';
    const now = Date.now(); const today = new Date(); const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
    const findNextEvent = (times: (number | null)[]) => times.filter((t): t is number => t !== null && !isNaN(t)).sort((a, b) => a - b).find(t => t > now) || null;
    const allRises = [rise, ...forecast.map(d => d.moonrise ? d.moonrise * 1000 : null)];
    const allSets  = [set, ...forecast.map(d => d.moonset ? d.moonset * 1000 : null)];
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

  /* =========================
     L1 join + Newell series
     ========================= */
  const recentL1Data = useMemo(() => {
    if (!allMagneticData.length || !allSpeedData.length) return null;
    const mapV = new Map<number, number>();
    allSpeedData.forEach(p => mapV.set(p.x, p.y));
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
      sustained: sustainedSouth(bz, 15),
      Vnow: win.at(-1)?.V ?? undefined
    };
  }, [allMagneticData, allSpeedData]);

  /* =========================
     GOES onset proxy (unchanged)
     ========================= */
  const goesOnset = useMemo(() => {
    if (!goes18Data.length) return false;
    const cutoff = Date.now() - 15 * 60_000;
    const series = goes18Data.filter(g => g.time >= cutoff && g.hp)
      .map(g => ({ t: g.time, v: g.hp }));
    const slope = slopePerMin(series, 2);
    return typeof slope === "number" && slope >= 8;
  }, [goes18Data]);

  /* =========================
     NZ Magnetometer helpers
     ========================= */
  const pickSeriesFromSummary = (summary: any[]) => {
    // Heuristic: prefer name containing 'magnetic' with aspect H|X|Y|Z or a rate-of-change variant.
    const candidates = summary?.filter(s => s?.series?.domain === TILDE_DOMAIN) ?? [];
    const byStation: Record<string, any[]> = {};
    for (const s of candidates) {
      const st = s.series?.station;
      if (!st) continue;
      byStation[st] = byStation[st] || [];
      byStation[st].push(s);
    }
    const buildKey = (s: any) => `${s.series.station}/${s.series.name}/${s.series.sensorCode}/${s.series.method}/${s.series.aspect}`;
    const choose = (arr: any[], wantAspect: string) =>
      arr.find(s => /magnetic|geomag|field/i.test(s.series?.name ?? '') &&
                    String(s.series?.aspect).toUpperCase() === wantAspect);

    const out: Record<string, { H?: any; X?: any; Y?: any; Z?: any; dHdt?: any }> = {};
    Object.entries(byStation).forEach(([st, arr]) => {
      const pickH   = choose(arr, 'H');
      const pickX   = choose(arr, 'X');
      const pickY   = choose(arr, 'Y');
      const pickZ   = choose(arr, 'Z');
      const pickROC = arr.find(s => /rate|roc|dH\/dt|dhdt/i.test(`${s.series?.name} ${s.series?.aspect}`));
      out[st] = { H: pickH, X: pickX, Y: pickY, Z: pickZ, dHdt: pickROC };
    });
    return out;
  };

  const fetchNZMagForStation = async (station: string): Promise<NZMagSeries | null> => {
    try {
      // 1) Discover available series for the station
      const sumUrl = `${TILDE_BASE}/dataSummary/${TILDE_DOMAIN}?station=${station}`;
      const sumRes = await fetch(sumUrl);
      if (!sumRes.ok) throw new Error(`Summary ${station} ${sumRes.status}`);
      const summary = await sumRes.json();

      const picks = pickSeriesFromSummary(summary);
      const sel = picks[station] || {};
      // Prefer H or (X,Y) for H derivation; if dHdt exists, we’ll fetch it too.
      const want: Array<{ label: 'H' | 'X' | 'Y' | 'Z' | 'dHdt'; s?: any }> = [
        { label: 'H',    s: sel.H },
        { label: 'X',    s: sel.X },
        { label: 'Y',    s: sel.Y },
        { label: 'Z',    s: sel.Z },
        { label: 'dHdt', s: sel.dHdt },
      ].filter(x => x.s);

      if (!want.length) return null;

      // 2) Build data URLs (latest 6h) for each chosen series
      const urls = want.map(w => {
        const { station: st, name, sensorCode, method, aspect } = w.s.series;
        return {
          label: w.label,
          url: `${TILDE_BASE}/data/${TILDE_DOMAIN}/${st}/${name}/${sensorCode}/${method}/${aspect}/latest/6h`
        };
      });

      const results = await Promise.allSettled(urls.map(u => fetch(u.url)));
      const jsons = await Promise.all(results.map(async (r, i) => {
        if (r.status !== 'fulfilled' || !r.value.ok) return { label: urls[i].label, data: [] };
        const j = await r.value.json();
        const points = j?.[0]?.data || j?.data || []; // API may return array (matched series) or single
        return { label: urls[i].label, data: points.map((p: any) => ({ ts: +new Date(p.ts), val: p.val })) };
      }));

      // 3) Merge by timestamp
      const byTs = new Map<number, NZMagRow>();
      const add = (label: string, arr: any[]) => {
        for (const p of arr) {
          const row = byTs.get(p.ts) || { t: p.ts };
          if (label === 'H') row.H = p.val;
          if (label === 'X') row.X = p.val;
          if (label === 'Y') row.Y = p.val;
          if (label === 'Z') row.Z = p.val;
          if (label === 'dHdt') row.dHdt = p.val;
          byTs.set(p.ts, row);
        }
      };
      jsons.forEach(j => add(j.label, j.data));
      let rows = Array.from(byTs.values()).sort((a,b) => a.t - b.t);

      // Derive H if missing
      if (!rows.some(r => typeof r.H === 'number')) {
        rows = rows.map(r => {
          if (typeof r.X === 'number' && typeof r.Y === 'number') {
            return { ...r, H: Math.sqrt(r.X*r.X + r.Y*r.Y) };
          }
          return r;
        });
      }
      // Derive dH/dt if missing (per minute)
      if (!rows.some(r => typeof r.dHdt === 'number')) {
        rows = rows.map((r, idx) => {
          if (idx === 0) return { ...r, dHdt: null };
          const prev = rows[idx-1];
          if (typeof r.H === 'number' && typeof prev.H === 'number') {
            const dtm = (r.t - prev.t) / 60000;
            const dh = r.H - prev.H;
            return { ...r, dHdt: dtm > 0 ? dh / dtm : null };
          }
          return { ...r, dHdt: null };
        });
      }

      return { station: station as NZMagSeries['station'], rows };
    } catch (e) {
      console.warn('NZMag fetch failed for', station, e);
      return null;
    }
  };

  /** Detect a local onset-like burst using dH/dt statistics (minute cadence proxy for Pi2/rapid expansion) */
  const detectNZOnset = (series: NZMagSeries[]): { onset: boolean; t?: number; strength?: number } => {
    const now = Date.now();
    const since = now - 60 * 60_000; // last hour
    const windows = series.map(s => {
      const last = s.rows.filter(r => r.t >= since && typeof r.dHdt === 'number') as Array<NZMagRow & { dHdt: number }>;
      const abs = last.map(r => Math.abs(r.dHdt));
      if (!abs.length) return { max: 0, t: undefined as number | undefined };
      let max = 0; let t = undefined as number | undefined;
      for (const r of last) {
        const a = Math.abs(r.dHdt);
        if (a > max) { max = a; t = r.t; }
      }
      const p95 = abs.slice().sort((a,b) => a-b)[Math.floor(0.95 * (abs.length-1))] || 0;
      return { max, p95, t };
    });

    // Combine stations: if any exceeds both an absolute floor and local percentile, declare onset-like.
    const ABS_FLOOR = 20; // nT/min (1-min cadence). Tweak later if needed.
    let strongest = { onset: false, t: undefined as number | undefined, strength: 0 };
    for (const w of windows) {
      if (!w.t) continue;
      if (w.max >= ABS_FLOOR && w.max >= (w.p95 ?? 0)) {
        if (w.max > (strongest.strength ?? 0)) strongest = { onset: true, t: w.t, strength: w.max };
      }
    }
    return strongest;
  };

  /* =========================
     Fuse L1 + GOES + NZ mags -> forecast
     ========================= */
  const goesOnsetRef = useRef<boolean>(false);
  const nzOnsetRef   = useRef<boolean>(false);

  const fuseForecast = useCallback((opts: {
    l1: ReturnType<typeof recentL1Data>;
    goesOnset: boolean;
    nzSeries: NZMagSeries[];
    currentScore: number | null;
  }) => {
    const { l1, goesOnset, nzSeries, currentScore } = opts;
    if (!l1) return;

    // Probabilities from L1 drivers
    const probs = probabilityModel(l1.dPhiNow, l1.dPhiMean15, l1.bzMean15);

    // Local onset-like check
    const nzLocal = detectNZOnset(nzSeries); // {onset, t, strength}
    const nzOnset = !!nzLocal.onset;

    // Status gates
    const P30_ALERT = 0.60, P60_ALERT = 0.60;
    let status: Status = 'QUIET';

    if (goesOnset || nzOnset) {
      status = "ONSET";
    } else if (l1.sustained && probs.P30 >= P30_ALERT && (currentScore ?? 0) >= 25) {
      status = "IMMINENT_30";
    } else if (l1.sustained && probs.P60 >= P60_ALERT && (currentScore ?? 0) >= 20) {
      status = "LIKELY_60";
    } else if (l1.sustained && l1.dPhiNow >= (movingAvg(l1.dPhiSeries, 60) ?? 0) && (currentScore ?? 0) >= 15) {
      status = "WATCH";
    }

    // Likelihood (weighted P60>P30) with local-confirmation bump
    let likelihood = Math.round((0.4 * clamp01(probs.P30) + 0.6 * clamp01(probs.P60)) * 100);
    if (nzOnset) likelihood = Math.min(95, Math.max(likelihood, 75));
    if (goesOnset) likelihood = Math.min(95, Math.max(likelihood, 80));

    // Build a precise window label (NZ local time)
    const now = Date.now();
    const eta = (() => {
      if (status === 'ONSET') {
        const t0 = nzOnset ? (nzLocal.t ?? now) : now;
        return { start: t0, end: t0 + 10*60_000, label: `Now – ${nzTime(t0 + 10*60_000)}` };
      }
      // crude ballistic lead from L1 (minutes); 1 AU* is 1.5e6 km, bow-shock ~45-60 min at 400 km/s
      const V = l1.Vnow ?? 400;
      const ballistic = Math.round(1800 / Math.max(250, Math.min(800, V))); // 1800 ~ 30 min scaled
      if (status === 'IMMINENT_30') {
        const start = now + Math.max(3, ballistic - 10) * 60_000;
        const end   = start + 30*60_000;
        return { start, end, label: `${nzTime(start)} – ${nzTime(end)}` };
      }
      if (status === 'LIKELY_60') {
        const start = now + Math.max(10, ballistic) * 60_000;
        const end   = start + 50*60_000;
        return { start, end, label: `${nzTime(start)} – ${nzTime(end)}` };
      }
      if (status === 'WATCH') {
        const start = now + Math.max(20, ballistic + 10) * 60_000;
        const end   = start + 70*60_000;
        return { start, end, label: `${nzTime(start)} – ${nzTime(end)}` };
      }
      const start = now + 60*60_000, end = start + 60*60_000;
      return { start, end, label: '30 – 90 min' };
    })();

    // What to expect (user POV): combine SpotTheAurora score + local |dH/dt| strength if present
    const s = Math.max(0, Math.min(100, Math.round(currentScore ?? 0)));
    const localKick = nzOnset ? (nzLocal.strength ?? 0) : 0;
    let expect = 'Low chance for now.';
    if (status === 'ONSET') {
      if (s >= 80 || localKick >= 60) expect = 'Active substorm — dynamic curtains and vivid colors likely. Look south to high sky.';
      else if (s >= 50 || localKick >= 30) expect = 'Eruption underway — clear green band with pulses; colors likely in darker skies.';
      else expect = 'Substorm starting — faint band brightening; check southern horizon and wait for intensification.';
    } else if (status === 'IMMINENT_30') {
      expect = s >= 80 ? 'High chance of a bright burst soon — be outside and ready.' :
               s >= 50 ? 'Good chance of color and motion within ~30 min.' :
                         'Likely band brightening soon; dark skies will help.';
    } else if (status === 'LIKELY_60') {
      expect = s >= 50 ? 'Elevated chance of visible color this hour.' : 'Some activity likely; watch for a low southern glow.';
    } else if (status === 'WATCH') {
      expect = 'Energy is loading — conditions may tip into an eruption if driving persists.';
    }

    // Action text
    let action = 'Low chance for now.';
    if (status === 'ONSET') action = "Look now — activity is underway.";
    else if (status === "IMMINENT_30" || likelihood >= 65) action = "Head outside or to a darker spot now.";
    else if (status === "LIKELY_60"   || likelihood >= 50) action = "Prepare to go; check the sky within the next hour.";
    else if (status === "WATCH") action = "Energy is building in Earth's magnetic field. The forecast will upgrade to an Alert if an eruption becomes likely.";

    setSubstormForecast({
      status,
      likelihood,
      windowLabel: eta.label,
      action: `${action} ${expect}`,
      p30: probs.P30,
      p60: probs.P60,
    });

    // Update banner (unchanged)
    setSubstormActivityStatus({
      isStretching: status === 'WATCH' || status === 'LIKELY_60' || status === 'IMMINENT_30',
      isErupting: status === 'ONSET',
      probability: likelihood,
      predictedStartTime: eta.start,
      predictedEndTime: eta.end,
      text: action,
      color: ''
    });

    goesOnsetRef.current = goesOnset;
    nzOnsetRef.current   = nzOnset;
  }, [setSubstormActivityStatus]);

  /* =========================
     Fetch block
     ========================= */
  const fetchAllData = useCallback(async (isInitialLoad = false, getGaugeStyle: Function) => {
    if (isInitialLoad) setIsLoading(true);

    // Core data (yours)
    const results = await Promise.allSettled([
      fetch(`${FORECAST_API_URL}?_=${Date.now()}`).then(res => res.json()),
      fetch(`${NOAA_PLASMA_URL}?_=${Date.now()}`).then(res => res.json()),
      fetch(`${NOAA_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
      fetch(`${NOAA_GOES18_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
      fetch(`${NOAA_GOES19_MAG_URL}?_=${Date.now()}`).then(res => res.json()),
      fetch(`${NASA_IPS_URL}?_=${Date.now()}`).then(res => res.json())
    ]);
    const [forecastResult, plasmaResult, magResult, goes18Result, goes19Result, ipsResult] = results;

    // Current forecast & gauges
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
      setGaugeData(prev => ({
        ...prev,
        bt: { ...prev.bt, value: bt?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bt, 'bt'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
        bz: { ...prev.bz, value: bz?.toFixed(1) ?? 'N/A', ...getGaugeStyle(bz, 'bz'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
        power: { ...prev.power, value: currentForecast?.inputs?.hemisphericPower?.toFixed(1) ?? 'N/A', ...getGaugeStyle(currentForecast?.inputs?.hemisphericPower ?? null, 'power'), lastUpdated: `Updated: ${formatNZTimestamp(currentForecast?.lastUpdated ?? 0)}` },
        moon: getMoonData(currentForecast?.moon?.illumination ?? null, currentForecast?.moon?.rise ?? null, currentForecast?.moon?.set ?? null, owmDailyForecast || [])
      }));
      if (Array.isArray(historicalData)) setAuroraScoreHistory(historicalData.filter((d: any) => d.timestamp != null && d.baseScore != null).sort((a, b) => a.timestamp - b.timestamp)); else setAuroraScoreHistory([]);
      if (Array.isArray(rawHistory)) setHemisphericPowerHistory(rawHistory.filter((d: any) => d.timestamp && d.hemisphericPower && !isNaN(d.hemisphericPower)).map((d: RawHistoryRecord) => ({ timestamp: d.timestamp, hemisphericPower: d.hemisphericPower })).sort((a:any, b:any) => a.timestamp - b.timestamp)); else setHemisphericPowerHistory([]);
    }

    // L1 plasma
    if (plasmaResult.status === 'fulfilled' && Array.isArray(plasmaResult.value) && plasmaResult.value.length > 1) {
      const plasmaData = plasmaResult.value; const headers = plasmaData[0]; const speedIdx = headers.indexOf('speed'); const densityIdx = headers.indexOf('density'); const timeIdx = headers.indexOf('time_tag');
      const processed = plasmaData.slice(1).map((r:any[]) => {
        if (!r || !r[timeIdx]) return null;
        return {
          time: new Date(r[timeIdx].replace(' ', 'T') + 'Z').getTime(),
          speed: parseFloat(r[speedIdx]) > -9999 ? parseFloat(r[speedIdx]) : null,
          density: parseFloat(r[densityIdx]) > -9999 ? parseFloat(r[densityIdx]) : null
        }
      }).filter(Boolean);
      setAllSpeedData(processed.map(p => ({ x: p.time, y: p.speed })));
      setAllDensityData(processed.map(p => ({ x: p.time, y: p.density })));
      const latest = plasmaData.slice(1).reverse().find((r: any[]) => parseFloat(r?.[speedIdx]) > -9999);
      const speedVal = latest ? parseFloat(latest[speedIdx]) : null;
      const densityVal = latest ? parseFloat(latest[densityIdx]) : null;
      const time = latest?.[timeIdx] ? new Date(latest[timeIdx].replace(' ', 'T') + 'Z').getTime() : Date.now();
      setGaugeData(prev => ({
        ...prev,
        speed:  {...prev.speed,  value: speedVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(speedVal, 'speed'),   lastUpdated: `Updated: ${formatNZTimestamp(time)}`},
        density:{...prev.density,value: densityVal?.toFixed(1) ?? 'N/A', ...getGaugeStyle(densityVal, 'density'), lastUpdated: `Updated: ${formatNZTimestamp(time)}`}
      }));
    }

    // L1 magnetic
    if (magResult.status === 'fulfilled' && Array.isArray(magResult.value) && magResult.value.length > 1) {
      const magData = magResult.value; const headers = magData[0]; const btIdx = headers.indexOf('bt'); const bzIdx = headers.indexOf('bz_gsm'); const timeIdx = headers.indexOf('time_tag');
      const byIdx = headers.indexOf('by_gsm');
      const processed = magData.slice(1).map((r: any[]) => {
        if (!r || !r[timeIdx]) return null;
        return {
          time: new Date(r[timeIdx].replace(' ', 'T') + 'Z').getTime(),
          bt: parseFloat(r[btIdx]) > -9999 ? parseFloat(r[btIdx]) : null,
          bz: parseFloat(r[bzIdx]) > -9999 ? parseFloat(r[bzIdx]) : null,
          by: byIdx > -1 && parseFloat(r[byIdx]) > -9999 ? parseFloat(r[byIdx]) : null
        }
      }).filter(Boolean);
      setAllMagneticData(processed);
    }

    // GOES
    let anyGoesDataFound = false;
    if (goes18Result.status === 'fulfilled' && Array.isArray(goes18Result.value)) {
      const processed = goes18Result.value
        .filter((d: any) => d.Hp != null && !isNaN(d.Hp))
        .map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp }))
        .sort((a, b) => a.time - b.time);
      setGoes18Data(processed);
      if (processed.length > 0) anyGoesDataFound = true;
    }
    if (goes19Result.status === 'fulfilled' && Array.isArray(goes19Result.value)) {
      const processed = goes19Result.value
        .filter((d: any) => d.Hp != null && !isNaN(d.Hp))
        .map((d: any) => ({ time: new Date(d.time_tag).getTime(), hp: d.Hp }))
        .sort((a, b) => a.time - b.time);
      setGoes19Data(processed);
      if (processed.length > 0) anyGoesDataFound = true;
    }
    if (!anyGoesDataFound) setLoadingMagnetometer('No valid GOES Magnetometer data available.'); else setLoadingMagnetometer(null);

    // IPS
    if (ipsResult.status === 'fulfilled' && Array.isArray(ipsResult.value)) setInterplanetaryShockData(ipsResult.value);
    else setInterplanetaryShockData([]);

    // NEW: NZ magnetometers (parallel)
    try {
      const nzResults = await Promise.allSettled(NZ_MAG_STATIONS.map(s => fetchNZMagForStation(s)));
      const ok = nzResults
        .map(r => (r.status === 'fulfilled' ? r.value : null))
        .filter((x): x is NZMagSeries => !!x && x.rows?.length > 0);
      setNzMagSeries(ok);
      setLoadingNZMag(ok.length ? null : 'No NZ magnetometer data found.');
    } catch (e) {
      setLoadingNZMag('Failed to load NZ magnetometers.');
    }

    if (isInitialLoad) setIsLoading(false);
  }, [locationAdjustment, getMoonData]);

  /* =========================
     Geo-location offset
     ========================= */
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
        () => setLocationBlurb('Location unavailable. Showing default forecast for Greymouth.'),
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
    if (sun?.rise && sun?.set) setIsDaylight(now > sun.rise && now < sun.set);
    else setIsDaylight(false);
  }, [celestialTimes, lastUpdated]);

  /* =========================
     Drive the fused forecast each tick
     ========================= */
  useEffect(() => {
    fetchAllData(true, () => ({}));
    const interval = setInterval(() => fetchAllData(false, () => ({})), REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!recentL1Data) return;
    fuseForecast({
      l1: recentL1Data,
      goesOnset,
      nzSeries: nzMagSeries,
      currentScore: auroraScore
    });
  }, [recentL1Data, goesOnset, nzMagSeries, auroraScore, fuseForecast]);

  /* =========================
     Expose to components
     ========================= */
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

    substormForecast, // upgraded: precise window & expectation baked into action

    auroraScoreHistory,
    hemisphericPowerHistory,
    dailyCelestialHistory,
    owmDailyForecast,
    interplanetaryShockData,
    locationBlurb,

    // NEW: NZ magnetometer data & loading message (for the hidden graph box)
    nzMagSeries,
    loadingNZMag,

    fetchAllData,
  };
};

//--- END OF FILE src/hooks/useForecastData.ts ---
