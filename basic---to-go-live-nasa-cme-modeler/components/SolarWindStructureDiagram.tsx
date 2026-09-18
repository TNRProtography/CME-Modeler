// --- START OF FILE src/components/SolarWindStructureDiagram.tsx ---
//
// Animated cross-section of the solar wind structure we are currently sitting in.
//
// WHY THIS EXISTS
// ---------------
// MagnetotailStatus already performs what happens AT Earth once the wind
// arrives. The structure card says what is PASSING us. Nothing showed the
// thing itself - the structure upstream that decides everything downstream -
// so "Heliospheric Current Sheet Crossing" stayed an abstract phrase.
//
// This is the missing half: a side-on slice of the wind flowing Sun (left) to
// Earth (right), with the structure's characteristic shape drawn in. The
// numbers are performed rather than printed - particles move at the measured
// speed, their count tracks the measured density, and the field colour and
// Earth coupling follow the measured Bz.
//
// HOW IT STAYS MAINTAINABLE
// -------------------------
// Twelve hand-drawn scenes would rot. Instead each structure maps to a small
// config of shared primitives - a field mode, a band overlay, an accent - so
// adding or retuning a structure is a data change, not new drawing code.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  drawParticle, loadMilkyWay, drawMilkyWay,
  loadEarthTexture, earthTexture, renderGlobe,
} from '../utils/spaceScene';
import type { SolarWindPhaseId, SolarWindPhaseResult } from '../utils/solarWindPhase';

const ASPECT = 3.1; // width : height

type FieldMode = 'spiral' | 'rope' | 'turbulent' | 'sheet' | 'uniform' | 'weak';
type BandMode = 'none' | 'compression' | 'front' | 'interface' | 'thinning';

interface SceneSpec {
  field: FieldMode;
  band: BandMode;
  accent: string;
  /** One line under the diagram saying what the viewer is looking at. */
  caption: string;
}

const SCENES: Record<SolarWindPhaseId, SceneSpec> = {
  'shock': {
    field: 'turbulent', band: 'front', accent: '#fb7185',
    caption: 'The bright front is the shock. Everything behind it is faster, denser and hotter than what was there before.',
  },
  'icme-sheath': {
    field: 'turbulent', band: 'compression', accent: '#fb923c',
    caption: 'Plasma piled up and tangled ahead of a CME. The field points every which way, which is why conditions swing so fast.',
  },
  'magnetic-cloud': {
    field: 'rope', band: 'none', accent: '#e879f9',
    caption: 'A cross-section through the magnetic core of a CME. The field turns smoothly as the rope passes over us.',
  },
  'icme-ejecta': {
    field: 'rope', band: 'none', accent: '#a78bfa',
    caption: 'CME material passing, but without the neat rotation of a textbook rope - the field wanders instead of turning steadily.',
  },
  'sir-compression': {
    field: 'spiral', band: 'compression', accent: '#fbbf24',
    caption: 'Fast wind catching up with slow wind ahead of it. The bright band is where it is piling up and squashing the field.',
  },
  'stream-interface': {
    field: 'spiral', band: 'interface', accent: '#2dd4bf',
    caption: 'The boundary itself. Slow crowded wind on one side, fast thin wind on the other, and we are sitting right on the join.',
  },
  'hss-plateau': {
    field: 'uniform', band: 'none', accent: '#38bdf8',
    caption: 'Fast, thin, evenly flowing wind pouring out of a coronal hole. Long streaks mean high speed, few of them means low density.',
  },
  'rarefaction': {
    field: 'weak', band: 'thinning', accent: '#818cf8',
    caption: 'The tail of a stream emptying out. Notice it thinning and slowing towards the right - that is the flow winding down.',
  },
  'hcs-crossing': {
    field: 'sheet', band: 'none', accent: '#a3e635',
    caption: 'The wavy surface is the current sheet, where the Sun’s magnetic field flips over. Look at the arrows - they point opposite ways either side of it.',
  },
  'plasma-sheet': {
    field: 'weak', band: 'compression', accent: '#34d399',
    caption: 'The dense, slow band of plasma that wraps around the current sheet. Crowded but sluggish, so not much gets through to us.',
  },
  'slow-ambient': {
    field: 'spiral', band: 'none', accent: '#34d399',
    caption: 'Ordinary background wind on the Parker spiral. Nothing unusual is passing us right now.',
  },
  'fast-ambient': {
    field: 'spiral', band: 'none', accent: '#38bdf8',
    caption: 'Background wind running faster than usual, but without the clear signature of a coronal hole stream.',
  },
  'unclassified': {
    field: 'weak', band: 'none', accent: '#a3a3a3',
    caption: 'The signatures are mixed, so this is drawn as plain flow rather than pretending to a shape we cannot confirm.',
  },
};

interface Particle { x: number; y: number; v: number; a: number }

interface Props {
  phase: SolarWindPhaseResult;
  className?: string;
}

const SolarWindStructureDiagram: React.FC<Props> = ({ phase, className }) => {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const globeRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { loadMilkyWay(); loadEarthTexture(); }, []);

  const scene = SCENES[phase.id] ?? SCENES.unclassified;

  // Live values drive the motion. Kept in a ref so the animation loop reads the
  // latest numbers without being torn down and restarted on every data poll -
  // restarting would visibly stutter the flow every 30 seconds.
  const live = useRef({ speed: 400, density: 5, bz: 0, bt: 5, field: scene.field, band: scene.band, accent: scene.accent });
  live.current = {
    speed: phase.derived.speed ?? 400,
    density: phase.derived.density ?? 5,
    bz: phase.derived.bz ?? 0,
    bt: phase.derived.bt ?? 5,
    field: scene.field,
    band: scene.band,
    accent: scene.accent,
  };

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

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 600;
    let H = W / ASPECT;
    let raf = 0;
    let running = true;
    let last = performance.now();
    let t = 0;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width < 10) return;
      W = rect.width;
      H = W / ASPECT;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.height = `${H}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Particle pool. Sized for the densest case and then only partly used, so
    // density changes never allocate mid-flight.
    const MAX_P = 260;
    const particles: Particle[] = [];
    for (let i = 0; i < MAX_P; i++) {
      particles.push({ x: Math.random(), y: Math.random(), v: 0.5 + Math.random(), a: 0.3 + Math.random() * 0.7 });
    }

    // ── Primitives ───────────────────────────────────────────────────────────

    /** Speed in km/s to fractions of the frame crossed per second. */
    const flowRate = (speed: number) => 0.06 + Math.max(0, Math.min(1, (speed - 250) / 600)) * 0.30;
    /** Density to how many of the pool we draw. Square-rooted so a 30x density
     *  range does not turn into a 30x particle count. */
    const particleCount = (density: number) =>
      Math.round(24 + Math.sqrt(Math.max(0, Math.min(40, density)) / 40) * (MAX_P - 24));

    const bzColour = (bz: number) => (bz <= -1 ? '#f87171' : bz >= 1 ? '#60a5fa' : '#a3a3a3');

    const drawField = (mode: FieldMode, accent: string, bz: number, bt: number) => {
      ctx.save();
      const strength = Math.max(0.25, Math.min(1, bt / 18));
      ctx.lineWidth = 1.1;

      if (mode === 'rope') {
        // Concentric ellipses = a slice through a flux rope, rotating slowly.
        const cx = W * 0.44;
        const cy = H * 0.5;
        const spin = t * 0.22;
        for (let i = 1; i <= 5; i++) {
          const rx = (W * 0.045) * i;
          const ry = (H * 0.085) * i;
          ctx.globalAlpha = (0.55 - i * 0.07) * strength;
          ctx.strokeStyle = accent;
          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, Math.sin(spin + i * 0.3) * 0.22, 0, Math.PI * 2);
          ctx.stroke();
        }
        // The rotating axis arrow is the thing that makes "the field turns" legible.
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = bzColour(bz);
        ctx.lineWidth = 2;
        const ang = spin;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(ang) * W * 0.035, cy - Math.sin(ang) * H * 0.14);
        ctx.lineTo(cx + Math.cos(ang) * W * 0.035, cy + Math.sin(ang) * H * 0.14);
        ctx.stroke();
      } else if (mode === 'sheet') {
        // A wavy surface with arrows pointing opposite ways either side: the
        // single most important thing to see about a sector boundary.
        const midY = H * 0.5;
        const amp = H * 0.16;
        ctx.globalAlpha = 0.75;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let px = 0; px <= W; px += 4) {
          const y = midY + Math.sin(px / (W * 0.16) + t * 0.5) * amp;
          if (px === 0) ctx.moveTo(px, y); else ctx.lineTo(px, y);
        }
        ctx.stroke();

        ctx.lineWidth = 2.2;
        const arm = Math.max(14, W * 0.022);
        for (let px = W * 0.10; px < W * 0.92; px += W * 0.16) {
          const y = midY + Math.sin(px / (W * 0.16) + t * 0.5) * amp;
          for (const side of [-1, 1] as const) {
            const ay = y + side * H * 0.26;
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = side < 0 ? '#60a5fa' : '#f87171';
            ctx.beginPath();
            ctx.moveTo(px - arm * side, ay);
            ctx.lineTo(px + arm * side, ay);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(px + arm * side, ay);
            ctx.lineTo(px + arm * 0.5 * side, ay - 5);
            ctx.moveTo(px + arm * side, ay);
            ctx.lineTo(px + arm * 0.5 * side, ay + 5);
            ctx.stroke();
          }
        }
      } else if (mode === 'turbulent') {
        // Short segments at random angles, jittering - a field with no order.
        ctx.globalAlpha = 0.8 * strength;
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = accent;
        for (let i = 0; i < 46; i++) {
          const seed = i * 97.13;
          const px = ((seed * 0.37) % 1) * W;
          const py = ((seed * 0.71) % 1) * H;
          const ang = Math.sin(seed + t * 1.6) * Math.PI;
          const len = 9 + ((seed * 0.19) % 1) * 9;
          ctx.beginPath();
          ctx.moveTo(px - Math.cos(ang) * len, py - Math.sin(ang) * len);
          ctx.lineTo(px + Math.cos(ang) * len, py + Math.sin(ang) * len);
          ctx.stroke();
        }
      } else {
        // Parker-spiral style rulings. 'uniform' lies flatter (fast wind winds
        // the spiral less), 'weak' just draws fainter.
        const slope = mode === 'uniform' ? 0.10 : 0.28;
        const alpha = mode === 'weak' ? 0.30 : 0.50;
        ctx.globalAlpha = alpha * strength;
        ctx.strokeStyle = accent;
        const gap = H * 0.26;
        const drift = (t * 18) % gap;
        for (let k = -2; k < H / gap + 3; k++) {
          const y0 = k * gap + drift;
          ctx.beginPath();
          ctx.moveTo(0, y0);
          ctx.lineTo(W, y0 + W * slope);
          ctx.stroke();
        }
      }
      ctx.restore();
    };

    const drawBand = (mode: BandMode, accent: string) => {
      if (mode === 'none') return;
      ctx.save();
      if (mode === 'compression') {
        const cx = W * 0.5 + Math.sin(t * 0.35) * W * 0.03;
        const g = ctx.createLinearGradient(cx - W * 0.16, 0, cx + W * 0.16, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(0.5, `${accent}44`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(cx - W * 0.16, 0, W * 0.32, H);
      } else if (mode === 'front') {
        // A sharp face sweeping left to right on a loop - a shock is an event,
        // so it has to move rather than sit still.
        const x = ((t * 0.22) % 1.25) * W;
        const g = ctx.createLinearGradient(x - W * 0.1, 0, x + 6, 0);
        g.addColorStop(0, 'rgba(255,255,255,0)');
        g.addColorStop(1, `${accent}88`);
        ctx.fillStyle = g;
        ctx.fillRect(x - W * 0.1, 0, W * 0.1, H);
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      } else if (mode === 'interface') {
        const x = W * 0.5;
        ctx.strokeStyle = accent;
        ctx.globalAlpha = 0.8;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(x + H * 0.12, 0);
        ctx.lineTo(x - H * 0.12, H);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (mode === 'thinning') {
        const g = ctx.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, `${accent}1a`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    };

    const drawEarth = (bz: number) => {
      const ex = W * 0.90;
      const ey = H * 0.5;
      const r = Math.max(5, H * 0.09);
      ctx.save();


      // Bow shock / magnetosphere standoff.
      ctx.strokeStyle = bz <= -1 ? 'rgba(248,113,113,0.55)' : 'rgba(96,165,250,0.5)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(ex, ey, r * 2.5, Math.PI * 0.62, Math.PI * 1.38);
      ctx.stroke();

      // Southward field couples: show it opening up and lighting the poles.
      if (bz <= -1) {
        const pulse = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 3));
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = '#4ade80';
        ctx.lineWidth = 2;
        for (const sign of [-1, 1] as const) {
          ctx.beginPath();
          ctx.arc(ex, ey + sign * r * 0.75, r * 0.85, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Same globe the magnetotail and the flux rope draw, with the old flat
      // gradient kept as the fallback until the texture has loaded.
      const tex = earthTexture();
      if (tex) {
        if (!globeRef.current) {
          globeRef.current = document.createElement('canvas');
          renderGlobe(globeRef.current, tex, 172, -62, 0, false, 120);
        }
        ctx.drawImage(globeRef.current, ex - r, ey - r, r * 2, r * 2);
      } else {
        const g = ctx.createRadialGradient(ex - r * 0.3, ey - r * 0.3, r * 0.2, ex, ey, r);
        g.addColorStop(0, '#7dd3fc');
        g.addColorStop(1, '#1e3a8a');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ex, ey, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    /**
     * One pass of the scene. `advance` is false for the initial paint, which
     * has to happen whether or not the loop is running: IntersectionObserver
     * reports immediately for elements that are not on screen, so without this
     * an off-screen diagram sat as an empty black box until it was scrolled
     * into view.
     */
    const draw = (dt: number) => {
      t += dt;
      const { speed, density, bz, bt, field, band, accent } = live.current;

      ctx.clearRect(0, 0, W, H);
      // Same sky as the CME visualisation, the magnetotail and the flux rope.
      drawMilkyWay(ctx, W, H, t, 0.28, 0.7);
      const bg = ctx.createLinearGradient(0, 0, W, 0);
      bg.addColorStop(0, 'rgba(250,204,21,0.07)'); // a hint of the Sun off-frame left
      bg.addColorStop(0.35, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      drawField(field, accent, bz, bt);
      drawBand(band, accent);

      // Particles: speed is the streak length and the travel rate, density is
      // how many we draw.
      const rate = flowRate(speed);
      const n = particleCount(density);
      const streak = 5 + (rate - 0.06) * 150;
      ctx.globalCompositeOperation = 'lighter';
      // Smooth 0..1 ramp, used to vary the flow across the frame without the
      // popping a hard cut-off would cause as particles cross the boundary.
      const ramp = (x: number, a: number, b: number) => Math.max(0, Math.min(1, (x - a) / (b - a)));

      for (let i = 0; i < n; i++) {
        const p = particles[i];

        // The caption for these two describes the flow changing across the
        // frame, so the flow has to actually change across the frame.
        let vMul = 1;
        let aMul = 1;
        if (band === 'thinning') {
          const left = 1 - ramp(p.x, 0.05, 1);
          aMul = 0.2 + left * 0.8;   // empties out towards Earth
          vMul = 0.65 + left * 0.35; // and slows down doing it
        } else if (band === 'interface') {
          const fast = ramp(p.x, 0.42, 0.58);
          vMul = 0.6 + fast * 0.85;  // slow crowded wind -> fast thin wind
          aMul = 1 - fast * 0.5;
        }

        p.x += rate * p.v * vMul * dt;
        if (p.x > 1.05) { p.x = -0.05; p.y = Math.random(); }
        const px = p.x * W;
        const py = p.y * H;
        // Same additive sprite the CME scene and the magnetotail use. Streak
        // length still tracks speed, it is just smeared rather than stroked.
        const tail = streak * p.v * vMul;
        drawParticle(ctx, '226,232,240', px, py, px - tail, py, 1.7, p.a * aMul);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      drawEarth(bz);
    };

    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      draw(dt);
      raf = requestAnimationFrame(frame);
    };

    // Reduced motion: draw one static frame and stop.
    if (reducedMotion) {
      running = false;
      draw(0);
      return () => { ro.disconnect(); };
    }

    // Paint once up front so the panel is never an empty box.
    draw(0);

    // Pause off-screen and when the tab is backgrounded - this runs on phones
    // out in the field, and a canvas loop nobody can see is pure battery drain.
    const io = new IntersectionObserver((entries) => {
      const vis = entries[0]?.isIntersecting ?? true;
      if (vis && !running && !document.hidden) {
        running = true; last = performance.now(); raf = requestAnimationFrame(frame);
      } else if (!vis) {
        running = false;
      }
    }, { threshold: 0.05 });
    io.observe(wrap);

    const onVis = () => {
      if (document.hidden) { running = false; }
      else if (!running) { running = true; last = performance.now(); raf = requestAnimationFrame(frame); }
    };
    document.addEventListener('visibilitychange', onVis);

    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [reducedMotion]);

  const readout = useMemo(() => {
    const d = phase.derived;
    const bits: string[] = [];
    if (d.speed != null) bits.push(`${Math.round(d.speed)} km/s`);
    if (d.density != null) bits.push(`${d.density.toFixed(1)} p/cm³`);
    if (d.bz != null) bits.push(`Bz ${d.bz > 0 ? '+' : ''}${d.bz.toFixed(1)} nT`);
    return bits.join(' · ');
  }, [phase.derived]);

  return (
    <div className={className}>
      <div ref={wrapRef} className="relative w-full overflow-hidden rounded-lg bg-black/40 border border-neutral-700/60">
        <canvas ref={canvasRef} className="block w-full" />
        <div className="absolute top-1 left-2 text-[9px] uppercase tracking-wide text-neutral-500">Sun</div>
        <div className="absolute top-1 right-2 text-[9px] uppercase tracking-wide text-neutral-500">Earth</div>
      </div>
      <div className="mt-1.5 text-[11px] text-neutral-400">{scene.caption}</div>
      {readout && (
        <div className="mt-0.5 text-[10px] text-neutral-600">
          Drawn from live values: {readout}
          {phase.derived.bz != null && phase.derived.bz <= -1 && ' — field is south, so it couples to Earth (green rings)'}
        </div>
      )}
    </div>
  );
};

export default SolarWindStructureDiagram;
