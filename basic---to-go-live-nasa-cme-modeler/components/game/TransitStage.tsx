// --- START OF FILE src/components/game/TransitStage.tsx ---
// The bit in between, which is the part people have no feel for.
//
// You cannot see a CME coming with your eyes, and the gap between a flare going
// off and anything happening in the sky is one to four days. Watching it crawl
// across, with the clock running, is the only way to make that land.

import React, { useEffect, useRef, useState } from 'react';
import { drawSun, drawGlow, loadEarthTexture, earthTexture, loadMilkyWay, drawMilkyWay } from '../../utils/spaceScene';
import { SUN_FRAGMENT_SHADER } from '../../constants';
import { formatNZ, type StormResult, type StormInput } from './stormModel';

interface Props { input: StormInput; result: StormResult; onDone: () => void; }

const TransitStage: React.FC<Props> = ({ input, result, onDone }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hours, setHours] = useState(0);
  const doneRef = useRef(false);

  useEffect(() => { loadEarthTexture(); loadMilkyWay(); }, []);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    let raf = 0, alive = true;
    const started = performance.now();
    // The whole transit plays in about eight seconds however long it really
    // took, but the clock on screen counts the real hours.
    const PLAY_MS = 8000;

    const frame = (now: number) => {
      if (!alive) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const t = Math.min(1, (now - started) / PLAY_MS);
      setHours(t * result.transitHours);

      drawMilkyWay(ctx, w, h, now / 1000, 0.3);

      const sunX = 54, earthX = w - 60, cy = h / 2;
      drawSun(ctx, sunX, cy, 26, now / 1000, SUN_FRAGMENT_SHADER);

      // Earth, from the same texture the 3D scene uses.
      const tex = earthTexture();
      if (tex) {
        ctx.save();
        ctx.beginPath(); ctx.arc(earthX, cy, 16, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(tex, earthX - 16, cy - 16, 32, 32);
        ctx.restore();
      }
      ctx.strokeStyle = 'rgba(120,180,255,0.4)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(earthX, cy, 17, 0, Math.PI * 2); ctx.stroke();

      // The cloud. It misses if it was never aimed at us, and the path bends
      // off screen so you can see it go past rather than simply vanish.
      const span = earthX - sunX;
      const missDrop = result.hits ? 0 : (result.separationDeg / 90) * h * 0.55;
      const headX = sunX + span * t * (result.hits ? 1 : 1.25);
      const headY = cy + missDrop * t;

      ctx.globalCompositeOperation = 'lighter';
      const rgb = result.hits ? '255,190,110' : '190,190,200';
      for (let i = 0; i < 260; i++) {
        const back = ((i * 17) % 100) / 100;        // how far behind the nose
        const lateral = (((i * 41) % 100) / 100 - 0.5) * 2;
        const px = headX - back * 74;
        if (px < sunX) continue;
        const width = 12 + back * 30 + (input.halfWidthDeg / 70) * 22;
        const py = headY + lateral * width * (0.35 + back * 0.65);
        drawGlow(ctx, rgb, px, py, 2.6 - back * 1.5, (1 - back) * 0.55);
      }
      ctx.globalCompositeOperation = 'source-over';

      // How far along, as a line, because a bar is easier to read than a cloud.
      ctx.strokeStyle = 'rgba(148,163,184,0.18)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sunX, h - 22); ctx.lineTo(earthX, h - 22); ctx.stroke();
      ctx.strokeStyle = 'rgba(56,189,248,0.7)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(sunX, h - 22); ctx.lineTo(sunX + span * t, h - 22); ctx.stroke();
      ctx.fillStyle = 'rgba(148,163,184,0.55)'; ctx.font = '9px system-ui';
      ctx.textAlign = 'left';  ctx.fillText('Sun', sunX - 8, h - 8);
      ctx.textAlign = 'right'; ctx.fillText('Earth', earthX + 8, h - 8);

      if (t >= 1 && !doneRef.current) { doneRef.current = true; setTimeout(onDone, 700); }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [input, result, onDone]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 px-4 py-3 text-center">
        <p className="text-xs uppercase tracking-wider text-neutral-500">On its way</p>
        <p className="text-3xl font-bold text-sky-300 font-mono tabular-nums">
          {hours.toFixed(0)}<span className="text-lg text-neutral-500"> / {result.transitHours.toFixed(0)} hours</span>
        </p>
        <p className="text-xs text-neutral-400 mt-0.5">
          {result.hits
            ? `Arriving ${formatNZ(result.arrivalMs)} New Zealand time`
            : 'This one is going to miss'}
        </p>
      </div>
      <div className="flex-1 min-h-0"><canvas ref={ref} className="w-full h-full" /></div>
      <div className="flex-shrink-0 p-3">
        <button onClick={onDone}
          className="w-full py-2 rounded-lg text-sm text-neutral-400 border border-neutral-800/90 active:scale-[0.99]">
          Skip ahead
        </button>
      </div>
    </div>
  );
};

export default TransitStage;
// --- END OF FILE src/components/game/TransitStage.tsx ---
