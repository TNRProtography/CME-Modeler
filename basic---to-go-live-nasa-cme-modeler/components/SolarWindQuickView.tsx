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
    // Detect any significant solar wind discontinuity — not just upward jumps.
    // Types we care about:
    //   Fast-forward shock (CME):  speed↑  density↑  temp↑  Bt↑
    //   Reverse shock:             speed↓  density↓  temp↓  Bt may ↑ or ↓
    //   IMF discontinuity:         Bt↑ and/or Bz sudden large rotation, plasma unchanged
    //   Magnetic cloud boundary:   Bt↑,  density↓  temp↓  (enter smooth flux rope)
    //
    // Rule: use ABSOLUTE magnitude of reading-to-reading change, not sign.
    // A jump of −60 km/s is just as significant as +60 km/s.
    // Bz is checked separately — a large swing in Bz is always noteworthy
    // even if Bt, speed and density are quiet.
    //
    // Thresholds (conservative to avoid noise, sensitive enough for weak CMEs):
    //   Speed:   |Δ| ≥ 40 km/s in one step
    //   Density: ratio ≥ 1.8× or ≤ 0.55× (up or down)
    //   Temp:    ratio ≥ 2.5× or ≤ 0.4×
    //   Bt:      |Δ| ≥ 5 nT
    //   Bz:      |Δ| ≥ 8 nT (large IMF rotation)
    //
    // Require ≥ 2 of 5 parameters to fire within the same 3-min bucket.
    // Exception: Bt + Bz together is enough (pure IMF shock — 1 plasma param not needed).
    // Alert stays visible up to 12h after the event.

    const LOOK_BACK = 12 * 3600000;
    const now = Date.now();
    const BUCKET = 3 * 60000;
    const bucket = (t: number) => Math.round(t / BUCKET) * BUCKET;

    const spdSorted = [...speedData  ].sort((a, b) => a.x    - b.x);
    const denSorted = [...densityData].sort((a, b) => a.x    - b.x);
    const tmpSorted = [...tempData   ].sort((a, b) => a.x    - b.x);
    const magSorted = [...magneticData].sort((a, b) => a.time - b.time);

    if (spdSorted.length < 4 || magSorted.length < 4) return null;

    // Maps: bucket → jump magnitude (sign preserved for display)
    const spdMap = new Map<number, number>();
    const denMap = new Map<number, number>(); // ratio (>1 or <1)
    const tmpMap = new Map<number, number>(); // ratio
    const btMap  = new Map<number, number>(); // delta nT
    const bzMap  = new Map<number, number>(); // delta nT (signed, for display)

    for (let i = 1; i < spdSorted.length; i++) {
      const delta = spdSorted[i].y - spdSorted[i-1].y;
      if (Math.abs(delta) >= 40) spdMap.set(bucket(spdSorted[i].x), delta);
    }
    for (let i = 1; i < denSorted.length; i++) {
      const prev = denSorted[i-1].y; const cur = denSorted[i].y;
      if (prev > 0) {
        const ratio = cur / prev;
        if (ratio >= 1.8 || ratio <= 0.55) denMap.set(bucket(denSorted[i].x), ratio);
      }
    }
    for (let i = 1; i < tmpSorted.length; i++) {
      const prev = tmpSorted[i-1].y; const cur = tmpSorted[i].y;
      if (prev > 0) {
        const ratio = cur / prev;
        if (ratio >= 2.5 || ratio <= 0.4) tmpMap.set(bucket(tmpSorted[i].x), ratio);
      }
    }
    for (let i = 1; i < magSorted.length; i++) {
      const btDelta = magSorted[i].bt - magSorted[i-1].bt;
      if (Math.abs(btDelta) >= 5) btMap.set(bucket(magSorted[i].time), btDelta);
      const bzDelta = magSorted[i].bz - magSorted[i-1].bz;
      if (Math.abs(bzDelta) >= 8) bzMap.set(bucket(magSorted[i].time), bzDelta);
    }

    // Find best event in lookback window
    const allBuckets = new Set([
      ...spdMap.keys(), ...denMap.keys(),
      ...tmpMap.keys(), ...btMap.keys(), ...bzMap.keys(),
    ]);

    let bestEvent: {
      t: number; hits: number; label: string;
      spdJ: number; denR: number; tmpR: number; btJ: number; bzJ: number;
    } | null = null;

    for (const t of allBuckets) {
      if (t < now - LOOK_BACK || t > now) continue;

      const hasSPD = spdMap.has(t);
      const hasDEN = denMap.has(t);
      const hasTMP = tmpMap.has(t);
      const hasBT  = btMap.has(t);
      const hasBZ  = bzMap.has(t);

      const hits = [hasSPD, hasDEN, hasTMP, hasBT, hasBZ].filter(Boolean).length;

      // IMF-only exception: Bt + Bz together counts even without plasma change
      const imfOnly = hasBT && hasBZ && !hasSPD && !hasDEN && !hasTMP;
      if (hits < 2 && !imfOnly) continue;

      // Classify the event type from which parameters fired and their direction
      const spdVal  = spdMap.get(t) ?? 0;
      const denVal  = denMap.get(t) ?? 1;
      const btVal   = btMap.get(t)  ?? 0;
      const bzVal   = bzMap.get(t)  ?? 0;

      let label = 'Solar Wind Discontinuity';
      if (hasSPD && hasDEN && hasTMP) {
        label = spdVal > 0 ? 'CME Has Hit the Satellites!' : 'Reverse Shock Detected';
      } else if (imfOnly || (hasBT && hasBZ && hits <= 2)) {
        label = 'IMF Shock — Watch Bz';
      } else if (hasBT && (hasDEN || hasTMP) && (denVal < 1 || (tmpMap.get(t) ?? 1) < 1)) {
        label = 'Magnetic Cloud Boundary';
      } else if (hasSPD && spdVal > 0) {
        label = 'CME Has Hit the Satellites!';
      }

      if (!bestEvent || hits > bestEvent.hits || (hits === bestEvent.hits && t > bestEvent.t)) {
        bestEvent = {
          t, hits, label,
          spdJ: Math.round(spdMap.get(t) ?? 0),
          denR: +(denMap.get(t) ?? 0).toFixed(1),
          tmpR: +(tmpMap.get(t) ?? 0).toFixed(1),
          btJ:  +(btMap.get(t)  ?? 0).toFixed(1),
          bzJ:  +(bzMap.get(t)  ?? 0).toFixed(1),
        };
      }
    }

    if (!bestEvent) return null;

    const ageMin = Math.round((now - bestEvent.t) / 60000);
    const ageStr = ageMin < 2   ? 'just now'
      : ageMin < 60 ? `~${ageMin} min ago`
      : `~${Math.floor(ageMin / 60)}h${ageMin % 60 > 0 ? ` ${ageMin % 60}min` : ''} ago`;

    return { ...bestEvent, ageStr };
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
              <span className="text-sm font-semibold text-red-400">{shockDetection.label}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(220,38,38,0.28)', color: '#f87171' }}>
                {shockDetection.ageStr}
              </span>
            </div>
            <p className="text-xs text-red-300/80 leading-relaxed">
              {shockDetection.spdJ !== 0 && `Speed ${shockDetection.spdJ > 0 ? '+' : ''}${shockDetection.spdJ} km/s. `}
              {shockDetection.denR !== 0 && `Density ×${shockDetection.denR}. `}
              {shockDetection.tmpR !== 0 && `Temp ×${shockDetection.tmpR}. `}
              {shockDetection.btJ  !== 0 && `Bt ${shockDetection.btJ > 0 ? '+' : ''}${shockDetection.btJ} nT. `}
              {shockDetection.bzJ  !== 0 && `Bz ${shockDetection.bzJ > 0 ? '+' : ''}${shockDetection.bzJ} nT swing. `}
              Watch Bz — if it turns south, aurora activity will follow.
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