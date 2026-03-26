// --- START OF FILE src/components/EPAMPanel.tsx ---
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Line } from 'react-chartjs-2';
import type { ChartOptions, ChartData } from 'chart.js';

interface EpamPoint { time_tag: string; p1: number|null; p3: number|null; p5: number|null; p7: number|null; p8: number|null; e1: number|null; e2: number|null; anisotropy_index: number|null; }
interface GoesPoint { time_tag: string; ge1?: number|null; ge5?: number|null; ge10?: number|null; ge30?: number|null; ge50?: number|null; ge100?: number|null; ge500?: number|null; }
interface StereoPoint { time_tag: string; speed?: number|null; density?: number|null; bx?: number|null; by?: number|null; bz?: number|null; bt?: number|null; sep_lo?: number|null; sep_hi?: number|null; }
interface AnalysisData { status: string; statusLabel: string; description: string; signatures: { velocity_dispersion: boolean; channel_compression: boolean; sharp_spike: boolean; anisotropy_elevated: boolean; elevated_channels: number }; metrics: { anisotropy_index: number|null; log_spread_4h_trend: number|null; dispersion_score: number }; goes_validation?: { available: boolean; ge10_mev_flux: number|null; s1_alert: boolean; elevated: boolean }; caveats: string[]; }
interface CombinedData { cross_validation: { confidence: string; confidenceLabel: string; summary: string; ace_epam_elevated: boolean; goes_s1_alert: boolean; stereo_elevated: boolean }; }

const EPAM_BASE = 'https://epam.thenamesrock.workers.dev';
type ViewKey = 'ace-raw'|'ace-avg'|'goes-raw'|'goes-avg'|'stereo-raw'|'stereo-avg';
const VIEWS: {key: ViewKey; label: string}[] = [
  {key:'ace-raw', label:'ACE Raw'}, {key:'ace-avg', label:'ACE Averaged'},
  {key:'goes-raw', label:'GOES Raw'}, {key:'goes-avg', label:'GOES Averaged'},
  {key:'stereo-raw', label:'STEREO Raw'}, {key:'stereo-avg', label:'STEREO Avg'},
];

const baseOptions = (yType: 'logarithmic'|'linear', yLabel: string): ChartOptions<'line'> => ({
  responsive: true, maintainAspectRatio: false, animation: false,
  interaction: { mode: 'index', intersect: false },
  plugins: {
    legend: { position: 'top', align: 'end', labels: { color: '#a3a3a3', boxWidth: 24, boxHeight: 2, padding: 10, font: { size: 11 } } },
    tooltip: { backgroundColor: '#1a1a1a', borderColor: '#3f3f46', borderWidth: 1, titleColor: '#e5e5e5', bodyColor: '#a3a3a3' },
  },
  scales: {
    x: { type: 'time', time: { tooltipFormat: 'dd MMM HH:mm', displayFormats: { hour: 'HH:mm', day: 'dd MMM' } }, ticks: { color: '#71717a', maxTicksLimit: 8, maxRotation: 0, font: { size: 10 } }, grid: { color: '#27272a' } },
    y: { type: yType, ticks: { color: '#71717a', font: { size: 10 }, maxTicksLimit: 6 }, grid: { color: '#27272a' }, title: { display: true, text: yLabel, color: '#71717a', font: { size: 10 } } },
  },
});

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

function estimateArrival(status:string, trend:number|null): string|null {
  if (status==='SHOCK_PASSAGE') return '⏱ Shock at ACE now — ~45–60 min to Earth impact';
  if (status==='CME_WATCH') return (trend!==null&&trend<-1e-9) ? '⏱ Estimated arrival: within 2–6 hours' : '⏱ Estimated arrival: within 6–24 hours';
  if (status==='COMPRESSION') return '⏱ Estimated arrival: within 12–24 hours';
  if (status==='DISPERSION') return '⏱ Watch: possible arrival within 24 hours';
  return null;
}

const VIEW_INFO: Record<ViewKey,{title:string;subtitle:string;note?:string}> = {
  'ace-raw':    {title:'ACE EPAM — Raw Proton Flux (L1)', subtitle:'All 5 proton energy channels at 5-minute resolution from ACE at L1. Watch for channel compression (lines converging on the log scale) and velocity dispersion (high-energy channels rising before low-energy ones) as early signs of an approaching CME shock. ACE sits ~1.5 million km sunward of Earth, giving ~45–60 minutes of warning.'},
  'ace-avg':    {title:'ACE EPAM — Hourly Averaged', subtitle:'Hourly averages of ACE proton channels. Smooths instrument noise to show longer-term elevation trends. Useful for identifying multi-hour particle events and confirming sustained activity.'},
  'goes-raw':   {title:'GOES SEISS — Integral Proton Flux (Geostationary)', subtitle:'Real-time integral proton thresholds from GOES at 36,000 km altitude. The ≥10 MeV channel exceeding 10 pfu triggers a NOAA S1 Solar Radiation Storm alert. Use this to cross-check ACE — if both are elevated simultaneously, the particle event is confirmed real and not an ACE instrument artifact.'},
  'goes-avg':   {title:'GOES SEISS — Hourly Averaged', subtitle:'Hourly averages of GOES integral proton channels. Good for tracking sustained radiation storm conditions and comparing with ACE trends over hours rather than minutes.'},
  'stereo-raw': {title:'STEREO-A — Energetic Particles + Solar Wind', subtitle:'1-minute data from STEREO-A showing particle flux and solar wind conditions from a different orbital vantage point.', note:'⚠ STEREO-A is NOT at the L1 point between the Sun and Earth. It orbits ~10–15° ahead of Earth on a different interplanetary magnetic field line. Elevated particles at STEREO do not reliably predict Earth-directed geomagnetic activity and should not be used as a primary indicator of impending storms. STEREO provides useful context about the broader heliospheric environment and can show if a CME has a wide angular extent.'},
  'stereo-avg': {title:'STEREO-A — Hourly Averaged', subtitle:'Hourly averages of STEREO-A data. Updates approximately every 18 minutes due to the large raw file size (~23MB).', note:'⚠ STEREO-A is NOT at the L1 point between the Sun and Earth. It orbits ~10–15° ahead of Earth on a different interplanetary magnetic field line. Elevated particles at STEREO do not reliably predict Earth-directed geomagnetic activity and should not be used as a primary indicator of impending storms. STEREO provides useful context about the broader heliospheric environment and can show if a CME has a wide angular extent.'},
};

const mkDs = (pts: any[], xKey: string, yKey: string, color: string, label: string, positiveOnly=true) => ({
  label, borderColor: color, backgroundColor: 'transparent', borderWidth: 1.5, pointRadius: 0, tension: 0,
  data: pts.map(p => ({x: new Date(p[xKey]).getTime(), y: p[yKey] ?? null})).filter(d => d.y !== null && (!positiveOnly || (d.y as number) > 0)),
});

const ACE_CHANNELS = [{k:'p1',c:'#60a5fa',l:'P1 47–68 keV'},{k:'p3',c:'#34d399',l:'P3 115–195 keV'},{k:'p5',c:'#facc15',l:'P5 310–580 keV'},{k:'p7',c:'#fb923c',l:'P7 795–1193 keV'},{k:'p8',c:'#f87171',l:'P8 1–1.9 MeV'}];
const GOES_CHANNELS = [{k:'ge1',c:'#93c5fd',l:'≥1 MeV'},{k:'ge10',c:'#fde047',l:'≥10 MeV'},{k:'ge100',c:'#ef4444',l:'≥100 MeV'},{k:'ge500',c:'#991b1b',l:'≥500 MeV'}];

function buildChart(view: ViewKey, epamRaw: EpamPoint[], epamAvg: any[], goesRaw: GoesPoint[], stereoRaw: StereoPoint[]): ChartData<'line'>|null {
  const rev = (arr: any[]) => [...arr].reverse();
  if (view==='ace-raw' && epamRaw.length)  return {datasets: ACE_CHANNELS.map(c => mkDs(rev(epamRaw), 'time_tag', c.k, c.c, c.l))};
  if (view==='ace-avg' && epamAvg.length)  return {datasets: ACE_CHANNELS.map(c => mkDs(rev(epamAvg), 'time_tag', c.k, c.c, c.l))};
  if (view==='goes-raw'&& goesRaw.length)  return {datasets: GOES_CHANNELS.map(c => mkDs(rev(goesRaw), 'time_tag', c.k, c.c, c.l))};
  if (view==='goes-avg'&& goesRaw.length)  return {datasets: GOES_CHANNELS.map(c => mkDs(rev(goesRaw), 'time_tag', c.k, c.c, c.l))};
  if ((view==='stereo-raw'||view==='stereo-avg') && stereoRaw.length) return {datasets:[
    {...mkDs(rev(stereoRaw),'time_tag','sep_lo','#a78bfa','Particles Low-E'), yAxisID:'y'},
    {...mkDs(rev(stereoRaw),'time_tag','sep_hi','#c084fc','Particles High-E'), yAxisID:'y'},
    {...mkDs(rev(stereoRaw),'time_tag','speed','#34d399','Speed (km/s)', false), yAxisID:'y2'},
    {...mkDs(rev(stereoRaw),'time_tag','bt','#60a5fa','Bt (nT)', false), yAxisID:'y2'},
  ]};
  return null;
}

const EPAMPanel: React.FC = () => {
  const [view, setView] = useState<ViewKey>('ace-raw');
  const [epamRaw, setEpamRaw]     = useState<EpamPoint[]>([]);
  const [epamAvg, setEpamAvg]     = useState<any[]>([]);
  const [goesRaw, setGoesRaw]     = useState<GoesPoint[]>([]);
  const [stereoRaw, setStereoRaw] = useState<StereoPoint[]>([]);
  const [analysis, setAnalysis]   = useState<AnalysisData|null>(null);
  const [combined, setCombined]   = useState<CombinedData|null>(null);
  const [loading, setLoading]     = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date|null>(null);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const [r1,r2,r3,r4,r5,r6] = await Promise.allSettled([
        fetch(`${EPAM_BASE}/epam/raw`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/averaged`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/goes`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/stereo`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/analysis`).then(r=>r.ok?r.json():null),
        fetch(`${EPAM_BASE}/epam/combined`).then(r=>r.ok?r.json():null),
      ]);
      if (!mountedRef.current) return;
      if (r1.status==='fulfilled' && r1.value?.data)                setEpamRaw(r1.value.data);
      if (r2.status==='fulfilled' && r2.value?.hourly)              setEpamAvg(r2.value.hourly);
      if (r3.status==='fulfilled' && r3.value?.data)                setGoesRaw(r3.value.data);
      if (r4.status==='fulfilled' && r4.value?.data)                setStereoRaw(r4.value.data);
      if (r5.status==='fulfilled' && r5.value?.status)              setAnalysis(r5.value);
      if (r6.status==='fulfilled' && r6.value?.cross_validation)    setCombined(r6.value);
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

  const chartData = buildChart(view, epamRaw, epamAvg, goesRaw, stereoRaw);
  const isStereo  = view.startsWith('stereo');
  const isGoes    = view.startsWith('goes');
  const info      = VIEW_INFO[view];

  const chartOptions: ChartOptions<'line'> = isStereo ? {
    ...baseOptions('logarithmic', 'Particle flux'),
    scales: {
      x: (baseOptions('logarithmic','') as any).scales.x,
      y:  {type:'logarithmic', ticks:{color:'#71717a',font:{size:10},maxTicksLimit:6}, grid:{color:'#27272a'}, title:{display:true,text:'Particle flux',color:'#71717a',font:{size:10}}},
      y2: {type:'linear',position:'right', ticks:{color:'#71717a',font:{size:10},maxTicksLimit:6}, grid:{drawOnChartArea:false}, title:{display:true,text:'km/s · nT',color:'#71717a',font:{size:10}}},
    },
  } : baseOptions('logarithmic', isGoes ? 'pfu' : 'p/cm²·s·sr·MeV');

  // Status banner inline
  const s = STATUS_STYLES[analysis?.status ?? 'QUIET'] ?? STATUS_STYLES.QUIET;
  const arrival = analysis ? estimateArrival(analysis.status, analysis.metrics.log_spread_4h_trend) : null;

  return (
    <div>
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
          {combined?.cross_validation.confidence!=='QUIET' && combined?.cross_validation.confidence && (
            <p className="text-xs text-neutral-500 mt-0.5">Multi-spacecraft confidence: {combined.cross_validation.confidenceLabel}</p>
          )}
        </div>
      )}

      {/* View selector */}
      <div className="flex justify-center gap-2 mb-4 flex-wrap">
        {VIEWS.map(v => (
          <button key={v.key} onClick={()=>setView(v.key)}
            className={`px-3 py-1 text-xs rounded transition-colors ${view===v.key?'bg-sky-600 text-white':'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Chart title */}
      <div className="mb-3">
        <p className="text-sm font-semibold text-neutral-200">{info.title}</p>
        <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{info.subtitle}</p>
      </div>

      {/* STEREO note */}
      {info.note && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-900/30 border border-amber-700/40 rounded-lg mb-3">
          <span className="text-amber-400 flex-shrink-0 mt-0.5">⚠</span>
          <p className="text-xs text-amber-300/80 leading-relaxed">{info.note}</p>
        </div>
      )}

      {/* Chart */}
      {loading ? (
        <div className="h-64 bg-neutral-800/50 rounded-lg animate-pulse" />
      ) : !chartData ? (
        <div className="h-64 flex flex-col items-center justify-center bg-neutral-800/30 rounded-lg border border-neutral-700/50">
          <p className="text-neutral-500 text-sm">No data yet</p>
          <p className="text-neutral-600 text-xs mt-1">{view.startsWith('stereo')?'STEREO updates every ~18 minutes':'Check back after the first cron run'}</p>
        </div>
      ) : (
        <div className="relative h-72 bg-neutral-900/40 rounded-lg p-2">
          <Line data={chartData} options={chartOptions} />
        </div>
      )}

      {/* GOES S-scale reference */}
      {isGoes && (
        <div className="flex gap-4 mt-2 text-xs text-neutral-600 flex-wrap">
          <span>S1: ≥10 MeV &gt;10 pfu</span><span>S2: &gt;100 pfu</span><span>S3: &gt;1,000 pfu</span><span>S4: &gt;10,000 pfu</span><span>S5: &gt;100,000 pfu</span>
        </div>
      )}

      <p className="text-xs text-neutral-700 mt-4 pt-3 border-t border-neutral-800">
        Elevated particle flux alone does not guarantee aurora — the CME must have southward Bz after arrival. ·{' '}
        <a href="https://www.swpc.noaa.gov" className="text-neutral-600 hover:text-sky-400" target="_blank" rel="noopener noreferrer">NOAA SWPC</a>
      </p>
    </div>
  );
};

export default EPAMPanel;
// --- END OF FILE src/components/EPAMPanel.tsx ---