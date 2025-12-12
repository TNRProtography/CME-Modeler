import React, { useEffect, useMemo, useState } from 'react';
import {
  CoronalHoleResponse,
  fetchCoronalHoleData,
  getCoronalHoleImageUrl,
} from '../services/coronalHoleService';

const BASE_WIND_SPEED = 420;
const CORONAL_HOLE_WIND_SPEED = 680;

const formatTimestamp = (timestamp?: string) => {
  if (!timestamp) return 'Not available';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZoneName: 'short',
  });
};

const buildSpiralPath = (size: number) => {
  const center = size / 2;
  const maxRadius = size * 0.48;
  const turns = 3.4;
  const stepDeg = 6;
  const points: string[] = [];

  for (let deg = 0; deg <= 360 * turns; deg += stepDeg) {
    const angle = (deg * Math.PI) / 180;
    const radius = (deg / (360 * turns)) * maxRadius;
    const x = center + radius * Math.cos(angle);
    const y = center + radius * Math.sin(angle);
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }

  return `M ${center},${center} L ${points.join(' ')}`;
};

const estimateHoleCoverage = (data: CoronalHoleResponse | null) => {
  if (!data || !data.coronal_holes_polygons.length) return 0;
  const xs = data.coronal_holes_polygons.map(p => p.x);
  const ys = data.coronal_holes_polygons.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const boundingArea = width * height;
  const totalArea = data.original_dimensions.width * data.original_dimensions.height;
  if (!totalArea) return 0;
  return Math.min(boundingArea / totalArea, 1);
};

const computeCentroid = (data: CoronalHoleResponse | null) => {
  if (!data || !data.coronal_holes_polygons.length) return null;
  const sum = data.coronal_holes_polygons.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  const count = data.coronal_holes_polygons.length;
  return { x: sum.x / count, y: sum.y / count };
};

type HoleStream = { path: string; speed: number };

const buildHoleStreams = (data: CoronalHoleResponse | null, viewBoxWidth: number, viewBoxHeight: number): HoleStream[] => {
  const center = { x: viewBoxWidth / 2, y: viewBoxHeight / 2 };
  const maxRadius = Math.min(viewBoxWidth, viewBoxHeight) * 0.48;

  if (!data || !data.coronal_holes_polygons.length) {
    // fallback: three evenly spaced faster streams
    return [0, 110, -90].map(angleDeg => {
      const angle = (angleDeg * Math.PI) / 180;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const start = {
        x: center.x + dir.x * (maxRadius * 0.15),
        y: center.y + dir.y * (maxRadius * 0.15),
      };
      const end = { x: center.x + dir.x * maxRadius, y: center.y + dir.y * maxRadius };
      const tangent = { x: -dir.y, y: dir.x };
      const c1 = {
        x: start.x + dir.x * (maxRadius * 0.2) + tangent.x * (maxRadius * 0.06),
        y: start.y + dir.y * (maxRadius * 0.2) + tangent.y * (maxRadius * 0.06),
      };
      const c2 = {
        x: start.x + dir.x * (maxRadius * 0.7) + tangent.x * (maxRadius * 0.12),
        y: start.y + dir.y * (maxRadius * 0.7) + tangent.y * (maxRadius * 0.12),
      };
      return { path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`, speed: CORONAL_HOLE_WIND_SPEED };
    });
  }

  const centroid = computeCentroid(data);
  if (!centroid) return [];

  const xs = data.coronal_holes_polygons.map(p => p.x);
  const ys = data.coronal_holes_polygons.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const samplePoints = [
    centroid,
    { x: minX, y: centroid.y },
    { x: maxX, y: centroid.y },
    { x: centroid.x, y: minY },
    { x: centroid.x, y: maxY },
  ];

  return samplePoints.map(point => {
    const dirRaw = { x: point.x - center.x, y: point.y - center.y };
    const len = Math.hypot(dirRaw.x, dirRaw.y) || 1;
    const dir = { x: dirRaw.x / len, y: dirRaw.y / len };
    const start = point;
    const end = { x: center.x + dir.x * maxRadius, y: center.y + dir.y * maxRadius };
    const tangent = { x: -dir.y, y: dir.x };
    const curvature = 0.1 + Math.min(len / maxRadius, 0.25);
    const c1 = {
      x: start.x + dir.x * (maxRadius * 0.22) + tangent.x * (maxRadius * curvature * 0.6),
      y: start.y + dir.y * (maxRadius * 0.22) + tangent.y * (maxRadius * curvature * 0.6),
    };
    const c2 = {
      x: start.x + dir.x * (maxRadius * 0.7) + tangent.x * (maxRadius * curvature * 1.2),
      y: start.y + dir.y * (maxRadius * 0.7) + tangent.y * (maxRadius * curvature * 1.2),
    };

    return { path: `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`, speed: CORONAL_HOLE_WIND_SPEED };
  });
};

const WsaEnlilPinwheel: React.FC = () => {
  const [coronalHoleData, setCoronalHoleData] = useState<CoronalHoleResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    fetchCoronalHoleData()
      .then(data => {
        if (isMounted) {
          setCoronalHoleData(data);
          setError(null);
        }
      })
      .catch(err => {
        console.error('Failed to fetch coronal hole data', err);
        if (isMounted) setError('Could not load coronal hole map. Please try again.');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const viewBoxWidth = coronalHoleData?.original_dimensions.width ?? 4096;
  const viewBoxHeight = coronalHoleData?.original_dimensions.height ?? 4096;

  const spiralPath = useMemo(() => buildSpiralPath(Math.max(viewBoxWidth, viewBoxHeight)), [viewBoxHeight, viewBoxWidth]);
  const holeCoverage = useMemo(() => estimateHoleCoverage(coronalHoleData), [coronalHoleData]);
  const holeStreams = useMemo(() => buildHoleStreams(coronalHoleData, viewBoxWidth, viewBoxHeight), [coronalHoleData, viewBoxHeight, viewBoxWidth]);

  const blendedSpeed = Math.round(
    BASE_WIND_SPEED + (CORONAL_HOLE_WIND_SPEED - BASE_WIND_SPEED) * Math.min(Math.max(holeCoverage, 0.1), 0.95)
  );

  return (
    <div className="w-full h-full overflow-auto bg-gradient-to-br from-neutral-950 via-black to-neutral-900 text-white">
      <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-4">
        <div className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.24em] text-amber-200/80">WSA-ENLIL Pinwheel</p>
          <h1 className="text-2xl md:text-3xl font-semibold text-white">Top-down solar wind view with coronal hole boosts</h1>
          <p className="text-sm text-neutral-300 max-w-3xl">
            This pinwheel stylizes WSA-ENLIL by combining a Parker spiral solar wind flow with the latest coronal hole outline.
            Instead of showing the footprint, the amber streams originate where the hole sits on the disk and arc outward to the
            1 AU ring, approximating the faster flow Earth-facing observers would see.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-black/60 shadow-2xl">
            <div
              className="absolute inset-0 opacity-25 mix-blend-screen"
              style={{
                backgroundImage: `url(${getCoronalHoleImageUrl()})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(255,255,255,0.04)_0,_transparent_55%)]" />
            <svg
              viewBox={`0 0 ${viewBoxWidth} ${viewBoxHeight}`}
              className="w-full h-[520px] md:h-[660px] relative z-10"
              preserveAspectRatio="xMidYMid meet"
            >
              <defs>
                <radialGradient id="sunGlow" cx="50%" cy="50%" r="55%">
                  <stop offset="0%" stopColor="#f8dba8" stopOpacity="0.95" />
                  <stop offset="55%" stopColor="#c47c2e" stopOpacity="0.65" />
                  <stop offset="100%" stopColor="#160b05" stopOpacity="0.2" />
                </radialGradient>
                <linearGradient id="windGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#a0e9ff" stopOpacity="0.7" />
                  <stop offset="50%" stopColor="#5ed3ff" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#1e9bff" stopOpacity="0.9" />
                </linearGradient>
                <linearGradient id="holeWindGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#ffba5f" stopOpacity="0.8" />
                  <stop offset="100%" stopColor="#ff5f6d" stopOpacity="0.9" />
                </linearGradient>
              </defs>

              <circle cx={viewBoxWidth / 2} cy={viewBoxHeight / 2} r={viewBoxWidth * 0.28} fill="url(#sunGlow)" opacity={0.9} />
              <g style={{ filter: 'drop-shadow(0 0 12px rgba(94, 211, 255, 0.25))' }}>
                <path
                  d={spiralPath}
                  fill="none"
                  stroke="url(#windGradient)"
                  strokeWidth={viewBoxWidth * 0.012}
                  strokeLinecap="round"
                  strokeOpacity={0.9}
                  className="animate-[spin_28s_linear_infinite] origin-center"
                />
                <path
                  d={spiralPath}
                  fill="none"
                  stroke="url(#windGradient)"
                  strokeWidth={viewBoxWidth * 0.006}
                  strokeDasharray="16 18"
                  strokeLinecap="round"
                  strokeOpacity={0.65}
                  className="animate-[spin_36s_linear_infinite_reverse] origin-center"
                />
              </g>

              <circle
                cx={viewBoxWidth / 2}
                cy={viewBoxHeight / 2}
                r={Math.min(viewBoxWidth, viewBoxHeight) * 0.48}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={viewBoxWidth * 0.002}
                strokeDasharray="6 12"
              />

              {holeStreams.map((stream, idx) => (
                <path
                  key={idx}
                  d={stream.path}
                  fill="none"
                  stroke="url(#holeWindGradient)"
                  strokeWidth={viewBoxWidth * 0.01}
                  strokeLinecap="round"
                  strokeOpacity={0.88}
                  className="animate-[pulse_5s_ease-in-out_infinite]"
                  style={{ animationDelay: `${idx * 0.4}s` }}
                />
              ))}

              <circle
                cx={viewBoxWidth * 0.85}
                cy={viewBoxHeight / 2}
                r={viewBoxWidth * 0.01}
                fill="#7cd1ff"
                stroke="#ffffff"
                strokeWidth={viewBoxWidth * 0.002}
              />
              <text
                x={viewBoxWidth * 0.86}
                y={viewBoxHeight / 2 - viewBoxWidth * 0.015}
                fontSize={viewBoxWidth * 0.022}
                fill="#c8e7ff"
                textAnchor="start"
              >
                Earth line of sight
              </text>

              <text
                x={viewBoxWidth / 2}
                y={viewBoxHeight * 0.08}
                fontSize={viewBoxWidth * 0.03}
                fill="#ffffff"
                textAnchor="middle"
                opacity={0.8}
              >
                Faster wind from coronal holes (amber)
              </text>
            </svg>

            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm text-neutral-200">
                <div className="flex items-center gap-3 text-sm font-medium">
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  <span>Loading coronal hole map…</span>
                </div>
              </div>
            )}
            {error && !isLoading && (
              <div className="absolute inset-x-4 bottom-4 bg-red-600/80 text-white text-sm px-4 py-3 rounded-xl border border-red-400/60 shadow-lg">
                {error}
              </div>
            )}
          </div>

          <div className="bg-neutral-900/70 border border-white/10 rounded-2xl p-4 md:p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-amber-200/70">Coronal holes</p>
                <h2 className="text-xl font-semibold text-white">Speed overlay</h2>
              </div>
              <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-amber-100">
                Top-down view
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-neutral-300 uppercase tracking-[0.14em]">Inside coronal hole</p>
                <p className="text-2xl font-semibold text-amber-200">{CORONAL_HOLE_WIND_SPEED} km/s</p>
                <p className="text-xs text-neutral-400 mt-1">Driven by open field regions detected on the disk-facing map.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-neutral-300 uppercase tracking-[0.14em]">Ambient solar wind</p>
                <p className="text-2xl font-semibold text-sky-200">{BASE_WIND_SPEED} km/s</p>
                <p className="text-xs text-neutral-400 mt-1">Outside the hole, the pinwheel follows a Parker spiral flow.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-amber-500/10 p-3 sm:col-span-2">
                <p className="text-xs text-amber-100 uppercase tracking-[0.14em]">Blended toward Earth</p>
                <p className="text-3xl font-semibold text-amber-200">~{blendedSpeed} km/s</p>
                <p className="text-xs text-amber-50/90 mt-1">
                  Estimated effective stream where the coronal hole is facing Earth right now.
                </p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-neutral-300">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-400" aria-hidden />
                <p>Amber streams: higher-speed wind emerging from the detected coronal hole region and arcing to 1 AU.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-sky-400" aria-hidden />
                <p>Blue spiral: nominal Parker spiral flow used in WSA-ENLIL style pinwheels.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-white/70 border border-white/20" aria-hidden />
                <p>Earth line-of-sight marker shows what is visible from our vantage point.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full border border-white/40" aria-hidden />
                <p>Dashed ring: the ~1 AU distance where streams are extrapolated toward Earth.</p>
              </div>
            </div>

            <div className="text-xs text-neutral-400 space-y-1">
              <p>
                Source image: <span className="text-neutral-200">{coronalHoleData?.source ?? 'Pending'}</span>
              </p>
              <p>Updated: {formatTimestamp(coronalHoleData?.timestamp)}</p>
              <p className="text-neutral-500">Endpoint: https://ch-locator.thenamesrock.workers.dev</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WsaEnlilPinwheel;
