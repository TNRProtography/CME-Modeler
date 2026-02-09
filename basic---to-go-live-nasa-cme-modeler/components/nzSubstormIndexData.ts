import { useEffect, useState } from 'react';

const TILDE_BASE = 'https://tilde.geonet.org.nz/v4';
const SOLAR_WIND_IMF_URL = 'https://imap-solar-data-test.thenamesrock.workers.dev/';
const DOMAIN = 'geomag';
const SCALE_FACTOR = 100;
const DISPLAY_DIVISOR = 10;
const AGGREGATION_MINUTES = 5;
export const CHART_LOOKBACK_HOURS = 24;
const BASELINE_WINDOW_MINUTES = 180;

// Geographic Config
const OBAN_LAT = -46.9;
const AKL_LAT = -36.85;
const LAT_DELTA = AKL_LAT - OBAN_LAT;

// Thresholds (Display Units)
const REQ_CAM = { start: -300, end: -1000 };
const REQ_PHN = { start: -450, end: -1100 };
const REQ_EYE = { start: -800, end: -1500 };

export interface NzTown {
  name: string;
  lat: number;
  lon: number;
  cam?: string;
  phone?: string;
  eye?: string;
}

export const NZ_TOWNS: NzTown[] = [
  { name: 'Oban', lat: -46.9, lon: 168.12 },
  { name: 'Invercargill', lat: -46.41, lon: 168.35 },
  { name: 'Dunedin', lat: -45.87, lon: 170.5 },
  { name: 'Queenstown', lat: -45.03, lon: 168.66 },
  { name: 'Wānaka', lat: -44.7, lon: 169.12 },
  { name: 'Twizel', lat: -44.26, lon: 170.1 },
  { name: 'Timaru', lat: -44.39, lon: 171.25 },
  { name: 'Christchurch', lat: -43.53, lon: 172.63 },
  { name: 'Kaikōura', lat: -42.4, lon: 173.68 },
  { name: 'Greymouth', lat: -42.45, lon: 171.2 },
  { name: 'Nelson', lat: -41.27, lon: 173.28 },
  { name: 'Wellington', lat: -41.29, lon: 174.77 },
  { name: 'Palmerston Nth', lat: -40.35, lon: 175.6 },
  { name: 'Napier', lat: -39.49, lon: 176.91 },
  { name: 'Taupō', lat: -38.68, lon: 176.07 },
  { name: 'Tauranga', lat: -37.68, lon: 176.16 },
  { name: 'Auckland', lat: -36.85, lon: 174.76 },
  { name: 'Whangārei', lat: -35.72, lon: 174.32 },
];

export interface NzSubstormIndexData {
  strength: number;
  slope: number;
  points: { t: number; v: number }[];
  towns: NzTown[];
  outlook: string;
  solarWind: { bz: number; speed: number };
  solarWindSource?: string;
  trends: { m5: number };
  stationCount: number;
  lastUpdated: number | null;
}

const parseIso = (ts: string | number) => {
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

const getSourceLabel = (source?: string | null) => {
  if (!source) return '—';
  return source.includes('IMAP') ? 'IMAP' : 'NOAA RTSW';
};

export const calculateReachLatitude = (strengthNt: number, mode: 'camera' | 'phone' | 'eye') => {
  if (strengthNt >= 0) return -65.0;
  const curve = mode === 'phone' ? REQ_PHN : mode === 'eye' ? REQ_EYE : REQ_CAM;
  const slope = (curve.end - curve.start) / LAT_DELTA;
  const lat = OBAN_LAT + (strengthNt - curve.start) / slope;
  return Math.max(-48, Math.min(-34, lat));
};

const getTownStatus = (town: NzTown, currentStrength: number, category: 'camera' | 'phone' | 'eye') => {
  if (currentStrength >= 0) return undefined;
  const reqs = category === 'phone' ? REQ_PHN : category === 'eye' ? REQ_EYE : REQ_CAM;
  const slope = (reqs.end - reqs.start) / LAT_DELTA;
  const required = reqs.start + (town.lat - OBAN_LAT) * slope;

  if (currentStrength <= required) {
    const excess = Math.abs(currentStrength) - Math.abs(required);
    if (excess < 50) return 'red';
    if (excess < 150) return 'yellow';
    return 'green';
  }
  return undefined;
};

const getVisibleTowns = (strength: number): NzTown[] =>
  NZ_TOWNS.map((town) => ({
    ...town,
    cam: getTownStatus(town, strength, 'camera'),
    phone: getTownStatus(town, strength, 'phone'),
    eye: getTownStatus(town, strength, 'eye'),
  }));

const getProjectedBaseline = (samples: Array<{ t: number; val: number }>, targetTime: number) => {
  const endWindow = targetTime - 5 * 60000;
  const startWindow = targetTime - BASELINE_WINDOW_MINUTES * 60000;
  const windowPoints: Array<{ t: number; val: number }> = [];
  for (let i = samples.length - 1; i >= 0; i--) {
    const t = samples[i].t;
    if (t > endWindow) continue;
    if (t < startWindow) break;
    windowPoints.push(samples[i]);
  }
  if (windowPoints.length < 10) return null;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  const n = windowPoints.length;
  for (let i = 0; i < n; i++) {
    const x = (windowPoints[i].t - startWindow) / 60000;
    const y = windowPoints[i].val;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const targetX = (targetTime - startWindow) / 60000;
  return slope * targetX + intercept;
};

const selectNorthSeriesKey = (stationCode: string, stationData: any) => {
  if (!stationData?.sensorCodes) return null;
  const aspectPriority = ['X', 'north', 'N', 'x', 'nil'];
  const nameMatches = (name: string) => {
    const lower = name.toLowerCase();
    return lower.includes('north') || lower === 'x' || lower.includes('magnetic-field');
  };

  const seriesCandidates: string[] = [];

  for (const sensorCode of Object.keys(stationData.sensorCodes)) {
    const names = stationData.sensorCodes[sensorCode]?.names;
    if (!names) continue;
    for (const name of Object.keys(names)) {
      if (!nameMatches(name)) continue;
      const methods = names[name]?.methods;
      if (!methods) continue;
      for (const method of Object.keys(methods)) {
        if (!method.includes('60s') && !method.includes('1m')) continue;
        const aspects = methods[method]?.aspects;
        if (!aspects) continue;
        for (const aspect of aspectPriority) {
          if (aspects[aspect]) {
            return `${stationCode}/${name}/${sensorCode}/${method}/${aspect}`;
          }
        }
        const fallbackAspect = Object.keys(aspects)[0];
        if (fallbackAspect) {
          seriesCandidates.push(`${stationCode}/${name}/${sensorCode}/${method}/${fallbackAspect}`);
        }
      }
    }
  }

  return seriesCandidates[0] ?? null;
};

export const useNzSubstormIndexData = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<NzSubstormIndexData | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const summaryRes = await fetch(`${TILDE_BASE}/dataSummary/${DOMAIN}`);
        const summary = await summaryRes.json();
        const stations = summary?.domain?.[DOMAIN]?.stations ?? {};
        const stationEntries = Object.keys(stations)
          .map((stationCode) => ({
            stationCode,
            seriesKey: selectNorthSeriesKey(stationCode, stations[stationCode]),
          }))
          .filter((entry) => entry.seriesKey);
        if (stationEntries.length === 0) throw new Error('No magnetometer stations found.');

        const aggregationParams = `aggregationPeriod=${AGGREGATION_MINUTES}m&aggregationFunction=mean`;
        const [stationSeries, solarWindRes] = await Promise.all([
          Promise.all(
            stationEntries.map(async (entry) => {
              const tildeUrl = `${TILDE_BASE}/data/${DOMAIN}/${entry.seriesKey}/latest/2d?${aggregationParams}`;
              const res = await fetch(tildeUrl);
              const series = await res.json();
              return { station: entry.stationCode, seriesKey: entry.seriesKey, data: series };
            })
          ),
          fetch(SOLAR_WIND_IMF_URL),
        ]);
        const solarWindData = await solarWindRes.json();

        const now = Date.now();
        const chartCutoff = now - CHART_LOOKBACK_HOURS * 3600 * 1000;
        const bucketMs = AGGREGATION_MINUTES * 60000;
        const combinedMap = new Map<number, number[]>();
        let latestTimestamp: number | null = null;

        const validStationCount = stationSeries.reduce((count, stationSeriesEntry) => {
          const rawSamples = (stationSeriesEntry.data[0]?.data || [])
            .map((d: any) => ({ t: parseIso(d.ts), val: d.val }))
            .filter((d: any) => d.t && d.val != null)
            .sort((a: any, b: any) => a.t - b.t);
          if (rawSamples.length < 10) return count;

          for (let i = 0; i < rawSamples.length; i++) {
            if (rawSamples[i].t < chartCutoff - BASELINE_WINDOW_MINUTES * 60000) continue;
            const base = getProjectedBaseline(rawSamples, rawSamples[i].t);
            if (base === null) continue;

            let s = (rawSamples[i].val - base) * SCALE_FACTOR;
            if (s > 0 && s < 1500) s = s * 0.1;
            s = clamp(s, -250000, 250000);

            const bucket = Math.round(rawSamples[i].t / bucketMs) * bucketMs;
            if (bucket < chartCutoff) continue;
            const existing = combinedMap.get(bucket) ?? [];
            existing.push(s);
            combinedMap.set(bucket, existing);
            if (!latestTimestamp || bucket > latestTimestamp) {
              latestTimestamp = bucket;
            }
          }
          return count + 1;
        }, 0);

        const points = Array.from(combinedMap.entries())
          .map(([t, values]) => ({ t, v: Math.min(...values) / DISPLAY_DIVISOR }))
          .sort((a, b) => a.t - b.t);

        if (points.length < 10) throw new Error('Insufficient Ground Data');

        const currentPoint = points[points.length - 1];
        const currentStrength = currentPoint.v;

        const slopeWindowMs = 20 * 60000;
        const slopeStart = currentPoint.t - slopeWindowMs;
        const slopeSet = points.filter((s: any) => s.t >= slopeStart);
        let slope = 0;
        if (slopeSet.length > 1) {
          const first = slopeSet[0];
          const dt = (currentPoint.t - first.t) / 60000;
          if (dt > 0) slope = (currentPoint.v - first.v) / dt;
        }

        let bz = 0;
        let speed = 0;
        let solarWindSource = '—';
        if (solarWindData?.ok && Array.isArray(solarWindData.data)) {
          const latestEntry = [...solarWindData.data].reverse().find((entry: any) => entry && entry.speed != null && entry.bz != null);
          if (latestEntry) {
            bz = Number(latestEntry.bz) || 0;
            speed = Number(latestEntry.speed) || 0;
            solarWindSource = getSourceLabel(latestEntry?.src?.bz ?? latestEntry?.src?.speed);
          }
        }

        let outlook = '';
        const delay = speed > 0 ? Math.round(1500000 / speed / 60) : 60;
        if (bz < -15 && speed > 500) outlook = `⚠️ WARNING: Severe shock (Bz ${bz}, ${speed}km/s). Major impact in ${delay} mins.`;
        else if (bz < -10) outlook = `🚨 Incoming: Strong negative field (Bz ${bz}). Intensification in ${delay} mins.`;
        else if (bz < -5) outlook = `📡 Watch: Favorable wind (Bz ${bz}). Substorm building, arrival ~${delay} mins.`;
        else if (currentStrength < -200 / DISPLAY_DIVISOR) outlook = '👀 Ground: Active conditions detected.';
        else outlook = '🌙 Quiet: Currently quiet.';

        const towns = getVisibleTowns(currentStrength);

        setData({
          strength: currentStrength,
          slope,
          points,
          towns,
          outlook,
          solarWind: { bz, speed },
          solarWindSource,
          trends: {
            m5: currentStrength,
          },
          stationCount: validStationCount,
          lastUpdated: latestTimestamp,
        });
        setLoading(false);
      } catch (e) {
        console.error('NZ Substorm Fetch Error', e);
        setLoading(false);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, []);

  return { data, loading };
};
