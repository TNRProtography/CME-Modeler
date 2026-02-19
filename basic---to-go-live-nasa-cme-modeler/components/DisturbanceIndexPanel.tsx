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

type DisturbanceView = 'dst' | 'kp';

interface DstRow {
  timestamp: string;
  dst: number;
}

interface KpRow {
  timestamp: string;
  kp: number;
}

const KYOTO_DST_URL = 'https://services.swpc.noaa.gov/json/geospace/geospace_dst_1_hour.json';
const PLANETARY_KP_URL = 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const AUTO_REFRESH_MS = 5 * 60 * 1000;

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const getDstBadgeClass = (dst: number) => {
  if (dst <= -100) return 'bg-red-700 text-white';
  if (dst <= -50) return 'bg-amber-700 text-white';
  if (dst <= -30) return 'bg-yellow-700 text-white';
  return 'bg-emerald-700 text-white';
};

const getKpBadgeClass = (kp: number) => {
  if (kp >= 7) return 'bg-red-700 text-white';
  if (kp >= 5) return 'bg-amber-700 text-white';
  if (kp >= 4) return 'bg-yellow-700 text-white';
  return 'bg-emerald-700 text-white';
};

const formatNzLabel = (timestamp: string) => {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  return date.toLocaleString('en-NZ', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

const DisturbanceIndexPanel: React.FC = () => {
  const [activeView, setActiveView] = useState<DisturbanceView>('dst');
  const [dstRows, setDstRows] = useState<DstRow[]>([]);
  const [kpRows, setKpRows] = useState<KpRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLiveIndices = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [dstResponse, kpResponse] = await Promise.all([
        fetch(`${KYOTO_DST_URL}?_=${Date.now()}`),
        fetch(`${PLANETARY_KP_URL}?_=${Date.now()}`),
      ]);

      if (!dstResponse.ok) {
        throw new Error(`Dst feed returned ${dstResponse.status}`);
      }
      if (!kpResponse.ok) {
        throw new Error(`Kp feed returned ${kpResponse.status}`);
      }

      const dstData = await dstResponse.json();
      const kpData = await kpResponse.json();

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

      const normalizedKp = (Array.isArray(kpData) ? kpData.slice(1) : [])
        .map((row: any) => {
          if (!Array.isArray(row)) return null;
          const timestamp = typeof row[0] === 'string' ? row[0] : null;
          const kp = Number(row[1]);
          if (!timestamp || !Number.isFinite(kp)) return null;
          return { timestamp, kp };
        })
        .filter((item: KpRow | null): item is KpRow => item !== null)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .slice(-72);

      setDstRows(normalizedDst);
      setKpRows(normalizedKp);
    } catch {
      setError('Unable to load live disturbance feeds right now.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLiveIndices();
    const refreshInterval = setInterval(fetchLiveIndices, AUTO_REFRESH_MS);
    return () => clearInterval(refreshInterval);
  }, [fetchLiveIndices]);

  const latestDst = dstRows.length ? dstRows[dstRows.length - 1] : null;
  const latestKp = kpRows.length ? kpRows[kpRows.length - 1] : null;

  const latestUpdatedLabel = useMemo(() => {
    const latestTs = activeView === 'dst' ? latestDst?.timestamp : latestKp?.timestamp;
    if (!latestTs) return '—';
    const date = new Date(latestTs);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('en-NZ') : '—';
  }, [activeView, latestDst, latestKp]);

  const dstChartData = useMemo(() => ({
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
  }), [dstRows]);

  const kpChartData = useMemo(() => ({
    labels: kpRows.map((row) => formatNzLabel(row.timestamp)),
    datasets: [
      {
        label: 'Planetary Kp',
        data: kpRows.map((row) => row.kp),
        borderColor: '#22d3ee',
        backgroundColor: 'rgba(34, 211, 238, 0.2)',
        borderWidth: 2,
        tension: 0.25,
        fill: true,
        pointRadius: 0,
      },
    ],
  }), [kpRows]);

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

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-white">Geomagnetic Disturbance Indices</h3>
          <button
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
            title="Switch between live Kyoto Dst and live planetary Kp graphs. Lower Dst and higher Kp indicate stronger disturbance."
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
            onClick={() => setActiveView('kp')}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              activeView === 'kp' ? 'bg-sky-600 text-white' : 'text-neutral-300 hover:bg-white/10'
            }`}
          >
            Live Kp
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
              <span className="text-xs uppercase tracking-wide text-neutral-400">Live Kp</span>
              {latestKp ? (
                <span className={`rounded-md px-3 py-1 text-lg font-semibold ${getKpBadgeClass(latestKp.kp)}`}>
                  {latestKp.kp.toFixed(1)}
                </span>
              ) : (
                <span className="text-sm text-neutral-300">No Kp data</span>
              )}
            </div>
            <div className="text-xs text-neutral-400">Updated: {latestUpdatedLabel}</div>
          </div>
        )}
      </div>

      {isLoading && !dstRows.length && !kpRows.length ? (
        <div className="text-sm text-neutral-300">Loading live disturbance feeds…</div>
      ) : error && !dstRows.length && !kpRows.length ? (
        <div className="text-sm text-amber-300">{error}</div>
      ) : (
        <div className="h-72">
          {activeView === 'dst' ? <Line data={dstChartData} options={chartOptions} /> : <Line data={kpChartData} options={chartOptions} />}
        </div>
      )}
    </div>
  );
};

export default DisturbanceIndexPanel;
