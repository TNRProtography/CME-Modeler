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

<<<<<<< HEAD
import React, { useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
=======
import React, { useMemo, useState, useCallback } from 'react';
>>>>>>> 34d35cb66366e62663c231c880f93c5ae5d803ad
import { Line } from 'react-chartjs-2';
import type { ChartOptions } from 'chart.js';
import CloseIcon from './icons/CloseIcon';

<<<<<<< HEAD
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

=======
interface InfoModalProps { isOpen: boolean; onClose: () => void; title: string; content: string | React.ReactNode; }
const InfoModal: React.FC<InfoModalProps> = ({ isOpen, onClose, title, content }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[2100] flex justify-center items-center p-4" onClick={onClose}>
      <div className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-lg max-h-[85vh] text-neutral-300 flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h3 className="text-xl font-bold text-neutral-200">{title}</h3>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"><CloseIcon className="w-6 h-6" /></button>
        </div>
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 text-sm leading-relaxed">
          {typeof content === 'string' ? (<div dangerouslySetInnerHTML={{ __html: content }} />) : (content)}
        </div>
      </div>
    </div>
  );
};

>>>>>>> 34d35cb66366e62663c231c880f93c5ae5d803ad
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
  magneticData, clockData, speedData, densityData, tempData,
}) => {
  const [rangeMs, setRangeMs] = useState(6 * 3600000);
  const [modalState, setModalState] = useState<{ title: string; content: string } | null>(null);

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
        'These parameters directly control aurora activity. Southward Bz (negative) opens the magnetosphere to energy input; high speed and density amplify that effect. Watching all five subplots together reveals whether conditions are building, stable, or declining — typically 30–60 minutes before they hit Earth.',
        'Shock events are flagged automatically as yellow dashed vertical markers. Shock types: Fast Forward (FF) — density↑ temp↑ IMF↑ speed↑; Slow Forward (SF) — same but IMF↓; Fast Reverse (FR) — density↓ temp↓ IMF↓ speed↑; Slow Reverse (SR) — density↓ temp↓ IMF↑ speed↑; IMF Discontinuity — strong field step without a matching plasma jump.'
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
  // This detector is intentionally conservative:
  // - uses median pre/post windows (robust to spikes/gaps),
  // - requires multi-parameter compression/rarefaction consistency,
  // - and limits visible events to recent windows.
  //
  // Practical science intent:
  // - Forward IP shock (CME/SIR front): V↑, N↑, Pdyn↑, usually |B|↑ and Tp↑.
  // - Reverse IP shock / trailing rarefaction edge: V↓, N↓, Pdyn↓.
  // - IMF enhancement/discontinuity: strong magnetic step/rotation with little plasma jump.
  const shockEvents = useMemo(() => {
    const LOOK_BACK = 6 * 3600000; // UI alerts should represent very recent structure only
    const CANDIDATE_STEP = 3 * 60000;
    const PRE_WIN = 18 * 60000;
    const POST_WIN = 12 * 60000;
    const now = Date.now();

    const spdSorted = [...speedData].sort((a, b) => a.x - b.x);
    const denSorted = [...densityData].sort((a, b) => a.x - b.x);
    const tmpSorted = [...tempData].sort((a, b) => a.x - b.x);
    const magSorted = [...magneticData].sort((a, b) => a.time - b.time);
    if (spdSorted.length < 10 || denSorted.length < 10 || magSorted.length < 10) return null;

    const median = (vals: number[]): number => {
      if (!vals.length) return NaN;
      const v = [...vals].sort((a, b) => a - b);
      const m = Math.floor(v.length / 2);
      return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
    };
    const sample = (arr: { x: number; y: number }[], a: number, b: number): number[] =>
      arr.filter(p => p.x >= a && p.x < b).map(p => p.y).filter(n => Number.isFinite(n));
    const sampleMag = (a: number, b: number): { bt: number[]; bz: number[] } => ({
      bt: magSorted.filter(p => p.time >= a && p.time < b).map(p => p.bt).filter(n => Number.isFinite(n)),
      bz: magSorted.filter(p => p.time >= a && p.time < b).map(p => p.bz).filter(n => Number.isFinite(n)),
    });

    const events: Array<{
      t: number; score: number; label: string;
      spdJ: number; denR: number; tmpR: number; btJ: number; bzJ: number;
      ageMin: number; ageStr: string;
    }> = [];

    const tStart = Math.max(now - LOOK_BACK, spdSorted[0].x + PRE_WIN);
    for (let t = tStart; t <= now - POST_WIN; t += CANDIDATE_STEP) {
      const preSpd = sample(spdSorted, t - PRE_WIN, t);
      const postSpd = sample(spdSorted, t, t + POST_WIN);
      const preDen = sample(denSorted, t - PRE_WIN, t);
      const postDen = sample(denSorted, t, t + POST_WIN);
      const preTmp = sample(tmpSorted, t - PRE_WIN, t);
      const postTmp = sample(tmpSorted, t, t + POST_WIN);
      const preMag = sampleMag(t - PRE_WIN, t);
      const postMag = sampleMag(t, t + POST_WIN);
      if (preSpd.length < 3 || postSpd.length < 3 || preDen.length < 3 || postDen.length < 3 || preMag.bt.length < 3 || postMag.bt.length < 3) continue;

      const spd1 = median(preSpd), spd2 = median(postSpd);
      const den1 = median(preDen), den2 = median(postDen);
      const tmp1 = median(preTmp), tmp2 = median(postTmp);
      const bt1 = median(preMag.bt), bt2 = median(postMag.bt);
      const bz1 = median(preMag.bz), bz2 = median(postMag.bz);
      if (![spd1, spd2, den1, den2, bt1, bt2, bz1, bz2].every(Number.isFinite)) continue;

      const pDyn1 = den1 > 0 ? den1 * spd1 * spd1 : NaN; // proportional dynamic pressure proxy
      const pDyn2 = den2 > 0 ? den2 * spd2 * spd2 : NaN;
      const spdDelta = spd2 - spd1;
      const denRatio = den1 > 0 ? den2 / den1 : NaN;
      const tmpRatio = tmp1 > 0 ? tmp2 / tmp1 : NaN;
      const btDelta = bt2 - bt1;
      const btRatio = bt1 > 0 ? bt2 / bt1 : NaN;
      const bzDelta = bz2 - bz1;
      const pDynRatio = pDyn1 > 0 ? pDyn2 / pDyn1 : NaN;
      if (![denRatio, tmpRatio, btRatio, pDynRatio].every(Number.isFinite)) continue;

      // Four IPS signatures in spacecraft frame (FF / SF / FR / SR):
      // - N,T step direction defines forward(+,+) vs reverse(-,-)
      // - B step sign separates fast vs slow branch
      // - V increases across all four classes at the shock crossing.
      const vUp = spdDelta >= 20;
      const nUp = denRatio >= 1.35;
      const nDown = denRatio <= 0.75;
      const tUp = tmpRatio >= 1.2;
      const tDown = tmpRatio <= 0.85;
      const bUp = btRatio >= 1.15 || btDelta >= 1.5;
      const bDown = btRatio <= 0.88 || btDelta <= -1.5;

      const ff = vUp && nUp && tUp && bUp;     // Fast Forward
      const sf = vUp && nUp && tUp && bDown;   // Slow Forward
      const fr = vUp && nDown && tDown && bDown; // Fast Reverse
      const sr = vUp && nDown && tDown && bUp; // Slow Reverse

      const imfEnhancement =
        (Math.abs(btDelta) >= 4 || btRatio >= 1.4 || Math.abs(bzDelta) >= 8) &&
        Math.abs(spdDelta) < 25 &&
        denRatio > 0.75 && denRatio < 1.35 &&
        pDynRatio > 0.7 && pDynRatio < 1.6;

      let label = '';
      let score = 0;
      if (ff) {
        label = 'Fast Forward Shock (FF)';
        score = 8 + Number(pDynRatio >= 1.8) + Number(btRatio >= 1.3);
      } else if (sf) {
        label = 'Slow Forward Shock (SF)';
        score = 7 + Number(pDynRatio >= 1.6);
      } else if (fr) {
        label = 'Fast Reverse Shock (FR)';
        score = 7 + Number(pDynRatio <= 0.75);
      } else if (sr) {
        label = 'Slow Reverse Shock (SR)';
        score = 6 + Number(pDynRatio <= 0.8);
      } else if (imfEnhancement) {
        label = 'IMF Enhancement / Discontinuity';
        score = 3 + Number(Math.abs(bzDelta) >= 8);
      } else {
        continue;
      }

      const ageMin = Math.round((now - t) / 60000);
      if (ageMin > 360) continue;
      const ageStr = ageMin < 2   ? 'just now'
        : ageMin < 60 ? `~${ageMin} min ago`
        : `~${Math.floor(ageMin / 60)}h${ageMin % 60 > 0 ? ` ${ageMin % 60}min` : ''} ago`;

      events.push({
        t,
        score,
        label,
        spdJ: Math.round(spdDelta),
        denR: +denRatio.toFixed(2),
        tmpR: +tmpRatio.toFixed(2),
        btJ: +btDelta.toFixed(1),
        bzJ: +bzDelta.toFixed(1),
        ageMin,
        ageStr,
      });
    }

    if (!events.length) return [];
    // Keep strongest non-overlapping events, then order chronologically.
    const dedupeWindowMs = 20 * 60000;
    const selected = events
      .sort((a, b) => b.score - a.score || b.t - a.t)
      .reduce<typeof events>((acc, ev) => {
        const overlaps = acc.some((s) => Math.abs(s.t - ev.t) < dedupeWindowMs);
        if (!overlaps) acc.push(ev);
        return acc;
      }, [])
      .slice(0, 4)
      .sort((a, b) => a.t - b.t);

    return selected;
  }, [speedData, densityData, tempData, magneticData]);
  const latestShock = shockEvents.length ? shockEvents[shockEvents.length - 1] : null;

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
    <div className="col-span-12 card bg-neutral-950/80 p-4">

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

      {/* Interplanetary shock alert — matches notification label */}
      {latestShock && (
        <div className="mt-2 mb-1 flex items-start gap-3 px-3 py-2.5 rounded-lg border"
          style={{ background: 'rgba(220,38,38,0.12)', borderColor: 'rgba(220,38,38,0.45)' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-sm font-semibold text-red-400">{latestShock.label}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                style={{ background: 'rgba(220,38,38,0.28)', color: '#f87171' }}>
                {latestShock.ageStr}
              </span>
              {shockEvents.length > 1 && (
                <span className="text-[11px] text-red-300/80">+{shockEvents.length - 1} more detected in window</span>
              )}
            </div>
            <p className="text-xs text-red-300/80 leading-relaxed">
              {latestShock.spdJ !== 0 && `Speed ${latestShock.spdJ > 0 ? '+' : ''}${latestShock.spdJ} km/s. `}
              {latestShock.denR !== 0 && `Density ×${latestShock.denR}. `}
              {latestShock.tmpR !== 0 && `Temp ×${latestShock.tmpR}. `}
              {latestShock.btJ  !== 0 && `Bt ${latestShock.btJ > 0 ? '+' : ''}${latestShock.btJ} nT. `}
              {latestShock.bzJ  !== 0 && `Bz ${latestShock.bzJ > 0 ? '+' : ''}${latestShock.bzJ} nT swing. `}
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
                },
                ...visibleShockEvents.map((e) => shockLine(e.t, 0, 360)),
                ],
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
                },
                ...visibleShockEvents.map((e) => shockLine(e.t, denRange.min, denRange.max)),
                ],
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
                },
                ...visibleShockEvents.map((e) => shockLine(e.t, spdRange.min, spdRange.max)),
                ],
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
