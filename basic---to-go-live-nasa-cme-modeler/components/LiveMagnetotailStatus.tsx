import React, { useMemo } from 'react';
import type { SubstormRiskData } from '../hooks/useForecastData';
import { SPACE_TEXTURES } from '../utils/spaceTextures';

type MagneticPoint = { time: number; bt: number; bz: number; by: number; bx: number; clock: number | null };
type ScalarPoint = { x: number; y: number };

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
  }, [densityData, latestDensity, latestMag, latestSpeed, magneticData, speedData, substormRiskData]);

  const noseX = 240 - model.compression * 42;
  const dayCurveOuter = 201 - model.compression * 38;
  const dayCurveMid = 222 - model.compression * 28;
  const tailEnd = 382 + model.tailStretch * 120;
  const tailMid = 342 + model.tailStretch * 74;
  const tailThickness = 34 + model.tailStretch * 30;
  const loadingOpacity = 0.2 + model.tailStretch * 0.65;
  const updated = formatUpdated(substormRiskData?.updated_utc ?? substormRiskData?.current?.timestamp_utc);

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4 md:p-5 overflow-hidden">
      <style>{`
        @keyframes magnetotailFlow { to { stroke-dashoffset: -150; } }
        @keyframes magnetotailSnap { 0%, 30%, 100% { transform: scaleX(1); } 45% { transform: scaleX(.54); } 62% { transform: scaleX(.82); } }
        @keyframes magnetotailPlasmoid { 0%, 32% { opacity: 0; transform: translateX(0); } 45% { opacity: .9; } 100% { opacity: 0; transform: translateX(90px); } }
        @keyframes magnetotailFlash { 0%, 32%, 100% { opacity: 0; transform: scale(.45); } 45% { opacity: 1; transform: scale(1.12); } 62% { opacity: 0; transform: scale(1.55); } }
        @keyframes auroraPulse { 0%, 100% { opacity: .18; } 50% { opacity: .95; } }
      `}</style>

      <div className="flex flex-col lg:flex-row lg:items-start gap-4 mb-4">
        <div className="flex-1">
          <div className="text-xs uppercase tracking-[0.24em] text-sky-300/80 font-semibold">Live magnetotail status</div>
          <h3 className="text-2xl font-bold text-white mt-1">Earth’s magnetic tail — live loading model</h3>
          <p className="text-sm text-neutral-400 mt-2 max-w-3xl">
            This uses the app’s live substorm worker plus L1 solar-wind inputs to show dayside compression, tail stretching, and a snap animation when the model flags a substorm as imminent in the next ~15 minutes or already starting.
          </p>
        </div>
        <div className={`rounded-2xl px-4 py-3 border ${model.snap ? 'bg-red-500/15 border-red-400/50 text-red-100' : model.tailStretch >= 0.7 ? 'bg-amber-500/15 border-amber-300/40 text-amber-100' : 'bg-sky-500/10 border-sky-300/30 text-sky-100'}`}>
          <div className="text-xs uppercase tracking-widest opacity-70">Now</div>
          <div className="text-lg font-bold">{model.status}</div>
          <div className="text-xs opacity-75">Updated {updated}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_270px] gap-5 items-stretch">
        <div className="relative rounded-2xl border border-white/10 bg-[#070a12] overflow-hidden min-h-[330px]">
          <svg viewBox="0 0 560 330" role="img" aria-label="Live magnetosphere and magnetotail visualization" className="w-full h-full min-h-[330px]">
            <defs>
              <clipPath id="liveEarthClip"><circle cx="255" cy="165" r="38" /></clipPath>
              <radialGradient id="earthShade" cx="38%" cy="32%" r="64%"><stop offset="0%" stopColor="rgba(255,255,255,.18)"/><stop offset="62%" stopColor="rgba(255,255,255,0)"/><stop offset="100%" stopColor="rgba(0,0,0,.45)"/></radialGradient>
              <linearGradient id="tailGlow" x1="0" x2="1"><stop offset="0" stopColor="#93c5fd" stopOpacity=".13"/><stop offset="1" stopColor="#fb7185" stopOpacity={model.snap ? '.26' : '.06'}/></linearGradient>
              <filter id="softGlow"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            </defs>

            <rect width="560" height="330" fill="#070a12" />
            {Array.from({ length: 38 }).map((_, i) => <circle key={i} cx={(i * 73) % 560} cy={(i * 41) % 330} r={(i % 3) * 0.35 + 0.45} fill="white" opacity={0.12 + (i % 5) * 0.04} />)}

            <g stroke="#94a3b8" strokeWidth="1.2" fill="none" strokeDasharray="5 10" opacity=".34" style={{ animation: 'magnetotailFlow 6s linear infinite' }}>
              <path d="M18 132 C 92 126, 150 132, 206 151" />
              <path d="M18 165 C 92 165, 151 165, 211 165" />
              <path d="M18 198 C 92 204, 150 198, 206 179" />
            </g>

            <path d={`M${noseX} 56 C 152 96, 151 234, ${noseX} 274 C ${tailMid} ${246 + tailThickness}, ${tailEnd} ${236 + tailThickness}, 558 250 L558 80 C ${tailEnd} ${94 - tailThickness}, ${tailMid} ${84 - tailThickness}, ${noseX} 56Z`} fill="url(#tailGlow)" stroke="#cbd5e1" strokeOpacity=".22" strokeWidth="1.1" />

            <g stroke="#cbd5e1" fill="none" strokeLinecap="round">
              <path d={`M248 135 C ${dayCurveMid} 142, ${dayCurveMid} 188, 248 195`} opacity=".8" strokeWidth="1.4" />
              <path d={`M247 128 C ${dayCurveOuter} 137, ${dayCurveOuter} 193, 247 202`} opacity=".55" strokeWidth="1.2" />
              <path d={`M246 121 C ${dayCurveOuter - 21} 132, ${dayCurveOuter - 21} 198, 246 209`} opacity=".32" strokeWidth="1" />
            </g>

            <g stroke="#cbd5e1" fill="none" strokeLinecap="round" style={{ transformBox: 'view-box', transformOrigin: '260px 165px', animation: model.snap ? 'magnetotailSnap 3s ease-in-out infinite' : undefined }}>
              <path d={`M264 137 C ${318 + model.tailStretch * 36} 137, ${tailMid} 146, ${tailEnd - 28} 165 C ${tailMid} 184, ${318 + model.tailStretch * 36} 193, 264 193`} opacity={loadingOpacity} strokeWidth="1.7" />
              <path d={`M265 126 C ${330 + model.tailStretch * 44} 127, ${tailMid + 30} 140, ${tailEnd} 165 C ${tailMid + 30} 190, ${330 + model.tailStretch * 44} 203, 265 204`} opacity={loadingOpacity * 0.7} strokeWidth="1.25" />
            </g>

            <ellipse cx={tailEnd - 6} cy="165" rx="18" ry="28" fill="none" stroke="#fda4af" strokeWidth="1.6" opacity="0" style={{ transformBox: 'view-box', transformOrigin: '0 0', animation: model.snap ? 'magnetotailPlasmoid 3s ease-in infinite' : undefined }} />

            <g opacity={model.snap ? 1 : 0} style={{ transformBox: 'fill-box', transformOrigin: 'center', animation: model.snap ? 'magnetotailFlash 3s ease-out infinite' : undefined }} filter="url(#softGlow)">
              <line x1={tailEnd - 54} y1="151" x2={tailEnd - 26} y2="179" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
              <line x1={tailEnd - 26} y1="151" x2={tailEnd - 54} y2="179" stroke="#fb7185" strokeWidth="3" strokeLinecap="round" />
            </g>

            <g opacity={model.snap ? .82 : .22} stroke="#86efac" fill="none" strokeLinecap="round" style={{ animation: model.snap ? 'auroraPulse 3s ease-in-out infinite' : undefined }}>
              <path d="M226 130 A 34 13 0 0 1 284 130" strokeWidth="4" />
              <path d="M225 200 A 34 13 0 0 0 285 200" strokeWidth="4" />
            </g>

            <image href={SPACE_TEXTURES.EARTH_DAY} x="217" y="127" width="76" height="76" clipPath="url(#liveEarthClip)" preserveAspectRatio="xMidYMid slice" />
            <circle cx="255" cy="165" r="38" fill="url(#earthShade)" />
            <circle cx="255" cy="165" r="39" fill="none" stroke="#93c5fd" strokeOpacity=".35" />

            <text x="24" y="30" fill="#94a3b8" fontSize="11" letterSpacing="2">SOLAR WIND</text>
            <text x="224" y="112" fill="#94a3b8" fontSize="11" letterSpacing="2">EARTH</text>
            <text x="390" y="112" fill="#94a3b8" fontSize="11" letterSpacing="2">MAGNETOTAIL</text>
            <text x="26" y="302" fill="#64748b" fontSize="12">Bz {fmt(model.bz)} nT · Pressure {fmt(model.pressure, 2)} nPa · Score {Math.round(model.score)}</text>
          </svg>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-1 gap-3 text-sm">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-neutral-500 text-xs uppercase tracking-widest">Compression</div>
            <div className="text-2xl font-bold text-sky-200">{Math.round(model.compression * 100)}%</div>
            <div className="h-2 bg-neutral-800 rounded-full mt-2 overflow-hidden"><div className="h-full bg-sky-400" style={{ width: `${Math.round(model.compression * 100)}%` }} /></div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="text-neutral-500 text-xs uppercase tracking-widest">Tail loading</div>
            <div className="text-2xl font-bold text-amber-200">{Math.round(model.tailStretch * 100)}%</div>
            <div className="h-2 bg-neutral-800 rounded-full mt-2 overflow-hidden"><div className="h-full bg-amber-300" style={{ width: `${Math.round(model.tailStretch * 100)}%` }} /></div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 col-span-2 xl:col-span-1">
            <div className="text-neutral-500 text-xs uppercase tracking-widest">Substorm call</div>
            <div className={`text-lg font-bold ${model.snap ? 'text-red-200' : 'text-neutral-200'}`}>{model.snap ? 'Snap window active' : model.level}</div>
            <div className="text-xs text-neutral-400 mt-1">Trend: {model.trend}</div>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 col-span-2 xl:col-span-1">
            <div className="text-neutral-500 text-xs uppercase tracking-widest">Live drivers</div>
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
