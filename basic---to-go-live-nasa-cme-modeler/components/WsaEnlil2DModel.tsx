import React, { useMemo } from 'react';
import { ProcessedCME } from '../types';

interface WsaEnlil2DModelProps {
  cmes: ProcessedCME[];
}

const AU_IN_KM = 149_597_870.7;

interface ProjectedCME {
  id: string;
  angleDeg: number;
  latitude: number;
  radialDistanceAu: number;
  shockRadius: number;
  coreRadius: number;
  wakeLength: number;
  color: string;
}

const COLORS = [
  '#5eead4',
  '#a78bfa',
  '#38bdf8',
  '#fbbf24',
  '#f472b6',
  '#22d3ee',
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const WsaEnlil2DModel: React.FC<WsaEnlil2DModelProps> = ({ cmes }) => {
  const projections = useMemo<ProjectedCME[]>(() => {
    const now = Date.now();

    return cmes.map((cme, index) => {
      const elapsedSeconds = (now - cme.startTime.getTime()) / 1000;
      const radialDistanceAu = clamp(
        (cme.speed * elapsedSeconds) / 1000 / AU_IN_KM,
        0.05,
        1.35
      );

      const shockRadius = 18 + (cme.halfAngle || 0) * 0.6;
      const coreRadius = shockRadius * 0.55;
      const wakeLength = shockRadius * 1.4;

      return {
        id: cme.id,
        angleDeg: cme.longitude,
        latitude: cme.latitude,
        radialDistanceAu,
        shockRadius,
        coreRadius,
        wakeLength,
        color: COLORS[index % COLORS.length],
      };
    });
  }, [cmes]);

  const scale = 220;
  const topSize = { width: 720, height: 460 };
  const sideSize = { width: 720, height: 280 };
  const topCenter = { x: topSize.width / 2, y: topSize.height / 2 };
  const sideBaselineY = sideSize.height / 2;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 bg-neutral-900/70 border border-neutral-800 rounded-xl p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">WSA-ENLIL 2D Model</p>
            <h3 className="text-lg font-semibold text-neutral-50">Top-down heliographic view</h3>
            <p className="text-sm text-neutral-400 max-w-3xl">
              Propagation of Earth-directed CMEs in the ecliptic plane. Shock, core, and wake regions are shown for each event,
              scaled by speed and elapsed time since launch.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-neutral-300">
            <span className="w-3 h-3 rounded-full bg-amber-400 shadow-sm" aria-hidden /> Shock
            <span className="w-3 h-3 rounded-full bg-sky-400 shadow-sm" aria-hidden /> Core
            <span className="w-5 h-3 rounded-full bg-neutral-500" aria-hidden /> Wake
          </div>
        </div>

        <div className="relative overflow-hidden rounded-lg bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 border border-neutral-800">
          <svg viewBox={`0 0 ${topSize.width} ${topSize.height}`} role="img" aria-label="Top-down WSA-ENLIL propagation view">
            <defs>
              <radialGradient id="sunGlow" cx="50%" cy="50%" r="60%">
                <stop offset="0%" stopColor="#fcd34d" stopOpacity="0.9" />
                <stop offset="70%" stopColor="#fbbf24" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle cx={topCenter.x} cy={topCenter.y} r={18} fill="url(#sunGlow)" />
            <circle
              cx={topCenter.x}
              cy={topCenter.y}
              r={scale}
              fill="none"
              stroke="#334155"
              strokeDasharray="6 8"
              strokeWidth={1.5}
            />
            <text x={topCenter.x + scale + 8} y={topCenter.y - 6} className="fill-neutral-400 text-xs">
              1 AU (Earth orbit)
            </text>

            {projections.map((proj) => {
              const radial = proj.radialDistanceAu * scale;

              return (
                <g
                  key={`top-${proj.id}`}
                  transform={`translate(${topCenter.x} ${topCenter.y}) rotate(${proj.angleDeg})`}
                  className="transition-transform duration-300"
                >
                  <ellipse
                    cx={radial}
                    cy={0}
                    rx={proj.shockRadius}
                    ry={proj.shockRadius * 0.6}
                    fill={proj.color}
                    fillOpacity={0.25}
                    stroke={proj.color}
                    strokeOpacity={0.5}
                    strokeWidth={1.5}
                  />
                  <ellipse
                    cx={radial}
                    cy={0}
                    rx={proj.coreRadius}
                    ry={proj.coreRadius * 0.55}
                    fill="#38bdf8"
                    fillOpacity={0.6}
                    stroke="#0ea5e9"
                    strokeOpacity={0.9}
                    strokeWidth={1}
                  />
                  <rect
                    x={radial - proj.wakeLength}
                    y={-proj.coreRadius * 0.35}
                    width={proj.wakeLength}
                    height={proj.coreRadius * 0.7}
                    fill="#6b7280"
                    fillOpacity={0.35}
                  />
                  <circle cx={radial} cy={0} r={3} fill={proj.color} />
                  <text
                    x={radial + proj.shockRadius + 6}
                    y={4}
                    className="fill-neutral-200 text-xs"
                  >
                    {proj.id}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <div className="flex flex-col gap-4 bg-neutral-900/70 border border-neutral-800 rounded-xl p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">Heliographic side view</p>
            <h3 className="text-lg font-semibold text-neutral-50">Latitudinal structure</h3>
            <p className="text-sm text-neutral-400 max-w-3xl">
              Latitudinal placement of each CME including shock, core, and wake envelopes. Latitude offsets are scaled for
              clarity; negative values are drawn south of the ecliptic plane.
            </p>
          </div>
          <div className="text-xs text-neutral-300">Sun → Earth direction</div>
        </div>

        <div className="relative overflow-hidden rounded-lg bg-gradient-to-b from-neutral-950 via-neutral-900 to-neutral-950 border border-neutral-800">
          <svg viewBox={`0 0 ${sideSize.width} ${sideSize.height}`} role="img" aria-label="Side view WSA-ENLIL propagation view">
            <line
              x1={60}
              y1={sideBaselineY}
              x2={sideSize.width - 40}
              y2={sideBaselineY}
              stroke="#475569"
              strokeDasharray="6 8"
            />
            <circle cx={60} cy={sideBaselineY} r={18} fill="url(#sunGlow)" />
            <text x={60} y={sideBaselineY - 26} className="fill-neutral-300 text-xs" textAnchor="middle">
              Sun
            </text>
            <circle cx={60 + scale} cy={sideBaselineY} r={6} fill="#60a5fa" />
            <text x={60 + scale} y={sideBaselineY + 20} className="fill-neutral-300 text-xs" textAnchor="middle">
              Earth orbit
            </text>

            {projections.map((proj) => {
              const x = 60 + proj.radialDistanceAu * scale;
              const latOffset = proj.latitude * 2; // exaggerate latitude for readability
              const y = sideBaselineY - latOffset;
              const shockHeight = proj.shockRadius * 0.9;
              const coreHeight = proj.coreRadius * 0.9;

              return (
                <g key={`side-${proj.id}`} className="transition-transform duration-300">
                  <ellipse
                    cx={x}
                    cy={y}
                    rx={proj.shockRadius}
                    ry={Math.max(10, Math.abs(shockHeight))}
                    fill={proj.color}
                    fillOpacity={0.22}
                    stroke={proj.color}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                  />
                  <ellipse
                    cx={x}
                    cy={y}
                    rx={proj.coreRadius}
                    ry={Math.max(8, Math.abs(coreHeight))}
                    fill="#38bdf8"
                    fillOpacity={0.55}
                    stroke="#0ea5e9"
                    strokeWidth={1}
                  />
                  <rect
                    x={x - proj.wakeLength}
                    y={y - Math.max(8, Math.abs(coreHeight)) * 0.55}
                    width={proj.wakeLength}
                    height={Math.max(14, Math.abs(coreHeight)) * 0.9}
                    fill="#6b7280"
                    fillOpacity={0.3}
                  />
                  <circle cx={x} cy={y} r={3} fill={proj.color} />
                  <text x={x + proj.shockRadius + 6} y={y - 4} className="fill-neutral-200 text-xs">
                    {proj.id}
                  </text>
                  <text x={x + proj.shockRadius + 6} y={y + 12} className="fill-neutral-400 text-[10px]">
                    {proj.latitude.toFixed(1)}°
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      </div>
    </div>
  );
};

export default WsaEnlil2DModel;
