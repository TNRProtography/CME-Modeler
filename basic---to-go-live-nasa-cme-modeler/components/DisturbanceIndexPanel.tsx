import React, { useCallback, useEffect, useMemo, useState } from 'react';
import GuideIcon from './icons/GuideIcon';
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

type DisturbanceView = 'dst' | 'hp30';

interface DstRow {
  timestamp: string;
  dst: number;
}

interface DisturbanceIndexPanelProps {
  hp30Data: Array<{ x: number; y: number }>;
}

const KYOTO_DST_URL = 'https://services.swpc.noaa.gov/json/geospace/geospace_dst_1_hour.json';
const AUTO_REFRESH_MS = 5 * 60 * 1000;

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const getDstBadgeClass = (dst: number) => {
  if (dst <= -100) return 'bg-red-700 text-white';
  if (dst <= -50) return 'bg-amber-700 text-white';
  if (dst <= -30) return 'bg-yellow-700 text-white';
  return 'bg-emerald-700 text-white';
};

const getHp30BadgeClass = (hp: number) => {
  if (hp >= 100) return 'bg-red-700 text-white';
  if (hp >= 70) return 'bg-amber-700 text-white';
  if (hp >= 40) return 'bg-yellow-700 text-white';
  return 'bg-emerald-700 text-white';
};

const formatNzLabel = (timestamp: string | number) => {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return String(timestamp);
  return date.toLocaleString('en-NZ', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const DisturbanceIndexPanel: React.FC<DisturbanceIndexPanelProps> = ({ hp30Data }) => {
  const [activeView, setActiveView] = useState<DisturbanceView>('dst');
  const [dstRows, setDstRows] = useState<DstRow[]>([]);
  const [isLoadingDst, setIsLoadingDst] = useState(false);
  const [dstError, setDstError] = useState<string | null>(null);

  const fetchDst = useCallback(async () => {
    setIsLoadingDst(true);
    setDstError(null);

    try {
      const response = await fetch(`${KYOTO_DST_URL}?_=${Date.now()}`);
      if (!response.ok) {
        throw new Error(`Dst feed returned ${response.status}`);
      }

      const dstData = await response.json();
      const normalizedDst = (Array.isArray(dstData) ? dstData : [])
        .map((item: any) => {
          const timestamp = typeof item?.time_tag === 'string' ? item.time_tag : null;
          const dst = Number(item?.dst);
          if (!timestamp || !Number.isFinite(dst)) return null;
          return { timestamp, dst };
        })
        .filter((item: DstRow | null): item is DstRow => item !== null)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .slice(-72);

      setDstRows(normalizedDst);
    } catch {
      setDstError('Unable to load live Kyoto Dst feed right now.');
    } finally {
      setIsLoadingDst(false);
    }
  }, []);

  useEffect(() => {
    fetchDst();
    const refreshInterval = setInterval(fetchDst, AUTO_REFRESH_MS);
    return () => clearInterval(refreshInterval);
  }, [fetchDst]);

  const latestDst = dstRows.length ? dstRows[dstRows.length - 1] : null;
  const latestHp30 = hp30Data.length ? hp30Data[hp30Data.length - 1] : null;

  const latestUpdatedLabel = useMemo(() => {
    const latestTs = activeView === 'dst' ? latestDst?.timestamp : latestHp30?.x;
    if (!latestTs) return '—';
    return formatNzLabel(latestTs);
  }, [activeView, latestDst, latestHp30]);

  const dstChartData = useMemo(
    () => ({
      labels: dstRows.map((row) => formatNzLabel(row.timestamp)),
      datasets: [
        {
          label: 'Kyoto Dst (nT)',
          data: dstRows.map((row) => row.dst),
          borderColor: '#f43f5e',
          backgroundColor: 'rgba(244, 63, 94, 0.2)',
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          pointRadius: 0,
        },
      ],
    }),
    [dstRows]
  );

  const hp30ChartData = useMemo(
    () => ({
      labels: hp30Data.map((row) => formatNzLabel(row.x)),
      datasets: [
        {
          label: 'HP30 (GW)',
          data: hp30Data.map((row) => row.y),
          borderColor: '#22d3ee',
          backgroundColor: 'rgba(34, 211, 238, 0.2)',
          borderWidth: 2,
          tension: 0.25,
          fill: true,
          pointRadius: 0,
        },
      ],
    }),
    [hp30Data]
  );

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#d4d4d8' } },
      },
      scales: {
        x: {
          ticks: { color: '#71717a', maxTicksLimit: 7 },
          grid: { color: '#27272a' },
        },
        y: {
          ticks: { color: '#71717a' },
          grid: { color: '#27272a' },
        },
      },
    }),
    []
  );

  const isEmpty = activeView === 'dst' ? !dstRows.length : !hp30Data.length;

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-white">Geomagnetic Disturbance Indices</h3>
          <button
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
            title="Switch between live Kyoto Dst and live HP30 graphs. Lower Dst and higher HP30 generally indicate stronger auroral disturbance."
          >
            <GuideIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="inline-flex items-center rounded-full bg-white/5 border border-white/10 p-1">
          <button
            onClick={() => setActiveView('dst')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              activeView === 'dst' ? 'bg-fuchsia-600 text-white' : 'text-neutral-300 hover:bg-white/10'
            }`}
          >
            Kyoto Dst
          </button>
          <button
            onClick={() => setActiveView('hp30')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              activeView === 'hp30' ? 'bg-sky-600 text-white' : 'text-neutral-300 hover:bg-white/10'
            }`}
          >
            HP30
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-white/10 bg-black/30 p-3">
        {activeView === 'dst' ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide text-neutral-400">Live Dst</span>
              {latestDst ? (
                <span className={`rounded-md px-3 py-1 text-lg font-semibold ${getDstBadgeClass(latestDst.dst)}`}>
                  {latestDst.dst}nT
                </span>
              ) : (
                <span className="text-sm text-neutral-300">No Dst data</span>
              )}
            </div>
            <div className="text-xs text-neutral-400">Updated: {latestUpdatedLabel}</div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-xs uppercase tracking-wide text-neutral-400">Live HP30</span>
              {latestHp30 ? (
                <span className={`rounded-md px-3 py-1 text-lg font-semibold ${getHp30BadgeClass(latestHp30.y)}`}>
                  {latestHp30.y.toFixed(1)} GW
                </span>
              ) : (
                <span className="text-sm text-neutral-300">No HP30 data</span>
              )}
            </div>
            <div className="text-xs text-neutral-400">Updated: {latestUpdatedLabel}</div>
          </div>
        )}
      </div>

      {activeView === 'dst' && isLoadingDst && !dstRows.length ? (
        <div className="text-sm text-neutral-300">Loading live Kyoto Dst feed…</div>
      ) : activeView === 'dst' && dstError && !dstRows.length ? (
        <div className="text-sm text-amber-300">{dstError}</div>
      ) : isEmpty ? (
        <div className="text-sm text-neutral-300">Live data unavailable.</div>
      ) : (
        <div className="h-72">
          {activeView === 'dst' ? <Line data={dstChartData} options={chartOptions} /> : <Line data={hp30ChartData} options={chartOptions} />}
        </div>
      )}
    </div>
  );
};

export default DisturbanceIndexPanel;
