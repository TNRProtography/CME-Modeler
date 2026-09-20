// --- START OF FILE src/components/game/BuildStage.tsx ---
// The Sun end. Everything the player controls lives here, and nothing else.
//
// The readout under the controls updates as you drag, so the chain is visible
// while you build rather than only after you launch: change the speed and watch
// the arrival time move in and out of darkness, swing the rope and watch the
// field direction go from useless to useful.

import React, { useMemo, useRef, useEffect, useCallback } from 'react';
import { drawSun, drawGlow, loadMilkyWay, drawMilkyWay } from '../../utils/spaceScene';
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

// ── The flux rope dial ─────────────────────────────────────────────────────
// Drag the handle to set which way the field points as the rope reaches us.
// Down the screen is southward, which is the direction that matters, and the
// dial is coloured so that is obvious without reading anything.
const RopeDial: React.FC<{ axialDeg: number; rotationDeg: number; onChange: (a: number) => void }> =
({ axialDeg, rotationDeg, onChange }) => {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef(false);

  const set = useCallback((cx: number, cy: number) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = cx - (r.left + r.width / 2);
    const dy = cy - (r.top + r.height / 2);
    // 0 is up (north), 180 is down (south), measured clockwise.
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    onChange(Math.round(deg));
  }, [onChange]);

  const rad = (d: number) => ((d - 90) * Math.PI) / 180;
  const R = 44, cx = 56, cy = 56;
  const endDeg = axialDeg + rotationDeg;
  const pt = (d: number, r = R) => `${cx + Math.cos(rad(d)) * r},${cy + Math.sin(rad(d)) * r}`;
  // cos of the angle from north gives the northward part, so negative is south.
  const southness = -Math.cos((axialDeg * Math.PI) / 180);
  const colour = southness > 0.15 ? '#22c55e' : southness < -0.15 ? '#ef4444' : '#878a9e';

  return (
    <div ref={ref} className="relative select-none touch-none" style={{ width: 112, height: 112 }}
      onPointerDown={e => { drag.current = true; (e.target as HTMLElement).setPointerCapture(e.pointerId); set(e.clientX, e.clientY); }}
      onPointerMove={e => { if (drag.current) set(e.clientX, e.clientY); }}
      onPointerUp={() => { drag.current = false; }}
      onPointerCancel={() => { drag.current = false; }}>
      <svg width={112} height={112} className="cursor-grab active:cursor-grabbing">
        <defs>
          <linearGradient id="dialNS" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.30" />
            <stop offset="50%" stopColor="#111827" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.30" />
          </linearGradient>
        </defs>
        <circle cx={cx} cy={cy} r={R + 6} fill="url(#dialNS)" stroke="rgba(148,163,184,0.2)" />
        <text x={cx} y={14} textAnchor="middle" fontSize="9" fill="#ef4444" opacity="0.75">north, useless</text>
        <text x={cx} y={108} textAnchor="middle" fontSize="9" fill="#22c55e" opacity="0.75">south, this is the one</text>
        {/* where it ends up after turning through the rope */}
        <line x1={cx} y1={cy} x2={pt(endDeg).split(',')[0]} y2={pt(endDeg).split(',')[1]}
              stroke="rgba(203,213,225,0.35)" strokeWidth={2} strokeDasharray="3 3" />
        <line x1={cx} y1={cy} x2={pt(axialDeg).split(',')[0]} y2={pt(axialDeg).split(',')[1]}
              stroke={colour} strokeWidth={3} strokeLinecap="round" />
        <circle cx={cx + Math.cos(rad(axialDeg)) * R} cy={cy + Math.sin(rad(axialDeg)) * R} r={7}
                fill={colour} stroke="#0b1020" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={4} fill="#0b1020" stroke="rgba(203,213,225,0.5)" />
      </svg>
    </div>
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
    const { hours, arrivalSpeed } = propagate(input.speedKms, input.halfWidthDeg);
    const impactPenalty = aimed ? 1 + 0.22 * (1 - Math.cos((sep / Math.max(1, input.halfWidthDeg)) * (Math.PI / 2))) : 1;
    const transit = hours * impactPenalty;
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
  const southness = -Math.cos((input.axialDeg * Math.PI) / 180);

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
            <h3 className="text-xs font-bold tracking-wider text-neutral-400 uppercase mb-2">3. Twist it</h3>
            <div className="card bg-neutral-950/80 p-3 flex flex-col sm:flex-row gap-4 items-center">
              <RopeDial axialDeg={input.axialDeg} rotationDeg={input.rotationDeg}
                        onChange={a => onChange({ axialDeg: a })} />
              <div className="flex-1 w-full space-y-3">
                <Slider label="How far the field turns as it passes" value={input.rotationDeg}
                        min={-180} max={180} step={5}
                        display={`${input.rotationDeg > 0 ? '+' : ''}${input.rotationDeg}°`}
                        hint="A rope is twisted, so the field direction rotates while it goes past. The dashed line on the dial is where it ends up."
                        onChange={v => onChange({ rotationDeg: v })} />
                <Slider label="How long the rope takes to pass" value={input.ropeHours}
                        min={6} max={30} step={1} display={`${input.ropeHours} hours`}
                        hint="A longer rope holds the field steady for longer, and persistence is what loads the tail."
                        onChange={v => onChange({ ropeHours: v })} />
                <p className={`text-xs font-semibold ${southness > 0.15 ? 'text-emerald-400' : southness < -0.15 ? 'text-red-400' : 'text-neutral-400'}`}>
                  {southness > 0.5 ? 'Hard southward. This is what you want.'
                    : southness > 0.15 ? 'Leaning south. Some of it will couple in.'
                    : southness > -0.15 ? 'Sideways. The field is mostly east-west, which does very little.'
                    : 'Northward. The door stays shut, no matter how fast it is going.'}
                </p>
              </div>
            </div>
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
