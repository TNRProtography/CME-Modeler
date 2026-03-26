// --- START OF FILE components/SoloPanel.tsx ---
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ImageChannel {
  label:          string;
  wavelength:     number;
  color:          string;
  imageId:        number;
  date:           string;
  scale:          number;
  width:          number;
  height:         number;
  tileUrl:        string;
  helioviewerUrl: string;
}

interface SpacecraftPosition {
  name:    string;
  color:   string;
  x:       number;
  y:       number;
  z:       number;
  r_au:    number;
  lon_deg: number;
  lat_deg: number;
}

interface DerivedMetrics {
  solo_earth_lon_sep_deg:   number;
  solo_is_upstream:         boolean;
  solo_upstream_quality:    string;
  solo_warning_lead_hours:  number | null;
  stereo_earth_lon_sep_deg?: number;
  note:                     string;
}

interface PositionData {
  ok:        boolean;
  fetchedAt: string;
  positions: {
    solo?:    SpacecraftPosition;
    stereoA?: SpacecraftPosition;
    earth?:   SpacecraftPosition;
    l1?:      SpacecraftPosition;
    derived?: DerivedMetrics;
  };
}

interface ImageryData {
  ok:           boolean;
  last_fetch:   string | null;
  latency_note: string;
  channels:     ImageChannel[];
}

const SOLO_BASE = 'https://solo-worker.thenamesrock.workers.dev';

// ─── Upstream quality config — matches app status-banner convention ───────────
const QUALITY_STYLES: Record<string, { dot: string; bg: string; border: string; text: string; label: string }> = {
  excellent: { dot: 'bg-green-400',    bg: 'bg-green-950/50',    border: 'border-green-700/60',    text: 'text-green-300',   label: '✅ Excellent upstream alignment — <5° from Sun-Earth line' },
  good:      { dot: 'bg-emerald-400',  bg: 'bg-emerald-950/40',  border: 'border-emerald-700/50',  text: 'text-emerald-300', label: '✅ Good upstream alignment — <10° from Sun-Earth line' },
  marginal:  { dot: 'bg-yellow-400',   bg: 'bg-yellow-950/40',   border: 'border-yellow-700/50',   text: 'text-yellow-300',  label: '⚠️ Marginal upstream alignment — <15° from Sun-Earth line' },
  watch:     { dot: 'bg-orange-400',   bg: 'bg-orange-950/30',   border: 'border-orange-700/40',   text: 'text-orange-300',  label: '📡 Off-axis — limited predictive value for Earth' },
  'off-axis':{ dot: 'bg-neutral-500',  bg: 'bg-neutral-900/60',  border: 'border-neutral-700/60',  text: 'text-neutral-400', label: '📡 Off Sun-Earth line — in-situ data not directly predictive' },
};

// ─── Heliocentric position map ────────────────────────────────────────────────
const HeliocentricMap: React.FC<{ data: PositionData }> = ({ data }) => {
  const SIZE   = 420;
  const CX     = SIZE / 2;
  const CY     = SIZE / 2;
  const AU_PX  = (SIZE / 2) * 0.40; // 1 AU in pixels

  const { positions } = data;
  if (!positions?.earth) return (
    <div className="w-full h-full flex items-center justify-center text-neutral-500 text-sm">
      Position data unavailable
    </div>
  );

  const toSvg = (x: number, y: number) => ({
    sx: CX + x * AU_PX,
    sy: CY - y * AU_PX,
  });

  // Reference orbit rings
  const rings = [0.3, 0.5, 0.7, 1.0];

  // SolO orbit approximation — eccentric, perihelion ~0.28 AU, aphelion ~1.02 AU
  const soloOrbit = useMemo(() => {
    const a = 0.65, e = 0.57, n = 120;
    return Array.from({ length: n }, (_, i) => {
      const theta = (i / n) * 2 * Math.PI;
      const r = (a * (1 - e * e)) / (1 + e * Math.cos(theta));
      return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
    });
  }, []);

  // STEREO-A orbit — near-circular at ~1.0 AU
  const stereoOrbit = useMemo(() => Array.from({ length: 120 }, (_, i) => {
    const theta = (i / 120) * 2 * Math.PI;
    return { x: Math.cos(theta), y: Math.sin(theta) };
  }), []);

  const orbitPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toSvg(p.x, p.y).sx.toFixed(1)},${toSvg(p.x, p.y).sy.toFixed(1)}`).join(' ') + 'Z';

  const ep  = toSvg(positions.earth.x,    positions.earth.y);
  const sp  = positions.solo    ? toSvg(positions.solo.x,    positions.solo.y)    : null;
  const stp = positions.stereoA ? toSvg(positions.stereoA.x, positions.stereoA.y) : null;
  const l1p = positions.l1      ? toSvg(positions.l1.x,      positions.l1.y)      : null;

  const derived    = positions.derived;
  const isUpstream = derived?.solo_is_upstream ?? false;
  const sepDeg     = derived?.solo_earth_lon_sep_deg;

  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full h-full" style={{ maxHeight: '100%' }}>
      {/* Subtle starfield */}
      {Array.from({ length: 60 }, (_, i) => {
        const s = i * 6271;
        return (
          <circle key={i} cx={(s * 1301) % SIZE} cy={(s * 1637) % SIZE}
            r={i % 4 === 0 ? 0.8 : 0.4} fill="white" opacity={0.15 + (i % 4) * 0.06} />
        );
      })}

      {/* Reference rings */}
      {rings.map(r => (
        <circle key={r} cx={CX} cy={CY} r={r * AU_PX}
          fill="none" stroke="#3f3f46"
          strokeWidth={r === 1.0 ? 0.8 : 0.5}
          strokeDasharray={r === 1.0 ? '4 3' : '2 4'}
          opacity={r === 1.0 ? 0.5 : 0.25} />
      ))}
      {/* Ring labels */}
      {[0.5, 1.0].map(r => (
        <text key={`l${r}`} x={CX + r * AU_PX + 3} y={CY - 3}
          fill="#52525b" fontSize="7" fontFamily="inherit">{r} AU</text>
      ))}

      {/* Sun–Earth reference line */}
      <line x1={CX} y1={CY} x2={ep.sx} y2={ep.sy}
        stroke="#60a5fa" strokeWidth="0.5" strokeDasharray="3 3" opacity="0.2" />

      {/* SolO upstream highlight line */}
      {sp && isUpstream && (
        <line x1={CX} y1={CY} x2={sp.sx} y2={sp.sy}
          stroke="#f97316" strokeWidth="0.8" strokeDasharray="3 2" opacity="0.35" />
      )}

      {/* Angular separation arc */}
      {sp && sepDeg !== undefined && sepDeg < 45 && positions.solo && (() => {
        const arcR = AU_PX * 0.16;
        const ea = Math.atan2(-positions.earth.y, positions.earth.x);
        const sa = Math.atan2(-positions.solo.y,  positions.solo.x);
        const x1 = CX + arcR * Math.cos(ea), y1 = CY + arcR * Math.sin(ea);
        const x2 = CX + arcR * Math.cos(sa), y2 = CY + arcR * Math.sin(sa);
        const large = Math.abs(ea - sa) > Math.PI ? 1 : 0;
        const mid   = (ea + sa) / 2;
        return (
          <g>
            <path d={`M${x1.toFixed(1)},${y1.toFixed(1)} A${arcR},${arcR} 0 ${large} 0 ${x2.toFixed(1)},${y2.toFixed(1)}`}
              fill="none" stroke={isUpstream ? '#f97316' : '#6b7280'} strokeWidth="1.2" opacity="0.65" />
            <text x={CX + arcR * 1.45 * Math.cos(mid)} y={CY + arcR * 1.45 * Math.sin(mid)}
              fill={isUpstream ? '#fb923c' : '#9ca3af'} fontSize="8" fontFamily="inherit" textAnchor="middle">
              {sepDeg.toFixed(1)}°
            </text>
          </g>
        );
      })()}

      {/* Orbit traces */}
      <path d={orbitPath(soloOrbit)} fill="none" stroke="#f97316" strokeWidth="0.6" strokeDasharray="2 3" opacity="0.2" />
      <path d={orbitPath(stereoOrbit)} fill="none" stroke="#a78bfa" strokeWidth="0.6" strokeDasharray="2 3" opacity="0.18" />

      {/* ── Sun ── */}
      <circle cx={CX} cy={CY} r={9}  fill="#fbbf24" opacity="0.15" />
      <circle cx={CX} cy={CY} r={6}  fill="#fbbf24" opacity="0.3" />
      <circle cx={CX} cy={CY} r={4}  fill="#fde68a" />
      <text x={CX} y={CY + 16} fill="#fbbf24" fontSize="7" fontFamily="inherit" textAnchor="middle" opacity="0.9">Sun</text>

      {/* ── Earth ── */}
      <circle cx={ep.sx} cy={ep.sy} r={5}  fill="#3b82f6" opacity="0.25" />
      <circle cx={ep.sx} cy={ep.sy} r={3.5} fill="#3b82f6" />
      <text x={ep.sx + 7} y={ep.sy + 4}  fill="#93c5fd" fontSize="8" fontFamily="inherit">Earth</text>
      <text x={ep.sx + 7} y={ep.sy + 13} fill="#60a5fa"  fontSize="7" fontFamily="inherit" opacity="0.7">
        {positions.earth.r_au.toFixed(3)} AU
      </text>

      {/* ── L1 ── */}
      {l1p && (
        <g>
          <circle cx={l1p.sx} cy={l1p.sy} r={2.5} fill="#34d399" opacity="0.5" />
          <circle cx={l1p.sx} cy={l1p.sy} r={1.5} fill="#34d399" />
          <text x={l1p.sx - 4} y={l1p.sy - 5} fill="#34d399" fontSize="7" fontFamily="inherit" textAnchor="middle" opacity="0.8">L1</text>
        </g>
      )}

      {/* ── STEREO-A ── */}
      {stp && positions.stereoA && (
        <g>
          <circle cx={stp.sx} cy={stp.sy} r={4}   fill="#8b5cf6" opacity="0.2" />
          <circle cx={stp.sx} cy={stp.sy} r={3}   fill="#8b5cf6" />
          <text x={stp.sx + 6} y={stp.sy + 4}  fill="#c4b5fd" fontSize="8" fontFamily="inherit">STEREO-A</text>
          <text x={stp.sx + 6} y={stp.sy + 13} fill="#a78bfa" fontSize="7" fontFamily="inherit" opacity="0.7">
            {positions.stereoA.r_au.toFixed(3)} AU
          </text>
        </g>
      )}

      {/* ── Solar Orbiter ── */}
      {sp && positions.solo && (
        <g>
          {isUpstream && (
            <circle cx={sp.sx} cy={sp.sy} r={8} fill="#f97316" opacity="0.12">
              <animate attributeName="r"       values="7;11;7"           dur="2.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.12;0.04;0.12"   dur="2.5s" repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={sp.sx} cy={sp.sy} r={5}   fill="#f97316" opacity="0.2" />
          <circle cx={sp.sx} cy={sp.sy} r={3.5} fill="#ea580c" />
          {/* Solar panel cross */}
          <line x1={sp.sx - 5} y1={sp.sy} x2={sp.sx + 5} y2={sp.sy} stroke="#f97316" strokeWidth="1" opacity="0.55" />
          <line x1={sp.sx} y1={sp.sy - 5} x2={sp.sx} y2={sp.sy + 5} stroke="#f97316" strokeWidth="1" opacity="0.55" />
          <text x={sp.sx + 8} y={sp.sy + 4}  fill="#fb923c" fontSize="8" fontFamily="inherit">SolO</text>
          <text x={sp.sx + 8} y={sp.sy + 13} fill="#f97316" fontSize="7" fontFamily="inherit" opacity="0.7">
            {positions.solo.r_au.toFixed(3)} AU
          </text>
          {sepDeg !== undefined && (
            <text x={sp.sx + 8} y={sp.sy + 22} fill={isUpstream ? '#fb923c' : '#6b7280'} fontSize="7" fontFamily="inherit" opacity="0.8">
              {sepDeg.toFixed(1)}° sep
            </text>
          )}
        </g>
      )}

      <text x={CX} y={12} fill="#3f3f46" fontSize="7" fontFamily="inherit" textAnchor="middle">↑ Ecliptic North</text>
    </svg>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
const SoloPanel: React.FC = () => {
  const [tab,           setTab]          = useState<'map' | 'imagery'>('map');
  const [imagery,       setImagery]      = useState<ImageryData | null>(null);
  const [position,      setPosition]     = useState<PositionData | null>(null);
  const [loading,       setLoading]      = useState(true);
  const [activeChannel, setActiveChannel]= useState(0);
  const [imgLoaded,     setImgLoaded]    = useState(false);
  const [imgError,      setImgError]     = useState(false);
  const [lastUpdated,   setLastUpdated]  = useState<Date | null>(null);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    try {
      const [imgRes, posRes] = await Promise.allSettled([
        fetch(`${SOLO_BASE}/solo/imagery`).then(r => r.ok ? r.json() : null),
        fetch(`${SOLO_BASE}/solo/position`).then(r => r.ok ? r.json() : null),
      ]);
      if (!mountedRef.current) return;
      if (imgRes.status === 'fulfilled' && imgRes.value?.ok) setImagery(imgRes.value);
      if (posRes.status === 'fulfilled' && posRes.value?.ok) setPosition(posRes.value);
      setLastUpdated(new Date());
    } catch {}
    finally { if (mountedRef.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    const iv = setInterval(fetchAll, 15 * 60 * 1000);
    return () => { mountedRef.current = false; clearInterval(iv); };
  }, [fetchAll]);

  const derived    = position?.positions?.derived;
  const qualityKey = derived?.solo_upstream_quality ?? 'off-axis';
  const qs         = QUALITY_STYLES[qualityKey] ?? QUALITY_STYLES['off-axis'];
  const channel    = imagery?.channels?.[activeChannel];
  const isUpstream = derived?.solo_is_upstream ?? false;

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold text-white">Solar Orbiter (SolO)</h2>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-neutral-600">
              {lastUpdated.toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' })} NZT
            </span>
          )}
          <button onClick={fetchAll} className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors" title="Refresh">↻</button>
        </div>
      </div>
      <p className="text-xs text-neutral-500 mb-4">ESA/NASA · Heliocentric orbit · EUI imager · JPL Horizons positioning</p>

      {/* ── Upstream status banner ── */}
      {loading && !position ? (
        <div className="h-14 bg-neutral-800/50 rounded-lg animate-pulse mb-4" />
      ) : derived && (
        <div className={`${qs.bg} border ${qs.border} rounded-lg px-4 py-3 mb-4`}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${qs.dot} ${isUpstream ? 'animate-pulse' : ''}`} />
            <span className={`text-sm font-semibold ${qs.text}`}>{qs.label}</span>
            {isUpstream && derived.solo_warning_lead_hours !== null && (
              <span className="px-2 py-0.5 rounded-full bg-orange-900/50 border border-orange-700/40 text-orange-300 text-xs">
                ~{derived.solo_warning_lead_hours}h CME lead time
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-400 mt-1.5 leading-relaxed">{derived.note}</p>
        </div>
      )}

      {/* ── Tab selector ── */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => setTab('map')}
          className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'map' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>
          Heliocentric Map
        </button>
        <button onClick={() => setTab('imagery')}
          className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'imagery' ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>
          EUI Imagery
        </button>
      </div>

      {/* ══ MAP TAB ══════════════════════════════════════════════════════════ */}
      {tab === 'map' && (
        <div>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* SVG map */}
            <div className="lg:col-span-7 rounded-lg border border-neutral-800 bg-black/80 p-3 flex items-center justify-center" style={{ minHeight: 320 }}>
              {loading && !position ? (
                <div className="w-full h-64 bg-neutral-800/50 rounded-lg animate-pulse" />
              ) : position ? (
                <div className="w-full" style={{ aspectRatio: '1 / 1', maxHeight: 420 }}>
                  <HeliocentricMap data={position} />
                </div>
              ) : (
                <p className="text-neutral-500 text-sm italic">Position data unavailable — check back after first cron run</p>
              )}
            </div>

            {/* Stats panel */}
            <div className="lg:col-span-5 rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 flex flex-col gap-3">
              {/* Spacecraft data rows */}
              {(['solo', 'stereoA', 'earth'] as const).map(key => {
                const sc = position?.positions?.[key];
                if (!sc) return (
                  <div key={key} className="bg-neutral-950/70 rounded p-2.5 border border-neutral-800 animate-pulse h-16" />
                );
                return (
                  <div key={key} className="bg-neutral-950/70 rounded p-2.5 border border-neutral-800">
                    <div className="text-xs font-semibold mb-1.5" style={{ color: sc.color }}>{sc.name}</div>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Distance from Sun</span>
                        <span className="text-neutral-100 font-semibold">{sc.r_au} AU</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Heliocentric lon.</span>
                        <span className="text-neutral-100 font-semibold">{sc.lon_deg.toFixed(1)}°</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-neutral-500">Ecliptic lat.</span>
                        <span className="text-neutral-100 font-semibold">{sc.lat_deg.toFixed(1)}°</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Separation summary */}
              {derived && (
                <div className="bg-neutral-950/70 rounded p-2.5 border border-neutral-800">
                  <div className="text-xs font-semibold text-neutral-400 mb-1.5">Angular Separations</div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-neutral-500">SolO from Sun-Earth line</span>
                      <span className={`font-semibold ${isUpstream ? 'text-orange-300' : 'text-neutral-300'}`}>
                        {derived.solo_earth_lon_sep_deg.toFixed(1)}°
                      </span>
                    </div>
                    {derived.stereo_earth_lon_sep_deg !== undefined && (
                      <div className="flex justify-between">
                        <span className="text-neutral-500">STEREO-A from Sun-Earth line</span>
                        <span className="text-neutral-300 font-semibold">{derived.stereo_earth_lon_sep_deg.toFixed(1)}°</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Legend */}
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-1">
                {[
                  { color: '#fbbf24', label: 'Sun' },
                  { color: '#3b82f6', label: 'Earth' },
                  { color: '#34d399', label: 'L1' },
                  { color: '#ea580c', label: 'Solar Orbiter' },
                  { color: '#8b5cf6', label: 'STEREO-A' },
                ].map(({ color, label }) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    <span className="text-[11px] text-neutral-500">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <p className="text-right text-xs text-neutral-500 mt-2">
            Positions: NASA JPL Horizons · Heliocentric ecliptic J2000 · Updated every 6h
          </p>
        </div>
      )}

      {/* ══ IMAGERY TAB ══════════════════════════════════════════════════════ */}
      {tab === 'imagery' && (
        <div>
          {/* Channel selector */}
          {imagery?.channels && imagery.channels.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              {imagery.channels.map((ch, i) => (
                <button key={ch.wavelength}
                  onClick={() => { setActiveChannel(i); setImgLoaded(false); setImgError(false); }}
                  className={`px-3 py-1 text-xs rounded transition-colors ${activeChannel === i ? 'bg-sky-600 text-white' : 'bg-neutral-700 hover:bg-neutral-600'}`}>
                  {ch.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Image */}
            <div className="lg:col-span-7 rounded-lg border border-neutral-800 bg-black/80 flex items-center justify-center overflow-hidden" style={{ minHeight: 320 }}>
              {loading && !imagery ? (
                <div className="w-full h-64 bg-neutral-800/50 rounded-lg animate-pulse" />
              ) : channel ? (
                <div className="relative w-full h-full flex items-center justify-center" style={{ minHeight: 280 }}>
                  {!imgLoaded && !imgError && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <svg className="animate-spin h-7 w-7 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    </div>
                  )}
                  {imgError ? (
                    <div className="flex flex-col items-center gap-2 p-4">
                      <p className="text-neutral-500 text-sm italic">Image unavailable from worker</p>
                      <a href={channel.helioviewerUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-sky-400 hover:underline">View on Helioviewer ↗</a>
                    </div>
                  ) : (
                    <img
                      key={`${channel.imageId}-${activeChannel}`}
                      src={`${SOLO_BASE}${channel.tileUrl}`}
                      alt={`Solar Orbiter EUI ${channel.label}`}
                      className={`w-full h-full object-contain transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                      onLoad={() => setImgLoaded(true)}
                      onError={() => setImgError(true)}
                    />
                  )}
                </div>
              ) : (
                <div className="p-6 text-center">
                  <p className="text-neutral-500 text-sm italic">No EUI imagery yet</p>
                  <p className="text-neutral-600 text-xs mt-1">Check back after the first cron run</p>
                </div>
              )}
            </div>

            {/* Image metadata */}
            <div className="lg:col-span-5 rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 flex flex-col gap-2">
              <div className="text-xs uppercase tracking-[0.2em] text-neutral-500 mb-1">Image Details</div>

              {channel ? (
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Instrument</span>
                    <span className="text-neutral-100 font-semibold">EUI FSI · {channel.wavelength} Å</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Observation time</span>
                    <span className="text-neutral-100 font-semibold">{channel.date} UTC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Scale</span>
                    <span className="text-neutral-100 font-semibold">{channel.scale?.toFixed(2)} arcsec/px</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Resolution</span>
                    <span className="text-neutral-100 font-semibold">{channel.width} × {channel.height} px</span>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-neutral-500">Full resolution</span>
                    <a href={channel.helioviewerUrl} target="_blank" rel="noopener noreferrer"
                      className="text-sky-400 hover:underline text-xs">Helioviewer ↗</a>
                  </div>
                </div>
              ) : (
                <p className="text-neutral-600 text-xs italic">No image selected</p>
              )}

              {/* About EUI */}
              <div className="mt-3 pt-3 border-t border-neutral-800">
                <p className="text-xs text-neutral-500 leading-relaxed">
                  The <strong className="text-neutral-400">Extreme Ultraviolet Imager (EUI)</strong> Full Sun Imager observes the entire solar disk at 174 Å (hot corona) and 304 Å (chromosphere/transition region) — wavelengths that reveal active regions, filaments, coronal loops, and eruption sites invisible in white light.
                </p>
              </div>

              {/* Latency warning */}
              {imagery?.latency_note && (
                <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-900/30 border border-amber-700/40 rounded-lg mt-2">
                  <span className="text-amber-400 flex-shrink-0 mt-0.5">⚠</span>
                  <p className="text-xs text-amber-300/80 leading-relaxed">{imagery.latency_note}</p>
                </div>
              )}
            </div>
          </div>

          <p className="text-right text-xs text-neutral-500 mt-2">
            Imagery via ESA/NASA Helioviewer Project · EUI data: Royal Observatory of Belgium (SIDC)
          </p>
        </div>
      )}
    </div>
  );
};

export default SoloPanel;
// --- END OF FILE components/SoloPanel.tsx ---