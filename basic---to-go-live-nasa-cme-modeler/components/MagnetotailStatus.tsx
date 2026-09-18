// --- START OF FILE src/components/MagnetotailStatus.tsx ---
//
// Magnetotail: a cinematic, live-data-driven scene of how aurora is born.
//
// The data is performed, not displayed:
//   - Solar wind particles stream in at the REAL measured speed
//   - Their number tracks the REAL density
//   - Bz decides their fate: north and they visibly deflect around the
//     bubble; south and they slip in, spiral down the tail and accumulate
//     as a growing charge glow (the slingshot loading)
//   - A substorm is a directed EVENT, not a loop: stillness, flash at the
//     pinch, a river of particles pouring onto the pole, aurora curtains
//     blooming on the globe, an exposure kick, then afterglow
//
// A 5-step story tour ("How aurora forms") walks new users through the
// whole causal chain, forcing a demo snap on the final step.

import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import { computeOvalBoundary as computeOvalBoundaryPhysics, avgBy30m, loadingMinutesFromSeries } from '../utils/ovalPhysics';
import {
  EARTH_TEX, renderGlobe, drawParticle,
  loadMilkyWay, drawMilkyWay,
} from '../utils/spaceScene';


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

// ---- Oval boundary (shared physics - same as everywhere else in the app) ----
function computeOvalBoundary(
  risk: SubstormRiskDataLike | null | undefined,
  proxyNewellData?: { x: number; y: number }[],
  latestBy: number | null = null,
  pdynNPa: number | null = null,
): number {
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

// ---- IGRF-13 helpers (globe oval) ----

// ---- Verdict tiers (what a snap right now means for NZ) ----
interface Tier { label: string; score: number; colour: string; nzNote: string }
const TIERS: Tier[] = [
  { label: 'Minor',    score: 15, colour: '#38bdf8', nzNote: 'camera only, deep south' },
  { label: 'Moderate', score: 30, colour: '#34d399', nzNote: 'camera aurora, South Island' },
  { label: 'Active',   score: 45, colour: '#a3e635', nzNote: 'phone camera, South Island' },
  { label: 'Strong',   score: 60, colour: '#fbbf24', nzNote: 'naked eye, South Island' },
  { label: 'Major',    score: 75, colour: '#fb923c', nzNote: 'bright display, overhead SI' },
  { label: 'Extreme',  score: 90, colour: '#f87171', nzNote: 'vivid overhead, a lot of NZ' },
];

const LABELS: Record<MagState, string> = { QUIET: 'Quiet', LOADING: 'Loading', STRETCHED: 'Stretched', SNAPPING: 'Reconnecting' };
const COLOURS: Record<MagState, string> = { QUIET: '#38bdf8', LOADING: '#fbbf24', STRETCHED: '#fb923c', SNAPPING: '#f87171' };

// ---- Globe sprite renderer (orthographic, IGRF-curved live oval, NZ dot) ----

// ======================================================================
// Story tour
interface StoryStep { title: string; text: string }
const STORY: StoryStep[] = [
  { title: '1 · The wind',      text: 'The Sun constantly blasts Earth with a wind of charged particles - watch them streaming in from the left. Faster wind, faster particles. Denser wind, more of them.' },
  { title: '2 · The shield',    text: "Earth lives inside a magnetic bubble. When the wind's field points NORTH, the door is locked - every particle just slides around the bubble. Calm skies." },
  { title: '3 · The door',      text: "But when the wind's field swings SOUTH (the dial below), the door unlocks. Watch: particles start slipping in around the sides and get swept behind Earth." },
  { title: '4 · The slingshot', text: 'The captured particles pile up in a long tail behind Earth. The glow you see growing is real stored energy - a slingshot being stretched, minute by minute.' },
  { title: '5 · The snap',      text: 'When the tail over-stretches, it SNAPS. The energy fires particles down onto the poles, curtains of light bloom in the sky - and that is the aurora.' },
];

// ── Scene geometry (logical units; canvas scales to fit) ──
const W = 960, H = 420;
const EX = W * 0.36, EY = H * 0.5;   // Earth centre
const ER = 84;                        // Earth radius
const GLOBE_SPRITE = 240;             // sprite resolution

type PState = 'wind' | 'captured' | 'burstE' | 'burstT';
interface P { x: number; y: number; px: number; py: number; vx: number; vy: number; st: PState; roll: number; seed: number; lobe: number; age: number }

const MagnetotailStatus: React.FC<Props> = ({ substormRiskData, substormForecast, onOpenModal, proxyMagneticData, proxyPressureData, proxyNewellData }) => {
  const magState = deriveMagState(substormRiskData, substormForecast);
  const score = substormRiskData?.current?.score ?? 0;
  const bz = (proxyMagneticData && proxyMagneticData.length > 0 ? proxyMagneticData[proxyMagneticData.length - 1].bz : null) ?? substormRiskData?.metrics?.solar_wind?.bz ?? 0;
  const by = (proxyMagneticData && proxyMagneticData.length > 0 ? proxyMagneticData[proxyMagneticData.length - 1].by : null) ?? 0;
  const speed = substormRiskData?.metrics?.solar_wind?.speed ?? 400;
  const density = substormRiskData?.metrics?.solar_wind?.density ?? 4;
  const pressure = (proxyPressureData && proxyPressureData.length > 0 ? proxyPressureData[proxyPressureData.length - 1].y : null) ?? substormRiskData?.metrics?.solar_wind?.dynamic_pressure_nPa ?? 2;
  const latestByRM = useMemo(() => avgBy30m(proxyMagneticData), [proxyMagneticData]);
  const loadingMinutes = useMemo(() => loadingMinutesFromSeries(proxyNewellData), [proxyNewellData]);
  const ovalBound = computeOvalBoundary(substormRiskData, proxyNewellData, latestByRM, pressure);

  // ── Story state ──
  const [story, setStory] = useState<number | null>(null);
  const [storySeen, setStorySeen] = useState(true);
  useEffect(() => { try { setStorySeen(localStorage.getItem('mt-story-seen') === '1'); } catch { /* ignore */ } }, []);
  const openStory = useCallback(() => {
    setStory(0);
    try { localStorage.setItem('mt-story-seen', '1'); } catch { /* ignore */ }
    setStorySeen(true);
  }, []);
  const closeStory = useCallback(() => setStory(null), []);

  // ── Live scene parameters (refs so the rAF loop reads fresh values without restarting) ──
  const isSnappingLive = magState === 'SNAPPING';
  // Door openness 0..1 from Bz (south = open). Story steps override.
  const doorLive = Math.max(0, Math.min(1, (-bz + 1) / 8)); // bz -7 => ~1, bz +1 => 0
  const sceneRef = useRef({
    speed, density, door: doorLive, pressure, story: story as number | null,
    isSnapping: isSnappingLive, charge0: Math.min(1, loadingMinutes / 90), score,
  });
  sceneRef.current = {
    speed, density, pressure, score,
    door: story === 1 ? 0 : (story === 2 || story === 3 || story === 4) ? 0.85 : doorLive,
    story,
    isSnapping: isSnappingLive,
    charge0: story === 3 ? 0.8 : Math.min(1, loadingMinutes / 90),
  };

  // ── Globe sprite ──
  const globeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const texImgRef = useRef<HTMLImageElement | null>(null);
  const globeReadyRef = useRef(false);
  useEffect(() => {
    function paint() {
      if (!texImgRef.current) return;
      if (!globeCanvasRef.current) globeCanvasRef.current = document.createElement('canvas');
      renderGlobe(globeCanvasRef.current, texImgRef.current, 172, ovalBound, score, isSnappingLive, GLOBE_SPRITE);
      globeReadyRef.current = true;
    }
    if (texImgRef.current && texImgRef.current.complete && texImgRef.current.naturalWidth > 0) paint();
    else if (!texImgRef.current) {
      const img = new Image(); img.crossOrigin = 'anonymous'; img.src = EARTH_TEX;
      texImgRef.current = img; img.onload = paint;
    }
  }, [ovalBound, score, isSnappingLive]);

  // ── Canvas scene ──
  useEffect(() => { loadMilkyWay(); }, []);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const fn = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', fn);
    return () => mq.removeEventListener?.('change', fn);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Stars (three parallax layers)
    const stars = Array.from({ length: 90 }, (_, i) => ({
      x: Math.random() * W, y: Math.random() * H,
      r: 0.4 + Math.random() * 0.9, a: 0.08 + Math.random() * 0.3,
      layer: i % 3, tw: Math.random() * Math.PI * 2,
    }));

    // Particles
    const MAXP = 340;
    const parts: P[] = [];
    function spawn(p?: P): P {
      const np: P = p ?? ({} as P);
      np.x = -10 - Math.random() * 60;
      np.y = Math.random() * H;
      np.px = np.x; np.py = np.y;
      np.vx = 0; np.vy = 0;
      np.st = 'wind';
      np.roll = Math.random();
      np.seed = Math.random() * Math.PI * 2;
      np.lobe = Math.random() < 0.5 ? -1 : 1;
      np.age = 0;
      if (!p) parts.push(np);
      return np;
    }
    for (let i = 0; i < MAXP; i++) spawn();

    // Snap event machine
    let snapT = -1;           // seconds since snap trigger; -1 = idle
    let lastSnapEnd = 0;      // time of last snap completion
    let capturedGlow = 0;     // visual charge from captured particles
    let curtainE = 0;         // curtain energy delivered by burst particles
    let flashE = 0;           // exposure kick

    // Geometry helpers
    const tailPinchX = () => EX + ER * 1.1 + (W - EX - ER) * (0.28 + 0.34 * Math.min(1, sceneRef.current.score / 90));
    const noseX = () => EX - ER * (1.9 - Math.min(0.7, sceneRef.current.pressure / 14));
    // Magnetopause "radius" at a given x (bullet shape): big ellipse dayside, cone tailward
    function boundR(x: number): number {
      const nx = noseX();
      if (x < EX) {
        const t = (x - nx) / (EX - nx);
        if (t < 0) return 0;
        return ER * 2.1 * Math.sqrt(Math.max(0, t * (2 - t)));
      }
      const px = tailPinchX() + ER * 2.2;
      const t = Math.min(1, (x - EX) / (px - EX));
      return ER * 2.1 * (1 - t * 0.82);
    }

    let raf = 0;
    let running = true;
    let last = performance.now();
    let elapsed = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      const rect = wrap!.getBoundingClientRect();
      if (rect.width < 10) return;
      canvas!.width = Math.round(rect.width * dpr);
      canvas!.height = Math.round(rect.width * (H / W) * dpr);
      canvas!.style.height = `${rect.width * (H / W)}px`;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Pause off-screen (no-op in reduced motion: static frame stays)
    const io = new IntersectionObserver((entries) => {
      if (reducedMotion) return;
      const vis = entries[0]?.isIntersecting ?? true;
      if (vis && !running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
      else if (!vis) running = false;
    }, { threshold: 0.05 });
    io.observe(wrap);

    function frame(now: number) {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      const s = sceneRef.current;

      // ── Snap triggering ──
      const wantSnap = s.isSnapping || s.story === 4;
      if (wantSnap && snapT < 0 && (elapsed - lastSnapEnd) > (s.story === 4 ? 2.2 : 5.5)) snapT = 0;
      if (snapT >= 0) {
        snapT += dt;
        if (snapT > 4.6) { snapT = -1; lastSnapEnd = elapsed; capturedGlow *= 0.25; }
      }
      if (snapT >= 0.6 && snapT < 1.0) flashE = Math.max(flashE, 1);
      flashE = Math.max(0, flashE - dt * 1.4);
      curtainE = Math.max(0, curtainE - dt * 0.35);
      if (snapT >= 0.8 && snapT < 3.2) curtainE = Math.min(1, curtainE + dt * 0.9);

      // ── Physics ──
      const baseVx = 90 + (Math.max(250, Math.min(850, s.speed)) - 250) * 0.42; // px/s
      const targetN = Math.round(150 + Math.min(1, s.density / 18) * (MAXP - 150));
      const px0 = tailPinchX();
      const chargeTarget = Math.max(s.charge0, 0);

      let capturedCount = 0;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        p.px = p.x; p.py = p.y;

        if (p.st === 'wind') {
          if (i >= targetN) { // over density budget: recycle quietly
            p.x += baseVx * dt * 1.5;
            if (p.x > W + 20) spawn(p);
            continue;
          }
          p.vx = baseVx * (0.85 + 0.3 * Math.sin(p.seed));
          // Deflection around the bubble
          const dy = p.y - EY;
          const br = boundR(p.x + 14);
          if (br > 0 && Math.abs(dy) < br + 26) {
            const inside = br - Math.abs(dy);
            if (inside > -26) {
              // Capture roll: through the open door, along the flanks
              if (p.x > EX - ER * 0.4 && p.x < EX + ER * 2 && p.roll < s.door * 0.5 && Math.abs(dy) > ER * 0.7) {
                p.st = 'captured';
                p.age = 0;
                p.vx *= 0.35; p.vy *= 0.3;
                continue;
              }
              // Otherwise steer around
              const push = Math.max(0, (26 + inside) / 52);
              p.vy += Math.sign(dy || (Math.random() - 0.5)) * push * 340 * dt;
            }
          }
          p.vy *= 0.985;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.x > W + 20 || p.y < -30 || p.y > H + 30) spawn(p);

        } else if (p.st === 'captured') {
          capturedCount++;
          p.age += dt;
          if (p.age > 8 + (p.seed % 1) * 8) { spawn(p); continue; } // flux convects back
          // Drift tailward into the lobes, settle, wander
          const tx = EX + ER * 1.3 + (px0 - EX - ER * 1.3) * (0.25 + 0.6 * ((p.seed % 1)));
          const ty = EY + p.lobe * (ER * (0.35 + 0.5 * Math.abs(Math.sin(p.seed * 3))));
          p.vx += (tx - p.x) * 0.9 * dt;
          p.vy += (ty - p.y) * 1.1 * dt;
          p.vx *= 0.96; p.vy *= 0.96;
          p.x += p.vx * dt + Math.sin(elapsed * 2 + p.seed * 7) * 8 * dt;
          p.y += p.vy * dt + Math.cos(elapsed * 1.7 + p.seed * 5) * 8 * dt;
          // Snap: fling them
          if (snapT >= 0.6 && snapT < 0.75) {
            p.st = p.roll < 0.62 ? 'burstE' : 'burstT';
            p.vx = 0; p.vy = 0;
          }

        } else if (p.st === 'burstE') {
          // Race down to the pole (lower visible auroral region of the globe)
          const gx = EX - ER * 0.05 + (p.seed % 1) * ER * 0.5 - ER * 0.25;
          const gy = EY + ER * 0.72;
          p.vx += (gx - p.x) * 6 * dt;
          p.vy += (gy - p.y) * 6 * dt;
          p.vx *= 0.99; p.vy *= 0.99;
          p.x += p.vx * dt; p.y += p.vy * dt;
          const d2 = (p.x - gx) ** 2 + (p.y - gy) ** 2;
          if (d2 < ER * ER * 0.06) { curtainE = Math.min(1, curtainE + 0.012); spawn(p); }

        } else { // burstT: plasmoid, flung down the tail
          p.vx += 520 * dt;
          p.vy += (EY - p.y) * 1.5 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          if (p.x > W + 30) spawn(p);
        }
      }
      capturedGlow += ((Math.min(1, capturedCount / 70) * 0.6 + chargeTarget * 0.55) - capturedGlow) * dt * 0.8;
      capturedGlow = Math.min(1.15, capturedGlow);

      // ── Draw ──
      const cw = canvas!.width;
      const k = cw / W;
      ctx!.setTransform(k, 0, 0, k, 0, 0);
      // Space background
      const bg = ctx!.createLinearGradient(0, 0, W, 0);
      bg.addColorStop(0, '#0a0c14'); bg.addColorStop(0.5, '#05070e'); bg.addColorStop(1, '#03040a');
      ctx!.fillStyle = bg;
      ctx!.fillRect(0, 0, W, H);

      // Milky Way backdrop, under everything else.
      drawMilkyWay(ctx!, W, H, elapsed);

      // Stars (parallax drift + twinkle)
      for (const st of stars) {
        const drift = (st.layer + 1) * 1.6;
        const sx = ((st.x - elapsed * drift) % (W + 20) + W + 20) % (W + 20) - 10;
        const twk = 0.75 + 0.25 * Math.sin(elapsed * 1.3 + st.tw);
        ctx!.globalAlpha = st.a * twk;
        ctx!.fillStyle = '#dbe4ff';
        ctx!.beginPath(); ctx!.arc(sx, st.y, st.r, 0, Math.PI * 2); ctx!.fill();
      }
      ctx!.globalAlpha = 1;

      // Sun bloom off-frame left
      const sun = ctx!.createRadialGradient(-60, EY, 0, -60, EY, 340);
      sun.addColorStop(0, 'rgba(255,190,110,0.32)');
      sun.addColorStop(0.35, 'rgba(255,160,80,0.10)');
      sun.addColorStop(1, 'rgba(255,150,70,0)');
      ctx!.fillStyle = sun; ctx!.fillRect(0, 0, W * 0.5, H);

      // Bow-shock sheen at the nose (brighter with pressure)
      const nx = noseX();
      const sheenA = Math.min(0.35, 0.06 + s.pressure * 0.02);
      ctx!.strokeStyle = `rgba(120,180,255,${sheenA.toFixed(3)})`;
      ctx!.lineWidth = 10; ctx!.filter = 'blur(7px)';
      ctx!.beginPath();
      ctx!.ellipse(EX, EY, Math.max(10, EX - nx), ER * 2.1, 0, Math.PI * 0.62, Math.PI * 1.38);
      ctx!.stroke();
      ctx!.filter = 'none';

      // Tail charge glow (the slingshot storing energy) - two lobes
      const glowA = 0.05 + capturedGlow * 0.30 + (snapT >= 0 && snapT < 0.6 ? snapT * 0.25 : 0);
      const midX = (EX + ER + px0) / 2;
      ctx!.globalCompositeOperation = 'lighter';
      for (const lb of [-1, 1]) {
        const g = ctx!.createRadialGradient(midX, EY + lb * ER * 0.55, 8, midX, EY + lb * ER * 0.55, (px0 - EX) * 0.62);
        g.addColorStop(0, `rgba(242,201,106,${(glowA * 0.9).toFixed(3)})`);
        g.addColorStop(0.55, `rgba(210,140,80,${(glowA * 0.4).toFixed(3)})`);
        g.addColorStop(1, 'rgba(210,140,80,0)');
        ctx!.fillStyle = g;
        ctx!.beginPath();
        ctx!.ellipse(midX, EY + lb * ER * 0.55, (px0 - EX) * 0.62, ER * 0.85, 0, 0, Math.PI * 2);
        ctx!.fill();
      }
      ctx!.globalCompositeOperation = 'source-over';

      // Snap flash at the pinch point
      if (snapT >= 0.55 && snapT < 1.35) {
        const fr = Math.max(0, 1 - Math.abs((snapT - 0.75) / 0.6));
        const fg = ctx!.createRadialGradient(px0, EY, 0, px0, EY, 90 + fr * 60);
        fg.addColorStop(0, `rgba(255,240,210,${(fr * 0.9).toFixed(2)})`);
        fg.addColorStop(0.3, `rgba(255,180,120,${(fr * 0.45).toFixed(2)})`);
        fg.addColorStop(1, 'rgba(255,150,90,0)');
        ctx!.globalCompositeOperation = 'lighter';
        ctx!.fillStyle = fg;
        ctx!.beginPath(); ctx!.arc(px0, EY, 90 + fr * 60, 0, Math.PI * 2); ctx!.fill();
        ctx!.globalCompositeOperation = 'source-over';
        if (fr > 0.5) {
          ctx!.fillStyle = `rgba(255,220,190,${((fr - 0.5) * 1.6).toFixed(2)})`;
          ctx!.font = '600 11px system-ui, sans-serif';
          ctx!.textAlign = 'center';
          ctx!.fillText('RECONNECTION', px0, EY - 46);
        }
      }

      // Particles, drawn as CME-style additive sprites.
      // Each one is the head plus two fainter sprites stepped back along its
      // travel vector, which keeps the sense of speed the old trails gave while
      // using the softer look from the CME scene.
      ctx!.globalCompositeOperation = 'lighter';
      for (let i = 0; i < Math.min(parts.length, targetN + 40); i++) {
        const p = parts[i];
        let col: string, r: number, a: number;
        if (p.st === 'wind') { col = '255,205,140'; r = 3.1; a = 0.50; }
        else if (p.st === 'captured') { col = '242,201,106'; r = 4.2; a = 0.75; }
        else if (p.st === 'burstE') { col = '150,255,190'; r = 5.4; a = 0.95; }
        else { col = '255,190,150'; r = 4.6; a = 0.80; }
        drawParticle(ctx!, col, p.x, p.y, p.px, p.py, r, a);
      }
      ctx!.globalAlpha = 1;
      ctx!.globalCompositeOperation = 'source-over';

      // Earth: atmosphere rim + globe sprite
      const atm = ctx!.createRadialGradient(EX, EY, ER * 0.9, EX, EY, ER * 1.22);
      atm.addColorStop(0, 'rgba(80,150,255,0)');
      atm.addColorStop(0.75, `rgba(90,160,255,${(0.10 + curtainE * 0.06).toFixed(3)})`);
      atm.addColorStop(1, 'rgba(90,160,255,0)');
      ctx!.fillStyle = atm;
      ctx!.beginPath(); ctx!.arc(EX, EY, ER * 1.22, 0, Math.PI * 2); ctx!.fill();
      if (globeReadyRef.current && globeCanvasRef.current) {
        ctx!.drawImage(globeCanvasRef.current, EX - ER, EY - ER, ER * 2, ER * 2);
      } else {
        ctx!.fillStyle = '#14304f';
        ctx!.beginPath(); ctx!.arc(EX, EY, ER, 0, Math.PI * 2); ctx!.fill();
      }

      // Aurora curtains: vertical rays blooming off the southern region
      if (curtainE > 0.02) {
        ctx!.globalCompositeOperation = 'lighter';
        const NR = 26;
        for (let i = 0; i < NR; i++) {
          const th = Math.PI * (0.22 + 0.56 * (i / (NR - 1))) + Math.PI * 0.5; // lower arc
          const bx = EX + Math.cos(th) * ER * 0.86;
          const byy = EY + Math.sin(th) * ER * 0.86;
          const flick = 0.55 + 0.45 * Math.sin(elapsed * (2.2 + (i % 5) * 0.7) + i * 1.7);
          const len = (10 + 26 * flick) * curtainE;
          const ox = Math.cos(th), oy = Math.sin(th);
          const grad = ctx!.createLinearGradient(bx, byy, bx + ox * len, byy + oy * len);
          grad.addColorStop(0, `rgba(140,255,180,${(0.5 * curtainE * flick).toFixed(3)})`);
          grad.addColorStop(0.7, `rgba(90,230,150,${(0.18 * curtainE).toFixed(3)})`);
          grad.addColorStop(1, 'rgba(255,110,130,0)');
          ctx!.strokeStyle = grad;
          ctx!.lineWidth = 2.4;
          ctx!.beginPath();
          ctx!.moveTo(bx, byy);
          ctx!.lineTo(bx + ox * len, byy + oy * len);
          ctx!.stroke();
        }
        ctx!.globalCompositeOperation = 'source-over';
      }

      // Exposure kick on snap
      if (flashE > 0.01) {
        ctx!.fillStyle = `rgba(255,245,235,${(flashE * 0.08).toFixed(3)})`;
        ctx!.fillRect(0, 0, W, H);
      }

      // Letterbox vignette
      const vg = ctx!.createLinearGradient(0, 0, 0, H);
      vg.addColorStop(0, 'rgba(0,0,0,0.35)'); vg.addColorStop(0.12, 'rgba(0,0,0,0)');
      vg.addColorStop(0.88, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx!.fillStyle = vg; ctx!.fillRect(0, 0, W, H);

      raf = requestAnimationFrame(frame);
    }

    if (!reducedMotion) {
      raf = requestAnimationFrame(frame);
    } else {
      // Reduced motion: render one composed still frame, then stop.
      running = true;
      last = performance.now() - 16;
      frame(performance.now());
      running = false;
      cancelAnimationFrame(raf);
    }

    return () => { running = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); };
  }, [reducedMotion]);

  // ── Tap tooltips (hit regions over the canvas) ──
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const tipTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSceneTap = useCallback((e: React.MouseEvent) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;
    let text: string;
    const dEarth = Math.hypot(x - EX, y - EY);
    const pinch = EX + ER * 1.1 + (W - EX - ER) * (0.28 + 0.34 * Math.min(1, score / 90));
    if (dEarth < ER * 1.15) text = 'Earth, tilted to show NZ. The glowing band is the live aurora oval - the same physics as the sightings map.';
    else if (x > EX + ER && x < pinch + 60 && Math.abs(y - EY) < ER * 1.6) text = 'The magnetotail: captured wind particles pile up here. The brighter the glow, the more energy the slingshot is storing.';
    else if (x < EX - ER * 1.2) text = 'The solar wind arriving from the Sun. Particle speed tracks the real measured wind speed; their number tracks the real density. Whether they get in depends on the field direction dial below.';
    else text = "The edge of Earth's magnetic bubble. Locked field: particles slide around it. Unlocked: they slip in along the flanks and feed the tail.";
    setTip({ text, x: e.clientX - r.left, y: e.clientY - r.top });
    if (tipTimeout.current) clearTimeout(tipTimeout.current);
    tipTimeout.current = setTimeout(() => setTip(null), 4500);
  }, [score]);

  // ── HUD values ──
  const doorState: 'OPEN' | 'AJAR' | 'LOCKED' = (story === 2 || story === 3 || story === 4) ? 'OPEN' : bz <= -2 ? 'OPEN' : bz < 1 ? 'AJAR' : 'LOCKED';
  const DOOR_COLOURS = { OPEN: '#34d399', AJAR: '#fbbf24', LOCKED: '#38bdf8' } as const;
  const clockDeg = (story === 2 || story === 3 || story === 4) ? 170 : (Math.atan2(by, bz) * 180 / Math.PI + 360) % 360;
  const currentTierIdx = useMemo(() => { for (let i = TIERS.length - 1; i >= 0; i--) { if (score >= TIERS[i].score) return i; } return -1; }, [score]);
  const chargeText = loadingMinutes >= 180
    ? `${(loadingMinutes / 60).toFixed(loadingMinutes >= 600 ? 0 : 1)} h`
    : loadingMinutes >= 15 ? `${loadingMinutes} min` : '–';

  const verdict = (() => {
    if (magState === 'SNAPPING') return { text: `Aurora falling now - look south. Expect ${currentTierIdx >= 0 ? TIERS[currentTierIdx].nzNote : 'a faint camera glow'}.`, colour: '#f87171' };
    if (magState === 'STRETCHED') return { text: 'Tail fully charged - a snap could fire in the next 15-30 minutes.', colour: '#fb923c' };
    if (magState === 'LOADING') return { text: `Door open - energy pouring into the tail${loadingMinutes >= 15 ? ` (charging ${chargeText})` : ''}.`, colour: '#fbbf24' };
    if (doorState === 'LOCKED') return { text: 'Door locked - the wind is sliding past. Calm skies.', colour: '#38bdf8' };
    return { text: 'Door ajar - a trickle of energy, little to show yet.', colour: '#7dd3fc' };
  })();

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

  return (
    <div className="col-span-12 card bg-neutral-950/80 p-3 sm:p-4 flex flex-col overflow-hidden">
      <style>{`
        @keyframes mtHintPulse { 0%,100% { opacity: 0.4; } 50% { opacity: 0.85; } }
        .mt-hint { animation: mtHintPulse 2.5s ease-in-out infinite; }
        @keyframes mtDialPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); } 50% { box-shadow: 0 0 0 5px rgba(52,211,153,0.18); } }
        .mt-dial-pulse { animation: mtDialPulse 1.8s ease-in-out infinite; border-radius: 9999px; }
        @media (prefers-reduced-motion: reduce) { .mt-hint,.mt-dial-pulse { animation: none; } }
      `}</style>

      {/* Header */}
      <div className="flex flex-wrap justify-between items-start gap-1 mb-2">
        <div className="flex items-center gap-1.5">
          <h3 className="text-lg sm:text-xl font-semibold text-white">Magnetotail</h3>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide bg-amber-500/15 text-amber-400 border border-amber-500/30">
            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            BETA
          </span>
          <button onClick={onOpenModal}
            className="p-1 rounded-full text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
            title="About Magnetotail">?</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={openStory}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-colors ${storySeen ? 'text-neutral-400 border-neutral-700 hover:text-white hover:border-neutral-500' : 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10 mt-hint'}`}
            title="A 60-second guided tour of how aurora forms">
            ▶ How aurora forms
          </button>
          <span className="text-base sm:text-lg font-bold" style={{ color: COLOURS[magState] }}>{LABELS[magState]}</span>
        </div>
      </div>

      {/* ── The scene ── */}
      <div ref={wrapRef} className="relative w-full rounded-xl overflow-hidden bg-black cursor-pointer select-none" onClick={onSceneTap}>
        <canvas ref={canvasRef} className="block w-full" />

        {/* Tooltip */}
        {tip && (
          <div className="absolute z-20 pointer-events-none"
            style={{ left: Math.max(8, tip.x - 100), top: Math.max(8, tip.y - 76), maxWidth: 230 }}>
            <div className="bg-neutral-950/95 border border-white/10 rounded-lg px-2.5 py-2 text-[11px] leading-snug text-neutral-200 shadow-2xl backdrop-blur">
              {tip.text}
            </div>
          </div>
        )}

        {/* Story caption card */}
        {story != null && (
          <div className="absolute left-1/2 -translate-x-1/2 bottom-2 z-30 w-[94%] max-w-md rounded-xl border border-neutral-700 bg-neutral-950/92 backdrop-blur px-4 py-3 shadow-2xl"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}>
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

      {/* ── HUD strip: three live meters + the verdict ── */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 px-1">
        {/* Bz dial */}
        <div className={`flex items-center gap-2 ${story === 2 ? 'mt-dial-pulse' : ''}`}
          title="The wind's magnetic field direction. Needle in the green southern zone = the door is unlocked and energy can flow in.">
          <svg width="38" height="38" viewBox="0 0 38 38">
            <path d="M 19 19 L 8.4 30.2 A 15 15 0 0 0 29.6 30.2 Z" fill="#34d399" opacity="0.14"/>
            <circle cx="19" cy="19" r="15" fill="none" stroke="#3f4652" strokeWidth="1"/>
            <text x="19" y="7.5" textAnchor="middle" fill="#71717a" fontSize="6" fontWeight="600">N</text>
            <text x="19" y="35" textAnchor="middle" fill="#34d399" fontSize="6" fontWeight="600">S</text>
            <g style={{ transform: `rotate(${clockDeg}deg)`, transformOrigin: '19px 19px', transition: 'transform 1.2s ease' }}>
              <line x1="19" y1="22" x2="19" y2="7" stroke={DOOR_COLOURS[doorState]} strokeWidth="2" strokeLinecap="round"/>
              <circle cx="19" cy="19" r="2" fill={DOOR_COLOURS[doorState]}/>
            </g>
          </svg>
          <div className="leading-tight">
            <div className="text-[9px] uppercase tracking-wide text-neutral-500">Field door</div>
            <div className="text-[12px] font-bold" style={{ color: DOOR_COLOURS[doorState] }}>{doorState}</div>
            <div className="text-[9px] text-neutral-500">Bz {bz.toFixed(1)} nT</div>
          </div>
        </div>
        {/* Wind speed */}
        <div className="leading-tight" title="Live solar wind speed - the particles in the scene move at this speed, scaled.">
          <div className="text-[9px] uppercase tracking-wide text-neutral-500">Wind</div>
          <div className="text-[12px] font-bold text-neutral-100">{Math.round(speed)} <span className="text-[9px] font-normal text-neutral-400">km/s</span></div>
        </div>
        {/* Density */}
        <div className="leading-tight" title="Live particle density - the number of particles in the scene tracks this.">
          <div className="text-[9px] uppercase tracking-wide text-neutral-500">Density</div>
          <div className="text-[12px] font-bold text-neutral-100">{density.toFixed(1)} <span className="text-[9px] font-normal text-neutral-400">p/cm³</span></div>
        </div>
        {/* Charging */}
        <div className="leading-tight" title="How long the tail has been storing energy - the same number quoted in push notifications.">
          <div className="text-[9px] uppercase tracking-wide text-neutral-500">Charging</div>
          <div className="text-[12px] font-bold text-neutral-100">{chargeText}</div>
        </div>
        {/* Verdict */}
        <div className="flex-1 min-w-[180px] text-[11.5px] leading-snug font-medium" style={{ color: verdict.colour }}>
          {verdict.text}
        </div>
      </div>

      {/* Status detail line */}
      <div className="mt-2 flex items-start gap-2 px-1 border-t border-neutral-800 pt-2">
        <div className="w-2 h-2 mt-1 rounded-full shrink-0" style={{ background: COLOURS[magState], boxShadow: `0 0 5px ${COLOURS[magState]}80` }}/>
        <p className="text-[11px] text-neutral-400 leading-snug">{stateDesc[magState]}</p>
      </div>
      <div className="text-center text-[9.5px] text-neutral-600 mt-1.5">Tap anywhere in the scene to learn what you're looking at</div>
    </div>
  );
};

export default MagnetotailStatus;
// --- END OF FILE src/components/MagnetotailStatus.tsx ---