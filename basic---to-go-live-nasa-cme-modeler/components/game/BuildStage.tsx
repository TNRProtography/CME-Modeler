// --- START OF FILE src/components/game/BuildStage.tsx ---
// The Sun end. Everything the player controls lives here, and nothing else.
//
// The readout under the controls updates as you drag, so the chain is visible
// while you build rather than only after you launch: change the speed and watch
// the arrival time move in and out of darkness, swing the rope and watch the
// field direction go from useless to useful.

import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { drawSun, drawGlow, loadMilkyWay, drawMilkyWay } from '../../utils/spaceScene';
import RopeShaper from './RopeShaper';
import { SUN_FRAGMENT_SHADER } from '../../constants';
import {
  clamp, darknessLabel, formatNZ, peakFraction, propagate, separationDeg,
  sheathHoursFor, type FlareClass, type StormInput,
} from './stormModel';

interface Props {
  input: StormInput;
  onChange: (patch: Partial<StormInput>) => void;
  onLaunch: () => void;
  /** Shown above the controls so the job is always in view. */
  brief: React.ReactNode;
}

const FLARE_CLASSES: FlareClass[] = ['C', 'M', 'X'];

// ── The Sun, with the eruption site on it ──────────────────────────────────
const SunPicker: React.FC<{
  lonDeg: number; latDeg: number; halfWidthDeg: number;
  onPick: (lon: number, lat: number) => void;
}> = ({ lonDeg, latDeg, halfWidthDeg, onPick }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);
  const dragging = useRef(false);

  const pick = useCallback((clientX: number, clientY: number) => {
    const cv = ref.current; if (!cv) return;
    const r = cv.getBoundingClientRect();
    const cx = r.width / 2, cy = r.height / 2;
    const R = Math.min(cx, cy) * 0.78;
    const dx = (clientX - r.left - cx) / R;
    const dy = (clientY - r.top - cy) / R;
    const d = Math.hypot(dx, dy);
    // Clamp to just inside the limb: you cannot erupt from off the disk.
    const k = d > 0.97 ? 0.97 / d : 1;
    const x = dx * k, y = dy * k;
    // Orthographic projection back to heliographic coordinates.
    const lat = (Math.asin(clamp(-y, -1, 1)) * 180) / Math.PI;
    const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
    const lon = (Math.asin(clamp(x / cosLat, -1, 1)) * 180) / Math.PI;
    onPick(+lon.toFixed(1), +lat.toFixed(1));
  }, [onPick]);

  useEffect(() => { loadMilkyWay(); }, []);

  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    let alive = true;

    const frame = () => {
      if (!alive) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== w * dpr || cv.height !== h * dpr) {
        cv.width = w * dpr; cv.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(cx, cy) * 0.78;

      // Same backdrop as every other space scene in the app.
      drawMilkyWay(ctx, w, h, performance.now() / 1000, 0.28);
      drawSun(ctx, cx, cy, R, performance.now() / 1000, SUN_FRAGMENT_SHADER);

      // A light heliographic grid, so "45 degrees east" means something you can
      // point at rather than a number in a box.
      ctx.strokeStyle = 'rgba(255,220,160,0.16)'; ctx.lineWidth = 0.7;
      for (let l = -60; l <= 60; l += 30) {
        ctx.beginPath();
        for (let b = -90; b <= 90; b += 3) {
          const cb = Math.cos((b * Math.PI) / 180);
          const x = cx + R * Math.sin((l * Math.PI) / 180) * cb;
          const y = cy - R * Math.sin((b * Math.PI) / 180);
          b === -90 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      for (let b = -60; b <= 60; b += 30) {
        ctx.beginPath();
        for (let l = -90; l <= 90; l += 3) {
          const cb = Math.cos((b * Math.PI) / 180);
          const x = cx + R * Math.sin((l * Math.PI) / 180) * cb;
          const y = cy - R * Math.sin((b * Math.PI) / 180);
          l === -90 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      // Where it erupts from.
      const cb = Math.cos((latDeg * Math.PI) / 180);
      const px = cx + R * Math.sin((lonDeg * Math.PI) / 180) * cb;
      const py = cy - R * Math.sin((latDeg * Math.PI) / 180);

      // The cone it goes out in, drawn as particles in the same style the CME
      // visualisation uses, so the game and the app look like one thing.
      const sep = separationDeg(lonDeg, latDeg);
      const aimed = sep < halfWidthDeg;
      const rgb = aimed ? '120,230,170' : '235,120,120';
      ctx.globalCompositeOperation = 'lighter';
      const dirX = px - cx, dirY = py - cy;
      const dl = Math.hypot(dirX, dirY);
      const spread = (halfWidthDeg * Math.PI) / 180;
      if (dl < R * 0.22) {
        // Erupting from near the middle of the disk means the cloud is coming
        // more or less straight at us, out of the screen. There is no sideways
        // cone to draw, so it reads as a halo expanding around the source.
        const pulse = (performance.now() / 1400) % 1;
        for (let ring = 0; ring < 3; ring++) {
          const f = (pulse + ring / 3) % 1;
          const rr = R * (0.12 + f * 0.85);
          for (let i = 0; i < 44; i++) {
            const a = (i / 44) * Math.PI * 2;
            drawGlow(ctx, rgb, px + Math.cos(a) * rr, py + Math.sin(a) * rr, 2.0, (1 - f) * 0.45);
          }
        }
      } else {
        const ux = dirX / dl, uy = dirY / dl;
        for (let i = 0; i < 90; i++) {
          const a = Math.atan2(uy, ux) + (((i * 37) % 100) / 100 - 0.5) * 2 * spread;
          const t = ((i * 53) % 100) / 100;
          const rr = R * (1.02 + t * 0.5);
          drawGlow(ctx, rgb, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 2.2 - t * 1.1, 0.5 - t * 0.35);
        }
      }
      ctx.globalCompositeOperation = 'source-over';

      ctx.strokeStyle = 'rgba(140,200,255,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy);
      ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();

      drawGlow(ctx, '255,255,255', px, py, 7, 0.9);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();

      // Earth's direction is straight out of the screen, so it gets a marker at
      // disk centre rather than an arrow that would point nowhere useful.
      ctx.fillStyle = 'rgba(140,200,255,0.6)'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('disk centre faces Earth', cx, cy + R + 16);

      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf.current); };
  }, [lonDeg, latDeg, halfWidthDeg]);

  return (
    <canvas
      ref={ref}
      className="w-full h-full touch-none cursor-crosshair"
      onPointerDown={e => { dragging.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); pick(e.clientX, e.clientY); }}
      onPointerMove={e => { if (dragging.current) pick(e.clientX, e.clientY); }}
      onPointerUp={() => { dragging.current = false; }}
      onPointerCancel={() => { dragging.current = false; }}
    />
  );
};

const Slider: React.FC<{
  label: string; value: number; min: number; max: number; step: number;
  display: string; hint?: string; onChange: (v: number) => void;
}> = ({ label, value, min, max, step, display, hint, onChange }) => (
  <label className="block">
    <div className="flex items-baseline justify-between mb-1">
      <span className="text-xs font-semibold text-neutral-300">{label}</span>
      <span className="text-xs font-mono text-sky-300">{display}</span>
    </div>
    <input type="range" min={min} max={max} step={step} value={value}
           onChange={e => onChange(parseFloat(e.target.value))}
           className="w-full accent-sky-400" />
    {hint && <p className="text-[10px] text-neutral-500 mt-0.5 leading-snug">{hint}</p>}
  </label>
);

const BuildStage: React.FC<Props> = ({ input, onChange, onLaunch, brief }) => {
  const sep = separationDeg(input.lonDeg, input.latDeg);
  const aimed = sep < input.halfWidthDeg;

  // The live prediction. This is the teaching surface: it moves while you drag,
  // so cause and effect are impossible to miss.
  const forecast = useMemo(() => {
    const { hours: transit, arrivalSpeed } = propagate(input.speedKms);
    const arriveMs = input.launchMs + transit * 3_600_000;
    // Where the good part of the storm falls. The shock is not the show: the
    // field has to turn south, and in a twisted rope that happens somewhere in
    // the middle rather than at the front.
    const f = peakFraction(input.axialDeg, input.rotationDeg);
    const bestMs = arriveMs + (sheathHoursFor(arrivalSpeed) + f * input.ropeHours) * 3_600_000;
    return { transit, arriveMs, arrivalSpeed, bestMs };
  }, [input.speedKms, input.halfWidthDeg, input.launchMs, input.axialDeg,
      input.rotationDeg, input.ropeHours, sep, aimed]);

  const dark = darknessLabel(forecast.bestMs);
  const darkOk = dark === 'full dark' || dark === 'twilight';

  // How much of the rope has its field pointing south as it passes. Read off
  // the same shape the player is holding, not set by them.
  const greenFraction = useMemo(() => {
    let green = 0;
    for (let k = 0; k <= 60; k++) {
      const th = ((input.axialDeg + input.rotationDeg * (k / 60)) * Math.PI) / 180;
      if (-Math.cos(th) > 0.12) green++;
    }
    return green / 61;
  }, [input.axialDeg, input.rotationDeg]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {brief}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Aim */}
          <section>
            <h3 className="text-xs font-bold tracking-wider text-neutral-400 uppercase mb-2">1. Aim it</h3>
            <div className="h-56 sm:h-64 card bg-neutral-950/80 overflow-hidden">
              <SunPicker lonDeg={input.lonDeg} latDeg={input.latDeg}
                         halfWidthDeg={input.halfWidthDeg}
                         onPick={(lon, lat) => onChange({ lonDeg: lon, latDeg: lat })} />
            </div>
            <p className={`text-xs mt-1.5 ${aimed ? 'text-emerald-400' : 'text-red-400'}`}>
              {aimed
                ? `${Math.round(sep)}° off the Sun-Earth line, inside a ${Math.round(input.halfWidthDeg)}° cloud. It will reach us.`
                : `${Math.round(sep)}° off the Sun-Earth line and the cloud is only ${Math.round(input.halfWidthDeg)}° wide. It will go straight past.`}
            </p>
            <div className="mt-3 space-y-3">
              <Slider label="Cloud width" value={input.halfWidthDeg} min={15} max={80} step={1}
                      display={`${Math.round(input.halfWidthDeg)}°`}
                      hint="Wider clouds are easier to hit us with, but they spread the same flux over more sky, so they arrive weaker."
                      onChange={v => onChange({ halfWidthDeg: v })} />
            </div>
          </section>

          {/* Energy and speed */}
          <section>
            <h3 className="text-xs font-bold tracking-wider text-neutral-400 uppercase mb-2">2. Time it</h3>
            <div className="card bg-neutral-950/80 p-3 space-y-3">
              <div>
                <span className="text-xs font-semibold text-neutral-300">Flare size</span>
                <div className="flex gap-1.5 mt-1">
                  {FLARE_CLASSES.map(c => (
                    <button key={c} onClick={() => onChange({ flareClass: c })}
                      className={`flex-1 py-1.5 rounded text-sm font-bold transition-all active:scale-95 border ${
                        input.flareClass === c
                          ? 'bg-amber-500/25 border-amber-400/60 text-amber-200'
                          : 'bg-neutral-900/70 border-neutral-700/80 text-neutral-400'}`}>{c}</button>
                  ))}
                </div>
                <input type="range" min={1} max={9.9} step={0.1} value={input.flareMag}
                       onChange={e => onChange({ flareMag: parseFloat(e.target.value) })}
                       className="w-full accent-amber-400 mt-2" />
                <p className="text-[10px] text-neutral-500 leading-snug">
                  {input.flareClass}{input.flareMag.toFixed(1)}. Each letter is ten times the one below it. Bigger flares carry more magnetic flux, so the field arrives stronger.
                </p>
              </div>
              <Slider label="Launch speed" value={input.speedKms} min={350} max={3000} step={10}
                      display={`${Math.round(input.speedKms)} km/s`}
                      hint="This is what decides when it gets here. The wind drags it back on the way, so it always arrives slower than it left."
                      onChange={v => onChange({ speedKms: v })} />
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-xs font-semibold text-neutral-300">How many clouds</span>
                  <span className="text-xs font-mono text-sky-300">
                    {input.cmeCount === 1 ? 'one' : `${input.cmeCount} in a row`}
                  </span>
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5, 6, 7].map(n => (
                    <button key={n} onClick={() => onChange({ cmeCount: n })}
                      className={`flex-1 py-1.5 rounded text-xs font-bold transition-all active:scale-95 border ${
                        input.cmeCount === n
                          ? 'bg-sky-600/30 border-sky-400/60 text-sky-200'
                          : 'bg-neutral-900/70 border-neutral-700/80 text-neutral-400'}`}>{n}</button>
                  ))}
                </div>
                <p className="text-[10px] text-neutral-500 mt-0.5 leading-snug">
                  The big ones are rarely a single cloud. A run of them compresses the field
                  between them, so what arrives is stronger than any one of them would have been.
                  Seven went out before May 2024.
                </p>
              </div>
              <button onClick={() => onChange({ filament: !input.filament })}
                className={`w-full text-left rounded border px-2.5 py-2 transition-all active:scale-[0.99] ${
                  input.filament
                    ? 'bg-fuchsia-900/30 border-fuchsia-500/50'
                    : 'bg-neutral-900/70 border-neutral-700/80'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-neutral-300">Send a filament up with it</span>
                  <span className={`text-xs font-bold ${input.filament ? 'text-fuchsia-300' : 'text-neutral-500'}`}>
                    {input.filament ? 'yes' : 'no'}
                  </span>
                </div>
                <p className="text-[10px] text-neutral-500 mt-0.5 leading-snug">
                  The field in a cloud comes from the structure that erupted, not from the flare&rsquo;s
                  X-rays, so a filament going up carries far more than its flare class suggests.
                  April 2023 was only an M1.7 and it gave the cycle its first severe storm.
                </p>
              </button>
            </div>
            <div className={`mt-2 rounded-lg border p-2.5 ${darkOk ? 'bg-emerald-950/40 border-emerald-700/40' : 'bg-amber-950/40 border-amber-700/40'}`}>
              <p className="text-xs text-neutral-300">
                Shock arrives in <span className="font-mono text-sky-300">{forecast.transit.toFixed(0)} hours</span>,
                at <span className="font-mono text-sky-300">{formatNZ(forecast.arriveMs)}</span> New Zealand time.
              </p>
              <p className="text-xs text-neutral-300 mt-0.5">
                Best of it around <span className="font-mono text-sky-300">{formatNZ(forecast.bestMs)}</span>,
                once the field has turned.
              </p>
              <p className={`text-xs font-semibold mt-0.5 ${darkOk ? 'text-emerald-400' : 'text-amber-400'}`}>
                That is {dark}.{!darkOk && ' Nobody will see a thing, however good the storm is.'}
              </p>
              <p className="text-[10px] text-neutral-500 mt-0.5">
                Slowed to about {Math.round(forecast.arrivalSpeed)} km/s by the time it reaches us.
              </p>
            </div>
          </section>

          {/* The rope */}
          <section className="lg:col-span-2">
            <h3 className="text-xs font-bold tracking-wider text-neutral-400 uppercase mb-2">3. Shape it</h3>
            <div className="card bg-neutral-950/80 p-2">
              <div className="h-36 sm:h-44">
                <RopeShaper axialDeg={input.axialDeg} rotationDeg={input.rotationDeg}
                            ropeHours={input.ropeHours} onChange={onChange} />
              </div>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1.5 leading-snug">
              Drag across the cloud to twist it, up and down to wind it tighter or looser,
              and pull the end to make it longer. Green is where the field at that turn
              points south, and southward field is the only kind that gets in.
            </p>
            <p className="text-[10px] text-neutral-500 mt-0.5 leading-snug">
              {greenFraction > 0.72 ? 'Almost all of this one points south as it goes past.'
                : greenFraction > 0.4 ? 'Part of it points south. Only that part will do anything.'
                : greenFraction > 0.12 ? 'Barely any of it points south.'
                : 'None of it points south. However fast you make it, the door stays shut.'}
              {` It takes ${input.ropeHours} hours to pass.`}
            </p>
          </section>
        </div>
      </div>

      <div className="flex-shrink-0 p-3 border-t border-neutral-700/80 bg-neutral-950/90">
        <button onClick={onLaunch}
          className="w-full py-3 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors active:scale-[0.99]">
          Launch it
        </button>
      </div>
    </div>
  );
};

export default BuildStage;
// --- END OF FILE src/components/game/BuildStage.tsx ---
