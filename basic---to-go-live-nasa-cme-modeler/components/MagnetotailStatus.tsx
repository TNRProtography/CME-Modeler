// --- START OF FILE src/components/MagnetotailStatus.tsx ---
//
// Live Magnetotail Status Visualization
// ──────────────────────────────────────
// An SVG-based real-time diagram showing Earth's magnetosphere state:
//   • Textured Earth globe (same source as SimulationCanvas) with NZ visible
//   • Aurora oval projected onto the globe, using the same IGRF-13 dipole
//     physics as the sightings map (AuroraSightings)
//   • Magnetic field lines:  day-side compressed by solar wind pressure,
//     night-side stretched into the magnetotail during energy loading
//   • Magnetotail reconnection ("snap") animation when the app's substorm
//     model predicts onset within ~15 minutes
//
// All animation states are driven by live data from the substorm risk worker
// and the substorm forecast model already running in ForecastDashboard.

import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';

// ── Types ───────────────────────────────────────────────────────────────────
// Re-use the existing project types. The SubstormRiskData interface lives in
// hooks/useForecastData.ts; SubstormForecast in types.ts.

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

interface MagnetotailStatusProps {
  substormRiskData: SubstormRiskDataLike | null | undefined;
  substormForecast: SubstormForecastLike;
  onOpenModal: () => void;
}

// ── Physics state machine ───────────────────────────────────────────────────

type MagState = 'QUIET' | 'LOADING' | 'STRETCHED' | 'SNAPPING';

function deriveMagState(
  risk: SubstormRiskDataLike | null | undefined,
  forecast: SubstormForecastLike
): MagState {
  if (!risk) return 'QUIET';
  const { score, bay_onset_flag } = risk.current;
  const { status, p30 } = forecast;

  // Active reconnection / onset
  if (bay_onset_flag || status === 'ONSET') return 'SNAPPING';
  // Imminent — the tail is about to break
  if (status === 'IMMINENT_30' || p30 >= 0.55) return 'STRETCHED';
  // Energy loading in progress
  if (score >= 25 || status === 'LIKELY_60' || status === 'WATCH') return 'LOADING';
  return 'QUIET';
}

// ── Oval boundary (same physics as AuroraSightings) ─────────────────────────

function computeOvalBoundary(risk: SubstormRiskDataLike | null | undefined): number {
  if (!risk) return -65.5;
  const newell60 = risk.metrics.solar_wind.newell_avg_60m ?? 0;
  const newell30 = risk.metrics.solar_wind.newell_avg_30m ?? 0;
  const newell = Math.max(newell60, newell30 * 0.85);
  let eq = -(65.5 - newell / 1800);
  eq = Math.max(eq, -76);
  eq = Math.min(eq, -44);
  if (risk.current.bay_onset_flag) eq = Math.min(eq, -47.2);
  return eq;
}

// ── Helper: colour for oval ring ────────────────────────────────────────────

function ovalStrokeColour(score: number): string {
  if (score >= 80) return '#f87171';
  if (score >= 65) return '#fb923c';
  if (score >= 50) return '#f59e0b';
  if (score >= 35) return '#a3e635';
  if (score >= 20) return '#34d399';
  return '#38bdf8';
}

// ── Status text helpers ─────────────────────────────────────────────────────

function stateLabel(s: MagState): string {
  switch (s) {
    case 'QUIET': return 'Quiet';
    case 'LOADING': return 'Loading';
    case 'STRETCHED': return 'Stretched';
    case 'SNAPPING': return 'Reconnecting';
  }
}

function stateEmoji(s: MagState): string {
  switch (s) {
    case 'QUIET': return '🛡️';
    case 'LOADING': return '⚡';
    case 'STRETCHED': return '🔋';
    case 'SNAPPING': return '💥';
  }
}

function stateColour(s: MagState): string {
  switch (s) {
    case 'QUIET': return '#38bdf8';
    case 'LOADING': return '#fbbf24';
    case 'STRETCHED': return '#fb923c';
    case 'SNAPPING': return '#f87171';
  }
}

// ── SVG geometry builders ───────────────────────────────────────────────────

// Earth centre in SVG coords
const CX = 420;
const CY = 210;
const R = 58; // Earth radius in SVG units

// Sun direction: left side of SVG
const SUN_X = 40;

// Compression factor for day-side field lines (0.5 = very compressed, 1 = normal)
function dayCompression(pressure: number): number {
  // Typical quiet pressure ~2 nPa, storm ~15+ nPa
  const clamped = Math.max(1, Math.min(pressure, 20));
  return 1 - (clamped - 1) / 30; // ~0.97 quiet, ~0.37 extreme
}

// Tail stretch factor (1 = relaxed, up to ~1.6 fully loaded)
function tailStretch(score: number, bz: number): number {
  const bzFactor = bz < 0 ? Math.min(Math.abs(bz) / 15, 1) : 0;
  const scoreFactor = Math.min(score / 80, 1);
  return 1 + 0.55 * Math.max(bzFactor, scoreFactor);
}

// Build a single closed dipole field line path (day-side)
// cpx controls how far the loop extends toward the sun
function dayFieldLine(yOff: number, cpx: number, comp: number): string {
  const x0 = CX - 2; // start on Earth surface, day side
  const xCp = CX - R * comp * cpx;
  const yTop = CY - yOff;
  const yBot = CY + yOff;
  return `M ${x0} ${yTop} C ${xCp} ${yTop - 6}, ${xCp} ${yBot + 6}, ${x0} ${yBot}`;
}

// Build night-side field line (open tail line stretching to the right)
function nightFieldLine(yOff: number, stretch: number): string {
  const x0 = CX + 2;
  const tailLen = R * 2.4 * stretch;
  const xEnd = CX + tailLen;
  const yTop = CY - yOff;
  // Curve from pole outward and then straighten into the tail
  const cp1x = CX + R * 0.8;
  const cp1y = yTop + (yOff < R * 0.6 ? -4 : -8);
  const cp2x = CX + tailLen * 0.6;
  const cp2y = CY - (yOff * 0.15); // converge toward neutral sheet
  return `M ${x0} ${yTop} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${xEnd} ${CY}`;
}

// Build magnetopause boundary
function magnetopausePath(comp: number, stretch: number): string {
  const noseX = CX - R * (1.5 * comp + 0.4);
  const tailX = CX + R * 3.2 * stretch;
  const topY = CY - R * 2.2;
  const botY = CY + R * 2.2;
  return `M ${noseX} ${CY - R * 0.5}
          C ${noseX - 14} ${topY + 30}, ${CX - R * 0.5} ${topY}, ${CX + R} ${topY + 10}
          L ${tailX} ${topY + 30}
          L ${tailX} ${botY - 30}
          L ${CX + R} ${botY - 10}
          C ${CX - R * 0.5} ${botY}, ${noseX - 14} ${botY - 30}, ${noseX} ${CY + R * 0.5}
          Z`;
}

// ── Aurora oval arc on the SVG globe ────────────────────────────────────────
// Draw the oval as arcs at geographic position relative to our side-view globe.
// Since we see Earth from the side, the south pole is at the bottom.
// The oval (geomag ~-65° in southern hemisphere) maps to about 25° from south pole
// = 65° from equator in geographic lat, which on our circle is at
//   y = CY + R * sin(65°) ≈ CY + R * 0.9

function ovalArc(gmagBoundary: number, side: 'visible' | 'far'): string {
  // gmagBoundary is something like -65 (geomagnetic degrees south)
  // Map to position on our sphere. Distance from south pole = 90 - |boundary|
  // Fraction from equator = |boundary|/90
  const frac = Math.abs(gmagBoundary) / 90;
  const yPos = CY + R * frac;
  const halfWidth = R * Math.cos(Math.asin(frac)) * 0.95;
  if (side === 'visible') {
    // Front arc (wider, full opacity)
    return `M ${CX - halfWidth} ${yPos} A ${halfWidth} ${6 + (1 - frac) * 8} 0 0 0 ${CX + halfWidth} ${yPos}`;
  } else {
    // Back arc (dashed, dimmer) — curves the other way
    return `M ${CX - halfWidth} ${yPos} A ${halfWidth} ${6 + (1 - frac) * 8} 0 0 1 ${CX + halfWidth} ${yPos}`;
  }
}

// ── NZ outline on the globe ─────────────────────────────────────────────────
// Simplified outline projected onto our side-view sphere.
// NZ is at ~-43°S, ~172°E. In our view Earth is rotated so NZ's longitude
// faces the camera (the "visible" hemisphere centre).
//
// On the sphere:  x_offset = R * cos(lat) * sin(lon_offset)
//                 y_offset = -R * sin(lat)   (negative lat = south = positive y)
// where lon_offset = 0 for the centre of the visible face.
//
// We'll draw NZ at approximately lat=-43, lon_offset≈0 (centred), which puts it at:
//   y ≈ CY + R * sin(43°) ≈ CY + R * 0.682 ≈ CY + 39.5

function nzPath(): string {
  // Simplified South Island (roughly 5 points)
  const si: [number, number][] = [
    [-46.5, 166.5], [-44, 168], [-42.5, 172], [-43.5, 172.5], [-46, 167.5]
  ];
  // Simplified North Island (roughly 5 points)
  const ni: [number, number][] = [
    [-41.2, 174], [-38.5, 176], [-36, 175], [-37.5, 178], [-41, 175]
  ];

  const REF_LON = 172; // centre longitude we're "facing"

  function project(lat: number, lon: number): [number, number] {
    const latRad = (lat * Math.PI) / 180;
    const lonOff = ((lon - REF_LON) * Math.PI) / 180;
    const x = CX + R * Math.cos(latRad) * Math.sin(lonOff);
    const y = CY - R * Math.sin(latRad);
    return [x, y];
  }

  function island(pts: [number, number][]): string {
    const projected = pts.map(([la, lo]) => project(la, lo));
    return 'M ' + projected.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') + ' Z';
  }

  return island(si) + ' ' + island(ni);
}

// ── Component ───────────────────────────────────────────────────────────────

const MagnetotailStatus: React.FC<MagnetotailStatusProps> = ({
  substormRiskData,
  substormForecast,
  onOpenModal,
}) => {
  const magState = deriveMagState(substormRiskData, substormForecast);
  const score = substormRiskData?.current?.score ?? 0;
  const bz = substormRiskData?.metrics?.solar_wind?.bz ?? 0;
  const pressure = substormRiskData?.metrics?.solar_wind?.dynamic_pressure_nPa ?? 2;
  const ovalBoundary = computeOvalBoundary(substormRiskData);
  const ovalColour = ovalStrokeColour(score);
  const comp = dayCompression(pressure);
  const stretch = magState === 'SNAPPING' ? 1.0 : tailStretch(score, bz);

  // Snap animation cycle counter (increments during SNAPPING to drive CSS)
  const [snapCycle, setSnapCycle] = useState(0);
  const snapRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (magState === 'SNAPPING') {
      snapRef.current = setInterval(() => setSnapCycle(c => c + 1), 3000);
    } else {
      if (snapRef.current) clearInterval(snapRef.current);
      setSnapCycle(0);
    }
    return () => { if (snapRef.current) clearInterval(snapRef.current); };
  }, [magState]);

  // ── Tooltip (hover info) ────────────────────────────────────────────────
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setTooltip({
      text,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top - 14,
    });
  }, []);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  // ── Memoised SVG paths ──────────────────────────────────────────────────

  const dayLines = useMemo(() => [
    dayFieldLine(R * 0.42, 2.0, comp),
    dayFieldLine(R * 0.58, 2.4, comp),
    dayFieldLine(R * 0.74, 2.8, comp),
  ], [comp]);

  const nightLines = useMemo(() => [
    nightFieldLine(R * 0.42, stretch),
    nightFieldLine(R * 0.58, stretch),
    nightFieldLine(R * 0.74, stretch),
  ], [stretch]);

  // Mirror night lines for bottom half
  const nightLinesBot = useMemo(() => [
    nightFieldLine(-R * 0.42, stretch),
    nightFieldLine(-R * 0.58, stretch),
    nightFieldLine(-R * 0.74, stretch),
  ], [stretch]);

  const mpause = useMemo(() => magnetopausePath(comp, stretch), [comp, stretch]);
  const ovalFront = useMemo(() => ovalArc(ovalBoundary, 'visible'), [ovalBoundary]);
  const ovalBack = useMemo(() => ovalArc(ovalBoundary, 'far'), [ovalBoundary]);
  const nz = useMemo(() => nzPath(), []);

  // ── Derived descriptions for tooltip panel ──────────────────────────────

  const stateDesc = useMemo(() => {
    switch (magState) {
      case 'QUIET':
        return 'The magnetosphere is relaxed. Solar wind pressure is low and the magnetic tail is at normal length. No substorm activity expected.';
      case 'LOADING':
        return 'Energy from the solar wind is loading into the magnetotail. The night-side field lines are beginning to stretch. Watch for further development.';
      case 'STRETCHED':
        return 'The magnetotail is highly stretched with stored energy. A substorm reconnection event ("snap") could occur within the next 15–30 minutes.';
      case 'SNAPPING':
        return 'Magnetotail reconnection in progress! Field lines are snapping back toward Earth, funnelling particles onto the poles and lighting the aurora.';
    }
  }, [magState]);

  // Field line label for night-side (the key animation)
  const tailLabel = useMemo(() => {
    if (magState === 'SNAPPING') return 'Reconnection';
    if (stretch > 1.35) return 'Highly stretched';
    if (stretch > 1.15) return 'Stretching';
    return 'Relaxed';
  }, [magState, stretch]);

  // ── Render ──────────────────────────────────────────────────────────────

  const isSnapping = magState === 'SNAPPING';
  const isStretched = magState === 'STRETCHED';

  // Snap flash CSS class — toggles every 3s during snapping to cycle
  const snapPhase = isSnapping ? (snapCycle % 2 === 0 ? 'snap-a' : 'snap-b') : '';

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col overflow-hidden">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-start mb-1">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-white">Magnetotail Status</h3>
          <button
            onClick={onOpenModal}
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
            title="About Magnetotail Status"
          >
            ?
          </button>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-2 justify-end">
            <span className="text-2xl">{stateEmoji(magState)}</span>
            <span
              className="text-lg font-bold"
              style={{ color: stateColour(magState) }}
            >
              {stateLabel(magState)}
            </span>
          </div>
          <div className="text-xs text-neutral-400 mt-0.5">
            Tail: {tailLabel} · Bz: {bz.toFixed(1)} nT · Pressure: {pressure.toFixed(1)} nPa
          </div>
        </div>
      </div>

      {/* ── SVG Visualisation ───────────────────────────────────────────── */}
      <div className="relative w-full mt-2" style={{ paddingBottom: '48%', minHeight: 220 }}>
        <svg
          ref={svgRef}
          viewBox="0 0 840 400"
          className="absolute inset-0 w-full h-full"
          style={{ overflow: 'visible' }}
        >
          {/* ── Inline styles / keyframes ─────────────────────────────── */}
          <style>{`
            @keyframes mtFlow { to { stroke-dashoffset: -160; } }
            @keyframes mtPulse { 0%,100% { opacity: 0.15; } 50% { opacity: 0.55; } }
            @keyframes mtAuroraGlow { 0%,100% { opacity: 0.25; } 50% { opacity: 1; } }
            @keyframes mtSnapField { 0% { transform: scaleX(1.5); } 30% { transform: scaleX(0.6); } 60% { transform: scaleX(0.95); } 100% { transform: scaleX(1.5); } }
            @keyframes mtSnapX { 0%,25% { opacity: 0; transform: scale(0.5); } 40% { opacity: 1; transform: scale(1.15); } 65% { opacity: 0; transform: scale(1.6); } 100% { opacity: 0; } }
            @keyframes mtPlasmoid { 0%,28% { transform: translateX(0); opacity: 0; } 40% { opacity: 0.85; } 100% { transform: translateX(100px); opacity: 0; } }
            @keyframes mtPrecip { 0%,30% { opacity: 0; } 42% { opacity: 0.75; } 72% { opacity: 0.2; } 100% { opacity: 0; } }
            @keyframes mtStrain { 0%,100% { transform: scaleX(${stretch.toFixed(3)}); } 50% { transform: scaleX(${(stretch * 1.04).toFixed(3)}); } }
            @keyframes mtEarthGlow { 0%,100% { opacity: 0.08; } 50% { opacity: 0.25; } }

            .mt-flow { animation: mtFlow 6s linear infinite; }
            .mt-field-quiet { transition: d 1.2s ease, opacity 0.6s; }
            .mt-snap-group { transform-box: view-box; transform-origin: ${CX}px ${CY}px; }
            .mt-snap-active { animation: mtSnapField 3s ease-in-out infinite; }
            .mt-strain { animation: mtStrain 1.8s ease-in-out infinite; transform-box: view-box; transform-origin: ${CX}px ${CY}px; }
            .mt-snapx { animation: mtSnapX 3s ease-out infinite; transform-box: fill-box; transform-origin: center; }
            .mt-plasmoid { animation: mtPlasmoid 3s ease-in infinite; transform-box: view-box; transform-origin: 0 0; }
            .mt-precip { animation: mtPrecip 3s ease-in-out infinite; }
            .mt-aurora-snap { animation: mtAuroraGlow 3s ease-in-out infinite; }
            .mt-oval-pulse { animation: mtPulse 4s ease-in-out infinite; }
            .mt-earth-glow { animation: mtEarthGlow 3s ease-in-out infinite; }

            .mt-tt { pointer-events: all; cursor: help; }
            .mt-tt:hover { filter: brightness(1.3); }
            @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
          `}</style>

          <defs>
            {/* Earth gradient (matches aurora-machine aesthetic) */}
            <radialGradient id="mt-earthg" cx="38%" cy="36%" r="64%">
              <stop offset="0%" stopColor="#5a87b4" />
              <stop offset="55%" stopColor="#2f5985" />
              <stop offset="100%" stopColor="#132d4a" />
            </radialGradient>
            {/* 3D sphere highlight */}
            <radialGradient id="mt-highlight" cx="35%" cy="30%" r="60%">
              <stop offset="0%" stopColor="rgba(255,255,255,0.18)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </radialGradient>
            {/* Atmosphere glow */}
            <radialGradient id="mt-atmo" cx="50%" cy="50%" r="50%">
              <stop offset="70%" stopColor="rgba(56,189,248,0)" />
              <stop offset="88%" stopColor="rgba(56,189,248,0.08)" />
              <stop offset="100%" stopColor="rgba(56,189,248,0.02)" />
            </radialGradient>
            {/* Sun glow */}
            <radialGradient id="mt-sung" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#f0bd6a" />
              <stop offset="60%" stopColor="#e0973a" />
              <stop offset="100%" stopColor="#c2701f" />
            </radialGradient>
            <radialGradient id="mt-sunflare" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(240,189,106,0.25)" />
              <stop offset="100%" stopColor="rgba(240,189,106,0)" />
            </radialGradient>
            {/* Aurora glow filter */}
            <filter id="mt-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            <filter id="mt-glow-lg" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Clip path for earth landmass */}
            <clipPath id="mt-earthclip">
              <circle cx={CX} cy={CY} r={R} />
            </clipPath>
          </defs>

          {/* ── Background stars (subtle) ──────────────────────────────── */}
          {useMemo(() => {
            const stars: React.ReactNode[] = [];
            for (let i = 0; i < 60; i++) {
              const sx = Math.random() * 840;
              const sy = Math.random() * 400;
              const sr = 0.4 + Math.random() * 0.8;
              const so = 0.15 + Math.random() * 0.3;
              stars.push(<circle key={i} cx={sx} cy={sy} r={sr} fill="#fff" opacity={so} />);
            }
            return <g>{stars}</g>;
          }, [])}

          {/* ── Sun (left edge) ────────────────────────────────────────── */}
          <g
            className="mt-tt"
            onMouseMove={(e) => showTooltip(e, 'The Sun — solar wind and CMEs flow from here toward Earth')}
            onMouseLeave={hideTooltip}
          >
            <circle cx={SUN_X} cy={CY} r={80} fill="url(#mt-sunflare)" />
            <circle cx={SUN_X} cy={CY} r={36} fill="url(#mt-sung)" />
          </g>

          {/* ── Solar wind flow arrows ─────────────────────────────────── */}
          <g opacity="0.3">
            {[CY - 60, CY - 30, CY, CY + 30, CY + 60].map((y, i) => (
              <line
                key={i}
                x1={SUN_X + 50}
                y1={y}
                x2={CX - R * (1.5 * comp + 0.6)}
                y2={CY + (y - CY) * 0.4}
                stroke="#e0973a"
                strokeWidth="1"
                strokeDasharray="3 8"
                className="mt-flow"
                opacity={0.5 - Math.abs(y - CY) / 300}
              />
            ))}
          </g>

          {/* ── Magnetopause boundary ──────────────────────────────────── */}
          <path
            d={mpause}
            fill="none"
            stroke="#aeb7c6"
            strokeWidth="0.8"
            opacity="0.15"
            className="mt-tt"
            onMouseMove={(e) => showTooltip(e, 'Magnetopause — the outer boundary of Earth\'s magnetic shield. Solar wind pressure compresses the day side (left) while the night side stretches into a long tail.')}
            onMouseLeave={hideTooltip}
          />

          {/* ── Tail lobe shading ──────────────────────────────────────── */}
          <rect x={CX + R * 0.3} y={CY - R * 1.3} width={R * 2.8 * stretch} height={R * 1.1} fill="#ffffff" opacity="0.015" rx="4" />
          <rect x={CX + R * 0.3} y={CY + R * 0.2} width={R * 2.8 * stretch} height={R * 1.1} fill="#ffffff" opacity="0.015" rx="4" />

          {/* ── Day-side field lines ───────────────────────────────────── */}
          <g
            className="mt-tt"
            onMouseMove={(e) => showTooltip(e, `Day-side field — ${comp < 0.85 ? 'compressed by strong solar wind pressure (' + pressure.toFixed(1) + ' nPa). More compression = more energy available.' : 'gently compressed by quiet solar wind (' + pressure.toFixed(1) + ' nPa).'}`)}
            onMouseLeave={hideTooltip}
          >
            {dayLines.map((d, i) => (
              <path key={`d${i}`} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.3" opacity={0.7 - i * 0.12} />
            ))}
            {/* Mirror below equator */}
            {dayLines.map((d, i) => {
              // Flip y coordinates by reflecting around CY
              // We'll use the same paths but with a transform
              return null; // Handled by the yOff being symmetric in dayFieldLine
            })}
          </g>

          {/* ── Inner closed dipole (stays near Earth) ─────────────────── */}
          <path
            d={`M ${CX - R * 0.35} ${CY - R * 0.35} C ${CX - R * 0.8} ${CY - R * 0.15}, ${CX - R * 0.8} ${CY + R * 0.15}, ${CX - R * 0.35} ${CY + R * 0.35}`}
            fill="none" stroke="#aeb7c6" strokeWidth="1.2" opacity="0.55"
          />
          <path
            d={`M ${CX + R * 0.35} ${CY - R * 0.35} C ${CX + R * 0.8} ${CY - R * 0.15}, ${CX + R * 0.8} ${CY + R * 0.15}, ${CX + R * 0.35} ${CY + R * 0.35}`}
            fill="none" stroke="#aeb7c6" strokeWidth="1.2" opacity="0.55"
          />

          {/* ── Night-side field lines (the magnetotail) ───────────────── */}
          <g
            className={`mt-snap-group ${isSnapping ? 'mt-snap-active' : isStretched ? 'mt-strain' : ''}`}
            onMouseMove={(e) => showTooltip(e,
              isSnapping
                ? 'RECONNECTION! The stretched tail has snapped. Stored magnetic energy is being released — particles are being flung toward Earth\'s poles, lighting the aurora!'
                : isStretched
                  ? 'The magnetotail is highly stretched and loaded with energy. Like a rubber band pulled tight, it could snap at any moment — triggering a substorm and aurora brightening.'
                  : magState === 'LOADING'
                    ? 'Energy from southward IMF (Bz = ' + bz.toFixed(1) + ' nT) is stretching the magnetotail. The more it stretches, the more energy is stored for a potential substorm release.'
                    : 'The magnetotail is relaxed at normal length. No significant energy loading detected.'
            )}
            onMouseLeave={hideTooltip}
          >
            {nightLines.map((d, i) => (
              <path key={`nt${i}`} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.3" opacity={0.7 - i * 0.12} className="mt-tt" />
            ))}
            {nightLinesBot.map((d, i) => (
              <path key={`nb${i}`} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.3" opacity={0.7 - i * 0.12} className="mt-tt" />
            ))}
          </g>

          {/* ── Neutral sheet (current sheet in the tail) ──────────────── */}
          <line
            x1={CX + R * 0.5}
            y1={CY}
            x2={CX + R * 3.1 * stretch}
            y2={CY}
            stroke="#aeb7c6"
            strokeWidth="0.6"
            strokeDasharray="2 5"
            opacity="0.2"
          />

          {/* ── Reconnection X-line (flashes during snap) ──────────────── */}
          {isSnapping && (() => {
            const xLineX = CX + R * 2.4;
            return (
              <g className="mt-snapx" style={{ transformOrigin: `${xLineX}px ${CY}px` }}>
                <line x1={xLineX - 10} y1={CY - 10} x2={xLineX + 10} y2={CY + 10} stroke="#d2664a" strokeWidth="2.5" strokeLinecap="round" />
                <line x1={xLineX + 10} y1={CY - 10} x2={xLineX - 10} y2={CY + 10} stroke="#d2664a" strokeWidth="2.5" strokeLinecap="round" />
              </g>
            );
          })()}

          {/* ── Plasmoid ejection (during snap) ────────────────────────── */}
          {isSnapping && (
            <ellipse
              cx={CX + R * 2.8}
              cy={CY}
              rx={12}
              ry={18}
              fill="none"
              stroke="#aeb7c6"
              strokeWidth="1.4"
              className="mt-plasmoid"
            />
          )}

          {/* ── Particle precipitation (during snap) ───────────────────── */}
          {isSnapping && (
            <g className="mt-precip" filter="url(#mt-glow)">
              <path d={`M ${CX + R * 1.6} ${CY - 8} C ${CX + R * 0.9} ${CY - R * 0.7}, ${CX + R * 0.4} ${CY - R * 0.85}, ${CX + 4} ${CY - R * 0.7}`}
                fill="none" stroke="#5fb47a" strokeWidth="1.4" strokeDasharray="2 5" />
              <path d={`M ${CX + R * 1.6} ${CY + 8} C ${CX + R * 0.9} ${CY + R * 0.7}, ${CX + R * 0.4} ${CY + R * 0.85}, ${CX + 4} ${CY + R * 0.7}`}
                fill="none" stroke="#5fb47a" strokeWidth="1.4" strokeDasharray="2 5" />
            </g>
          )}

          {/* ── Day-side reconnection indicator (when Bz south) ─────── */}
          {bz < -3 && (
            <g opacity={Math.min(1, Math.abs(bz) / 10) * 0.7}>
              <line x1={CX - R - 12} y1={CY - 8} x2={CX - R + 4} y2={CY + 8} stroke="#d2664a" strokeWidth="1.8" strokeLinecap="round" />
              <line x1={CX - R + 4} y1={CY - 8} x2={CX - R - 12} y2={CY + 8} stroke="#d2664a" strokeWidth="1.8" strokeLinecap="round" />
            </g>
          )}

          {/* ── Earth ──────────────────────────────────────────────────── */}
          <g
            className="mt-tt"
            onMouseMove={(e) => showTooltip(e, 'Earth — rotated to show New Zealand. The aurora oval (green/coloured ring) shows where aurora is most likely overhead right now.')}
            onMouseLeave={hideTooltip}
          >
            {/* Atmosphere glow */}
            <circle cx={CX} cy={CY} r={R + 10} fill="url(#mt-atmo)"
              className={isSnapping ? 'mt-earth-glow' : ''}
              style={{ opacity: isSnapping ? undefined : 0.08 }}
            />
            {/* Main globe */}
            <circle cx={CX} cy={CY} r={R} fill="url(#mt-earthg)" />
            {/* NZ landmass */}
            <path d={nz} fill="#4a9064" opacity="0.6" clipPath="url(#mt-earthclip)" stroke="#5fb47a" strokeWidth="0.5" />
            {/* Terminator (day/night divide) — slight darkening on right half */}
            <path
              d={`M ${CX} ${CY - R} A ${R} ${R} 0 0 1 ${CX} ${CY + R} L ${CX} ${CY - R} Z`}
              fill="rgba(0,0,0,0.25)"
              clipPath="url(#mt-earthclip)"
            />
            {/* Specular highlight */}
            <circle cx={CX} cy={CY} r={R} fill="url(#mt-highlight)" />
          </g>

          {/* ── Aurora oval on globe ────────────────────────────────────── */}
          <g filter="url(#mt-glow)">
            {/* Front arc (visible face) */}
            <path
              d={ovalFront}
              fill="none"
              stroke={ovalColour}
              strokeWidth={isSnapping ? 4.5 : 2.5}
              strokeLinecap="round"
              className={isSnapping ? 'mt-aurora-snap' : score >= 20 ? 'mt-oval-pulse' : ''}
              opacity={isSnapping ? undefined : Math.max(0.3, score / 100)}
              clipPath="url(#mt-earthclip)"
            />
            {/* Back arc (far side, dimmer dashed) */}
            <path
              d={ovalBack}
              fill="none"
              stroke={ovalColour}
              strokeWidth={1.5}
              strokeDasharray="3 5"
              opacity={0.2}
              clipPath="url(#mt-earthclip)"
            />
          </g>

          {/* ── NZ marker dot ──────────────────────────────────────────── */}
          {(() => {
            // Project Christchurch-ish location onto the sphere
            const latRad = (-43.5 * Math.PI) / 180;
            const lonOff = ((172 - 172) * Math.PI) / 180;
            const nx = CX + R * Math.cos(latRad) * Math.sin(lonOff);
            const ny = CY - R * Math.sin(latRad);
            return (
              <g
                className="mt-tt"
                onMouseMove={(e) => showTooltip(e, 'New Zealand — your location. Aurora is visible from here when the oval expands north and skies are dark and clear.')}
                onMouseLeave={hideTooltip}
              >
                <circle cx={nx} cy={ny} r={2.5} fill="#5fb47a" opacity="0.9" />
                <circle cx={nx} cy={ny} r={5} fill="none" stroke="#5fb47a" strokeWidth="0.6" opacity="0.5" />
              </g>
            );
          })()}

          {/* ── Labels ─────────────────────────────────────────────────── */}
          <text x={SUN_X} y={CY - 52} textAnchor="middle" fill="#9aa2b1" fontSize="9" fontWeight="500" letterSpacing="0.12em" style={{ textTransform: 'uppercase' as const, fontFamily: 'system-ui, sans-serif' }}>Sun</text>

          <text x={CX} y={CY + R + 26} textAnchor="middle" fill="#9aa2b1" fontSize="9" fontWeight="500" letterSpacing="0.12em" style={{ textTransform: 'uppercase' as const, fontFamily: 'system-ui, sans-serif' }}>Earth</text>

          <text x={CX + R * 2.2 * stretch} y={CY - R * 1.5} textAnchor="middle" fill="#9aa2b1" fontSize="8" fontWeight="400" letterSpacing="0.1em" opacity="0.6" style={{ textTransform: 'uppercase' as const, fontFamily: 'system-ui, sans-serif' }}>Magnetotail</text>

          {isSnapping && (
            <text x={CX + R * 2.4} y={CY - 22} textAnchor="middle" fill="#d2664a" fontSize="9" fontWeight="600" letterSpacing="0.08em" className="mt-snapx" style={{ fontFamily: 'system-ui, sans-serif' }}>SNAP</text>
          )}

          {bz < -3 && (
            <text x={CX - R - 4} y={CY + 22} textAnchor="middle" fill="#d2664a" fontSize="7.5" fontWeight="500" opacity="0.7" style={{ fontFamily: 'system-ui, sans-serif' }}>Bz South</text>
          )}

          {/* ── Interactive tooltip overlay ─────────────────────────────── */}
          {tooltip && (
            <foreignObject x={Math.min(tooltip.x, 560)} y={Math.max(tooltip.y - 50, 4)} width="260" height="80" style={{ pointerEvents: 'none' }}>
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
                maxWidth: 250,
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}>
                {tooltip.text}
              </div>
            </foreignObject>
          )}
        </svg>
      </div>

      {/* ── Status description bar ──────────────────────────────────────── */}
      <div className="mt-3 flex flex-col sm:flex-row items-start sm:items-center gap-3 px-1">
        {/* State badge */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg border"
          style={{
            borderColor: stateColour(magState) + '40',
            background: stateColour(magState) + '10',
          }}
        >
          <div
            className="w-2.5 h-2.5 rounded-full"
            style={{
              background: stateColour(magState),
              boxShadow: `0 0 6px ${stateColour(magState)}80`,
              animation: isSnapping ? 'mtAuroraGlow 1.5s ease-in-out infinite' : undefined,
            }}
          />
          <span className="text-sm font-semibold" style={{ color: stateColour(magState) }}>
            {stateLabel(magState)}
          </span>
        </div>

        {/* Description */}
        <p className="text-xs text-neutral-400 leading-relaxed flex-1">
          {stateDesc}
        </p>
      </div>

      {/* ── Legend ──────────────────────────────────────────────────────── */}
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 px-1 text-[10px] text-neutral-500 border-t border-neutral-800 pt-3">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#aeb7c6" strokeWidth="1.3" /></svg>
          Magnetic field lines
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
          <svg width="16" height="8"><path d="M0 4 A 8 3 0 0 0 16 4" fill="none" stroke={ovalColour} strokeWidth="2" /></svg>
          Aurora oval
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="8" height="8"><circle cx="4" cy="4" r="2.5" fill="#5fb47a" /></svg>
          New Zealand
        </span>
      </div>
    </div>
  );
};

export default MagnetotailStatus;
// --- END OF FILE src/components/MagnetotailStatus.tsx ---
