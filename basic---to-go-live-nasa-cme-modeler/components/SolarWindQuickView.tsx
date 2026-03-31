/**
 * SolarWindQuickView — ACE MAG & SWEPAM style quick-glance panel
 *
 * Five stacked dot plots over 24 hours, mirroring the NOAA ACE RTSW
 * MAG & SWEPAM image format:
 *   1. Bz (gsm)   — red dots, zero line, southward is bad (negative)
 *   2. Bt (gsm)   — white/grey dots
 *   3. Phi (°)    — clock angle, cyan dots, 0–360
 *   4. Density    — orange dots, log scale
 *   5. Speed      — yellow dots
 *   6. Temp (K)   — green dots, log scale
 *
 * Non-interactive except hover tooltips. No zoom, no time range selector.
 * Uses Line chart with showLine:false + pointRadius to render as dots.
 */

import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';

interface SolarWindQuickViewProps {
  magneticData: { time: number; bt: number; bz: number; by: number; bx: number; clock: number | null }[];
  clockData:    { x: number; y: number }[];
  speedData:    { x: number; y: number }[];
  densityData:  { x: number; y: number }[];
  tempData:     { x: number; y: number }[];
}

// ── Shared chart options factory ──────────────────────────────────────────────

const GRID_COLOR   = '#2a2a2a';
const TICK_COLOR   = '#555';
const X_AXIS_COLOR = '#444';

function makeOptions(
  yLabel: string,
  yMin: number | undefined,
  yMax: number | undefined,
  yType: 'linear' | 'logarithmic' = 'linear',
  showXAxis = false,
  extraYOptions: Record<string, unknown> = {}
): ChartOptions<'line'> {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#1c1c1c',
        borderColor: '#3f3f46',
        borderWidth: 1,
        titleColor: '#e5e5e5',
        bodyColor: '#a3a3a3',
        titleFont: { size: 10 },
        bodyFont: { size: 10 },
        callbacks: {
          title: (items) => {
            const ts = items[0]?.parsed?.x;
            if (!ts) return '';
            return new Date(ts).toLocaleTimeString('en-NZ', {
              timeZone: 'Pacific/Auckland',
              hour: '2-digit',
              minute: '2-digit',
              month: 'short',
              day: '2-digit',
            });
          },
        },
      },
    },
    scales: {
      x: {
        type: 'time',
        time: {
          tooltipFormat: 'dd MMM HH:mm',
          displayFormats: { hour: 'HH:mm', day: 'dd MMM' },
        },
        min: Date.now() - 24 * 60 * 60 * 1000,
        max: Date.now(),
        ticks: {
          display: showXAxis,
          color: TICK_COLOR,
          maxTicksLimit: 13,
          maxRotation: 0,
          font: { size: 9 },
        },
        grid: { color: GRID_COLOR },
        border: { color: X_AXIS_COLOR },
        title: showXAxis
          ? { display: true, text: 'NZT', color: '#444', font: { size: 8 } }
          : { display: false },
      },
      y: {
        type: yType,
        min: yMin,
        max: yMax,
        ticks: {
          color: TICK_COLOR,
          font: { size: 9 },
          maxTicksLimit: 4,
          ...(yType === 'logarithmic'
            ? {
                callback: (val: number | string) => {
                  const n = Number(val);
                  if (!isFinite(n) || n <= 0) return '';
                  const exp = Math.floor(Math.log10(n));
                  const base = n / Math.pow(10, exp);
                  if (Math.abs(base - 1) < 0.01) return `1e${exp}`;
                  if (Math.abs(base - 3) < 0.2)  return `3e${exp}`;
                  return '';
                },
              }
            : {}),
        },
        grid: { color: GRID_COLOR },
        border: { color: X_AXIS_COLOR },
        title: {
          display: true,
          text: yLabel,
          color: '#555',
          font: { size: 9 },
        },
        ...extraYOptions,
      },
    },
  };
}

// ── Zero-line annotation helper ───────────────────────────────────────────────
// Injected directly as an annotation dataset (a horizontal line at y=0)
function zeroLineDataset(minTime: number, maxTime: number) {
  return {
    label: '__zero__',
    data: [
      { x: minTime, y: 0 },
      { x: maxTime, y: 0 },
    ],
    borderColor: '#555',
    borderWidth: 1,
    borderDash: [4, 4],
    pointRadius: 0,
    showLine: true,
    tension: 0,
  };
}

// ── Main component ────────────────────────────────────────────────────────────

const SolarWindQuickView: React.FC<SolarWindQuickViewProps> = ({
  magneticData,
  clockData,
  speedData,
  densityData,
  tempData,
}) => {
  const now24hAgo = Date.now() - 24 * 60 * 60 * 1000;

  // Filter all series to last 24h
  const mag24  = useMemo(() => magneticData.filter(p => p.time >= now24hAgo), [magneticData]);
  const clk24  = useMemo(() => clockData.filter(p => p.x >= now24hAgo),   [clockData]);
  const spd24  = useMemo(() => speedData.filter(p => p.x >= now24hAgo),   [speedData]);
  const den24  = useMemo(() => densityData.filter(p => p.x >= now24hAgo), [densityData]);
  const tmp24  = useMemo(() => tempData.filter(p => p.x >= now24hAgo),    [tempData]);

  const minTime = now24hAgo;
  const maxTime = Date.now();

  // ── Dataset builders ────────────────────────────────────────────────────────

  const bzData = useMemo(() =>
    mag24.map(p => ({ x: p.time, y: p.bz })),
    [mag24]
  );

  const btData = useMemo(() =>
    mag24.map(p => ({ x: p.time, y: p.bt })),
    [mag24]
  );

  // ── Chart option instances ──────────────────────────────────────────────────

  const bzOptions  = useMemo(() => makeOptions('Bz (nT)', undefined, undefined, 'linear', false, {}), []);
  const btOptions  = useMemo(() => makeOptions('Bt (nT)', 0, undefined, 'linear', false, {}), []);
  const phiOptions = useMemo(() => makeOptions('Phi (°)', 0, 360, 'linear', false, {}), []);
  const denOptions = useMemo(() => makeOptions('n (/cm³)', undefined, undefined, 'logarithmic', false, {}), []);
  const spdOptions = useMemo(() => makeOptions('Speed (km/s)', undefined, undefined, 'linear', false, {}), []);
  const tmpOptions = useMemo(() => makeOptions('Temp (K)', undefined, undefined, 'logarithmic', true, {}), []);

  const DOT_RADIUS = 1.5;
  const DOT_HOVER  = 4;

  // ── Render ──────────────────────────────────────────────────────────────────

  const hasData = mag24.length > 0 || spd24.length > 0;

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-white">Solar Wind — 24h Quick View</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            ACE MAG &amp; SWEPAM · Last 24 hours · Each dot = one reading
          </p>
        </div>
      </div>

      {!hasData ? (
        <div className="h-16 flex items-center justify-center text-neutral-600 text-sm">
          Waiting for solar wind data…
        </div>
      ) : (
        <div className="space-y-0">

          {/* 1 — Bz */}
          <div className="h-[80px]">
            <Line
              data={{
                datasets: [
                  zeroLineDataset(minTime, maxTime),
                  {
                    label: 'Bz (nT)',
                    data: bzData,
                    borderColor: 'transparent',
                    backgroundColor: '#ef4444',
                    pointRadius: DOT_RADIUS,
                    pointHoverRadius: DOT_HOVER,
                    pointBackgroundColor: bzData.map(p =>
                      p.y <= -10 ? '#86efac'  // strong southward — green
                      : p.y <= -5  ? '#4ade80'
                      : p.y <= 0   ? '#ef4444' // southward — red
                      : '#6b7280'              // northward — grey
                    ),
                    pointBorderColor: 'transparent',
                    showLine: false,
                  },
                ],
              }}
              options={bzOptions}
            />
          </div>

          {/* 2 — Bt */}
          <div className="h-[70px]">
            <Line
              data={{
                datasets: [
                  {
                    label: 'Bt (nT)',
                    data: btData,
                    borderColor: 'transparent',
                    pointRadius: DOT_RADIUS,
                    pointHoverRadius: DOT_HOVER,
                    pointBackgroundColor: '#d4d4d4',
                    pointBorderColor: 'transparent',
                    showLine: false,
                  },
                ],
              }}
              options={btOptions}
            />
          </div>

          {/* 3 — Phi (clock angle) */}
          <div className="h-[70px]">
            <Line
              data={{
                datasets: [
                  {
                    label: 'Phi (°)',
                    data: clk24,
                    borderColor: 'transparent',
                    pointRadius: DOT_RADIUS,
                    pointHoverRadius: DOT_HOVER,
                    pointBackgroundColor: '#22d3ee',
                    pointBorderColor: 'transparent',
                    showLine: false,
                  },
                ],
              }}
              options={phiOptions}
            />
          </div>

          {/* 4 — Density */}
          <div className="h-[70px]">
            <Line
              data={{
                datasets: [
                  {
                    label: 'Density (/cm³)',
                    data: den24,
                    borderColor: 'transparent',
                    pointRadius: DOT_RADIUS,
                    pointHoverRadius: DOT_HOVER,
                    pointBackgroundColor: '#fb923c',
                    pointBorderColor: 'transparent',
                    showLine: false,
                  },
                ],
              }}
              options={denOptions}
            />
          </div>

          {/* 5 — Speed */}
          <div className="h-[70px]">
            <Line
              data={{
                datasets: [
                  {
                    label: 'Speed (km/s)',
                    data: spd24,
                    borderColor: 'transparent',
                    pointRadius: DOT_RADIUS,
                    pointHoverRadius: DOT_HOVER,
                    pointBackgroundColor: '#facc15',
                    pointBorderColor: 'transparent',
                    showLine: false,
                  },
                ],
              }}
              options={spdOptions}
            />
          </div>

          {/* 6 — Temperature */}
          <div className="h-[80px]">
            <Line
              data={{
                datasets: [
                  {
                    label: 'Temp (K)',
                    data: tmp24,
                    borderColor: 'transparent',
                    pointRadius: DOT_RADIUS,
                    pointHoverRadius: DOT_HOVER,
                    pointBackgroundColor: '#4ade80',
                    pointBorderColor: 'transparent',
                    showLine: false,
                  },
                ],
              }}
              options={tmpOptions}
            />
          </div>

        </div>
      )}

      {/* Colour legend */}
      <div className="mt-2 pt-2 border-t border-neutral-800/60 flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Bz southward (strong)
        </span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Bz southward
        </span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="w-2 h-2 rounded-full bg-neutral-500 inline-block" /> Bz northward
        </span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="w-2 h-2 rounded-full bg-neutral-300 inline-block" /> Bt
        </span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> Phi
        </span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" /> Density
        </span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" /> Speed
        </span>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500">
          <span className="w-2 h-2 rounded-full bg-green-400 inline-block" /> Temp
        </span>
      </div>
    </div>
  );
};

export default SolarWindQuickView;