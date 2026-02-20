import React, { useEffect, useMemo, useState } from 'react';
import { useForecastData } from '../hooks/useForecastData';

interface UnifiedDashboardModeProps {
  refreshSignal: number;
}

const XRAY_URL = 'https://services.swpc.noaa.gov/json/goes/primary/xrays-1-day.json';


const localGaugeStyle = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return { color: '#808080', emoji: '❓', percentage: 0 };
  const magnitude = Math.min(100, Math.max(0, Math.abs(value)));
  return { color: '#38bdf8', emoji: value < 0 ? '🧲' : '⚡', percentage: magnitude };
};

const UnifiedDashboardMode: React.FC<UnifiedDashboardModeProps> = ({ refreshSignal }) => {
  const [, setScoreMirror] = useState<number | null>(null);
  const [, setSubstormMirror] = useState<any>(null);
  const [xrayFlux, setXrayFlux] = useState<number | null>(null);
  const {
    auroraScore,
    gaugeData,
    substormForecast,
    lastUpdated,
    fetchAllData,
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

  const xrayClass = useMemo(() => {
    if (xrayFlux == null) return 'N/A';
    if (xrayFlux >= 1e-4) return 'X';
    if (xrayFlux >= 1e-5) return 'M';
    if (xrayFlux >= 1e-6) return 'C';
    if (xrayFlux >= 1e-7) return 'B';
    return 'A';
  }, [xrayFlux]);

  const score = auroraScore ?? 0;

  return (
    <div className="w-full h-full p-2 md:p-3 overflow-hidden">
      <div className="h-full rounded-2xl border border-white/10 bg-black/35 backdrop-blur-md p-3 md:p-4 grid grid-cols-12 grid-rows-6 gap-3">
        <div className="col-span-12 row-span-1 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg md:text-xl font-semibold text-white">Live Operations Dashboard</h2>
            <p className="text-xs text-neutral-400">Focused view: Aurora Forecast + Solar Activity (auto-updating)</p>
          </div>
          <div className="text-xs text-neutral-400">{lastUpdated}</div>
        </div>

        <div className="col-span-12 md:col-span-4 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Aurora Score</div>
          <div className="text-4xl md:text-5xl font-bold text-sky-300 mt-2">{score.toFixed(1)}%</div>
          <div className="text-sm text-neutral-300 mt-2">{score >= 60 ? 'High potential' : score >= 40 ? 'Moderate potential' : 'Low potential'}</div>
          <div className="mt-3 h-2 rounded-full bg-neutral-800 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-sky-500 to-indigo-500" style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
          </div>
        </div>

        <div className="col-span-6 md:col-span-4 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Solar Wind</div>
          <div className="mt-2 space-y-2 text-sm text-neutral-200">
            <div className="flex justify-between"><span>Speed</span><strong>{gaugeData.speed?.value ?? '—'} km/s</strong></div>
            <div className="flex justify-between"><span>Density</span><strong>{gaugeData.density?.value ?? '—'} p/cm³</strong></div>
            <div className="flex justify-between"><span>Temp</span><strong>{gaugeData.temp?.value ?? '—'} K</strong></div>
          </div>
        </div>

        <div className="col-span-6 md:col-span-4 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-400">IMF + Power</div>
          <div className="mt-2 space-y-2 text-sm text-neutral-200">
            <div className="flex justify-between"><span>Bt</span><strong>{gaugeData.bt?.value ?? '—'} nT</strong></div>
            <div className="flex justify-between"><span>Bz</span><strong>{gaugeData.bz?.value ?? '—'} nT</strong></div>
            <div className="flex justify-between"><span>HP</span><strong>{gaugeData.power?.value ?? '—'} GW</strong></div>
          </div>
        </div>

        <div className="col-span-12 md:col-span-6 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-400">Substorm Outlook</div>
          <div className="mt-3 text-2xl font-semibold text-fuchsia-300">{substormForecast?.status ?? 'QUIET'}</div>
          <div className="text-sm text-neutral-300 mt-2">Chance now: {Math.round(substormForecast?.likelihood ?? 0)}%</div>
          <div className="text-sm text-neutral-400 mt-1">{substormForecast?.windowLabel || 'Monitoring next 60 minutes'}</div>
        </div>

        <div className="col-span-12 md:col-span-6 row-span-2 rounded-xl bg-neutral-900/70 border border-neutral-700/60 p-3">
          <div className="text-xs uppercase tracking-wide text-neutral-400">GOES X-ray</div>
          <div className="mt-3 text-2xl font-semibold text-amber-300">Class {xrayClass}</div>
          <div className="text-sm text-neutral-300 mt-2">
            Flux: {xrayFlux != null ? xrayFlux.toExponential(2) : 'N/A'} W/m²
          </div>
          <div className="text-xs text-neutral-500 mt-2">Updates every minute for stable live monitoring.</div>
        </div>
      </div>
    </div>
  );
};

export default UnifiedDashboardMode;
