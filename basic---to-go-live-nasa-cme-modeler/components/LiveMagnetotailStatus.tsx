import React, { useMemo } from 'react';
import type { SubstormRiskData } from '../hooks/useForecastData';
import { computeOvalParams, gmagToGeoLat, ovalColour, ovalCoreColour } from '../utils/auroraOvalGeometry';
import { SPACE_TEXTURES } from '../utils/spaceTextures';

type MagneticPoint = { time: number; bt: number; bz: number; by: number; bx: number; clock: number | null };
type ScalarPoint = { x: number; y: number };
type LatLon = [number, number];

interface LiveMagnetotailStatusProps {
  substormRiskData: SubstormRiskData | null;
  magneticData: MagneticPoint[];
  speedData: ScalarPoint[];
  densityData: ScalarPoint[];
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const latestBy = <T extends { x?: number; time?: number }>(series: T[]): T | null => {
  let best: T | null = null;
  let bestTime = -Infinity;
  for (const point of series) {
    const t = point.time ?? point.x;
    if (finite(t) && t > bestTime) {
      best = point;
      bestTime = t;
    }
  }
  return best;
};

const fmt = (value: number | null | undefined, digits = 1) => finite(value) ? value.toFixed(digits) : '—';

const formatUpdated = (iso?: string) => {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const ageMin = Math.max(0, Math.round((Date.now() - t) / 60000));
  return `${ageMin} min ago`;
};

const includesAny = (value: string | undefined, tokens: string[]) => {
  const lower = (value ?? '').toLowerCase();
  return tokens.some(token => lower.includes(token));
};

const EARTH_CX = 255;
const EARTH_CY = 165;
const EARTH_R = 52;
const NZ_CENTER_LON = 174;
const NZ_CENTER_LAT = -43;
const EARTH_TEXTURE_WIDTH = 358;
const EARTH_TEXTURE_HEIGHT = 179;
// Match the SVG lat/lon projection to the equirectangular Earth texture scale.
// This keeps the NZ overlay, aurora oval, and texture landmasses registered.
const NZ_LON_SPAN = (EARTH_R * 2 / EARTH_TEXTURE_WIDTH) * 360;
const NZ_LAT_SPAN = (EARTH_R * 2 / EARTH_TEXTURE_HEIGHT) * 180;
const EARTH_TEXTURE_X = EARTH_CX - ((NZ_CENTER_LON + 180) / 360) * EARTH_TEXTURE_WIDTH;
const EARTH_TEXTURE_Y = EARTH_CY - ((90 - NZ_CENTER_LAT) / 180) * EARTH_TEXTURE_HEIGHT;

const wrapLonDelta = (lon: number, center = NZ_CENTER_LON) => {
  let delta = lon - center;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
};

const projectNzView = ([lat, lon]: LatLon) => ({
  x: EARTH_CX + (wrapLonDelta(lon) / (NZ_LON_SPAN / 2)) * EARTH_R,
  y: EARTH_CY - ((lat - NZ_CENTER_LAT) / (NZ_LAT_SPAN / 2)) * EARTH_R,
});

const pathFromLatLon = (points: LatLon[], close = false) => {
  if (!points.length) return '';
  const projected = points.map(projectNzView);
  return projected.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ') + (close ? ' Z' : '');
};

const buildGmagSegment = (gmagLat: number, lonStart = 122, lonEnd = 214, lonStep = 2): LatLon[] => {
  const points: LatLon[] = [];
  for (let lon = lonStart; lon <= lonEnd; lon += lonStep) {
    const normLon = ((lon + 180) % 360) - 180;
    points.push([gmagToGeoLat(gmagLat, normLon), lon]);
  }
  return points;
};

const buildGmagBandSegment = (g0: number, g1: number): LatLon[] => {
  const outer = buildGmagSegment(g1, 122, 214, 2);
  const inner = buildGmagSegment(g0, 122, 214, 2).reverse();
  return [...outer, ...inner];
};

const NZ_LABEL = projectNzView([-37.2, 180.2]);

const NZ_LAND: LatLon[][] = [
  // North Island — simplified outline, enough to read clearly at dashboard scale.
  [
    [-34.45, 172.70], [-35.05, 173.55], [-35.72, 174.45], [-36.42, 175.25], [-37.05, 175.95],
    [-37.80, 177.10], [-38.63, 178.30], [-39.27, 177.85], [-39.72, 176.95], [-40.25, 176.35],
    [-40.85, 175.55], [-41.32, 174.78], [-40.95, 174.05], [-40.25, 173.65], [-39.45, 173.95],
    [-38.55, 174.35], [-37.65, 174.55], [-36.85, 174.12], [-36.25, 173.45], [-35.35, 172.85],
  ],
  // South Island.
  [
    [-40.58, 172.75], [-41.25, 173.45], [-41.93, 174.16], [-42.62, 173.80], [-43.30, 172.92],
    [-44.02, 171.85], [-44.82, 170.95], [-45.58, 170.12], [-46.26, 169.38], [-46.82, 168.45],
    [-46.48, 167.58], [-45.60, 166.80], [-44.72, 167.42], [-43.80, 168.20], [-42.96, 169.10],
    [-42.16, 170.05], [-41.48, 171.10], [-40.86, 172.05],
  ],
  // Stewart Island / Rakiura.
  [[-46.72, 167.55], [-47.02, 168.05], [-47.28, 168.55], [-47.08, 169.02], [-46.72, 168.75], [-46.55, 168.12]],
];

const LiveMagnetotailStatus: React.FC<LiveMagnetotailStatusProps> = ({
  substormRiskData,
  magneticData,
  speedData,
  densityData,
}) => {
  const latestMag = useMemo(() => latestBy(magneticData), [magneticData]);
  const latestSpeed = useMemo(() => latestBy(speedData), [speedData]);
  const latestDensity = useMemo(() => latestBy(densityData), [densityData]);

  const model = useMemo(() => {
    const sw = substormRiskData?.metrics?.solar_wind;
    const current = substormRiskData?.current;
    const bz = sw?.bz ?? latestMag?.bz ?? null;
    const bt = sw?.bt ?? latestMag?.bt ?? null;
    const speed = sw?.speed ?? latestSpeed?.y ?? null;
    const density = sw?.density ?? latestDensity?.y ?? null;
    const pressure = sw?.dynamic_pressure_nPa ?? (finite(speed) && finite(density) ? 1.6726e-6 * density * speed * speed : null);
    const score = current?.score ?? 0;
    const level = current?.level ?? 'No live score';
    const trend = current?.risk_trend ?? 'Stable';
    const loadingScore = sw?.solar_loading_score ?? score;
    const southwardMinutes = sw?.southward_minutes_30m ?? 0;
    const newell = sw?.newell_coupling_now ?? 0;

    const compression = clamp(((pressure ?? 0) - 0.5) / 7.5 + Math.max(0, (bt ?? 0) - 5) / 45);
    const tailStretch = clamp((loadingScore / 100) * 0.65 + (southwardMinutes / 30) * 0.25 + clamp((newell - 2500) / 9000) * 0.25);
    const imminentKeywords = includesAny(level, ['onset', 'imminent', '15']);
    const rapidlyIncreasing = trend === 'Rapidly Increasing' || trend === 'Increasing';
    const snap = Boolean(current?.bay_onset_flag || imminentKeywords || score >= 82 || (score >= 75 && rapidlyIncreasing));
    const status = snap
      ? 'Tail snap likely / underway'
      : tailStretch >= 0.7
        ? 'Tail highly loaded'
        : tailStretch >= 0.4
          ? 'Tail loading'
          : compression >= 0.45
            ? 'Dayside compressed'
            : 'Quiet / relaxed';

    return { bz, bt, speed, density, pressure, score, level, trend, compression, tailStretch, snap, status };
  }, [latestDensity, latestMag, latestSpeed, substormRiskData]);

  const oval = useMemo(() => {
    const metrics = substormRiskData?.metrics;
    if (!metrics) return null;

    const score = substormRiskData.current?.score ?? 0;
    const { boundary, halfWidth } = computeOvalParams(metrics, Boolean(substormRiskData.current?.bay_onset_flag), score);
    const poleward = boundary - halfWidth;
    const equatorward = boundary;
    const core = ovalCoreColour(score);
    const { line } = ovalColour(score);
    const bandLayers = 8;
    const globalAlpha = Math.min(score / 20, 1);

    const bands = Array.from({ length: bandLayers }, (_, i) => {
      const t0 = i / bandLayers;
      const t1 = (i + 1) / bandLayers;
      const g0 = poleward + t0 * halfWidth;
      const g1 = poleward + t1 * halfWidth;
      const midT = (t0 + t1) / 2;
      const envelope = Math.exp(-Math.pow((midT - 0.5) / 0.28, 2));
      const edge = '#34d399';
      const colour = midT > 0.35 && midT < 0.65 ? core : edge;

      return {
        d: pathFromLatLon(buildGmagBandSegment(g0, g1), true),
        colour,
        opacity: envelope * 0.5 * globalAlpha,
      };
    });

    const visibilityDeg = 9.0 + (Math.max(0, Math.min(score, 100)) / 100) * 16.0;

    return {
      bands,
      line,
      polewardD: pathFromLatLon(buildGmagSegment(poleward)),
      equatorwardD: pathFromLatLon(buildGmagSegment(equatorward)),
      visibilityD: pathFromLatLon(buildGmagSegment(equatorward + visibilityDeg)),
      visibilityOpacity: 0.3 + (score / 100) * 0.45,
      visibilityWeight: 1 + (score / 100),
    };
  }, [substormRiskData]);

  const noseX = 240 - model.compression * 42;
  const dayCurveOuter = 201 - model.compression * 38;
  const dayCurveMid = 222 - model.compression * 28;
  const tailEnd = 382 + model.tailStretch * 120;
  const tailMid = 342 + model.tailStretch * 74;
  const tailThickness = 34 + model.tailStretch * 30;
  const loadingOpacity = 0.22 + model.tailStretch * 0.63;
  const updated = formatUpdated(substormRiskData?.updated_utc ?? substormRiskData?.current?.timestamp_utc);
  const statusTone = model.snap
    ? 'border-red-400/40 bg-red-500/10 text-red-100'
    : model.tailStretch >= 0.7
      ? 'border-amber-400/40 bg-amber-500/10 text-amber-100'
      : 'border-neutral-700/70 bg-neutral-900/70 text-neutral-200';

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
      <style>{`
        @keyframes magnetotailFlow { to { stroke-dashoffset: -150; } }
        @keyframes magnetotailSnap { 0%, 30%, 100% { transform: scaleX(1); } 45% { transform: scaleX(.54); } 62% { transform: scaleX(.82); } }
        @keyframes magnetotailPlasmoid { 0%, 32% { opacity: 0; transform: translateX(0); } 45% { opacity: .9; } 100% { opacity: 0; transform: translateX(90px); } }
        @keyframes magnetotailFlash { 0%, 32%, 100% { opacity: 0; transform: scale(.45); } 45% { opacity: 1; transform: scale(1.12); } 62% { opacity: 0; transform: scale(1.55); } }
      `}</style>

      <div className="flex flex-col lg:flex-row lg:items-start gap-4 mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-semibold text-white">Live Magnetotail Status</h3>
          <p className="text-sm text-neutral-400 mt-1 max-w-3xl">
            Live L1 solar-wind and substorm-worker data drive the magnetopause compression, tail loading, New Zealand-centred aurora oval, and snap animation when an onset is likely soon or already underway.
          </p>
        </div>
        <div className={`rounded-lg border px-4 py-3 min-w-[150px] ${statusTone}`}>
          <div className="text-xs uppercase tracking-wide text-neutral-400">Now</div>
          <div className="text-lg font-semibold">{model.status}</div>
          <div className="text-xs text-neutral-400">Updated {updated}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-4 items-stretch">
        <div className="relative rounded-lg border border-neutral-800 bg-neutral-950 overflow-hidden min-h-[330px]">
          <svg viewBox="0 0 560 330" role="img" aria-label="Live New Zealand aurora oval and magnetotail visualization" className="w-full h-full min-h-[330px]">
            <defs>
              <clipPath id="liveEarthClip"><circle cx={EARTH_CX} cy={EARTH_CY} r={EARTH_R} /></clipPath>
              <radialGradient id="earthShade" cx="36%" cy="30%" r="68%"><stop offset="0%" stopColor="rgba(255,255,255,.22)"/><stop offset="58%" stopColor="rgba(255,255,255,0)"/><stop offset="100%" stopColor="rgba(0,0,0,.55)"/></radialGradient>
              <linearGradient id="tailGlow" x1="0" x2="1"><stop offset="0" stopColor="#38bdf8" stopOpacity=".13"/><stop offset="1" stopColor="#a855f7" stopOpacity={model.snap ? '.24' : '.08'}/></linearGradient>
              <filter id="softGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>

            <rect width="560" height="330" fill="#05070d" />
            {Array.from({ length: 38 }).map((_, i) => <circle key={i} cx={(i * 73) % 560} cy={(i * 41) % 330} r={(i % 3) * 0.35 + 0.45} fill="white" opacity={0.10 + (i % 5) * 0.035} />)}

            <g stroke="#64748b" strokeWidth="1.2" fill="none" strokeDasharray="5 10" opacity=".45" style={{ animation: 'magnetotailFlow 6s linear infinite' }}>
              <path d="M18 132 C 92 126, 150 132, 206 151" />
              <path d="M18 165 C 92 165, 151 165, 211 165" />
              <path d="M18 198 C 92 204, 150 198, 206 179" />
            </g>

            <path d={`M${noseX} 56 C 152 96, 151 234, ${noseX} 274 C ${tailMid} ${246 + tailThickness}, ${tailEnd} ${236 + tailThickness}, 558 250 L558 80 C ${tailEnd} ${94 - tailThickness}, ${tailMid} ${84 - tailThickness}, ${noseX} 56Z`} fill="url(#tailGlow)" stroke="#475569" strokeOpacity=".75" strokeWidth="1.1" />

            <g stroke="#94a3b8" fill="none" strokeLinecap="round">
              <path d={`M248 135 C ${dayCurveMid} 142, ${dayCurveMid} 188, 248 195`} opacity=".75" strokeWidth="1.4" />
              <path d={`M247 128 C ${dayCurveOuter} 137, ${dayCurveOuter} 193, 247 202`} opacity=".55" strokeWidth="1.2" />
              <path d={`M246 121 C ${dayCurveOuter - 21} 132, ${dayCurveOuter - 21} 198, 246 209`} opacity=".32" strokeWidth="1" />
            </g>

            <g stroke="#cbd5e1" fill="none" strokeLinecap="round" style={{ transformBox: 'view-box', transformOrigin: '260px 165px', animation: model.snap ? 'magnetotailSnap 3s ease-in-out infinite' : undefined }}>
              <path d={`M264 137 C ${318 + model.tailStretch * 36} 137, ${tailMid} 146, ${tailEnd - 28} 165 C ${tailMid} 184, ${318 + model.tailStretch * 36} 193, 264 193`} opacity={loadingOpacity} strokeWidth="1.7" />
              <path d={`M265 126 C ${330 + model.tailStretch * 44} 127, ${tailMid + 30} 140, ${tailEnd} 165 C ${tailMid + 30} 190, ${330 + model.tailStretch * 44} 203, 265 204`} opacity={loadingOpacity * 0.72} strokeWidth="1.25" />
            </g>

            <ellipse cx={tailEnd - 6} cy="165" rx="18" ry="28" fill="none" stroke="#fda4af" strokeWidth="1.6" opacity="0" style={{ transformBox: 'view-box', transformOrigin: '0 0', animation: model.snap ? 'magnetotailPlasmoid 3s ease-in infinite' : undefined }} />

            <g opacity={model.snap ? 1 : 0} style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: model.snap ? 'magnetotailFlash 3s ease-out infinite' : undefined }} filter="url(#softGlow)">
              <line x1={tailEnd - 54} y1="151" x2={tailEnd - 26} y2="179" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
              <line x1={tailEnd - 26} y1="151" x2={tailEnd - 54} y2="179" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
            </g>

            <g clipPath="url(#liveEarthClip)">
              <image href={SPACE_TEXTURES.EARTH_DAY} x={EARTH_TEXTURE_X} y={EARTH_TEXTURE_Y} width={EARTH_TEXTURE_WIDTH} height={EARTH_TEXTURE_HEIGHT} preserveAspectRatio="none" opacity=".95" />
              <image href={SPACE_TEXTURES.EARTH_DAY} x={EARTH_TEXTURE_X + EARTH_TEXTURE_WIDTH} y={EARTH_TEXTURE_Y} width={EARTH_TEXTURE_WIDTH} height={EARTH_TEXTURE_HEIGHT} preserveAspectRatio="none" opacity=".95" />
              <rect x={EARTH_CX - EARTH_R} y={EARTH_CY - EARTH_R} width={EARTH_R * 2} height={EARTH_R * 2} fill="#020617" opacity=".18" />

              {oval?.bands.map((band, index) => <path key={index} d={band.d} fill={band.colour} fillOpacity={band.opacity} stroke="none" />)}
              {oval && <path d={oval.polewardD} fill="none" stroke={oval.line} strokeWidth="1" strokeOpacity=".38" strokeDasharray="4 5" />}
              {oval && <path d={oval.equatorwardD} fill="none" stroke={oval.line} strokeWidth="2.2" strokeOpacity=".92" />}
              {oval && <path d={oval.visibilityD} fill="none" stroke="#38bdf8" strokeWidth={oval.visibilityWeight} strokeOpacity={oval.visibilityOpacity} strokeDasharray="2 6" />}

              {NZ_LAND.map((island, index) => (
                <path key={index} d={pathFromLatLon(island, true)} fill="#5f7f48" stroke="#d9f99d" strokeWidth="0.8" strokeOpacity=".85" />
              ))}
            </g>
            <circle cx={EARTH_CX} cy={EARTH_CY} r={EARTH_R} fill="url(#earthShade)" />
            <circle cx={EARTH_CX} cy={EARTH_CY} r={EARTH_R + 1} fill="none" stroke="#93c5fd" strokeOpacity=".45" />
            <text x={NZ_LABEL.x} y={NZ_LABEL.y} fill="#e5e7eb" fontSize="8" fontWeight="600">NZ</text>

            <text x="24" y="30" fill="#94a3b8" fontSize="11" letterSpacing="2">SOLAR WIND</text>
            <text x="224" y="100" fill="#94a3b8" fontSize="11" letterSpacing="2">EARTH</text>
            <text x="390" y="112" fill="#94a3b8" fontSize="11" letterSpacing="2">MAGNETOTAIL</text>
            <text x="26" y="302" fill="#94a3b8" fontSize="12">Bz {fmt(model.bz)} nT · Pressure {fmt(model.pressure, 2)} nPa · Score {Math.round(model.score)}</text>
          </svg>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-1 gap-3 text-sm">
          <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/70 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-400">Compression</div>
            <div className="text-2xl font-bold text-white mt-1">{Math.round(model.compression * 100)}%</div>
            <div className="h-2 bg-neutral-700 rounded-full mt-3 overflow-hidden"><div className="h-full bg-sky-400" style={{ width: `${Math.round(model.compression * 100)}%` }} /></div>
          </div>
          <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/70 p-4">
            <div className="text-xs uppercase tracking-wide text-neutral-400">Tail loading</div>
            <div className="text-2xl font-bold text-white mt-1">{Math.round(model.tailStretch * 100)}%</div>
            <div className="h-2 bg-neutral-700 rounded-full mt-3 overflow-hidden"><div className="h-full bg-amber-300" style={{ width: `${Math.round(model.tailStretch * 100)}%` }} /></div>
          </div>
          <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/70 p-4 col-span-2 xl:col-span-1">
            <div className="text-xs uppercase tracking-wide text-neutral-400">Substorm call</div>
            <div className={`text-lg font-semibold mt-1 ${model.snap ? 'text-red-200' : 'text-white'}`}>{model.snap ? 'Snap window active' : model.level}</div>
            <div className="text-xs text-neutral-400 mt-1">Trend: {model.trend}</div>
          </div>
          <div className="rounded-lg border border-neutral-700/60 bg-neutral-900/70 p-4 col-span-2 xl:col-span-1">
            <div className="text-xs uppercase tracking-wide text-neutral-400">Live drivers</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-neutral-300">
              <span>Bz</span><span className="text-right tabular-nums">{fmt(model.bz)} nT</span>
              <span>Bt</span><span className="text-right tabular-nums">{fmt(model.bt)} nT</span>
              <span>Speed</span><span className="text-right tabular-nums">{fmt(model.speed, 0)} km/s</span>
              <span>Density</span><span className="text-right tabular-nums">{fmt(model.density)} p/cm³</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveMagnetotailStatus;
