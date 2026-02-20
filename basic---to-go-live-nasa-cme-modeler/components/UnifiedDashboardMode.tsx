import React, { useEffect, useMemo, useState } from 'react';
import { useForecastData } from '../hooks/useForecastData';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

interface UnifiedDashboardModeProps {
  refreshSignal: number;
}

interface SightingItem {
  name: string;
  nearestTown?: string;
  timestamp: number;
  status: string;
}

const XRAY_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';
const SUVI_131_URL = 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png';
const HMI_URL = 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIBC.jpg';
const AURORA_SIGHTINGS_URL = 'https://aurora-sightings.thenamesrock.workers.dev/';
const WINDY_URL = 'https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=°C&zoom=5&overlay=clouds&product=ecmwf&level=surface&lat=-44.757&lon=169.054';
const QUEENSTOWN_CAM_URL = 'https://queenstown.roundshot.com/#/';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

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
  const [sightings, setSightings] = useState<SightingItem[]>([]);

  const {
    auroraScore,
    gaugeData,
    substormForecast,
    lastUpdated,
    fetchAllData,
    auroraScoreHistory,
    hemisphericPowerHistory,
  } = useForecastData(setScoreMirror, setSubstormMirror);

  useEffect(() => {
    fetchAllData(false, localGaugeStyle);
  }, [fetchAllData, refreshSignal]);

  useEffect(() => {
    let mounted = true;
    const pullXray = async () => {
      try {
        const response = await fetch(`${XRAY_URL}?_=${Date.now()}`);
        if (!response.ok) return;
        const payload = await response.json();
        const records = Array.isArray(payload) ? payload : [];
        const valid = records
          .map((r: any) => Number(r?.flux))
          .filter((v: number) => Number.isFinite(v));
        if (mounted && valid.length) setXrayFlux(valid[valid.length - 1]);
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

  const compactChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { display: false },
      },
      elements: { line: { tension: 0.25, borderWidth: 1.7 }, point: { radius: 0 } },
    }),
    []
  );

  const auroraTrendData = useMemo(
    () => ({
      labels: auroraScoreHistory.slice(-120).map((d) => d.timestamp),
      datasets: [{
        data: auroraScoreHistory.slice(-120).map((d) => d.finalScore),
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.2)',
        fill: true,
      }],
    }),
    [auroraScoreHistory]
  );

  const hpTrendData = useMemo(
    () => ({
      labels: hemisphericPowerHistory.slice(-120).map((d) => d.timestamp),
      datasets: [{
        data: hemisphericPowerHistory.slice(-120).map((d: any) => d.hemisphericPower),
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34,211,238,0.2)',
        fill: true,
      }],
    }),
    [hemisphericPowerHistory]
  );

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
          <div className="h-10 mt-2"><Line data={auroraTrendData} options={compactChartOptions} /></div>
        </div>

        <div className="col-span-6 md:col-span-3 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-400">Solar Wind</div>
          <div className="text-xs mt-2 space-y-1 text-neutral-200">
            <div className="flex justify-between"><span>Speed</span><strong>{gaugeData.speed?.value ?? '—'}</strong></div>
            <div className="flex justify-between"><span>Density</span><strong>{gaugeData.density?.value ?? '—'}</strong></div>
            <div className="flex justify-between"><span>Temp</span><strong>{gaugeData.temp?.value ?? '—'}</strong></div>
          </div>
        </div>

        <div className="col-span-6 md:col-span-3 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-400">IMF / HP</div>
          <div className="text-xs mt-2 space-y-1 text-neutral-200">
            <div className="flex justify-between"><span>Bt</span><strong>{gaugeData.bt?.value ?? '—'}</strong></div>
            <div className="flex justify-between"><span>Bz</span><strong>{gaugeData.bz?.value ?? '—'}</strong></div>
            <div className="flex justify-between"><span>HP</span><strong>{gaugeData.power?.value ?? '—'}</strong></div>
          </div>
        </div>

        <div className="col-span-12 md:col-span-3 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-neutral-400">Substorm / X-ray</div>
          <div className="text-sm text-fuchsia-300 font-semibold mt-1">{substormForecast?.status ?? 'QUIET'}</div>
          <div className="text-xs text-neutral-300">Chance: {Math.round(substormForecast?.likelihood ?? 0)}%</div>
          <div className="text-xs text-amber-300 mt-2">X-ray: {xrayClass} ({xrayFlux != null ? xrayFlux.toExponential(1) : 'N/A'})</div>
          <div className="h-8 mt-1"><Line data={hpTrendData} options={compactChartOptions} /></div>
        </div>

        <div className="col-span-12 md:col-span-6 row-span-4 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-black/50 border border-white/10 overflow-hidden">
            <div className="text-[11px] text-neutral-300 px-2 py-1 border-b border-white/10">SUVI 131</div>
            <img src={`${SUVI_131_URL}?_=${refreshSignal}`} alt="SUVI 131" className="w-full h-[calc(100%-24px)] object-contain" />
          </div>
          <div className="rounded-lg bg-black/50 border border-white/10 overflow-hidden">
            <div className="text-[11px] text-neutral-300 px-2 py-1 border-b border-white/10">HMI</div>
            <img src={`${HMI_URL}?_=${refreshSignal}`} alt="HMI" className="w-full h-[calc(100%-24px)] object-contain" />
          </div>
        </div>

        <div className="col-span-12 md:col-span-6 row-span-4 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-black/50 border border-white/10 overflow-hidden">
            <div className="text-[11px] text-neutral-300 px-2 py-1 border-b border-white/10">Windy Clouds</div>
            <iframe title="Windy Clouds" src={WINDY_URL} className="w-full h-[calc(100%-24px)]" />
          </div>
          <div className="rounded-lg bg-black/50 border border-white/10 overflow-hidden">
            <div className="text-[11px] text-neutral-300 px-2 py-1 border-b border-white/10">Queenstown Camera</div>
            <iframe title="Queenstown Camera" src={QUEENSTOWN_CAM_URL} className="w-full h-[calc(100%-24px)]" />
          </div>
        </div>

        <div className="col-span-12 row-span-3 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-2 overflow-hidden">
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
