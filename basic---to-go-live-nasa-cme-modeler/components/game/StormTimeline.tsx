// --- START OF FILE src/components/game/StormTimeline.tsx ---
// The storm on one timeline: what the field and the wind were doing, where the
// shock was, where the sheath ended and the cloud began, and where you are in
// it right now.
//
// A bare slider told you none of that. The point of watching an arrival is
// seeing the shape of it, and the shape is the thing a scrubber with no context
// hides: that the sheath thrashes and the cloud turns, that the speed jumps at
// the shock and decays after, that the southward stretch is a block in the
// middle rather than a moment.

import React, { useCallback, useEffect, useRef } from 'react';
import type { L1Point } from './stormModel';

interface Props {
  series: L1Point[];
  /** Index currently being shown. */
  index: number;
  onScrub: (index: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  /** Sim minutes per second of real time. */
  rate: number;
  onRate: (rate: number) => void;
}

export const BASE_RATE = 26;
const RATES: { label: string; mult: number }[] = [
  { label: '0.5×', mult: 0.5 },
  { label: '1×',   mult: 1 },
  { label: '2×',   mult: 2 },
  { label: '4×',   mult: 4 },
];

const PAD_L = 30, PAD_R = 8, PAD_T = 8;
const BAND_H = 18;          // the phase strip at the bottom
const AXIS_H = 12;          // room for the hour labels

interface Marks { shockIdx: number; ropeIdx: number; endIdx: number; }

export function phaseMarks(series: L1Point[]): Marks {
  const shockIdx = series.findIndex(p => p.region === 'sheath');
  const ropeIdx  = series.findIndex(p => p.region === 'rope');
  let endIdx = -1;
  for (let i = series.length - 1; i > 0; i--) {
    if (series[i].region === 'rope') { endIdx = i; break; }
  }
  return { shockIdx, ropeIdx, endIdx };
}

const StormTimeline: React.FC<Props> = ({ series, index, onScrub, playing, onTogglePlay, rate, onRate }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  // Kept in a ref so the draw loop is not rebuilt on every frame of playback.
  const live = useRef({ series, index });
  live.current = { series, index };

  const scrubFrom = useCallback((clientX: number) => {
    const cv = ref.current; if (!cv) return;
    const r = cv.getBoundingClientRect();
    const w = r.width - PAD_L - PAD_R;
    const f = Math.max(0, Math.min(1, (clientX - r.left - PAD_L) / Math.max(1, w)));
    onScrub(Math.round(f * (live.current.series.length - 1)));
  }, [onScrub]);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    let alive = true, raf = 0;

    const frame = () => {
      if (!alive) return;
      const { series: s, index: idx } = live.current;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (s.length < 2) { raf = requestAnimationFrame(frame); return; }

      const plotW = w - PAD_L - PAD_R;
      const plotH = h - PAD_T - BAND_H - AXIS_H;
      const x = (i: number) => PAD_L + (i / (s.length - 1)) * plotW;

      // Scales. Bz and Bt share one, so their sizes can be compared by eye.
      let bMax = 1, vMin = Infinity, vMax = -Infinity;
      for (const p of s) {
        bMax = Math.max(bMax, Math.abs(p.bz), p.bt);
        vMin = Math.min(vMin, p.speed); vMax = Math.max(vMax, p.speed);
      }
      bMax = Math.ceil(bMax / 10) * 10;
      const zeroY = PAD_T + plotH * 0.55;
      const yB = (v: number) => zeroY - (v / bMax) * (plotH * 0.5);
      const yV = (v: number) => PAD_T + plotH - ((v - vMin) / Math.max(1, vMax - vMin)) * (plotH * 0.92);

      // Zero line and the two field gridlines, so the numbers mean something.
      ctx.strokeStyle = 'rgba(148,163,184,0.16)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD_L, zeroY); ctx.lineTo(w - PAD_R, zeroY); ctx.stroke();
      ctx.fillStyle = 'rgba(148,163,184,0.45)'; ctx.font = '8px system-ui'; ctx.textAlign = 'right';
      ctx.fillText('0', PAD_L - 4, zeroY + 3);
      ctx.fillText(`${bMax}`, PAD_L - 4, yB(bMax) + 3);
      ctx.fillText(`-${bMax}`, PAD_L - 4, yB(-bMax) + 3);

      // Wind speed, behind the field, on its own scale.
      ctx.strokeStyle = 'rgba(250,204,21,0.5)'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i < s.length; i++) {
        const px = x(i), py = yV(s[i].speed);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Bz as a filled trace, green where it points south, which is the whole
      // reason anyone is looking at this chart.
      for (const south of [true, false]) {
        ctx.beginPath();
        ctx.moveTo(x(0), zeroY);
        for (let i = 0; i < s.length; i++) {
          const v = s[i].bz;
          const keep = south ? Math.min(0, v) : Math.max(0, v);
          ctx.lineTo(x(i), yB(keep));
        }
        ctx.lineTo(x(s.length - 1), zeroY);
        ctx.closePath();
        ctx.fillStyle = south ? 'rgba(34,197,94,0.38)' : 'rgba(239,68,68,0.30)';
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(226,232,240,0.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < s.length; i++) {
        const px = x(i), py = yB(s[i].bz);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Bt on top as a thin line, so the field's size is visible as well as
      // its direction.
      ctx.strokeStyle = 'rgba(125,211,252,0.7)'; ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i < s.length; i++) {
        const px = x(i), py = yB(s[i].bt);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();

      // The phase strip.
      const bandY = PAD_T + plotH + 2;
      const colour: Record<L1Point['region'], string> = {
        ambient: 'rgba(100,116,139,0.30)',
        sheath:  'rgba(234,88,12,0.45)',
        rope:    'rgba(56,189,248,0.42)',
      };
      let runStart = 0;
      for (let i = 1; i <= s.length; i++) {
        if (i === s.length || s[i].region !== s[runStart].region) {
          const r = s[runStart].region;
          ctx.fillStyle = colour[r];
          ctx.fillRect(x(runStart), bandY, Math.max(1, x(i - 1) - x(runStart)), BAND_H - 4);
          const wSeg = x(i - 1) - x(runStart);
          if (wSeg > 34) {
            ctx.fillStyle = 'rgba(255,255,255,0.75)';
            ctx.font = '8px system-ui'; ctx.textAlign = 'center';
            ctx.fillText(r === 'rope' ? 'core' : r === 'sheath' ? 'sheath' : 'quiet',
                         x(runStart) + wSeg / 2, bandY + BAND_H - 9);
          }
          runStart = i;
        }
      }

      // Markers where it changes from one thing to the next.
      const { shockIdx, ropeIdx, endIdx } = phaseMarks(s);
      const mark = (i: number, label: string, rgb: string) => {
        if (i < 0) return;
        const px = x(i);
        ctx.strokeStyle = `rgba(${rgb},0.85)`; ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(px, PAD_T); ctx.lineTo(px, bandY + BAND_H - 4); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = `rgba(${rgb},0.95)`;
        ctx.font = '600 8px system-ui'; ctx.textAlign = 'left';
        ctx.fillText(label, Math.min(px + 3, w - PAD_R - 34), PAD_T + 8);
      };
      mark(shockIdx, 'shock', '251,146,60');
      mark(ropeIdx, 'core', '125,211,252');
      mark(endIdx, 'past', '148,163,184');

      // Hours since the shock, along the bottom.
      if (shockIdx >= 0) {
        ctx.fillStyle = 'rgba(148,163,184,0.5)'; ctx.font = '8px system-ui'; ctx.textAlign = 'center';
        const totalH = (s.length - 1) / 60;
        const step = totalH > 40 ? 12 : totalH > 20 ? 6 : 3;
        for (let hr = -Math.floor(shockIdx / 60 / step) * step; hr < totalH; hr += step) {
          const i = shockIdx + hr * 60;
          if (i < 0 || i >= s.length) continue;
          ctx.fillText(`${hr > 0 ? '+' : ''}${hr}h`, x(i), h - 2);
        }
      }

      // Where you are.
      const px = x(Math.max(0, Math.min(s.length - 1, idx)));
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(px, PAD_T - 4); ctx.lineTo(px, bandY + BAND_H - 4); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath(); ctx.arc(px, PAD_T - 4, 3.2, 0, Math.PI * 2); ctx.fill();

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, []);

  return (
    <div>
      <canvas
        ref={ref}
        className="w-full h-[132px] sm:h-[156px] touch-none cursor-pointer"
        onPointerDown={e => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); scrubFrom(e.clientX); }}
        onPointerMove={e => { if (dragging.current) scrubFrom(e.clientX); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
      />
      <div className="flex items-center gap-2 mt-1.5">
        <button onClick={onTogglePlay}
          className="px-3 py-1.5 rounded border border-neutral-700/80 text-neutral-200 text-xs font-semibold active:scale-95 w-16">
          {playing ? 'Pause' : 'Play'}
        </button>
        <div className="flex gap-1 flex-1">
          {RATES.map(r => (
            <button key={r.label} onClick={() => onRate(BASE_RATE * r.mult)}
              className={`flex-1 py-1.5 rounded text-xs font-semibold transition-all active:scale-95 border ${
                Math.abs(rate - BASE_RATE * r.mult) < 0.01
                  ? 'bg-sky-600/30 border-sky-400/60 text-sky-200'
                  : 'bg-neutral-900/70 border-neutral-700/80 text-neutral-400'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-neutral-500">
        <span className="flex items-center gap-1"><i className="w-2.5 h-0.5 bg-sky-300 inline-block" /> Bt</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-0.5 bg-neutral-300 inline-block" /> Bz</span>
        <span className="flex items-center gap-1"><i className="w-2.5 h-0.5 bg-yellow-400/70 inline-block" /> wind speed</span>
        <span className="flex items-center gap-1"><i className="w-2 h-2 bg-emerald-500/50 inline-block" /> southward</span>
      </div>
    </div>
  );
};

export default StormTimeline;
// --- END OF FILE src/components/game/StormTimeline.tsx ---
