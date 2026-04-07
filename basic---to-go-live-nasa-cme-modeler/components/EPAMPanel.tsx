// --- START OF FILE src/components/EPAMPanel.tsx ---
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Line } from 'react-chartjs-2';
import type { ChartOptions, ChartData } from 'chart.js';
import CloseIcon from './icons/CloseIcon';

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

// ─── Types ────────────────────────────────────────────────────────────────────
interface EpamPoint { time_tag: string; p1: number|null; p3: number|null; p5: number|null; p7: number|null; p8: number|null; e1: number|null; e2: number|null; anisotropy_index: number|null; }
interface GoesPoint { time_tag: string; ge1?: number|null; ge10?: number|null; ge30?: number|null; ge50?: number|null; ge100?: number|null; ge500?: number|null; }
interface StereoPoint { time_tag: string; speed?: number|null; density?: number|null; bz?: number|null; bt?: number|null; sep_lo?: number|null; sep_hi?: number|null; }
interface AnalysisData { status: string; statusLabel: string; description: string; signatures: { velocity_dispersion: boolean; channel_compression: boolean; sharp_spike: boolean; anisotropy_elevated: boolean; elevated_channels: number }; metrics: { anisotropy_index: number|null; log_spread_4h_trend: number|null }; goes_validation?: { available: boolean; ge10_mev_flux: number|null; s1_alert: boolean; elevated: boolean }; }
interface CombinedData { cross_validation: { confidence: string; confidenceLabel: string; ace_epam_elevated: boolean; goes_s1_alert: boolean; stereo_elevated: boolean }; }
interface SolarWindPoint { x: number; y: number; }
interface SolarMagPoint { time: number; bt: number; bz: number; }
interface ShockEvent { t: number; label: string; score: number; }

const EPAM_BASE = 'https://epam.thenamesrock.workers.dev';
const SOLAR_WIND_IMF_URL = 'https://imap-solar-data-test.thenamesrock.workers.dev/rtsw/merged-24h';

// Views: raw charts per source + one combined averaged chart
type ViewKey = 'ace-raw' | 'goes-raw' | 'stereo-raw' | 'combined';
const VIEWS: {key: ViewKey; label: string}[] = [
  {key: 'ace-raw',  label: 'ACE Raw'},
  {key: 'goes-raw', label: 'GOES Raw'},
  {key: 'stereo-raw', label: 'STEREO Raw'},
  {key: 'combined',   label: 'Combined Average'},
];

type TimeRange = 24 | 72 | 168;
const TIME_RANGES: {value: TimeRange; label: string}[] = [
  {value: 24,  label: '24h'},
  {value: 72,  label: '72h'},
  {value: 168, label: '7 days'},
];

// ─── Chart.js base options ────────────────────────────────────────────────────
const baseOptions = (yType: 'logarithmic'|'linear', yLabel: string): ChartOptions<'line'> => ({
  responsive: true, maintainAspectRatio: false, animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: {
      position: 'top', align: 'end',
      labels: {
        color: '#a3a3a3', boxWidth: 24, boxHeight: 2, padding: 10, font: { size: 11 },
        filter: (item) => String(item.text ?? '') !== '__shock__',
      },
    },
    tooltip: {
      backgroundColor: '#1a1a1a', borderColor: '#3f3f46', borderWidth: 1, titleColor: '#e5e5e5', bodyColor: '#a3a3a3',
      filter: (ctx) => String(ctx.dataset?.label ?? '') !== '__shock__',
    },
  },
  scales: {
    x: { type: 'time', time: { tooltipFormat: 'dd MMM HH:mm', displayFormats: { hour: 'HH:mm', day: 'dd MMM' } }, ticks: { color: '#71717a', maxTicksLimit: 8, maxRotation: 0, font: { size: 10 } }, grid: { color: '#27272a' }, title: { display: true, text: 'NZT', color: '#52525b', font: { size: 9 } } },
    y: { type: yType, ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 6, callback: (val: number | string) => {
          const n = Number(val);
          if (!isFinite(n) || n <= 0) return '';
          const exp = Math.floor(Math.log10(n));
          const base = n / Math.pow(10, exp);
          if (Math.abs(base - 1) < 0.01) return `1e${exp}`;
          if (Math.abs(base - 2) < 0.05) return `2e${exp}`;
          if (Math.abs(base - 5) < 0.1)  return `5e${exp}`;
          return `${base.toFixed(0)}e${exp}`;
        }, }, grid: { color: '#27272a' }, title: { display: true, text: yLabel, color: '#71717a', font: { size: 10 } } },
  },
});

// ─── Status styling ───────────────────────────────────────────────────────────
const STATUS_STYLES: Record<string,{dot:string;bg:string;border:string;text:string}> = {
  SHOCK_PASSAGE:    {dot:'bg-red-500',    bg:'bg-red-950/60',    border:'border-red-700/60',    text:'text-red-300'},
  CME_WATCH:        {dot:'bg-orange-400', bg:'bg-orange-950/60', border:'border-orange-700/60', text:'text-orange-300'},
  COMPRESSION:      {dot:'bg-yellow-400', bg:'bg-yellow-950/60', border:'border-yellow-700/60', text:'text-yellow-300'},
  DISPERSION:       {dot:'bg-yellow-500', bg:'bg-yellow-950/50', border:'border-yellow-700/50', text:'text-yellow-300'},
  SEP_STREAMING:    {dot:'bg-sky-400',    bg:'bg-sky-950/60',    border:'border-sky-700/60',    text:'text-sky-300'},
  ELEVATED:         {dot:'bg-sky-500',    bg:'bg-sky-950/40',    border:'border-sky-800/60',    text:'text-sky-400'},
  SLIGHT_ELEVATION: {dot:'bg-neutral-400',bg:'bg-neutral-800/60',border:'border-neutral-700',   text:'text-neutral-300'},
  QUIET:            {dot:'bg-green-500',  bg:'bg-neutral-900/60',border:'border-neutral-700/60',text:'text-neutral-400'},
};

function estimateArrival(status: string, trend: number|null): string|null {
  if (status==='SHOCK_PASSAGE') return '⏱ Storm reaches Earth in ~45–60 minutes — watch Bz now';
  if (status==='CME_WATCH') return (trend!==null&&trend<-1e-9) ? '⏱ Could reach Earth within 2–6 hours — keep watching' : '⏱ Could reach Earth within 6–24 hours';
  if (status==='COMPRESSION') return '⏱ Possible arrival within 12–24 hours — check back later';
  if (status==='DISPERSION') return '⏱ Watch: possible arrival within 24 hours';
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Always parse a time_tag string as UTC, regardless of whether the source
 * includes a 'Z' suffix or not. Without this, browsers treat bare ISO strings
 * (e.g. "2025-03-27T10:00:00") as LOCAL time, shifting everything by the
 * local UTC offset — 13 hours wrong for NZ users.
 */
function parseUTC(s: string): number {
  if (!s) return NaN;
  // Already has timezone info — parse as-is
  if (s.endsWith('Z') || s.includes('+') || /[T ]\d{2}:\d{2}(:\d{2})?[-+]\d/.test(s)) {
    return new Date(s).getTime();
  }
  // No timezone marker — force UTC by appending Z
  return new Date(s.replace(' ', 'T') + 'Z').getTime();
}

// Compute geometric mean across channels (handles log-scale data well)
function geoMeanRow(values: (number|null)[]): number|null {
  const valid = values.filter((v): v is number => v !== null && v > 0);
  if (valid.length === 0) return null;
  const logSum = valid.reduce((sum, v) => sum + Math.log10(v), 0);
  return Math.pow(10, logSum / valid.length);
}

function filterByTimeRange(data: {time_tag: string}[], hours: TimeRange) {
  const cutoff = Date.now() - hours * 3600 * 1000;
  return data.filter(p => parseUTC(p.time_tag) > cutoff);
}

// ── Spike filter ─────────────────────────────────────────────────────────────
// Removes 1–2 point data artifacts from a series before rendering.
// On a log scale, a bad reading like 1e-20 (vs normal ~1e0) or a sudden
// vertical spike that immediately returns to baseline is visually destructive —
// it collapses the entire Y axis range so the real signal is unreadable.
//
// For each point we look at the WINDOW_SIZE readings on each side. We compute
// the median of those neighbours on a log scale. If the point deviates by more
// than THRESHOLD log units (e.g. 2.5 = 316×) from that median AND it is
// isolated (the point immediately before AND after it are both also outliers),
// we replace it with null. Chart.js spans nulls smoothly on log scales.
//
// Using 2 readings (ISOLATION = 2) means genuine 3+-reading elevated periods
// are never removed — only genuine single/double-point glitches are filtered.
function spikeFilter(
  data: { x: number; y: number | null }[],
  threshold = 2.5,   // log10 units — 10^2.5 ≈ 316× deviation required to qualify
  isolation = 2,     // max consecutive outlier points to remove
  windowSize = 5     // neighbours on each side used for median
): { x: number; y: number | null }[] {
  if (data.length < windowSize * 2 + 1) return data;

  // Work in log10 space — EPAM data spans many decades
  const logY = data.map(d =>
    d.y !== null && d.y > 0 ? Math.log10(d.y) : null
  );

  // Compute neighbourhood median for each point
  const neighbourMedian = logY.map((_, i) => {
    const neighbours: number[] = [];
    for (let j = Math.max(0, i - windowSize); j <= Math.min(logY.length - 1, i + windowSize); j++) {
      if (j !== i && logY[j] !== null) neighbours.push(logY[j] as number);
    }
    if (neighbours.length < 3) return null;
    const sorted = [...neighbours].sort((a, b) => a - b);
    const m = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[m - 1] + sorted[m]) / 2 : sorted[m];
  });

  // Mark outliers: points that deviate by >threshold log units from their
  // neighbourhood median AND are not part of a sustained run of ≥isolation+1
  // consecutive elevated points.
  const isOutlier = logY.map((v, i) => {
    if (v === null || neighbourMedian[i] === null) return false;
    return Math.abs(v - (neighbourMedian[i] as number)) > threshold;
  });

  // Walk runs of consecutive outliers — only suppress runs of ≤isolation length
  const suppressed = [...isOutlier];
  let runStart = -1;
  for (let i = 0; i <= isOutlier.length; i++) {
    if (i < isOutlier.length && isOutlier[i]) {
      if (runStart === -1) runStart = i;
    } else {
      if (runStart !== -1) {
        const runLen = i - runStart;
        if (runLen > isolation) {
          // Real sustained event — un-suppress the whole run
          for (let j = runStart; j < i; j++) suppressed[j] = false;
        }
        runStart = -1;
      }
    }
  }

  return data.map((d, i) => suppressed[i] ? { x: d.x, y: null } : d);
}

const mkDs = (pts: any[], timeKey: string, valueKey: string, color: string, label: string, positiveOnly = true) => ({
  label, borderColor: color, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0,
  spanGaps: true,
  data: spikeFilter(
    pts
      .map(p => ({ x: parseUTC(String(p[timeKey])), y: p[valueKey] ?? null }))
      .filter(d => d.y !== null && (!positiveOnly || (d.y as number) > 0))
  ),
});

// ACE raw: 5 proton channels
const ACE_CH = [
  {k:'p1',c:'#60a5fa',l:'P1 47–68 keV'},
  {k:'p3',c:'#34d399',l:'P3 115–195 keV'},
  {k:'p5',c:'#facc15',l:'P5 310–580 keV'},
  {k:'p7',c:'#fb923c',l:'P7 795–1193 keV'},
  {k:'p8',c:'#f87171',l:'P8 1–1.9 MeV'},
];

// GOES raw: integral proton thresholds
const GOES_CH = [
  {k:'ge1',  c:'#93c5fd',l:'≥1 MeV'},
  {k:'ge10', c:'#fde047',l:'≥10 MeV'},
  {k:'ge100',c:'#ef4444',l:'≥100 MeV'},
  {k:'ge500',c:'#991b1b',l:'≥500 MeV'},
];

const SHOCK_COLORS: Record<string, string> = {
  'Fast Forward Shock (FF)': 'rgba(239, 68, 68, 0.95)',
  'Slow Forward Shock (SF)': 'rgba(249, 115, 22, 0.95)',
  'Fast Reverse Shock (FR)': 'rgba(59, 130, 246, 0.95)',
  'Slow Reverse Shock (SR)': 'rgba(14, 165, 233, 0.95)',
  'IMF Enhancement / Discontinuity': 'rgba(250, 204, 21, 0.95)',
};

function shockMarkerDataset(t: number, yMin: number, yMax: number, color: string) {
  return {
    label: '__shock__',
    data: [{ x: t, y: yMin }, { x: t, y: yMax }],
    borderColor: color,
    borderWidth: 1.3,
    borderDash: [5, 4],
    pointRadius: 0,
    showLine: true,
    tension: 0,
    order: 50,
  };
}

function deriveShockEvents(speed: SolarWindPoint[], density: SolarWindPoint[], temp: SolarWindPoint[], mag: SolarMagPoint[]): ShockEvent[] {
  const now = Date.now();
  const LOOK_BACK = 6 * 3600000;
  const CANDIDATE_STEP = 3 * 60000;
  const PRE_WIN = 18 * 60000;
  const POST_WIN = 12 * 60000;
  const spdSorted = [...speed].sort((a, b) => a.x - b.x);
  const denSorted = [...density].sort((a, b) => a.x - b.x);
  const tmpSorted = [...temp].sort((a, b) => a.x - b.x);
  const magSorted = [...mag].sort((a, b) => a.time - b.time);
  if (spdSorted.length < 10 || denSorted.length < 10 || magSorted.length < 10) return [];

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

  const events: ShockEvent[] = [];
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

    const pDyn1 = den1 > 0 ? den1 * spd1 * spd1 : NaN;
    const pDyn2 = den2 > 0 ? den2 * spd2 * spd2 : NaN;
    const spdDelta = spd2 - spd1;
    const denRatio = den1 > 0 ? den2 / den1 : NaN;
    const tmpRatio = tmp1 > 0 ? tmp2 / tmp1 : NaN;
    const btDelta = bt2 - bt1;
    const btRatio = bt1 > 0 ? bt2 / bt1 : NaN;
    const bzDelta = bz2 - bz1;
    const pDynRatio = pDyn1 > 0 ? pDyn2 / pDyn1 : NaN;
    if (![denRatio, tmpRatio, btRatio, pDynRatio].every(Number.isFinite)) continue;

    const vUp = spdDelta >= 20;
    const nUp = denRatio >= 1.35;
    const nDown = denRatio <= 0.75;
    const tUp = tmpRatio >= 1.2;
    const tDown = tmpRatio <= 0.85;
    const bUp = btRatio >= 1.15 || btDelta >= 1.5;
    const bDown = btRatio <= 0.88 || btDelta <= -1.5;

    let label = '';
    let score = 0;
    if (vUp && nUp && tUp && bUp) { label = 'Fast Forward Shock (FF)'; score = 8 + Number(pDynRatio >= 1.8); }
    else if (vUp && nUp && tUp && bDown) { label = 'Slow Forward Shock (SF)'; score = 7 + Number(pDynRatio >= 1.6); }
    else if (vUp && nDown && tDown && bDown) { label = 'Fast Reverse Shock (FR)'; score = 7 + Number(pDynRatio <= 0.75); }
    else if (vUp && nDown && tDown && bUp) { label = 'Slow Reverse Shock (SR)'; score = 6 + Number(pDynRatio <= 0.8); }
    else if ((Math.abs(btDelta) >= 4 || btRatio >= 1.4 || Math.abs(bzDelta) >= 8) && Math.abs(spdDelta) < 25 && denRatio > 0.75 && denRatio < 1.35) {
      label = 'IMF Enhancement / Discontinuity';
      score = 3 + Number(Math.abs(bzDelta) >= 8);
    } else continue;

    events.push({ t, label, score });
  }

  const dedupeWindowMs = 20 * 60000;
  return events
    .sort((a, b) => b.score - a.score || b.t - a.t)
    .reduce<ShockEvent[]>((acc, ev) => {
      if (!acc.some((e) => Math.abs(e.t - ev.t) < dedupeWindowMs)) acc.push(ev);
      return acc;
    }, [])
    .slice(0, 4)
    .sort((a, b) => a.t - b.t);
}

// ─── View metadata ────────────────────────────────────────────────────────────
const VIEW_INFO: Record<ViewKey, {title: string; subtitle: string; note?: string}> = {
  'ace-raw':  {title: 'Solar Storm Early Warning (L1 Satellite)', subtitle: 'Real-time particle readings from a satellite parked 1.5 million km in front of Earth — about 45–60 minutes upstream of us. When the lines start rising together across all colours and converging on the graph, that is the pattern that often precedes a solar storm arriving at Earth. The earlier the lines rise, the more warning time you have.'},
  'goes-raw': {title: 'GOES Satellite — Storm Confirmation', subtitle: 'A second satellite in a fixed orbit above Earth, used to confirm what the upstream L1 satellite is seeing. If both satellites are elevated at the same time, the solar storm signal is much more reliable. The ≥10 MeV line is the key one to watch — if it jumps sharply, a solar radiation storm is in progress.'},
  'stereo-raw': {title: 'STEREO-A — Ahead-of-Earth Satellite', subtitle: 'Particle readings from a satellite that orbits slightly ahead of Earth, giving an early peek at what is coming along the Sun–Earth line.', note: '⚠ STEREO-A orbits about 10–15° ahead of Earth and sees the Sun from a different angle — so elevated readings here do not always mean the same storm will hit Earth. Think of it as a neighbour getting rain before you — useful context, but not a direct forecast for your location.'},
  'combined': {title: 'All Satellites — Combined Overview', subtitle: 'One averaged trend line per satellite, making it easy to compare all three at a glance. If all three are rising together, that is the strongest possible signal. Toggle individual satellites on or off with the buttons below.'},
};

// ─── Main component ───────────────────────────────────────────────────────────
const EPAMPanel: React.FC = () => {
  const [view,       setView]       = useState<ViewKey>('ace-raw');
  const [timeRange,  setTimeRange]  = useState<TimeRange>(24);
  const [epamRaw,    setEpamRaw]    = useState<EpamPoint[]>([]);
  const [goesRaw,    setGoesRaw]    = useState<GoesPoint[]>([]);
  const [stereoRaw,  setStereoRaw]  = useState<StereoPoint[]>([]);
  const [analysis,   setAnalysis]   = useState<AnalysisData|null>(null);
  const [combined,   setCombined]   = useState<CombinedData|null>(null);
  const [loading,    setLoading]    = useState(true);
  const [lastUpdated,setLastUpdated]= useState<Date|null>(null);
  // Combined view toggles — STEREO off by default
  const [showAce,    setShowAce]    = useState(true);
  const [showGoes,   setShowGoes]   = useState(true);
  const [showStereo, setShowStereo] = useState(false);
  const [showShockMarkers, setShowShockMarkers] = useState(true);
  const [speedRaw,   setSpeedRaw]   = useState<SolarWindPoint[]>([]);
  const [densityRaw, setDensityRaw] = useState<SolarWindPoint[]>([]);
  const [tempRaw,    setTempRaw]    = useState<SolarWindPoint[]>([]);
  const [magRaw,     setMagRaw]     = useState<SolarMagPoint[]>([]);
  const mountedRef = useRef(true);
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
      title: 'About Energetic Particle Monitor',
      content: buildStatTooltip(
        'Energetic Particle Monitor',
        'Tracks upstream high-energy particle fluxes from ACE, GOES, and STEREO-A satellites. These channels measure electrons and protons accelerated by solar eruptions before they reach Earth.',
        'Elevated particle counts are an early warning that a solar disturbance is approaching. A fast-rising spike across multiple channels often precedes a CME shock arrival and subsequent aurora enhancement by 30–90 minutes.',
        'This is context data, not a direct aurora brightness forecast. Velocity dispersion signatures (higher-energy particles arriving first) and channel compression patterns help distinguish CME shocks from stream interaction regions.'
      ),
    });
  }, []);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const [r1,r2,r3,r4,r5,r6] = await Promise.allSettled([
        fetch(`${EPAM_BASE}/epam/raw`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/goes`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/stereo`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/analysis`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/combined`).then(r=>r.ok?r.json():null),
        fetch(`${SOLAR_WIND_IMF_URL}?_=${Date.now()}`).then(r=>r.ok?r.json():null),
      ]);
      if (!mountedRef.current) return;
      if (r1.status==='fulfilled' && r1.value?.data)              setEpamRaw(r1.value.data);
      if (r2.status==='fulfilled' && r2.value?.data)              setGoesRaw(r2.value.data);
      if (r3.status==='fulfilled' && r3.value?.data)              setStereoRaw(r3.value.data);
      if (r4.status==='fulfilled' && r4.value?.status)            setAnalysis(r4.value);
      if (r5.status==='fulfilled' && r5.value?.cross_validation)  setCombined(r5.value);
      if (r6.status==='fulfilled' && r6.value) {
        const s = Array.isArray((r6.value as any).speed) ? (r6.value as any).speed : [];
        const d = Array.isArray((r6.value as any).density) ? (r6.value as any).density : [];
        const t = Array.isArray((r6.value as any).temp) ? (r6.value as any).temp : [];
        const m = Array.isArray((r6.value as any).mag) ? (r6.value as any).mag : [];
        setSpeedRaw(s.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)));
        setDensityRaw(d.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)));
        setTempRaw(t.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)));
        setMagRaw(m.filter((p: any) => Number.isFinite(p?.time) && Number.isFinite(p?.bt) && Number.isFinite(p?.bz)));
      }
      setLastUpdated(new Date());
    } catch {}
    finally { if (mountedRef.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    const iv = setInterval(fetchAll, 3*60*1000);
    return () => { mountedRef.current = false; clearInterval(iv); };
  }, [fetchAll]);

  // ── Filter data by time range ────────────────────────────────────────────────
  const filteredEpam   = useMemo(() => filterByTimeRange(epamRaw,   timeRange), [epamRaw,   timeRange]);
  const filteredGoes   = useMemo(() => filterByTimeRange(goesRaw,   timeRange), [goesRaw,   timeRange]);
  const filteredStereo = useMemo(() => filterByTimeRange(stereoRaw, timeRange), [stereoRaw, timeRange]);
  const shockEvents = useMemo(() => deriveShockEvents(speedRaw, densityRaw, tempRaw, magRaw), [speedRaw, densityRaw, tempRaw, magRaw]);
  const visibleShockEvents = useMemo(() => {
    const cutoff = Date.now() - timeRange * 3600 * 1000;
    return shockEvents.filter((e) => e.t >= cutoff);
  }, [shockEvents, timeRange]);

  // ── Build chart data ────────────────────────────────────────────────────────
  const chartData = useMemo((): ChartData<'line'>|null => {
    const rev = (a: any[]) => [...a].reverse();
    const withShockMarkers = (datasets: any[]) => {
      if (!showShockMarkers || view === 'stereo-raw' || !visibleShockEvents.length) return datasets;
      const values = datasets.flatMap((ds: any) => (Array.isArray(ds?.data) ? ds.data : []))
        .map((p: any) => Number(p?.y))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      if (!values.length) return datasets;
      const yMin = Math.max(1e-6, Math.min(...values) * 0.8);
      const yMax = Math.max(yMin * 1.2, Math.max(...values) * 1.25);
      const markers = visibleShockEvents.map((e) =>
        shockMarkerDataset(e.t, yMin, yMax, SHOCK_COLORS[e.label] ?? 'rgba(250, 204, 21, 0.95)')
      );
      return [...datasets, ...markers];
    };

    if (view === 'ace-raw') {
      if (!filteredEpam.length) return null;
      return { datasets: withShockMarkers(ACE_CH.map(c => mkDs(rev(filteredEpam), 'time_tag', c.k, c.c, c.l))) };
    }

    if (view === 'goes-raw') {
      if (!filteredGoes.length) return null;
      return { datasets: withShockMarkers(GOES_CH.map(c => mkDs(rev(filteredGoes), 'time_tag', c.k, c.c, c.l))) };
    }

    if (view === 'stereo-raw') {
      if (!filteredStereo.length) return null;
      const pts = rev(filteredStereo);
      return { datasets: [
        {...mkDs(pts,'time_tag','sep_lo','#a78bfa','Protons 75–623 keV'), yAxisID:'y'},
        {...mkDs(pts,'time_tag','sep_hi','#c084fc','Protons 623 keV–21 MeV'), yAxisID:'y'},
        {...mkDs(pts,'time_tag','electrons_lo','#e879f9','e⁻ 35–65 keV'), yAxisID:'y'},
        {...mkDs(pts,'time_tag','speed','#34d399','Speed (km/s)',false), yAxisID:'y2'},
        {...mkDs(pts,'time_tag','bt','#60a5fa','Bt (nT)',false), yAxisID:'y2'},
      ]};
    }

    if (view === 'combined') {
      const datasets: any[] = [];

      // ACE average: geometric mean across 5 proton channels
      if (showAce && filteredEpam.length) {
        const pts = spikeFilter(rev(filteredEpam).map(p => ({
          x: parseUTC(p.time_tag),
          y: geoMeanRow([p.p1, p.p3, p.p5, p.p7, p.p8]),
        })).filter(d => d.y !== null && d.y > 0));
        datasets.push({ label: 'ACE EPAM (avg all channels)', borderColor: '#60a5fa', backgroundColor: '#60a5fa20', borderWidth: 2, pointRadius: 0, tension: 0.2, spanGaps: true, data: pts });
      }

      // GOES average: geometric mean across available channels
      if (showGoes && filteredGoes.length) {
        const pts = spikeFilter(rev(filteredGoes).map(p => ({
          x: parseUTC(p.time_tag),
          y: geoMeanRow([p.ge1 ?? null, p.ge10 ?? null, p.ge100 ?? null, p.ge500 ?? null]),
        })).filter(d => d.y !== null && d.y > 0));
        datasets.push({ label: 'GOES SEISS (avg all channels)', borderColor: '#fde047', backgroundColor: '#fde04720', borderWidth: 2, pointRadius: 0, tension: 0.2, spanGaps: true, data: pts });
      }

      // STEREO average: geometric mean of proton channels
      if (showStereo && filteredStereo.length) {
        const pts = rev(filteredStereo).map(p => ({
          x: parseUTC(p.time_tag),
          y: geoMeanRow([p.sep_lo ?? null, p.sep_hi ?? null]),
        })).filter(d => d.y !== null && d.y > 0);
        datasets.push({ label: 'STEREO-A (avg particle channels)', borderColor: '#a78bfa', backgroundColor: '#a78bfa20', borderWidth: 2, pointRadius: 0, tension: 0.2, borderDash: [4,3], data: pts });
      }

      return datasets.length ? { datasets: withShockMarkers(datasets) } : null;
    }

    return null;
  }, [view, filteredEpam, filteredGoes, filteredStereo, showAce, showGoes, showStereo, showShockMarkers, visibleShockEvents]);

  // ── Chart options ─────────────────────────────────────────────────────────
  const chartOptions: ChartOptions<'line'> = useMemo(() => {
    if (view === 'stereo-raw') {
      return {
        ...baseOptions('logarithmic', 'Particle flux'),
        scales: {
          x: (baseOptions('logarithmic','') as any).scales.x,
          y:  { type: 'logarithmic', ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 6, callback: (val: number | string) => {
          const n = Number(val);
          if (!isFinite(n) || n <= 0) return '';
          const exp = Math.floor(Math.log10(n));
          const base = n / Math.pow(10, exp);
          if (Math.abs(base - 1) < 0.01) return `1e${exp}`;
          if (Math.abs(base - 2) < 0.05) return `2e${exp}`;
          if (Math.abs(base - 5) < 0.1)  return `5e${exp}`;
          return `${base.toFixed(0)}e${exp}`;
        }, }, grid: { color: '#27272a' }, title: { display: true, text: 'Particle flux', color: '#71717a', font: { size: 10 } } },
          y2: { type: 'linear', position: 'right', ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 6 }, grid: { drawOnChartArea: false }, title: { display: true, text: 'km/s · nT', color: '#71717a', font: { size: 10 } } },
        },
      };
    }
    const yLabel = view === 'goes-raw' ? 'pfu' : 'p/cm²·s·sr·MeV';
    return baseOptions('logarithmic', yLabel);
  }, [view]);

  const info    = VIEW_INFO[view];
  const isGoes  = view === 'goes-raw';
  const s       = STATUS_STYLES[analysis?.status ?? 'QUIET'] ?? STATUS_STYLES.QUIET;
  const arrival = analysis ? estimateArrival(analysis.status, analysis.metrics.log_spread_4h_trend) : null;
  const noData  = !chartData;

  return (
    <div>
      <InfoModal isOpen={!!modalState} onClose={() => setModalState(null)} title={modalState?.title ?? ''} content={modalState?.content ?? ''} />
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-white">Energetic Particle Monitor</h2>
            <button
              onClick={openModal}
              className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
              title="About Energetic Particle Monitor"
            >
              ?
            </button>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">Solar storm early warning · Upstream satellites · Aurora potential indicator</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && <span className="text-xs text-neutral-600">{lastUpdated.toLocaleTimeString('en-NZ',{timeZone:'Pacific/Auckland',hour:'2-digit',minute:'2-digit'})} NZT</span>}
          <button onClick={fetchAll} className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors" title="Refresh">↻</button>
        </div>
      </div>

      {/* Status banner */}
      {loading ? (
        <div className="h-14 bg-neutral-800/50 rounded-lg animate-pulse mb-4" />
      ) : analysis && (
        <div className={`${s.bg} border ${s.border} rounded-lg px-4 py-3 mb-4`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${s.dot} ${analysis.status==='SHOCK_PASSAGE'?'animate-ping':analysis.status==='CME_WATCH'?'animate-pulse':''}`} />
            <span className={`text-sm font-semibold ${s.text}`}>{analysis.statusLabel}</span>
            {analysis.signatures.velocity_dispersion && <span className="px-2 py-0.5 rounded-full bg-purple-900/50 border border-purple-700/40 text-purple-300 text-xs">Early Storm Signal</span>}
            {analysis.signatures.channel_compression && <span className="px-2 py-0.5 rounded-full bg-orange-900/50 border border-orange-700/40 text-orange-300 text-xs">Storm Building</span>}
            {analysis.signatures.sharp_spike         && <span className="px-2 py-0.5 rounded-full bg-red-900/50    border border-red-700/40    text-red-300    text-xs">Shock Arriving</span>}
            {analysis.signatures.anisotropy_elevated && <span className="px-2 py-0.5 rounded-full bg-sky-900/50    border border-sky-700/40    text-sky-300    text-xs">Particle Stream</span>}
          </div>
          <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">{analysis.description}</p>
          {arrival && <p className="text-xs font-mono text-neutral-300 mt-1">{arrival}</p>}
          {analysis.goes_validation?.available && (
            <p className="text-xs text-neutral-500 mt-1">
              Second satellite: <span className={analysis.goes_validation.elevated?'text-orange-400':'text-green-400'}>{analysis.goes_validation.elevated?'also elevated — confirms activity':'quiet — not yet confirmed'}</span>
              {analysis.goes_validation.s1_alert && <span className="ml-1 text-yellow-400 font-semibold"> · Radiation storm in progress</span>}
            </p>
          )}
          {combined?.cross_validation.confidence!=='QUIET' && (
            <p className="text-xs text-neutral-500 mt-0.5">{combined?.cross_validation.confidenceLabel}</p>
          )}
        </div>
      )}

      {/* View selector */}
      <div className="flex justify-center gap-2 mb-3 flex-wrap">
        {VIEWS.map(v => (
          <button key={v.key} onClick={()=>setView(v.key)}
            className={`px-3 py-1 text-xs rounded transition-colors ${view===v.key?'bg-sky-600 text-white':'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Time range selector */}
      <div className="flex justify-center gap-2 mb-4">
        {TIME_RANGES.map(t => (
          <button key={t.value} onClick={()=>setTimeRange(t.value)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${timeRange===t.value?'bg-neutral-600 text-white':'bg-neutral-800 hover:bg-neutral-700 text-neutral-400'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Shock marker toggle (ACE / GOES / Combined only) */}
      {view !== 'stereo-raw' && (
        <div className="flex justify-center mb-3">
          <button
            onClick={() => setShowShockMarkers(v => !v)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${
              showShockMarkers ? 'bg-yellow-600/20 border-yellow-600/60 text-yellow-300' : 'bg-neutral-800/50 border-neutral-700 text-neutral-500'
            }`}
          >
            {showShockMarkers ? '✓ Shock markers on' : 'Shock markers off'}
            {showShockMarkers && visibleShockEvents.length > 0 ? ` (${visibleShockEvents.length})` : ''}
          </button>
        </div>
      )}

      {/* Chart title + subtitle */}
      <div className="mb-3">
        <p className="text-sm font-semibold text-neutral-200">{info.title}</p>
        <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{info.subtitle}</p>
      </div>

      {/* Combined source toggles */}
      {view === 'combined' && (
        <div className="flex gap-2 mb-3 flex-wrap">
          <button onClick={()=>setShowAce(v=>!v)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${showAce?'bg-sky-600/20 border-sky-600/60 text-sky-300':'bg-neutral-800/50 border-neutral-700 text-neutral-500'}`}>
            ● ACE EPAM
          </button>
          <button onClick={()=>setShowGoes(v=>!v)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${showGoes?'bg-yellow-600/20 border-yellow-600/60 text-yellow-300':'bg-neutral-800/50 border-neutral-700 text-neutral-500'}`}>
            ● GOES SEISS
          </button>
          <button onClick={()=>setShowStereo(v=>!v)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${showStereo?'bg-purple-600/20 border-purple-600/60 text-purple-300':'bg-neutral-800/50 border-neutral-700 text-neutral-500'}`}>
            ● STEREO-A <span className="text-neutral-600 text-xs">(off-axis)</span>
          </button>
        </div>
      )}

      {/* STEREO warning */}
      {info.note && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-900/30 border border-amber-700/40 rounded-lg mb-3">
          <span className="text-amber-400 flex-shrink-0 mt-0.5">⚠</span>
          <p className="text-xs text-amber-300/80 leading-relaxed">{info.note}</p>
        </div>
      )}

      {/* Chart */}
      {loading ? (
        <div className="h-[576px] bg-neutral-800/50 rounded-lg animate-pulse" />
      ) : noData ? (
        <div className="h-[576px] flex flex-col items-center justify-center bg-neutral-800/30 rounded-lg border border-neutral-700/50">
          <p className="text-neutral-500 text-sm">{view==='combined'&&!showAce&&!showGoes&&!showStereo ? 'Enable at least one source above' : 'No data yet'}</p>
          <p className="text-neutral-600 text-xs mt-1">
            {view.startsWith('stereo') ? 'STEREO updates every ~18 minutes' : 'Check back after the first cron run'}
          </p>
        </div>
      ) : (
        <div className="relative h-[576px] bg-neutral-900/40 rounded-lg p-2">
          <Line data={chartData!} options={chartOptions} />
        </div>
      )}

      {/* GOES S-scale reference */}
      {isGoes && (
        <div className="flex gap-4 mt-2 text-xs text-neutral-600 flex-wrap">
          <span>S1: ≥10 MeV &gt;10 pfu</span><span>S2: &gt;100 pfu</span><span>S3: &gt;1,000 pfu</span><span>S4: &gt;10,000 pfu</span><span>S5: &gt;100,000 pfu</span>
        </div>
      )}

      {/* Footer */}
      <p className="text-xs text-neutral-700 mt-4 pt-3 border-t border-neutral-800 leading-relaxed">
        Rising particle levels are a heads-up, not a guarantee — aurora depends on the solar wind direction when the storm arrives. ·{' '}
        <a href="https://www.swpc.noaa.gov" className="text-neutral-600 hover:text-sky-400" target="_blank" rel="noopener noreferrer">NOAA SWPC</a>
      </p>
    </div>
  );
};

export default EPAMPanel;
// --- END OF FILE src/components/EPAMPanel.tsx ---
