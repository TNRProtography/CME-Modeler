// --- START OF FILE src/components/EPAMPanel.tsx ---
import React, { useState, useEffect, useCallback, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface EpamPoint {
  time_tag: string;
  p1: number | null; p3: number | null; p5: number | null;
  p7: number | null; p8: number | null;
  e1: number | null; e2: number | null;
  anisotropy_index: number | null;
}

interface GoesPoint {
  time_tag: string; satellite?: string;
  ge1?: number; ge5?: number; ge10?: number; ge30?: number;
  ge50?: number; ge100?: number; ge500?: number;
}

interface StereoPoint {
  time_tag: string;
  speed?: number; density?: number; temperature?: number;
  bx?: number; by?: number; bz?: number; bt?: number;
  sep_lo?: number; sep_hi?: number; electrons?: number;
}

interface AnalysisData {
  status: string; statusLabel: string; description: string; timestamp: string;
  signatures: { velocity_dispersion: boolean; channel_compression: boolean; sharp_spike: boolean; anisotropy_elevated: boolean; elevated_channels: number };
  metrics: { anisotropy_index: number | null; log_spread_4h_trend: number | null; dispersion_score: number };
  goes_validation?: { available: boolean; ge10_mev_flux: number | null; s1_alert: boolean; elevated: boolean; confidence_note: string };
  caveats: string[];
}

interface CombinedData {
  cross_validation: { confidence: string; confidenceLabel: string; summary: string; ace_epam_elevated: boolean; goes_s1_alert: boolean; stereo_elevated: boolean };
  ace_epam: { current: EpamPoint | null };
  goes: { current: GoesPoint | null };
  stereo_a: { current: StereoPoint | null };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const EPAM_BASE = 'https://epam.thenamesrock.workers.dev';

const PROTON_CHANNELS = [
  { key: 'p1', label: 'P1', energy: '47–68 keV',    color: '#60a5fa', logicColor: 'blue' },
  { key: 'p3', label: 'P3', energy: '115–195 keV',  color: '#34d399', logicColor: 'green' },
  { key: 'p5', label: 'P5', energy: '310–580 keV',  color: '#facc15', logicColor: 'yellow' },
  { key: 'p7', label: 'P7', energy: '795–1193 keV', color: '#fb923c', logicColor: 'orange' },
  { key: 'p8', label: 'P8', energy: '1–1.9 MeV',   color: '#f87171', logicColor: 'red' },
] as const;

const GOES_CHANNELS = [
  { key: 'ge1',   label: '≥1 MeV',   color: '#93c5fd' },
  { key: 'ge10',  label: '≥10 MeV',  color: '#fde047', alert: 10,    alertLabel: 'S1 Storm' },
  { key: 'ge100', label: '≥100 MeV', color: '#ef4444', alert: 1,     alertLabel: 'S2 Storm' },
  { key: 'ge500', label: '≥500 MeV', color: '#991b1b' },
] as const;

// ─── Arrival timeline estimation ──────────────────────────────────────────────
function estimateArrival(analysis: AnalysisData | null): { window: string; color: string; description: string } | null {
  if (!analysis) return null;
  const { status, signatures } = analysis;
  if (status === 'SHOCK_PASSAGE') return {
    window: 'Impact now — 45–60 min to Earth',
    color: '#ef4444',
    description: 'Shock is currently crossing ACE. At L1 to Earth propagation speed, impact expected within the hour.'
  };
  if (status === 'CME_WATCH') {
    const spreadTrend = analysis.metrics.log_spread_4h_trend;
    // Steeper negative trend = faster compression = closer arrival
    if (spreadTrend !== null && spreadTrend < -1e-9) return {
      window: 'Within 2–6 hours',
      color: '#f97316',
      description: 'Rapid channel compression with velocity dispersion. Shock arrival likely within hours.'
    };
    return {
      window: 'Within 6–24 hours',
      color: '#facc15',
      description: 'Channel compression and velocity dispersion both active. Shock approach confirmed but timing uncertain.'
    };
  }
  if (status === 'COMPRESSION') return {
    window: 'Within 12–24 hours',
    color: '#facc15',
    description: 'Channel compression detected. Shock may be approaching but velocity dispersion not yet confirmed.'
  };
  if (status === 'DISPERSION') return {
    window: 'Within 24 hours (watch)',
    color: '#a3e635',
    description: 'Velocity dispersion detected. Could be an approaching shock days away or a gradual SEP event.'
  };
  return null;
}

// ─── Mini sparkline canvas chart ─────────────────────────────────────────────
interface SparklineProps {
  data: { time_tag: string; [key: string]: any }[];
  channels: { key: string; color: string; label: string }[];
  height?: number;
  logScale?: boolean;
  minVal?: number;
  maxVal?: number;
  showGrid?: boolean;
  tooltip?: string;
  yLabel?: string;
  lastN?: number;
}

const Sparkline: React.FC<SparklineProps> = ({
  data, channels, height = 120, logScale = true, showGrid = true,
  minVal, maxVal, yLabel, lastN = 288,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const PAD_L = 40, PAD_R = 8, PAD_T = 8, PAD_B = 20;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;

    ctx.clearRect(0, 0, W, H);

    const slice = data.slice(0, lastN).reverse(); // oldest → newest
    if (slice.length < 2) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '11px monospace';
      ctx.fillText('Awaiting data…', PAD_L + 10, H / 2);
      return;
    }

    // Collect all valid values for auto-scaling
    let allVals: number[] = [];
    for (const ch of channels) {
      for (const pt of slice) {
        const v = pt[ch.key];
        if (v !== null && v !== undefined && Number(v) > 0) allVals.push(Number(v));
      }
    }
    if (allVals.length === 0) return;

    const rawMin = minVal ?? Math.min(...allVals);
    const rawMax = maxVal ?? Math.max(...allVals);

    const toY = (v: number): number => {
      if (!v || v <= 0) return H - PAD_B;
      if (logScale) {
        const logMin = Math.log10(Math.max(rawMin, 1e-6));
        const logMax = Math.log10(Math.max(rawMax, 1e-5));
        if (logMax === logMin) return PAD_T + chartH / 2;
        return PAD_T + chartH * (1 - (Math.log10(v) - logMin) / (logMax - logMin));
      } else {
        if (rawMax === rawMin) return PAD_T + chartH / 2;
        return PAD_T + chartH * (1 - (v - rawMin) / (rawMax - rawMin));
      }
    };

    const toX = (i: number): number => PAD_L + (i / (slice.length - 1)) * chartW;

    // Grid
    if (showGrid) {
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 1;
      // Horizontal grid lines
      const gridLines = logScale
        ? [1e-3, 1e-2, 1e-1, 1, 10, 100, 1000, 1e4, 1e5, 1e6, 1e7]
        : [rawMin, (rawMin + rawMax) / 2, rawMax];
      for (const gv of gridLines) {
        if (gv < rawMin * 0.5 || gv > rawMax * 2) continue;
        const gy = toY(gv);
        if (gy < PAD_T || gy > H - PAD_B) continue;
        ctx.beginPath(); ctx.moveTo(PAD_L, gy); ctx.lineTo(W - PAD_R, gy); ctx.stroke();
        // Label
        ctx.fillStyle = '#52525b';
        ctx.font = '9px monospace';
        ctx.textAlign = 'right';
        const label = gv >= 1000 ? `${(gv / 1000).toFixed(0)}k` : gv >= 1 ? gv.toFixed(0) : gv.toExponential(0);
        ctx.fillText(label, PAD_L - 3, gy + 3);
      }
      // Vertical time lines (every ~6h)
      const totalMs = new Date(slice[slice.length - 1].time_tag).getTime() - new Date(slice[0].time_tag).getTime();
      const stepMs = 6 * 3600 * 1000;
      const startT = new Date(slice[0].time_tag).getTime();
      for (let t = startT; t <= startT + totalMs; t += stepMs) {
        const frac = (t - startT) / totalMs;
        const gx = PAD_L + frac * chartW;
        ctx.strokeStyle = '#27272a';
        ctx.beginPath(); ctx.moveTo(gx, PAD_T); ctx.lineTo(gx, H - PAD_B); ctx.stroke();
        ctx.fillStyle = '#52525b';
        ctx.textAlign = 'center';
        ctx.font = '9px monospace';
        const d = new Date(t);
        ctx.fillText(d.toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', timeZone: 'Pacific/Auckland' }), gx, H - PAD_B + 12);
      }
    }

    // Axis border
    ctx.strokeStyle = '#3f3f46';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD_L, PAD_T, chartW, chartH);

    // Y label
    if (yLabel) {
      ctx.save();
      ctx.fillStyle = '#71717a';
      ctx.font = '9px monospace';
      ctx.textAlign = 'center';
      ctx.translate(10, PAD_T + chartH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(yLabel, 0, 0);
      ctx.restore();
    }

    // Plot each channel
    for (const ch of channels) {
      ctx.beginPath();
      ctx.strokeStyle = ch.color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      let started = false;
      for (let i = 0; i < slice.length; i++) {
        const v = Number(slice[i][ch.key]);
        if (!v || v <= 0) { started = false; continue; }
        const x = toX(i), y = toY(v);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, [data, channels, height, logScale, minVal, maxVal, showGrid, yLabel, lastN]);

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={height}
      className="w-full rounded"
      style={{ imageRendering: 'pixelated' }}
    />
  );
};

// ─── Tooltip component ────────────────────────────────────────────────────────
const InfoTooltip: React.FC<{ content: React.ReactNode }> = ({ content }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block ml-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-4 h-4 rounded-full border border-neutral-600 text-neutral-500 hover:text-white hover:border-neutral-400 flex items-center justify-center text-xs transition-colors leading-none"
        aria-label="More information"
      >?</button>
      {open && (
        <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-neutral-800 border border-neutral-600 rounded-lg p-3 text-xs text-neutral-300 leading-relaxed shadow-2xl">
          {content}
          <button onClick={() => setOpen(false)} className="mt-2 text-neutral-500 hover:text-white text-xs block">✕ Close</button>
        </div>
      )}
    </span>
  );
};

// ─── Status badge ─────────────────────────────────────────────────────────────
const StatusBadge: React.FC<{ analysis: AnalysisData | null; combined: CombinedData | null; loading: boolean }> = ({ analysis, combined, loading }) => {
  if (loading) return <div className="h-20 bg-neutral-800 rounded-lg animate-pulse" />;
  if (!analysis) return null;

  const arrival = estimateArrival(analysis);
  const status = analysis.status;

  const statusColors: Record<string, { bg: string; border: string; text: string; dot: string }> = {
    SHOCK_PASSAGE:    { bg: 'bg-red-950/80',    border: 'border-red-500/60',    text: 'text-red-200',    dot: 'bg-red-400 animate-ping' },
    CME_WATCH:        { bg: 'bg-orange-950/80', border: 'border-orange-500/60', text: 'text-orange-200', dot: 'bg-orange-400 animate-pulse' },
    COMPRESSION:      { bg: 'bg-yellow-950/80', border: 'border-yellow-600/60', text: 'text-yellow-200', dot: 'bg-yellow-400 animate-pulse' },
    DISPERSION:       { bg: 'bg-yellow-950/80', border: 'border-yellow-600/60', text: 'text-yellow-200', dot: 'bg-yellow-500' },
    SEP_STREAMING:    { bg: 'bg-sky-950/80',    border: 'border-sky-600/60',    text: 'text-sky-200',    dot: 'bg-sky-400' },
    ELEVATED:         { bg: 'bg-sky-950/60',    border: 'border-sky-700/60',    text: 'text-sky-300',    dot: 'bg-sky-500' },
    SLIGHT_ELEVATION: { bg: 'bg-neutral-800/80', border: 'border-neutral-600',  text: 'text-neutral-300', dot: 'bg-neutral-400' },
    QUIET:            { bg: 'bg-neutral-900/80', border: 'border-neutral-700',  text: 'text-neutral-400', dot: 'bg-green-500' },
  };
  const c = statusColors[status] ?? statusColors.QUIET;
  const goesConf = analysis.goes_validation;
  const crossConf = combined?.cross_validation;

  return (
    <div className={`${c.bg} border ${c.border} rounded-xl p-4 mb-4`}>
      {/* Top row: status + dot */}
      <div className="flex items-center gap-3 mb-2">
        <span className="relative flex h-3 w-3 flex-shrink-0">
          <span className={`absolute inline-flex h-full w-full rounded-full ${c.dot} opacity-75`} />
          <span className={`relative inline-flex rounded-full h-3 w-3 ${c.dot.replace(' animate-ping', '').replace(' animate-pulse', '')}`} />
        </span>
        <span className={`font-bold text-sm ${c.text}`}>{analysis.statusLabel}</span>
        <InfoTooltip content={
          <div>
            <p className="font-semibold text-white mb-1">What does this mean?</p>
            <p className="mb-2">{analysis.description}</p>
            {analysis.caveats.map((cv, i) => (
              <p key={i} className="text-neutral-400 text-xs mt-1">⚠ {cv}</p>
            ))}
          </div>
        } />
      </div>

      {/* Arrival timeline */}
      {arrival && (
        <div className="flex items-center gap-2 mb-2 pl-6">
          <span className="text-xs font-mono" style={{ color: arrival.color }}>⏱ {arrival.window}</span>
          <InfoTooltip content={<p>{arrival.description}<br /><br />Note: These windows are estimates based on particle signatures. Actual CME arrival may vary by several hours.</p>} />
        </div>
      )}

      {/* Signature flags */}
      <div className="flex flex-wrap gap-1.5 pl-6 mb-2">
        {analysis.signatures.velocity_dispersion && (
          <span className="px-2 py-0.5 rounded-full bg-purple-900/60 border border-purple-600/40 text-purple-300 text-xs flex items-center gap-1">
            ⚡ Velocity Dispersion
            <InfoTooltip content={<p>Higher-energy particles (faster) arrived before lower-energy ones. This is a classic early-warning sign that energetic particles from a solar source — likely a CME shock — are streaming toward Earth. The more energy channels show this pattern, the more confident the detection.</p>} />
          </span>
        )}
        {analysis.signatures.channel_compression && (
          <span className="px-2 py-0.5 rounded-full bg-orange-900/60 border border-orange-600/40 text-orange-300 text-xs flex items-center gap-1">
            🔽 Channel Compression
            <InfoTooltip content={<p>The gap between high-energy and low-energy particle channels is narrowing on the chart. Under quiet conditions this gap is large. As a CME shock approaches and continuously accelerates particles across a wider energy range, the high-energy channels rise faster — compressing the spread. This is one of the most reliable pre-shock signatures.</p>} />
          </span>
        )}
        {analysis.signatures.sharp_spike && (
          <span className="px-2 py-0.5 rounded-full bg-red-900/60 border border-red-600/40 text-red-300 text-xs flex items-center gap-1">
            📈 Sharp Spike
            <InfoTooltip content={<p>Multiple channels spiked sharply within the last hour. This pattern — simultaneous rapid rise across 3+ channels — typically indicates the shock itself is passing ACE right now. Earth impact follows within ~45–60 minutes.</p>} />
          </span>
        )}
        {analysis.signatures.anisotropy_elevated && (
          <span className="px-2 py-0.5 rounded-full bg-sky-900/60 border border-sky-600/40 text-sky-300 text-xs flex items-center gap-1">
            📡 Particle Beam
            <InfoTooltip content={<p>The anisotropy index is above 1.0, meaning particles are preferentially arriving from the direction of the Sun (a "pencil beam" or field-aligned beam). Normal background is 0.2–0.5. This confirms a remote solar source is actively sending energetic particles along the interplanetary magnetic field line connecting to ACE.</p>} />
          </span>
        )}
      </div>

      {/* GOES cross-validation */}
      {goesConf?.available && (
        <div className="pl-6 text-xs text-neutral-400 flex items-center gap-1">
          <span className={goesConf.elevated ? 'text-orange-300' : 'text-green-400'}>
            {goesConf.elevated ? '🛰 GOES confirms elevation' : '🛰 GOES: quiet'}
          </span>
          {goesConf.ge10_mev_flux !== null && (
            <span className="text-neutral-500">— ≥10 MeV: {goesConf.ge10_mev_flux.toExponential(1)} p/(cm²·s·sr)</span>
          )}
          <InfoTooltip content={<p>GOES satellite sits in geostationary orbit (36,000 km). If it also shows elevated particles, the ACE reading is very likely real and not an instrument artifact. GOES uses a modern, well-calibrated instrument and is the gold standard for confirming solar radiation storms.</p>} />
        </div>
      )}

      {/* Combined confidence */}
      {crossConf && crossConf.confidence !== 'QUIET' && (
        <div className="pl-6 mt-1 text-xs text-neutral-300">
          <span className="text-neutral-500">Multi-spacecraft: </span>{crossConf.confidenceLabel}
        </div>
      )}
    </div>
  );
};

// ─── Chart section with header + tooltip ─────────────────────────────────────
const ChartSection: React.FC<{
  title: string;
  subtitle: string;
  tooltipContent: React.ReactNode;
  children: React.ReactNode;
  legend: { color: string; label: string; sublabel?: string }[];
}> = ({ title, subtitle, tooltipContent, children, legend }) => (
  <div className="bg-neutral-900/60 border border-neutral-700/50 rounded-xl p-3 mb-3">
    <div className="flex items-center justify-between mb-1">
      <div>
        <span className="text-sm font-semibold text-neutral-200">{title}</span>
        <InfoTooltip content={tooltipContent} />
        <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-end max-w-[55%]">
        {legend.map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded-full inline-block" style={{ backgroundColor: l.color }} />
            <span className="text-xs text-neutral-400">{l.label}</span>
            {l.sublabel && <span className="text-xs text-neutral-600">{l.sublabel}</span>}
          </div>
        ))}
      </div>
    </div>
    {children}
  </div>
);

// ─── Main EPAMPanel component ─────────────────────────────────────────────────
export const EPAMPanel: React.FC = () => {
  const [epamData,     setEpamData]     = useState<EpamPoint[]>([]);
  const [goesData,     setGoesData]     = useState<GoesPoint[]>([]);
  const [stereoData,   setStereoData]   = useState<StereoPoint[]>([]);
  const [analysis,     setAnalysis]     = useState<AnalysisData | null>(null);
  const [combined,     setCombined]     = useState<CombinedData | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [lastUpdated,  setLastUpdated]  = useState<Date | null>(null);
  const [timeRange,    setTimeRange]    = useState<24 | 48 | 168>(24); // hours
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const [rawRes, goesRes, stereoRes, analysisRes, combinedRes] = await Promise.allSettled([
        fetch(`${EPAM_BASE}/epam/raw`).then(r => r.ok ? r.json() : null),
        fetch(`${EPAM_BASE}/epam/goes`).then(r => r.ok ? r.json() : null),
        fetch(`${EPAM_BASE}/epam/stereo`).then(r => r.ok ? r.json() : null),
        fetch(`${EPAM_BASE}/epam/analysis`).then(r => r.ok ? r.json() : null),
        fetch(`${EPAM_BASE}/epam/combined`).then(r => r.ok ? r.json() : null),
      ]);

      if (!mountedRef.current) return;

      if (rawRes.status === 'fulfilled' && rawRes.value?.data) {
        setEpamData(rawRes.value.data);
      }
      if (goesRes.status === 'fulfilled' && goesRes.value?.data) {
        setGoesData(goesRes.value.data);
      }
      if (stereoRes.status === 'fulfilled' && stereoRes.value?.data) {
        setStereoData(stereoRes.value.data);
      }
      if (analysisRes.status === 'fulfilled' && analysisRes.value?.status) {
        setAnalysis(analysisRes.value);
      }
      if (combinedRes.status === 'fulfilled' && combinedRes.value?.cross_validation) {
        setCombined(combinedRes.value);
      }
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      if (mountedRef.current) setError('Failed to load EPAM data. Worker may be starting up.');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    const interval = setInterval(fetchAll, 3 * 60 * 1000);
    return () => { mountedRef.current = false; clearInterval(interval); };
  }, [fetchAll]);

  // Filter data by time range
  const cutoff = Date.now() - timeRange * 3600 * 1000;
  const pointsPerHour = timeRange <= 24 ? 12 : 6; // 5-min vs averaged
  const filteredEpam   = epamData.filter(p => new Date(p.time_tag).getTime() > cutoff);
  const filteredGoes   = goesData.filter(p => new Date(p.time_tag).getTime() > cutoff);
  const filteredStereo = stereoData.filter(p => new Date(p.time_tag).getTime() > cutoff);

  // Combined dataset: use latest point from ACE + GOES for comparison chart
  const combinedChartData = filteredEpam.map(ep => {
    const goesMatch = filteredGoes.find(g => Math.abs(new Date(g.time_tag).getTime() - new Date(ep.time_tag).getTime()) < 5 * 60 * 1000);
    return { ...ep, goes_ge10: goesMatch?.ge10 ?? null, goes_ge100: goesMatch?.ge100 ?? null };
  });

  if (error && epamData.length === 0) {
    return (
      <div className="bg-neutral-900/70 border border-neutral-700/60 rounded-lg p-4">
        <p className="text-amber-400 text-sm">{error}</p>
        <button onClick={fetchAll} className="mt-2 text-xs text-sky-400 hover:underline">Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-neutral-200 flex items-center gap-2">
            Energetic Particle Monitor
            <InfoTooltip content={
              <div>
                <p className="font-semibold text-white mb-1">What is EPAM?</p>
                <p className="mb-2">The Electron, Proton, and Alpha Monitor (EPAM) sits aboard the ACE spacecraft at the L1 Lagrange point — a gravitational sweet spot 1.5 million km toward the Sun. This gives Earth a ~45–60 minute early warning of what's coming.</p>
                <p className="mb-2">EPAM measures energetic particles accelerated by solar events. Under quiet conditions the 5 proton channels are widely spread on a log scale. As a CME shock approaches, it accelerates particles ahead of it — causing the channels to compress and eventually spike simultaneously when the shock passes ACE.</p>
                <p className="text-neutral-400 text-xs">Data is cross-validated with GOES (geostationary) and STEREO-A (different orbit) for confidence.</p>
              </div>
            } />
          </h3>
          <p className="text-xs text-neutral-500">ACE L1 · GOES Geostationary · STEREO-A</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && <span className="text-xs text-neutral-600">{lastUpdated.toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' })}</span>}
          <button onClick={fetchAll} className="px-2 py-1 text-xs rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-400 transition-colors">↻</button>
        </div>
      </div>

      {/* Time range selector */}
      <div className="flex gap-1 mb-3">
        {([24, 48, 168] as const).map(h => (
          <button
            key={h}
            onClick={() => setTimeRange(h)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${timeRange === h ? 'bg-sky-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:bg-neutral-700'}`}
          >
            {h === 168 ? '7 days' : `${h}h`}
          </button>
        ))}
      </div>

      {/* Status badge */}
      <StatusBadge analysis={analysis} combined={combined} loading={loading} />

      {/* Chart 1: ACE EPAM — all 5 proton channels */}
      <ChartSection
        title="ACE EPAM — Proton Flux (L1)"
        subtitle="5 energy channels · log scale · particles/cm²·s·sr·MeV"
        legend={PROTON_CHANNELS.map(c => ({ color: c.color, label: c.label, sublabel: c.energy }))}
        tooltipContent={
          <div>
            <p className="font-semibold text-white mb-1">How to read this chart</p>
            <p className="mb-2">Each coloured line is a proton energy channel. Under quiet conditions they are widely separated — blue (P1, low energy) sits much higher than red (P8, high energy). That spread is normal.</p>
            <p className="mb-2"><strong className="text-orange-300">Watch for compression:</strong> When the lines start moving toward each other — high-energy channels rising faster than low-energy — a CME shock may be approaching.</p>
            <p className="mb-2"><strong className="text-purple-300">Watch for dispersion:</strong> If red/orange lines spike before blue/green, that's velocity dispersion — faster particles arriving first from a distant source.</p>
            <p className="text-neutral-400 text-xs">ACE is at L1, ~1.5 million km sunward of Earth. Data here is ~45–60 minutes ahead of what Earth will experience.</p>
          </div>
        }
      >
        {loading ? (
          <div className="h-28 bg-neutral-800/50 rounded animate-pulse" />
        ) : (
          <Sparkline
            data={filteredEpam}
            channels={PROTON_CHANNELS as any}
            height={130}
            logScale
            showGrid
            yLabel="p/cm²·s·sr·MeV"
            lastN={filteredEpam.length}
          />
        )}
      </ChartSection>

      {/* Chart 2: Electron channels + anisotropy */}
      <ChartSection
        title="ACE EPAM — Electrons + Anisotropy"
        subtitle="Electron flux + directional streaming index"
        legend={[
          { color: '#c084fc', label: 'e⁻ 38–53 keV' },
          { color: '#e879f9', label: 'e⁻ 175–315 keV' },
          { color: '#6ee7b7', label: 'Anisotropy (×100)', sublabel: '>1.0 = beam from Sun' },
        ]}
        tooltipContent={
          <div>
            <p className="font-semibold text-white mb-1">Electrons and the anisotropy index</p>
            <p className="mb-2">Electrons travel much faster than protons, so they often arrive at ACE first — sometimes hours before any proton signal. A sudden electron spike can be the very first indication of a solar energetic particle event.</p>
            <p className="mb-2">The <strong className="text-green-300">anisotropy index</strong> (0–2 scale) measures how directional the particle flow is. A value near 0.3 is background. Values above 1.0 mean particles are arriving in a focused beam from the direction of the Sun — a strong sign of active particle acceleration at a source. Values near 2.0 mean an extremely well-focused beam.</p>
          </div>
        }
      >
        {loading ? (
          <div className="h-20 bg-neutral-800/50 rounded animate-pulse" />
        ) : (
          <Sparkline
            data={filteredEpam.map(p => ({
              ...p,
              anisotropy_scaled: p.anisotropy_index !== null ? p.anisotropy_index * 100 : null,
            }))}
            channels={[
              { key: 'e1', color: '#c084fc', label: 'e⁻ low' },
              { key: 'e2', color: '#e879f9', label: 'e⁻ high' },
              { key: 'anisotropy_scaled', color: '#6ee7b7', label: 'Aniso ×100' },
            ]}
            height={90}
            logScale
            showGrid
            lastN={filteredEpam.length}
          />
        )}
      </ChartSection>

      {/* Chart 3: GOES SEISS integral protons */}
      <ChartSection
        title="GOES SEISS — Integral Proton Flux (Geostationary)"
        subtitle="Integral thresholds ≥1 MeV → ≥500 MeV · log scale"
        legend={GOES_CHANNELS.map(c => ({ color: c.color, label: c.label, sublabel: 'alert' in c ? `S-storm at ${(c as any).alert} pfu` : undefined }))}
        tooltipContent={
          <div>
            <p className="font-semibold text-white mb-1">GOES SEISS — the cross-checker</p>
            <p className="mb-2">GOES satellites sit in geostationary orbit at 36,000 km altitude. Unlike ACE which is at L1 toward the Sun, GOES is essentially at Earth — so it sees particles that have already navigated Earth's magnetosphere.</p>
            <p className="mb-2"><strong className="text-yellow-300">Why does this matter?</strong> GOES uses a modern, well-calibrated instrument on an operational weather satellite. If GOES also shows elevated flux, you can be confident the ACE reading is real and not an aging-instrument artifact.</p>
            <p className="mb-2">Key thresholds: <strong className="text-yellow-300">≥10 MeV above 10 pfu = S1 Solar Radiation Storm.</strong> Above 100 pfu = S2. These levels can affect satellite electronics, polar radio communications, and high-altitude flights.</p>
            <p className="text-neutral-400 text-xs">Units: pfu = proton flux units = protons/(cm² s sr)</p>
          </div>
        }
      >
        {loading ? (
          <div className="h-28 bg-neutral-800/50 rounded animate-pulse" />
        ) : filteredGoes.length === 0 ? (
          <div className="h-20 flex items-center justify-center text-xs text-neutral-500">GOES data loading — check back after first cron run</div>
        ) : (
          <>
            <Sparkline
              data={filteredGoes}
              channels={GOES_CHANNELS as any}
              height={110}
              logScale
              showGrid
              yLabel="pfu"
              lastN={filteredGoes.length}
            />
            {/* S-scale alert line annotations */}
            <div className="flex gap-3 mt-1 text-xs">
              <span className="text-neutral-600">Alert levels: </span>
              <span className="text-yellow-400">S1: ≥10 MeV &gt;10 pfu</span>
              <span className="text-orange-400">S2: ≥10 MeV &gt;100 pfu</span>
              <span className="text-red-400">S3: &gt;1000 pfu</span>
            </div>
          </>
        )}
      </ChartSection>

      {/* Chart 4: ACE + GOES combined — P1 vs ≥10 MeV */}
      <ChartSection
        title="ACE + GOES Combined — Cross-Validation"
        subtitle="ACE P1 (low-energy proton) overlaid with GOES ≥10 MeV"
        legend={[
          { color: '#60a5fa', label: 'ACE P1 (47–68 keV)' },
          { color: '#fde047', label: 'GOES ≥10 MeV' },
          { color: '#f87171', label: 'ACE P8 (1–1.9 MeV)' },
          { color: '#ef4444', label: 'GOES ≥100 MeV' },
        ]}
        tooltipContent={
          <div>
            <p className="font-semibold text-white mb-1">Why compare these two?</p>
            <p className="mb-2">ACE at L1 and GOES in geostationary orbit measure from completely different locations. When both show elevated particles at the same time, the event is almost certainly real.</p>
            <p className="mb-2">The <strong className="text-blue-300">ACE P1 channel (47–68 keV)</strong> responds to the lowest-energy (most abundant) particles — it reacts first and most strongly to approaching shocks.</p>
            <p className="mb-2">The <strong className="text-yellow-300">GOES ≥10 MeV channel</strong> is the official operational threshold for declaring a Solar Radiation Storm (S1). If this exceeds 10 pfu, NOAA issues a formal alert.</p>
            <p className="text-neutral-400 text-xs">Note the energy scales are different — the two instruments cannot be directly compared numerically, only in terms of trend and elevation from background.</p>
          </div>
        }
      >
        {loading ? (
          <div className="h-28 bg-neutral-800/50 rounded animate-pulse" />
        ) : (
          <Sparkline
            data={combinedChartData}
            channels={[
              { key: 'p1',        color: '#60a5fa', label: 'ACE P1' },
              { key: 'p8',        color: '#f87171', label: 'ACE P8' },
              { key: 'goes_ge10',  color: '#fde047', label: 'GOES ≥10 MeV' },
              { key: 'goes_ge100', color: '#ef4444', label: 'GOES ≥100 MeV' },
            ]}
            height={120}
            logScale
            showGrid
            lastN={combinedChartData.length}
          />
        )}
      </ChartSection>

      {/* Chart 5: STEREO-A */}
      <ChartSection
        title="STEREO-A — Off-Axis Observer (~10–15° ahead of Earth)"
        subtitle="Solar wind plasma + energetic particles from a different vantage point"
        legend={[
          { color: '#a78bfa', label: 'Sep Low-E particles' },
          { color: '#c084fc', label: 'Sep High-E particles' },
          { color: '#34d399', label: 'Solar wind speed (÷10)' },
          { color: '#60a5fa', label: 'Bz (×10)' },
        ]}
        tooltipContent={
          <div>
            <p className="font-semibold text-white mb-1">Why STEREO-A is unique</p>
            <p className="mb-2">STEREO-A orbits the Sun in roughly the same path as Earth but is currently about 10–15° ahead of us. It sees the solar wind from a different angle — a different magnetic field line on the Parker spiral.</p>
            <p className="mb-2"><strong className="text-purple-300">If STEREO-A was elevated hours before ACE:</strong> The CME has already passed STEREO's position and is heading toward Earth. This is a strong leading indicator.</p>
            <p className="mb-2"><strong className="text-green-300">If STEREO-A and ACE are elevated simultaneously:</strong> The SEP event is broad — the solar source sent particles in a wide cone, filling the inner heliosphere.</p>
            <p className="mb-2"><strong>If ACE is elevated but STEREO-A is quiet:</strong> The event may be narrow or poorly connected to STEREO's field line. Earth may still be affected.</p>
            <p className="text-neutral-400 text-xs">STEREO data updates every ~18 minutes here due to the large file size (~23MB). Minor gaps in data are normal due to ground station coverage.</p>
          </div>
        }
      >
        {loading ? (
          <div className="h-28 bg-neutral-800/50 rounded animate-pulse" />
        ) : filteredStereo.length === 0 ? (
          <div className="h-20 flex items-center justify-center text-xs text-neutral-500">STEREO data loading — updates every ~18 minutes</div>
        ) : (
          <>
            <Sparkline
              data={filteredStereo.map(p => ({
                ...p,
                speed_scaled: p.speed ? p.speed / 10 : null,
                bz_shifted: p.bz ? (p.bz + 50) * 10 : null, // shift to positive for log scale display
              }))}
              channels={[
                { key: 'sep_lo',     color: '#a78bfa', label: 'SEP low' },
                { key: 'sep_hi',     color: '#c084fc', label: 'SEP high' },
                { key: 'speed_scaled', color: '#34d399', label: 'Speed÷10' },
              ]}
              height={110}
              logScale
              showGrid
              lastN={filteredStereo.length}
            />
            {/* STEREO solar wind summary */}
            {combined?.stereo_a?.current && (() => {
              const s = combined.stereo_a.current!;
              return (
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {[
                    { label: 'Speed', value: s.speed ? `${Math.round(s.speed)} km/s` : '—' },
                    { label: 'Density', value: s.density ? `${s.density.toFixed(1)} p/cm³` : '—' },
                    { label: 'Bt', value: s.bt ? `${s.bt.toFixed(1)} nT` : '—' },
                    { label: 'Bz', value: s.bz !== undefined ? `${s.bz.toFixed(1)} nT` : '—', highlight: (s.bz ?? 0) < -5 },
                  ].map(item => (
                    <div key={item.label} className="bg-neutral-800/60 rounded p-1.5 text-center">
                      <div className="text-xs text-neutral-500">{item.label}</div>
                      <div className={`text-xs font-mono font-semibold ${'highlight' in item && item.highlight ? 'text-red-400' : 'text-neutral-200'}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </>
        )}
      </ChartSection>

      {/* Footer caveats */}
      <div className="text-xs text-neutral-600 leading-relaxed pt-2 border-t border-neutral-800">
        <p>⚠ Elevated EPAM flux alone does not guarantee aurora — the arriving CME must have southward Bz to drive geomagnetic activity. EPAM tells you something is inbound; solar wind Bz after arrival tells you whether aurora will follow.</p>
        <p className="mt-1">Data: <a href="https://www.swpc.noaa.gov" className="text-neutral-500 hover:text-sky-400" target="_blank" rel="noopener noreferrer">NOAA SWPC</a> · ACE EPAM · GOES SEISS · STEREO-A IMPACT/PLASTIC</p>
      </div>
    </div>
  );
};

export default EPAMPanel;
// --- END OF FILE src/components/EPAMPanel.tsx ---