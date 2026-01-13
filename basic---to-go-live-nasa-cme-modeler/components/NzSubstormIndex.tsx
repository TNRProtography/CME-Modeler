import React, { useCallback, useEffect, useRef, useState } from 'react';

const TILDE_BASE = 'https://tilde.geonet.org.nz/v4';
const NOAA_RTSW_MAG = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_mag_1m.json';
const NOAA_RTSW_WIND = 'https://services.swpc.noaa.gov/json/rtsw/rtsw_wind_1m.json';
const DOMAIN = 'geomag';
const SCALE_FACTOR = 100;
const DISPLAY_DIVISOR = 100;
const AGGREGATION_MINUTES = 5;
const CHART_LOOKBACK_HOURS = 24;
const BASELINE_WINDOW_MINUTES = 180;

// Geographic Config
const OBAN_LAT = -46.9;
const AKL_LAT = -36.85;
const LAT_DELTA = AKL_LAT - OBAN_LAT;

// Thresholds (Display Units)
const REQ_CAM = { start: -300 / DISPLAY_DIVISOR, end: -800 / DISPLAY_DIVISOR };
const REQ_PHN = { start: -350 / DISPLAY_DIVISOR, end: -900 / DISPLAY_DIVISOR };
const REQ_EYE = { start: -500 / DISPLAY_DIVISOR, end: -1200 / DISPLAY_DIVISOR };

interface NzTown {
  name: string;
  lat: number;
  lon: number;
  cam?: string;
  phone?: string;
  eye?: string;
}

const NZ_TOWNS: NzTown[] = [
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

const parseIso = (ts: string | number) => {
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

const calculateReachLatitude = (strengthNt: number, mode: 'camera' | 'phone' | 'eye') => {
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
    if (excess < 100) return 'yellow';
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

interface NzSubstormIndexData {
  strength: number;
  slope: number;
  points: { t: number; v: number }[];
  towns: NzTown[];
  outlook: string;
  trends: { m5: number };
  stationCount: number;
  lastUpdated: number | null;
}

const NzSubstormIndex: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<NzSubstormIndexData | null>(null);
  const [chartRange, setChartRange] = useState(CHART_LOOKBACK_HOURS);
  const [hoverData, setHoverData] = useState<any>(null);
  const chartRef = useRef<HTMLDivElement>(null);

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
        const noaaMagUrl = NOAA_RTSW_MAG;
        const noaaWindUrl = NOAA_RTSW_WIND;

        const [stationSeries, magRes, windRes] = await Promise.all([
          Promise.all(
            stationEntries.map(async (entry) => {
              const tildeUrl = `${TILDE_BASE}/data/${DOMAIN}/${entry.seriesKey}/latest/2d?${aggregationParams}`;
              const res = await fetch(tildeUrl);
              const series = await res.json();
              return { station: entry.stationCode, seriesKey: entry.seriesKey, data: series };
            })
          ),
          fetch(noaaMagUrl),
          fetch(noaaWindUrl),
        ]);

        const magData = await magRes.json();
        const windData = await windRes.json();

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

        const lastMag = magData[magData.length - 1];
        const lastWind = windData[windData.length - 1];
        const bz = lastMag ? parseFloat(lastMag.bz_gsm) : 0;
        const speed = lastWind ? parseFloat(lastWind.speed) : 0;

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

  const handleMouseMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!data || !chartRef.current) return;
      const rect = chartRef.current.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
      const x = clientX - rect.left;
      const w = rect.width;

      const now = Date.now();
      const cutoff = now - chartRange * 3600 * 1000;
      const activePoints = data.points.filter((p: any) => p.t >= cutoff);
      if (activePoints.length === 0) return;

      const ratio = x / w;
      const tMin = activePoints[0].t;
      const tMax = activePoints[activePoints.length - 1].t;
      const timeAtCursor = tMin + ratio * (tMax - tMin);

      let closest = activePoints[0];
      let minDiff = Math.abs(timeAtCursor - closest.t);
      for (let i = 1; i < activePoints.length; i++) {
        const diff = Math.abs(timeAtCursor - activePoints[i].t);
        if (diff < minDiff) {
          minDiff = diff;
          closest = activePoints[i];
        }
      }
      setHoverData({ x, closest });
    },
    [data, chartRange]
  );

  if (loading) return <div className="h-64 flex items-center justify-center text-neutral-500">Initializing NZ Ground Systems...</div>;
  if (!data) return <div className="h-64 flex items-center justify-center text-red-400">System Offline</div>;

  const activePoints = data.points.filter((p: any) => p.t >= Date.now() - chartRange * 3600 * 1000);
  const vals = activePoints.map((p: any) => p.v);
  let vMin = Math.min(...vals);
  let vMax = Math.max(...vals);
  if (vMax < 1000) vMax = 1000;
  if (vMin > -1000) vMin = -1000;
  const range = vMax - vMin;
  vMax += range * 0.1;
  vMin -= range * 0.1;

  const getX = (t: number) =>
    ((t - activePoints[0].t) / (activePoints[activePoints.length - 1].t - activePoints[0].t)) * 100;
  const getY = (v: number) => 100 - ((v - vMin) / (vMax - vMin)) * 100;

  let pathD = '';
  if (activePoints.length > 0) {
    pathD = `M ${getX(activePoints[0].t)} ${getY(activePoints[0].v)} ` +
      activePoints.map((p: any) => `L ${getX(p.t)} ${getY(p.v)}`).join(' ');
  }

  const renderMap = () => {
    const w = 300;
    const h = 400;
    const Y = (lat: number) => ((lat - -34.0) / (-47.5 - -34.0)) * h;
    const X = (lon: number) => ((lon - 166.0) / (179.0 - 166.0)) * w;

    const southIslandPath =
      'M 116 328 L 96 306 L 92 288 L 103 272 L 118 260 L 130 242 L 139 226 L 152 214 L 162 198 L 166 180 L 160 166 L 148 156 L 140 142 L 134 126 L 122 120 L 112 130 L 104 148 L 98 170 L 90 192 L 82 214 L 74 238 L 72 256 L 78 276 L 86 294 L 98 314 L 110 332 Z';
    const northIslandPath =
      'M 178 176 L 188 166 L 198 152 L 206 136 L 212 118 L 214 102 L 208 88 L 200 78 L 196 62 L 190 50 L 184 42 L 176 44 L 170 56 L 166 74 L 166 94 L 168 114 L 170 132 L 170 150 L 172 164 Z';

    const lCam = calculateReachLatitude(data.strength, 'camera');
    const lPhn = calculateReachLatitude(data.strength, 'phone');
    const lEye = calculateReachLatitude(data.strength, 'eye');

    const yCam = Y(lCam);
    const yPhn = Y(lPhn);
    const yEye = Y(lEye);

    return (
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-full opacity-90">
        <path d={southIslandPath} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" />
        <path d={northIslandPath} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" />

        {data.towns.map((t: NzTown, i: number) => {
          let fill = '#555';
          let r = 2;
          if (t.cam) {
            fill = '#4ade80';
            r = 3;
          }
          if (t.phone) {
            fill = '#38bdf8';
            r = 3.5;
          }
          if (t.eye) {
            fill = '#facc15';
            r = 4;
          }
          return <circle key={i} cx={X(t.lon)} cy={Y(t.lat)} r={r} fill={fill} />;
        })}

        {yCam < h && (
          <line x1="0" y1={yCam} x2={w} y2={yCam} stroke="#4ade80" strokeDasharray="4" strokeWidth="1">
            <title>Camera</title>
          </line>
        )}
        {yPhn < h && (
          <line x1="0" y1={yPhn} x2={w} y2={yPhn} stroke="#38bdf8" strokeDasharray="4" strokeWidth="1">
            <title>Phone</title>
          </line>
        )}
        {yEye < h && (
          <line x1="0" y1={yEye} x2={w} y2={yEye} stroke="#facc15" strokeDasharray="4" strokeWidth="1">
            <title>Eye</title>
          </line>
        )}
      </svg>
    );
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-4 bg-neutral-950 p-4 rounded-xl border border-neutral-800">
      <div className="md:col-span-12 flex flex-col md:flex-row md:justify-between md:items-center pb-2 border-b border-neutral-800 gap-2">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <span className="text-sky-400">SPOT THE AURORA</span> / NZ SUBSTORM INDEX
        </h2>
        <div className="text-xs text-neutral-500">
          GeoNet Magnetometers ({data.stationCount} stations) + RTSW
          {data.lastUpdated && (
            <span className="block md:inline md:ml-2">Updated {new Date(data.lastUpdated).toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      <div className="md:col-span-4 bg-neutral-900/50 rounded-lg p-6 flex flex-col justify-center items-center relative overflow-hidden border border-neutral-800">
        <div className="text-sm font-bold text-neutral-400 uppercase tracking-widest mb-2">Current Activity</div>
        <div
          className="text-6xl font-black text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.2)]"
          style={{ color: data.strength < -450 ? '#ef4444' : data.strength < -250 ? '#facc15' : '#e5e5e5' }}
        >
          {Math.round(data.strength)}
        </div>
        <div className="mt-4 flex gap-2">
          <span className="px-3 py-1 bg-neutral-800 rounded-full text-xs font-bold text-white border border-neutral-700">
            {data.strength < -1000 ? 'SEVERE' : data.strength < -450 ? 'STRONG' : data.strength < -250 ? 'ACTIVE' : 'QUIET'}
          </span>
          <span className="px-3 py-1 bg-neutral-800 rounded-full text-xs font-bold text-neutral-300 border border-neutral-700">
            Slope: {data.slope.toFixed(1)}/min
          </span>
        </div>
        <div
          className="mt-6 p-3 bg-sky-900/20 border border-sky-500/30 rounded text-sm text-sky-100 text-center"
          dangerouslySetInnerHTML={{ __html: data.outlook }}
        />
      </div>

      <div className="md:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-neutral-900/50 rounded-lg p-4 border border-neutral-800 flex flex-col gap-3">
          <h3 className="text-xs font-bold text-neutral-400 uppercase">Active Visibility Zones</h3>

          <div>
            <div className="text-[10px] text-green-400 font-bold mb-1 flex items-center gap-1">📷 CAMERA (Long Exposure)</div>
            <div className="flex flex-wrap gap-1">
              {data.towns.filter((t: any) => t.cam).length === 0 ? (
                <span className="text-neutral-600 text-xs italic">No towns in range</span>
              ) : (
                data.towns
                  .filter((t: any) => t.cam)
                  .map((t: any) => (
                    <span
                      key={t.name}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        t.cam === 'green'
                          ? 'bg-green-500/20 border-green-500/40 text-green-300'
                          : t.cam === 'yellow'
                          ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300'
                          : 'bg-red-500/20 border-red-500/40 text-red-300'
                      }`}
                    >
                      {t.name}
                    </span>
                  ))
              )}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-sky-400 font-bold mb-1 flex items-center gap-1">📱 PHONE (Night Mode)</div>
            <div className="flex flex-wrap gap-1">
              {data.towns.filter((t: any) => t.phone).length === 0 ? (
                <span className="text-neutral-600 text-xs italic">No towns in range</span>
              ) : (
                data.towns
                  .filter((t: any) => t.phone)
                  .map((t: any) => (
                    <span
                      key={t.name}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        t.phone === 'green'
                          ? 'bg-green-500/20 border-green-500/40 text-green-300'
                          : t.phone === 'yellow'
                          ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300'
                          : 'bg-red-500/20 border-red-500/40 text-red-300'
                      }`}
                    >
                      {t.name}
                    </span>
                  ))
              )}
            </div>
          </div>

          <div>
            <div className="text-[10px] text-yellow-400 font-bold mb-1 flex items-center gap-1">👁️ NAKED EYE</div>
            <div className="flex flex-wrap gap-1">
              {data.towns.filter((t: any) => t.eye).length === 0 ? (
                <span className="text-neutral-600 text-xs italic">No towns in range</span>
              ) : (
                data.towns
                  .filter((t: any) => t.eye)
                  .map((t: any) => (
                    <span
                      key={t.name}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        t.eye === 'green'
                          ? 'bg-green-500/20 border-green-500/40 text-green-300'
                          : t.eye === 'yellow'
                          ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300'
                          : 'bg-red-500/20 border-red-500/40 text-red-300'
                      }`}
                    >
                      {t.name}
                    </span>
                  ))
              )}
            </div>
          </div>

          <div className="mt-auto pt-3 border-t border-neutral-800 flex gap-4 text-[10px] text-neutral-400 justify-center">
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              Possible
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-yellow-500" />
              Good
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              Great
            </span>
          </div>
        </div>

        <div className="bg-neutral-900/50 rounded-lg border border-neutral-800 relative overflow-hidden flex items-center justify-center p-2 h-[250px]">
          {renderMap()}
          <div className="absolute bottom-2 right-2 text-[10px] text-neutral-600">New Zealand Map</div>
        </div>
      </div>

      <div className="md:col-span-12 bg-neutral-900/50 rounded-lg p-4 border border-neutral-800 relative">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xs font-bold text-neutral-400 uppercase">24 Hour History</h3>
          <div className="flex gap-1">
            {[1, 3, 6, 12, 24].map((h) => (
              <button
                key={h}
                onClick={() => setChartRange(h)}
                className={`px-2 py-1 text-xs rounded font-bold transition-colors ${
                  chartRange === h ? 'bg-sky-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'
                }`}
              >
                {h}H
              </button>
            ))}
          </div>
        </div>

        <div
          ref={chartRef}
          className="w-full h-[200px] bg-black/20 rounded relative cursor-crosshair overflow-hidden"
          onMouseMove={handleMouseMove}
          onTouchMove={handleMouseMove}
          onMouseLeave={() => setHoverData(null)}
          onTouchEnd={() => setHoverData(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-full">
            <line x1="0" y1="50" x2="100" y2="50" stroke="#333" strokeWidth="0.5" />
            <line x1="0" y1="25" x2="100" y2="25" stroke="#222" strokeWidth="0.5" strokeDasharray="2" />
            <line x1="0" y1="75" x2="100" y2="75" stroke="#222" strokeWidth="0.5" strokeDasharray="2" />
            <path
              d={pathD}
              fill="none"
              stroke={data.strength < -250 ? '#facc15' : '#e5e5e5'}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {hoverData && (
            <>
              <div className="absolute top-0 bottom-0 w-px bg-white/20 pointer-events-none" style={{ left: hoverData.x }} />
              <div
                className="absolute top-2 bg-neutral-900/90 border border-neutral-700 p-2 rounded text-xs text-white pointer-events-none z-10 whitespace-nowrap shadow-lg"
                style={{ left: hoverData.x > 300 ? hoverData.x - 120 : hoverData.x + 10 }}
              >
                <div className="font-bold">{new Date(hoverData.closest.t).toLocaleTimeString()}</div>
                <div style={{ color: hoverData.closest.v < -250 ? '#facc15' : '#ccc' }}>
                  {Math.round(hoverData.closest.v)} nT
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default NzSubstormIndex;
