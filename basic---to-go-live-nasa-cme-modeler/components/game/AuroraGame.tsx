// --- START OF FILE src/components/game/AuroraGame.tsx ---
// Storm Builder.
//
// You are given a job: put aurora of a certain quality over a certain town at a
// certain time of night. All you get to touch is the Sun end. Aim the eruption,
// choose how fast it leaves, and set how the flux rope inside it is twisted.
// Everything after that follows, because that is how it works.
//
// Three modes, one progression. The daily brief is the same for everyone and
// keeps a streak. Practice rolls a fresh brief whenever you want one. History
// hands you a real storm and asks you to rebuild it from the clues.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import CloseIcon from '../icons/CloseIcon';
import BuildStage from './BuildStage';
import TransitStage from './TransitStage';
import ArrivalStage from './ArrivalStage';
import { EVENTS, dataSourceFor, matchScore, targetInput, type HistoricEvent } from './events';
import { gradeBrief, makeBrief, fmtHour, type Brief, type BriefOutcome } from './briefs';
import {
  darknessAt, darknessLabel, formatNZ, nzHourAt, runStorm,
  TIER_LABEL, visibilityAcrossNZ,
  type StormInput, type StormResult, type Tier,
} from './stormModel';
import { loadEarthTexture, earthTexture, renderGlobe } from '../../utils/spaceScene';
import { dayKey, load, rankFor, recordDaily, recordRun, streakStanding, type Progress } from './progress';

type Phase = 'menu' | 'build' | 'transit' | 'arrival' | 'result';
// 'playback' is not a challenge. The preset storms are real events, and the
// first thing you should be able to do with a real event is watch it happen
// rather than be quizzed on it. Rebuilding one is still there, as the second
// thing you might want to do with it.
type Mode = 'daily' | 'practice' | 'history' | 'playback';

const DEFAULT_INPUT = (launchMs: number): StormInput => ({
  clouds: [{
    flareClass: 'M', flareMag: 5, lonDeg: 0, latDeg: 0,
    speedKms: 1000, halfWidthDeg: 45, offsetHours: 0,
  }],
  axialDeg: 180, rotationDeg: 60, ropeHours: 14, filament: false, launchMs,
});

const TIER_COLOUR: Record<Tier, string> = {
  nothing: 'text-neutral-600', camera: 'text-sky-400', phone: 'text-emerald-400', eye: 'text-amber-300',
};

// ── The globe, with the oval where your storm put it ───────────────────────
const ResultGlobe: React.FC<{ boundary: number; score: number }> = ({ boundary, score }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(!!earthTexture());
  useEffect(() => { loadEarthTexture(() => setReady(true)); }, []);
  useEffect(() => {
    const cv = ref.current, tex = earthTexture();
    if (!cv || !tex) return;
    // Centred on New Zealand, and negative because this is the southern oval.
    // The app passes it the same way round in the wind diagram.
    renderGlobe(cv, tex, 174, -Math.abs(boundary), score, score > 60, 200);
  }, [ready, boundary, score]);
  return <canvas ref={ref} className="w-[200px] h-[200px] mx-auto" />;
};

const AuroraGame: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [progress, setProgress] = useState<Progress>(() => load());
  const [phase, setPhase] = useState<Phase>('menu');
  const [mode, setMode] = useState<Mode>('daily');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [event, setEvent] = useState<HistoricEvent | null>(null);
  const [cluesShown, setCluesShown] = useState(1);
  const [input, setInput] = useState<StormInput>(() => DEFAULT_INPUT(Date.now()));
  const [result, setResult] = useState<StormResult | null>(null);
  const [outcome, setOutcome] = useState<BriefOutcome | null>(null);
  const [gained, setGained] = useState(0);

  const standing = streakStanding(progress);
  const rank = rankFor(progress.xp);

  // A launch time that puts a sensibly fast cloud into the evening, so the
  // timing puzzle is winnable rather than a lottery.
  const launchFor = useCallback((targetHour: number) => {
    const now = new Date();
    const guessTransit = 40;
    const ms = Date.now();
    const hourNow = nzHourAt(ms);
    let delta = targetHour - ((hourNow + guessTransit) % 24);
    if (delta < 0) delta += 24;
    void now;
    return ms + delta * 3_600_000;
  }, []);

  const startBrief = useCallback((seed: string, m: Mode) => {
    const launch = launchFor(22);
    const b = makeBrief(seed, launch);
    setBrief(b); setEvent(null); setMode(m);
    setInput(DEFAULT_INPUT(launch));
    setResult(null); setOutcome(null); setPhase('build');
  }, [launchFor]);

  // Watch the real thing, with its real clouds, straight through.
  const watchEvent = useCallback((ev: HistoricEvent) => {
    const launch = launchFor(ev.targetNZHour);
    setEvent(ev); setBrief(null); setMode('playback'); setCluesShown(0);
    const real = targetInput(ev, launch);
    setInput(real);
    setResult(runStorm(real));
    setOutcome(null); setPhase('transit');
  }, [launchFor]);

  const startEvent = useCallback((ev: HistoricEvent) => {
    const launch = launchFor(ev.targetNZHour);
    setEvent(ev); setBrief(null); setMode('history'); setCluesShown(1);
    setInput(DEFAULT_INPUT(launch));
    setResult(null); setOutcome(null); setPhase('build');
  }, [launchFor]);

  const launch = useCallback(() => {
    setResult(runStorm(input));
    setPhase('transit');
  }, [input]);

  // Scoring happens once, when the result screen is reached.
  const finish = useCallback(() => {
    if (!result) return;
    if (brief) {
      const o = gradeBrief(brief, result, nzHourAt(result.bestVisibleAtMs));
      setOutcome(o); setGained(o.xp);
      setProgress(prev => mode === 'daily'
        ? recordDaily(prev, o.score, o.xp)
        : recordRun(prev, o.score, o.xp));
    } else if (event && mode === 'playback') {
      // Nothing to score. You get a little for having sat through it, and the
      // event is marked as seen.
      setOutcome(null); setGained(20);
      setProgress(prev => recordRun(prev, 0, 20, event.id));
    } else if (event) {
      const m = matchScore(event, input);
      const score = Math.round(m.overall * 100);
      const xp = 30 + Math.round(score * 1.6);
      setOutcome({ hit: score >= 70, inWindow: true, achieved: 'eye', score, xp, lines: [] });
      setGained(xp);
      setProgress(prev => recordRun(prev, score, xp, event.id));
    }
    setPhase('result');
  }, [result, brief, event, input, mode]);

  const patch = useCallback((p: Partial<StormInput>) => setInput(v => ({ ...v, ...p })), []);

  // ── Menu ────────────────────────────────────────────────────────────────
  const menu = (
    <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
      <div className="max-w-md mx-auto space-y-5">
        <div>
          <h2 className="text-2xl font-bold text-neutral-50">Storm Builder</h2>
          <p className="text-sm text-neutral-400 mt-1 leading-snug">
            You get the Sun end. Aim the eruption, choose its speed, twist the rope inside it.
            Everything after that follows on its own, which is rather the point.
          </p>
        </div>

        <div className="card bg-neutral-950/80 p-3">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-bold text-amber-300">{rank.rank.name}</span>
            <span className="text-xs font-mono text-neutral-500">{progress.xp} xp</span>
          </div>
          <p className="text-[11px] text-neutral-500 mt-0.5 leading-snug">{rank.rank.blurb}</p>
          <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden mt-2">
            <div className="h-full bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300"
                 style={{ width: `${Math.round(rank.progress * 100)}%` }} />
          </div>
          {rank.next && <p className="text-[10px] text-neutral-500 mt-1">{rank.toNext} xp to {rank.next.name}</p>}
        </div>

        <button onClick={() => startBrief(`daily-${dayKey()}`, 'daily')}
          disabled={standing.playedToday}
          className={`w-full text-left rounded-xl p-4 border transition-all active:scale-[0.99] ${
            standing.playedToday
              ? 'bg-neutral-900/70 border-neutral-800/90 opacity-60'
              : 'bg-gradient-to-r from-sky-900/50 to-emerald-900/40 border-sky-600/40'}`}>
          <div className="flex items-baseline justify-between">
            <span className="font-bold text-neutral-100">Today&rsquo;s brief</span>
            <span className="text-xs text-amber-400 font-bold">
              {progress.streak > 0 ? `${progress.streak} day streak` : 'no streak yet'}
            </span>
          </div>
          <p className="text-xs text-neutral-400 mt-1 leading-snug">
            {standing.playedToday
              ? 'Done for today. A new one turns up after midnight.'
              : standing.alive || progress.streak === 0
                ? 'One job, the same for everyone, once a day.'
                : 'Your streak has lapsed. This starts a new one.'}
          </p>
        </button>

        <button onClick={() => startBrief(`practice-${Date.now()}`, 'practice')}
          className="w-full text-left card bg-neutral-950/80 p-4 active:scale-[0.99]">
          <span className="font-bold text-neutral-100">Practice</span>
          <p className="text-xs text-neutral-400 mt-1">A fresh brief, as many as you like. Still earns experience.</p>
        </button>

        <div>
          <h3 className="text-xs font-bold tracking-wider text-neutral-400 uppercase mb-2">Real storms</h3>
          <p className="text-[11px] text-neutral-500 mb-2 leading-snug">
            Watch one happen, cloud by cloud, with the figures it actually had. Or build
            it yourself from the clues and see how close you land.
          </p>
          <div className="space-y-2">
            {EVENTS.map(ev => {
              const data = dataSourceFor(ev);
              return (
                <div key={ev.id} className="card bg-neutral-950/80 p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-bold text-neutral-100 text-sm">{ev.name}</span>
                    <span className="text-[10px] text-neutral-500 flex-shrink-0">{ev.date}</span>
                  </div>
                  <p className="text-xs text-neutral-400 mt-1 leading-snug">{ev.hook}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <button onClick={() => watchEvent(ev)}
                      className="flex-1 py-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-colors active:scale-95">
                      Watch it
                    </button>
                    <button onClick={() => startEvent(ev)}
                      className="flex-1 py-1.5 rounded border border-neutral-700/80 text-neutral-300 text-xs font-semibold active:scale-95">
                      Rebuild it
                    </button>
                  </div>
                  <p className="text-[10px] text-neutral-600 mt-1.5">
                    {data.clouds.length} {data.clouds.length === 1 ? 'cloud' : 'clouds'}
                    {' \u00b7 '}
                    {data.source === 'donki'
                      ? 'figures from NASA\u2019s DONKI catalogue'
                      : 'figures reconstructed from the published summaries'}
                    {progress.seenEvents.includes(ev.id) && ' \u00b7 seen'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-center gap-5 text-xs text-neutral-500 pt-1">
          <span>Best brief: <span className="text-sky-400 font-bold">{progress.bestScore}</span></span>
          <span>Longest streak: <span className="text-amber-400 font-bold">{progress.bestStreak}</span></span>
          <span>Played: <span className="text-neutral-300 font-bold">{progress.played}</span></span>
        </div>
      </div>
    </div>
  );

  // ── The job, pinned above the controls ──────────────────────────────────
  const briefHeader = brief ? (
    <div className="flex-shrink-0 px-4 py-2.5 bg-sky-950/40 border-b border-sky-800/30">
      <p className="text-[10px] uppercase tracking-wider text-sky-500">The job</p>
      <p className="text-sm font-bold text-neutral-100 leading-snug">{brief.title}</p>
      <p className="text-xs text-neutral-400 mt-0.5">
        Between {fmtHour(brief.window.fromHour)} and {fmtHour(brief.window.toHour)}. {brief.note}
      </p>
    </div>
  ) : event ? (
    <div className="flex-shrink-0 px-4 py-2.5 bg-purple-950/40 border-b border-purple-800/30">
      <p className="text-[10px] uppercase tracking-wider text-purple-400">Rebuild</p>
      <p className="text-sm font-bold text-neutral-100">{event.name}, {event.date}</p>
      <ul className="mt-1 space-y-0.5">
        {event.clues.slice(0, cluesShown).map((c, i) => (
          <li key={i} className="text-xs text-neutral-400 leading-snug">&mdash; {c}</li>
        ))}
      </ul>
      {cluesShown < event.clues.length && (
        <button onClick={() => setCluesShown(n => n + 1)}
          className="text-[11px] text-purple-300 underline mt-1">Another clue</button>
      )}
    </div>
  ) : null;

  // ── Result ──────────────────────────────────────────────────────────────
  const resultView = () => {
    if (!result) return null;
    const moon = brief ? brief.moon : event ? event.moon : { illumination: 0, up: false };
    const seen = result.hits
      ? visibilityAcrossNZ(result.bestVisibleKp, moon, darknessAt(result.bestVisibleAtMs))
      : [];
    const match = event && mode !== 'playback' ? matchScore(event, input) : null;

    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <div className="max-w-md mx-auto space-y-4">
          <div className="text-center">
            {mode === 'playback' && event ? (
              <>
                <p className="text-xs uppercase tracking-wider text-neutral-500">What it did</p>
                <p className="text-2xl font-bold text-neutral-50">{event.name}</p>
                <p className="text-sm text-neutral-400">{event.date}</p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-wider text-neutral-500">
                  {event ? 'How close you got' : outcome?.hit ? 'Brief met' : 'Brief not met'}
                </p>
                <p className="text-5xl font-bold text-neutral-50 tabular-nums">{outcome?.score ?? 0}</p>
              </>
            )}
            <p className="text-sm text-emerald-400 font-semibold">+{gained} xp</p>
          </div>

          {result.hits ? <ResultGlobe boundary={result.bestVisibleBoundaryLat} score={result.bestVisibleScore} /> : (
            <p className="text-center text-sm text-red-400 py-8">{result.missReason}</p>
          )}

          {result.hits && (
            <>
              <div className="card bg-neutral-950/80 divide-y divide-neutral-800/80">
                {seen.map(({ place, tier }) => (
                  <div key={place.name} className="flex items-center justify-between px-3 py-1.5">
                    <span className="text-sm text-neutral-300">{place.name}</span>
                    <span className={`text-xs font-semibold ${TIER_COLOUR[tier]}`}>{TIER_LABEL[tier]}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="card bg-neutral-950/80 px-3 py-2">
                  <p className="text-neutral-500">Best of it, in the dark</p>
                  <p className="text-neutral-100 font-mono">{formatNZ(result.bestVisibleAtMs)}</p>
                  <p className="text-neutral-500">{darknessLabel(result.bestVisibleAtMs)}</p>
                </div>
                <div className="card bg-neutral-950/80 px-3 py-2">
                  <p className="text-neutral-500">Strongest southward Bz</p>
                  <p className="text-neutral-100 font-mono">{result.minBz} nT</p>
                  <p className="text-neutral-500">Peaked {formatNZ(result.peakAtMs)}, Kp {result.peakKp}</p>
                </div>
              </div>
            </>
          )}

          {outcome?.lines.map((l, i) => (
            <p key={i} className="text-sm text-neutral-300 leading-snug">{l}</p>
          ))}

          {mode === 'playback' && event && (
            <div className="card bg-neutral-950/80 p-3">
              <p className="text-xs font-bold text-sky-300 mb-1.5">What it was made of</p>
              <div className="space-y-1">
                {result.outcomes.map((o, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={`w-10 flex-shrink-0 font-semibold ${o.hits ? 'text-emerald-400' : 'text-neutral-600'}`}>
                      {o.hits ? 'hit' : 'missed'}
                    </span>
                    <span className="flex-1 text-neutral-300 truncate">{o.spec.label || `Cloud ${i + 1}`}</span>
                    <span className="font-mono text-neutral-500">{Math.round(o.spec.speedKms)} km/s</span>
                    <span className="font-mono text-neutral-600 w-9 text-right">{Math.round(o.spec.halfWidthDeg)}&deg;</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-neutral-500 mt-2 leading-snug">
                {dataSourceFor(event).source === 'donki'
                  ? `Straight from NASA\u2019s DONKI catalogue, the same one the CME visualisation runs on.`
                  : 'Reconstructed from the published storm summaries. Running the DONKI fetch replaces these with the catalogue\u2019s own figures.'}
              </p>
              <div className="grid grid-cols-3 gap-2 mt-2 text-[11px]">
                <div><p className="text-neutral-500">It reached</p><p className="text-neutral-100 font-mono">Kp {event.facts.kp}</p></div>
                <div><p className="text-neutral-500">Dst</p><p className="text-neutral-100 font-mono">{event.facts.dst} nT</p></div>
                <div><p className="text-neutral-500">First shock</p><p className="text-neutral-100 font-mono">{event.facts.transitHours}h</p></div>
              </div>
              <p className="text-[10px] text-neutral-500 mt-1.5 leading-snug">{event.facts.note}</p>
            </div>
          )}

          {match && mode !== 'playback' && event && (
            <div className="card bg-neutral-950/80 p-3 space-y-1.5">
              {match.parts.map(p => (
                <div key={p.label} className="flex items-center gap-2">
                  <span className="text-xs text-neutral-400 flex-1">
                    {p.label}
                    {p.from === 'estimated' && <span className="text-neutral-600"> *</span>}
                  </span>
                  <span className="text-[11px] font-mono text-neutral-500">{p.yours}</span>
                  <span className="text-[11px] font-mono text-emerald-400 w-20 text-right">{p.actual}</span>
                  <div className="w-10 h-1.5 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
                    <div className="h-full bg-emerald-400" style={{ width: `${Math.round(p.closeness * 100)}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-neutral-500 pt-1 leading-snug">
                Green is what it actually was. The flare, the position, the width and the number
                of clouds are from the record. The launch speed is solved backwards from the
                published Sun to Earth transit time, so the cloud gets here when the real one did.
                Anything marked * is an estimate, because the twist of the field inside a cloud
                cannot be measured until it is already going past.
              </p>
            </div>
          )}

          {event && (
            <div className="card bg-purple-950/40 p-3">
              <p className="text-xs font-bold text-purple-300 mb-1">What really happened</p>
              <p className="text-sm text-neutral-300 leading-snug">{event.whatHappened}</p>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={() => {
                if (mode === 'playback' && event) watchEvent(event);
                else { setPhase('build'); setResult(null); setOutcome(null); }
              }}
              className="flex-1 py-2.5 rounded-lg text-sm border border-neutral-700/80 text-neutral-200 active:scale-95">
              {mode === 'playback' ? 'Watch again' : 'Try again'}
            </button>
            <button onClick={() => setPhase('menu')}
              className="flex-1 py-2.5 rounded-lg text-sm bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-colors active:scale-95">
              Back to menu
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    // The app's other modals are a dark scrim with a bounded panel on top, so
    // this one is too. The scrim is opaque rather than blurred: behind it sits
    // the 3D lab, still animating, and a full screen backdrop-filter over a
    // live WebGL canvas re-blurs every frame, which is exactly the budget the
    // game's own canvases need. At this opacity the two are indistinguishable.
    <div className="fixed inset-0 z-[5000] bg-black/85 flex justify-center items-center sm:p-4">
      <div className="relative w-full h-full sm:h-[92vh] sm:max-h-[900px] sm:max-w-2xl bg-neutral-950/95 border border-neutral-800/90 sm:rounded-lg shadow-2xl text-neutral-300 flex flex-col overflow-hidden">
      <header className="flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-neutral-700/80">
        <div className="min-w-0">
          <p className="text-sm font-bold text-neutral-100 truncate">
            {mode === 'playback' && event && phase !== 'menu'
              ? event.name
              : phase === 'menu' ? 'Storm Builder'
              : phase === 'build' ? 'Build it'
              : phase === 'transit' ? 'In transit'
              : phase === 'arrival' ? 'Arriving' : 'Result'}
          </p>
          {phase !== 'menu' && (
            <p className="text-[10px] text-neutral-500 truncate">{rank.rank.name} &middot; {progress.xp} xp</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {phase !== 'menu' && phase !== 'result' && (
            <button onClick={() => setPhase('menu')} className="text-xs text-neutral-400 px-2 py-1">
              {mode === 'playback' ? 'Stop' : 'Give up'}
            </button>
          )}
          <button onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-lg text-neutral-400 hover:text-white active:scale-95">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
      </header>

      {phase === 'menu' && menu}
      {phase === 'build' && (
        <BuildStage input={input} onChange={patch} onLaunch={launch} brief={briefHeader} />
      )}
      {phase === 'transit' && result && (
        <TransitStage input={input} result={result}
          onDone={() => { if (result.hits) setPhase('arrival'); else finish(); }} />
      )}
      {phase === 'arrival' && result && <ArrivalStage result={result} onDone={finish} />}
      {phase === 'result' && resultView()}
      </div>
    </div>
  );
};

export default AuroraGame;
// --- END OF FILE src/components/game/AuroraGame.tsx ---
