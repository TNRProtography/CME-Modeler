// --- START OF FILE components/SoloPanel.tsx ---
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ImageChannel {
  label: string; wavelength: number; color: string;
  imageId: number; date: string; scale: number;
  width: number; height: number; tileUrl: string; helioviewerUrl: string;
}
interface SpacecraftPosition {
  name: string; color: string;
  x: number; y: number; z: number;
  r_au: number; lon_deg: number; lat_deg: number;
}
interface DerivedMetrics {
  solo_earth_lon_sep_deg: number;
  solo_is_upstream: boolean;
  solo_upstream_quality: string;
  solo_warning_lead_hours: number | null;
  stereo_earth_lon_sep_deg?: number;
  note: string;
}
interface PositionData {
  ok: boolean; fetchedAt: string;
  positions: {
    solo?: SpacecraftPosition; stereoA?: SpacecraftPosition;
    earth?: SpacecraftPosition; l1?: SpacecraftPosition;
    derived?: DerivedMetrics;
  };
}
interface ImageryData {
  ok: boolean; last_fetch: string | null;
  latency_note: string; channels: ImageChannel[];
}

const SOLO_BASE = 'https://solo-worker.thenamesrock.workers.dev';

const QUALITY_STYLES: Record<string, { dot: string; bg: string; border: string; text: string; label: string }> = {
  excellent: { dot: 'bg-green-400',   bg: 'bg-green-950/50',    border: 'border-green-700/60',   text: 'text-green-300',   label: '✅ Excellent upstream alignment — <5° from Sun-Earth line' },
  good:      { dot: 'bg-emerald-400', bg: 'bg-emerald-950/40',  border: 'border-emerald-700/50', text: 'text-emerald-300', label: '✅ Good upstream alignment — <10° from Sun-Earth line' },
  marginal:  { dot: 'bg-yellow-400',  bg: 'bg-yellow-950/40',   border: 'border-yellow-700/50',  text: 'text-yellow-300',  label: '⚠️ Marginal upstream alignment — <15° from Sun-Earth line' },
  watch:     { dot: 'bg-orange-400',  bg: 'bg-orange-950/30',   border: 'border-orange-700/40',  text: 'text-orange-300',  label: '📡 Off-axis — limited predictive value for Earth' },
  'off-axis':{ dot: 'bg-neutral-500', bg: 'bg-neutral-900/60',  border: 'border-neutral-700/60', text: 'text-neutral-400', label: '📡 Off Sun-Earth line — in-situ data not directly predictive' },
};

// ─── Zoomable Heliocentric Map ────────────────────────────────────────────────
const HeliocentricMap: React.FC<{ data: PositionData }> = ({ data }) => {
  const SIZE  = 460;
  const CX    = SIZE / 2;
  const CY    = SIZE / 2;
  const AU_PX = (SIZE / 2) * 0.40;

  // ── Zoom / pan state ──────────────────────────────────────────────────────
  const [zoom,   setZoom]   = useState(1);
  const [panX,   setPanX]   = useState(0);
  const [panY,   setPanY]   = useState(0);
  const svgRef              = useRef<SVGSVGElement>(null);
  const isDragging          = useRef(false);
  const lastPos             = useRef({ x: 0, y: 0 });
  const lastTouchDist       = useRef<number | null>(null);

  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 12;

  // Convert clientXY → SVG viewBox units
  const clientToSvg = useCallback((cx: number, cy: number) => {
    const el = svgRef.current;
    if (!el) return { sx: CX, sy: CY };
    const rect = el.getBoundingClientRect();
    return {
      sx: (cx - rect.left)  / rect.width  * SIZE,
      sy: (cy - rect.top)   / rect.height * SIZE,
    };
  }, [SIZE, CX, CY]);

  // Zoom toward a point in SVG viewBox coords
  const zoomToward = useCallback((svgX: number, svgY: number, factor: number) => {
    setZoom(z => {
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      // Adjust pan so the point under cursor stays fixed
      setPanX(px => px + (svgX - CX) * (z - newZoom));
      setPanY(py => py + (svgY - CY) * (z - newZoom));
      return newZoom;
    });
  }, [CX, CY]);

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const { sx, sy } = clientToSvg(e.clientX, e.clientY);
    zoomToward(sx, sy, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, [clientToSvg, zoomToward]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    e.preventDefault();
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = (e.clientX - lastPos.current.x) / (svgRef.current?.getBoundingClientRect().width  ?? 1) * SIZE;
    const dy = (e.clientY - lastPos.current.y) / (svgRef.current?.getBoundingClientRect().height ?? 1) * SIZE;
    lastPos.current = { x: e.clientX, y: e.clientY };
    setPanX(p => p + dx);
    setPanY(p => p + dy);
  };
  const handleMouseUp = () => { isDragging.current = false; };

  // Touch support
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      isDragging.current = true;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2) {
      isDragging.current = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && isDragging.current) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = (e.touches[0].clientX - lastPos.current.x) / rect.width  * SIZE;
      const dy = (e.touches[0].clientY - lastPos.current.y) / rect.height * SIZE;
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      setPanX(p => p + dx);
      setPanY(p => p + dy);
    } else if (e.touches.length === 2 && lastTouchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const { sx, sy } = clientToSvg(midX, midY);
      zoomToward(sx, sy, dist / lastTouchDist.current);
      lastTouchDist.current = dist;
    }
  };
  const handleTouchEnd = () => { isDragging.current = false; lastTouchDist.current = null; };

  const resetView = () => { setZoom(1); setPanX(0); setPanY(0); };

  // ── Map geometry ──────────────────────────────────────────────────────────
  const { positions } = data;
  const rings = [0.3, 0.5, 0.7, 1.0, 1.5];

  const soloOrbit = useMemo(() => {
    const a = 0.65, e = 0.57, n = 200;
    return Array.from({ length: n }, (_, i) => {
      const theta = (i / n) * 2 * Math.PI;
      const r = (a * (1 - e * e)) / (1 + e * Math.cos(theta));
      return { x: r * Math.cos(theta), y: r * Math.sin(theta) };
    });
  }, []);

  const stereoOrbit = useMemo(() => Array.from({ length: 200 }, (_, i) => {
    const t = (i / 200) * 2 * Math.PI;
    return { x: Math.cos(t), y: Math.sin(t) };
  }), []);

  // GOES geostationary orbit — shown as tiny ring around Earth (massively exaggerated for visibility)
  // Real GEO radius ≈ 0.000282 AU, we'll show it as 12px radius around Earth for legibility
  const GOES_RING_PX = 14; // exaggerated visual radius

  if (!positions?.earth) return (
    <div className="w-full h-full flex items-center justify-center text-neutral-500 text-sm">
      Position data unavailable
    </div>
  );

  const toSvg = (x: number, y: number) => ({
    sx: CX + x * AU_PX,
    sy: CY - y * AU_PX,
  });

  const orbitPath = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => {
      const { sx, sy } = toSvg(p.x, p.y);
      return `${i === 0 ? 'M' : 'L'}${sx.toFixed(1)},${sy.toFixed(1)}`;
    }).join(' ') + 'Z';

  const ep  = toSvg(positions.earth.x, positions.earth.y);
  const sp  = positions.solo    ? toSvg(positions.solo.x,    positions.solo.y)    : null;
  const stp = positions.stereoA ? toSvg(positions.stereoA.x, positions.stereoA.y) : null;
  const l1p = positions.l1      ? toSvg(positions.l1.x,      positions.l1.y)      : null;

  const derived    = positions.derived;
  const isUpstream = derived?.solo_is_upstream ?? false;
  const sepDeg     = derived?.solo_earth_lon_sep_deg;

  // GOES-East is at ~75.2°W Earth longitude, roughly perpendicular to Sun-Earth line
  // In ecliptic frame, offset GOES slightly above/right of Earth for visual clarity
  const earthAngle = Math.atan2(positions.earth.y, positions.earth.x);
  const goesPerpAngle = earthAngle + Math.PI / 2; // 90° offset for visibility
  // GOES rendered at fixed px offset from Earth centre (not AU — purely decorative)
  const goesOffsetX = Math.cos(goesPerpAngle) * GOES_RING_PX / AU_PX;
  const goesOffsetY = Math.sin(goesPerpAngle) * GOES_RING_PX / AU_PX;
  const gp = toSvg(positions.earth.x + goesOffsetX, positions.earth.y + goesOffsetY);

  // Group transform: zoom centered on map centre + pan
  const groupTransform = `translate(${CX + panX},${CY + panY}) scale(${zoom}) translate(${-CX},${-CY})`;
  // Text & stroke scale inversely so labels stay readable at any zoom
  const inv = 1 / zoom;

  return (
    <div className="relative w-full h-full">
      {/* Zoom controls */}
      <div className="absolute top-2 right-2 z-10 flex flex-col gap-1">
        <button
          onClick={() => zoomToward(CX, CY, 1.3)}
          className="w-7 h-7 rounded bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 text-sm flex items-center justify-center"
          title="Zoom in">+</button>
        <button
          onClick={() => zoomToward(CX, CY, 1 / 1.3)}
          className="w-7 h-7 rounded bg-neutral-800/90 border border-neutral-700 text-neutral-300 hover:bg-neutral-700 text-sm flex items-center justify-center"
          title="Zoom out">−</button>
        <button
          onClick={resetView}
          className="w-7 h-7 rounded bg-neutral-800/90 border border-neutral-700 text-neutral-400 hover:bg-neutral-700 text-[10px] flex items-center justify-center"
          title="Reset view">⟳</button>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full h-full"
        style={{ cursor: isDragging.current ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Starfield — fixed, not transformed */}
        {Array.from({ length: 80 }, (_, i) => {
          const s = i * 6271;
          return <circle key={i} cx={(s * 1301) % SIZE} cy={(s * 1637) % SIZE}
            r={i % 4 === 0 ? 0.8 : 0.4} fill="white" opacity={0.12 + (i % 5) * 0.04} />;
        })}

        <g transform={groupTransform}>
          {/* Reference rings */}
          {rings.map(r => (
            <circle key={r} cx={CX} cy={CY} r={r * AU_PX}
              fill="none" stroke="#3f3f46"
              strokeWidth={r === 1.0 ? 0.8 * inv : 0.5 * inv}
              strokeDasharray={r === 1.0 ? `${4 * inv} ${3 * inv}` : `${2 * inv} ${4 * inv}`}
              opacity={r === 1.0 ? 0.5 : 0.22}
              vectorEffect="non-scaling-stroke" />
          ))}

          {/* Ring distance labels */}
          {[0.3, 0.5, 1.0, 1.5].map(r => (
            <text key={`l${r}`} x={CX + r * AU_PX + 3} y={CY - 3}
              fill="#52525b" fontSize={7 * inv} fontFamily="inherit">{r} AU</text>
          ))}

          {/* Sun–Earth reference line */}
          <line x1={CX} y1={CY} x2={ep.sx} y2={ep.sy}
            stroke="#60a5fa" strokeWidth={0.5 * inv} strokeDasharray={`${3 * inv} ${3 * inv}`}
            opacity="0.2" vectorEffect="non-scaling-stroke" />

          {/* SolO upstream highlight */}
          {sp && isUpstream && (
            <line x1={CX} y1={CY} x2={sp.sx} y2={sp.sy}
              stroke="#f97316" strokeWidth={0.8 * inv} strokeDasharray={`${3 * inv} ${2 * inv}`}
              opacity="0.35" vectorEffect="non-scaling-stroke" />
          )}

          {/* Angular separation arc */}
          {sp && sepDeg !== undefined && sepDeg < 45 && positions.solo && (() => {
            const arcR = AU_PX * 0.16;
            const ea = Math.atan2(-positions.earth.y, positions.earth.x);
            const sa = Math.atan2(-positions.solo.y,  positions.solo.x);
            const x1 = CX + arcR * Math.cos(ea), y1 = CY + arcR * Math.sin(ea);
            const x2 = CX + arcR * Math.cos(sa), y2 = CY + arcR * Math.sin(sa);
            const large = Math.abs(ea - sa) > Math.PI ? 1 : 0;
            const mid = (ea + sa) / 2;
            return (
              <g>
                <path d={`M${x1.toFixed(1)},${y1.toFixed(1)} A${arcR},${arcR} 0 ${large} 0 ${x2.toFixed(1)},${y2.toFixed(1)}`}
                  fill="none" stroke={isUpstream ? '#f97316' : '#6b7280'}
                  strokeWidth={1.2 * inv} opacity="0.65" vectorEffect="non-scaling-stroke" />
                <text x={CX + arcR * 1.5 * Math.cos(mid)} y={CY + arcR * 1.5 * Math.sin(mid)}
                  fill={isUpstream ? '#fb923c' : '#9ca3af'} fontSize={8 * inv} fontFamily="inherit" textAnchor="middle">
                  {sepDeg.toFixed(1)}°
                </text>
              </g>
            );
          })()}

          {/* Orbit traces */}
          <path d={orbitPath(soloOrbit)} fill="none" stroke="#f97316"
            strokeWidth={0.6 * inv} strokeDasharray={`${2 * inv} ${3 * inv}`} opacity="0.2"
            vectorEffect="non-scaling-stroke" />
          <path d={orbitPath(stereoOrbit)} fill="none" stroke="#a78bfa"
            strokeWidth={0.6 * inv} strokeDasharray={`${2 * inv} ${3 * inv}`} opacity="0.18"
            vectorEffect="non-scaling-stroke" />

          {/* ── Sun ── */}
          <circle cx={CX} cy={CY} r={9 * inv} fill="#fbbf24" opacity="0.15" />
          <circle cx={CX} cy={CY} r={6 * inv} fill="#fbbf24" opacity="0.3" />
          <circle cx={CX} cy={CY} r={4 * inv} fill="#fde68a" />
          <text x={CX} y={CY + 16 * inv} fill="#fbbf24" fontSize={7 * inv} fontFamily="inherit" textAnchor="middle" opacity="0.9">Sun</text>

          {/* ── Earth ── */}
          <circle cx={ep.sx} cy={ep.sy} r={5 * inv} fill="#3b82f6" opacity="0.25" />
          <circle cx={ep.sx} cy={ep.sy} r={3.5 * inv} fill="#3b82f6" />
          <text x={ep.sx + 7 * inv} y={ep.sy + 4 * inv}  fill="#93c5fd" fontSize={8 * inv} fontFamily="inherit">Earth</text>
          <text x={ep.sx + 7 * inv} y={ep.sy + 13 * inv} fill="#60a5fa" fontSize={7 * inv} fontFamily="inherit" opacity="0.7">
            {positions.earth.r_au.toFixed(3)} AU
          </text>

          {/* ── GOES (geostationary — orbit exaggerated for visibility) ── */}
          <circle cx={ep.sx} cy={ep.sy} r={GOES_RING_PX * inv}
            fill="none" stroke="#fde047" strokeWidth={0.6 * inv}
            strokeDasharray={`${2 * inv} ${2 * inv}`} opacity="0.4"
            vectorEffect="non-scaling-stroke" />
          {/* GOES-East marker on the ring */}
          <rect
            x={gp.sx - 2.5 * inv} y={gp.sy - 2.5 * inv}
            width={5 * inv} height={5 * inv}
            fill="#fde047" opacity="0.9"
            transform={`rotate(45 ${gp.sx} ${gp.sy})`}
          />
          <text x={gp.sx + 8 * inv} y={gp.sy + 3 * inv} fill="#fde047" fontSize={7 * inv} fontFamily="inherit" opacity="0.9">
            GOES
          </text>
          <text x={gp.sx + 8 * inv} y={gp.sy + 11 * inv} fill="#ca8a04" fontSize={6 * inv} fontFamily="inherit" opacity="0.7">
            GEO orbit*
          </text>

          {/* ── L1 ── */}
          {l1p && (
            <g>
              <circle cx={l1p.sx} cy={l1p.sy} r={2.5 * inv} fill="#34d399" opacity="0.5" />
              <circle cx={l1p.sx} cy={l1p.sy} r={1.5 * inv} fill="#34d399" />
              <text x={l1p.sx - 4 * inv} y={l1p.sy - 5 * inv} fill="#34d399" fontSize={7 * inv} fontFamily="inherit" textAnchor="middle" opacity="0.8">L1</text>
            </g>
          )}

          {/* ── STEREO-A ── */}
          {stp && positions.stereoA && (
            <g>
              <circle cx={stp.sx} cy={stp.sy} r={4 * inv} fill="#8b5cf6" opacity="0.2" />
              <circle cx={stp.sx} cy={stp.sy} r={3 * inv} fill="#8b5cf6" />
              <text x={stp.sx + 6 * inv}  y={stp.sy + 4 * inv}  fill="#c4b5fd" fontSize={8 * inv} fontFamily="inherit">STEREO-A</text>
              <text x={stp.sx + 6 * inv}  y={stp.sy + 13 * inv} fill="#a78bfa" fontSize={7 * inv} fontFamily="inherit" opacity="0.7">
                {positions.stereoA.r_au.toFixed(3)} AU
              </text>
            </g>
          )}

          {/* ── Solar Orbiter ── */}
          {sp && positions.solo && (
            <g>
              {isUpstream && (
                <circle cx={sp.sx} cy={sp.sy} r={8 * inv} fill="#f97316" opacity="0.12">
                  <animate attributeName="r"       values={`${7*inv};${11*inv};${7*inv}`} dur="2.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.12;0.04;0.12"               dur="2.5s" repeatCount="indefinite" />
                </circle>
              )}
              <circle cx={sp.sx} cy={sp.sy} r={5 * inv}   fill="#f97316" opacity="0.2" />
              <circle cx={sp.sx} cy={sp.sy} r={3.5 * inv} fill="#ea580c" />
              {/* Solar panel cross */}
              <line x1={sp.sx - 5 * inv} y1={sp.sy} x2={sp.sx + 5 * inv} y2={sp.sy}
                stroke="#f97316" strokeWidth={1 * inv} opacity="0.55" vectorEffect="non-scaling-stroke" />
              <line x1={sp.sx} y1={sp.sy - 5 * inv} x2={sp.sx} y2={sp.sy + 5 * inv}
                stroke="#f97316" strokeWidth={1 * inv} opacity="0.55" vectorEffect="non-scaling-stroke" />
              <text x={sp.sx + 8 * inv} y={sp.sy + 4 * inv}  fill="#fb923c" fontSize={8 * inv} fontFamily="inherit">SolO</text>
              <text x={sp.sx + 8 * inv} y={sp.sy + 13 * inv} fill="#f97316" fontSize={7 * inv} fontFamily="inherit" opacity="0.7">
                {positions.solo.r_au.toFixed(3)} AU
              </text>
              {sepDeg !== undefined && (
                <text x={sp.sx + 8 * inv} y={sp.sy + 22 * inv}
                  fill={isUpstream ? '#fb923c' : '#6b7280'} fontSize={7 * inv} fontFamily="inherit" opacity="0.8">
                  {sepDeg.toFixed(1)}° sep
                </text>
              )}
            </g>
          )}

          <text x={CX} y={12 * inv} fill="#3f3f46" fontSize={7 * inv} fontFamily="inherit" textAnchor="middle">↑ Ecliptic North</text>
        </g>
      </svg>

      {/* Zoom level indicator */}
      <div className="absolute bottom-2 left-2 text-[10px] text-neutral-600 font-mono pointer-events-none">
        {zoom.toFixed(1)}×
      </div>
      {/* Hint */}
      <div className="absolute bottom-2 right-2 text-[10px] text-neutral-700 pointer-events-none">
        scroll to zoom · drag to pan
      </div>
    </div>
  );
};

// ─── Spinner ──────────────────────────────────────────────────────────────────
const Spinner: React.FC = () => (
  <svg className="animate-spin h-7 w-7 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

// ─── Main component ───────────────────────────────────────────────────────────
const SoloPanel: React.FC = () => {
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
      <div className="flex items-center justify-between mb-1 gap-2">
        <h2 className="text-xl font-semibold text-white">Solar Orbiter (SolO)</h2>
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
        <div className={`${qs.bg} border ${qs.border} rounded-lg px-4 py-3 mb-6`}>
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

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 1 — HELIOCENTRIC MAP                                        */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-neutral-200">Heliocentric Position Map</h3>
          <span className="text-[11px] text-neutral-600">JPL Horizons · updated every 6h</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Map */}
          <div className="lg:col-span-7 rounded-lg border border-neutral-800 bg-black/80 overflow-hidden"
            style={{ minHeight: 340, height: 420 }}>
            {loading && !position ? (
              <div className="w-full h-full bg-neutral-800/50 animate-pulse" />
            ) : position ? (
              <HeliocentricMap data={position} />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <p className="text-neutral-500 text-sm italic">Position data unavailable — check back after first cron run</p>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="lg:col-span-5 rounded-lg border border-neutral-800 bg-neutral-900/70 p-3 flex flex-col gap-3">
            {(['solo', 'stereoA', 'earth'] as const).map(key => {
              const sc = position?.positions?.[key];
              if (!sc) return <div key={key} className="bg-neutral-950/70 rounded p-2.5 border border-neutral-800 animate-pulse h-16" />;
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

            {/* GOES note */}
            <div className="bg-neutral-950/70 rounded p-2.5 border border-neutral-800">
              <div className="text-xs font-semibold mb-1" style={{ color: '#fde047' }}>GOES (Geostationary)</div>
              <p className="text-xs text-neutral-500 leading-relaxed">
                GOES-East & GOES-West orbit at ~35,786 km altitude (~0.000282 AU). Their orbit is too small to show at heliocentric scale — the dashed ring and ◆ marker around Earth are exaggerated for visibility.
              </p>
            </div>

            {/* Separations */}
            {derived && (
              <div className="bg-neutral-950/70 rounded p-2.5 border border-neutral-800">
                <div className="text-xs font-semibold text-neutral-400 mb-1.5">Angular Separations from Sun-Earth line</div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Solar Orbiter</span>
                    <span className={`font-semibold ${isUpstream ? 'text-orange-300' : 'text-neutral-300'}`}>
                      {derived.solo_earth_lon_sep_deg.toFixed(1)}°
                    </span>
                  </div>
                  {derived.stereo_earth_lon_sep_deg !== undefined && (
                    <div className="flex justify-between">
                      <span className="text-neutral-500">STEREO-A</span>
                      <span className="text-neutral-300 font-semibold">{derived.stereo_earth_lon_sep_deg.toFixed(1)}°</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {[
                { color: '#fbbf24', label: 'Sun' },
                { color: '#3b82f6', label: 'Earth' },
                { color: '#34d399', label: 'L1' },
                { color: '#fde047', label: 'GOES (GEO*)' },
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
      </div>

      {/* ════════════════════════════════════════════════════════════════════ */}
      {/* SECTION 2 — EUI IMAGERY                                             */}
      {/* ════════════════════════════════════════════════════════════════════ */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-neutral-200">EUI Solar Imagery</h3>
          <span className="text-[11px] text-neutral-600">ESA/NASA Helioviewer · hours–days latency</span>
        </div>

        {/* Channel selector */}
        {imagery?.channels && imagery.channels.length > 0 && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
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
          <div className="lg:col-span-7 rounded-lg border border-neutral-800 bg-black/80 flex items-center justify-center overflow-hidden"
            style={{ minHeight: 320 }}>
            {loading && !imagery ? (
              <div className="w-full h-64 bg-neutral-800/50 animate-pulse" />
            ) : channel ? (
              <div className="relative w-full h-full flex items-center justify-center" style={{ minHeight: 280 }}>
                {!imgLoaded && !imgError && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Spinner />
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

          {/* Metadata */}
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

            <div className="mt-3 pt-3 border-t border-neutral-800">
              <p className="text-xs text-neutral-500 leading-relaxed">
                The <strong className="text-neutral-400">EUI Full Sun Imager</strong> observes the entire solar disk at 174 Å (hot corona) and 304 Å (chromosphere/transition region) — revealing active regions, filaments, coronal loops, and eruption sites invisible in white light. SolO's off-ecliptic orbit provides unique polar viewing angles unavailable from Earth-orbiting satellites.
              </p>
            </div>

            {imagery?.latency_note && (
              <div className="flex items-start gap-2 px-3 py-2.5 bg-amber-900/30 border border-amber-700/40 rounded-lg mt-2">
                <span className="text-amber-400 flex-shrink-0 mt-0.5">⚠</span>
                <p className="text-xs text-amber-300/80 leading-relaxed">{imagery.latency_note}</p>
              </div>
            )}

            <p className="text-[11px] text-neutral-700 mt-1">
              Data: Royal Observatory of Belgium (SIDC) · via ESA/NASA Helioviewer Project
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SoloPanel;
// --- END OF FILE components/SoloPanel.tsx ---