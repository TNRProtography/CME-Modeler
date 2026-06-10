// --- START OF FILE src/components/EPAMPanel.tsx ---
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Line } from 'react-chartjs-2';
import type { ChartOptions, ChartData } from 'chart.js';
import CloseIcon from './icons/CloseIcon';
import {
  toEpamSamples,
  computeEpamWarning,
  epamRateOfChange15m,
  parseNmAscii,
  EPAM_WARN_CONFIG,
  type EpamWarning,
  type NmSample,
  type WarnLevel,
} from './epamWarning';
import { detectShocks, type DetectedShock } from '../utils/shockDetection';

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

const EPAM_BASE = 'https://epam.thenamesrock.workers.dev';
const SOLAR_WIND_IMF_URL = 'https://imap-solar-data-test.thenamesrock.workers.dev/rtsw/merged-24h';
// Ground neutron-monitor counts (OULU, 5-min, efficiency-corrected, last 7
// days) from NMDB NEST — used for genuine Forbush-decrease detection. NMDB
// sends no CORS headers, so requests go through the site's data proxy
// (/api/proxy/data, see worker/index.ts — the worker must be deployed with
// that route). NMDB's NEST interface has two known parameter styles for
// "last N days", so we try candidates in order until one parses; the working
// one is remembered for subsequent refreshes. If everything fails, the
// warning engine degrades gracefully (Forbush chip shows "monitor feed
// unavailable").
const NM_FEED_CANDIDATES = [
  'https://www.nmdb.eu/nest/draw_graph.php?wget=1&stations[]=OULU&tabchoice=revori&dtype=corr_for_efficiency&tresolution=5&yunits=0&date_choice=last&last_days=7&output=ascii',
  'https://www.nmdb.eu/nest/draw_graph.php?wget=1&stations[]=OULU&tabchoice=revori&dtype=corr_for_efficiency&tresolution=5&yunits=0&date_choice=last&last_label=7&last_unit=day&output=ascii',
  'https://nest.nmdb.eu/draw_graph.php?wget=1&stations[]=OULU&tabchoice=revori&dtype=corr_for_efficiency&tresolution=5&yunits=0&date_choice=last&last_days=7&output=ascii',
];
const nmProxyPath = (target: string) => `/api/proxy/data?ttl=300&url=${encodeURIComponent(target)}`;

const STEREO_BEACON_BASE = 'https://stereo-ssc.nascom.nasa.gov/beacon';

interface StereoJPlotInfo {
  key: string;
  title: string;
  description: string;
  imageUrl: string;
  sourceUrl: string;
  startAu: number;
  endAu: number;
  earthRemainingAu: number;
  accent: string;
}

const STEREO_JPLOTS: StereoJPlotInfo[] = [
  {
    key: 'hi1',
    title: 'HI1 Ahead · 090°',
    description: 'Inner heliosphere J-plot: the hand-off region after COR2 and before the larger HI2 field.',
    imageUrl: `${STEREO_BEACON_BASE}/jplot_hi1_ahead_090.gif`,
    sourceUrl: `${STEREO_BEACON_BASE}/jplot_hi1_ahead_090.gif`,
    startAu: 0.056,
    endAu: 0.391,
    earthRemainingAu: 0.609,
    accent: 'from-sky-500/25 to-cyan-500/10 border-sky-500/30 text-sky-200',
  },
  {
    key: 'hi2',
    title: 'HI2 Ahead · 090°',
    description: 'Wide heliospheric J-plot that carries features through Earth-orbit distances.',
    imageUrl: `${STEREO_BEACON_BASE}/jplot_hi2_ahead_090.gif`,
    sourceUrl: `${STEREO_BEACON_BASE}/jplot_hi2_ahead_090.gif`,
    startAu: 0.307,
    endAu: 1.479,
    earthRemainingAu: 0,
    accent: 'from-purple-500/25 to-fuchsia-500/10 border-purple-500/30 text-purple-200',
  },
  {
    key: 'cor2',
    title: 'COR2 Ahead West · 090°',
    description: 'Near-Sun coronagraph J-plot for the first outward motion before the HI fields pick it up.',
    imageUrl: `${STEREO_BEACON_BASE}/jplot_cor2_ahead_west_090.gif`,
    sourceUrl: `${STEREO_BEACON_BASE}/jplot_cor2_ahead_west_090.gif`,
    startAu: 0.012,
    endAu: 0.070,
    earthRemainingAu: 0.930,
    accent: 'from-amber-500/25 to-orange-500/10 border-amber-500/30 text-amber-200',
  },
];

const stereoImageProxyPath = (target: string, refreshKey: number) => `/api/proxy/image?ttl=300&url=${encodeURIComponent(target)}&v=${refreshKey}`;

const formatAu = (value: number) => `${value.toFixed(3)} AU`;

const StereoJMapPanel: React.FC = () => {
  const [selectedKey, setSelectedKey] = useState(STEREO_JPLOTS[0].key);
  const [refreshKey, setRefreshKey] = useState(() => Date.now());
  const selected = STEREO_JPLOTS.find(plot => plot.key === selectedKey) ?? STEREO_JPLOTS[0];

  return (
    <div className="mt-6 rounded-2xl border border-sky-900/40 bg-gradient-to-b from-slate-950/90 to-neutral-950/90 p-4 shadow-2xl shadow-sky-950/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 text-sky-300 border border-sky-500/20">☄</span>
          <div>
            <h3 className="text-lg font-semibold text-white">STEREO Beacon J-plots</h3>
            <p className="text-xs text-neutral-500">NASA STEREO-A beacon plots for tracking outward-moving CME structure from near the Sun toward Earth orbit.</p>
          </div>
        </div>
        <button
          onClick={() => setRefreshKey(Date.now())}
          className="self-start px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600/20 text-sky-200 border border-sky-500/40 hover:bg-sky-600/30 transition-colors"
        >
          Refresh images
        </button>
      </div>

      <div className="grid gap-2 md:grid-cols-3 mb-4">
        {STEREO_JPLOTS.map(plot => {
          const active = selected.key === plot.key;
          const reachesPastEarth = plot.endAu > 1;
          return (
            <button
              key={plot.key}
              onClick={() => setSelectedKey(plot.key)}
              className={`text-left rounded-xl border p-3 transition-all ${active ? `bg-gradient-to-br ${plot.accent}` : 'bg-neutral-900/50 border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:bg-neutral-900/80'}`}
            >
              <p className="text-sm font-semibold text-neutral-100">{plot.title}</p>
              <p className="text-[11px] mt-1 leading-relaxed">Starts {formatAu(plot.startAu)} from Sun · ends {formatAu(plot.endAu)}</p>
              <p className="text-[11px] mt-1 leading-relaxed">
                {reachesPastEarth ? 'Reaches past 1 AU; Earth orbit is inside this plot.' : `${formatAu(plot.earthRemainingAu)} left to Earth at plot end.`}
              </p>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="overflow-x-auto rounded-xl border border-neutral-800 bg-black/60 p-2">
          <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" title={`Open ${selected.title} source image`}>
            <img
              src={stereoImageProxyPath(selected.imageUrl, refreshKey)}
              alt={`${selected.title} STEREO beacon J-plot`}
              className="block min-w-[720px] w-full h-auto rounded-lg"
              loading="lazy"
            />
          </a>
        </div>
        <div className="space-y-3 text-xs text-neutral-400">
          <div className={`rounded-xl border bg-gradient-to-br p-3 ${selected.accent}`}>
            <p className="font-semibold text-neutral-100 mb-1">{selected.title}</p>
            <p className="leading-relaxed">{selected.description}</p>
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
            <p className="font-semibold text-neutral-200 mb-2">Approximate distance coverage</p>
            <dl className="space-y-1.5">
              <div className="flex justify-between gap-3"><dt>Starts from Sun</dt><dd className="text-neutral-100 font-medium">{formatAu(selected.startAu)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Ends from Sun</dt><dd className="text-neutral-100 font-medium">{formatAu(selected.endAu)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Distance shown</dt><dd className="text-neutral-100 font-medium">{formatAu(selected.endAu - selected.startAu)}</dd></div>
              <div className="flex justify-between gap-3"><dt>AU left at end</dt><dd className="text-neutral-100 font-medium">{selected.endAu > 1 ? '0.000 AU' : formatAu(selected.earthRemainingAu)}</dd></div>
            </dl>
            {selected.endAu > 1 && (
              <p className="text-[11px] text-purple-200/80 mt-2 leading-relaxed">HI2 nominally extends beyond 1 AU by {formatAu(selected.endAu - 1)}; for Sun→Earth tracking, Earth orbit is reached before the plot's outer edge.</p>
            )}
          </div>
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
            <p className="font-semibold text-neutral-200 mb-1">Coverage reference</p>
            <p className="leading-relaxed">Distances use nominal SECCHI fields of view converted from solar radii to AU: COR2 2.5–15 R☉, HI1 12–84 R☉, HI2 66–318 R☉.</p>
          </div>
          <p className="leading-relaxed">The GIFs are served directly from the NASA STEREO beacon feed. Bright/dark diagonal tracks indicate outward-moving density structures in running-difference style J-plots.</p>
        </div>
      </div>
    </div>
  );
};

// Views: raw charts per source + one combined averaged chart
type ViewKey = 'ace-raw' | 'ace-roc' | 'goes-raw' | 'stereo-raw' | 'combined';
const VIEWS: {key: ViewKey; label: string}[] = [
  {key: 'ace-raw',  label: 'ACE Raw'},
  {key: 'ace-roc',  label: 'ACE Rate of Change'},
  {key: 'goes-raw', label: 'GOES Raw'},
  {key: 'stereo-raw', label: 'STEREO Raw'},
  {key: 'combined',   label: 'Combined Average'},
];

// ACE proton channels used by the robust warning engine (same set as ACE_CH).
const ACE_WARN_CHANNELS = ['p1', 'p3', 'p5', 'p7', 'p8'];

// Warning-level styling for the robust early-warning banner.
const WARN_STYLES: Record<WarnLevel, {dot:string;bg:string;border:string;text:string;pulse:string}> = {
  SHOCK:    {dot:'bg-red-500',    bg:'bg-red-950/60',    border:'border-red-700/60',    text:'text-red-300',    pulse:'animate-ping'},
  ONSET:    {dot:'bg-orange-400', bg:'bg-orange-950/60', border:'border-orange-700/60', text:'text-orange-300', pulse:'animate-pulse'},
  ELEVATED: {dot:'bg-sky-500',    bg:'bg-sky-950/45',    border:'border-sky-800/60',    text:'text-sky-300',    pulse:''},
  WATCH:    {dot:'bg-yellow-400', bg:'bg-yellow-950/45', border:'border-yellow-700/50', text:'text-yellow-300', pulse:''},
  QUIET:    {dot:'bg-green-500',  bg:'bg-neutral-900/60',border:'border-neutral-700/60',text:'text-neutral-400',pulse:''},
};

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


// ─── View metadata ────────────────────────────────────────────────────────────
const VIEW_INFO: Record<ViewKey, {title: string; subtitle: string; note?: string}> = {
  'ace-raw':  {title: 'Solar Storm Early Warning (L1 Satellite)', subtitle: 'Real-time particle readings from a satellite parked 1.5 million km in front of Earth — about 45–60 minutes upstream of us. When the lines start rising together across all colours and converging on the graph, that is the pattern that often precedes a solar storm arriving at Earth. The earlier the lines rise, the more warning time you have.'},
  'ace-roc':  {title: 'ACE EPAM — Rate of Change (15-min)', subtitle: 'How fast the averaged ACE particle flux is climbing or falling, expressed as the change in log-flux over a rolling 15-minute window. Flat near zero means steady. A sharp positive spike means the flux is jumping — the near-vertical climb that marks a CME shock front arriving. Sustained negative values mean a stream is decaying. This is the leading-edge view: it reacts before the raw flux looks dramatic.', note: 'Reads in log-units per 15 min: +0.30 ≈ a doubling, +0.60 ≈ a 4× jump in 15 minutes. Brief single-point spikes are noise; a real onset shows several rising steps in a row.'},
  'goes-raw': {title: 'GOES Satellite — Storm Confirmation', subtitle: 'A second satellite in a fixed orbit above Earth, used to confirm what the upstream L1 satellite is seeing. If both satellites are elevated at the same time, the solar storm signal is much more reliable. The ≥10 MeV line is the key one to watch — if it jumps sharply, a solar radiation storm is in progress.'},
  'stereo-raw': {title: 'STEREO-A — Ahead-of-Earth Satellite', subtitle: 'Particle readings from a satellite that orbits slightly ahead of Earth, giving an early peek at what is coming along the Sun–Earth line.', note: '⚠ STEREO-A orbits about 10–15° ahead of Earth and sees the Sun from a different angle — so elevated readings here do not always mean the same storm will hit Earth. Think of it as a neighbour getting rain before you — useful context, but not a direct forecast for your location.'},
  'combined': {title: 'All Satellites — Combined Overview', subtitle: 'One averaged trend line per satellite, making it easy to compare all three at a glance. If all three are rising together, that is the strongest possible signal. Toggle individual satellites on or off with the buttons below.'},
};

// ─── Main component ───────────────────────────────────────────────────────────
interface EPAMPanelProps {
  /** Shocks from the shared detector (passed down by ForecastDashboard from
   *  SolarWindQuickView) so the EPAM markers show exactly the same events as
   *  the solar-wind summary and global banner. When absent (standalone use),
   *  the panel runs the same shared detector on its own self-fetched feed. */
  shockEvents?: DetectedShock[];
}

const EPAMPanel: React.FC<EPAMPanelProps> = ({ shockEvents: shockEventsProp }) => {
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
  const [nmRaw,      setNmRaw]      = useState<NmSample[]>([]);  // neutron monitor (Forbush)
  const mountedRef = useRef(true);
  const nmGoodIdxRef = useRef(0); // last NMDB URL variant that worked
  const [modalState, setModalState] = useState<{ title: string; content: string } | null>(null);


  const openModal = useCallback(() => {
    setModalState({
      title: 'About Energetic Particle Monitor',
      content: `
    <div class='space-y-3 text-left'>
      <p><strong>What this is:</strong> Real-time high-energy particle readings from satellites positioned upstream of Earth — ACE and others at the L1 point, about 1.5 million km sunward of us. Particles accelerated by solar eruptions reach these satellites before the storm itself reaches Earth, which is what makes this an early-warning instrument. The analysis compares the latest readings against a full <strong>7-day baseline</strong>, so "elevated" always means elevated relative to what has actually been normal this week.</p>

      <p><strong>The warning levels:</strong>
      <span class='block mt-1'><strong class='text-green-400'>Quiet</strong> — at normal background. No storm signature.</span>
      <span class='block'><strong class='text-yellow-300'>Watch</strong> — particle levels just starting to lift. Could be the front edge of something, could settle back down.</span>
      <span class='block'><strong class='text-sky-300'>Elevated</strong> — clearly and persistently above background across multiple energy channels. Something real is upstream.</span>
      <span class='block'><strong class='text-orange-300'>Storm Arrival Incoming</strong> — flux climbing fast and coherently: the classic lead-in to a CME shock. Typically 30–90 minutes of warning.</span>
      <span class='block'><strong class='text-red-300'>Shock</strong> — the disturbance is passing the upstream satellite right now. Earth-side effects within the hour.</span></p>

      <p><strong>The stats, and what each one means:</strong>
      <span class='block mt-1'><strong>Above quiet baseline (σ)</strong> — how far current flux sits above this week's quiet conditions, in robust statistical units. ~2σ is everyday wobble; 5σ+ is a genuine event; 8σ+ with a fast climb is a storm arriving.</span>
      <span class='block'><strong>Sustained, not a glitch</strong> — how long flux has stayed elevated. Single spikes are usually instrument noise; real events persist for 30+ minutes.</span>
      <span class='block'><strong>Multiple channels rising</strong> — whether different particle energies (47 keV up to 1.9 MeV) are rising together. Real solar events are broadband; a single channel alone is usually an artifact.</span>
      <span class='block'><strong>Sharp rate of climb</strong> — how fast flux is changing over 15 minutes, in log units: +0.30 means it doubled, +0.60 means it quadrupled. Shock fronts produce near-vertical climbs; slow solar-wind streams do not. The <strong>ACE Rate of Change</strong> chart view plots exactly this.</span>
      <span class='block'><strong>Fast particles arrived first</strong> — velocity dispersion: the highest-energy particles from a fresh eruption outrun the slower ones, so the MeV channels rise hours before the keV channels. Seeing this means an eruption's particles are connecting to Earth — the earliest hint, sometimes 1–2 days before arrival.</span>
      <span class='block'><strong>Channels converging</strong> — as a shock gets close it accelerates lower-energy particles locally, so the gap between the channel lines shrinks. On the chart this is the lines visibly squeezing together — a sign the source is getting near.</span>
      <span class='block'><strong>Dip after elevation</strong> — a temporary drop from an elevated plateau, often seen tens of minutes to a couple of hours before a shock arrives. A dip from quiet means nothing, but a dip <em>after</em> sustained elevation followed by a sudden climb is one of the highest-confidence "it's about to hit" patterns EPAM offers.</span>
      <span class='block'><strong>Cosmic-ray decrease (Forbush)</strong> — measured by a ground neutron monitor (Oulu, Finland), not by EPAM. When a large CME structure passes near Earth, its magnetic field sweeps away galactic cosmic rays and ground counts drop 1.5%+ below their weekly normal. This independently confirms a major structure is at our doorstep.</span></p>

      <p><strong>Why it matters for aurora:</strong> A CME shock arrival is the trigger event for the biggest aurora displays. When this panel reads <strong>Storm Arrival Incoming</strong> or <strong>Shock</strong>, you typically have 30–90 minutes before effects reach Earth — enough time to get out and get set up. After arrival, whether the aurora actually fires depends on the magnetic field orientation (Bz): strongly southward Bz means the storm couples into Earth's field and the show begins. So treat this panel as the "get ready" signal and Bz as the "go" signal. Elevated particles raise the <em>potential</em> for aurora; they are not a guarantee of one.</p>

      <p class='text-xs text-neutral-400'><strong>Advanced:</strong> The level is decided by the <em>combination</em> of signatures, never one number — magnitude, persistence, broadband agreement and rate of climb must coincide, which is what suppresses false alarms from glitches and slow stream interactions. When early-stage signatures fire (dispersion, convergence, a post-elevation dip, or a Forbush decrease), detection thresholds for the later stages are automatically lowered by up to 35% — the system earns extra sensitivity only when the storm sequence is genuinely under way. The score (0–100) is a continuous confidence measure behind the discrete levels.</p>
    </div>
  `,
    });
  }, []);

  // Try NMDB URL variants in order (starting from the last one that worked)
  // until one returns parseable neutron-monitor data. Fails soft to [].
  const fetchNeutronMonitor = useCallback(async (): Promise<NmSample[]> => {
    const n = NM_FEED_CANDIDATES.length;
    for (let i = 0; i < n; i++) {
      const idx = (nmGoodIdxRef.current + i) % n;
      try {
        const res = await fetch(nmProxyPath(NM_FEED_CANDIDATES[idx]));
        if (!res.ok) continue;
        const parsed = parseNmAscii(await res.text());
        if (parsed.length >= 100) { nmGoodIdxRef.current = idx; return parsed; }
      } catch { /* try next variant */ }
    }
    return [];
  }, []);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const [r1,r2,r3,r4,r5,r6,r7] = await Promise.allSettled([
        fetch(`${EPAM_BASE}/epam/raw`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/goes`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/stereo`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/analysis`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/combined`).then(r=>r.ok?r.json():null),
        fetch(`${SOLAR_WIND_IMF_URL}?_=${Date.now()}`).then(r=>r.ok?r.json():null),
        // Neutron monitor (Forbush detection). Candidate chain; fails soft.
        fetchNeutronMonitor(),
      ]);
      if (!mountedRef.current) return;
      if (r1.status==='fulfilled' && r1.value?.data)              setEpamRaw(r1.value.data);
      if (r2.status==='fulfilled' && r2.value?.data)              setGoesRaw(r2.value.data);
      if (r3.status==='fulfilled' && r3.value?.data)              setStereoRaw(r3.value.data);
      if (r4.status==='fulfilled' && r4.value?.status)            setAnalysis(r4.value);
      if (r5.status==='fulfilled' && r5.value?.cross_validation)  setCombined(r5.value);
      if (r7.status==='fulfilled' && r7.value.length)             setNmRaw(r7.value);
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
  }, [fetchNeutronMonitor]);

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

  // Robust early-warning analysis. Built from the FULL ACE EPAM history available
  // (the whole week), independent of the chart's time-range selector — the
  // baseline must always see the full week to know what "quiet" looks like.
  const epamSamples = useMemo(
    () => toEpamSamples(epamRaw as any, ACE_WARN_CHANNELS, parseUTC),
    [epamRaw],
  );
  const warning: EpamWarning | null = useMemo(
    () => (epamSamples.length ? computeEpamWarning(epamSamples, nmRaw.length ? nmRaw : null) : null),
    [epamSamples, nmRaw],
  );

  // Rate-of-change series for the ACE ROC view, clipped to the selected range.
  const rocSeries = useMemo(() => {
    if (!epamSamples.length) return [] as {x:number;y:number|null}[];
    const cutoff = Date.now() - timeRange * 3600 * 1000;
    return epamRateOfChange15m(epamSamples).filter(p => p.x > cutoff);
  }, [epamSamples, timeRange]);

  // Prefer shocks handed down from ForecastDashboard (same detector instance
  // that drives the summary/banner). Fall back to running the shared detector
  // on this panel's own solar-wind feed when used standalone.
  const ownShockEvents = useMemo(
    () => (shockEventsProp ? [] : detectShocks(speedRaw, densityRaw, tempRaw, magRaw)),
    [shockEventsProp, speedRaw, densityRaw, tempRaw, magRaw],
  );
  const shockEvents = shockEventsProp ?? ownShockEvents;
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

    if (view === 'ace-roc') {
      if (!rocSeries.length) return null;
      // Two overlaid datasets: positive (rising = orange/red interest) and the
      // full signed line. Threshold reference bands are drawn via chart options.
      const pos = rocSeries.map(p => ({ x: p.x, y: p.y !== null && p.y > 0 ? p.y : null }));
      return {
        datasets: [
          { label: 'Δlog flux / 15 min', borderColor: '#38bdf8', backgroundColor: '#38bdf820', borderWidth: 1.5, pointRadius: 0, tension: 0.15, spanGaps: false, data: rocSeries, fill: false },
          { label: 'Rising', borderColor: '#fb923c', backgroundColor: '#fb923c30', borderWidth: 2, pointRadius: 0, tension: 0.15, spanGaps: false, data: pos, fill: true },
        ],
      };
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
  }, [view, filteredEpam, filteredGoes, filteredStereo, rocSeries, showAce, showGoes, showStereo, showShockMarkers, visibleShockEvents]);

  // ── Chart options ─────────────────────────────────────────────────────────
  const chartOptions: ChartOptions<'line'> = useMemo(() => {
    if (view === 'ace-roc') {
      const base = baseOptions('linear', 'Δlog₁₀ flux / 15 min');
      return {
        ...base,
        plugins: {
          ...base.plugins,
          legend: { ...(base.plugins as any).legend, labels: { ...((base.plugins as any).legend?.labels ?? {}), filter: (item: any) => String(item.text ?? '') !== '__shock__' } },
        },
        scales: {
          x: (base as any).scales.x,
          y: {
            type: 'linear',
            suggestedMin: -0.4, suggestedMax: 0.7,
            grid: {
              color: (ctx: any) => (ctx.tick && Math.abs(ctx.tick.value) < 1e-9 ? '#52525b' : '#27272a'),
            },
            ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 7,
              callback: (v: number | string) => Number(v).toFixed(2) },
            title: { display: true, text: 'Δlog₁₀ flux / 15 min', color: '#71717a', font: { size: 10 } },
          },
        },
      };
    }
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

      {/* Early-warning banner — robust full-week ACE EPAM baseline (client-side),
          with cross-satellite confirmation (GOES / STEREO) folded in from the
          upstream worker analysis. One combined box. */}
      {loading ? (
        <div className="h-14 bg-neutral-800/50 rounded-lg animate-pulse mb-4" />
      ) : warning && (
        (() => {
          const w = WARN_STYLES[warning.level];
          const d = warning.diagnostics;
          return (
            <div className={`${w.bg} border ${w.border} rounded-lg px-4 py-3 mb-4`}>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${w.dot} ${w.pulse}`} />
                <span className={`text-sm font-semibold ${w.text}`}>ACE EPAM · {warning.levelLabel}</span>
                <span className="text-xs text-neutral-500 font-mono">score {warning.score}</span>
                <span className="ml-auto text-[10px] text-neutral-600">7-day baseline · ACE only</span>
              </div>
              <p className="text-sm text-neutral-200 mt-1.5 leading-relaxed">{warning.headline}</p>
              <p className="text-[11px] text-neutral-500 mt-1 font-mono leading-relaxed">{warning.detail}</p>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {warning.reasons.map(r => (
                  <span key={r.key}
                    title={r.detail}
                    className={`px-2 py-0.5 rounded-full text-[11px] border ${
                      r.active
                        ? 'bg-sky-900/40 border-sky-700/50 text-sky-300'
                        : 'bg-neutral-800/40 border-neutral-700/50 text-neutral-500'
                    }`}>
                    {r.active ? '✓ ' : '· '}{r.label}
                    <span className="ml-1 text-neutral-500">{r.detail}</span>
                  </span>
                ))}
              </div>

              {/* Cross-satellite confirmation (from worker analysis) */}
              {(analysis?.goes_validation?.available || (combined && combined.cross_validation.confidence !== 'QUIET')) && (
                <div className="mt-2.5 pt-2.5 border-t border-white/5 space-y-0.5">
                  {analysis?.goes_validation?.available && (
                    <p className="text-xs text-neutral-500">
                      Second satellite (GOES): <span className={analysis.goes_validation.elevated?'text-orange-400':'text-green-400'}>{analysis.goes_validation.elevated?'also elevated — confirms activity':'quiet — not yet confirmed'}</span>
                      {analysis.goes_validation.s1_alert && <span className="ml-1 text-yellow-400 font-semibold"> · Radiation storm in progress</span>}
                    </p>
                  )}
                  {combined && combined.cross_validation.confidence !== 'QUIET' && (
                    <p className="text-xs text-neutral-500">{combined.cross_validation.confidenceLabel}</p>
                  )}
                </div>
              )}

              {d.usableHours < EPAM_WARN_CONFIG.BASELINE_HOURS * 0.5 && (
                <p className="text-[11px] text-amber-400/80 mt-1.5">
                  ⚠ Only {Math.round(d.usableHours)}h of history available — baseline still settling, treat levels as provisional.
                </p>
              )}
            </div>
          );
        })()
      )}
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
      {view !== 'stereo-raw' && view !== 'ace-roc' && (
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

      <StereoJMapPanel />

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