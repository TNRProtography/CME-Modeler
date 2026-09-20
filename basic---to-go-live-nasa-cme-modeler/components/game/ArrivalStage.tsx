// --- START OF FILE src/components/game/ArrivalStage.tsx ---
// Your storm, arriving at L1, read by the app's own flux rope analyser.
//
// This is not a copy of that panel made for the game. It is the component the
// app uses on live data, handed the storm the player just built. So whatever
// you learn to read here is directly the thing you will be reading at two in
// the morning when something real is coming in.
//
// The series is shifted so the moment being played sits at the present, and the
// analyser is only ever given the part that has already gone past, exactly as
// it would be on a real arrival. It cannot see the future, and neither can you.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import FluxRopeAnalyzer from '../FluxRopeAnalyzer';
import { formatNZ, type L1Point, type StormResult } from './stormModel';

interface Props { result: StormResult; onDone: () => void; }

// Sim minutes that pass per second of real time.
const RATE = 26;
// The analyser is re-run on this granularity rather than every frame.
const STEP = 5;

const Readout: React.FC<{ label: string; value: string; tone?: string; sub?: string }> =
({ label, value, tone = 'text-neutral-100', sub }) => (
  <div className="flex-1 min-w-0 rounded-lg bg-black/40 border border-white/10 px-2.5 py-2">
    <p className="text-[10px] uppercase tracking-wider text-neutral-500 truncate">{label}</p>
    <p className={`text-lg font-bold font-mono tabular-nums leading-tight ${tone}`}>{value}</p>
    {sub && <p className="text-[10px] text-neutral-500 leading-tight">{sub}</p>}
  </div>
);

const ArrivalStage: React.FC<Props> = ({ result, onDone }) => {
  const series = result.series;
  // Start half an hour before the shock, so the quiet before it is visible.
  const shockIdx = useMemo(
    () => Math.max(0, series.findIndex(p => p.tMs >= result.arrivalMs)), [series, result.arrivalMs]);
  const [idx, setIdx] = useState(Math.max(0, shockIdx - 30));
  const [playing, setPlaying] = useState(true);
  const raf = useRef(0);
  const last = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let alive = true;
    last.current = performance.now();
    const frame = (now: number) => {
      if (!alive) return;
      const dt = (now - last.current) / 1000;
      last.current = now;
      setIdx(prev => {
        const next = prev + dt * RATE;
        if (next >= series.length - 1) { setPlaying(false); return series.length - 1; }
        return next;
      });
      raf.current = requestAnimationFrame(frame);
    };
    raf.current = requestAnimationFrame(frame);
    return () => { alive = false; cancelAnimationFrame(raf.current); };
  }, [playing, series.length]);

  const i = Math.min(series.length - 1, Math.max(0, Math.round(idx)));
  const quantised = Math.floor(i / STEP) * STEP;

  // Everything that has gone past, shifted so the played moment is the present.
  const fed = useMemo(() => {
    const end = Math.min(series.length - 1, quantised);
    const offset = Date.now() - series[end].tMs;
    const slice: L1Point[] = series.slice(0, end + 1);
    return {
      magneticData: slice.map(p => ({ time: p.tMs + offset, bt: p.bt, bz: p.bz, by: p.by, bx: p.bx })),
      speedData:    slice.map(p => ({ x: p.tMs + offset, y: p.speed })),
      densityData:  slice.map(p => ({ x: p.tMs + offset, y: p.density })),
      tempData:     slice.map(p => ({ x: p.tMs + offset, y: p.tempK })),
    };
  }, [series, quantised]);

  const p = series[i];
  const region = p.region === 'rope' ? 'Inside the rope'
    : p.region === 'sheath' ? 'In the sheath' : 'Ambient wind';
  const regionNote = p.region === 'rope'
    ? 'Smooth field, cold thin plasma. This is the magnetic cloud itself, and the field here turns steadily rather than thrashing.'
    : p.region === 'sheath'
      ? 'Compressed, hot, dense and turbulent. The field swings about too quickly to load the tail, which is why a violent sheath often disappoints.'
      : 'Nothing much happening. Quiet solar wind.';

  const bzTone = p.bz < -8 ? 'text-emerald-400' : p.bz < -2 ? 'text-emerald-300' : p.bz > 2 ? 'text-red-400' : 'text-neutral-300';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-shrink-0 px-4 pt-3 pb-2">
        <p className="text-xs uppercase tracking-wider text-neutral-500">At L1, 1.5 million km upwind</p>
        <p className="text-sm text-neutral-300">{formatNZ(p.tMs)} New Zealand time</p>
      </div>

      <div className="flex-shrink-0 px-4 flex gap-2">
        <Readout label="Bz" value={`${p.bz > 0 ? '+' : ''}${p.bz.toFixed(1)}`} tone={bzTone} sub="nT, south good" />
        <Readout label="Bt" value={p.bt.toFixed(1)} sub="nT total" />
        <Readout label="Speed" value={Math.round(p.speed).toString()} sub="km/s" />
        <Readout label="Density" value={p.density.toFixed(1)} sub="p/cm³" />
      </div>

      <div className="flex-shrink-0 px-4 pt-2">
        <div className="rounded-lg bg-black/40 border border-white/10 px-3 py-2">
          <p className="text-xs font-bold text-sky-300">{region}</p>
          <p className="text-[11px] text-neutral-400 leading-snug mt-0.5">{regionNote}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 styled-scrollbar">
        <p className="text-[10px] text-neutral-500 mb-1.5 leading-snug">
          Below is the app&rsquo;s own flux rope analyser, the same one you get on a real arrival, reading the storm you just built.
        </p>
        <FluxRopeAnalyzer
          magneticData={fed.magneticData}
          speedData={fed.speedData}
          densityData={fed.densityData}
          tempData={fed.tempData}
        />
      </div>

      <div className="flex-shrink-0 p-3 border-t border-white/10 bg-black/40 space-y-2">
        <input type="range" min={0} max={series.length - 1} step={1} value={i}
               onChange={e => { setPlaying(false); setIdx(parseInt(e.target.value, 10)); }}
               className="w-full accent-sky-400" />
        <div className="flex gap-2">
          <button onClick={() => setPlaying(v => !v)}
            className="px-4 py-2 rounded-lg text-sm border border-white/15 text-neutral-200 active:scale-95">
            {playing ? 'Pause' : 'Play'}
          </button>
          <button onClick={onDone}
            className="flex-1 py-2 rounded-lg font-bold text-black bg-gradient-to-r from-sky-400 to-emerald-400 active:scale-[0.99]">
            See what New Zealand got
          </button>
        </div>
      </div>
    </div>
  );
};

export default ArrivalStage;
// --- END OF FILE src/components/game/ArrivalStage.tsx ---
