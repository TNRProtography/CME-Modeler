import React, { useEffect, useMemo, useState } from 'react';
import { useForecastData } from '../hooks/useForecastData';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  TimeScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { enNZ } from 'date-fns/locale';

interface UnifiedDashboardModeProps {
  refreshSignal: number;
}

interface SightingItem {
  name: string;
  nearestTown?: string;
  timestamp: number;
  status: string;
}

const XRAY_URL_3D = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json';
const XRAY_URL_1D = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const HMI_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIBC.jpg';
const AURORA_SIGHTINGS_URL = 'https://aurora-sightings.thenamesrock.workers.dev/';
const WINDY_URL = 'https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054';
const QUEENSTOWN_CAM_URL = 'https://queenstown.roundshot.com/#/';

ChartJS.register(CategoryScale, LinearScale, TimeScale, PointElement, LineElement, Tooltip, Legend, Filler);

const localGaugeStyle = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return { color: '#808080', emoji: '❓', percentage: 0 };
  const magnitude = Math.min(100, Math.max(0, Math.abs(value)));
  return { color: '#38bdf8', emoji: value < 0 ? '🧲' : '⚡', percentage: magnitude };
};

const getEmojiForStatus = (status: string) => {
  if (status === 'eye') return '👁️';
  if (status === 'phone') return '📱';
  if (status === 'dslr') return '📷';
  if (status === 'cloudy') return '☁️';
  if (status === 'nothing-eye') return '❌👁️';
  if (status === 'nothing-phone') return '❌📱';
  if (status === 'nothing-dslr') return '❌📷';
  return '❓';
};


const UnifiedDashboardMode: React.FC<UnifiedDashboardModeProps> = ({ refreshSignal }) => {
  const [, setScoreMirror] = useState<number | null>(null);
  const [, setSubstormMirror] = useState<any>(null);
  const [xrayFlux, setXrayFlux] = useState<number | null>(null);
  const [xraySeries, setXraySeries] = useState<Array<{ t: number; v: number }>>([]);
  const [sightings, setSightings] = useState<SightingItem[]>([]);

  const {
    auroraScore,
    gaugeData,
    substormForecast,
    lastUpdated,
    fetchAllData,
    auroraScoreHistory,
    allSpeedData,
    allDensityData,
    allMagneticData,
    hemisphericPowerHistory,
  } = useForecastData(setScoreMirror, setSubstormMirror);

  useEffect(() => {
    fetchAllData(false, localGaugeStyle);
  }, [fetchAllData, refreshSignal]);

  useEffect(() => {
    let mounted = true;
    const pullXray = async () => {
      try {
        const endpoints = [XRAY_URL_3D, XRAY_URL_1D];
        let records: any[] = [];
        for (const url of endpoints) {
          const response = await fetch(`${url}?_=${Date.now()}`);
          if (!response.ok) continue;
          const payload = await response.json();
          if (Array.isArray(payload) && payload.length) {
            records = payload;
            break;
          }
        }
        const points = records
          .map((r: any) => ({ t: new Date(r?.time_tag).getTime(), v: Number(r?.flux) }))
          .filter((p: any) => Number.isFinite(p.t) && Number.isFinite(p.v))
          .sort((a: any, b: any) => a.t - b.t)
          .slice(-720);

        if (mounted) {
          setXraySeries(points);
          if (points.length) setXrayFlux(points[points.length - 1].v);
        }
      } catch {
        // ignore
      }
    };
    pullXray();
    const interval = setInterval(pullXray, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const pullSightings = async () => {
      try {
        const response = await fetch(`${AURORA_SIGHTINGS_URL}?_=${Date.now()}`);
        if (!response.ok) return;
        const data = await response.json();
        const rows = (Array.isArray(data) ? data : [])
          .map((row: any) => ({
            name: typeof row?.name === 'string' ? row.name : 'Anonymous',
            nearestTown: typeof row?.nearestTown === 'string' ? row.nearestTown : undefined,
            timestamp: Number(row?.timestamp),
            status: typeof row?.status === 'string' ? row.status : 'unknown',
          }))
          .filter((row: SightingItem) => Number.isFinite(row.timestamp))
          .sort((a: SightingItem, b: SightingItem) => b.timestamp - a.timestamp)
          .slice(0, 8);
        if (mounted) setSightings(rows);
      } catch {
        // ignore
      }
    };
    pullSightings();
    const interval = setInterval(pullSightings, 60000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const xrayClass = useMemo(() => {
    if (xrayFlux == null) return 'N/A';
    if (xrayFlux >= 1e-4) return 'X';
    if (xrayFlux >= 1e-5) return 'M';
    if (xrayFlux >= 1e-6) return 'C';
    if (xrayFlux >= 1e-7) return 'B';
    return 'A';
  }, [xrayFlux]);

  const score = auroraScore ?? 0;

  const now = Date.now();
  const aurora6h = auroraScoreHistory.filter((p: any) => p.timestamp >= now - 6 * 3600000).slice(-180);
  const wind6h = allSpeedData.filter((p: any) => p.x >= now - 6 * 3600000).slice(-180);
  const density6h = allDensityData.filter((p: any) => p.x >= now - 6 * 3600000).slice(-180);
  const imf6h = allMagneticData.filter((p: any) => p.time >= now - 6 * 3600000).slice(-180);
  const hp6h = hemisphericPowerHistory.filter((p: any) => p.timestamp >= now - 6 * 3600000).slice(-180);
  const xray3d = xraySeries.filter((p: any) => p.t >= now - 72 * 3600000);

  const chartOptionsBase = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false, axis: 'x' },
      plugins: {
        legend: { labels: { color: '#a1a1aa', boxWidth: 10, font: { size: 10 } } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: {
          type: 'time',
          adapters: { date: { locale: enNZ } },
          time: { unit: 'hour', tooltipFormat: 'dd MMM HH:mm', displayFormats: { hour: 'HH:mm', day: 'dd MMM' } },
          ticks: { color: '#71717a', maxTicksLimit: 6, font: { size: 10 } },
          grid: { color: '#3f3f46' },
        },
        y: {
          ticks: { color: '#a3a3a3', font: { size: 10 } },
          grid: { color: '#3f3f46' },
          title: { display: true, color: '#a3a3a3', font: { size: 10 } },
        },
      },
      elements: { point: { radius: 0 }, line: { tension: 0.25, borderWidth: 1.5 } },
    }),
    []
  );

  const auroraChartOptions = useMemo<ChartOptions<'line'>>(
    () => ({
      ...chartOptionsBase,
      plugins: { ...chartOptionsBase.plugins, legend: { display: false } },
      scales: {
        ...chartOptionsBase.scales,
        y: { ...(chartOptionsBase.scales?.y as any), title: { display: true, text: 'Aurora %', color: '#a3a3a3' }, min: 0, max: 100 },
      },
    }),
    [chartOptionsBase]
  );

  const windDensityChartOptions = useMemo<ChartOptions<'line'>>(
    () => ({
      ...chartOptionsBase,
      scales: {
        ...chartOptionsBase.scales,
        y: { ...(chartOptionsBase.scales?.y as any), type: 'linear', position: 'left', title: { display: true, text: 'Speed (km/s)', color: '#a3a3a3' } },
        y1: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#a3a3a3', font: { size: 10 } },
          title: { display: true, text: 'Density (/cc)', color: '#a3a3a3', font: { size: 10 } },
        },
      },
    }),
    [chartOptionsBase]
  );

  const imfHpChartOptions = useMemo<ChartOptions<'line'>>(
    () => ({
      ...chartOptionsBase,
      scales: {
        ...chartOptionsBase.scales,
        y: { ...(chartOptionsBase.scales?.y as any), type: 'linear', position: 'left', title: { display: true, text: 'IMF (nT)', color: '#a3a3a3' } },
        y1: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#a3a3a3', font: { size: 10 } },
          title: { display: true, text: 'HP (GW)', color: '#a3a3a3', font: { size: 10 } },
        },
      },
    }),
    [chartOptionsBase]
  );

  const xrayChartOptions = useMemo<ChartOptions<'line'>>(
    () => ({
      ...chartOptionsBase,
      plugins: { ...chartOptionsBase.plugins, legend: { display: false } },
      scales: {
        ...chartOptionsBase.scales,
        x: {
          ...(chartOptionsBase.scales?.x as any),
          time: { unit: 'day', tooltipFormat: 'dd MMM HH:mm', displayFormats: { hour: 'HH:mm', day: 'dd MMM' } },
        },
        y: {
          ...(chartOptionsBase.scales?.y as any),
          type: 'logarithmic',
          min: 1e-8,
          max: 1e-3,
          title: { display: true, text: 'X-ray Flux (W/m²)', color: '#a3a3a3' },
        },
      },
    }),
    [chartOptionsBase]
  );

  const auroraChart = {
    datasets: [{ label: 'Aurora % (6h)', data: aurora6h.map((p: any) => ({ x: p.timestamp, y: p.finalScore })), borderColor: '#38bdf8', backgroundColor: 'rgba(56,189,248,0.2)', fill: true }],
  };

  const windDensityChart = {
    datasets: [
      { label: 'Speed', data: wind6h.map((p: any) => ({ x: p.x, y: p.y })), yAxisID: 'y', borderColor: '#22d3ee', backgroundColor: 'transparent', fill: false },
      { label: 'Density', data: density6h.map((p: any) => ({ x: p.x, y: p.y })), yAxisID: 'y1', borderColor: '#f59e0b', backgroundColor: 'transparent', fill: false },
    ],
  };

  const imfChart = {
    datasets: [
      { label: 'Bt', data: imf6h.map((p: any) => ({ x: p.time, y: p.bt })), yAxisID: 'y', borderColor: '#a78bfa', backgroundColor: 'transparent', fill: false },
      { label: 'Bz', data: imf6h.map((p: any) => ({ x: p.time, y: p.bz })), yAxisID: 'y', borderColor: '#f43f5e', backgroundColor: 'transparent', fill: false },
      { label: 'HP', data: hp6h.map((p: any) => ({ x: p.timestamp, y: p.hemisphericPower })), yAxisID: 'y1', borderColor: '#34d399', backgroundColor: 'transparent', fill: false },
    ],
  };

  const xrayChart = {
    datasets: [{ label: 'X-ray flux (3d)', data: xray3d.map((p: any) => ({ x: p.t, y: p.v })), borderColor: '#fbbf24', backgroundColor: 'rgba(251,191,36,0.2)', fill: true }],
  };

  return (
    <div className="w-full h-full p-2 md:p-3 overflow-hidden">
      <div className="h-full rounded-2xl border border-white/10 bg-black/35 backdrop-blur-md p-3 md:p-4 grid grid-cols-12 grid-rows-12 gap-3">
        <div className="col-span-12 row-span-1 rounded-xl bg-neutral-900/70 border border-neutral-700/60 px-3 py-2 flex items-center justify-between">
          <div>
            <h2 className="text-base md:text-lg font-semibold text-white">Live Aurora Operations Dashboard</h2>
            <p className="text-[11px] text-neutral-400">Useful-only mode · one-screen, auto-refreshing</p>
          </div>
          <div className="text-[11px] text-neutral-400">{lastUpdated}</div>
        </div>

        <div className="col-span-12 md:col-span-3 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-400">Aurora Score</div>
          <div className="text-3xl font-bold text-sky-300 mt-1">{score.toFixed(1)}%</div>
          <div className="text-xs text-neutral-300 mt-1">Substorm: {substormForecast?.status ?? 'QUIET'} · {Math.round(substormForecast?.likelihood ?? 0)}%</div>
        </div>

        <div className="col-span-6 md:col-span-3 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-400">Solar Wind</div>
          <div className="text-xs mt-2 space-y-1 text-neutral-200">
            <div className="flex justify-between"><span>Speed</span><strong>{gaugeData.speed?.value ?? '—'}</strong></div>
            <div className="flex justify-between"><span>Density</span><strong>{gaugeData.density?.value ?? '—'}</strong></div>
          </div>
        </div>

        <div className="col-span-6 md:col-span-3 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-400">IMF + HP</div>
          <div className="text-xs mt-2 space-y-1 text-neutral-200">
            <div className="flex justify-between"><span>Bt</span><strong>{gaugeData.bt?.value ?? '—'}</strong></div>
            <div className="flex justify-between"><span>Bz</span><strong>{gaugeData.bz?.value ?? '—'}</strong></div>
            <div className="flex justify-between"><span>HP</span><strong>{gaugeData.power?.value ?? '—'}</strong></div>
          </div>
        </div>

        <div className="col-span-12 md:col-span-3 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-400">GOES X-ray</div>
          <div className="text-xl text-amber-300 font-semibold mt-1">Class {xrayClass}</div>
          <div className="text-xs text-neutral-300">{xrayFlux != null ? xrayFlux.toExponential(2) : 'N/A'} W/m²</div>
        </div>

        <div className="col-span-12 md:col-span-4 row-span-3 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2">
          <div className="text-[11px] text-neutral-300 px-1">Aurora Trend (6h)</div>
          <div className="h-[calc(100%-18px)]"><Line data={auroraChart} options={auroraChartOptions} /></div>
        </div>
        <div className="col-span-12 md:col-span-4 row-span-3 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2">
          <div className="text-[11px] text-neutral-300 px-1">Wind + Density (6h)</div>
          <div className="h-[calc(100%-18px)]"><Line data={windDensityChart} options={windDensityChartOptions} /></div>
        </div>
        <div className="col-span-12 md:col-span-4 row-span-3 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2">
          <div className="text-[11px] text-neutral-300 px-1">IMF Bt / Bz + HP (6h)</div>
          <div className="h-[calc(100%-18px)]"><Line data={imfChart} options={imfHpChartOptions} /></div>
        </div>

        <div className="col-span-12 md:col-span-4 row-span-3 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2">
          <div className="text-[11px] text-neutral-300 px-1">GOES X-ray (3 days)</div>
          <div className="h-[calc(100%-18px)]"><Line data={xrayChart} options={xrayChartOptions} /></div>
        </div>

        <div className="col-span-12 md:col-span-4 row-span-3 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-black/50 border border-white/10 overflow-hidden">
            <div className="text-[11px] text-neutral-300 px-2 py-1 border-b border-white/10">SUVI 131</div>
            <img src={`${SUVI_131_URL}?_=${refreshSignal}`} alt="SUVI 131" className="w-full h-[calc(100%-24px)] object-contain" />
          </div>
          <div className="rounded-lg bg-black/50 border border-white/10 overflow-hidden">
            <div className="text-[11px] text-neutral-300 px-2 py-1 border-b border-white/10">HMI</div>
            <img src={`${HMI_URL}?_=${refreshSignal}`} alt="HMI" className="w-full h-[calc(100%-24px)] object-contain" />
          </div>
        </div>

        <div className="col-span-12 md:col-span-4 row-span-3 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-black/50 border border-white/10 overflow-hidden">
            <div className="text-[11px] text-neutral-300 px-2 py-1 border-b border-white/10">Windy Clouds</div>
            <iframe title="Windy Clouds" src={WINDY_URL} className="w-full h-[calc(100%-24px)]" />
          </div>
          <div className="rounded-lg bg-black/50 border border-white/10 overflow-hidden">
            <div className="text-[11px] text-neutral-300 px-2 py-1 border-b border-white/10">Queenstown Camera</div>
            <iframe title="Queenstown Camera" src={QUEENSTOWN_CAM_URL} className="w-full h-[calc(100%-24px)]" />
          </div>
        </div>

        <div className="col-span-12 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2 overflow-hidden">
          <div className="text-[11px] uppercase tracking-wide text-neutral-400 px-1 mb-1">Latest Aurora Sightings</div>
          <div className="h-[calc(100%-20px)] overflow-y-auto styled-scrollbar space-y-1 pr-1">
            {sightings.length ? sightings.map((s, idx) => (
              <div key={`${s.timestamp}-${idx}`} className="text-xs rounded bg-black/40 border border-white/10 px-2 py-1 flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-neutral-200">
                  <strong>{s.name}</strong> {s.nearestTown ? `· ${s.nearestTown}` : ''}
                </div>
                <div className="text-neutral-400 shrink-0">{new Date(s.timestamp).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' })}</div>
                <div className="text-base leading-none shrink-0">{getEmojiForStatus(s.status)}</div>
              </div>
            )) : (
              <div className="text-xs text-neutral-400 px-2 py-2">No recent sightings available.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnifiedDashboardMode;
