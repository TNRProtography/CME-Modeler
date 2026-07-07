/**
 * SolarWindQuickView - ACE MAG & SWEPAM style quick-glance panel
 *
 * Stacked dot plots with selectable time range (3h / 6h / 12h / 24h):
 *   1. Bz + Bt   - on the same panel; Bz colour-coded, Bt grey
 *   2. Phi (°)   - clock angle, cyan
 *   3. Density   - orange, log scale
 *   4. Speed     - yellow
 *   5. Temp (K)  - green, log scale
 */

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import CloseIcon from './icons/CloseIcon';
import { detectShocks, type DetectedShock } from '../utils/shockDetection';

// ── Shape of a single detected shock, exposed to parent via onShocksDetected ──
// (Defined in utils/shockDetection.ts - the single shared detector - and
// re-exported here so existing `import { type DetectedShock } from
// './SolarWindQuickView'` call sites keep working.)
export type { DetectedShock } from '../utils/shockDetection';

interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string | React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[9999] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (<div dangerouslySetInnerHTML={{ __html: content }} />) : (content)}
        </div>
      </div>
    </div>,
    document.body
  );
};

interface SolarWindQuickViewProps {
  magneticData: { time: number; bt: number; bz: number; by: number; bx: number; clock: number | null }[];
  clockData:    { x: number; y: number }[];
  speedData:    { x: number; y: number }[];
  densityData:  { x: number; y: number }[];
  tempData:     { x: number; y: number }[];
  /** Optional callback invoked whenever the detected shock list changes.
   *  Parent can use this to drive a global shock banner. */
  onShocksDetected?: (shocks: DetectedShock[]) => void;
}

// ── Time range options - matches app convention ───────────────────────────────
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

function shockLine(t: number, yMin: number, yMax: number, color = 'rgba(250, 204, 21, 0.95)') {
  return {
    label: 'Shock marker',
    data: [{ x: t, y: yMin }, { x: t, y: yMax }],
    borderColor: color,
    borderWidth: 1.4,
    borderDash: [5, 4],
    pointRadius: 0,
    showLine: true,
    tension: 0,
    order: 50,
  };
}

const DOT   = 1.5;
const HOVER = 4;

// ── Main component ────────────────────────────────────────────────────────────
const SolarWindQuickView: React.FC<SolarWindQuickViewProps> = ({
  magneticData, clockData, speedData, densityData, tempData, onShocksDetected,
}) => {
  const [rangeMs, setRangeMs] = useState(6 * 3600000);
  const [modalState, setModalState] = useState<{ title: string; content: string } | null>(null);
  // Index into shockEvents for the carousel. Kept in sync with shockEvents length.
  const [shockIndex, setShockIndex] = useState(0);

  const buildStatTooltip = (title: string, whatItIs: string, auroraEffect: string, advanced: string) => `
    <div class='space-y-3 text-left'>
      <p><strong>${title}</strong></p>
      <p><strong>What this is:</strong> ${whatItIs}</p>
      <p><strong>Why it matters for aurora:</strong> ${auroraEffect}</p>
      <p class='text-xs text-neutral-400'><strong>Advanced:</strong> ${advanced}</p>
    </div>
  `;

  const openModal = useCallback(() => {
    setModalState({
      title: 'About Solar Wind Quick View',
      content: buildStatTooltip(
        'Solar Wind Quick View',
        'Live upstream L1 solar wind data from ACE: IMF Bz/Bt, clock angle (Phi), density, speed, and temperature. Each dot is one instrument reading from the ACE MAG and SWEPAM sensors roughly 1.5 million km from Earth.',
        'These parameters directly control aurora activity. Southward Bz (negative) opens the magnetosphere to energy input; high speed and density amplify that effect. Watching all five subplots together reveals whether conditions are building, stable, or declining - typically 30–60 minutes before they hit Earth.',
        'Shock events are flagged automatically as dashed vertical markers. Shock types: Fast Forward (FF) - density↑ temp↑ IMF↑ speed↑, the classic CME arrival; Slow Forward (SF) - same but IMF↓; Fast Reverse (FR) - density↓ temp↓ IMF↓ speed↑; Slow Reverse (SR) - density↓ temp↓ IMF↑ speed↑. Detection requires the jump to be sharp (concentrated within minutes, not a gradual ramp) and confirmed by a matching dynamic-pressure change, which filters out slow stream interactions and magnetic sector boundaries. The same detections drive the shock markers on the Energetic Particle Monitor charts.'
      ),
    });
  }, []);

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
  // Single shared detector (utils/shockDetection.ts) - also drives the EPAM
  // panel's chart markers, so the summary, banner, and EPAM graph always show
  // the SAME events. Tightened in v2: IMF enhancement/discontinuity removed,
  // sharpness gate added to reject gradual SIR ramps, dynamic-pressure
  // confirmation required. See that file for full rationale and thresholds.
  const shockEvents = useMemo(
    () => detectShocks(speedData, densityData, tempData, magneticData),
    [speedData, densityData, tempData, magneticData],
  );

  // Latest shock (most recent by time); this is what the carousel defaults to.
  // shockEvents is already sorted chronologically in the reducer above.
  const latestShockIndex = shockEvents.length ? shockEvents.length - 1 : 0;

  // Keep the carousel pointing at the newest shock whenever the list changes.
  // If the user has scrolled back and a new shock appears, jump to the new one.
  useEffect(() => {
    setShockIndex(latestShockIndex);
  }, [latestShockIndex, shockEvents.length]);

  // Notify parent (e.g. App.tsx / GlobalBanner) whenever the detected set changes.
  useEffect(() => {
    onShocksDetected?.(shockEvents);
  }, [shockEvents, onShocksDetected]);

  // Clamp index defensively in case shockEvents shrinks.
  const safeShockIndex = Math.min(shockIndex, Math.max(0, shockEvents.length - 1));
  const currentShock = shockEvents.length ? shockEvents[safeShockIndex] : null;
  const goPrevShock = useCallback(() => {
    setShockIndex((i) => Math.max(0, i - 1));
  }, []);
  const goNextShock = useCallback(() => {
    setShockIndex((i) => Math.min(shockEvents.length - 1, i + 1));
  }, [shockEvents.length]);

  // Options depend on rangeMs so they update when range changes
  const bzbtOpts = useMemo(() => makeOptions('Bz / Bt (nT)', rangeMs, undefined, undefined, 'linear', false), [rangeMs]);
  const phiOpts  = useMemo(() => makeOptions('Phi (°)',      rangeMs, 0, 360,    'linear',       false), [rangeMs]);
  const denOpts  = useMemo(() => makeOptions('n (/cm³)',     rangeMs, undefined, undefined, 'logarithmic', false), [rangeMs]);
  const spdOpts  = useMemo(() => makeOptions('km/s',         rangeMs, undefined, undefined, 'linear',       false), [rangeMs]);
  const tmpOpts  = useMemo(() => makeOptions('Temp (K)',     rangeMs, undefined, undefined, 'logarithmic', true),  [rangeMs]);
  const visibleShockEvents = useMemo(
    () => shockEvents.filter((e) => e.t >= cutoff && e.t <= maxT),
    [shockEvents, cutoff, maxT]
  );
  const bzBtRange = useMemo(() => {
    const vals = [...bzPts.map((p) => p.y), ...btPts.map((p) => p.y)].filter((v) => Number.isFinite(v));
    if (!vals.length) return { min: -20, max: 20 };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max(2, (max - min) * 0.15);
    return { min: min - pad, max: max + pad };
  }, [bzPts, btPts]);
  const denRange = useMemo(() => {
    const vals = den.map((p) => p.y).filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return { min: 0.1, max: 10 };
    const min = Math.max(1e-3, Math.min(...vals) * 0.85);
    const max = Math.max(min * 1.5, Math.max(...vals) * 1.2);
    return { min, max };
  }, [den]);
  const spdRange = useMemo(() => {
    const vals = spd.map((p) => p.y).filter((v) => Number.isFinite(v));
    if (!vals.length) return { min: 300, max: 650 };
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const pad = Math.max(15, (max - min) * 0.15);
    return { min: min - pad, max: max + pad };
  }, [spd]);
  const tmpRange = useMemo(() => {
    const vals = tmp.map((p) => p.y).filter((v) => Number.isFinite(v) && v > 0);
    if (!vals.length) return { min: 1e4, max: 1e6 };
    const min = Math.max(1e3, Math.min(...vals) * 0.85);
    const max = Math.max(min * 1.5, Math.max(...vals) * 1.2);
    return { min, max };
  }, [tmp]);

  return (
    <div id="solar-wind-quick-view-section" className="col-span-12 card bg-neutral-950/80 p-4">
      {/* scroll-margin-top avoids the section title being hidden under the fixed header when deep-linked */}

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-white">Solar Wind Quick View</h2>
            <button
              type="button"
              onClick={openModal}
              className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
              title="About Solar Wind Quick View"
            >
              ?
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            ACE MAG &amp; SWEPAM · Each dot = one reading
          </p>
        </div>
      </div>

      {/* Interplanetary shock alert - carousel through all detected shocks */}
      {currentShock && (
        <div className="mt-2 mb-1 flex items-start gap-2 px-3 py-2.5 rounded-lg border"
          style={{ background: 'rgba(220,38,38,0.12)', borderColor: 'rgba(220,38,38,0.45)' }}>

          {/* Left arrow - previous (older) shock */}
          {shockEvents.length > 1 && (
            <button
              type="button"
              onClick={goPrevShock}
              disabled={safeShockIndex === 0}
              aria-label="Previous shock"
              className="self-center flex-none w-7 h-7 rounded-full flex items-center justify-center text-red-300 hover:text-white hover:bg-red-500/25 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-semibold text-red-400">{currentShock.label}</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                BETA
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(220,38,38,0.28)', color: '#f87171' }}>
                {currentShock.ageStr}
              </span>
              {shockEvents.length > 1 && (
                <span className="text-[11px] text-red-300/80 font-medium tabular-nums">
                  {safeShockIndex + 1} of {shockEvents.length}
                </span>
              )}
            </div>
            <p className="text-xs text-red-300/80 leading-relaxed">
              {currentShock.spdJ !== 0 && `Speed ${currentShock.spdJ > 0 ? '+' : ''}${currentShock.spdJ} km/s. `}
              {currentShock.denR !== 0 && `Density ×${currentShock.denR}. `}
              {currentShock.tmpR !== 0 && `Temp ×${currentShock.tmpR}. `}
              {currentShock.btJ  !== 0 && `Bt ${currentShock.btJ > 0 ? '+' : ''}${currentShock.btJ} nT. `}
              {currentShock.bzJ  !== 0 && `Bz ${currentShock.bzJ > 0 ? '+' : ''}${currentShock.bzJ} nT swing. `}
              Watch Bz: if it turns south, aurora activity will follow.
            </p>
          </div>

          {/* Right arrow - next (more recent) shock */}
          {shockEvents.length > 1 && (
            <button
              type="button"
              onClick={goNextShock}
              disabled={safeShockIndex >= shockEvents.length - 1}
              aria-label="Next shock"
              className="self-center flex-none w-7 h-7 rounded-full flex items-center justify-center text-red-300 hover:text-white hover:bg-red-500/25 disabled:opacity-25 disabled:cursor-not-allowed transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Time range - same style as rest of app */}
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

          {/* 1 - Bz + Bt combined */}
          <div className="h-[90px]">
            <Line
              data={{
                datasets: [
                  zeroLine(cutoff, maxT),
                  ...visibleShockEvents.map((e) => shockLine(e.t, bzBtRange.min, bzBtRange.max)),
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

          {/* 2 - Phi */}
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
                },
                ...visibleShockEvents.map((e) => shockLine(e.t, 0, 360)),
                ],
              }}
              options={phiOpts}
            />
          </div>

          {/* 3 - Density */}
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
                },
                ...visibleShockEvents.map((e) => shockLine(e.t, denRange.min, denRange.max)),
                ],
              }}
              options={denOpts}
            />
          </div>

          {/* 4 - Speed */}
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
                },
                ...visibleShockEvents.map((e) => shockLine(e.t, spdRange.min, spdRange.max)),
                ],
              }}
              options={spdOpts}
            />
          </div>

          {/* 5 - Temperature */}
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
                },
                ...visibleShockEvents.map((e) => shockLine(e.t, tmpRange.min, tmpRange.max)),
                ],
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
          { color: 'bg-yellow-300',  label: 'Shock marker (detected)' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-xs text-neutral-500">
            <span className={`w-2 h-2 rounded-full ${color} inline-block flex-shrink-0`} />
            {label}
          </span>
        ))}
      </div>

      <InfoModal isOpen={!!modalState} onClose={() => setModalState(null)} title={modalState?.title ?? ''} content={modalState?.content ?? ''} />

    </div>
  );
};

export default SolarWindQuickView;