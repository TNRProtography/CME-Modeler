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

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import FluxRopeAnalyzer from '../FluxRopeAnalyzer';
import StormTimeline, { BASE_RATE } from './StormTimeline';
import { formatNZ, type L1Point, type StormResult } from './stormModel';

interface Props { result: StormResult; onDone: () => void; }


// The analyser is re-run on this granularity rather than every frame. It is a
// real analysis over the whole series so far, so running it five times a second
// was both wasteful and a fresh chance to change its mind every time.
const STEP = 15;

const Readout: React.FC<{ label: string; value: string; tone?: string; sub?: string }> =
({ label, value, tone = 'text-neutral-100', sub }) => (
  <div className="flex-1 min-w-0 card bg-neutral-950/80 px-2.5 py-2">
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
  const [rate, setRate] = useState(BASE_RATE);
  const raf = useRef(0);
  const last = useRef(0);
  // Read inside the loop so changing speed does not restart playback.
  const rateRef = useRef(rate);
  rateRef.current = rate;

  useEffect(() => {
    if (!playing) return;
    let alive = true;
    last.current = performance.now();
    const frame = (now: number) => {
      if (!alive) return;
      const dt = (now - last.current) / 1000;
      last.current = now;
      setIdx(prev => {
        const next = prev + dt * rateRef.current;
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

  // The analyser draws nothing until it has found a rope and fitted a rotation
  // through it, and exactly when that happens depends on the storm. Rather than
  // guess a number of minutes, ask the DOM whether it actually rendered, and
  // put the explanation in its place when it has not.
  const holderRef = useRef<HTMLDivElement>(null);
  const [hasPanel, setHasPanel] = useState(false);

  // Early in the cloud the analyser is fitting a rotation through very few
  // points, and its detected start can still straddle the last of the sheath,
  // so the fit occasionally fails for a step or two and the panel blinks out
  // and back. The rope has not gone anywhere, so when the newest slice cannot
  // be fitted we keep showing the last one that could. This runs in a layout
  // effect, which re-renders before the browser paints, so the empty frame is
  // never actually shown.
  const [shownFed, setShownFed] = useState(fed);
  const goodRef = useRef<typeof fed | null>(null);
  useEffect(() => { setShownFed(fed); }, [fed]);

  useLayoutEffect(() => {
    const el = holderRef.current;
    const present = !!el && el.childElementCount > 0;
    if (present) {
      goodRef.current = shownFed;
    } else if (goodRef.current && goodRef.current !== shownFed
               && series[Math.min(series.length - 1, Math.max(0, Math.round(idx)))].region === 'rope') {
      setShownFed(goodRef.current);
      return;
    }
    setHasPanel(prev => (prev === present ? prev : present));
  });

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
        <div className="card bg-neutral-950/80 px-3 py-2">
          <p className="text-xs font-bold text-sky-300">{region}</p>
          <p className="text-[11px] text-neutral-400 leading-snug mt-0.5">{regionNote}</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        <p className="text-[10px] text-neutral-500 mb-1.5 leading-snug">
          Below is the app&rsquo;s own flux rope analyser, the same one you get on a real arrival, reading the storm you just built.
        </p>
        {!hasPanel && (
          // The analyser draws nothing until it has found a rope, which is how
          // it behaves on live data too. Saying so is better than a blank box,
          // and it is the point: the shock and the sheath are not the show.
          <div className="card bg-neutral-950/80 p-4 text-center">
            <p className="text-sm font-semibold text-neutral-400">
              {p.region === 'rope' ? 'Not enough of it yet' : 'No rope found yet'}
            </p>
            <p className="text-xs text-neutral-500 mt-1 leading-snug">
              {p.region === 'rope'
                ? 'The cloud has started, but there is not enough of the rotation behind it yet to fit a rope to. Half an hour or so and it will have something to say.'
                : p.region === 'ambient' && p.tMs < result.arrivalMs
                  ? 'Nothing has arrived. The analyser needs a shock and then a smooth rotation before it has anything to say.'
                  : p.region === 'sheath'
                    ? 'The field here is thrashing about, not turning. That is a sheath, not a cloud, and the analyser will not call it one.'
                    : 'The cloud has gone past. Back to ordinary solar wind.'}
            </p>
          </div>
        )}
        <div ref={holderRef}>
          <FluxRopeAnalyzer
            magneticData={shownFed.magneticData}
            speedData={shownFed.speedData}
            densityData={shownFed.densityData}
            tempData={shownFed.tempData}
          />
        </div>
      </div>

      <div className="flex-shrink-0 p-3 border-t border-neutral-700/80 bg-neutral-950/90 space-y-2">
        <StormTimeline
          series={series}
          index={i}
          onScrub={v => { setPlaying(false); setIdx(v); }}
          playing={playing}
          onTogglePlay={() => setPlaying(v => !v)}
          rate={rate}
          onRate={setRate}
        />
        <button onClick={onDone}
          className="w-full py-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors active:scale-[0.99]">
          See what New Zealand got
        </button>
      </div>
    </div>
  );
};

export default ArrivalStage;
// --- END OF FILE src/components/game/ArrivalStage.tsx ---
