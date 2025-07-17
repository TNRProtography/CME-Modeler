import React, { useState, useMemo } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import "chartjs-adapter-date-fns";

ChartJS.register(
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  TimeScale,
  Tooltip,
  Legend,
  Filler
);

interface BtBzPoint {
  x: number; // timestamp (ms)
  bt: number;
  bz: number;
}

interface SingleMetricPoint {
  x: number; // timestamp (ms)
  y: number;
}

interface DataChartProps {
  data: SingleMetricPoint[] | BtBzPoint[];
  metricKey: string;
  unit?: string;
  isBtBz?: boolean;
  timeWindowHours?: number; // initial/default
}

const TIME_WINDOWS = [2, 6, 12, 24];

const DataChart: React.FC<DataChartProps> = ({
  data,
  metricKey,
  unit,
  isBtBz = false,
  timeWindowHours = 2,
}) => {
  const [window, setWindow] = useState(timeWindowHours);

  // Filter data by selected time window (last X hours)
  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff = now - window * 60 * 60 * 1000;
    return Array.isArray(data) ? data.filter((d: any) => d.x > cutoff) : [];
  }, [data, window]);

  // Labels = time of day (short, readable)
  const labels = filtered.map((d: any) =>
    new Date(d.x).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  );

  // Datasets
  const datasets = isBtBz
    ? [
        {
          label: "Bt",
          data: filtered.map((d: any) => d.bt),
          borderColor: "#38bdf8", // Cyan
          backgroundColor: "rgba(56, 189, 248, 0.12)",
          tension: 0.4,
          pointRadius: 0,
        },
        {
          label: "Bz",
          data: filtered.map((d: any) => d.bz),
          borderColor: "#f472b6", // Pink
          backgroundColor: "rgba(244, 114, 182, 0.10)",
          tension: 0.4,
          pointRadius: 0,
        },
      ]
    : [
        {
          label: metricKey.charAt(0).toUpperCase() + metricKey.slice(1),
          data: filtered.map((d: any) => d.y),
          borderColor: "#a3e635", // Light green
          backgroundColor: "rgba(163, 230, 53, 0.13)",
          tension: 0.4,
          pointRadius: 0,
          fill: true,
        },
      ];

  const chartData = {
    labels,
    datasets,
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        labels: {
          color: "#e5e7eb",
          font: { size: 13 },
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx: any) => {
            let label = ctx.dataset.label || "";
            if (label) label += ": ";
            if (ctx.parsed.y !== null) label += ctx.parsed.y.toFixed(2);
            if (unit) label += " " + unit;
            return label;
          },
        },
        backgroundColor: "#18181b",
        borderColor: "#38bdf8",
        borderWidth: 1,
        titleColor: "#38bdf8",
        bodyColor: "#e5e7eb",
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(55,65,81,0.33)" },
        ticks: { color: "#d1d5db", maxTicksLimit: 7 },
      },
      y: {
        grid: { color: "rgba(55,65,81,0.23)" },
        ticks: { color: "#e5e7eb" },
        title: {
          display: !!unit,
          text: unit || "",
          color: "#e5e7eb",
        },
      },
    },
  };

  return (
    <div className="w-full">
      <div className="flex flex-wrap gap-2 mb-3">
        {TIME_WINDOWS.map((h) => (
          <button
            key={h}
            onClick={() => setWindow(h)}
            className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
              window === h
                ? "bg-aurora-500 text-white border-aurora-400"
                : "bg-neutral-800 text-neutral-300 border-neutral-700 hover:bg-neutral-700"
            }`}
            aria-label={`Show last ${h} hours`}
          >
            {h}h
          </button>
        ))}
      </div>
      <div style={{ height: 280 }}>
        <Line data={chartData} options={chartOptions} />
      </div>
      {filtered.length === 0 && (
        <div className="text-center text-neutral-400 text-sm pt-3">
          No data available for selected time window.
        </div>
      )}
    </div>
  );
};

export default DataChart;
