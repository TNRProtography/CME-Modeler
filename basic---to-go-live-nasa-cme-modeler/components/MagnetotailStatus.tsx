// --- START OF FILE src/components/MagnetotailStatus.tsx ---
//
// Live Magnetotail Status
// Shows Earth's magnetosphere in real time: the day-side field compressed
// by solar wind, the night-side tail stretching under energy loading, and
// the snap/reconnection when the substorm model predicts onset.
//
// Earth is rendered from the same 2k texture used in SimulationCanvas,
// orthographically projected onto a canvas and centred on New Zealand.

import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';

// Same texture as the CME modeller page
const EARTH_TEX = 'https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg';

// ---- Types (compatible with the project's SubstormRiskData / SubstormForecast) ----

interface SubstormRiskDataLike {
  current: {
    score: number;
    level: string;
    risk_trend: string;
    bay_onset_flag: boolean;
    confidence: number | null;
  };
  metrics: {
    solar_wind: {
      bz: number;
      bt: number;
      speed: number;
      density: number;
      dynamic_pressure_nPa: number;
      avg_30m_pressure_nPa: number;
      newell_coupling_now: number;
      newell_avg_30m: number;
      newell_avg_60m: number;
      southward_minutes_30m: number;
    };
  };
}

interface SubstormForecastLike {
  status: 'QUIET' | 'WATCH' | 'LIKELY_60' | 'IMMINENT_30' | 'ONSET';
  p30: number;
  p60: number;
}

interface Props {
  substormRiskData: SubstormRiskDataLike | null | undefined;
  substormForecast: SubstormForecastLike;
  onOpenModal: () => void;
}

// ---- State machine ----

type MagState = 'QUIET' | 'LOADING' | 'STRETCHED' | 'SNAPPING';

function deriveMagState(
  risk: SubstormRiskDataLike | null | undefined,
  forecast: SubstormForecastLike
): MagState {
  if (!risk) return 'QUIET';
  const { score, bay_onset_flag } = risk.current;
  const { status, p30 } = forecast;
  if (bay_onset_flag || status === 'ONSET') return 'SNAPPING';
  if (status === 'IMMINENT_30' || p30 >= 0.55) return 'STRETCHED';
  if (score >= 25 || status === 'LIKELY_60' || status === 'WATCH') return 'LOADING';
  return 'QUIET';
}

// ---- Oval boundary (same physics as AuroraSightings) ----

function computeOvalBoundary(risk: SubstormRiskDataLike | null | undefined): number {
  if (!risk) return -65.5;
  const n60 = risk.metrics.solar_wind.newell_avg_60m ?? 0;
  const n30 = risk.metrics.solar_wind.newell_avg_30m ?? 0;
  const newell = Math.max(n60, n30 * 0.85);
  let eq = -(65.5 - newell / 1800);
  eq = Math.max(eq, -76);
  eq = Math.min(eq, -44);
  if (risk.current.bay_onset_flag) eq = Math.min(eq, -47.2);
  return eq;
}

function ovalStroke(score: number): string {
  if (score >= 80) return '#f87171';
  if (score >= 65) return '#fb923c';
  if (score >= 50) return '#f59e0b';
  if (score >= 35) return '#a3e635';
  if (score >= 20) return '#34d399';
  return '#38bdf8';
}

// ---- Visual helpers ----

const LABELS: Record<MagState, string> = {
  QUIET: 'Quiet', LOADING: 'Loading', STRETCHED: 'Stretched', SNAPPING: 'Reconnecting',
};
const EMOJI: Record<MagState, string> = {
  QUIET: '🛡️', LOADING: '⚡', STRETCHED: '🔋', SNAPPING: '💥',
};
const COLOURS: Record<MagState, string> = {
  QUIET: '#38bdf8', LOADING: '#fbbf24', STRETCHED: '#fb923c', SNAPPING: '#f87171',
};

// ---- SVG layout constants ----

const CX = 420, CY = 210, R = 58;
const GLOBE_PX = 200; // pixel resolution of the rendered globe canvas

// ---- Day-side field line (closed loop from pole to pole, curving toward the sun) ----

function dayFieldLine(yOff: number, reach: number, comp: number): string {
  const x0 = CX - 2;
  const xCp = CX - R * comp * reach;
  return `M ${x0} ${CY - yOff} C ${xCp} ${CY - yOff - 6}, ${xCp} ${CY + yOff + 6}, ${x0} ${CY + yOff}`;
}

// ---- Night-side field line (open, stretching into the tail) ----

function nightLine(yOff: number, stretch: number): string {
  const x0 = CX + 2;
  const tailLen = R * 2.4 * stretch;
  const xEnd = CX + tailLen;
  const cp1x = CX + R * 0.8;
  const cp1y = (CY - yOff) + (Math.abs(yOff) < R * 0.6 ? -4 * Math.sign(yOff) : -8 * Math.sign(yOff));
  const cp2x = CX + tailLen * 0.6;
  const cp2y = CY - yOff * 0.15;
  return `M ${x0} ${CY - yOff} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${xEnd} ${CY}`;
}

// ---- Magnetopause boundary ----

function mpausePath(comp: number, stretch: number): string {
  const noseX = CX - R * (1.5 * comp + 0.4);
  const tailX = CX + R * 3.2 * stretch;
  const topY = CY - R * 2.2, botY = CY + R * 2.2;
  return [
    `M ${noseX} ${CY - R * 0.5}`,
    `C ${noseX - 14} ${topY + 30}, ${CX - R * 0.5} ${topY}, ${CX + R} ${topY + 10}`,
    `L ${tailX} ${topY + 30}`,
    `L ${tailX} ${botY - 30}`,
    `L ${CX + R} ${botY - 10}`,
    `C ${CX - R * 0.5} ${botY}, ${noseX - 14} ${botY - 30}, ${noseX} ${CY + R * 0.5}`,
    'Z',
  ].join(' ');
}

// ---- Oval arc on the globe ----

function ovalArc(gmagBound: number, front: boolean): string {
  const frac = Math.abs(gmagBound) / 90;
  const yPos = CY + R * frac;
  const hw = R * Math.cos(Math.asin(Math.min(frac, 0.999))) * 0.95;
  if (front)
    return `M ${CX - hw} ${yPos} A ${hw} ${6 + (1 - frac) * 8} 0 0 0 ${CX + hw} ${yPos}`;
  return `M ${CX - hw} ${yPos} A ${hw} ${6 + (1 - frac) * 8} 0 0 1 ${CX + hw} ${yPos}`;
}

// ---- Pressure / stretch helpers ----

function dayComp(pressure: number): number {
  const p = Math.max(1, Math.min(pressure, 20));
  return 1 - (p - 1) / 30;
}

function tailStretch(score: number, bz: number): number {
  const bzF = bz < 0 ? Math.min(Math.abs(bz) / 15, 1) : 0;
  const sF = Math.min(score / 80, 1);
  return 1 + 0.55 * Math.max(bzF, sF);
}

// ---- Earth globe renderer (orthographic projection, centred on NZ) ----

function renderGlobe(
  canvas: HTMLCanvasElement,
  tex: HTMLImageElement,
  centreLonDeg: number,
  ovalBoundaryGmag: number,
  ovalCol: string,
  isSnapping: boolean
) {
  const size = GLOBE_PX;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Read texture pixels
  const tmp = document.createElement('canvas');
  tmp.width = tex.naturalWidth;
  tmp.height = tex.naturalHeight;
  const tCtx = tmp.getContext('2d')!;
  tCtx.drawImage(tex, 0, 0);
  const texPx = tCtx.getImageData(0, 0, tmp.width, tmp.height);

  const out = ctx.createImageData(size, size);
  const half = size / 2;
  const cLon = (centreLonDeg * Math.PI) / 180;
  const tw = tex.naturalWidth, th = tex.naturalHeight;

  // Orthographic projection
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - half) / half;
      const ny = (py - half) / half;
      if (nx * nx + ny * ny > 1) continue;

      const lat = Math.asin(-ny);
      const cosLat = Math.cos(lat);
      if (cosLat < 0.0001) continue;
      const sinDlon = nx / cosLat;
      if (Math.abs(sinDlon) > 1) continue;
      const lon = Math.asin(sinDlon) + cLon;

      // Texture UV
      let u = ((lon * 180 / Math.PI) + 180) / 360;
      u = ((u % 1) + 1) % 1;
      const v = (90 - lat * 180 / Math.PI) / 180;

      const tx = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)));
      const ty = Math.min(th - 1, Math.max(0, Math.floor(v * th)));

      const si = (ty * tw + tx) * 4;
      const di = (py * size + px) * 4;
      out.data[di]     = texPx.data[si];
      out.data[di + 1] = texPx.data[si + 1];
      out.data[di + 2] = texPx.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  // Specular highlight + limb darkening (single radial gradient overlay)
  ctx.globalCompositeOperation = 'source-atop';
  const grad = ctx.createRadialGradient(half * 0.65, half * 0.55, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,0.13)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  grad.addColorStop(0.85, 'rgba(0,0,20,0.18)');
  grad.addColorStop(1, 'rgba(0,0,20,0.45)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Day/night terminator: darken the right half (night side)
  ctx.globalCompositeOperation = 'source-atop';
  const term = ctx.createLinearGradient(half - 8, 0, half + 20, 0);
  term.addColorStop(0, 'rgba(0,0,0,0)');
  term.addColorStop(0.5, 'rgba(0,0,15,0.12)');
  term.addColorStop(1, 'rgba(0,0,15,0.32)');
  ctx.fillStyle = term;
  ctx.fillRect(0, 0, size, size);

  // Draw aurora oval directly onto the globe canvas
  ctx.globalCompositeOperation = 'source-atop';
  const ovalFrac = Math.abs(ovalBoundaryGmag) / 90;
  const ovalY = half + half * ovalFrac;
  const ovalHW = half * Math.cos(Math.asin(Math.min(ovalFrac, 0.999))) * 0.92;
  const ovalThickness = isSnapping ? 4 : 2.2;

  ctx.strokeStyle = ovalCol;
  ctx.lineWidth = ovalThickness;
  ctx.globalAlpha = isSnapping ? 0.95 : 0.7;
  ctx.beginPath();
  ctx.ellipse(half, ovalY, ovalHW, 4 + (1 - ovalFrac) * 6, 0, Math.PI, 2 * Math.PI);
  ctx.stroke();

  // Glow pass
  ctx.globalAlpha = isSnapping ? 0.4 : 0.15;
  ctx.lineWidth = ovalThickness + 5;
  ctx.filter = 'blur(3px)';
  ctx.beginPath();
  ctx.ellipse(half, ovalY, ovalHW, 4 + (1 - ovalFrac) * 6, 0, Math.PI, 2 * Math.PI);
  ctx.stroke();
  ctx.filter = 'none';

  // Back-side oval (dimmer, dashed)
  ctx.globalAlpha = 0.2;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 5]);
  ctx.beginPath();
  ctx.ellipse(half, ovalY, ovalHW, 4 + (1 - ovalFrac) * 6, 0, 0, Math.PI);
  ctx.stroke();
  ctx.setLineDash([]);

  // NZ marker dot
  const nzLat = -43.5, nzLon = 172;
  const nzLatR = (nzLat * Math.PI) / 180;
  const nzDlon = ((nzLon - centreLonDeg) * Math.PI) / 180;
  const nzX = half + half * Math.cos(nzLatR) * Math.sin(nzDlon);
  const nzY = half - half * Math.sin(nzLatR);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#5fb47a';
  ctx.beginPath();
  ctx.arc(nzX, nzY, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = '#5fb47a';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.arc(nzX, nzY, 6.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ======================================================================
// Component
// ======================================================================

const MagnetotailStatus: React.FC<Props> = ({
  substormRiskData,
  substormForecast,
  onOpenModal,
}) => {
  const magState = deriveMagState(substormRiskData, substormForecast);
  const score = substormRiskData?.current?.score ?? 0;
  const bz = substormRiskData?.metrics?.solar_wind?.bz ?? 0;
  const pressure = substormRiskData?.metrics?.solar_wind?.dynamic_pressure_nPa ?? 2;
  const ovalBound = computeOvalBoundary(substormRiskData);
  const ovalCol = ovalStroke(score);
  const comp = dayComp(pressure);
  const stretch = magState === 'SNAPPING' ? 1.0 : tailStretch(score, bz);
  const isSnapping = magState === 'SNAPPING';

  // Globe rendering
  const [earthUrl, setEarthUrl] = useState<string | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const texImgRef = useRef<HTMLImageElement | null>(null);
  const texLoadedRef = useRef(false);

  // Load the texture once, then re-render whenever data changes
  useEffect(() => {
    function paint() {
      if (!texImgRef.current || !texLoadedRef.current) return;
      if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
      renderGlobe(offscreenRef.current, texImgRef.current, 172, ovalBound, ovalCol, isSnapping);
      setEarthUrl(offscreenRef.current.toDataURL());
    }

    if (texLoadedRef.current) {
      // Texture already cached, just re-render
      paint();
    } else if (!texImgRef.current) {
      // First mount: load the texture
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = EARTH_TEX;
      texImgRef.current = img;
      img.onload = () => { texLoadedRef.current = true; paint(); };
    }
  }, [ovalBound, ovalCol, isSnapping]);

  // Snap animation cycle
  const [snapTick, setSnapTick] = useState(0);
  useEffect(() => {
    if (!isSnapping) { setSnapTick(0); return; }
    const id = setInterval(() => setSnapTick(t => t + 1), 3000);
    return () => clearInterval(id);
  }, [isSnapping]);

  // Tooltip state
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const showTip = useCallback((e: React.MouseEvent, text: string) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    setTip({ text, x: e.clientX - r.left, y: e.clientY - r.top - 14 });
  }, []);
  const hideTip = useCallback(() => setTip(null), []);

  // Memoised SVG paths
  const dayLines = useMemo(() => [
    dayFieldLine(R * 0.42, 2.0, comp),
    dayFieldLine(R * 0.58, 2.4, comp),
    dayFieldLine(R * 0.74, 2.8, comp),
  ], [comp]);

  const nightTop = useMemo(() => [
    nightLine(R * 0.42, stretch),
    nightLine(R * 0.58, stretch),
    nightLine(R * 0.74, stretch),
  ], [stretch]);

  const nightBot = useMemo(() => [
    nightLine(-R * 0.42, stretch),
    nightLine(-R * 0.58, stretch),
    nightLine(-R * 0.74, stretch),
  ], [stretch]);

  const mpause = useMemo(() => mpausePath(comp, stretch), [comp, stretch]);

  const tailLabel = isSnapping ? 'Reconnection' : stretch > 1.35 ? 'Highly stretched' : stretch > 1.15 ? 'Stretching' : 'Relaxed';

  const stateDesc: Record<MagState, string> = {
    QUIET: 'The magnetosphere is relaxed. Solar wind pressure is low and the tail is at its normal length. No substorm activity expected.',
    LOADING: 'Southward Bz is feeding energy into the magnetotail. The night-side field is starting to stretch. Watch for further development.',
    STRETCHED: 'The tail is highly stretched and loaded with stored energy. A reconnection event could fire in the next 15 to 30 minutes.',
    SNAPPING: 'Reconnection in progress! Field lines are snapping back toward Earth, funnelling particles onto the poles and lighting the aurora.',
  };

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-white">Magnetotail Status</h3>
          <button
            onClick={onOpenModal}
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
            title="About Magnetotail Status"
          >?</button>
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

      {/* SVG diagram */}
      <div className="relative w-full mt-2" style={{ paddingBottom: '48%', minHeight: 220 }}>
        <svg
          ref={svgRef}
          viewBox="0 0 840 400"
          className="absolute inset-0 w-full h-full"
          style={{ overflow: 'visible' }}
        >
          <style>{`
            @keyframes mtFlow { to { stroke-dashoffset: -160; } }
            @keyframes mtPulse { 0%,100% { opacity: 0.15; } 50% { opacity: 0.55; } }
            @keyframes mtGlow  { 0%,100% { opacity: 0.25; } 50% { opacity: 1; } }
            @keyframes mtSnap  { 0% { transform: scaleX(1.5); } 30% { transform: scaleX(0.6); } 60% { transform: scaleX(0.95); } 100% { transform: scaleX(1.5); } }
            @keyframes mtXFlash { 0%,25% { opacity:0; transform:scale(.5); } 40% { opacity:1; transform:scale(1.15); } 65% { opacity:0; transform:scale(1.6); } 100% { opacity:0; } }
            @keyframes mtEject  { 0%,28% { transform:translateX(0); opacity:0; } 40% { opacity:.85; } 100% { transform:translateX(100px); opacity:0; } }
            @keyframes mtPrecip { 0%,30% { opacity:0; } 42% { opacity:.75; } 72% { opacity:.2; } 100% { opacity:0; } }
            @keyframes mtStrain { 0%,100% { transform: scaleX(${stretch.toFixed(3)}); } 50% { transform: scaleX(${(stretch * 1.04).toFixed(3)}); } }
            @keyframes mtAtmoGlow { 0%,100% { opacity: 0.06; } 50% { opacity: 0.22; } }

            .mt-flow    { animation: mtFlow 6s linear infinite; }
            .mt-g       { transform-box: view-box; transform-origin: ${CX}px ${CY}px; }
            .mt-snap-on { animation: mtSnap 3s ease-in-out infinite; }
            .mt-strain  { animation: mtStrain 1.8s ease-in-out infinite; transform-box: view-box; transform-origin: ${CX}px ${CY}px; }
            .mt-xflash  { animation: mtXFlash 3s ease-out infinite; transform-box: fill-box; transform-origin: center; }
            .mt-eject   { animation: mtEject 3s ease-in infinite; transform-box: view-box; transform-origin: 0 0; }
            .mt-precip  { animation: mtPrecip 3s ease-in-out infinite; }
            .mt-aglow   { animation: mtGlow 3s ease-in-out infinite; }
            .mt-atmo    { animation: mtAtmoGlow 3s ease-in-out infinite; }

            .mt-h { pointer-events: all; cursor: help; }
            .mt-h:hover { filter: brightness(1.25); }
            @media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation: none !important; } }
          `}</style>

          <defs>
            <radialGradient id="mt-sunG" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f0bd6a" /><stop offset="60%" stopColor="#e0973a" /><stop offset="100%" stopColor="#c2701f" />
            </radialGradient>
            <radialGradient id="mt-sunFlare" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(240,189,106,0.25)" /><stop offset="100%" stopColor="rgba(240,189,106,0)" />
            </radialGradient>
            <radialGradient id="mt-atmoG" cx="50%" cy="50%" r="50%">
              <stop offset="68%" stopColor="rgba(56,189,248,0)" />
              <stop offset="86%" stopColor="rgba(56,189,248,0.09)" />
              <stop offset="100%" stopColor="rgba(56,189,248,0.02)" />
            </radialGradient>
            <filter id="mt-gl" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <clipPath id="mt-ec"><circle cx={CX} cy={CY} r={R} /></clipPath>
          </defs>

          {/* Stars */}
          {useMemo(() => {
            const s: React.ReactNode[] = [];
            for (let i = 0; i < 55; i++) {
              s.push(<circle key={i} cx={Math.random()*840} cy={Math.random()*400} r={0.4+Math.random()*0.8} fill="#fff" opacity={0.12+Math.random()*0.28} />);
            }
            return <g>{s}</g>;
          }, [])}

          {/* Sun */}
          <g className="mt-h" onMouseMove={e => showTip(e, 'The Sun. Solar wind streams from here toward Earth carrying magnetic field and charged particles.')} onMouseLeave={hideTip}>
            <circle cx={40} cy={CY} r={80} fill="url(#mt-sunFlare)" />
            <circle cx={40} cy={CY} r={36} fill="url(#mt-sunG)" />
          </g>

          {/* Solar wind flow */}
          <g opacity="0.3">
            {[CY-60, CY-30, CY, CY+30, CY+60].map((y,i) => (
              <line key={i} x1={90} y1={y} x2={CX-R*(1.5*comp+0.6)} y2={CY+(y-CY)*0.4}
                stroke="#e0973a" strokeWidth="1" strokeDasharray="3 8" className="mt-flow"
                opacity={0.5-Math.abs(y-CY)/300} />
            ))}
          </g>

          {/* Magnetopause */}
          <path d={mpause} fill="none" stroke="#aeb7c6" strokeWidth="0.8" opacity="0.15"
            className="mt-h"
            onMouseMove={e => showTip(e, 'Magnetopause: the outer boundary of Earth\'s magnetic shield. Pressure from the solar wind pushes the day side inward while the night side stretches out into the tail.')}
            onMouseLeave={hideTip} />

          {/* Tail lobe shading */}
          <rect x={CX+R*0.3} y={CY-R*1.3} width={R*2.8*stretch} height={R*1.1} fill="#fff" opacity="0.015" rx="4" />
          <rect x={CX+R*0.3} y={CY+R*0.2} width={R*2.8*stretch} height={R*1.1} fill="#fff" opacity="0.015" rx="4" />

          {/* Day-side field lines */}
          <g className="mt-h"
            onMouseMove={e => showTip(e, pressure > 5
              ? `Day-side field lines, compressed by ${pressure.toFixed(1)} nPa of solar wind pressure. Stronger compression means more energy is available to drive activity.`
              : `Day-side field lines under quiet solar wind pressure (${pressure.toFixed(1)} nPa). The shield is holding comfortably.`
            )}
            onMouseLeave={hideTip}>
            {dayLines.map((d, i) => <path key={i} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.3" opacity={0.7-i*0.12} />)}
          </g>

          {/* Inner closed dipole (near Earth, both sides) */}
          <path d={`M ${CX-R*0.35} ${CY-R*0.35} C ${CX-R*0.8} ${CY-R*0.15}, ${CX-R*0.8} ${CY+R*0.15}, ${CX-R*0.35} ${CY+R*0.35}`}
            fill="none" stroke="#aeb7c6" strokeWidth="1.2" opacity="0.55" />
          <path d={`M ${CX+R*0.35} ${CY-R*0.35} C ${CX+R*0.8} ${CY-R*0.15}, ${CX+R*0.8} ${CY+R*0.15}, ${CX+R*0.35} ${CY+R*0.35}`}
            fill="none" stroke="#aeb7c6" strokeWidth="1.2" opacity="0.55" />

          {/* Night-side field (the magnetotail) */}
          <g className={`mt-g ${isSnapping ? 'mt-snap-on' : magState === 'STRETCHED' ? 'mt-strain' : ''}`}
            onMouseMove={e => showTip(e,
              isSnapping ? 'Reconnection! The stretched tail has snapped back. Stored energy is being released, funnelling particles down field lines toward the poles to light the aurora.'
              : magState === 'STRETCHED' ? 'The magnetotail is highly stretched and full of stored energy. Like a rubber band pulled tight, it can snap at any moment, triggering a substorm.'
              : magState === 'LOADING' ? `Southward Bz (${bz.toFixed(1)} nT) is driving energy into the tail. The more it stretches, the bigger the eventual release.`
              : 'Night-side field at normal length. No significant energy loading right now.'
            )}
            onMouseLeave={hideTip}>
            {nightTop.map((d, i) => <path key={`t${i}`} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.3" opacity={0.7-i*0.12} className="mt-h" />)}
            {nightBot.map((d, i) => <path key={`b${i}`} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.3" opacity={0.7-i*0.12} className="mt-h" />)}
          </g>

          {/* Neutral sheet */}
          <line x1={CX+R*0.5} y1={CY} x2={CX+R*3.1*stretch} y2={CY}
            stroke="#aeb7c6" strokeWidth="0.6" strokeDasharray="2 5" opacity="0.2" />

          {/* Reconnection X flash */}
          {isSnapping && (() => {
            const xx = CX + R * 2.4;
            return (
              <g className="mt-xflash" style={{ transformOrigin: `${xx}px ${CY}px` }}>
                <line x1={xx-10} y1={CY-10} x2={xx+10} y2={CY+10} stroke="#d2664a" strokeWidth="2.5" strokeLinecap="round" />
                <line x1={xx+10} y1={CY-10} x2={xx-10} y2={CY+10} stroke="#d2664a" strokeWidth="2.5" strokeLinecap="round" />
              </g>
            );
          })()}

          {/* Plasmoid ejection */}
          {isSnapping && (
            <ellipse cx={CX+R*2.8} cy={CY} rx={12} ry={18}
              fill="none" stroke="#aeb7c6" strokeWidth="1.4" className="mt-eject" />
          )}

          {/* Particle precipitation */}
          {isSnapping && (
            <g className="mt-precip" filter="url(#mt-gl)">
              <path d={`M ${CX+R*1.6} ${CY-8} C ${CX+R*0.9} ${CY-R*0.7}, ${CX+R*0.4} ${CY-R*0.85}, ${CX+4} ${CY-R*0.7}`}
                fill="none" stroke="#5fb47a" strokeWidth="1.4" strokeDasharray="2 5" />
              <path d={`M ${CX+R*1.6} ${CY+8} C ${CX+R*0.9} ${CY+R*0.7}, ${CX+R*0.4} ${CY+R*0.85}, ${CX+4} ${CY+R*0.7}`}
                fill="none" stroke="#5fb47a" strokeWidth="1.4" strokeDasharray="2 5" />
            </g>
          )}

          {/* Day-side reconnection X when Bz south */}
          {bz < -3 && (
            <g opacity={Math.min(1, Math.abs(bz) / 10) * 0.7}>
              <line x1={CX-R-12} y1={CY-8} x2={CX-R+4} y2={CY+8} stroke="#d2664a" strokeWidth="1.8" strokeLinecap="round" />
              <line x1={CX-R+4}  y1={CY-8} x2={CX-R-12} y2={CY+8} stroke="#d2664a" strokeWidth="1.8" strokeLinecap="round" />
            </g>
          )}

          {/* ===== Earth globe (textured canvas, rendered to data URL) ===== */}
          <g className="mt-h"
            onMouseMove={e => showTip(e, 'Earth, rotated so New Zealand is visible. The coloured arc near the south pole is the aurora oval, showing where aurora is most intense overhead right now.')}
            onMouseLeave={hideTip}>
            {/* Atmosphere halo */}
            <circle cx={CX} cy={CY} r={R + 10} fill="url(#mt-atmoG)"
              className={isSnapping ? 'mt-atmo' : ''} style={isSnapping ? undefined : { opacity: 0.06 }} />
            {/* Globe image */}
            {earthUrl ? (
              <image
                href={earthUrl}
                x={CX - R}
                y={CY - R}
                width={R * 2}
                height={R * 2}
                clipPath="url(#mt-ec)"
                style={{ imageRendering: 'auto' }}
              />
            ) : (
              // Fallback gradient while texture loads
              <circle cx={CX} cy={CY} r={R} fill="#1a3a5c" />
            )}
          </g>

          {/* Labels */}
          <text x={40} y={CY-52} textAnchor="middle" fill="#9aa2b1" fontSize="9" fontWeight="500" letterSpacing="0.12em" style={{ textTransform: 'uppercase' as const, fontFamily: 'system-ui, sans-serif' }}>Sun</text>
          <text x={CX} y={CY+R+26} textAnchor="middle" fill="#9aa2b1" fontSize="9" fontWeight="500" letterSpacing="0.12em" style={{ textTransform: 'uppercase' as const, fontFamily: 'system-ui, sans-serif' }}>Earth</text>
          <text x={CX+R*2.2*stretch} y={CY-R*1.5} textAnchor="middle" fill="#9aa2b1" fontSize="8" fontWeight="400" letterSpacing="0.1em" opacity="0.6" style={{ textTransform: 'uppercase' as const, fontFamily: 'system-ui, sans-serif' }}>Magnetotail</text>
          {isSnapping && (
            <text x={CX+R*2.4} y={CY-22} textAnchor="middle" fill="#d2664a" fontSize="9" fontWeight="600" letterSpacing="0.08em" className="mt-xflash" style={{ fontFamily: 'system-ui, sans-serif' }}>SNAP</text>
          )}
          {bz < -3 && (
            <text x={CX-R-4} y={CY+22} textAnchor="middle" fill="#d2664a" fontSize="7.5" fontWeight="500" opacity="0.7" style={{ fontFamily: 'system-ui, sans-serif' }}>Bz South</text>
          )}

          {/* Hover tooltip */}
          {tip && (
            <foreignObject x={Math.min(tip.x, 560)} y={Math.max(tip.y - 50, 4)} width="280" height="90" style={{ pointerEvents: 'none' }}>
              <div style={{
                background: 'rgba(10,14,22,0.95)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 8,
                padding: '8px 10px',
                fontSize: 11,
                lineHeight: 1.45,
                color: '#d4d8e0',
                fontFamily: 'system-ui, sans-serif',
                backdropFilter: 'blur(8px)',
                maxWidth: 260,
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}>
                {tip.text}
              </div>
            </foreignObject>
          )}
        </svg>
      </div>

      {/* Status bar */}
      <div className="mt-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 px-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
          style={{ borderColor: COLOURS[magState] + '40', background: COLOURS[magState] + '10' }}>
          <div className="w-2.5 h-2.5 rounded-full"
            style={{
              background: COLOURS[magState],
              boxShadow: `0 0 6px ${COLOURS[magState]}80`,
              animation: isSnapping ? 'mtGlow 1.5s ease-in-out infinite' : undefined,
            }} />
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
          <svg width="16" height="8"><path d="M0 4 A 8 3 0 0 0 16 4" fill="none" stroke={ovalCol} strokeWidth="2" /></svg>
          Aurora oval
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="8" height="8"><circle cx="4" cy="4" r="2.5" fill="#5fb47a" /></svg>
          NZ
        </span>
      </div>
    </div>
  );
};

export default MagnetotailStatus;
// --- END OF FILE src/components/MagnetotailStatus.tsx ---
