// --- START OF FILE src/components/EPAMPanel.tsx ---
// v3 — SWPC HAPI multi-spacecraft edition.
//
// The worker now serves the SWPC HAPI particle feeds:
//   • active-ions-pt1m  — SWPC's blended "active" L1 ion feed (the default;
//     the worker silently falls back active → solar1 → ace → legacy ACE JSON)
//   • solar1-ions-pt1m  — SOLAR-1 EPAM ions (independent L1 spacecraft)
//   • imap-ions-pt1m    — IMAP ions (optional; may not exist yet — fails soft)
//   • STEREO-A          — unchanged, ahead-of-Earth context
//
// GOES has been removed from THIS panel (the worker still serves /epam/goes
// for anything else that wants it; GOES X-ray/SUVI elsewhere in the app are
// untouched). Storm confirmation now comes from genuinely independent L1
// particle instruments — SOLAR-1 and IMAP — each judged against its OWN
// 7-day baseline by the client-side warning engine (epamWarning v3).
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
  type EpamConfirmationInput,
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
// Legacy point shape preserved by the worker, plus the additive HAPI fields.
interface EpamPoint {
  time_tag: string;
  p1: number|null; p3: number|null; p5: number|null; p7: number|null; p8: number|null;
  e1: number|null; e2: number|null;
  anisotropy_index: number|null;
  // additive (present on HAPI-sourced points; safe to ignore)
  p2?: number|null; p4?: number|null; p6?: number|null;
  de1?: number|null; de2?: number|null; de3?: number|null; de4?: number|null;
  quality?: number|null; active?: number|null;
}
interface StereoPoint { time_tag: string; speed?: number|null; density?: number|null; bz?: number|null; bt?: number|null; sep_lo?: number|null; sep_hi?: number|null; }
interface ParticleSourceSummary { available: boolean; elevated: boolean|null; label?: string; }
interface AnalysisData {
  status: string; statusLabel: string; description: string;
  signatures: { velocity_dispersion: boolean; channel_compression: boolean; sharp_spike: boolean; anisotropy_elevated: boolean; elevated_channels: number };
  metrics: { anisotropy_index: number|null; log_spread_4h_trend: number|null };
  particle_cross_validation?: {
    primary_source: string; primary_dataset: string|null;
    sources: Record<string, ParticleSourceSummary>;
    confirming_sources: string[];
    confirmed: boolean;
    confidence_note: string;
  };
}
interface CombinedData { cross_validation: { confidence: string; confidenceLabel: string; ace_epam_elevated: boolean; stereo_elevated: boolean }; }
interface RawMeta { sourceLabel: string; sourceKey: string; fallbackUsed: boolean; }
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

// Views: raw charts per source + one combined averaged chart
type ViewKey = 'ace-raw' | 'ace-roc' | 'solar1-raw' | 'imap-raw' | 'stereo-raw' | 'combined';
const VIEWS: {key: ViewKey; label: string}[] = [
  {key: 'ace-raw',     label: 'ACE'},
  {key: 'ace-roc',     label: 'Rate of Change'},
  {key: 'solar1-raw',  label: 'SOLAR-1'},
  {key: 'imap-raw',    label: 'IMAP'},
  {key: 'stereo-raw',  label: 'STEREO'},
  {key: 'combined',    label: 'Combined Average'},
];

// L1 proton channels used by the robust warning engine (same set as L1_CH).
// Same keys across the active / SOLAR-1 / IMAP feeds — the worker normalises
// every HAPI source to the legacy p1…p8 fields.
const WARN_CHANNELS = ['p1', 'p3', 'p5', 'p7', 'p8'];

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
function geoMeanRow(values: (number|null|undefined)[]): number|null {
  const valid = values.filter((v): v is number => typeof v === 'number' && v > 0);
  if (valid.length === 0) return null;
  const logSum = valid.reduce((sum, v) => sum + Math.log10(v), 0);
  return Math.pow(10, logSum / valid.length);
}

function filterByTimeRange<T extends {time_tag: string}>(data: T[], hours: TimeRange): T[] {
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

// L1 raw views: 5 proton channels (same keys across active / SOLAR-1 / IMAP —
// the worker maps every HAPI ion feed onto these legacy fields).
const L1_CH = [
  {k:'p1',c:'#60a5fa',l:'P1 47–68 keV'},
  {k:'p3',c:'#34d399',l:'P3 115–195 keV'},
  {k:'p5',c:'#facc15',l:'P5 310–580 keV'},
  {k:'p7',c:'#fb923c',l:'P7 795–1193 keV'},
  {k:'p8',c:'#f87171',l:'P8 1–1.9 MeV'},
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
  'ace-raw':  {title: 'Solar Storm Early Warning (ACE EPAM)', subtitle: 'Real-time particle readings from ACE EPAM — satellites parked 1.5 million km in front of Earth, about 45–60 minutes upstream of us. When the lines start rising together across all colours and converging on the graph, that is the pattern that often precedes a solar storm arriving at Earth. The earlier the lines rise, the more warning time you have.'},
  'ace-roc':  {title: 'ACE — Rate of Change (15-min)', subtitle: 'How fast the averaged ACE particle flux is climbing or falling, expressed as the change in log-flux over a rolling 15-minute window. Flat near zero means steady. A sharp positive spike means the flux is jumping — the near-vertical climb that marks a CME shock front arriving. Sustained negative values mean a stream is decaying. This is the leading-edge view: it reacts before the raw flux looks dramatic.', note: 'Reads in log-units per 15 min: +0.30 ≈ a doubling, +0.60 ≈ a 4× jump in 15 minutes. Brief single-point spikes are noise; a real onset shows several rising steps in a row.'},
  'solar1-raw': {title: 'SOLAR-1 EPAM — Independent Confirmation', subtitle: 'A second, fully independent spacecraft at the L1 point measuring the same particle environment with its own instrument. If SOLAR-1 is elevated at the same time as the primary feed, the storm signal is much more reliable — two different detectors agreeing is hard to fake with instrument noise.'},
  'imap-raw': {title: 'IMAP — Independent Confirmation', subtitle: 'NASA\u2019s IMAP spacecraft at L1, providing a third independent particle measurement. Like SOLAR-1, simultaneous elevation here cross-confirms what the primary feed is seeing.', note: 'IMAP\u2019s real-time particle feed is new — gaps and outages are expected while SWPC brings it fully online. When no data is available the panel simply marks IMAP as unavailable.'},
  'stereo-raw': {title: 'STEREO-A — Ahead-of-Earth Satellite', subtitle: 'Particle readings from a satellite that orbits slightly ahead of Earth, giving an early peek at what is coming along the Sun–Earth line.', note: '⚠ STEREO-A orbits about 10–15° ahead of Earth and sees the Sun from a different angle — so elevated readings here do not always mean the same storm will hit Earth. Think of it as a neighbour getting rain before you — useful context, but not a direct forecast for your location.'},
  'combined': {title: 'All Spacecraft — Combined Overview', subtitle: 'One averaged trend line per spacecraft, making it easy to compare every source at a glance. If the independent L1 feeds are rising together, that is the strongest possible signal. Toggle individual spacecraft on or off with the buttons below.'},
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
  const [activeRaw,  setActiveRaw]  = useState<EpamPoint[]>([]);
  const [activeMeta, setActiveMeta] = useState<RawMeta|null>(null);
  const [solar1Raw,  setSolar1Raw]  = useState<EpamPoint[]>([]);
  const [imapRaw,    setImapRaw]    = useState<EpamPoint[]>([]);
  const [imapAvailable, setImapAvailable] = useState(false);
  const [stereoRaw,  setStereoRaw]  = useState<StereoPoint[]>([]);
  const [analysis,   setAnalysis]   = useState<AnalysisData|null>(null);
  const [combined,   setCombined]   = useState<CombinedData|null>(null);
  const [loading,    setLoading]    = useState(true);
  const [lastUpdated,setLastUpdated]= useState<Date|null>(null);
  // Combined view toggles — STEREO off by default
  const [showActive, setShowActive] = useState(true);
  const [showSolar1, setShowSolar1] = useState(true);
  const [showImap,   setShowImap]   = useState(true);
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
      <p><strong>What this is:</strong> Real-time high-energy particle readings from spacecraft positioned upstream of Earth at the L1 point, about 1.5 million km sunward of us. Particles accelerated by solar eruptions reach these spacecraft before the storm itself reaches Earth, which is what makes this an early-warning instrument. The primary feed is NOAA SWPC\u2019s blended "active" L1 ion dataset, and it is independently cross-checked against the <strong>SOLAR-1 EPAM</strong> and <strong>IMAP</strong> spacecraft. The analysis compares the latest readings against a full <strong>7-day baseline</strong>, so "elevated" always means elevated relative to what has actually been normal this week.</p>

      <p><strong>The warning levels:</strong>
      <span class='block mt-1'><strong class='text-green-400'>Quiet</strong> — at normal background. No storm signature.</span>
      <span class='block'><strong class='text-yellow-300'>Watch</strong> — particle levels just starting to lift. Could be the front edge of something, could settle back down.</span>
      <span class='block'><strong class='text-sky-300'>Elevated</strong> — clearly and persistently above background across multiple energy channels. Something real is upstream.</span>
      <span class='block'><strong class='text-orange-300'>Storm Arrival Incoming</strong> — flux climbing fast and coherently: the classic lead-in to a CME shock. Typically 30–90 minutes of warning.</span>
      <span class='block'><strong class='text-red-300'>Shock</strong> — the disturbance is passing the upstream spacecraft right now. Earth-side effects within the hour.</span></p>

      <p><strong>The stats, and what each one means:</strong>
      <span class='block mt-1'><strong>Above quiet baseline (σ)</strong> — how far current flux sits above this week's quiet conditions, in robust statistical units. ~2σ is everyday wobble; 5σ+ is a genuine event; 8σ+ with a fast climb is a storm arriving.</span>
      <span class='block'><strong>Sustained, not a glitch</strong> — how long flux has stayed elevated. Single spikes are usually instrument noise; real events persist for 30+ minutes.</span>
      <span class='block'><strong>Multiple channels rising</strong> — whether different particle energies (47 keV up to 1.9 MeV) are rising together. Real solar events are broadband; a single channel alone is usually an artifact.</span>
      <span class='block'><strong>Sharp rate of climb</strong> — how fast flux is changing over 15 minutes, in log units: +0.30 means it doubled, +0.60 means it quadrupled. Shock fronts produce near-vertical climbs; slow solar-wind streams do not. The <strong>Rate of Change</strong> chart view plots exactly this.</span>
      <span class='block'><strong>Fast particles arrived first</strong> — velocity dispersion: the highest-energy particles from a fresh eruption outrun the slower ones, so the MeV channels rise hours before the keV channels. Seeing this means an eruption's particles are connecting to Earth — the earliest hint, sometimes 1–2 days before arrival.</span>
      <span class='block'><strong>Channels converging</strong> — as a shock gets close it accelerates lower-energy particles locally, so the gap between the channel lines shrinks. On the chart this is the lines visibly squeezing together — a sign the source is getting near.</span>
      <span class='block'><strong>Dip after elevation</strong> — a temporary drop from an elevated plateau, often seen tens of minutes to a couple of hours before a shock arrives. A dip from quiet means nothing, but a dip <em>after</em> sustained elevation followed by a sudden climb is one of the highest-confidence "it's about to hit" patterns EPAM offers.</span>
      <span class='block'><strong>Independent spacecraft confirm</strong> — SOLAR-1 and IMAP each get judged against their OWN 7-day quiet baseline. When one or both are independently elevated at the same time as the primary feed, the warning engine treats the signal as cross-confirmed — different hardware seeing the same physics is the strongest argument against instrument noise.</span>
      <span class='block'><strong>Cosmic-ray decrease (Forbush)</strong> — measured by a ground neutron monitor (Oulu, Finland), not by the L1 spacecraft. When a large CME structure passes near Earth, its magnetic field sweeps away galactic cosmic rays and ground counts drop 1.5%+ below their weekly normal. This independently confirms a major structure is at our doorstep.</span></p>

      <p><strong>Why it matters for aurora:</strong> A CME shock arrival is the trigger event for the biggest aurora displays. When this panel reads <strong>Storm Arrival Incoming</strong> or <strong>Shock</strong>, you typically have 30–90 minutes before effects reach Earth — enough time to get out and get set up. After arrival, whether the aurora actually fires depends on the magnetic field orientation (Bz): strongly southward Bz means the storm couples into Earth's field and the show begins. So treat this panel as the "get ready" signal and Bz as the "go" signal. Elevated particles raise the <em>potential</em> for aurora; they are not a guarantee of one.</p>

      <p class='text-xs text-neutral-400'><strong>Advanced:</strong> The level is decided by the <em>combination</em> of signatures, never one number — magnitude, persistence, broadband agreement and rate of climb must coincide, which is what suppresses false alarms from glitches and slow stream interactions. When early-stage signatures fire (dispersion, convergence, a post-elevation dip, a Forbush decrease, or independent spacecraft confirmation), detection thresholds for the later stages are automatically lowered — the system earns extra sensitivity only when the storm sequence is genuinely under way. The score (0–100) is a continuous confidence measure behind the discrete levels.</p>
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

  // Fetch a single /epam/raw source. The worker returns ok:false JSON (with
  // CORS headers) when an explicit source has no data — treat that as "feed
  // unavailable", not a hard error.
  const fetchRawSource = useCallback(async (source?: string): Promise<{points: EpamPoint[]; meta: RawMeta}|null> => {
    const url = source ? `${EPAM_BASE}/epam/raw?source=${source}` : `${EPAM_BASE}/epam/raw`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.ok || !Array.isArray(body.data)) return null;
    return {
      points: body.data as EpamPoint[],
      meta: {
        sourceLabel: String(body.source_label ?? body.source ?? source ?? 'L1'),
        sourceKey: String(body.source_key ?? source ?? 'active'),
        fallbackUsed: Boolean(body.fallback_used),
      },
    };
  }, []);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const [rActive,rSolar1,rImap,rStereo,rAnalysis,rCombined,rSw,rNm] = await Promise.allSettled([
        fetchRawSource('ace'),         // explicit ACE — avoids blended "active" feed jumps
        fetchRawSource('solar1'),  // explicit — no silent fallback
        fetchRawSource('imap'),    // explicit, optional — fails soft
        fetch(`${EPAM_BASE}/epam/stereo`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/analysis`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/combined`).then(r=>r.ok?r.json():null),
        fetch(`${SOLAR_WIND_IMF_URL}?_=${Date.now()}`).then(r=>r.ok?r.json():null),
        // Neutron monitor (Forbush detection). Candidate chain; fails soft.
        fetchNeutronMonitor(),
      ]);
      if (!mountedRef.current) return;
      if (rActive.status==='fulfilled' && rActive.value) {
        setActiveRaw(rActive.value.points);
        setActiveMeta(rActive.value.meta);
      }
      if (rSolar1.status==='fulfilled') setSolar1Raw(rSolar1.value?.points ?? []);
      if (rImap.status==='fulfilled') {
        const pts = rImap.value?.points ?? [];
        setImapRaw(pts);
        setImapAvailable(pts.length > 0);
      } else if (rImap.status==='rejected') {
        setImapAvailable(false);
      }
      if (rStereo.status==='fulfilled' && rStereo.value?.data)             setStereoRaw(rStereo.value.data);
      if (rAnalysis.status==='fulfilled' && rAnalysis.value?.status)       setAnalysis(rAnalysis.value);
      if (rCombined.status==='fulfilled' && rCombined.value?.cross_validation) setCombined(rCombined.value);
      if (rNm.status==='fulfilled' && rNm.value.length)                    setNmRaw(rNm.value);
      if (rSw.status==='fulfilled' && rSw.value) {
        const s = Array.isArray((rSw.value as any).speed) ? (rSw.value as any).speed : [];
        const d = Array.isArray((rSw.value as any).density) ? (rSw.value as any).density : [];
        const t = Array.isArray((rSw.value as any).temp) ? (rSw.value as any).temp : [];
        const m = Array.isArray((rSw.value as any).mag) ? (rSw.value as any).mag : [];
        setSpeedRaw(s.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)));
        setDensityRaw(d.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)));
        setTempRaw(t.filter((p: any) => Number.isFinite(p?.x) && Number.isFinite(p?.y)));
        setMagRaw(m.filter((p: any) => Number.isFinite(p?.time) && Number.isFinite(p?.bt) && Number.isFinite(p?.bz)));
      }
      setLastUpdated(new Date());
    } catch {}
    finally { if (mountedRef.current) setLoading(false); }
  }, [fetchRawSource, fetchNeutronMonitor]);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    const iv = setInterval(fetchAll, 3*60*1000);
    return () => { mountedRef.current = false; clearInterval(iv); };
  }, [fetchAll]);

  // ── Filter data by time range ────────────────────────────────────────────────
  const filteredActive = useMemo(() => filterByTimeRange(activeRaw, timeRange), [activeRaw, timeRange]);
  const filteredSolar1 = useMemo(() => filterByTimeRange(solar1Raw, timeRange), [solar1Raw, timeRange]);
  const filteredImap   = useMemo(() => filterByTimeRange(imapRaw,   timeRange), [imapRaw,   timeRange]);
  const filteredStereo = useMemo(() => filterByTimeRange(stereoRaw, timeRange), [stereoRaw, timeRange]);

  // Robust early-warning analysis. Built from the FULL primary L1 history
  // available (the whole week), independent of the chart's time-range
  // selector — the baseline must always see the full week to know what
  // "quiet" looks like.
  const activeSamples = useMemo(
    () => toEpamSamples(activeRaw as any, WARN_CHANNELS, parseUTC),
    [activeRaw],
  );
  const solar1Samples = useMemo(
    () => toEpamSamples(solar1Raw as any, WARN_CHANNELS, parseUTC),
    [solar1Raw],
  );
  const imapSamples = useMemo(
    () => toEpamSamples(imapRaw as any, WARN_CHANNELS, parseUTC),
    [imapRaw],
  );

  // Independent confirmation inputs for the warning engine. Each source is
  // judged against its OWN 7-day baseline inside computeEpamWarning. If the
  // primary feed silently fell back to one of these spacecraft, that source
  // is excluded — a spacecraft cannot confirm itself.
  const confirmInputs = useMemo((): EpamConfirmationInput[] => {
    const primaryKey = activeMeta?.sourceKey ?? 'active';
    const list: EpamConfirmationInput[] = [];
    if (primaryKey !== 'solar1' && solar1Samples.length) list.push({ key: 'solar1', label: 'SOLAR-1', samples: solar1Samples });
    if (primaryKey !== 'imap' && imapSamples.length)     list.push({ key: 'imap',   label: 'IMAP',    samples: imapSamples });
    return list;
  }, [activeMeta, solar1Samples, imapSamples]);

  const warning: EpamWarning | null = useMemo(
    () => (activeSamples.length
      ? computeEpamWarning(activeSamples, nmRaw.length ? nmRaw : null, confirmInputs.length ? confirmInputs : null)
      : null),
    [activeSamples, nmRaw, confirmInputs],
  );

  // Rate-of-change series for the ROC view, clipped to the selected range.
  const rocSeries = useMemo(() => {
    if (!activeSamples.length) return [] as {x:number;y:number|null}[];
    const cutoff = Date.now() - timeRange * 3600 * 1000;
    return epamRateOfChange15m(activeSamples).filter(p => p.x > cutoff);
  }, [activeSamples, timeRange]);

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
      if (!filteredActive.length) return null;
      return { datasets: withShockMarkers(L1_CH.map(c => mkDs(rev(filteredActive), 'time_tag', c.k, c.c, c.l))) };
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

    if (view === 'solar1-raw') {
      if (!filteredSolar1.length) return null;
      return { datasets: withShockMarkers(L1_CH.map(c => mkDs(rev(filteredSolar1), 'time_tag', c.k, c.c, c.l))) };
    }

    if (view === 'imap-raw') {
      if (!filteredImap.length) return null;
      return { datasets: withShockMarkers(L1_CH.map(c => mkDs(rev(filteredImap), 'time_tag', c.k, c.c, c.l))) };
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

      // Primary L1 average: geometric mean across 5 proton channels
      if (showActive && filteredActive.length) {
        const pts = spikeFilter(rev(filteredActive).map(p => ({
          x: parseUTC(p.time_tag),
          y: geoMeanRow([p.p1, p.p3, p.p5, p.p7, p.p8]),
        })).filter(d => d.y !== null && d.y > 0));
        const lbl = activeMeta?.fallbackUsed
          ? `L1 primary — ${activeMeta.sourceLabel} fallback (avg)`
          : `${activeMeta?.sourceLabel ?? 'L1 primary'} (avg all channels)`;
        datasets.push({ label: lbl, borderColor: '#60a5fa', backgroundColor: '#60a5fa20', borderWidth: 2, pointRadius: 0, tension: 0.2, spanGaps: true, data: pts });
      }

      // SOLAR-1 average
      if (showSolar1 && filteredSolar1.length) {
        const pts = spikeFilter(rev(filteredSolar1).map(p => ({
          x: parseUTC(p.time_tag),
          y: geoMeanRow([p.p1, p.p3, p.p5, p.p7, p.p8]),
        })).filter(d => d.y !== null && d.y > 0));
        datasets.push({ label: 'SOLAR-1 EPAM (avg all channels)', borderColor: '#fbbf24', backgroundColor: '#fbbf2420', borderWidth: 2, pointRadius: 0, tension: 0.2, spanGaps: true, data: pts });
      }

      // IMAP average
      if (showImap && filteredImap.length) {
        const pts = spikeFilter(rev(filteredImap).map(p => ({
          x: parseUTC(p.time_tag),
          y: geoMeanRow([p.p1, p.p3, p.p5, p.p7, p.p8]),
        })).filter(d => d.y !== null && d.y > 0));
        datasets.push({ label: 'IMAP (avg all channels)', borderColor: '#f472b6', backgroundColor: '#f472b620', borderWidth: 2, pointRadius: 0, tension: 0.2, spanGaps: true, data: pts });
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
  }, [view, filteredActive, filteredSolar1, filteredImap, filteredStereo, rocSeries, activeMeta, showActive, showSolar1, showImap, showStereo, showShockMarkers, visibleShockEvents]);

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
    return baseOptions('logarithmic', 'p/cm²·s·sr·MeV');
  }, [view]);

  // Hide the IMAP view button when the feed is genuinely absent (the worker
  // treats IMAP as optional — it may not exist in the HAPI catalog yet).
  const visibleViews = useMemo(
    () => VIEWS.filter(v => v.key !== 'imap-raw' || imapAvailable || imapRaw.length > 0),
    [imapAvailable, imapRaw],
  );

  const info    = VIEW_INFO[view];
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
          <p className="text-xs text-neutral-500 mt-0.5">Solar storm early warning · Upstream spacecraft · Aurora potential indicator</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && <span className="text-xs text-neutral-600">{lastUpdated.toLocaleTimeString('en-NZ',{timeZone:'Pacific/Auckland',hour:'2-digit',minute:'2-digit'})} NZT</span>}
          <button onClick={fetchAll} className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors" title="Refresh">↻</button>
        </div>
      </div>

      {/* Early-warning banner — robust full-week L1 baseline (client-side),
          with independent SOLAR-1 / IMAP cross-spacecraft confirmation folded
          in by the warning engine itself. One combined box. */}
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
                <span className={`text-sm font-semibold ${w.text}`}>L1 Particles · {warning.levelLabel}</span>
                <span className="text-xs text-neutral-500 font-mono">score {warning.score}</span>
                <span className="ml-auto text-[10px] text-neutral-600">7-day baseline · multi-spacecraft</span>
              </div>
              {activeMeta && (
                <p className="text-[10px] text-neutral-600 mt-0.5">
                  Primary feed: {activeMeta.sourceLabel}
                  {activeMeta.fallbackUsed && <span className="text-amber-500/80"> · fallback in use</span>}
                </p>
              )}
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

              {/* Independent spacecraft confirmation (judged client-side by the
                  warning engine, each against its own 7-day baseline) */}
              {(d.confirmations.length > 0 || (combined && combined.cross_validation.confidence !== 'QUIET')) && (
                <div className="mt-2.5 pt-2.5 border-t border-white/5 space-y-0.5">
                  {d.confirmations.map(c => (
                    <p key={c.key} className="text-xs text-neutral-500">
                      {c.label}:{' '}
                      {!c.available ? (
                        <span className="text-neutral-600">no fresh data — cannot confirm</span>
                      ) : c.elevated ? (
                        <span className="text-orange-400">
                          also elevated — independently confirms activity
                          {c.sigma !== null && <span className="text-neutral-600 font-mono"> ({c.sigma.toFixed(1)}σ, {c.channelsRising} ch)</span>}
                        </span>
                      ) : (
                        <span className="text-green-400">quiet — not yet confirmed</span>
                      )}
                    </p>
                  ))}
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
        {visibleViews.map(v => (
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

      {/* Shock marker toggle (L1 / Combined views only) */}
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
          <button onClick={()=>setShowActive(v=>!v)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${showActive?'bg-sky-600/20 border-sky-600/60 text-sky-300':'bg-neutral-800/50 border-neutral-700 text-neutral-500'}`}>
            ● L1 Primary
          </button>
          <button onClick={()=>setShowSolar1(v=>!v)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${showSolar1?'bg-amber-600/20 border-amber-600/60 text-amber-300':'bg-neutral-800/50 border-neutral-700 text-neutral-500'}`}>
            ● SOLAR-1 EPAM
          </button>
          {(imapAvailable || imapRaw.length > 0) && (
            <button onClick={()=>setShowImap(v=>!v)}
              className={`px-3 py-1 text-xs rounded border transition-colors ${showImap?'bg-pink-600/20 border-pink-600/60 text-pink-300':'bg-neutral-800/50 border-neutral-700 text-neutral-500'}`}>
              ● IMAP
            </button>
          )}
          <button onClick={()=>setShowStereo(v=>!v)}
            className={`px-3 py-1 text-xs rounded border transition-colors ${showStereo?'bg-purple-600/20 border-purple-600/60 text-purple-300':'bg-neutral-800/50 border-neutral-700 text-neutral-500'}`}>
            ● STEREO-A <span className="text-neutral-600 text-xs">(off-axis)</span>
          </button>
        </div>
      )}

      {/* View-specific caution note */}
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
          <p className="text-neutral-500 text-sm">
            {view==='combined' && !showActive && !showSolar1 && !showImap && !showStereo
              ? 'Enable at least one source above'
              : view==='imap-raw'
                ? 'IMAP feed unavailable right now'
                : 'No data yet'}
          </p>
          <p className="text-neutral-600 text-xs mt-1">
            {view.startsWith('stereo') ? 'STEREO updates every ~18 minutes' : 'Check back after the first cron run'}
          </p>
        </div>
      ) : (
        <div className="relative h-[576px] bg-neutral-900/40 rounded-lg p-2">
          <Line data={chartData!} options={chartOptions} />
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
