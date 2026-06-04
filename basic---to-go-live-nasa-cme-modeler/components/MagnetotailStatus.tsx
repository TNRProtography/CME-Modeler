// --- START OF FILE src/components/MagnetotailStatus.tsx ---
//
// Live Magnetotail Status
// Shows Earth's magnetosphere in real time with the same 2k texture from
// the CME modeller, IGRF-13 curved aurora oval, animated field lines,
// and tier markers showing what happens if the tail snaps at each loading level.

import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';

const EARTH_TEX = 'https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg';

// ---- Types ----

interface SubstormRiskDataLike {
  current: { score: number; level: string; risk_trend: string; bay_onset_flag: boolean; confidence: number | null };
  metrics: { solar_wind: { bz: number; bt: number; speed: number; density: number; dynamic_pressure_nPa: number; avg_30m_pressure_nPa: number; newell_coupling_now: number; newell_avg_30m: number; newell_avg_60m: number; southward_minutes_30m: number } };
}
interface SubstormForecastLike { status: 'QUIET' | 'WATCH' | 'LIKELY_60' | 'IMMINENT_30' | 'ONSET'; p30: number; p60: number }
interface Props { substormRiskData: SubstormRiskDataLike | null | undefined; substormForecast: SubstormForecastLike; onOpenModal: () => void }

// ---- State machine ----
type MagState = 'QUIET' | 'LOADING' | 'STRETCHED' | 'SNAPPING';
function deriveMagState(risk: SubstormRiskDataLike | null | undefined, fc: SubstormForecastLike): MagState {
  if (!risk) return 'QUIET';
  const { score, bay_onset_flag } = risk.current;
  if (bay_onset_flag || fc.status === 'ONSET') return 'SNAPPING';
  if (fc.status === 'IMMINENT_30' || fc.p30 >= 0.55) return 'STRETCHED';
  if (score >= 25 || fc.status === 'LIKELY_60' || fc.status === 'WATCH') return 'LOADING';
  return 'QUIET';
}

// ---- Oval boundary (same physics as AuroraSightings) ----
function computeOvalBoundary(risk: SubstormRiskDataLike | null | undefined): number {
  if (!risk) return -65.5;
  const n60 = risk.metrics.solar_wind.newell_avg_60m ?? 0;
  const n30 = risk.metrics.solar_wind.newell_avg_30m ?? 0;
  const newell = Math.max(n60, n30 * 0.85);
  let eq = -(65.5 - newell / 1800);
  eq = Math.max(eq, -76); eq = Math.min(eq, -44);
  if (risk.current.bay_onset_flag) eq = Math.min(eq, -47.2);
  return eq;
}
function ovalStroke(score: number): string {
  if (score >= 80) return '#f87171'; if (score >= 65) return '#fb923c'; if (score >= 50) return '#f59e0b';
  if (score >= 35) return '#a3e635'; if (score >= 20) return '#34d399'; return '#38bdf8';
}

// ---- IGRF-13 geomagnetic coordinate conversion (same as AuroraSightings) ----
const POLE_LAT_RAD = 80.65 * Math.PI / 180;
const POLE_LON_RAD = -72.68 * Math.PI / 180;

function geoToGmag(latDeg: number, lonDeg: number): number {
  const p = latDeg * Math.PI / 180, l = lonDeg * Math.PI / 180;
  const s = Math.sin(p) * Math.sin(POLE_LAT_RAD) + Math.cos(p) * Math.cos(POLE_LAT_RAD) * Math.cos(l - POLE_LON_RAD);
  return Math.asin(Math.max(-1, Math.min(1, s))) * 180 / Math.PI;
}
function gmagToGeoLat(gmagLat: number, lonDeg: number): number {
  let lo = -90, hi = 90;
  for (let i = 0; i < 48; i++) { const m = (lo + hi) / 2; if (geoToGmag(m, lonDeg) < gmagLat) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ---- Visual constants ----
const LABELS: Record<MagState, string> = { QUIET: 'Quiet', LOADING: 'Loading', STRETCHED: 'Stretched', SNAPPING: 'Reconnecting' };
const EMOJI: Record<MagState, string> = { QUIET: '🛡️', LOADING: '⚡', STRETCHED: '🔋', SNAPPING: '💥' };
const COLOURS: Record<MagState, string> = { QUIET: '#38bdf8', LOADING: '#fbbf24', STRETCHED: '#fb923c', SNAPPING: '#f87171' };

// ---- SVG layout ----
// Wider layout with Earth shifted left to give the tail room
const CX = 340, CY = 210, R = 62;
const GLOBE_PX = 220;
const VB_W = 1100, VB_H = 420;

// ---- Tier system ----
// Each tier represents "if the tail snaps at this loading level, the resulting
// substorm would produce approximately this intensity of aurora for NZ."
// Score ranges are consistent with the app's substorm score. More stored
// tail energy = stronger substorm on release = brighter, wider aurora.
//
//  Score    NZ visibility
//  0-10     Background noise, no visible aurora
//  10-25    Possible on camera from deep south SI
//  25-40    Camera aurora SI, maybe faint naked eye
//  40-55    Naked eye South Island
//  55-70    Naked eye most of NZ
//  70-85    Bright display, overhead from SI
//  85+      Vivid overhead aurora all NZ

interface Tier { label: string; score: number; colour: string; x: number; nzNote: string }

function buildTiers(): Tier[] {
  // X positions are laid out across the tail region (right of Earth)
  const baseX = CX + R * 1.4;
  const span = VB_W - baseX - 40;
  const t = (f: number) => baseX + span * f;
  return [
    { label: 'Minor',    score: 15,  colour: '#38bdf8', x: t(0.0),  nzNote: 'Camera only, deep south' },
    { label: 'Moderate', score: 30,  colour: '#34d399', x: t(0.17), nzNote: 'Camera aurora, South Island' },
    { label: 'Active',   score: 45,  colour: '#a3e635', x: t(0.34), nzNote: 'Naked eye, South Island' },
    { label: 'Strong',   score: 60,  colour: '#fbbf24', x: t(0.51), nzNote: 'Naked eye, most of NZ' },
    { label: 'Major',    score: 75,  colour: '#fb923c', x: t(0.68), nzNote: 'Bright display, overhead SI' },
    { label: 'Extreme',  score: 90,  colour: '#f87171', x: t(0.85), nzNote: 'Vivid overhead, all of NZ' },
  ];
}
const TIERS = buildTiers();

// Score -> X position (interpolated between tier markers)
function scoreToTailX(score: number): number {
  if (score <= TIERS[0].score) return CX + R * 0.8;
  if (score >= TIERS[TIERS.length - 1].score) return TIERS[TIERS.length - 1].x + 20;
  for (let i = 0; i < TIERS.length - 1; i++) {
    if (score <= TIERS[i + 1].score) {
      const frac = (score - TIERS[i].score) / (TIERS[i + 1].score - TIERS[i].score);
      return TIERS[i].x + frac * (TIERS[i + 1].x - TIERS[i].x);
    }
  }
  return TIERS[TIERS.length - 1].x;
}

// ---- Field line builders ----
function dayFieldLine(yOff: number, reach: number, comp: number): string {
  const x0 = CX - 2, xCp = CX - R * comp * reach;
  return `M ${x0} ${CY - yOff} C ${xCp} ${CY - yOff - 6}, ${xCp} ${CY + yOff + 6}, ${x0} ${CY + yOff}`;
}

function nightLine(yOff: number, tailEndX: number): string {
  const x0 = CX + 2;
  const cp1x = CX + R * 0.8;
  const cp1y = (CY - yOff) - 4 * Math.sign(yOff);
  const cp2x = CX + (tailEndX - CX) * 0.6;
  const cp2y = CY - yOff * 0.12;
  return `M ${x0} ${CY - yOff} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${tailEndX} ${CY}`;
}

function mpausePath(comp: number, tailEndX: number): string {
  const noseX = CX - R * (1.5 * comp + 0.4);
  const topY = CY - R * 2.3, botY = CY + R * 2.3;
  return [
    `M ${noseX} ${CY - R * 0.5}`,
    `C ${noseX - 14} ${topY + 30}, ${CX - R * 0.5} ${topY}, ${CX + R} ${topY + 10}`,
    `L ${tailEndX + 20} ${topY + 30}`, `L ${tailEndX + 20} ${botY - 30}`,
    `L ${CX + R} ${botY - 10}`,
    `C ${CX - R * 0.5} ${botY}, ${noseX - 14} ${botY - 30}, ${noseX} ${CY + R * 0.5}`, 'Z',
  ].join(' ');
}

function dayComp(pressure: number): number {
  return 1 - (Math.max(1, Math.min(pressure, 20)) - 1) / 30;
}

// ---- Globe renderer with IGRF-13 curved oval ----

function renderGlobe(
  canvas: HTMLCanvasElement, tex: HTMLImageElement,
  centreLon: number, ovalBound: number, ovalCol: string, isSnapping: boolean
) {
  const size = GLOBE_PX;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const tmp = document.createElement('canvas');
  tmp.width = tex.naturalWidth; tmp.height = tex.naturalHeight;
  const tCtx = tmp.getContext('2d')!;
  tCtx.drawImage(tex, 0, 0);
  const texPx = tCtx.getImageData(0, 0, tmp.width, tmp.height);

  const out = ctx.createImageData(size, size);
  const half = size / 2;
  const cLon = (centreLon * Math.PI) / 180;
  const tw = tex.naturalWidth, th = tex.naturalHeight;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - half) / half, ny = (py - half) / half;
      if (nx * nx + ny * ny > 1) continue;
      const lat = Math.asin(-ny);
      const cosLat = Math.cos(lat);
      if (cosLat < 0.0001) continue;
      const sinDlon = nx / cosLat;
      if (Math.abs(sinDlon) > 1) continue;
      const lon = Math.asin(sinDlon) + cLon;
      let u = ((lon * 180 / Math.PI) + 180) / 360;
      u = ((u % 1) + 1) % 1;
      const v = (90 - lat * 180 / Math.PI) / 180;
      const tx = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)));
      const ty = Math.min(th - 1, Math.max(0, Math.floor(v * th)));
      const si = (ty * tw + tx) * 4, di = (py * size + px) * 4;
      out.data[di] = texPx.data[si]; out.data[di+1] = texPx.data[si+1];
      out.data[di+2] = texPx.data[si+2]; out.data[di+3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  // Specular + limb darkening
  ctx.globalCompositeOperation = 'source-atop';
  const grad = ctx.createRadialGradient(half * 0.65, half * 0.55, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,0.13)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  grad.addColorStop(0.85, 'rgba(0,0,20,0.18)');
  grad.addColorStop(1, 'rgba(0,0,20,0.45)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);

  // Terminator
  ctx.globalCompositeOperation = 'source-atop';
  const term = ctx.createLinearGradient(half - 8, 0, half + 20, 0);
  term.addColorStop(0, 'rgba(0,0,0,0)');
  term.addColorStop(0.5, 'rgba(0,0,15,0.12)');
  term.addColorStop(1, 'rgba(0,0,15,0.32)');
  ctx.fillStyle = term; ctx.fillRect(0, 0, size, size);

  // ---- IGRF-13 curved aurora oval ----
  // Build ring of geographic points at the geomagnetic boundary latitude,
  // project each orthographically onto the canvas, draw as a smooth curve.
  const ovalPts: { x: number; y: number; vis: boolean }[] = [];
  for (let lon = 0; lon < 360; lon += 5) {
    const normLon = lon <= 180 ? lon : lon - 360;
    const geoLat = gmagToGeoLat(ovalBound, normLon);
    const latR = (geoLat * Math.PI) / 180;
    const dlonR = ((normLon - centreLon) * Math.PI) / 180;
    // Orthographic visibility check: point is on the visible hemisphere
    // if cos(c) > 0, where cos(c) = sin(lat)*sin(cLat) + cos(lat)*cos(cLat)*cos(dlon)
    // For our centred view (cLat = 0 for equatorial view), this simplifies to cos(lat)*cos(dlon) > 0
    const cosC = Math.cos(latR) * Math.cos(dlonR);
    const px = half + half * Math.cos(latR) * Math.sin(dlonR);
    const py = half - half * Math.sin(latR);
    ovalPts.push({ x: px, y: py, vis: cosC > 0 });
  }

  // Draw front (visible) arc
  ctx.globalCompositeOperation = 'source-atop';
  const thickness = isSnapping ? 4.5 : 2.5;
  ctx.strokeStyle = ovalCol;
  ctx.lineWidth = thickness;
  ctx.globalAlpha = isSnapping ? 0.95 : 0.7;
  ctx.setLineDash([]);

  // Front arc
  ctx.beginPath();
  let started = false;
  for (const pt of ovalPts) {
    if (pt.vis) {
      if (!started) { ctx.moveTo(pt.x, pt.y); started = true; }
      else ctx.lineTo(pt.x, pt.y);
    } else { started = false; }
  }
  ctx.stroke();

  // Glow pass
  ctx.globalAlpha = isSnapping ? 0.35 : 0.12;
  ctx.lineWidth = thickness + 5;
  ctx.filter = 'blur(3px)';
  ctx.beginPath(); started = false;
  for (const pt of ovalPts) {
    if (pt.vis) { if (!started) { ctx.moveTo(pt.x, pt.y); started = true; } else ctx.lineTo(pt.x, pt.y); }
    else { started = false; }
  }
  ctx.stroke();
  ctx.filter = 'none';

  // Back arc (dashed, dim)
  ctx.globalAlpha = 0.18;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 5]);
  ctx.beginPath(); started = false;
  for (const pt of ovalPts) {
    if (!pt.vis) { if (!started) { ctx.moveTo(pt.x, pt.y); started = true; } else ctx.lineTo(pt.x, pt.y); }
    else { started = false; }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // NZ marker
  const nzLatR = (-43.5 * Math.PI) / 180;
  const nzDlon = ((172 - centreLon) * Math.PI) / 180;
  const nzX = half + half * Math.cos(nzLatR) * Math.sin(nzDlon);
  const nzY = half - half * Math.sin(nzLatR);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.9; ctx.fillStyle = '#5fb47a';
  ctx.beginPath(); ctx.arc(nzX, nzY, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.45; ctx.strokeStyle = '#5fb47a'; ctx.lineWidth = 0.8;
  ctx.beginPath(); ctx.arc(nzX, nzY, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
}

// ======================================================================
const MagnetotailStatus: React.FC<Props> = ({ substormRiskData, substormForecast, onOpenModal }) => {
  const magState = deriveMagState(substormRiskData, substormForecast);
  const score = substormRiskData?.current?.score ?? 0;
  const bz = substormRiskData?.metrics?.solar_wind?.bz ?? 0;
  const pressure = substormRiskData?.metrics?.solar_wind?.dynamic_pressure_nPa ?? 2;
  const ovalBound = computeOvalBoundary(substormRiskData);
  const ovalCol = ovalStroke(score);
  const comp = dayComp(pressure);
  const isSnapping = magState === 'SNAPPING';

  // The tail end X is driven by score, mapped to tier positions
  const tailEndX = isSnapping ? scoreToTailX(Math.max(score, 40)) : scoreToTailX(score);

  // Globe
  const [earthUrl, setEarthUrl] = useState<string | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const texImgRef = useRef<HTMLImageElement | null>(null);
  const texLoadedRef = useRef(false);

  useEffect(() => {
    function paint() {
      if (!texImgRef.current || !texLoadedRef.current) return;
      if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
      renderGlobe(offscreenRef.current, texImgRef.current, 172, ovalBound, ovalCol, isSnapping);
      setEarthUrl(offscreenRef.current.toDataURL());
    }
    if (texLoadedRef.current) { paint(); }
    else if (!texImgRef.current) {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = EARTH_TEX;
      texImgRef.current = img;
      img.onload = () => { texLoadedRef.current = true; paint(); };
    }
  }, [ovalBound, ovalCol, isSnapping]);

  // Snap tick
  const [snapTick, setSnapTick] = useState(0);
  useEffect(() => {
    if (!isSnapping) { setSnapTick(0); return; }
    const id = setInterval(() => setSnapTick(t => t + 1), 3000);
    return () => clearInterval(id);
  }, [isSnapping]);

  // Tooltip
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const showTip = useCallback((e: React.MouseEvent, text: string) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    setTip({ text, x: e.clientX - r.left, y: e.clientY - r.top - 14 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  // SVG paths
  const dayLines = useMemo(() => [
    dayFieldLine(R * 0.42, 2.0, comp), dayFieldLine(R * 0.58, 2.4, comp), dayFieldLine(R * 0.74, 2.8, comp),
  ], [comp]);

  const nightTop = useMemo(() => [
    nightLine(R * 0.42, tailEndX), nightLine(R * 0.58, tailEndX), nightLine(R * 0.74, tailEndX),
  ], [tailEndX]);
  const nightBot = useMemo(() => [
    nightLine(-R * 0.42, tailEndX), nightLine(-R * 0.58, tailEndX), nightLine(-R * 0.74, tailEndX),
  ], [tailEndX]);

  const mpause = useMemo(() => mpausePath(comp, tailEndX), [comp, tailEndX]);

  const tailLabel = isSnapping ? 'Reconnection' : score >= 60 ? 'Highly stretched' : score >= 30 ? 'Stretching' : 'Relaxed';

  // Which tier are we past?
  const currentTierIdx = useMemo(() => {
    for (let i = TIERS.length - 1; i >= 0; i--) { if (score >= TIERS[i].score) return i; }
    return -1;
  }, [score]);

  const stateDesc: Record<MagState, string> = {
    QUIET: 'The magnetosphere is relaxed. Solar wind pressure is low and the tail is at its normal length. No substorm activity expected.',
    LOADING: 'Southward Bz is feeding energy into the magnetotail. The night-side field is starting to stretch. Watch for further development.',
    STRETCHED: 'The tail is highly stretched and loaded with stored energy. A reconnection event could fire in the next 15 to 30 minutes.',
    SNAPPING: 'Reconnection in progress! Field lines are snapping back toward Earth, funnelling particles onto the poles and lighting the aurora.',
  };

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col overflow-hidden">
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-white">Magnetotail Status</h3>
          <button onClick={onOpenModal}
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
            title="About Magnetotail Status">?</button>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <span className="text-2xl">{EMOJI[magState]}</span>
            <span className="text-lg font-bold" style={{ color: COLOURS[magState] }}>{LABELS[magState]}</span>
          </div>
          <div className="text-xs text-neutral-400 mt-0.5">
            Tail: {tailLabel} · Bz: {bz.toFixed(1)} nT · Pressure: {pressure.toFixed(1)} nPa
          </div>
        </div>
      </div>

      <div className="relative w-full mt-2" style={{ paddingBottom: `${(VB_H / VB_W) * 100}%`, minHeight: 240 }}>
        <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
          <style>{`
            @keyframes mtFlow { to { stroke-dashoffset: -160; } }
            @keyframes mtSnap  { 0% { opacity: 0; transform: scale(.5); } 35% { opacity: 1; transform: scale(1.1); } 60% { opacity: 0; transform: scale(1.6); } 100% { opacity: 0; } }
            @keyframes mtEject  { 0%,28% { transform: translateX(0); opacity: 0; } 40% { opacity: .8; } 100% { transform: translateX(120px); opacity: 0; } }
            @keyframes mtPrecip { 0%,30% { opacity: 0; } 42% { opacity: .75; } 72% { opacity: .2; } 100% { opacity: 0; } }
            @keyframes mtAtmo   { 0%,100% { opacity: .06; } 50% { opacity: .22; } }
            @keyframes mtGlow   { 0%,100% { opacity: .25; } 50% { opacity: 1; } }
            @keyframes mtTierPulse { 0%,100% { opacity: .5; } 50% { opacity: 1; } }
            .mt-flow { animation: mtFlow 6s linear infinite; }
            .mt-snap { animation: mtSnap 3s ease-out infinite; transform-box: fill-box; transform-origin: center; }
            .mt-eject { animation: mtEject 3s ease-in infinite; transform-box: view-box; transform-origin: 0 0; }
            .mt-precip { animation: mtPrecip 3s ease-in-out infinite; }
            .mt-atmo { animation: mtAtmo 3s ease-in-out infinite; }
            .mt-glow { animation: mtGlow 3s ease-in-out infinite; }
            .mt-tier-pulse { animation: mtTierPulse 2s ease-in-out infinite; }
            .mt-h { pointer-events: all; cursor: help; }
            .mt-h:hover { filter: brightness(1.25); }
            .mt-field-transition { transition: d 1s ease-out; }
            @media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation: none !important; } }
          `}</style>

          <defs>
            <radialGradient id="mt-sG" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f0bd6a" /><stop offset="60%" stopColor="#e0973a" /><stop offset="100%" stopColor="#c2701f" />
            </radialGradient>
            <radialGradient id="mt-sF" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(240,189,106,0.25)" /><stop offset="100%" stopColor="rgba(240,189,106,0)" />
            </radialGradient>
            <radialGradient id="mt-aG" cx="50%" cy="50%" r="50%">
              <stop offset="68%" stopColor="rgba(56,189,248,0)" /><stop offset="86%" stopColor="rgba(56,189,248,0.09)" /><stop offset="100%" stopColor="rgba(56,189,248,0.02)" />
            </radialGradient>
            <filter id="mt-gl"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
            <clipPath id="mt-ec"><circle cx={CX} cy={CY} r={R} /></clipPath>
          </defs>

          {/* Stars */}
          {useMemo(() => {
            const s: React.ReactNode[] = [];
            for (let i = 0; i < 65; i++) s.push(<circle key={i} cx={Math.random()*VB_W} cy={Math.random()*VB_H} r={0.4+Math.random()*0.8} fill="#fff" opacity={0.12+Math.random()*0.25} />);
            return <g>{s}</g>;
          }, [])}

          {/* Sun */}
          <g className="mt-h" onMouseMove={e => showTip(e, 'The Sun. Solar wind flows from here toward Earth, carrying magnetic field and charged particles.')} onMouseLeave={hideTip}>
            <circle cx={35} cy={CY} r={80} fill="url(#mt-sF)" />
            <circle cx={35} cy={CY} r={36} fill="url(#mt-sG)" />
          </g>

          {/* Solar wind */}
          <g opacity="0.3">
            {[CY-60, CY-30, CY, CY+30, CY+60].map((y,i) => (
              <line key={i} x1={85} y1={y} x2={CX-R*(1.5*comp+0.6)} y2={CY+(y-CY)*0.4}
                stroke="#e0973a" strokeWidth="1" strokeDasharray="3 8" className="mt-flow"
                opacity={0.5-Math.abs(y-CY)/300} />
            ))}
          </g>

          {/* Magnetopause */}
          <path d={mpause} fill="none" stroke="#aeb7c6" strokeWidth="0.8" opacity="0.15"
            className="mt-h" onMouseMove={e => showTip(e, 'Magnetopause: the outer boundary of Earth\'s magnetic shield. Solar wind pushes the day side in while the tail stretches out behind.')} onMouseLeave={hideTip} />

          {/* Tail lobe shading */}
          <rect x={CX+R*0.3} y={CY-R*1.4} width={Math.max(0, tailEndX-CX)} height={R*1.2} fill="#fff" opacity="0.012" rx="4" />
          <rect x={CX+R*0.3} y={CY+R*0.2} width={Math.max(0, tailEndX-CX)} height={R*1.2} fill="#fff" opacity="0.012" rx="4" />

          {/* ---- Tier markers ---- */}
          {TIERS.map((tier, i) => {
            const isPast = i <= currentTierIdx;
            const isCurrent = i === currentTierIdx;
            const isNext = i === currentTierIdx + 1;
            return (
              <g key={tier.label} className="mt-h"
                onMouseMove={e => showTip(e, `${tier.label} (score ${tier.score}+): If the tail snaps at this loading level, expect ${tier.nzNote.toLowerCase()}.`)}
                onMouseLeave={hideTip}>
                <line x1={tier.x} y1={CY - R * 1.8} x2={tier.x} y2={CY + R * 1.8}
                  stroke={tier.colour} strokeWidth={isCurrent ? 1.4 : 0.7}
                  strokeDasharray={isPast ? 'none' : '3 6'}
                  opacity={isPast ? 0.5 : isNext ? 0.35 : 0.15}
                  className={isCurrent ? 'mt-tier-pulse' : ''} />
                <text x={tier.x} y={CY - R * 1.9} textAnchor="middle" fill={tier.colour}
                  fontSize="8" fontWeight={isCurrent ? '600' : '400'} letterSpacing="0.06em"
                  opacity={isPast ? 0.8 : isNext ? 0.5 : 0.25}
                  style={{ fontFamily: 'system-ui, sans-serif', textTransform: 'uppercase' as const }}>
                  {tier.label}
                </text>
                {isCurrent && (
                  <text x={tier.x} y={CY + R * 2.1} textAnchor="middle" fill={tier.colour}
                    fontSize="7" opacity="0.6" style={{ fontFamily: 'system-ui, sans-serif' }}>
                    {tier.nzNote}
                  </text>
                )}
              </g>
            );
          })}

          {/* Day-side field lines */}
          <g className="mt-h"
            onMouseMove={e => showTip(e, pressure > 5
              ? `Day-side field, compressed by ${pressure.toFixed(1)} nPa of solar wind pressure. More compression means more energy available.`
              : `Day-side field under quiet pressure (${pressure.toFixed(1)} nPa). Shield is holding comfortably.`
            )} onMouseLeave={hideTip}>
            {dayLines.map((d, i) => <path key={i} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.3" opacity={0.7-i*0.12} />)}
          </g>

          {/* Inner dipole */}
          <path d={`M ${CX-R*0.35} ${CY-R*0.35} C ${CX-R*0.8} ${CY-R*0.15}, ${CX-R*0.8} ${CY+R*0.15}, ${CX-R*0.35} ${CY+R*0.35}`} fill="none" stroke="#aeb7c6" strokeWidth="1.2" opacity="0.55" />
          <path d={`M ${CX+R*0.35} ${CY-R*0.35} C ${CX+R*0.8} ${CY-R*0.15}, ${CX+R*0.8} ${CY+R*0.15}, ${CX+R*0.35} ${CY+R*0.35}`} fill="none" stroke="#aeb7c6" strokeWidth="1.2" opacity="0.55" />

          {/* Night-side field */}
          <g className="mt-h"
            onMouseMove={e => showTip(e,
              isSnapping ? 'Reconnection! The tail has snapped. Stored energy is being released, sending particles down field lines toward the poles to light the aurora.'
              : magState === 'STRETCHED' ? 'The tail is highly stretched and full of stored energy. It can snap at any moment, triggering a substorm and sudden aurora brightening.'
              : magState === 'LOADING' ? `Southward Bz (${bz.toFixed(1)} nT) is driving energy into the tail. The more it stretches, the bigger the release when it snaps.`
              : 'Night-side field at normal length. No significant energy loading right now.'
            )} onMouseLeave={hideTip}>
            {nightTop.map((d, i) => <path key={`t${i}`} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.3" opacity={0.7-i*0.12} />)}
            {nightBot.map((d, i) => <path key={`b${i}`} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.3" opacity={0.7-i*0.12} />)}
          </g>

          {/* Neutral sheet */}
          <line x1={CX+R*0.5} y1={CY} x2={tailEndX+10} y2={CY} stroke="#aeb7c6" strokeWidth="0.6" strokeDasharray="2 5" opacity="0.2" />

          {/* Reconnection X flash */}
          {isSnapping && (() => {
            const xx = tailEndX - 20;
            return (
              <g className="mt-snap" style={{ transformOrigin: `${xx}px ${CY}px` }}>
                <line x1={xx-10} y1={CY-10} x2={xx+10} y2={CY+10} stroke="#d2664a" strokeWidth="2.5" strokeLinecap="round" />
                <line x1={xx+10} y1={CY-10} x2={xx-10} y2={CY+10} stroke="#d2664a" strokeWidth="2.5" strokeLinecap="round" />
              </g>
            );
          })()}

          {/* Plasmoid */}
          {isSnapping && <ellipse cx={tailEndX+10} cy={CY} rx={12} ry={18} fill="none" stroke="#aeb7c6" strokeWidth="1.4" className="mt-eject" />}

          {/* Particle precipitation */}
          {isSnapping && (
            <g className="mt-precip" filter="url(#mt-gl)">
              <path d={`M ${tailEndX-40} ${CY-8} C ${CX+R*0.9} ${CY-R*0.7}, ${CX+R*0.4} ${CY-R*0.85}, ${CX+4} ${CY-R*0.7}`} fill="none" stroke="#5fb47a" strokeWidth="1.4" strokeDasharray="2 5" />
              <path d={`M ${tailEndX-40} ${CY+8} C ${CX+R*0.9} ${CY+R*0.7}, ${CX+R*0.4} ${CY+R*0.85}, ${CX+4} ${CY+R*0.7}`} fill="none" stroke="#5fb47a" strokeWidth="1.4" strokeDasharray="2 5" />
            </g>
          )}

          {/* Day-side reconnection X */}
          {bz < -3 && (
            <g opacity={Math.min(1, Math.abs(bz) / 10) * 0.7}>
              <line x1={CX-R-12} y1={CY-8} x2={CX-R+4} y2={CY+8} stroke="#d2664a" strokeWidth="1.8" strokeLinecap="round" />
              <line x1={CX-R+4}  y1={CY-8} x2={CX-R-12} y2={CY+8} stroke="#d2664a" strokeWidth="1.8" strokeLinecap="round" />
            </g>
          )}

          {/* Earth globe */}
          <g className="mt-h"
            onMouseMove={e => showTip(e, 'Earth, rotated so New Zealand faces you. The coloured arc near the south pole is the aurora oval, curved by the offset between geographic and geomagnetic poles (same projection as the sightings map).')}
            onMouseLeave={hideTip}>
            <circle cx={CX} cy={CY} r={R + 10} fill="url(#mt-aG)" className={isSnapping ? 'mt-atmo' : ''} style={isSnapping ? undefined : { opacity: 0.06 }} />
            {earthUrl ? (
              <image href={earthUrl} x={CX-R} y={CY-R} width={R*2} height={R*2} clipPath="url(#mt-ec)" style={{ imageRendering: 'auto' }} />
            ) : (
              <circle cx={CX} cy={CY} r={R} fill="#1a3a5c" />
            )}
          </g>

          {/* Labels */}
          <text x={35} y={CY-52} textAnchor="middle" fill="#9aa2b1" fontSize="9" fontWeight="500" letterSpacing="0.12em" style={{ textTransform: 'uppercase' as const, fontFamily: 'system-ui, sans-serif' }}>Sun</text>
          <text x={CX} y={CY+R+24} textAnchor="middle" fill="#9aa2b1" fontSize="9" fontWeight="500" letterSpacing="0.12em" style={{ textTransform: 'uppercase' as const, fontFamily: 'system-ui, sans-serif' }}>Earth</text>
          {isSnapping && (
            <text x={tailEndX-20} y={CY-24} textAnchor="middle" fill="#d2664a" fontSize="9" fontWeight="600" letterSpacing="0.08em" className="mt-snap" style={{ fontFamily: 'system-ui, sans-serif' }}>SNAP</text>
          )}
          {bz < -3 && (
            <text x={CX-R-4} y={CY+24} textAnchor="middle" fill="#d2664a" fontSize="7.5" fontWeight="500" opacity="0.7" style={{ fontFamily: 'system-ui, sans-serif' }}>Bz South</text>
          )}

          {/* Tooltip */}
          {tip && (
            <foreignObject x={Math.min(tip.x, VB_W - 290)} y={Math.max(tip.y - 55, 4)} width="280" height="90" style={{ pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(10,14,22,0.95)', border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8, padding: '8px 10px', fontSize: 11, lineHeight: 1.45, color: '#d4d8e0',
                fontFamily: 'system-ui, sans-serif', backdropFilter: 'blur(8px)', maxWidth: 260,
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}>{tip.text}</div>
            </foreignObject>
          )}
        </svg>
      </div>

      {/* Status bar */}
      <div className="mt-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 px-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
          style={{ borderColor: COLOURS[magState] + '40', background: COLOURS[magState] + '10' }}>
          <div className="w-2.5 h-2.5 rounded-full"
            style={{ background: COLOURS[magState], boxShadow: `0 0 6px ${COLOURS[magState]}80`,
              animation: isSnapping ? 'mtGlow 1.5s ease-in-out infinite' : undefined }} />
          <span className="text-sm font-semibold" style={{ color: COLOURS[magState] }}>{LABELS[magState]}</span>
        </div>
        <p className="text-xs text-neutral-400 leading-relaxed flex-1">{stateDesc[magState]}</p>
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 px-1 text-[10px] text-neutral-500 border-t border-neutral-800 pt-3">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#aeb7c6" strokeWidth="1.3" /></svg>
          Field lines
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="8"><path d="M0 4 L16 4" stroke="#aeb7c6" strokeWidth="0.8" strokeDasharray="2 4" /></svg>
          Magnetopause
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="12" height="8"><line x1="1" y1="1" x2="11" y2="7" stroke="#d2664a" strokeWidth="1.5" /><line x1="11" y1="1" x2="1" y2="7" stroke="#d2664a" strokeWidth="1.5" /></svg>
          Reconnection
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="8"><path d="M0 5 Q 8 2 16 5" fill="none" stroke={ovalCol} strokeWidth="2" /></svg>
          Aurora oval
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="8" height="8"><circle cx="4" cy="4" r="2.5" fill="#5fb47a" /></svg>
          NZ
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="8"><line x1="8" y1="0" x2="8" y2="8" stroke="#fbbf24" strokeWidth="0.8" strokeDasharray="2 3" /></svg>
          Snap intensity tiers
        </span>
      </div>
    </div>
  );
};

export default MagnetotailStatus;
// --- END OF FILE src/components/MagnetotailStatus.tsx ---
