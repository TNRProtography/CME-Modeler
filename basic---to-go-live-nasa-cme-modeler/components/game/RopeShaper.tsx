// --- START OF FILE src/components/game/RopeShaper.tsx ---
// Shaping the cloud by hand.
//
// There is no dial here for the field direction and no slider for Bz, because
// nobody sets those. What you get is the rope itself: drag across it to twist
// it, drag up and down to wind it tighter or looser, and pull the end to make
// it longer or shorter. The field direction falls out of the shape, the way it
// does in the real thing.
//
// The rope is coloured the way the app's own analyser colours it, green where
// the field at that turn points south, so you learn to read the shape rather
// than a number. That is the whole trick: you are not told the answer, you can
// see it in the thing you are holding.

import React, { useCallback, useEffect, useRef } from 'react';
import { drawGlow } from '../../utils/spaceScene';

interface Props {
  axialDeg: number;
  rotationDeg: number;
  ropeHours: number;
  onChange: (patch: { axialDeg?: number; rotationDeg?: number; ropeHours?: number }) => void;
}

const MIN_HOURS = 6, MAX_HOURS = 30;

// Same green and red the analyser and the flux rope panel use, so a southward
// turn looks the same everywhere in the app.
function fieldRgb(southness: number): string {
  if (southness > 0.12) {
    const t = Math.min(1, southness);
    return `${Math.round(18 + t * 15)},${Math.round(155 + t * 100)},${Math.round(55 + t * 35)}`;
  }
  if (southness < -0.12) {
    const t = Math.min(1, -southness);
    return `${Math.round(178 + t * 77)},${Math.round(28 + t * 18)},28`;
  }
  return '135,138,158';
}

const RopeShaper: React.FC<Props> = ({ axialDeg, rotationDeg, ropeHours, onChange }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const drag = useRef<{ mode: 'twist' | 'length'; x: number; y: number } | null>(null);
  const live = useRef({ axialDeg, rotationDeg, ropeHours });
  live.current = { axialDeg, rotationDeg, ropeHours };

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    let alive = true;

    const frame = (now: number) => {
      if (!alive) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const { axialDeg: ax, rotationDeg: rot, ropeHours: hrs } = live.current;
      const cy = h / 2;
      const x0 = 26;
      const lenFrac = (hrs - MIN_HOURS) / (MAX_HOURS - MIN_HOURS);
      const x1 = x0 + (w - 74) * (0.42 + 0.58 * lenFrac);
      const R = Math.min(34, h * 0.30);
      const drift = now / 1400;

      // North and south, marked on the edges rather than stated in words, so
      // the colour of the rope is the thing being read.
      ctx.fillStyle = 'rgba(210,60,60,0.45)'; ctx.font = '9px system-ui'; ctx.textAlign = 'left';
      ctx.fillText('north', 6, cy - R - 8);
      ctx.fillStyle = 'rgba(34,197,94,0.45)';
      ctx.fillText('south', 6, cy + R + 14);

      // The rope: several nested turns, drawn with the same particle sprite the
      // CME visualisation uses.
      ctx.globalCompositeOperation = 'lighter';
      const SHELLS = [
        { rf: 1.0,  turns: 1.0, size: 1.0, alpha: 0.85 },
        { rf: 0.62, turns: 1.4, size: 0.8, alpha: 0.55 },
        { rf: 0.28, turns: 1.9, size: 0.7, alpha: 0.4 },
      ];
      const N = 130;
      for (const sh of SHELLS) {
        for (let i = 0; i <= N; i++) {
          const f = i / N;
          const x = x0 + (x1 - x0) * f;
          // How the field points at this turn, from north, as the rope passes.
          const theta = ((ax + rot * f) * Math.PI) / 180;
          const southness = -Math.cos(theta);
          const rgb = fieldRgb(southness);
          // The coil itself, wound more tightly on the inner shells.
          const phase = f * Math.PI * 2 * (2.2 * sh.turns) + drift + (theta * 0.5);
          const y = cy + Math.sin(phase) * R * sh.rf;
          const depth = 0.55 + 0.45 * Math.cos(phase);
          drawGlow(ctx, rgb, x, y, (1.1 + depth * 1.5) * sh.size, sh.alpha * (0.35 + depth * 0.5));
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      // The end you can pull.
      ctx.fillStyle = 'rgba(15,22,38,0.9)';
      ctx.strokeStyle = 'rgba(148,163,184,0.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(x1 + 16, cy, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(203,213,225,0.7)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x1 + 11, cy); ctx.lineTo(x1 + 21, cy);
      ctx.moveTo(x1 + 18, cy - 3); ctx.lineTo(x1 + 21, cy); ctx.lineTo(x1 + 18, cy + 3);
      ctx.moveTo(x1 + 14, cy - 3); ctx.lineTo(x1 + 11, cy); ctx.lineTo(x1 + 14, cy + 3);
      ctx.stroke();

      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf.current); };
  }, []);

  const hitHandle = useCallback((clientX: number) => {
    const cv = ref.current; if (!cv) return false;
    const r = cv.getBoundingClientRect();
    const w = r.width;
    const lenFrac = (live.current.ropeHours - MIN_HOURS) / (MAX_HOURS - MIN_HOURS);
    const x1 = 26 + (w - 74) * (0.42 + 0.58 * lenFrac);
    return Math.abs(clientX - r.left - (x1 + 16)) < 26;
  }, []);

  const onDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      mode: hitHandle(e.clientX) ? 'length' : 'twist',
      x: e.clientX, y: e.clientY,
    };
  }, [hitHandle]);

  const onMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    if (d.mode === 'length') {
      const cv = ref.current; if (!cv) return;
      const span = (cv.getBoundingClientRect().width - 74) * 0.58;
      const next = live.current.ropeHours + (dx / Math.max(1, span)) * (MAX_HOURS - MIN_HOURS);
      onChange({ ropeHours: Math.round(Math.min(MAX_HOURS, Math.max(MIN_HOURS, next))) });
    } else {
      // Across twists the whole rope. Up and down winds it tighter or looser.
      const nextAx = (live.current.axialDeg + dx * 0.75 + 360) % 360;
      const nextRot = Math.max(-180, Math.min(180, live.current.rotationDeg - dy * 1.1));
      onChange({ axialDeg: Math.round(nextAx), rotationDeg: Math.round(nextRot) });
    }
  }, [onChange]);

  const onUp = useCallback(() => { drag.current = null; }, []);

  return (
    <canvas
      ref={ref}
      className="w-full h-full touch-none cursor-grab active:cursor-grabbing"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  );
};

export default RopeShaper;
// --- END OF FILE src/components/game/RopeShaper.tsx ---
