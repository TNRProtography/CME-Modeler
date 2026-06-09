import React, { useMemo } from 'react';
import type { StereoPosition, TrackerCmeCandidate } from '../services/stereoCmeTracker';

interface StereoCmeGeometryProps {
  stereo: StereoPosition | null;
  cme: TrackerCmeCandidate | null;
}

const CENTER = 150;
const SCALE = 105;

const polarToSvg = (radiusAu: number, longitudeDeg: number) => {
  const radians = (longitudeDeg * Math.PI) / 180;
  return {
    x: CENTER + radiusAu * SCALE * Math.cos(radians),
    y: CENTER - radiusAu * SCALE * Math.sin(radians),
  };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const describeValue = (value: number | null | undefined, suffix = '') => (
  typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(value < 10 ? 2 : 0)}${suffix}` : 'Unavailable'
);

const StereoCmeGeometry: React.FC<StereoCmeGeometryProps> = ({ stereo, cme }) => {
  const earth = polarToSvg(1, 0);
  const stereoLongitude = stereo?.longitudeDeg ?? stereo?.separationDeg ?? null;
  const stereoRadius = stereo?.distanceAu ?? 1;
  const stereoPoint = stereoLongitude != null ? polarToSvg(stereoRadius, stereoLongitude) : null;

  const cone = useMemo(() => {
    if (!cme || cme.longitude == null || cme.halfAngle == null) return null;
    if (!Number.isFinite(cme.longitude) || !Number.isFinite(cme.halfAngle)) return null;
    const halfAngle = clamp(cme.halfAngle, 5, 80);
    const frontAu = cme.front?.distanceAu ?? 0.55;
    const displayRadius = clamp(frontAu, 0.18, 1.2);
    const start = polarToSvg(displayRadius, cme.longitude - halfAngle);
    const end = polarToSvg(displayRadius, cme.longitude + halfAngle);
    const largeArc = halfAngle * 2 > 180 ? 1 : 0;
    return {
      wedgePath: `M ${CENTER} ${CENTER} L ${start.x} ${start.y} A ${displayRadius * SCALE} ${displayRadius * SCALE} 0 ${largeArc} 0 ${end.x} ${end.y} Z`,
      frontPath: `M ${start.x} ${start.y} A ${displayRadius * SCALE} ${displayRadius * SCALE} 0 ${largeArc} 0 ${end.x} ${end.y}`,
      labelPoint: polarToSvg(Math.min(1.12, displayRadius + 0.08), cme.longitude),
      frontAu: displayRadius,
    };
  }, [cme]);

  return (
    <div className="bg-neutral-950/60 rounded-xl border border-neutral-800 overflow-hidden">
      <svg viewBox="0 0 300 300" role="img" aria-label="Top-down ecliptic-plane sketch of Sun, Earth, STEREO-A, and recent CME geometry" className="w-full max-h-[390px] bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.08),rgba(10,10,10,0.95)_62%)]">
        <defs>
          <radialGradient id="sunGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fde68a" />
            <stop offset="60%" stopColor="#f97316" />
            <stop offset="100%" stopColor="#7c2d12" />
          </radialGradient>
          <filter id="softGlow">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx={CENTER} cy={CENTER} r={SCALE} fill="none" stroke="#3f3f46" strokeWidth="1.2" strokeDasharray="4 4" />
        <circle cx={CENTER} cy={CENTER} r={SCALE * 0.5} fill="none" stroke="#27272a" strokeWidth="0.8" strokeDasharray="2 5" />
        <line x1={CENTER} y1={CENTER} x2={CENTER + SCALE * 1.23} y2={CENTER} stroke="#52525b" strokeWidth="1" strokeDasharray="3 4" />
        <text x={CENTER + SCALE * 1.08} y={CENTER - 7} fill="#a1a1aa" fontSize="9">Earth line</text>

        {cone && (
          <g>
            <path d={cone.wedgePath} fill="rgba(251,146,60,0.18)" stroke="rgba(251,146,60,0.55)" strokeWidth="1" />
            <path d={cone.frontPath} fill="none" stroke="#fb923c" strokeWidth="2.2" strokeLinecap="round" strokeDasharray={cme?.front ? 'none' : '5 4'} />
            <text x={cone.labelPoint.x} y={cone.labelPoint.y} fill="#fdba74" fontSize="9" textAnchor="middle">CME</text>
          </g>
        )}

        <circle cx={CENTER} cy={CENTER} r="12" fill="url(#sunGlow)" filter="url(#softGlow)" />
        <text x={CENTER} y={CENTER + 27} textAnchor="middle" fill="#fed7aa" fontSize="10" fontWeight="600">Sun</text>

        <circle cx={earth.x} cy={earth.y} r="5.5" fill="#38bdf8" stroke="#bae6fd" strokeWidth="1.5" />
        <text x={earth.x + 9} y={earth.y - 8} fill="#bae6fd" fontSize="10" fontWeight="600">Earth · 1 AU</text>

        {stereoPoint ? (
          <g>
            <circle cx={CENTER} cy={CENTER} r={stereoRadius * SCALE} fill="none" stroke="rgba(168,85,247,0.3)" strokeWidth="1" strokeDasharray="2 6" />
            <circle cx={stereoPoint.x} cy={stereoPoint.y} r="5" fill="#a855f7" stroke="#e9d5ff" strokeWidth="1.4" />
            <text x={stereoPoint.x + 8} y={stereoPoint.y + (stereoPoint.y < CENTER ? -8 : 14)} fill="#e9d5ff" fontSize="10" fontWeight="600">STEREO-A</text>
          </g>
        ) : (
          <text x="150" y="286" textAnchor="middle" fill="#a1a1aa" fontSize="10">STEREO-A position unavailable</text>
        )}

        {!cone && cme && (
          <text x="150" y="25" textAnchor="middle" fill="#fbbf24" fontSize="10">CME listed, but geometry is not precise enough to draw a cone</text>
        )}
      </svg>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3 border-t border-neutral-800 text-xs">
        <div><span className="text-neutral-500">Earth</span><p className="text-sky-200 font-medium">1.00 AU · 0°</p></div>
        <div><span className="text-neutral-500">STEREO-A r</span><p className="text-purple-200 font-medium">{describeValue(stereo?.distanceAu, ' AU')}</p></div>
        <div><span className="text-neutral-500">STEREO-A lon</span><p className="text-purple-200 font-medium">{describeValue(stereoLongitude, '°')}</p></div>
        <div><span className="text-neutral-500">CME front</span><p className="text-orange-200 font-medium">{cme?.front ? `${cme.front.distanceAu.toFixed(2)} AU` : 'Not drawn'}</p></div>
      </div>
    </div>
  );
};

export default StereoCmeGeometry;
