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
  fetchedAt:      string;
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
  solo_earth_lon_sep_deg:  number;
  solo_is_upstream:        boolean;
  solo_upstream_quality:   string;
  solo_warning_lead_hours: number | null;
  stereo_earth_lon_sep_deg?: number;
  note:                    string;
}

interface PositionData {
  ok:          boolean;
  fetchedAt:   string;
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

const SOLO_BASE = 'https://solo.thenamesrock.workers.dev';

// ─── Upstream quality badge ───────────────────────────────────────────────────
const QUALITY_STYLES: Record<string, { bg: string; text: string; dot: string; label: string }> = {
  excellent: { bg: 'bg-green-900/50',  text: 'text-green-300',  dot: 'bg-green-400',   label: 'Excellent upstream alignment' },
  good:      { bg: 'bg-emerald-900/40',text: 'text-emerald-300',dot: 'bg-emerald-400', label: 'Good upstream alignment' },
  marginal:  { bg: 'bg-yellow-900/40', text: 'text-yellow-300', dot: 'bg-yellow-400',  label: 'Marginal upstream alignment' },
  watch:     { bg: 'bg-orange-900/30', text: 'text-orange-300', dot: 'bg-orange-400',  label: 'Off-axis — limited predictive value' },
  'off-axis':{ bg: 'bg-neutral-800/60',text: 'text-neutral-400',dot: 'bg-neutral-500', label: 'Off Sun-Earth line' },
};

// ─── Heliocentric position SVG ────────────────────────────────────────────────
const HeliocentricMap: React.FC<{ data: PositionData }> = ({ data }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const SIZE  = 480;
  const CX    = SIZE / 2;
  const CY    = SIZE / 2;
  // 1 AU maps to 45% of the SVG half-width so everything fits
  const AU_PX = (SIZE / 2) * 0.42;

  const { positions } = data;
  if (!positions?.earth) return null;

  // Convert AU coords → SVG px (x right = ecliptic 0°, y up = 90°)
  const toSvg = (x: number, y: number) => ({
    sx: CX + x * AU_PX,
    sy: CY - y * AU_PX,  // SVG y increases downward so invert
  });

  // Reference orbit circles (AU radii)
  const orbitRings = [0.3, 0.5, 0.7, 1.0, 1.2];

  // Approximate SolO orbit: eccentric, perihelion ~0.28 AU, aphelion ~1.02 AU
  const soloOrbitPoints = useMemo(() => {
    const n = 120;
    const a = 0.65;  // semi-major axis AU
    const e = 0.57;  // eccentricity
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const theta = (i / n) * 2 * Math.PI;
      const r = (a * (1 - e * e)) / (1 + e * Math.cos(theta));
      pts.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
    }
    return pts;
  }, []);

  // STEREO-A orbit: nearly circular at ~1.0 AU
  const stereoOrbitPoints = useMemo(() => {
    const n = 120;
    const r = 1.0;
    return Array.from({ length: n }, (_, i) => {
      const theta = (i / n) * 2 * Math.PI;
      return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
    });
  }, []);

  const orbitPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => {
      const { sx, sy } = toSvg(p.x, p.y);
      return `${i === 0 ? 'M' : 'L'} ${sx.toFixed(1)} ${sy.toFixed(1)}`;
    }).join(' ') + ' Z';

  const earthPos = toSvg(positions.earth.x, positions.earth.y);
  const soloPos  = positions.solo   ? toSvg(positions.solo.x,    positions.solo.y)   : null;
  const stereoPos= positions.stereoA? toSvg(positions.stereoA.x, positions.stereoA.y): null;
  const l1Pos    = positions.l1     ? toSvg(positions.l1.x,      positions.l1.y)     : null;

  const derived = positions.derived;
  const isUpstream = derived?.solo_is_upstream;
  const sepDeg = derived?.solo_earth_lon_sep_deg;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="w-full h-full"
      style={{ background: 'transparent', maxHeight: '100%' }}
    >
      {/* Starfield */}
      {Array.from({ length: 80 }, (_, i) => {
        const seed = i * 7919;
        const sx = (seed * 1301 % SIZE);
        const sy = (seed * 1637 % SIZE);
        const r  = (i % 3 === 0) ? 0.8 : 0.4;
        const op = 0.2 + (i % 5) * 0.08;
        return <circle key={i} cx={sx} cy={sy} r={r} fill="white" opacity={op} />;
      })}

      {/* Reference orbit rings */}
      {orbitRings.map(r => (
        <circle
          key={r}
          cx={CX} cy={CY}
          r={r * AU_PX}
          fill="none"
          stroke="#3f3f46"
          strokeWidth="0.5"
          strokeDasharray={r === 1.0 ? '4 3' : '2 4'}
          opacity={r === 1.0 ? 0.6 : 0.3}
        />
      ))}

      {/* AU labels on ring */}
      {[0.3, 0.5, 1.0].map(r => (
        <text
          key={`lbl-${r}`}
          x={CX + r * AU_PX + 3}
          y={CY - 3}
          fill="#52525b"
          fontSize="7"
          fontFamily="monospace"
        >
          {r} AU
        </text>
      ))}

      {/* Sun-Earth line (dashed) */}
      <line
        x1={CX} y1={CY}
        x2={earthPos.sx} y2={earthPos.sy}
        stroke="#60a5fa"
        strokeWidth="0.5"
        strokeDasharray="3 3"
        opacity="0.25"
      />

      {/* SolO-Sun line (highlight when upstream) */}
      {soloPos && isUpstream && (
        <line
          x1={CX} y1={CY}
          x2={soloPos.sx} y2={soloPos.sy}
          stroke="#f97316"
          strokeWidth="0.8"
          strokeDasharray="3 2"
          opacity="0.4"
        />
      )}

      {/* Angular separation arc between SolO and Earth */}
      {soloPos && sepDeg !== undefined && sepDeg < 45 && positions.solo && positions.earth && (() => {
        const arcR = AU_PX * 0.18;
        const earthAngle = Math.atan2(-positions.earth.y, positions.earth.x); // SVG coords
        const soloAngle  = Math.atan2(-positions.solo.y,  positions.solo.x);
        const x1 = CX + arcR * Math.cos(earthAngle);
        const y1 = CY + arcR * Math.sin(earthAngle);
        const x2 = CX + arcR * Math.cos(soloAngle);
        const y2 = CY + arcR * Math.sin(soloAngle);
        const large = Math.abs(earthAngle - soloAngle) > Math.PI ? 1 : 0;
        return (
          <g>
            <path
              d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${arcR} ${arcR} 0 ${large} 0 ${x2.toFixed(1)} ${y2.toFixed(1)}`}
              fill="none"
              stroke={isUpstream ? '#f97316' : '#6b7280'}
              strokeWidth="1.2"
              opacity="0.7"
            />
            <text
              x={CX + arcR * 1.4 * Math.cos((earthAngle + soloAngle) / 2)}
              y={CY + arcR * 1.4 * Math.sin((earthAngle + soloAngle) / 2)}
              fill={isUpstream ? '#fb923c' : '#9ca3af'}
              fontSize="8"
              fontFamily="monospace"
              textAnchor="middle"
            >
              {sepDeg.toFixed(1)}°
            </text>
          </g>
        );
      })()}

      {/* SolO orbit trace */}
      <path
        d={orbitPath(soloOrbitPoints)}
        fill="none"
        stroke="#f97316"
        strokeWidth="0.6"
        strokeDasharray="2 3"
        opacity="0.25"
      />

      {/* STEREO-A orbit trace */}
      <path
        d={orbitPath(stereoOrbitPoints)}
        fill="none"
        stroke="#a78bfa"
        strokeWidth="0.6"
        strokeDasharray="2 3"
        opacity="0.2"
      />

      {/* ── Sun ── */}
      <g>
        <circle cx={CX} cy={CY} r={10} fill="#fbbf24" opacity="0.15" />
        <circle cx={CX} cy={CY} r={7}  fill="#fbbf24" opacity="0.3" />
        <circle cx={CX} cy={CY} r={5}  fill="#fde68a" />
        <text x={CX} y={CY + 18} fill="#fbbf24" fontSize="8" textAnchor="middle" fontFamily="monospace" opacity="0.8">Sun</text>
      </g>

      {/* ── Earth ── */}
      <g>
        <circle cx={earthPos.sx} cy={earthPos.sy} r={6} fill="#60a5fa" opacity="0.2" />
        <circle cx={earthPos.sx} cy={earthPos.sy} r={4} fill="#3b82f6" />
        <text x={earthPos.sx + 8} y={earthPos.sy + 4} fill="#93c5fd" fontSize="8" fontFamily="monospace">Earth</text>
        <text x={earthPos.sx + 8} y={earthPos.sy + 13} fill="#60a5fa" fontSize="7" fontFamily="monospace" opacity="0.7">
          {positions.earth.r_au.toFixed(3)} AU
        </text>
      </g>

      {/* ── L1 ── */}
      {l1Pos && (
        <g>
          <circle cx={l1Pos.sx} cy={l1Pos.sy} r={3} fill="#34d399" opacity="0.5" />
          <circle cx={l1Pos.sx} cy={l1Pos.sy} r={1.5} fill="#34d399" />
          <text x={l1Pos.sx - 5} y={l1Pos.sy - 6} fill="#34d399" fontSize="7" fontFamily="monospace" textAnchor="middle" opacity="0.8">L1</text>
        </g>
      )}

      {/* ── STEREO-A ── */}
      {stereoPos && positions.stereoA && (
        <g>
          <circle cx={stereoPos.sx} cy={stereoPos.sy} r={5} fill="#a78bfa" opacity="0.2" />
          <circle cx={stereoPos.sx} cy={stereoPos.sy} r={3} fill="#8b5cf6" />
          <text x={stereoPos.sx + 7} y={stereoPos.sy + 4} fill="#c4b5fd" fontSize="8" fontFamily="monospace">STEREO-A</text>
          <text x={stereoPos.sx + 7} y={stereoPos.sy + 13} fill="#a78bfa" fontSize="7" fontFamily="monospace" opacity="0.7">
            {positions.stereoA.r_au.toFixed(3)} AU
          </text>
        </g>
      )}

      {/* ── Solar Orbiter ── */}
      {soloPos && positions.solo && (
        <g>
          {isUpstream && (
            <circle cx={soloPos.sx} cy={soloPos.sy} r={9} fill="#f97316" opacity="0.15">
              <animate attributeName="r" values="7;11;7" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.15;0.05;0.15" dur="2s" repeatCount="indefinite" />
            </circle>
          )}
          <circle cx={soloPos.sx} cy={soloPos.sy} r={5} fill="#f97316" opacity="0.25" />
          <circle cx={soloPos.sx} cy={soloPos.sy} r={3.5} fill="#ea580c" />
          {/* SolO icon cross */}
          <line x1={soloPos.sx - 5} y1={soloPos.sy} x2={soloPos.sx + 5} y2={soloPos.sy} stroke="#f97316" strokeWidth="1" opacity="0.6" />
          <line x1={soloPos.sx} y1={soloPos.sy - 5} x2={soloPos.sx} y2={soloPos.sy + 5} stroke="#f97316" strokeWidth="1" opacity="0.6" />
          <text x={soloPos.sx + 9} y={soloPos.sy + 4}  fill="#fb923c" fontSize="8" fontFamily="monospace">SolO</text>
          <text x={soloPos.sx + 9} y={soloPos.sy + 13} fill="#f97316" fontSize="7" fontFamily="monospace" opacity="0.7">
            {positions.solo.r_au.toFixed(3)} AU
          </text>
          <text x={soloPos.sx + 9} y={soloPos.sy + 21} fill={isUpstream ? '#fb923c' : '#6b7280'} fontSize="7" fontFamily="monospace" opacity="0.8">
            {sepDeg !== undefined ? `${sepDeg.toFixed(1)}° sep` : ''}
          </text>
        </g>
      )}

      {/* North direction label */}
      <text x={CX} y={14} fill="#3f3f46" fontSize="7" textAnchor="middle" fontFamily="monospace">Ecliptic North ↑</text>
      <text x={SIZE - 4} y={CY + 4} fill="#3f3f46" fontSize="7" textAnchor="end" fontFamily="monospace">0°</text>
    </svg>
  );
};

// ─── Main component ───────────────────────────────────────────────────────────
const SoloPanel: React.FC = () => {
  const [tab, setTab]           = useState<'map' | 'imagery'>('map');
  const [imagery, setImagery]   = useState<ImageryData | null>(null);
  const [position, setPosition] = useState<PositionData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [activeChannel, setActiveChannel] = useState(0);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      const [imgRes, posRes] = await Promise.allSettled([
        fetch(`${SOLO_BASE}/solo/imagery`).then(r => r.ok ? r.json() : null),
        fetch(`${SOLO_BASE}/solo/position`).then(r => r.ok ? r.json() : null),
      ]);
      if (!mountedRef.current) return;
      if (imgRes.status === 'fulfilled' && imgRes.value?.ok) setImagery(imgRes.value);
      if (posRes.status === 'fulfilled' && posRes.value?.ok) setPosition(posRes.value);
    } catch {}
    finally { if (mountedRef.current) setLoading(false); }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    const iv = setInterval(fetchAll, 15 * 60 * 1000); // refresh every 15 min
    return () => { mountedRef.current = false; clearInterval(iv); };
  }, [fetchAll]);

  const derived  = position?.positions?.derived;
  const qualityKey = derived?.solo_upstream_quality ?? 'off-axis';
  const qs = QUALITY_STYLES[qualityKey] ?? QUALITY_STYLES['off-axis'];

  const channel = imagery?.channels?.[activeChannel];

  return (
    <div className="h-full flex flex-col">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-white">Solar Orbiter</h2>
          <p className="text-xs text-neutral-500 mt-0.5">ESA/NASA · Heliocentric orbit · EUI imager</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-600">
            {position?.fetchedAt ? new Date(position.fetchedAt).toLocaleTimeString('en-NZ', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit' }) + ' NZT' : ''}
          </span>
          <button onClick={fetchAll} className="p-1.5 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors" title="Refresh">↻</button>
        </div>
      </div>

      {/* ── Upstream status banner ── */}
      {derived && (
        <div className={`${qs.bg} border border-neutral-700/50 rounded-lg px-3 py-2 mb-3 flex items-start gap-2`}>
          <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1 ${qs.dot} ${derived.solo_is_upstream ? 'animate-pulse' : ''}`} />
          <div className="min-w-0">
            <p className={`text-xs font-semibold ${qs.text}`}>{qs.label}</p>
            <p className="text-xs text-neutral-500 mt-0.5 leading-relaxed">{derived.note}</p>
            {derived.solo_is_upstream && derived.solo_warning_lead_hours !== null && (
              <p className="text-xs font-mono text-orange-300 mt-1">
                ⏱ Estimated CME lead time: ~{derived.solo_warning_lead_hours}h ahead of Earth
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Tab selector ── */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => setTab('map')}
          className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'map' ? 'bg-orange-700 text-white' : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'}`}
        >
          📍 Position Map
        </button>
        <button
          onClick={() => setTab('imagery')}
          className={`px-3 py-1 text-xs rounded transition-colors ${tab === 'imagery' ? 'bg-orange-700 text-white' : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'}`}
        >
          🌅 EUI Imagery
        </button>
      </div>

      {/* ── Map tab ── */}
      {tab === 'map' && (
        <div className="flex-1 flex flex-col min-h-0">
          {loading && !position ? (
            <div className="flex-1 bg-neutral-800/40 rounded-lg animate-pulse" />
          ) : position ? (
            <div className="flex-1 bg-neutral-950/60 rounded-lg border border-neutral-800 overflow-hidden relative" style={{ minHeight: 320 }}>
              <HeliocentricMap data={position} />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center bg-neutral-900/40 rounded-lg border border-neutral-700/50">
              <p className="text-neutral-500 text-sm">Position data unavailable</p>
            </div>
          )}

          {/* Position table */}
          {position?.positions && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              {(['solo', 'stereoA', 'earth'] as const).map(key => {
                const sc = position.positions[key];
                if (!sc) return null;
                return (
                  <div key={key} className="bg-neutral-900/60 rounded px-2.5 py-2 border border-neutral-800">
                    <div className="font-semibold mb-1" style={{ color: sc.color }}>{sc.name}</div>
                    <div className="text-neutral-400 space-y-0.5">
                      <div className="flex justify-between"><span>Distance</span><span className="text-neutral-200 font-mono">{sc.r_au} AU</span></div>
                      <div className="flex justify-between"><span>Longitude</span><span className="text-neutral-200 font-mono">{sc.lon_deg.toFixed(1)}°</span></div>
                      <div className="flex justify-between"><span>Latitude</span><span className="text-neutral-200 font-mono">{sc.lat_deg.toFixed(1)}°</span></div>
                    </div>
                  </div>
                );
              })}
              {derived?.stereo_earth_lon_sep_deg !== undefined && (
                <div className="bg-neutral-900/60 rounded px-2.5 py-2 border border-neutral-800">
                  <div className="font-semibold text-purple-400 mb-1">STEREO-A separation</div>
                  <div className="text-neutral-400">
                    <div className="flex justify-between"><span>From Earth</span><span className="text-neutral-200 font-mono">{derived.stereo_earth_lon_sep_deg.toFixed(1)}°</span></div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Legend */}
          <div className="mt-2 flex gap-4 flex-wrap">
            {[
              { color: '#fbbf24', label: 'Sun' },
              { color: '#60a5fa', label: 'Earth' },
              { color: '#34d399', label: 'L1' },
              { color: '#f97316', label: 'Solar Orbiter' },
              { color: '#a78bfa', label: 'STEREO-A' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-[11px] text-neutral-500">{label}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-neutral-600 mt-1">
            Positions from NASA JPL Horizons · Heliocentric ecliptic J2000 · Updated every 6h
          </p>
        </div>
      )}

      {/* ── Imagery tab ── */}
      {tab === 'imagery' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Channel selector */}
          {imagery?.channels && imagery.channels.length > 0 && (
            <div className="flex gap-2 mb-3">
              {imagery.channels.map((ch, i) => (
                <button
                  key={ch.wavelength}
                  onClick={() => { setActiveChannel(i); setImgLoaded(false); setImgError(false); }}
                  className={`px-3 py-1 text-xs rounded transition-colors ${activeChannel === i ? 'text-white' : 'bg-neutral-700 hover:bg-neutral-600 text-neutral-300'}`}
                  style={activeChannel === i ? { backgroundColor: ch.color } : {}}
                >
                  {ch.label}
                </button>
              ))}
            </div>
          )}

          {/* Image display */}
          <div className="flex-1 bg-black rounded-lg border border-neutral-800 overflow-hidden flex items-center justify-center relative" style={{ minHeight: 280 }}>
            {loading && !imagery ? (
              <div className="animate-pulse text-neutral-600 text-sm">Loading EUI imagery...</div>
            ) : channel ? (
              <>
                {!imgLoaded && !imgError && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-neutral-500 text-sm">Loading image...</div>
                  </div>
                )}
                {imgError && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                    <p className="text-neutral-500 text-sm">Image unavailable</p>
                    <a href={channel.helioviewerUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-400 hover:underline">
                      View on Helioviewer ↗
                    </a>
                  </div>
                )}
                <img
                  key={`${channel.imageId}-${activeChannel}`}
                  src={`${SOLO_BASE}${channel.tileUrl}`}
                  alt={`Solar Orbiter EUI ${channel.label}`}
                  className={`w-full h-full object-contain transition-opacity duration-300 ${imgLoaded ? 'opacity-100' : 'opacity-0'}`}
                  onLoad={() => setImgLoaded(true)}
                  onError={() => setImgError(true)}
                />
              </>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <p className="text-neutral-500 text-sm">No EUI imagery available yet</p>
                <p className="text-neutral-600 text-xs">Check back after the first cron run</p>
              </div>
            )}
          </div>

          {/* Image metadata */}
          {channel && (
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-neutral-500">Observation time</span>
                <span className="text-neutral-200 font-mono">{channel.date} UTC</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Scale</span>
                <span className="text-neutral-200 font-mono">{channel.scale?.toFixed(2)} arcsec/px</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Resolution</span>
                <span className="text-neutral-200 font-mono">{channel.width} × {channel.height} px</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Full resolution</span>
                <a
                  href={channel.helioviewerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:text-sky-300 transition-colors"
                >
                  View on Helioviewer ↗
                </a>
              </div>
            </div>
          )}

          {imagery?.latency_note && (
            <div className="mt-2 px-2.5 py-2 rounded bg-amber-900/20 border border-amber-800/30">
              <p className="text-[11px] text-amber-400/80 leading-relaxed">⚠ {imagery.latency_note}</p>
            </div>
          )}
          <p className="text-[11px] text-neutral-700 mt-2">
            Imagery via ESA/NASA Helioviewer Project · EUI science data: Royal Observatory of Belgium
          </p>
        </div>
      )}
    </div>
  );
};

export default SoloPanel;
// --- END OF FILE components/SoloPanel.tsx ---