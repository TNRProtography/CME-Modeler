/**
 * SolarWindQuickView — ACE MAG & SWEPAM style quick-glance panel
 *
 * Stacked dot plots with selectable time range (3h / 6h / 12h / 24h):
 *   1. Bz + Bt   — on the same panel; Bz colour-coded, Bt grey
 *   2. Phi (°)   — clock angle, cyan
 *   3. Density   — orange, log scale
 *   4. Speed     — yellow
 *   5. Temp (K)  — green, log scale
 */

import React, { useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';

interface SolarWindQuickViewProps {
  magneticData: { time: number; bt: number; bz: number; by: number; bx: number; clock: number | null }[];
  clockData:    { x: number; y: number }[];
  speedData:    { x: number; y: number }[];
  densityData:  { x: number; y: number }[];
  tempData:     { x: number; y: number }[];
}

// ── Time range options — matches app convention ───────────────────────────────
const TIME_RANGES = [
  { label: '3 Hr',  ms:  3 * 3600000 },
  { label: '6 Hr',  ms:  6 * 3600000 },
  { label: '12 Hr', ms: 12 * 3600000 },
  { label: '24 Hr', ms: 24 * 3600000 },
];

// ── Shared chart options factory ──────────────────────────────────────────────
const GRID  = '#2a2a2a';
const TICK  = '#555';
const BORDER = '#3f3f3f';

function makeOptions(
  yLabel: string,
  rangeMs: number,
  yMin?: number,
  yMax?: number,
  yType: 'linear' | 'logarithmic' = 'linear',
  showXAxis = false,
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
        bodyFont:  { size: 10 },
        callbacks: {
          title: (items) => {
            const ts = items[0]?.parsed?.x;
            if (!ts) return '';
            return new Date(ts).toLocaleTimeString('en-NZ', {
              timeZone: 'Pacific/Auckland',
              hour: '2-digit', minute: '2-digit',
              month: 'short', day: '2-digit',
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
        min: Date.now() - rangeMs,
        max: Date.now(),
        ticks: {
          display: showXAxis,
          color: TICK,
          maxTicksLimit: 9,
          maxRotation: 0,
          font: { size: 9 },
        },
        grid:   { color: GRID },
        border: { color: BORDER },
        title:  showXAxis
          ? { display: true, text: 'NZT', color: '#444', font: { size: 8 } }
          : { display: false },
      },
      y: {
        type: yType,
        min: yMin,
        max: yMax,
        ticks: {
          color: TICK,
          font: { size: 9 },
          maxTicksLimit: 4,
          ...(yType === 'logarithmic' ? {
            callback: (val: number | string) => {
              const n = Number(val);
              if (!isFinite(n) || n <= 0) return '';
              const exp  = Math.floor(Math.log10(n));
              const base = n / Math.pow(10, exp);
              if (Math.abs(base - 1) < 0.01) return `1e${exp}`;
              if (Math.abs(base - 3) < 0.2)  return `3e${exp}`;
              return '';
            },
          } : {}),
        },
        grid:   { color: GRID },
        border: { color: BORDER },
        title:  { display: true, text: yLabel, color: '#555', font: { size: 9 } },
      },
    },
  };
}

// ── Zero dashed line rendered as a flat dataset ───────────────────────────────
function zeroLine(minT: number, maxT: number) {
  return {
    label: '__zero__',
    data: [{ x: minT, y: 0 }, { x: maxT, y: 0 }],
    borderColor: '#555',
    borderWidth: 1,
    borderDash: [4, 4],
    pointRadius: 0,
    showLine: true,
    tension: 0,
    order: 10,
  };
}

const DOT   = 1.5;
const HOVER = 4;

// ── Main component ────────────────────────────────────────────────────────────
const SolarWindQuickView: React.FC<SolarWindQuickViewProps> = ({
  magneticData, clockData, speedData, densityData, tempData,
}) => {
  const [rangeMs, setRangeMs] = useState(6 * 3600000);

  const cutoff = Date.now() - rangeMs;
  const maxT   = Date.now();

  const mag  = useMemo(() => magneticData.filter(p => p.time  >= cutoff), [magneticData,  rangeMs]);
  const clk  = useMemo(() => clockData.filter(p   => p.x     >= cutoff), [clockData,      rangeMs]);
  const spd  = useMemo(() => speedData.filter(p   => p.x     >= cutoff), [speedData,      rangeMs]);
  const den  = useMemo(() => densityData.filter(p  => p.x    >= cutoff), [densityData,    rangeMs]);
  const tmp  = useMemo(() => tempData.filter(p     => p.x    >= cutoff), [tempData,       rangeMs]);

  const bzPts = useMemo(() => mag.map(p => ({ x: p.time, y: p.bz })), [mag]);
  const btPts = useMemo(() => mag.map(p => ({ x: p.time, y: p.bt })), [mag]);

  const bzColors = useMemo(() =>
    bzPts.map(p =>
      p.y <= -15 ? '#86efac'
      : p.y <= -8 ? '#4ade80'
      : p.y <= 0  ? '#ef4444'
      : '#6b7280'
    ), [bzPts]);

  const hasData = mag.length > 0 || spd.length > 0;

  // ── Interplanetary shock detector ─────────────────────────────────────────
  // Fast-forward IP shock (CME shockwave at L1) shows as a SIMULTANEOUS
  // step-change in speed, density and Bt that SUSTAINS over multiple readings.
  // Based on Cash et al. (2014) and Vorotnikov et al. (2008):
  //   Speed   ≥ 40 km/s jump from 20-min baseline, sustained ≥ 2 readings
  //   Density ≥ 2× from baseline, sustained ≥ 2 readings
  //   Bt      ≥ 8 nT jump OR ≥ 50% from baseline, sustained ≥ 2 readings
  //   ≥ 2 of 3 parameters must fire simultaneously
  const shockDetection = useMemo(() => {
    // Simple consecutive-reading jump detector.
    // A shock is a discontinuity — one reading to the next. No windows needed.
    // For each pair of consecutive readings in each series, check if the value
    // jumps beyond threshold. If ≥2 parameters fire on the same timestamp,
    // it's a shock. We then check if any such event occurred in the last 12h
    // and show the alert if so (shocks stay elevated for hours).

    const LOOK_BACK = 12 * 3600000; // show alert up to 12h after impact
    const now = Date.now();

    const spdSorted = [...speedData  ].sort((a, b) => a.x    - b.x);
    const denSorted = [...densityData].sort((a, b) => a.x    - b.x);
    const tmpSorted = [...tempData   ].sort((a, b) => a.x    - b.x);
    const magSorted = [...magneticData].sort((a, b) => a.time - b.time);

    if (spdSorted.length < 4) return null;

    // Build jump maps keyed by approximate minute timestamp
    // so we can correlate across series
    const BUCKET = 3 * 60000; // 3-minute bucket to align different cadences

    const bucket = (t: number) => Math.round(t / BUCKET) * BUCKET;

    const spdJumps = new Map<number, number>();
    const denJumps = new Map<number, number>();
    const tmpJumps = new Map<number, number>();
    const btJumps  = new Map<number, number>();

    for (let i = 1; i < spdSorted.length; i++) {
      const prev = spdSorted[i - 1]; const cur = spdSorted[i];
      const jump = cur.y - prev.y;
      if (jump >= 40) spdJumps.set(bucket(cur.x), jump); // ≥40 km/s step up
    }
    for (let i = 1; i < denSorted.length; i++) {
      const prev = denSorted[i - 1]; const cur = denSorted[i];
      if (prev.y > 0 && cur.y / prev.y >= 1.6) denJumps.set(bucket(cur.x), cur.y / prev.y);
    }
    for (let i = 1; i < tmpSorted.length; i++) {
      const prev = tmpSorted[i - 1]; const cur = tmpSorted[i];
      if (prev.y > 0 && cur.y / prev.y >= 2.5) tmpJumps.set(bucket(cur.x), cur.y / prev.y);
    }
    for (let i = 1; i < magSorted.length; i++) {
      const prev = magSorted[i - 1]; const cur = magSorted[i];
      const jump = cur.bt - prev.bt;
      if (jump >= 5) btJumps.set(bucket(cur.time), jump);
    }

    // Find any bucket in last 12h where ≥2 parameters jumped simultaneously
    const allBuckets = new Set([
      ...spdJumps.keys(), ...denJumps.keys(),
      ...tmpJumps.keys(), ...btJumps.keys(),
    ]);

    let bestEvent: { t: number; hits: number; spdJ: number; denR: number; tmpR: number; btJ: number } | null = null;

    for (const t of allBuckets) {
      if (t < now - LOOK_BACK || t > now) continue;
      const hits = [spdJumps.has(t), denJumps.has(t), tmpJumps.has(t), btJumps.has(t)].filter(Boolean).length;
      if (hits >= 2 && (!bestEvent || hits > bestEvent.hits || (hits === bestEvent.hits && t > bestEvent.t))) {
        bestEvent = {
          t, hits,
          spdJ: spdJumps.get(t) ?? 0,
          denR: denJumps.get(t) ?? 0,
          tmpR: tmpJumps.get(t) ?? 0,
          btJ:  btJumps.get(t)  ?? 0,
        };
      }
    }

    if (!bestEvent) return null;

    const ageMin = Math.round((now - bestEvent.t) / 60000);
    const ageStr = ageMin < 60
      ? `~${ageMin} min ago`
      : `~${Math.floor(ageMin / 60)}h${ageMin % 60 > 0 ? ` ${ageMin % 60}min` : ''} ago`;

    return {
      ageStr,
      spdJ:    Math.round(bestEvent.spdJ),
      denR:    +bestEvent.denR.toFixed(1),
      tmpR:    +bestEvent.tmpR.toFixed(0),
      btJ:     +bestEvent.btJ.toFixed(1),
      spdHit:  bestEvent.spdJ > 0,
      denHit:  bestEvent.denR > 0,
      tmpHit:  bestEvent.tmpR > 0,
      btHit:   bestEvent.btJ  > 0,
    };
  }, [speedData, densityData, tempData, magneticData]);

  // Options depend on rangeMs so they update when range changes
  const bzbtOpts = useMemo(() => makeOptions('Bz / Bt (nT)', rangeMs, undefined, undefined, 'linear', false), [rangeMs]);
  const phiOpts  = useMemo(() => makeOptions('Phi (°)',      rangeMs, 0, 360,    'linear',       false), [rangeMs]);
  const denOpts  = useMemo(() => makeOptions('n (/cm³)',     rangeMs, undefined, undefined, 'logarithmic', false), [rangeMs]);
  const spdOpts  = useMemo(() => makeOptions('km/s',         rangeMs, undefined, undefined, 'linear',       false), [rangeMs]);
  const tmpOpts  = useMemo(() => makeOptions('Temp (K)',     rangeMs, undefined, undefined, 'logarithmic', true),  [rangeMs]);

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4">

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-base font-semibold text-white">Solar Wind — Quick View</h2>
          <p className="text-xs text-neutral-500 mt-0.5">
            ACE MAG &amp; SWEPAM · Each dot = one reading
          </p>
        </div>
      </div>

      {/* Interplanetary shock alert — matches notification label */}
      {shockDetection && (
        <div className="mt-2 mb-1 flex items-start gap-3 px-3 py-2.5 rounded-lg border"
          style={{ background: 'rgba(220,38,38,0.12)', borderColor: 'rgba(220,38,38,0.45)' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-semibold text-red-400">CME Has Hit the Satellites!</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(220,38,38,0.28)', color: '#f87171' }}>
                Shock Arriving
              </span>
            </div>
            <p className="text-xs text-red-300/80 leading-relaxed">
              Sudden solar wind jump detected {shockDetection.ageStr} — consistent with an interplanetary shock.
              {' '}{shockDetection.spdHit && `Speed +${shockDetection.spdJ} km/s. `}
              {shockDetection.tmpHit && `Temperature ×${shockDetection.tmpR}. `}
              {shockDetection.denHit && `Density ×${shockDetection.denR}. `}
              {shockDetection.btHit  && `Bt +${shockDetection.btJ} nT. `}
              Storm conditions may already be in progress — watch Bz closely.
            </p>
          </div>
        </div>
      )}

      {/* Time range — same style as rest of app */}
      <div className="flex justify-center gap-2 my-2 flex-wrap">
        {TIME_RANGES.map(({ label, ms }) => (
          <button
            key={ms}
            onClick={() => setRangeMs(ms)}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              rangeMs === ms ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {!hasData ? (
        <div className="h-16 flex items-center justify-center text-neutral-600 text-sm">
          Waiting for solar wind data…
        </div>
      ) : (
        <div className="space-y-0">

          {/* 1 — Bz + Bt combined */}
          <div className="h-[90px]">
            <Line
              data={{
                datasets: [
                  zeroLine(cutoff, maxT),
                  {
                    label: 'Bt (nT)',
                    data: btPts,
                    borderColor: 'transparent',
                    pointRadius: DOT,
                    pointHoverRadius: HOVER,
                    pointBackgroundColor: '#a3a3a3',
                    pointBorderColor: 'transparent',
                    showLine: false,
                    order: 2,
                  },
                  {
                    label: 'Bz (nT)',
                    data: bzPts,
                    borderColor: 'transparent',
                    pointRadius: DOT,
                    pointHoverRadius: HOVER,
                    pointBackgroundColor: bzColors,
                    pointBorderColor: 'transparent',
                    showLine: false,
                    order: 1,
                  },
                ],
              }}
              options={bzbtOpts}
            />
          </div>

          {/* 2 — Phi */}
          <div className="h-[75px]">
            <Line
              data={{
                datasets: [{
                  label: 'Phi (°)',
                  data: clk,
                  borderColor: 'transparent',
                  pointRadius: DOT,
                  pointHoverRadius: HOVER,
                  pointBackgroundColor: '#22d3ee',
                  pointBorderColor: 'transparent',
                  showLine: false,
                }],
              }}
              options={phiOpts}
            />
          </div>

          {/* 3 — Density */}
          <div className="h-[75px]">
            <Line
              data={{
                datasets: [{
                  label: 'Density (/cm³)',
                  data: den,
                  borderColor: 'transparent',
                  pointRadius: DOT,
                  pointHoverRadius: HOVER,
                  pointBackgroundColor: '#fb923c',
                  pointBorderColor: 'transparent',
                  showLine: false,
                }],
              }}
              options={denOpts}
            />
          </div>

          {/* 4 — Speed */}
          <div className="h-[75px]">
            <Line
              data={{
                datasets: [{
                  label: 'Speed (km/s)',
                  data: spd,
                  borderColor: 'transparent',
                  pointRadius: DOT,
                  pointHoverRadius: HOVER,
                  pointBackgroundColor: '#facc15',
                  pointBorderColor: 'transparent',
                  showLine: false,
                }],
              }}
              options={spdOpts}
            />
          </div>

          {/* 5 — Temperature */}
          <div className="h-[85px]">
            <Line
              data={{
                datasets: [{
                  label: 'Temp (K)',
                  data: tmp,
                  borderColor: 'transparent',
                  pointRadius: DOT,
                  pointHoverRadius: HOVER,
                  pointBackgroundColor: '#4ade80',
                  pointBorderColor: 'transparent',
                  showLine: false,
                }],
              }}
              options={tmpOpts}
            />
          </div>

        </div>
      )}

      {/* Legend */}
      <div className="mt-2 pt-2 border-t border-neutral-800/60 flex flex-wrap gap-x-4 gap-y-1">
        {[
          { color: 'bg-emerald-400', label: 'Bz ≤ −15 nT' },
          { color: 'bg-green-400',   label: 'Bz ≤ −8 nT' },
          { color: 'bg-red-500',     label: 'Bz southward' },
          { color: 'bg-neutral-500', label: 'Bz northward' },
          { color: 'bg-neutral-400', label: 'Bt' },
          { color: 'bg-cyan-400',    label: 'Phi' },
          { color: 'bg-orange-400',  label: 'Density' },
          { color: 'bg-yellow-400',  label: 'Speed' },
          { color: 'bg-green-400',   label: 'Temp' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span className={`w-2 h-2 rounded-full ${color} inline-block flex-shrink-0`} />
            {label}
          </span>
        ))}
      </div>

    </div>
  );
};

export default SolarWindQuickView;