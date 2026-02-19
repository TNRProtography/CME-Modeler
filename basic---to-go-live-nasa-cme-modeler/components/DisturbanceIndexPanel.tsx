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

interface DstRow {
  timestamp: string;
  dst: number;
}

const DST_FEED_CANDIDATES = [
  'https://services.swpc.noaa.gov/json/kyoto_dst_1_hour.json',
  'https://services.swpc.noaa.gov/json/geospace/geospace_dst_1_hour.json',
];
const AUTO_REFRESH_MS = 5 * 60 * 1000;

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

const getDstBadgeClass = (dst: number) => {
  if (dst <= -100) return 'bg-red-700 text-white';
  if (dst <= -50) return 'bg-amber-700 text-white';
  if (dst <= -30) return 'bg-yellow-700 text-white';
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

const parseDstPayload = (raw: any): DstRow[] =>
  (Array.isArray(raw) ? raw : [])
    .map((item: any) => {
      const timestamp = typeof item?.time_tag === 'string' ? item.time_tag : null;
      const dst = Number(item?.dst);
      if (!timestamp || !Number.isFinite(dst)) return null;
      return { timestamp, dst };
    })
    .filter((item: DstRow | null): item is DstRow => item !== null)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

const DisturbanceIndexPanel: React.FC = () => {
  const [dstRows, setDstRows] = useState<DstRow[]>([]);
  const [isLoadingDst, setIsLoadingDst] = useState(false);
  const [dstError, setDstError] = useState<string | null>(null);

  const fetchDst = useCallback(async () => {
    setIsLoadingDst(true);
    setDstError(null);

    try {
      const attempts = await Promise.allSettled(
        DST_FEED_CANDIDATES.map((url) =>
          fetch(`${url}?_=${Date.now()}`).then(async (response) => {
            if (!response.ok) throw new Error(`${url} -> ${response.status}`);
            return parseDstPayload(await response.json());
          })
        )
      );

      const successful = attempts
        .filter((attempt): attempt is PromiseFulfilledResult<DstRow[]> => attempt.status === 'fulfilled')
        .map((attempt) => attempt.value)
        .filter((rows) => rows.length > 0)
        .sort((a, b) => b.length - a.length);

      const selected = successful[0] ?? [];
      if (!selected.length) throw new Error('No rows from any Dst feed');

      setDstRows((previous) => {
        const merged = [...previous, ...selected];
        const byTime = new Map<number, DstRow>();
        for (const row of merged) {
          const t = new Date(row.timestamp).getTime();
          if (!Number.isFinite(t)) continue;
          byTime.set(t, row);
        }
        return [...byTime.entries()]
          .sort((a, b) => a[0] - b[0])
          .map((entry) => entry[1]);
      });
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
          tension: 0.2,
          fill: true,
          pointRadius: 0,
        },
      ],
    }),
    [dstRows]
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
          ticks: { color: '#71717a', maxTicksLimit: 10 },
          grid: { color: '#27272a' },
        },
        y: {
          ticks: { color: '#71717a' },
          grid: { color: '#27272a' },
          title: { display: true, text: 'Dst (nT)', color: '#a3a3a3' },
        },
      },
    }),
    []
  );

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-white">Kyoto Dst Index (NZ Time)</h3>
          <button
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700"
            title="Live Kyoto Dst in New Zealand time. More negative values indicate stronger geomagnetic disturbance."
          >
            <GuideIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="mb-4 rounded-lg border border-white/10 bg-black/30 p-3">
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
          <div className="text-xs text-neutral-400">Updated: {latestDst ? formatNzLabel(latestDst.timestamp) : '—'}</div>
        </div>
      </div>

      {isLoadingDst && !dstRows.length ? (
        <div className="text-sm text-neutral-300">Loading live Kyoto Dst feed…</div>
      ) : dstError && !dstRows.length ? (
        <div className="text-sm text-amber-300">{dstError}</div>
      ) : !dstRows.length ? (
        <div className="text-sm text-neutral-300">Live data unavailable.</div>
      ) : (
        <div className="h-72">
          <Line data={dstChartData} options={chartOptions} />
        </div>
      )}
    </div>
  );
};

export default DisturbanceIndexPanel;
