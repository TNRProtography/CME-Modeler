import React, { useMemo, useState, useEffect } from 'react';
import { FluxRopeAnalysis } from '../utils/fluxRopeModel';

interface FluxRopePanelProps {
  analysis: FluxRopeAnalysis | null;
}

const ORIENTATION_LABELS: Record<FluxRopeAnalysis['orientation'], string> = {
  SOUTH_LEADING: 'South-leading (front-loaded aurora)',
  NORTH_LEADING: 'North-leading (better later)',
  AXIAL: 'Axial/sideways (Bz uncertain)',
};

const bzColor = (bz: number) => {
  if (bz <= -10) return 'text-emerald-300';
  if (bz <= -3) return 'text-green-300';
  if (bz >= 8) return 'text-rose-300';
  if (bz >= 3) return 'text-orange-300';
  return 'text-neutral-300';
};

const FluxRopeSlinky: React.FC<{ analysis: FluxRopeAnalysis }> = ({ analysis }) => {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const phase = useMemo(() => {
    const now = Date.now();
    return (analysis.rotationDegPerHour * ((now - analysis.detectedAt) / 3600000)) * Math.PI / 180;
  }, [analysis, tick]);

  const lines = useMemo(() => {
    const segments = 120;
    const turns = 4;
    const width = 460;
    const height = 160;
    const cx = 230;
    const cy = 80;
    const rx = 180;
    const ry = 45;
    const zAmp = 22;

    const pts: { x: number; y: number; bz: number; depth: number }[] = [];
    for (let i = 0; i <= segments; i++) {
      const s = i / segments;
      const angle = turns * Math.PI * 2 * s + phase;
      const x = cx - rx + (2 * rx * s);
      const y = cy + Math.sin(angle) * ry;
      const depth = Math.cos(angle);
      const bz = analysis.nowBt * Math.cos(angle);
      pts.push({ x, y: y - depth * zAmp, bz, depth });
    }

    return { pts, width, height };
  }, [analysis, phase]);

  return (
    <svg viewBox={`0 0 ${lines.width} ${lines.height}`} className="w-full h-44 rounded-lg bg-black/30 border border-neutral-700/50">
      <circle cx="34" cy="80" r="10" fill="#60a5fa" />
      <text x="50" y="85" className="fill-blue-200 text-[11px]">Earth</text>
      {lines.pts.slice(1).map((p, idx) => {
        const prev = lines.pts[idx];
        const southward = p.bz < 0;
        const opacity = 0.35 + ((p.depth + 1) / 2) * 0.55;
        return (
          <line
            key={idx}
            x1={prev.x}
            y1={prev.y}
            x2={p.x}
            y2={p.y}
            stroke={southward ? '#4ade80' : '#fb7185'}
            strokeWidth={1.5 + ((p.depth + 1) / 2) * 1.6}
            opacity={opacity}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
};

const FluxRopePanel: React.FC<FluxRopePanelProps> = ({ analysis }) => {
  const fallbackAnalysis: FluxRopeAnalysis = {
    detectedAt: Date.now(),
    entryTime: Date.now(),
    confidenceR2: 0,
    windowMinutes: 0,
    rotationDegPerHour: 0,
    orientation: 'AXIAL',
    progressPct: 0,
    nowBz: 0,
    nowBt: 6,
    predictedTurnNorthAt: null,
    forecast: [
      { label: 'Now', minutesAhead: 0, bz: 0 },
      { label: '+15m', minutesAhead: 15, bz: 0 },
      { label: '+30m', minutesAhead: 30, bz: 0 },
      { label: '+1h', minutesAhead: 60, bz: 0 },
      { label: '+3h', minutesAhead: 180, bz: 0 },
      { label: '+6h', minutesAhead: 360, bz: 0 },
    ],
    explanation: 'Monitoring IMF for clean flux-rope rotation. Visualization stays on so users can learn the geometry while data accumulates.',
  };

  const active = analysis ?? fallbackAnalysis;

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-5 border border-cyan-800/40">
      <div className="flex flex-wrap justify-between gap-3 items-center mb-3">
        <h3 className="text-xl font-semibold text-white">Flux Rope Rotation Forecast</h3>
        <span className="text-xs px-2 py-1 rounded bg-cyan-900/40 text-cyan-200 border border-cyan-700/50">
          Confidence {(active.confidenceR2 * 100).toFixed(0)}%
        </span>
      </div>

      <p className="text-sm text-neutral-300 mb-3">{active.explanation}</p>
      {!analysis && (
        <div className="mb-3 text-xs text-amber-300 bg-amber-900/20 border border-amber-700/40 rounded px-3 py-2">
          No clean flux rope detected yet. Forecast values are held neutral until confidence improves.
        </div>
      )}
      <FluxRopeSlinky analysis={active} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
        <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/60 p-3">
          <div className="text-xs text-neutral-400">Orientation</div>
          <div className="text-sm text-neutral-100 font-semibold mt-1">{ORIENTATION_LABELS[active.orientation]}</div>
          <div className="text-xs text-neutral-400 mt-2">Estimated progress: {active.progressPct.toFixed(0)}%</div>
        </div>
        <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/60 p-3">
          <div className="text-xs text-neutral-400">Current IMF</div>
          <div className={`text-sm font-semibold mt-1 ${bzColor(active.nowBz)}`}>Bz {active.nowBz.toFixed(1)} nT</div>
          <div className="text-xs text-neutral-300 mt-1">Bt {active.nowBt.toFixed(1)} nT · Rotation {active.rotationDegPerHour.toFixed(1)}°/hr</div>
        </div>
        <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/60 p-3">
          <div className="text-xs text-neutral-400">What to expect</div>
          <div className="text-sm text-neutral-100 mt-1">
            {active.predictedTurnNorthAt
              ? `Likely Bz polarity turn around ${new Date(active.predictedTurnNorthAt).toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false })}.`
              : 'No clear Bz polarity turn detected in the next 6 hours.'}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-neutral-700/60 bg-neutral-900/40 p-3">
        <div className="text-xs uppercase tracking-wide text-neutral-400 mb-2">Bz forecast checkpoints</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {active.forecast.map((f) => (
            <div key={f.label} className="rounded border border-neutral-700/70 px-2 py-2 bg-neutral-950/60 text-center">
              <div className="text-[11px] text-neutral-400">{f.label}</div>
              <div className={`text-sm font-semibold ${bzColor(f.bz)}`}>{f.bz.toFixed(1)} nT</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FluxRopePanel;
