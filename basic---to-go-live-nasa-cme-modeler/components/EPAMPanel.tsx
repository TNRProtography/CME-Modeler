// --- START OF FILE src/components/EPAMPanel.tsx ---
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartOptions, ChartData } from 'chart.js';

// ─── Types ────────────────────────────────────────────────────────────────────
interface EpamPoint { time_tag: string; p1: number|null; p3: number|null; p5: number|null; p7: number|null; p8: number|null; e1: number|null; e2: number|null; anisotropy_index: number|null; }
interface GoesPoint { time_tag: string; ge1?: number|null; ge10?: number|null; ge30?: number|null; ge50?: number|null; ge100?: number|null; ge500?: number|null; }
interface StereoPoint { time_tag: string; speed?: number|null; density?: number|null; bz?: number|null; bt?: number|null; sep_lo?: number|null; sep_hi?: number|null; }
interface AnalysisData { status: string; statusLabel: string; description: string; signatures: { velocity_dispersion: boolean; channel_compression: boolean; sharp_spike: boolean; anisotropy_elevated: boolean; elevated_channels: number }; metrics: { anisotropy_index: number|null; log_spread_4h_trend: number|null }; goes_validation?: { available: boolean; ge10_mev_flux: number|null; s1_alert: boolean; elevated: boolean }; }
interface CombinedData { cross_validation: { confidence: string; confidenceLabel: string; ace_epam_elevated: boolean; goes_s1_alert: boolean; stereo_elevated: boolean }; }

const EPAM_BASE = 'https://epam.thenamesrock.workers.dev';

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
    legend: { position: 'top', align: 'end', labels: { color: '#a3a3a3', boxWidth: 24, boxHeight: 2, padding: 10, font: { size: 11 } } },
    tooltip: { backgroundColor: '#1a1a1a', borderColor: '#3f3f46', borderWidth: 1, titleColor: '#e5e5e5', bodyColor: '#a3a3a3' },
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
  if (status==='SHOCK_PASSAGE') return '⏱ Shock at ACE now — ~45–60 min to Earth impact';
  if (status==='CME_WATCH') return (trend!==null&&trend<-1e-9) ? '⏱ Estimated arrival: within 2–6 hours' : '⏱ Estimated arrival: within 6–24 hours';
  if (status==='COMPRESSION') return '⏱ Estimated arrival: within 12–24 hours';
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

const mkDs = (pts: any[], timeKey: string, valueKey: string, color: string, label: string, positiveOnly = true) => ({
  label, borderColor: color, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0,
  data: pts
    .map(p => ({ x: parseUTC(String(p[timeKey])), y: p[valueKey] ?? null }))
    .filter(d => d.y !== null && (!positiveOnly || (d.y as number) > 0)),
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

// ─── View metadata ────────────────────────────────────────────────────────────
const VIEW_INFO: Record<ViewKey, {title: string; subtitle: string; note?: string}> = {
  'ace-raw':  {title: 'ACE EPAM — Raw Proton Flux (L1)', subtitle: 'All 5 proton energy channels at 5-minute resolution from ACE at L1, ~1.5 million km sunward of Earth. Watch for channel compression (lines converging on the log scale) and velocity dispersion (higher-energy channels rising before lower-energy ones) as early signatures of an approaching CME shock. ACE gives ~45–60 minutes of warning before Earth impact.'},
  'goes-raw': {title: 'GOES SEISS — Integral Proton Flux (Geostationary)', subtitle: 'Real-time integral proton thresholds from the GOES geostationary satellite at 36,000 km altitude. The ≥10 MeV channel exceeding 10 pfu triggers a NOAA S1 Solar Radiation Storm alert. Use this to cross-check ACE EPAM — if both are elevated simultaneously, the particle event is confirmed real.'},
  'stereo-raw': {title: 'STEREO-A — Energetic Particles + Solar Wind', subtitle: 'Low and high-energy particle flux from STEREO-A, plus solar wind speed and magnetic field strength.', note: '⚠ STEREO-A is NOT between the Sun and Earth. It orbits ~10–15° ahead of Earth on a different interplanetary magnetic field line. Elevated particles at STEREO do not reliably predict Earth-directed geomagnetic activity and should not be used as a primary indicator of impending storms. STEREO shows how wide a solar event is and whether it might be Earth-directed — but this requires forecaster judgement, not direct interpretation.'},
  'combined': {title: 'Combined Average — All Sources', subtitle: 'Each line shows the geometric mean across all available channels from that source, giving a single trend line per spacecraft. Useful for comparing the overall particle environment across ACE (L1), GOES (geostationary), and STEREO-A (off-axis). Toggle sources on/off using the buttons below.'},
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
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const [r1,r2,r3,r4,r5] = await Promise.allSettled([
        fetch(`${EPAM_BASE}/epam/raw`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/goes`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/stereo`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/analysis`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/combined`).then(r=>r.ok?r.json():null),
      ]);
      if (!mountedRef.current) return;
      if (r1.status==='fulfilled' && r1.value?.data)              setEpamRaw(r1.value.data);
      if (r2.status==='fulfilled' && r2.value?.data)              setGoesRaw(r2.value.data);
      if (r3.status==='fulfilled' && r3.value?.data)              setStereoRaw(r3.value.data);
      if (r4.status==='fulfilled' && r4.value?.status)            setAnalysis(r4.value);
      if (r5.status==='fulfilled' && r5.value?.cross_validation)  setCombined(r5.value);
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

  // ── Build chart data ────────────────────────────────────────────────────────
  const chartData = useMemo((): ChartData<'line'>|null => {
    const rev = (a: any[]) => [...a].reverse();

    if (view === 'ace-raw') {
      if (!filteredEpam.length) return null;
      return { datasets: ACE_CH.map(c => mkDs(rev(filteredEpam), 'time_tag', c.k, c.c, c.l)) };
    }

    if (view === 'goes-raw') {
      if (!filteredGoes.length) return null;
      return { datasets: GOES_CH.map(c => mkDs(rev(filteredGoes), 'time_tag', c.k, c.c, c.l)) };
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
        const pts = rev(filteredEpam).map(p => ({
          x: parseUTC(p.time_tag),
          y: geoMeanRow([p.p1, p.p3, p.p5, p.p7, p.p8]),
        })).filter(d => d.y !== null && d.y > 0);
        datasets.push({ label: 'ACE EPAM (avg all channels)', borderColor: '#60a5fa', backgroundColor: '#60a5fa20', borderWidth: 2, pointRadius: 0, tension: 0.2, data: pts });
      }

      // GOES average: geometric mean across available channels
      if (showGoes && filteredGoes.length) {
        const pts = rev(filteredGoes).map(p => ({
          x: parseUTC(p.time_tag),
          y: geoMeanRow([p.ge1 ?? null, p.ge10 ?? null, p.ge100 ?? null, p.ge500 ?? null]),
        })).filter(d => d.y !== null && d.y > 0);
        datasets.push({ label: 'GOES SEISS (avg all channels)', borderColor: '#fde047', backgroundColor: '#fde04720', borderWidth: 2, pointRadius: 0, tension: 0.2, data: pts });
      }

      // STEREO average: geometric mean of proton channels
      if (showStereo && filteredStereo.length) {
        const pts = rev(filteredStereo).map(p => ({
          x: parseUTC(p.time_tag),
          y: geoMeanRow([p.sep_lo ?? null, p.sep_hi ?? null]),
        })).filter(d => d.y !== null && d.y > 0);
        datasets.push({ label: 'STEREO-A (avg particle channels)', borderColor: '#a78bfa', backgroundColor: '#a78bfa20', borderWidth: 2, pointRadius: 0, tension: 0.2, borderDash: [4,3], data: pts });
      }

      return datasets.length ? { datasets } : null;
    }

    return null;
  }, [view, filteredEpam, filteredGoes, filteredStereo, showAce, showGoes, showStereo]);

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
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-semibold text-white">Energetic Particle Monitor</h2>
          <p className="text-xs text-neutral-500 mt-0.5">ACE EPAM (L1) · GOES SEISS · STEREO-A</p>
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
            {analysis.signatures.velocity_dispersion && <span className="px-2 py-0.5 rounded-full bg-purple-900/50 border border-purple-700/40 text-purple-300 text-xs">Velocity Dispersion</span>}
            {analysis.signatures.channel_compression && <span className="px-2 py-0.5 rounded-full bg-orange-900/50 border border-orange-700/40 text-orange-300 text-xs">Channel Compression</span>}
            {analysis.signatures.sharp_spike         && <span className="px-2 py-0.5 rounded-full bg-red-900/50    border border-red-700/40    text-red-300    text-xs">Sharp Spike</span>}
            {analysis.signatures.anisotropy_elevated && <span className="px-2 py-0.5 rounded-full bg-sky-900/50    border border-sky-700/40    text-sky-300    text-xs">Particle Beam</span>}
          </div>
          <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">{analysis.description}</p>
          {arrival && <p className="text-xs font-mono text-neutral-300 mt-1">{arrival}</p>}
          {analysis.goes_validation?.available && (
            <p className="text-xs text-neutral-500 mt-1">
              GOES cross-check: <span className={analysis.goes_validation.elevated?'text-orange-400':'text-green-400'}>{analysis.goes_validation.elevated?'elevated':'quiet'}</span>
              {analysis.goes_validation.ge10_mev_flux!==null && <> — ≥10 MeV: {analysis.goes_validation.ge10_mev_flux.toExponential(1)} pfu</>}
              {analysis.goes_validation.s1_alert && <span className="ml-1 text-yellow-400 font-semibold">· S1 Storm Active</span>}
            </p>
          )}
          {combined?.cross_validation.confidence!=='QUIET' && (
            <p className="text-xs text-neutral-500 mt-0.5">Multi-spacecraft: {combined?.cross_validation.confidenceLabel}</p>
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
        Elevated particle flux alone does not guarantee aurora — the CME must have southward Bz after arrival at Earth. ·{' '}
        <a href="https://www.swpc.noaa.gov" className="text-neutral-600 hover:text-sky-400" target="_blank" rel="noopener noreferrer">NOAA SWPC</a>
      </p>
    </div>
  );
};

export default EPAMPanel;
// --- END OF FILE src/components/EPAMPanel.tsx ---