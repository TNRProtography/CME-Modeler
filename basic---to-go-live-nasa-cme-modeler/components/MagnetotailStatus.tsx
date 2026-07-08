// --- START OF FILE src/components/MagnetotailStatus.tsx ---
//
// Live Magnetotail Status (mobile-first)
// Earth's magnetosphere in real time with textured globe, IGRF-13 oval,
// animated field lines, and tier markers for snap intensity.

import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { computeOvalBoundary as computeOvalBoundaryPhysics, avgBy30m, loadingMinutesFromSeries } from '../utils/ovalPhysics';

const EARTH_TEX = 'https://upload.wikimedia.org/wikipedia/commons/c/c3/Solarsystemscope_texture_2k_earth_daymap.jpg';

// ---- Types ----
interface SubstormRiskDataLike {
  current: { score: number; level: string; risk_trend: string; bay_onset_flag: boolean; confidence: number | null };
  metrics: { solar_wind: { bz: number; bt: number; speed: number; density: number; dynamic_pressure_nPa: number; avg_30m_pressure_nPa: number; newell_coupling_now: number; newell_avg_30m: number; newell_avg_60m: number; southward_minutes_30m: number } };
}
interface SubstormForecastLike { status: 'QUIET' | 'WATCH' | 'LIKELY_60' | 'IMMINENT_30' | 'ONSET'; p30: number; p60: number }
interface Props {
  substormRiskData: SubstormRiskDataLike | null | undefined;
  substormForecast: SubstormForecastLike;
  onOpenModal: () => void;
  /** Proxy-derived data from RTSW merged-24h */
  proxyMagneticData?: { time: number; bt: number; bz: number; by: number; bx: number }[];
  proxyPressureData?: { x: number; y: number }[];
  proxyNewellData?: { x: number; y: number }[];
}

// ---- State machine ----
type MagState = 'QUIET' | 'LOADING' | 'STRETCHED' | 'SNAPPING';
function deriveMagState(risk: SubstormRiskDataLike | null | undefined, fc: SubstormForecastLike): MagState {
  if (!risk) return 'QUIET';
  const { score, bay_onset_flag } = risk.current;
  if (bay_onset_flag || fc.status === 'ONSET') return 'SNAPPING';
  if (fc.status === 'IMMINENT_30' || fc.p30 >= 0.55) return 'STRETCHED';
  if (score >= 25 || fc.status === 'LIKELY_60' || fc.status === 'WATCH') return 'LOADING';
  return 'QUIET';
}

// ---- Oval boundary (shared physics - same as AuroraSightings / What to Expect / push worker) ----
function computeOvalBoundary(
  risk: SubstormRiskDataLike | null | undefined,
  proxyNewellData?: { x: number; y: number }[],
  latestBy: number | null = null,
  pdynNPa: number | null = null,
): number {
  // Compute newell from proxy data if available
  let n60 = 0, n30 = 0;
  if (proxyNewellData && proxyNewellData.length > 0) {
    const now = Date.now();
    const pts60 = proxyNewellData.filter(p => p.x >= now - 60 * 60000);
    const pts30 = proxyNewellData.filter(p => p.x >= now - 30 * 60000);
    n60 = pts60.length > 0 ? pts60.reduce((s, p) => s + p.y, 0) / pts60.length : 0;
    n30 = pts30.length > 0 ? pts30.reduce((s, p) => s + p.y, 0) / pts30.length : 0;
  }
  if (!n60 && !n30 && !risk) return -65.5;
  if (!n60 && !n30 && risk) {
    n60 = risk.metrics.solar_wind.newell_avg_60m ?? 0;
    n30 = risk.metrics.solar_wind.newell_avg_30m ?? 0;
  }
  return computeOvalBoundaryPhysics(
    {
      newell_avg_60m: n60,
      newell_avg_30m: n30,
      avg_30m_pressure_nPa: pdynNPa ?? risk?.metrics?.solar_wind?.avg_30m_pressure_nPa,
      dynamic_pressure_nPa: risk?.metrics?.solar_wind?.dynamic_pressure_nPa,
      by: latestBy,
      bz: risk?.metrics?.solar_wind?.bz,
    },
    risk?.current?.bay_onset_flag ?? false,
  );
}
// ---- IGRF-13 (same as AuroraSightings) ----
const POLE_LAT_RAD = 80.65 * Math.PI / 180;
const POLE_LON_RAD = -72.68 * Math.PI / 180;
function geoToGmag(latDeg: number, lonDeg: number): number {
  const p = latDeg * Math.PI / 180, l = lonDeg * Math.PI / 180;
  return Math.asin(Math.max(-1, Math.min(1, Math.sin(p) * Math.sin(POLE_LAT_RAD) + Math.cos(p) * Math.cos(POLE_LAT_RAD) * Math.cos(l - POLE_LON_RAD)))) * 180 / Math.PI;
}
function gmagToGeoLat(gmagLat: number, lonDeg: number): number {
  let lo = -90, hi = 90;
  for (let i = 0; i < 48; i++) { const m = (lo + hi) / 2; if (geoToGmag(m, lonDeg) < gmagLat) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

// ---- Visual ----
const LABELS: Record<MagState, string> = { QUIET: 'Quiet', LOADING: 'Loading', STRETCHED: 'Stretched', SNAPPING: 'Reconnecting' };
const EMOJI: Record<MagState, string> = { QUIET: '🛡️', LOADING: '⚡', STRETCHED: '🔋', SNAPPING: '💥' };
const COLOURS: Record<MagState, string> = { QUIET: '#38bdf8', LOADING: '#fbbf24', STRETCHED: '#fb923c', SNAPPING: '#f87171' };

// ---- Layout (compact for mobile) ----
const CX = 200, CY = 172, R = 48;
const GLOBE_PX = 170;
const VB_W = 700, VB_H = 344;
const SUN_X = 22, SUN_R = 22;

// ---- Tier system ----
interface Tier { label: string; score: number; colour: string; x: number; nzNote: string }
function buildTiers(): Tier[] {
  const baseX = CX + R * 1.4;
  const span = VB_W - baseX - 24;
  const t = (f: number) => baseX + span * f;
  return [
    { label: 'Minor',    score: 15,  colour: '#38bdf8', x: t(0.0),  nzNote: 'Camera only, deep south' },
    { label: 'Moderate', score: 30,  colour: '#34d399', x: t(0.17), nzNote: 'Camera aurora, South Island' },
    { label: 'Active',   score: 45,  colour: '#a3e635', x: t(0.34), nzNote: 'Phone camera, South Island' },
    { label: 'Strong',   score: 60,  colour: '#fbbf24', x: t(0.51), nzNote: 'Naked eye, South Island' },
    { label: 'Major',    score: 75,  colour: '#fb923c', x: t(0.68), nzNote: 'Bright display, overhead SI' },
    { label: 'Extreme',  score: 90,  colour: '#f87171', x: t(0.85), nzNote: 'Vivid overhead, a lot of NZ' },
  ];
}
const TIERS = buildTiers();

function scoreToTailX(score: number): number {
  if (score <= TIERS[0].score) return CX + R * 0.8;
  if (score >= TIERS[TIERS.length - 1].score) return TIERS[TIERS.length - 1].x + 16;
  for (let i = 0; i < TIERS.length - 1; i++) {
    if (score <= TIERS[i + 1].score) {
      const frac = (score - TIERS[i].score) / (TIERS[i + 1].score - TIERS[i].score);
      return TIERS[i].x + frac * (TIERS[i + 1].x - TIERS[i].x);
    }
  }
  return TIERS[TIERS.length - 1].x;
}

// ---- Field line builders ----
function dayFieldLine(yOff: number, reach: number, comp: number): string {
  const x0 = CX - 2, xCp = CX - R * comp * reach;
  return `M ${x0} ${CY - yOff} C ${xCp} ${CY - yOff - 5}, ${xCp} ${CY + yOff + 5}, ${x0} ${CY + yOff}`;
}
function nightLine(yOff: number, tailEndX: number): string {
  const x0 = CX + 2;
  return `M ${x0} ${CY - yOff} C ${CX + R * 0.8} ${(CY - yOff) - 3 * Math.sign(yOff)}, ${CX + (tailEndX - CX) * 0.6} ${CY - yOff * 0.12}, ${tailEndX} ${CY}`;
}
function mpausePath(comp: number, tailEndX: number): string {
  const noseX = CX - R * (1.5 * comp + 0.4);
  const topY = CY - R * 2.2, botY = CY + R * 2.2;
  return `M ${noseX} ${CY-R*0.5} C ${noseX-12} ${topY+26}, ${CX-R*0.5} ${topY}, ${CX+R} ${topY+8} L ${tailEndX+16} ${topY+26} L ${tailEndX+16} ${botY-26} L ${CX+R} ${botY-8} C ${CX-R*0.5} ${botY}, ${noseX-12} ${botY-26}, ${noseX} ${CY+R*0.5} Z`;
}
function dayComp(pressure: number): number { return 1 - (Math.max(1, Math.min(pressure, 20)) - 1) / 30; }

// ---- Globe renderer with IGRF-13 curved oval ----
function renderGlobe(
  canvas: HTMLCanvasElement, tex: HTMLImageElement,
  centreLon: number, ovalBound: number, score: number, isSnapping: boolean
) {
  const size = GLOBE_PX;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const tmp = document.createElement('canvas');
  tmp.width = tex.naturalWidth; tmp.height = tex.naturalHeight;
  const tCtx = tmp.getContext('2d')!;
  tCtx.drawImage(tex, 0, 0);
  const texPx = tCtx.getImageData(0, 0, tmp.width, tmp.height);
  const out = ctx.createImageData(size, size);
  const half = size / 2, cLon = (centreLon * Math.PI) / 180;
  const tw = tex.naturalWidth, th = tex.naturalHeight;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const nx = (px - half) / half, ny = (py - half) / half;
      if (nx * nx + ny * ny > 1) continue;
      const lat = Math.asin(-ny), cosLat = Math.cos(lat);
      if (cosLat < 0.0001) continue;
      const sinDlon = nx / cosLat;
      if (Math.abs(sinDlon) > 1) continue;
      const lon = Math.asin(sinDlon) + cLon;
      let u = ((lon * 180 / Math.PI) + 180) / 360;
      u = ((u % 1) + 1) % 1;
      const v = (90 - lat * 180 / Math.PI) / 180;
      const tx = Math.min(tw - 1, Math.max(0, Math.floor(u * tw)));
      const ty = Math.min(th - 1, Math.max(0, Math.floor(v * th)));
      const si = (ty * tw + tx) * 4, di = (py * size + px) * 4;
      out.data[di] = texPx.data[si]; out.data[di+1] = texPx.data[si+1];
      out.data[di+2] = texPx.data[si+2]; out.data[di+3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  // Specular + limb
  ctx.globalCompositeOperation = 'source-atop';
  const grad = ctx.createRadialGradient(half * 0.65, half * 0.55, 0, half, half, half);
  grad.addColorStop(0, 'rgba(255,255,255,0.13)'); grad.addColorStop(0.45, 'rgba(255,255,255,0.02)');
  grad.addColorStop(0.85, 'rgba(0,0,20,0.18)'); grad.addColorStop(1, 'rgba(0,0,20,0.45)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, size, size);
  // Terminator
  const term = ctx.createLinearGradient(half - 6, 0, half + 16, 0);
  term.addColorStop(0, 'rgba(0,0,0,0)'); term.addColorStop(0.5, 'rgba(0,0,15,0.12)'); term.addColorStop(1, 'rgba(0,0,15,0.32)');
  ctx.fillStyle = term; ctx.fillRect(0, 0, size, size);

  // ---- Aurora oval as a glowing band (OVATION-like) ----
  // Build a ring of screen points at any geomagnetic latitude.
  const DR = Math.PI / 180;
  function ringPts(gmagLat: number) {
    const pts: { x: number; y: number; vis: boolean }[] = [];
    for (let lon = 0; lon <= 360; lon += 4) {
      const normLon = lon <= 180 ? lon : lon - 360;
      const geoLat = gmagToGeoLat(gmagLat, normLon);
      const latR = geoLat * DR;
      const dlonR = (normLon - centreLon) * DR;
      const cosC = Math.cos(latR) * Math.cos(dlonR);
      pts.push({ x: half + half * Math.cos(latR) * Math.sin(dlonR), y: half - half * Math.sin(latR), vis: cosC > 0 });
    }
    return pts;
  }
  function strokeVisible(pts: { x: number; y: number; vis: boolean }[]) {
    ctx.beginPath();
    let on = false;
    for (const p of pts) {
      if (p.vis) { if (!on) { ctx.moveTo(p.x, p.y); on = true; } else ctx.lineTo(p.x, p.y); }
      else on = false;
    }
    ctx.stroke();
  }

  // Clip everything to the globe disc so the glow can't spill into space
  ctx.save();
  ctx.beginPath(); ctx.arc(half, half, half - 0.5, 0, Math.PI * 2); ctx.clip();

  const act = Math.min(1, score / 100);                 // 0..1 activity
  const widthDeg = 3.5 + act * 7 + (isSnapping ? 2 : 0); // band gets wider with activity
  const layers = 16;
  const base = 0.09 + act * 0.17 + (isSnapping ? 0.1 : 0);
  const bandPx = (half * widthDeg) / 90;                 // band width in pixels

  ctx.globalCompositeOperation = 'lighter';             // additive = emissive glow
  ctx.lineCap = 'round';
  ctx.globalAlpha = 1;

  // Layered curtains from the bright equatorward edge fading toward the pole
  for (let i = 0; i < layers; i++) {
    const f = i / (layers - 1);                          // 0 = equatorward edge, 1 = poleward
    const gmagLat = ovalBound - f * widthDeg;            // toward the pole (more negative)
    const prof = Math.pow(1 - f, 1.5);                   // bright low edge, soft fade up
    const alpha = base * (0.22 + 0.78 * prof);
    let r = 70, g = 215, bl = 130;                       // aurora green
    if (f < 0.4 && act > 0.4) {                          // crimson fringe on the low edge when strong
      const redMix = ((act - 0.4) / 0.6) * (1 - f / 0.4);
      r = Math.round(70 + redMix * 185);
      g = Math.round(215 - redMix * 95);
      bl = Math.round(130 - redMix * 55);
    }
    ctx.strokeStyle = `rgba(${r},${g},${bl},${alpha.toFixed(3)})`;
    ctx.lineWidth = (bandPx / layers) * 2.6 + 0.6;
    ctx.filter = `blur(${(1 + f * 2.4).toFixed(1)}px)`;
    strokeVisible(ringPts(gmagLat));
  }

  // Crisp bright lower edge that defines the oval
  ctx.filter = 'blur(0.5px)';
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = `rgba(160,255,195,${(0.45 + act * 0.4).toFixed(2)})`;
  strokeVisible(ringPts(ovalBound));
  ctx.filter = 'none';
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  // NZ dot
  const nzLatR = (-43.5 * Math.PI) / 180, nzDlon = ((172 - centreLon) * Math.PI) / 180;
  const nzX = half + half * Math.cos(nzLatR) * Math.sin(nzDlon), nzY = half - half * Math.sin(nzLatR);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.9; ctx.fillStyle = '#5fb47a'; ctx.beginPath(); ctx.arc(nzX, nzY, 3, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.45; ctx.strokeStyle = '#5fb47a'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(nzX, nzY, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
}

// ======================================================================
// Story mode: a 5-step guided tour of how aurora forms. Each step dims
// the scene, spotlights one part, and explains it in one plain sentence.
// The final step forces a demo snap so new users see the payoff without
// waiting for a real substorm.
interface StoryStep { title: string; text: string; focus: string[] }
const STORY: StoryStep[] = [
  {
    title: '1 · The wind',
    text: 'The Sun constantly blasts Earth with a wind of charged particles - about a million tonnes of it every second.',
    focus: ['sun'],
  },
  {
    title: '2 · The shield',
    text: "Earth lives inside a magnetic bubble. Most of the time the wind just slides around it, and nothing happens in our sky.",
    focus: ['sun', 'bubble', 'hero', 'earth'],
  },
  {
    title: '3 · The door',
    text: "The wind carries its own magnetic field - this dial shows its direction. When it swings SOUTH, it unlocks Earth's field at the front door.",
    focus: ['sun', 'clock', 'daysideX'],
  },
  {
    title: '4 · The slingshot',
    text: "Unlocked field lines get peeled back over the poles and stacked into a long tail behind Earth - a slingshot being stretched, storing enormous energy.",
    focus: ['sun', 'bubble', 'hero', 'tail'],
  },
  {
    title: '5 · The snap',
    text: 'Eventually the tail snaps. The field line recoils toward Earth, hurling particles into the air above the poles - and the sky ignites. That is the aurora.',
    focus: ['bubble', 'tail', 'earth'],
  },
];

// ======================================================================
const MagnetotailStatus: React.FC<Props> = ({ substormRiskData, substormForecast, onOpenModal, proxyMagneticData, proxyPressureData, proxyNewellData }) => {
  const magState = deriveMagState(substormRiskData, substormForecast);
  const score = substormRiskData?.current?.score ?? 0;
  // Prefer proxy RTSW data, fall back to substorm worker
  const bz = (proxyMagneticData && proxyMagneticData.length > 0 ? proxyMagneticData[proxyMagneticData.length - 1].bz : null) ?? substormRiskData?.metrics?.solar_wind?.bz ?? 0;
  const by = (proxyMagneticData && proxyMagneticData.length > 0 ? proxyMagneticData[proxyMagneticData.length - 1].by : null) ?? 0;
  const speed = substormRiskData?.metrics?.solar_wind?.speed ?? null;
  const pressure = (proxyPressureData && proxyPressureData.length > 0 ? proxyPressureData[proxyPressureData.length - 1].y : null) ?? substormRiskData?.metrics?.solar_wind?.dynamic_pressure_nPa ?? 2;
  const latestByRM = useMemo(() => avgBy30m(proxyMagneticData), [proxyMagneticData]);
  // Deterministic loading duration - same scan as the push worker, so the
  // panel and notifications always quote the same number of minutes.
  const loadingMinutes = useMemo(() => loadingMinutesFromSeries(proxyNewellData), [proxyNewellData]);
  const ovalBound = computeOvalBoundary(substormRiskData, proxyNewellData, latestByRM, pressure);
  const comp = dayComp(pressure);

  // ── Story mode state ──
  const [story, setStory] = useState<number | null>(null);
  const [storySeen, setStorySeen] = useState(true);
  useEffect(() => {
    try { setStorySeen(localStorage.getItem('mt-story-seen') === '1'); } catch { /* ignore */ }
  }, []);
  const openStory = useCallback(() => {
    setStory(0);
    try { localStorage.setItem('mt-story-seen', '1'); } catch { /* ignore */ }
    setStorySeen(true);
  }, []);
  const closeStory = useCallback(() => setStory(null), []);
  const inStory = story != null;
  const demoSnap = story === 4;

  // Effective visual state: story step 5 forces the snap so the payoff is
  // always demonstrable; otherwise live data drives it.
  const isSnapping = magState === 'SNAPPING' || demoSnap;
  const effScore = demoSnap ? Math.max(score, 55) : score;
  const tailEndX = isSnapping ? scoreToTailX(Math.max(effScore, 40)) : scoreToTailX(effScore);

  // ── The "door": is the wind's field unlocking Earth's? ──
  // Plain-language translation of Bz, the single most confusing number in
  // space weather. Story step 3 forces the needle south for the demo.
  const doorState: 'OPEN' | 'AJAR' | 'LOCKED' = story === 2 ? 'OPEN' : bz <= -2 ? 'OPEN' : bz < 1 ? 'AJAR' : 'LOCKED';
  const DOOR_COLOURS = { OPEN: '#34d399', AJAR: '#fbbf24', LOCKED: '#38bdf8' } as const;
  const DOOR_TEXT = { OPEN: 'unlocking', AJAR: 'neutral', LOCKED: 'locked' } as const;
  // Clock angle: 0 = north (up), 180 = south (down). atan2(By, Bz).
  const clockDeg = story === 2 ? 172 : (Math.atan2(by, bz) * 180 / Math.PI + 360) % 360;

  // ── Hero field line: teaches the journey when a snap isn't live ──
  // 'journey' = the full peel-over-and-stack Dungey cycle (door open)
  // 'deflect' = wind sliding around the closed bubble (door shut)
  const heroMode: 'journey' | 'deflect' | 'none' = (() => {
    if (isSnapping) return 'none';                 // the real event takes the stage
    if (story === 1) return 'deflect';
    if (story === 3) return 'journey';
    if (story === 0 || story === 2) return 'none'; // those steps focus elsewhere
    return doorState === 'OPEN' || doorState === 'AJAR' ? 'journey' : 'deflect';
  })();

  // ── Focus dimming for story mode ──
  const dim = useCallback((key: string): number => {
    if (story == null) return 1;
    return STORY[story].focus.includes(key) ? 1 : 0.13;
  }, [story]);

  // Globe
  const [earthUrl, setEarthUrl] = useState<string | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const texImgRef = useRef<HTMLImageElement | null>(null);
  const texLoadedRef = useRef(false);
  useEffect(() => {
    function paint() {
      if (!texImgRef.current || !texLoadedRef.current) return;
      if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
      renderGlobe(offscreenRef.current, texImgRef.current, 172, ovalBound, effScore, isSnapping);
      setEarthUrl(offscreenRef.current.toDataURL());
    }
    if (texLoadedRef.current) paint();
    else if (!texImgRef.current) {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = EARTH_TEX;
      texImgRef.current = img; img.onload = () => { texLoadedRef.current = true; paint(); };
    }
  }, [ovalBound, effScore, isSnapping]);

  // Tooltip (tap-friendly: tap toggles, hover works on desktop)
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTip = useCallback((e: React.MouseEvent | React.TouchEvent, text: string) => {
    if (!svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const svgX = ((clientX - r.left) / r.width) * VB_W;
    const svgY = ((clientY - r.top) / r.height) * VB_H;
    setTip({ text, x: svgX, y: svgY - 10 });
    if (tipTimeout.current) clearTimeout(tipTimeout.current);
    tipTimeout.current = setTimeout(() => setTip(null), 4000);
  }, []);
  const hideTip = useCallback(() => {
    if (tipTimeout.current) clearTimeout(tipTimeout.current);
    setTip(null);
  }, []);

  // SVG paths
  const dayLines = useMemo(() => [
    dayFieldLine(R * 0.42, 2.0, comp), dayFieldLine(R * 0.58, 2.4, comp), dayFieldLine(R * 0.74, 2.8, comp),
  ], [comp]);
  const nightTop = useMemo(() => [nightLine(R * 0.42, tailEndX), nightLine(R * 0.58, tailEndX), nightLine(R * 0.74, tailEndX)], [tailEndX]);
  const nightBot = useMemo(() => [nightLine(-R * 0.42, tailEndX), nightLine(-R * 0.58, tailEndX), nightLine(-R * 0.74, tailEndX)], [tailEndX]);
  const mpause = useMemo(() => mpausePath(comp, tailEndX), [comp, tailEndX]);
  const noseX = CX - R * (1.5 * comp + 0.4);

  // Hero peel paths: from the dayside nose, over the pole, into the tail.
  // pathLength=100 makes the draw-on dash math trivial.
  const heroPeelTop = useMemo(() =>
    `M ${noseX + 4} ${CY - R * 0.5} C ${noseX - 8} ${CY - R * 1.7}, ${CX - R * 0.4} ${CY - R * 2.02}, ${CX + R * 0.9} ${CY - R * 1.9} S ${CX + (tailEndX - CX) * 0.7} ${CY - R * 1.2}, ${tailEndX - 24} ${CY - R * 0.28}`,
  [noseX, tailEndX]);
  const heroPeelBot = useMemo(() =>
    `M ${noseX + 4} ${CY + R * 0.5} C ${noseX - 8} ${CY + R * 1.7}, ${CX - R * 0.4} ${CY + R * 2.02}, ${CX + R * 0.9} ${CY + R * 1.9} S ${CX + (tailEndX - CX) * 0.7} ${CY + R * 1.2}, ${tailEndX - 24} ${CY + R * 0.28}`,
  [noseX, tailEndX]);
  // Deflect path: the wind streamline sliding around the closed bubble
  const heroDeflect = useMemo(() =>
    `M ${SUN_X + SUN_R + 14} ${CY - 26} C ${noseX - 34} ${CY - 30}, ${noseX - 26} ${CY - R * 1.9}, ${CX} ${CY - R * 2.3} S ${CX + (tailEndX - CX) * 0.8} ${CY - R * 2.1}, ${tailEndX + 30} ${CY - R * 1.7}`,
  [noseX, tailEndX]);
  // Hero recoil loop (gold, gentler than the snap version)
  const heroLoop = useMemo(() => {
    const xL = tailEndX - 26;
    return `M ${CX + 2} ${CY - R * 0.4} C ${CX + R * 0.85} ${CY - R * 0.48}, ${xL - 12} ${CY - R * 0.3}, ${xL} ${CY} C ${xL - 12} ${CY + R * 0.3}, ${CX + R * 0.85} ${CY + R * 0.48}, ${CX + 2} ${CY + R * 0.4}`;
  }, [tailEndX]);

  const tailLabel = isSnapping ? 'Reconnection' : effScore >= 60 ? 'Highly stretched' : effScore >= 30 ? 'Stretching' : 'Relaxed';
  const currentTierIdx = useMemo(() => { for (let i = TIERS.length - 1; i >= 0; i--) { if (effScore >= TIERS[i].score) return i; } return -1; }, [effScore]);

  // Plain-language status strip pieces
  const chargeText = loadingMinutes >= 180
    ? `charging ${ (loadingMinutes / 60).toFixed(loadingMinutes >= 600 ? 0 : 1) }h`
    : loadingMinutes >= 15 ? `charging ${loadingMinutes} min` : 'not charging';
  const snapNowText = currentTierIdx >= 0 ? TIERS[currentTierIdx].nzNote : 'below camera threshold';

  const loadingSuffix = (() => {
    if (loadingMinutes < 20) return '';
    if (loadingMinutes >= 180) {
      const hrs = (loadingMinutes / 60).toFixed(loadingMinutes >= 600 ? 0 : 1);
      return ` Coupling has been elevated for over ${hrs} hours - under sustained driving like this, substorms typically recur every 1 to 3 hours.`;
    }
    if (loadingMinutes >= 45) return ` Coupling has been elevated for ${loadingMinutes} minutes - inside the typical substorm release window.`;
    return ` Coupling has been elevated for ${loadingMinutes} minutes.`;
  })();
  const stateDesc: Record<MagState, string> = {
    QUIET: 'Magnetosphere relaxed. No substorm activity expected.',
    LOADING: `Southward Bz is feeding energy into the magnetotail. The night-side field is starting to stretch.${loadingSuffix}`,
    STRETCHED: `Tail is highly stretched. A reconnection event could fire in the next 15 to 30 minutes.${loadingSuffix}`,
    SNAPPING: 'Reconnection in progress! Particles funnelling onto the poles, lighting the aurora.',
  };

  // Layout constants for the IMF clock (top-left, above the Sun - it belongs
  // to the wind, so it lives on the wind's side of the scene)
  const CLK_X = 64, CLK_Y = 74, CLK_R = 24;

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-3 sm:p-4 flex flex-col overflow-hidden">
      <style>{`
        .mt-scroll::-webkit-scrollbar { height: 5px; }
        .mt-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); border-radius: 3px; }
        .mt-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
        .mt-scroll { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.15) transparent; }
        @keyframes mtHintPulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.85; } }
        .mt-hint { animation: mtHintPulse 2.5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .mt-hint { animation: none; } }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-1 mb-1">
        <div className="flex items-center gap-1.5">
          <h3 className="text-lg sm:text-xl font-semibold text-white">Magnetotail Status</h3>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            BETA
          </span>
          <button onClick={onOpenModal}
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
            title="About Magnetotail Status">?</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openStory}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${storySeen ? 'text-neutral-400 border-neutral-700 hover:text-white hover:border-neutral-500' : 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10 mt-hint'}`}
            title="A 60-second guided tour of how aurora forms">
            ▶ How aurora forms
          </button>
          <span className="text-xl sm:text-2xl">{EMOJI[magState]}</span>
          <span className="text-base sm:text-lg font-bold" style={{ color: COLOURS[magState] }}>{LABELS[magState]}</span>
        </div>
      </div>

      {/* Plain-language status strip: the whole system in one glance */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] mb-0.5">
        <span className="flex items-center gap-1">
          <span>🚪</span>
          <span className="text-neutral-400">Field door:</span>
          <span className="font-semibold" style={{ color: DOOR_COLOURS[doorState] }}>{doorState}</span>
        </span>
        <span className="flex items-center gap-1">
          <span>🔋</span>
          <span className="text-neutral-400">Slingshot:</span>
          <span className="font-semibold text-neutral-200">{chargeText}</span>
        </span>
        <span className="flex items-center gap-1">
          <span>🎯</span>
          <span className="text-neutral-400">Snap now →</span>
          <span className="font-semibold" style={{ color: currentTierIdx >= 0 ? TIERS[currentTierIdx].colour : '#71717a' }}>{snapNowText}</span>
        </span>
      </div>
      <div className="text-[10px] text-neutral-500 mb-2">
        {tailLabel} · Bz {bz.toFixed(1)} nT · By {by.toFixed(1)} nT{speed != null ? ` · ${Math.round(speed)} km/s` : ''} · {pressure.toFixed(1)} nPa
      </div>

      {/* SVG scene */}
      <div className="overflow-x-auto overflow-y-hidden mt-1 rounded-lg mt-scroll" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="relative min-w-[680px] sm:min-w-0" style={{ aspectRatio: `${VB_W}/${VB_H}` }}>
        <svg ref={svgRef} viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
          <style>{`
            @keyframes mtFlow { to { stroke-dashoffset: -160; } }
            /* ── Reconnection master cycle (3.6s): stretch/pinch (0-30%) ->
               SNAP (30-38%) -> recoil earthward + plasmoid ejects (36-72%)
               -> particles rain (44-78%) -> aurora flares (52-92%) -> reset */
            @keyframes mtPinchT { 0% { transform:translateY(0); opacity:.72; } 26% { transform:translateY(4.5px); opacity:.8; } 31% { transform:translateY(6px); opacity:.9; } 34% { opacity:0; } 100% { opacity:0; } }
            @keyframes mtPinchB { 0% { transform:translateY(0); opacity:.72; } 26% { transform:translateY(-4.5px); opacity:.8; } 31% { transform:translateY(-6px); opacity:.9; } 34% { opacity:0; } 100% { opacity:0; } }
            @keyframes mtSnap { 0%,26% { opacity:0; transform:scale(.5); } 31% { opacity:1; transform:scale(1.15); } 42% { opacity:0; transform:scale(1.7); } 100% { opacity:0; } }
            @keyframes mtRecoil { 0%,31% { opacity:0; transform:scaleX(1); } 36% { opacity:1; transform:scaleX(1); } 58% { transform:scaleX(.52); opacity:.95; } 70% { transform:scaleX(.42); opacity:.85; } 88% { transform:scaleX(.42); opacity:0; } 100% { opacity:0; } }
            @keyframes mtEject { 0%,32% { transform:translateX(0); opacity:0; } 38% { opacity:.85; } 100% { transform:translateX(115px); opacity:0; } }
            @keyframes mtPrecip { 0%,40% { opacity:0; } 50% { opacity:.85; } 70% { opacity:.4; } 80%,100% { opacity:0; } }
            @keyframes mtAurora { 0%,48% { opacity:0; } 60% { opacity:1; } 80% { opacity:.55; } 94%,100% { opacity:0; } }
            @keyframes mtAtmo { 0%,46% { opacity:.06; } 62% { opacity:.3; } 86% { opacity:.12; } 100% { opacity:.06; } }
            @keyframes mtGlow { 0%,100% { opacity:.25; } 50% { opacity:1; } }
            @keyframes mtTP { 0%,100% { opacity:.5; } 50% { opacity:1; } }
            @keyframes mtBreathe { 0%,100% { transform:scaleX(1); } 50% { transform:scaleX(1.018); } }
            /* ── Hero journey (14s): the gold field line's full life story.
               Nose glow (0-16%) -> unlock spark (8-16%) -> peel over the
               poles into the tail, drawing itself on (12-46%) -> joins the
               stretched stack (44-62%) -> gold pinch + mini snap (58-68%)
               -> recoil + gentle aurora pulse (66-90%) -> reset */
            @keyframes mtHeroNose { 0% { opacity:0; } 6% { opacity:.95; } 16% { opacity:.95; } 22% { opacity:0; } 100% { opacity:0; } }
            @keyframes mtHeroSpark { 0%,8% { opacity:0; transform:scale(.6); } 12% { opacity:1; transform:scale(1.1); } 18% { opacity:0; transform:scale(1.5); } 100% { opacity:0; } }
            @keyframes mtHeroPeel { 0%,12% { stroke-dashoffset:100; opacity:0; } 15% { opacity:.9; } 44% { stroke-dashoffset:0; opacity:.9; } 52% { stroke-dashoffset:0; opacity:0; } 100% { stroke-dashoffset:0; opacity:0; } }
            @keyframes mtHeroTail { 0%,44% { opacity:0; transform:translateY(0); } 50% { opacity:.9; } 58% { opacity:.95; transform:translateY(0); } 62% { transform:translateY(4px); opacity:.95; } 65% { opacity:0; } 100% { opacity:0; } }
            @keyframes mtHeroTailB { 0%,44% { opacity:0; transform:translateY(0); } 50% { opacity:.9; } 58% { opacity:.95; transform:translateY(0); } 62% { transform:translateY(-4px); opacity:.95; } 65% { opacity:0; } 100% { opacity:0; } }
            @keyframes mtHeroX { 0%,58% { opacity:0; transform:scale(.6); } 63% { opacity:1; transform:scale(1.1); } 70% { opacity:0; transform:scale(1.6); } 100% { opacity:0; } }
            @keyframes mtHeroRecoil { 0%,62% { opacity:0; transform:scaleX(1); } 66% { opacity:.95; transform:scaleX(1); } 80% { transform:scaleX(.48); opacity:.85; } 90% { transform:scaleX(.44); opacity:0; } 100% { opacity:0; } }
            @keyframes mtHeroAurora { 0%,72% { opacity:0; } 80% { opacity:.85; } 92%,100% { opacity:0; } }
            @keyframes mtDeflect { to { stroke-dashoffset: -140; } }
            @keyframes mtNeedleDemo { 0% { transform:rotate(0deg); } 35% { transform:rotate(0deg); } 65% { transform:rotate(172deg); } 100% { transform:rotate(172deg); } }
            .mt-flow{animation:mtFlow 6s linear infinite}
            .mt-pinch-t{animation:mtPinchT 3.6s ease-in infinite}
            .mt-pinch-b{animation:mtPinchB 3.6s ease-in infinite}
            .mt-snap{animation:mtSnap 3.6s ease-out infinite;transform-box:fill-box;transform-origin:center}
            .mt-recoil{animation:mtRecoil 3.6s cubic-bezier(.2,.9,.3,1) infinite}
            .mt-eject{animation:mtEject 3.6s cubic-bezier(.5,0,.8,.6) infinite;transform-box:view-box;transform-origin:0 0}
            .mt-precip{animation:mtPrecip 3.6s ease-in-out infinite}
            .mt-aurora{animation:mtAurora 3.6s ease-in-out infinite}
            .mt-atmo{animation:mtAtmo 3.6s ease-in-out infinite}
            .mt-glow{animation:mtGlow 3s ease-in-out infinite}
            .mt-tp{animation:mtTP 2s ease-in-out infinite}
            .mt-breathe{animation:mtBreathe 4.5s ease-in-out infinite}
            .mt-hero-nose{animation:mtHeroNose 14s ease-in-out infinite}
            .mt-hero-spark{animation:mtHeroSpark 14s ease-out infinite;transform-box:fill-box;transform-origin:center}
            .mt-hero-peel{stroke-dasharray:100;animation:mtHeroPeel 14s ease-in-out infinite}
            .mt-hero-tail{animation:mtHeroTail 14s ease-in infinite}
            .mt-hero-tail-b{animation:mtHeroTailB 14s ease-in infinite}
            .mt-hero-x{animation:mtHeroX 14s ease-out infinite;transform-box:fill-box;transform-origin:center}
            .mt-hero-recoil{animation:mtHeroRecoil 14s cubic-bezier(.2,.9,.3,1) infinite}
            .mt-hero-aurora{animation:mtHeroAurora 14s ease-in-out infinite}
            .mt-deflect{animation:mtDeflect 5s linear infinite}
            .mt-needle-demo{animation:mtNeedleDemo 4s ease-in-out infinite}
            .mt-dim{transition:opacity .45s ease}
            .mt-h{pointer-events:all;cursor:help}
            @media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important}}
          `}</style>
          <defs>
            <radialGradient id="mt-sG" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#f0bd6a"/><stop offset="60%" stopColor="#e0973a"/><stop offset="100%" stopColor="#c2701f"/></radialGradient>
            <radialGradient id="mt-sF" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(240,189,106,0.25)"/><stop offset="100%" stopColor="rgba(240,189,106,0)"/></radialGradient>
            <radialGradient id="mt-aG" cx="50%" cy="50%" r="50%"><stop offset="68%" stopColor="rgba(56,189,248,0)"/><stop offset="86%" stopColor="rgba(56,189,248,0.09)"/><stop offset="100%" stopColor="rgba(56,189,248,0.02)"/></radialGradient>
            <filter id="mt-gl"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
            <clipPath id="mt-ec"><circle cx={CX} cy={CY} r={R}/></clipPath>
          </defs>

          {/* Stars */}
          {useMemo(() => { const s: React.ReactNode[] = []; for (let i=0;i<40;i++) s.push(<circle key={i} cx={Math.random()*VB_W} cy={Math.random()*VB_H} r={0.4+Math.random()*0.7} fill="#fff" opacity={0.1+Math.random()*0.25}/>); return <g>{s}</g>; }, [])}

          {/* ── Sun + wind ── */}
          <g className="mt-dim" style={{ opacity: dim('sun') }}>
            <g className="mt-h" onClick={e => showTip(e, 'The Sun. It constantly blows a wind of charged particles at Earth - around a million tonnes every second.')} onMouseMove={e => showTip(e, 'The Sun. It constantly blows a wind of charged particles at Earth - around a million tonnes every second.')} onMouseLeave={hideTip}>
              <circle cx={SUN_X} cy={CY} r={SUN_R*2.5} fill="url(#mt-sF)"/>
              <circle cx={SUN_X} cy={CY} r={SUN_R} fill="url(#mt-sG)"/>
            </g>
            <g opacity="0.28">
              {[CY-44,CY-22,CY,CY+22,CY+44].map((y,i)=>(
                <line key={i} x1={SUN_X+SUN_R+10} y1={y} x2={CX-R*(1.5*comp+0.5)} y2={CY+(y-CY)*0.4} stroke="#e0973a" strokeWidth="0.8" strokeDasharray="3 7" className="mt-flow" opacity={0.5-Math.abs(y-CY)/240}/>
              ))}
            </g>
          </g>

          {/* ── IMF clock: which way is the wind's field pointing? ── */}
          <g className="mt-dim mt-h" style={{ opacity: dim('clock') }}
            onClick={e => showTip(e, `The wind's magnetic field direction. When the needle points into the green southern zone, it unlocks Earth's field and energy starts flowing in. Right now: ${DOOR_TEXT[doorState]} (Bz ${bz.toFixed(1)} nT).`)}
            onMouseMove={e => showTip(e, `The wind's magnetic field direction. When the needle points into the green southern zone, it unlocks Earth's field and energy starts flowing in. Right now: ${DOOR_TEXT[doorState]} (Bz ${bz.toFixed(1)} nT).`)}
            onMouseLeave={hideTip}>
            {/* Unlock zone: the southern sector */}
            <path d={`M ${CLK_X} ${CLK_Y} L ${CLK_X + CLK_R * Math.sin(140 * Math.PI/180)} ${CLK_Y - CLK_R * Math.cos(140 * Math.PI/180)} A ${CLK_R} ${CLK_R} 0 0 1 ${CLK_X + CLK_R * Math.sin(220 * Math.PI/180)} ${CLK_Y - CLK_R * Math.cos(220 * Math.PI/180)} Z`}
              fill="#34d399" opacity="0.13"/>
            <circle cx={CLK_X} cy={CLK_Y} r={CLK_R} fill="none" stroke="#3f4652" strokeWidth="1"/>
            {/* N / S markers */}
            <text x={CLK_X} y={CLK_Y - CLK_R - 4} textAnchor="middle" fill="#71717a" fontSize="6.5" fontWeight="600" style={{fontFamily:'system-ui,sans-serif'}}>N</text>
            <text x={CLK_X} y={CLK_Y + CLK_R + 10} textAnchor="middle" fill="#34d399" fontSize="6.5" fontWeight="600" style={{fontFamily:'system-ui,sans-serif'}}>S · unlock</text>
            {/* Needle: rotates to the live clock angle (0 = N, 180 = S) */}
            <g style={story === 2 ? { transformOrigin: `${CLK_X}px ${CLK_Y}px` } : { transform: `rotate(${clockDeg}deg)`, transformOrigin: `${CLK_X}px ${CLK_Y}px`, transition: 'transform 1.2s ease' }}
              className={story === 2 ? 'mt-needle-demo' : undefined}>
              <line x1={CLK_X} y1={CLK_Y + 5} x2={CLK_X} y2={CLK_Y - CLK_R + 5} stroke={DOOR_COLOURS[doorState]} strokeWidth="1.8" strokeLinecap="round"/>
              <circle cx={CLK_X} cy={CLK_Y} r="2.2" fill={DOOR_COLOURS[doorState]}/>
            </g>
            {/* Plain-language label */}
            <text x={CLK_X} y={CLK_Y + CLK_R + 20} textAnchor="middle" fill={DOOR_COLOURS[doorState]} fontSize="7.5" fontWeight="600" letterSpacing="0.04em" style={{fontFamily:'system-ui,sans-serif'}}>
              {DOOR_TEXT[doorState].toUpperCase()}
            </text>
            <text x={CLK_X} y={CLK_Y - CLK_R - 14} textAnchor="middle" fill="#9aa2b1" fontSize="7" fontWeight="500" letterSpacing="0.08em" style={{textTransform:'uppercase' as const,fontFamily:'system-ui,sans-serif'}}>Wind field</text>
          </g>

          {/* ── The bubble: magnetopause + day-side field + dipole ── */}
          <g className="mt-dim" style={{ opacity: dim('bubble') }}>
            <path d={mpause} fill="none" stroke="#aeb7c6" strokeWidth="0.7" opacity="0.14"
              className="mt-h" onClick={e => showTip(e, "Magnetopause: the edge of Earth's magnetic bubble. The solar wind piles up against it and, when the door is locked, slides harmlessly around.")} onMouseMove={e => showTip(e, "Magnetopause: the edge of Earth's magnetic bubble. The solar wind piles up against it and, when the door is locked, slides harmlessly around.")} onMouseLeave={hideTip}/>
            <rect x={CX+R*0.3} y={CY-R*1.3} width={Math.max(0,tailEndX-CX)} height={R*1.1} fill="#fff" opacity="0.012" rx="3"/>
            <rect x={CX+R*0.3} y={CY+R*0.2} width={Math.max(0,tailEndX-CX)} height={R*1.1} fill="#fff" opacity="0.012" rx="3"/>
            <g className="mt-h" onClick={e => showTip(e, `Day-side field, ${pressure > 5 ? 'compressed by strong pressure' : 'quiet'}. Pressure: ${pressure.toFixed(1)} nPa`)} onMouseMove={e => showTip(e, `Day-side field, ${pressure > 5 ? 'compressed by strong pressure' : 'quiet'}. Pressure: ${pressure.toFixed(1)} nPa`)} onMouseLeave={hideTip}>
              {dayLines.map((d,i)=><path key={i} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.2" opacity={0.65-i*0.12}/>)}
            </g>
            <path d={`M ${CX-R*0.34} ${CY-R*0.34} C ${CX-R*0.75} ${CY-R*0.14}, ${CX-R*0.75} ${CY+R*0.14}, ${CX-R*0.34} ${CY+R*0.34}`} fill="none" stroke="#aeb7c6" strokeWidth="1.1" opacity="0.5"/>
            <path d={`M ${CX+R*0.34} ${CY-R*0.34} C ${CX+R*0.75} ${CY-R*0.14}, ${CX+R*0.75} ${CY+R*0.14}, ${CX+R*0.34} ${CY+R*0.34}`} fill="none" stroke="#aeb7c6" strokeWidth="1.1" opacity="0.5"/>
          </g>

          {/* ── Tier markers ── */}
          <g className="mt-dim" style={{ opacity: dim('tiers') * (inStory ? 0.5 : 1) }}>
            {TIERS.map((tier,i) => {
              const isPast = i <= currentTierIdx;
              const isCurrent = i === currentTierIdx;
              const isNext = i === currentTierIdx + 1;
              return (
                <g key={tier.label} className="mt-h"
                  onClick={e => showTip(e, `${tier.label} (score ${tier.score}+): If the tail snaps here, expect ${tier.nzNote.toLowerCase()}.`)}
                  onMouseMove={e => showTip(e, `${tier.label} (score ${tier.score}+): If the tail snaps here, expect ${tier.nzNote.toLowerCase()}.`)}
                  onMouseLeave={hideTip}>
                  <line x1={tier.x} y1={CY-R*1.7} x2={tier.x} y2={CY+R*1.7}
                    stroke={tier.colour} strokeWidth={isCurrent?1.3:0.6}
                    strokeDasharray={isPast?'none':'3 5'}
                    opacity={isPast?0.45:isNext?0.3:0.13}
                    className={isCurrent?'mt-tp':''}/>
                  <text x={tier.x} y={CY-R*1.8} textAnchor="middle" fill={tier.colour}
                    fontSize="7.5" fontWeight={isCurrent?'600':'400'} letterSpacing="0.04em"
                    opacity={isPast?0.75:isNext?0.45:0.22}
                    style={{fontFamily:'system-ui,sans-serif',textTransform:'uppercase' as const}}>
                    {tier.label}
                  </text>
                  {isCurrent && (
                    <text x={tier.x} y={CY+R*2.0} textAnchor="middle" fill={tier.colour}
                      fontSize="6.5" opacity="0.55" style={{fontFamily:'system-ui,sans-serif'}}>
                      {tier.nzNote}
                    </text>
                  )}
                </g>
              );
            })}
          </g>

          {/* ── The tail: night-side field ── */}
          <g className="mt-dim" style={{ opacity: dim('tail') }}>
            <g className={`mt-h${magState === 'STRETCHED' && !isSnapping ? ' mt-breathe' : ''}`}
              style={magState === 'STRETCHED' && !isSnapping ? { transformOrigin: `${CX}px ${CY}px` } : undefined}
              onClick={e => showTip(e, isSnapping ? 'Reconnection in progress: the innermost stretched line pinches together, snaps, and the earthward half recoils toward Earth carrying particles with it.' : magState === 'STRETCHED' ? 'Tail highly stretched and thinning. The innermost lines are being squeezed toward the centre - a snap is imminent.' : magState === 'LOADING' ? `Bz ${bz.toFixed(1)} nT driving energy into the tail. Field lines are being dragged tailward and stretched.` : 'Tail relaxed, no loading.')}
              onMouseMove={e => showTip(e, isSnapping ? 'Reconnection in progress: the innermost stretched line pinches together, snaps, and the earthward half recoils toward Earth carrying particles with it.' : magState === 'STRETCHED' ? 'Tail highly stretched and thinning. The innermost lines are being squeezed toward the centre - a snap is imminent.' : magState === 'LOADING' ? `Bz ${bz.toFixed(1)} nT driving energy into the tail. Field lines are being dragged tailward and stretched.` : 'Tail relaxed, no loading.')}
              onMouseLeave={hideTip}>
              {nightTop.map((d,i)=> (isSnapping && i===0) ? null : <path key={`t${i}`} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.2" opacity={0.65-i*0.12}/>)}
              {nightBot.map((d,i)=> (isSnapping && i===0) ? null : <path key={`b${i}`} d={d} fill="none" stroke="#aeb7c6" strokeWidth="1.2" opacity={0.65-i*0.12}/>)}
              {isSnapping && (
                <g>
                  <path d={nightTop[0]} fill="none" stroke="#dbe2ee" strokeWidth="1.35" className="mt-pinch-t"/>
                  <path d={nightBot[0]} fill="none" stroke="#dbe2ee" strokeWidth="1.35" className="mt-pinch-b"/>
                </g>
              )}
            </g>
            <line x1={CX+R*0.5} y1={CY} x2={tailEndX+8} y2={CY} stroke="#aeb7c6" strokeWidth="0.5" strokeDasharray="2 4" opacity="0.18"/>

            {/* Reconnection X */}
            {isSnapping && (()=>{ const xx=tailEndX-16; return (
              <g className="mt-snap mt-h" style={{transformOrigin:`${xx}px ${CY}px`}}
                onClick={e => showTip(e, 'The X-point: oppositely directed field lines touch here and reconnect, releasing the stored magnetic energy in an instant.')}
                onMouseMove={e => showTip(e, 'The X-point: oppositely directed field lines touch here and reconnect, releasing the stored magnetic energy in an instant.')}
                onMouseLeave={hideTip}>
                <line x1={xx-8} y1={CY-8} x2={xx+8} y2={CY+8} stroke="#d2664a" strokeWidth="2.2" strokeLinecap="round"/>
                <line x1={xx+8} y1={CY-8} x2={xx-8} y2={CY+8} stroke="#d2664a" strokeWidth="2.2" strokeLinecap="round"/>
              </g>); })()}

            {/* Recoiling earthward loop */}
            {isSnapping && (()=>{ const xLoop = tailEndX - 22; return (
              <path
                d={`M ${CX+2} ${CY-R*0.42} C ${CX+R*0.9} ${CY-R*0.52}, ${xLoop-14} ${CY-R*0.34}, ${xLoop} ${CY} C ${xLoop-14} ${CY+R*0.34}, ${CX+R*0.9} ${CY+R*0.52}, ${CX+2} ${CY+R*0.42}`}
                fill="none" stroke="#dbe2ee" strokeWidth="1.5" filter="url(#mt-gl)"
                className="mt-recoil" style={{transformOrigin:`${CX}px ${CY}px`}}/>
            ); })()}

            {/* Plasmoid */}
            {isSnapping && <ellipse cx={tailEndX+8} cy={CY} rx={10} ry={15} fill="none" stroke="#aeb7c6" strokeWidth="1.2" className="mt-eject mt-h"
              onClick={e => showTip(e, 'Plasmoid: the tailward half of the snapped field line, pinched into a closed bubble and ejected away from Earth.')}
              onMouseMove={e => showTip(e, 'Plasmoid: the tailward half of the snapped field line, pinched into a closed bubble and ejected away from Earth.')}
              onMouseLeave={hideTip}/>}

            {/* Pre-snap foreshadow chevrons */}
            {magState === 'STRETCHED' && !isSnapping && (()=>{ const xx=tailEndX-16; return (
              <g className="mt-tp" opacity="0.7">
                <path d={`M ${xx-6} ${CY-12} L ${xx} ${CY-5} L ${xx+6} ${CY-12}`} fill="none" stroke="#fb923c" strokeWidth="1.3" strokeLinecap="round"/>
                <path d={`M ${xx-6} ${CY+12} L ${xx} ${CY+5} L ${xx+6} ${CY+12}`} fill="none" stroke="#fb923c" strokeWidth="1.3" strokeLinecap="round"/>
              </g>); })()}

            {/* Precipitation */}
            {isSnapping && (
              <g className="mt-precip mt-h" filter="url(#mt-gl)"
                onClick={e => showTip(e, 'Accelerated particles streaming along the recoiling field line, down into the polar atmosphere.')}
                onMouseMove={e => showTip(e, 'Accelerated particles streaming along the recoiling field line, down into the polar atmosphere.')}
                onMouseLeave={hideTip}>
                <path d={`M ${tailEndX-35} ${CY-6} C ${CX+R*0.8} ${CY-R*0.55}, ${CX+R*0.35} ${CY-R*0.85}, ${CX+2} ${CY-R*0.82}`} fill="none" stroke="#5fb47a" strokeWidth="1.2" strokeDasharray="2 4"/>
                <path d={`M ${tailEndX-35} ${CY+6} C ${CX+R*0.8} ${CY+R*0.55}, ${CX+R*0.35} ${CY+R*0.85}, ${CX+2} ${CY+R*0.82}`} fill="none" stroke="#5fb47a" strokeWidth="1.2" strokeDasharray="2 4"/>
              </g>
            )}
          </g>

          {/* ── Day-side X (door open) ── */}
          <g className="mt-dim mt-h" style={{ opacity: dim('daysideX') }}
            onClick={e => showTip(e, "The front door. When the wind's field points south it cancels Earth's field here, and the two connect - this is where the peeling begins.")}
            onMouseMove={e => showTip(e, "The front door. When the wind's field points south it cancels Earth's field here, and the two connect - this is where the peeling begins.")}
            onMouseLeave={hideTip}>
            {(bz < -3 || story === 2) && (
              <g opacity={story === 2 ? 0.9 : Math.min(1, Math.abs(bz)/10)*0.7}>
                <line x1={CX-R-10} y1={CY-7} x2={CX-R+3} y2={CY+7} stroke="#d2664a" strokeWidth="1.6" strokeLinecap="round"/>
                <line x1={CX-R+3} y1={CY-7} x2={CX-R-10} y2={CY+7} stroke="#d2664a" strokeWidth="1.6" strokeLinecap="round"/>
                {story === 2 && <circle cx={CX-R-3.5} cy={CY} r={13} fill="none" stroke="#d2664a" strokeWidth="0.8" className="mt-tp" opacity="0.7"/>}
              </g>
            )}
          </g>

          {/* ── HERO field line: the gold journey (or deflection) ── */}
          <g className="mt-dim" style={{ opacity: dim('hero') }}>
            {heroMode === 'journey' && (
              <g className="mt-h"
                onClick={e => showTip(e, "Follow the gold line: it connects to the wind at the front, gets peeled over the poles, stacked into the tail, then snaps back - delivering its particles to the sky. This loop is the aurora engine.")}
                onMouseMove={e => showTip(e, "Follow the gold line: it connects to the wind at the front, gets peeled over the poles, stacked into the tail, then snaps back - delivering its particles to the sky. This loop is the aurora engine.")}
                onMouseLeave={hideTip}>
                {/* 1. Nose line brightens */}
                <path d={dayFieldLine(R * 0.5, 2.2, comp)} fill="none" stroke="#f2c96a" strokeWidth="1.6" filter="url(#mt-gl)" className="mt-hero-nose"/>
                {/* 2. Unlock spark at the front door */}
                <g className="mt-hero-spark" style={{transformOrigin:`${CX-R-3}px ${CY}px`}}>
                  <line x1={CX-R-9} y1={CY-6} x2={CX-R+3} y2={CY+6} stroke="#f2c96a" strokeWidth="1.8" strokeLinecap="round"/>
                  <line x1={CX-R+3} y1={CY-6} x2={CX-R-9} y2={CY+6} stroke="#f2c96a" strokeWidth="1.8" strokeLinecap="round"/>
                </g>
                {/* 3. Peel over both poles into the tail (draw-on) */}
                <path d={heroPeelTop} pathLength={100} fill="none" stroke="#f2c96a" strokeWidth="1.5" filter="url(#mt-gl)" className="mt-hero-peel"/>
                <path d={heroPeelBot} pathLength={100} fill="none" stroke="#f2c96a" strokeWidth="1.2" opacity="0.7" className="mt-hero-peel"/>
                {/* 4. Joins the stretched stack */}
                <path d={nightTop[0]} fill="none" stroke="#f2c96a" strokeWidth="1.5" filter="url(#mt-gl)" className="mt-hero-tail"/>
                <path d={nightBot[0]} fill="none" stroke="#f2c96a" strokeWidth="1.5" filter="url(#mt-gl)" className="mt-hero-tail-b"/>
                {/* 5. Gold pinch flash */}
                {(()=>{ const xx=tailEndX-16; return (
                  <g className="mt-hero-x" style={{transformOrigin:`${xx}px ${CY}px`}}>
                    <line x1={xx-7} y1={CY-7} x2={xx+7} y2={CY+7} stroke="#f2c96a" strokeWidth="2" strokeLinecap="round"/>
                    <line x1={xx+7} y1={CY-7} x2={xx-7} y2={CY+7} stroke="#f2c96a" strokeWidth="2" strokeLinecap="round"/>
                  </g>); })()}
                {/* 6. Recoil home */}
                <path d={heroLoop} fill="none" stroke="#f2c96a" strokeWidth="1.4" filter="url(#mt-gl)" className="mt-hero-recoil" style={{transformOrigin:`${CX}px ${CY}px`}}/>
                {/* 7. Gentle aurora pulse at the poles */}
                <g className="mt-hero-aurora" filter="url(#mt-gl)">
                  <path d={`M ${CX-R*0.4} ${CY-R*0.82} Q ${CX} ${CY-R*0.98} ${CX+R*0.4} ${CY-R*0.82}`} fill="none" stroke="#8fe0a8" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d={`M ${CX-R*0.4} ${CY+R*0.82} Q ${CX} ${CY+R*0.98} ${CX+R*0.4} ${CY+R*0.82}`} fill="none" stroke="#8fe0a8" strokeWidth="1.8" strokeLinecap="round"/>
                </g>
              </g>
            )}
            {heroMode === 'deflect' && (
              <g className="mt-h"
                onClick={e => showTip(e, "Door locked: the wind's field points north, so it can't connect to Earth's. The gold streamline just slides around the bubble - a quiet sky.")}
                onMouseMove={e => showTip(e, "Door locked: the wind's field points north, so it can't connect to Earth's. The gold streamline just slides around the bubble - a quiet sky.")}
                onMouseLeave={hideTip}>
                <path d={heroDeflect} fill="none" stroke="#f2c96a" strokeWidth="1.1" strokeDasharray="5 6" opacity="0.55" className="mt-deflect"/>
                <path d={heroDeflect} transform={`translate(0 ${2*CY}) scale(1 -1)`} fill="none" stroke="#f2c96a" strokeWidth="0.9" strokeDasharray="5 6" opacity="0.3" className="mt-deflect"/>
              </g>
            )}
          </g>

          {/* ── Earth + aurora ── */}
          <g className="mt-dim" style={{ opacity: dim('earth') }}>
            <g className="mt-h"
              onClick={e => showTip(e, 'Earth, rotated to show NZ. The glowing band is the live aurora oval, curved by the IGRF-13 dipole just like the sightings map.')}
              onMouseMove={e => showTip(e, 'Earth, rotated to show NZ. The glowing band is the live aurora oval, curved by the IGRF-13 dipole just like the sightings map.')}
              onMouseLeave={hideTip}>
              <circle cx={CX} cy={CY} r={R+8} fill="url(#mt-aG)" className={isSnapping?'mt-atmo':''} style={isSnapping?undefined:{opacity:0.06}}/>
              {earthUrl ? <image href={earthUrl} x={CX-R} y={CY-R} width={R*2} height={R*2} clipPath="url(#mt-ec)" style={{imageRendering:'auto'}}/> : <circle cx={CX} cy={CY} r={R} fill="#1a3a5c"/>}
            </g>

            {/* Aurora ignition on snap */}
            {isSnapping && (
              <g className="mt-aurora mt-h" filter="url(#mt-gl)"
                onClick={e => showTip(e, 'Aurora! The particles flung down by the recoiling field line crash into the upper atmosphere at both poles, making it glow.')}
                onMouseMove={e => showTip(e, 'Aurora! The particles flung down by the recoiling field line crash into the upper atmosphere at both poles, making it glow.')}
                onMouseLeave={hideTip}>
                <circle cx={CX} cy={CY-R*0.86} r={R*0.34} fill="#5fb47a" opacity="0.14"/>
                <circle cx={CX} cy={CY+R*0.86} r={R*0.34} fill="#5fb47a" opacity="0.14"/>
                <path d={`M ${CX-R*0.46} ${CY-R*0.8} Q ${CX} ${CY-R*1.0} ${CX+R*0.46} ${CY-R*0.8}`} fill="none" stroke="#5fb47a" strokeWidth="2.4" strokeLinecap="round"/>
                <path d={`M ${CX-R*0.34} ${CY-R*0.9} Q ${CX} ${CY-R*1.06} ${CX+R*0.34} ${CY-R*0.9}`} fill="none" stroke="#8fe0a8" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
                <path d={`M ${CX-R*0.46} ${CY+R*0.8} Q ${CX} ${CY+R*1.0} ${CX+R*0.46} ${CY+R*0.8}`} fill="none" stroke="#5fb47a" strokeWidth="2.4" strokeLinecap="round"/>
                <path d={`M ${CX-R*0.34} ${CY+R*0.9} Q ${CX} ${CY+R*1.06} ${CX+R*0.34} ${CY+R*0.9}`} fill="none" stroke="#8fe0a8" strokeWidth="1.2" strokeLinecap="round" opacity="0.7"/>
              </g>
            )}
          </g>

          {/* Labels */}
          <g className="mt-dim" style={{ opacity: inStory ? 0.35 : 1 }}>
            <text x={SUN_X} y={CY-SUN_R-8} textAnchor="middle" fill="#9aa2b1" fontSize="8" fontWeight="500" letterSpacing="0.1em" style={{textTransform:'uppercase' as const,fontFamily:'system-ui,sans-serif'}}>Sun</text>
            <text x={CX} y={CY+R+18} textAnchor="middle" fill="#9aa2b1" fontSize="8" fontWeight="500" letterSpacing="0.1em" style={{textTransform:'uppercase' as const,fontFamily:'system-ui,sans-serif'}}>Earth</text>
            <text x={SUN_X} y={VB_H-8} textAnchor="middle" fill="#52525b" fontSize="7" fontWeight="500" style={{fontFamily:'system-ui,sans-serif'}}>Sunward ←</text>
            <text x={VB_W-8} y={CY+4} textAnchor="end" fill="#52525b" fontSize="7" fontWeight="500" style={{fontFamily:'system-ui,sans-serif'}}>→ Tailward</text>
          </g>
          {isSnapping && <text x={tailEndX-16} y={CY-20} textAnchor="middle" fill="#d2664a" fontSize="8" fontWeight="600" className="mt-snap" style={{fontFamily:'system-ui,sans-serif'}}>SNAP</text>}

          {/* Tooltip */}
          {tip && (
            <foreignObject x={Math.max(4, Math.min(tip.x - 60, VB_W - 230))} y={Math.min(Math.max(4, tip.y - 52), VB_H - 84)} width="220" height="80" style={{pointerEvents:'none'}}>
              <div style={{
                background:'rgba(10,14,22,0.95)',border:'1px solid rgba(255,255,255,0.12)',
                borderRadius:7,padding:'6px 8px',fontSize:10.5,lineHeight:1.4,color:'#d4d8e0',
                fontFamily:'system-ui,sans-serif',backdropFilter:'blur(8px)',maxWidth:210,
                boxShadow:'0 4px 16px rgba(0,0,0,0.5)',
              }}>{tip.text}</div>
            </foreignObject>
          )}
        </svg>

        {/* ── Story caption card ── */}
        {story != null && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-2 w-[92%] max-w-md rounded-xl border border-neutral-700 bg-neutral-950/92 backdrop-blur px-4 py-3 shadow-2xl">
            <div className="text-[10px] font-semibold tracking-wide uppercase text-emerald-400 mb-0.5">{STORY[story].title}</div>
            <p className="text-[12.5px] sm:text-sm text-neutral-100 leading-snug">{STORY[story].text}</p>
            <div className="flex items-center justify-between mt-2.5">
              <div className="flex items-center gap-1.5">
                {STORY.map((_, i) => (
                  <button key={i} onClick={() => setStory(i)} aria-label={`Step ${i + 1}`}
                    className="w-2 h-2 rounded-full transition-colors"
                    style={{ background: i === story ? '#34d399' : '#3f3f46' }}/>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={closeStory} className="text-[11px] text-neutral-500 hover:text-neutral-300 px-1.5 py-1">Skip</button>
                {story > 0 && (
                  <button onClick={() => setStory(story - 1)}
                    className="text-[11px] font-semibold text-neutral-300 border border-neutral-700 rounded-lg px-2.5 py-1 hover:border-neutral-500">Back</button>
                )}
                {story < STORY.length - 1 ? (
                  <button onClick={() => setStory(story + 1)}
                    className="text-[11px] font-semibold text-emerald-300 border border-emerald-500/50 bg-emerald-500/10 rounded-lg px-3 py-1 hover:bg-emerald-500/20">Next</button>
                ) : (
                  <button onClick={closeStory}
                    className="text-[11px] font-semibold text-emerald-300 border border-emerald-500/50 bg-emerald-500/10 rounded-lg px-3 py-1 hover:bg-emerald-500/20">Watch it live</button>
                )}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Mobile swipe hint */}
      <div className="sm:hidden text-center text-[10px] text-neutral-600 mt-1.5 mt-hint">
        Swipe across to follow the tail and snap tiers
      </div>

      {/* Status row */}
      <div className="mt-2 flex items-center gap-2 px-0.5">
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border shrink-0"
          style={{borderColor:COLOURS[magState]+'40',background:COLOURS[magState]+'10'}}>
          <div className="w-2 h-2 rounded-full" style={{background:COLOURS[magState],boxShadow:`0 0 5px ${COLOURS[magState]}80`,animation:magState==='SNAPPING'?'mtGlow 1.5s ease-in-out infinite':undefined}}/>
          <span className="text-xs font-semibold" style={{color:COLOURS[magState]}}>{LABELS[magState]}</span>
        </div>
        <p className="text-[11px] text-neutral-400 leading-snug">{stateDesc[magState]}</p>
      </div>

      {/* Legend */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-0.5 text-[9px] sm:text-[10px] text-neutral-500 border-t border-neutral-800 pt-2">
        <span className="flex items-center gap-1"><svg width="12" height="6"><line x1="0" y1="3" x2="12" y2="3" stroke="#aeb7c6" strokeWidth="1.2"/></svg>Field lines</span>
        <span className="flex items-center gap-1"><svg width="12" height="6"><line x1="0" y1="3" x2="12" y2="3" stroke="#f2c96a" strokeWidth="1.2"/></svg>One line's journey</span>
        <span className="flex items-center gap-1"><svg width="12" height="6"><line x1="0" y1="3" x2="12" y2="3" stroke="#aeb7c6" strokeWidth="0.7" strokeDasharray="2 3"/></svg>Magnetopause</span>
        <span className="flex items-center gap-1"><svg width="10" height="6"><line x1="1" y1="1" x2="9" y2="5" stroke="#d2664a" strokeWidth="1.3"/><line x1="9" y1="1" x2="1" y2="5" stroke="#d2664a" strokeWidth="1.3"/></svg>Reconnection</span>
        <span className="flex items-center gap-1"><svg width="14" height="8"><path d="M0 5 Q 7 1 14 5" fill="none" stroke="#46d782" strokeWidth="3" opacity="0.35"/><path d="M0 5 Q 7 1 14 5" fill="none" stroke="#a0ffc3" strokeWidth="1" opacity="0.9"/></svg>Aurora oval</span>
        <span className="flex items-center gap-1"><svg width="6" height="6"><circle cx="3" cy="3" r="2" fill="#5fb47a"/></svg>NZ</span>
        <span className="flex items-center gap-1"><svg width="10" height="6"><line x1="5" y1="0" x2="5" y2="6" stroke="#fbbf24" strokeWidth="0.7" strokeDasharray="1.5 2"/></svg>Snap tiers</span>
      </div>
    </div>
  );
};

export default MagnetotailStatus;
// --- END OF FILE src/components/MagnetotailStatus.tsx ---