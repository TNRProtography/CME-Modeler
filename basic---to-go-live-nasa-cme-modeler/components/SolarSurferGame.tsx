// --- START OF FILE src/components/SolarSurferGame.tsx ---
// "Spot The Aurora" — forecaster training game
// Players read auto-generated space weather stats and decide
// what aurora should be visible in the NZ landscape above.

import React, { useRef, useEffect, useCallback, useState } from 'react';
import CloseIcon from './icons/CloseIcon';

type VisibilityAnswer = 'nothing' | 'camera' | 'naked' | 'exceptional';
type GamePhase = 'menu' | 'observing' | 'answering' | 'feedback' | 'gameover';
type ScenarioType = 'quiet' | 'building' | 'active' | 'substorm' | 'trick_moon' | 'trick_northward' | 'trick_speed_no_bz' | 'trick_sheath';

interface Scenario {
  type: ScenarioType;
  bz: number; bt: number; speed: number; density: number;
  pressure: number; hp: number; moonPhase: number; moonUp: boolean;
  moonIllumination: number; bzTrend: number[]; southwardMinutes: number;
  bayOnset: boolean; cmeSheath: boolean; auroraScore: number;
  correctAnswer: VisibilityAnswer; explanation: string;
}

interface Star { x: number; y: number; r: number; twinkle: number; phase: number; }
interface AuroraRay { x: number; baseY: number; height: number; width: number; hue: number; alpha: number; speed: number; phase: number; }

function rand(min: number, max: number) { return min + Math.random() * (max - min); }
function randInt(min: number, max: number) { return Math.floor(rand(min, max + 1)); }
function clamp(v: number, lo: number, hi: number) { return Math.min(hi, Math.max(lo, v)); }
function computePressure(d: number, v: number) { return 1.6726e-6 * d * v * v; }

function newellCoupling(bz: number, bt: number, speed: number): number {
  if (bt <= 0) return 0;
  const bzC = clamp(bz, -bt, bt);
  const sinHalf = Math.sqrt((1 - bzC / bt) / 2);
  const v43 = Math.pow(Math.max(speed, 0), 4 / 3);
  const bt23 = Math.pow(bt, 2 / 3);
  const sin83 = Math.pow(sinHalf, 8 / 3);
  return v43 * bt23 * sin83;
}

function computeAuroraScore(s: Scenario): number {
  const newell = newellCoupling(s.bz, s.bt, s.speed);
  const newellScore = clamp((newell / 10000) * 100, 0, 100);
  const bzScore = clamp((-s.bz / 25) * 100, 0, 100);
  const speedScore = clamp(((s.speed - 300) / 500) * 100, 0, 100);
  const pressScore = clamp(((s.pressure - 0.5) / 19.5) * 100, 0, 100);
  const hpScore = clamp((s.hp / 300) * 100, 0, 100);
  const southPersist = clamp((s.southwardMinutes / 30) * 100, 0, 100);
  let solar = newellScore * 0.35 + bzScore * 0.20 + speedScore * 0.15 + pressScore * 0.10 + southPersist * 0.12 + hpScore * 0.08;
  if (s.bayOnset) solar = Math.min(100, solar * 1.25);
  if (s.cmeSheath) solar = Math.min(100, solar * 1.10);
  let moonPenalty = 0;
  if (s.moonUp) moonPenalty = (s.moonIllumination / 100) * 0.75 * 0.5 * 100;
  return clamp(solar - moonPenalty, 0, 100);
}

function scoreToAnswer(score: number): VisibilityAnswer {
  if (score >= 72) return 'exceptional';
  if (score >= 48) return 'naked';
  if (score >= 26) return 'camera';
  return 'nothing';
}

function generateBzTrend(finalBz: number): number[] {
  return Array.from({ length: 10 }, (_, i) => {
    const progress = i / 9;
    return finalBz * progress * 0.6 + finalBz * 0.4 + rand(-2, 2);
  }).map((v, i, arr) => i === 9 ? finalBz : v);
}

const EXPLANATIONS: Record<ScenarioType, (s: Scenario) => string> = {
  quiet: (s) => `Bz was ${s.bz > 0 ? 'northward' : 'near flat'} at ${s.bz.toFixed(1)} nT with hemispheric power only ${s.hp.toFixed(0)} GW. No meaningful coupling to the magnetosphere — quiet skies.`,
  building: (s) => `Bz trending south to ${s.bz.toFixed(1)} nT, speed at ${s.speed.toFixed(0)} km/s. Conditions building but not yet sustained. A faint camera glow was just starting.`,
  active: (s) => `Bz sustained at ${s.bz.toFixed(1)} nT for ${s.southwardMinutes} minutes with speed ${s.speed.toFixed(0)} km/s. The longer Bz stays south, the brighter the aurora — this is a clear active display.`,
  substorm: () => `Bay onset detected — a substorm erupted at Eyrewell. Energy released from the magnetotail in a sudden burst. The sky lights up fast and bright.`,
  trick_moon: (s) => `The solar wind was decent but the moon was ${s.moonIllumination.toFixed(0)}% illuminated and above the horizon. Moonlight washes out faint aurora — the glow you saw was lunar, not auroral.`,
  trick_northward: (s) => `Speed was ${s.speed.toFixed(0)} km/s which looks impressive, but Bz was ${s.bz.toFixed(1)} nT — northward. The solar wind wasn't coupling to the magnetosphere. Fast wind alone does nothing.`,
  trick_speed_no_bz: (s) => `High speed (${s.speed.toFixed(0)} km/s) and good pressure (${s.pressure.toFixed(1)} nPa) but Bz was nearly flat at ${s.bz.toFixed(1)} nT. Speed without southward Bz means no aurora.`,
  trick_sheath: () => `CME sheath passage — temperature was anomalous and Bz fluctuated unpredictably. Sheath intervals look chaotic on instruments. Conditions were marginal at best.`,
};

function generateScenario(difficulty: number, roundIndex: number): Scenario {
  const moonPhase = Math.random();
  const moonIllumination = clamp((1 - Math.abs(moonPhase - 0.5) * 2) * 100, 0, 100);
  const moonUp = Math.random() > 0.45;

  const baseTypes: ScenarioType[] = ['quiet', 'building', 'active', 'substorm'];
  const trickTypes: ScenarioType[] = ['trick_moon', 'trick_northward', 'trick_speed_no_bz', 'trick_sheath'];
  const available: ScenarioType[] = difficulty >= 2
    ? [...baseTypes, ...trickTypes.slice(0, difficulty)]
    : baseTypes;
  const type = available[roundIndex % available.length];

  let bz: number, bt: number, speed: number, density: number, hp: number,
      southwardMinutes: number, bayOnset: boolean, cmeSheath: boolean;
  let moonIllFinal = moonIllumination;
  let moonUpFinal = moonUp;

  switch (type) {
    case 'quiet':
      bz = rand(0.5, 5); bt = rand(3, 8); speed = rand(280, 420);
      density = rand(2, 8); hp = rand(10, 60); southwardMinutes = 0;
      bayOnset = false; cmeSheath = false; break;
    case 'building':
      bz = rand(-6, -3); bt = rand(8, 14); speed = rand(420, 560);
      density = rand(4, 12); hp = rand(60, 130); southwardMinutes = randInt(3, 8);
      bayOnset = false; cmeSheath = false; break;
    case 'active':
      bz = rand(-18, -8); bt = rand(12, 22); speed = rand(500, 700);
      density = rand(5, 18); hp = rand(130, 250); southwardMinutes = randInt(15, 35);
      bayOnset = false; cmeSheath = false; break;
    case 'substorm':
      bz = rand(-22, -12); bt = rand(16, 28); speed = rand(550, 800);
      density = rand(8, 25); hp = rand(200, 350); southwardMinutes = randInt(20, 45);
      bayOnset = true; cmeSheath = false; break;
    case 'trick_moon':
      bz = rand(-14, -7); bt = rand(10, 18); speed = rand(460, 620);
      density = rand(5, 15); hp = rand(100, 200); southwardMinutes = randInt(10, 25);
      bayOnset = false; cmeSheath = false;
      moonIllFinal = rand(70, 100); moonUpFinal = true; break;
    case 'trick_northward':
      bz = rand(2, 8); bt = rand(8, 14); speed = rand(580, 780);
      density = rand(8, 20); hp = rand(30, 80); southwardMinutes = 0;
      bayOnset = false; cmeSheath = false; break;
    case 'trick_speed_no_bz':
      bz = rand(-2, 2); bt = rand(5, 10); speed = rand(650, 850);
      density = rand(10, 25); hp = rand(40, 90); southwardMinutes = randInt(0, 4);
      bayOnset = false; cmeSheath = false; break;
    case 'trick_sheath':
    default:
      bz = rand(-8, 6); bt = rand(14, 24); speed = rand(500, 720);
      density = rand(15, 35); hp = rand(80, 180); southwardMinutes = randInt(5, 15);
      bayOnset = false; cmeSheath = true; break;
  }

  const pressure = computePressure(density, speed);
  const partial: Scenario = {
    type, bz, bt, speed, density, pressure, hp,
    moonPhase, moonUp: moonUpFinal, moonIllumination: moonIllFinal,
    bzTrend: generateBzTrend(bz), southwardMinutes, bayOnset, cmeSheath,
    auroraScore: 0, correctAnswer: 'nothing', explanation: '',
  };
  partial.auroraScore = computeAuroraScore(partial);
  partial.correctAnswer = scoreToAnswer(partial.auroraScore);
  partial.explanation = EXPLANATIONS[type](partial);
  return partial;
}

function initStars(w: number, h: number): Star[] {
  return Array.from({ length: 280 }, () => ({
    x: Math.random() * w, y: Math.random() * h * 0.75,
    r: 0.4 + Math.random() * 1.3, twinkle: 0.3 + Math.random() * 0.7,
    phase: Math.random() * Math.PI * 2,
  }));
}

function initRays(score: number, w: number, horizonY: number): AuroraRay[] {
  if (score < 10) return [];
  const count = Math.floor(score / 8);
  return Array.from({ length: count }, (_, i) => ({
    x: (i / count) * w * 1.2 - w * 0.1 + rand(-40, 40),
    baseY: horizonY, height: rand(40, 60) + score * 2.2,
    width: rand(60, 120) + score * 1.5,
    hue: rand(130, 165), alpha: clamp(score / 100, 0, 0.85),
    speed: rand(0.003, 0.012), phase: Math.random() * Math.PI * 2,
  }));
}

function drawScene(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  stars: Star[], rays: AuroraRay[], scenario: Scenario | null,
  frame: number, showMoon: boolean,
) {
  const score = scenario?.auroraScore ?? 0;
  const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.75);
  skyGrad.addColorStop(0, '#020409');
  skyGrad.addColorStop(0.6, score > 50 ? `hsl(${195 + score * 0.3}, 28%, ${3 + score * 0.04}%)` : '#060c1a');
  skyGrad.addColorStop(1, '#0a1525');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, w, h);

  const horizonY = h * 0.62;

  if (showMoon && scenario?.moonUp) {
    const mx = w * 0.78, my = h * 0.18, mr = 18;
    const mb = scenario.moonIllumination / 100;
    const mg = ctx.createRadialGradient(mx, my, 0, mx, my, mr * 8);
    mg.addColorStop(0, `rgba(255,250,230,${mb * 0.15})`);
    mg.addColorStop(1, 'transparent');
    ctx.fillStyle = mg; ctx.fillRect(0, 0, w, h);
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,252,220,${0.6 + mb * 0.4})`; ctx.fill();
  }

  const moonDim = showMoon && scenario?.moonUp ? clamp(1 - (scenario.moonIllumination / 120), 0.15, 1) : 1;
  stars.forEach(star => {
    const t = star.twinkle * (0.7 + 0.3 * Math.sin(frame * 0.04 + star.phase));
    ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(220,235,255,${t * moonDim * 0.85})`; ctx.fill();
  });

  rays.forEach(ray => {
    ray.phase += ray.speed;
    const sway = Math.sin(ray.phase) * 30;
    const breathe = 0.85 + 0.15 * Math.sin(ray.phase * 0.7);
    const cx = ray.x + sway;
    const topY = ray.baseY - ray.height * breathe;
    const grad = ctx.createLinearGradient(cx, topY, cx, ray.baseY);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.15, `hsla(${ray.hue + 15},90%,75%,${ray.alpha * 0.3})`);
    grad.addColorStop(0.45, `hsla(${ray.hue},95%,65%,${ray.alpha * 0.8})`);
    grad.addColorStop(0.75, `hsla(${ray.hue - 10},100%,55%,${ray.alpha * 0.95})`);
    grad.addColorStop(1, `hsla(${ray.hue - 10},100%,45%,${ray.alpha * 0.4})`);
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.beginPath();
    ctx.moveTo(cx - ray.width / 2, ray.baseY);
    ctx.bezierCurveTo(cx - ray.width * 0.3, ray.baseY - ray.height * 0.4, cx + sway * 0.3, topY + ray.height * 0.2, cx, topY);
    ctx.bezierCurveTo(cx + ray.width * 0.15, topY + ray.height * 0.2, cx + ray.width * 0.3, ray.baseY - ray.height * 0.4, cx + ray.width / 2, ray.baseY);
    ctx.fillStyle = grad; ctx.fill(); ctx.restore();
  });

  if (score > 8) {
    const gi = clamp(score / 100, 0, 0.9);
    const hg = ctx.createLinearGradient(0, horizonY - 80, 0, horizonY + 30);
    hg.addColorStop(0, `hsla(150,90%,50%,${gi * 0.6})`);
    hg.addColorStop(0.5, `hsla(145,85%,40%,${gi * 0.3})`);
    hg.addColorStop(1, 'transparent');
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = hg; ctx.fillRect(0, horizonY - 80, w, 110); ctx.restore();
  }

  // Hill silhouette
  ctx.fillStyle = '#050d18';
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, horizonY + 18);
  ctx.bezierCurveTo(w * 0.05, horizonY + 5, w * 0.12, horizonY - 12, w * 0.18, horizonY + 2);
  ctx.bezierCurveTo(w * 0.22, horizonY + 10, w * 0.27, horizonY - 4, w * 0.34, horizonY - 8);
  ctx.bezierCurveTo(w * 0.40, horizonY - 12, w * 0.45, horizonY + 5, w * 0.52, horizonY + 3);
  ctx.bezierCurveTo(w * 0.57, horizonY + 1, w * 0.62, horizonY - 18, w * 0.68, horizonY - 6);
  ctx.bezierCurveTo(w * 0.72, horizonY + 2, w * 0.78, horizonY - 22, w * 0.85, horizonY - 10);
  ctx.bezierCurveTo(w * 0.90, horizonY - 2, w * 0.95, horizonY + 8, w, horizonY + 12);
  ctx.lineTo(w, h); ctx.closePath(); ctx.fill();

  // Lake reflection
  const lg = ctx.createLinearGradient(0, horizonY + 15, 0, horizonY + 55);
  lg.addColorStop(0, 'rgba(8,22,42,0.9)'); lg.addColorStop(1, 'rgba(5,12,25,0.95)');
  ctx.fillStyle = lg; ctx.beginPath();
  ctx.ellipse(w * 0.5, horizonY + 38, w * 0.38, 28, 0, 0, Math.PI * 2); ctx.fill();
  if (score > 15) {
    const ra = clamp(score / 100 * 0.5, 0, 0.5);
    const rg = ctx.createLinearGradient(0, horizonY + 15, 0, horizonY + 65);
    rg.addColorStop(0, `hsla(150,90%,50%,${ra})`); rg.addColorStop(1, 'transparent');
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = rg; ctx.beginPath();
    ctx.ellipse(w * 0.5, horizonY + 38, w * 0.38, 28, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }

  // Foreground scrub
  ctx.fillStyle = '#020810';
  ctx.beginPath(); ctx.moveTo(0, h); ctx.lineTo(0, h - 55);
  for (let x = 0; x <= w; x += 18) {
    ctx.lineTo(x, h - 48 + Math.sin(x * 0.15) * 8 + Math.cos(x * 0.22) * 5);
  }
  ctx.lineTo(w, h - 55); ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
}

const ANSWER_CONFIG: Record<VisibilityAnswer, { label: string; icon: string; colour: string }> = {
  nothing:     { label: 'Nothing visible',     icon: '😴', colour: '#64748b' },
  camera:      { label: 'Camera only',         icon: '📷', colour: '#38bdf8' },
  naked:       { label: 'Naked eye visible',   icon: '👁️', colour: '#34d399' },
  exceptional: { label: 'Exceptional display', icon: '🤩', colour: '#fbbf24' },
};

const DIFF_NAMES = ['Rookie', 'Observer', 'Forecaster', 'Expert'];

const SpotTheAuroraGame: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const frameRef = useRef(0);
  const starsRef = useRef<Star[]>([]);
  const raysRef = useRef<AuroraRay[]>([]);
  const scenarioRef = useRef<Scenario | null>(null);

  const [phase, setPhase] = useState<GamePhase>('menu');
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(() => Number(localStorage.getItem('sta_best_streak') || '0'));
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem('sta_high_score') || '0'));
  const [round, setRound] = useState(0);
  const [difficulty, setDifficulty] = useState(0);
  const [playerAnswer, setPlayerAnswer] = useState<VisibilityAnswer | null>(null);
  const [isCorrect, setIsCorrect] = useState(false);
  const [observeTimer, setObserveTimer] = useState(8);
  const [roundScores, setRoundScores] = useState<number[]>([]);
  const [currentScore, setCurrentScore] = useState(0);
  const TOTAL_ROUNDS = 8;

  // Keep scenarioRef in sync so the canvas loop can read it without stale closure
  useEffect(() => { scenarioRef.current = scenario; }, [scenario]);

  // Observe timer
  useEffect(() => {
    if (phase !== 'observing') return;
    if (observeTimer <= 0) { setPhase('answering'); return; }
    const t = setTimeout(() => setObserveTimer(v => v - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, observeTimer]);

  // Canvas loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      starsRef.current = initStars(canvas.width, canvas.height);
      const s = scenarioRef.current;
      if (s) raysRef.current = initRays(s.auroraScore, canvas.width, canvas.height * 0.62);
    };
    resize();
    window.addEventListener('resize', resize);

    const loop = () => {
      frameRef.current++;
      const { width, height } = canvas;
      const s = scenarioRef.current;
      const showMoon = phase !== 'menu';

      if (!s) {
        // Menu — demo quiet sky
        ctx.fillStyle = '#060c1a'; ctx.fillRect(0, 0, width, height);
        if (!starsRef.current.length) starsRef.current = initStars(width, height);
        starsRef.current.forEach(star => {
          const t = star.twinkle * (0.6 + 0.4 * Math.sin(frameRef.current * 0.035 + star.phase));
          ctx.beginPath(); ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(220,235,255,${t * 0.7})`; ctx.fill();
        });
        // Demo horizon glow
        const horizY = height * 0.62;
        const demoGlow = ctx.createLinearGradient(0, horizY - 60, 0, horizY + 20);
        demoGlow.addColorStop(0, 'hsla(150,90%,50%,0.25)');
        demoGlow.addColorStop(1, 'transparent');
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = demoGlow; ctx.fillRect(0, horizY - 60, width, 80); ctx.restore();
        // Hills
        ctx.fillStyle = '#050d18'; ctx.beginPath(); ctx.moveTo(0, height); ctx.lineTo(0, horizY + 18);
        ctx.bezierCurveTo(width * 0.12, horizY - 10, width * 0.28, horizY - 6, width * 0.38, horizY + 2);
        ctx.bezierCurveTo(width * 0.48, horizY + 8, width * 0.58, horizY - 14, width * 0.70, horizY - 5);
        ctx.bezierCurveTo(width * 0.80, horizY + 2, width * 0.90, horizY - 18, width, horizY + 12);
        ctx.lineTo(width, height); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#020810'; ctx.beginPath(); ctx.moveTo(0, height); ctx.lineTo(0, height - 50);
        for (let x = 0; x <= width; x += 18) ctx.lineTo(x, height - 44 + Math.sin(x * 0.15) * 7 + Math.cos(x * 0.22) * 4);
        ctx.lineTo(width, height - 50); ctx.lineTo(width, height); ctx.closePath(); ctx.fill();
      } else {
        drawScene(ctx, width, height, starsRef.current, raysRef.current, s, frameRef.current, showMoon);
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
    return () => { window.removeEventListener('resize', resize); cancelAnimationFrame(rafRef.current); };
  }, [phase]);

  const loadScenario = useCallback((diff: number, roundIdx: number) => {
    const s = generateScenario(diff, roundIdx);
    setScenario(s);
    scenarioRef.current = s;
    const cw = canvasRef.current?.width ?? 400;
    const ch = canvasRef.current?.height ?? 300;
    raysRef.current = initRays(s.auroraScore, cw, ch * 0.62);
    return s;
  }, []);

  const startGame = useCallback((diff: number) => {
    setDifficulty(diff);
    setScore(0); setCurrentScore(0);
    setStreak(0); setRound(0); setRoundScores([]);
    loadScenario(diff, 0);
    setObserveTimer(8);
    setPhase('observing');
  }, [loadScenario]);

  const submitAnswer = useCallback((answer: VisibilityAnswer) => {
    if (!scenario || phase !== 'answering') return;
    setPlayerAnswer(answer);
    const correct = answer === scenario.correctAnswer;
    setIsCorrect(correct);
    const pts = correct ? Math.round(50 + streak * 15 + difficulty * 10) : 0;
    setRoundScores(prev => [...prev, pts > 0 ? pts : 0]);
    setCurrentScore(prev => prev + pts);
    setScore(prev => prev + pts);
    if (correct) {
      setStreak(prev => {
        const ns = prev + 1;
        if (ns > bestStreak) { setBestStreak(ns); localStorage.setItem('sta_best_streak', ns.toString()); }
        return ns;
      });
    } else { setStreak(0); }
    setPhase('feedback');
  }, [scenario, phase, streak, difficulty, bestStreak]);

  const nextRound = useCallback(() => {
    const nextIdx = round + 1;
    if (nextIdx >= TOTAL_ROUNDS) {
      if (currentScore > highScore) { setHighScore(currentScore); localStorage.setItem('sta_high_score', currentScore.toString()); }
      setPhase('gameover');
      return;
    }
    setRound(nextIdx);
    setPlayerAnswer(null);
    loadScenario(difficulty, nextIdx);
    setObserveTimer(8);
    setPhase('observing');
  }, [round, TOTAL_ROUNDS, currentScore, highScore, difficulty, loadScenario]);

  const bzColour = (bz: number) => bz < -10 ? '#34d399' : bz < -4 ? '#fbbf24' : bz > 0 ? '#f87171' : '#d4d4d4';

  const BzSpark: React.FC<{ trend: number[] }> = ({ trend }) => {
    const w = 72, h = 24;
    const min = Math.min(...trend, -2), max = Math.max(...trend, 2);
    const range = max - min || 1;
    const pts = trend.map((v, i) => `${(i / (trend.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ');
    const zeroY = h - ((0 - min) / range) * h;
    return (
      <svg width={w} height={h} className="overflow-visible flex-shrink-0">
        <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth={1} strokeDasharray="2,2" />
        <polyline points={pts} fill="none" stroke="#34d399" strokeWidth={1.5} strokeLinejoin="round" />
        <circle cx={(trend.length - 1) / (trend.length - 1) * w} cy={h - ((trend[trend.length - 1] - min) / range) * h} r={2.5} fill="#34d399" />
      </svg>
    );
  };

  const Stat: React.FC<{ label: string; value: string; sub?: string; accent?: string; trend?: number[] }> = ({ label, value, sub, accent, trend }) => (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] font-bold text-neutral-600 uppercase tracking-widest">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[13px] font-bold tabular-nums leading-none" style={{ color: accent || '#d4d4d4' }}>{value}</span>
        {trend && <BzSpark trend={trend} />}
      </div>
      {sub && <span className="text-[10px] text-neutral-600 leading-none">{sub}</span>}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[4000] flex flex-col" style={{ background: '#060c1a' }}>
      {/* Canvas */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ display: 'block' }} />

        {/* Close button */}
        <button onClick={onClose} className="absolute top-3 right-3 z-20 p-1.5 rounded-full bg-black/60 text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
          <CloseIcon className="w-5 h-5" />
        </button>

        {/* ── MENU ── */}
        {phase === 'menu' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center z-10 px-4">
            <div className="bg-black/75 backdrop-blur-md border border-white/10 rounded-2xl p-7 max-w-sm w-full text-center shadow-2xl">
              <div className="text-4xl mb-2">🌌</div>
              <h1 className="text-2xl font-extrabold text-white mb-1 tracking-tight">Spot The Aurora</h1>
              <p className="text-neutral-400 text-sm mb-6 leading-relaxed">Read the space weather data. Decide what you'd see in the sky. Learn to forecast like a pro.</p>
              <div className="space-y-2 mb-5">
                {DIFF_NAMES.map((name, i) => {
                  const colours = ['#34d399','#38bdf8','#fbbf24','#f87171'];
                  const subs = ['learn the basics','moon & HP factors','trick scenarios','full chaos'];
                  return (
                    <button key={i} onClick={() => startGame(i)}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all active:scale-95 border"
                      style={{ background: `${colours[i]}15`, borderColor: `${colours[i]}30`, color: colours[i] }}>
                      {name} <span className="opacity-50 text-xs">— {subs[i]}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-center gap-5 text-xs text-neutral-500">
                <span>Best streak: <span className="text-amber-400 font-bold">{bestStreak}</span></span>
                <span>High score: <span className="text-sky-400 font-bold">{highScore}</span></span>
              </div>
            </div>
          </div>
        )}

        {/* ── OBSERVE — top HUD ── */}
        {phase === 'observing' && (
          <div className="absolute top-3 left-3 right-12 z-10 flex items-center gap-2 flex-wrap">
            <div className="bg-black/70 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1 flex items-center gap-2">
              <span className="text-xs text-neutral-400">Study the sky</span>
              <span className="text-sm font-bold text-white tabular-nums w-4 text-center">{observeTimer}</span>
            </div>
            <div className="bg-black/70 backdrop-blur-sm border border-white/10 rounded-full px-3 py-1 text-xs text-neutral-400">
              {round + 1} / {TOTAL_ROUNDS}
            </div>
            {streak > 1 && (
              <div className="bg-amber-500/20 border border-amber-500/30 rounded-full px-3 py-1 text-xs text-amber-400 font-bold">
                🔥 {streak} streak
              </div>
            )}
            <div className="ml-auto bg-black/70 border border-white/10 rounded-full px-3 py-1 text-xs text-sky-400 font-bold tabular-nums">
              {currentScore} pts
            </div>
          </div>
        )}

        {/* ── ANSWERING ── */}
        {phase === 'answering' && (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 z-10 flex justify-center">
            <div className="bg-black/80 backdrop-blur-md border border-white/10 rounded-2xl p-5 max-w-xs w-full shadow-2xl">
              <p className="text-center text-sm font-semibold text-white mb-4">What would you see outside right now?</p>
              <div className="grid grid-cols-2 gap-2">
                {(Object.entries(ANSWER_CONFIG) as [VisibilityAnswer, typeof ANSWER_CONFIG[VisibilityAnswer]][]).map(([key, cfg]) => (
                  <button key={key} onClick={() => submitAnswer(key)}
                    className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border transition-all active:scale-95 hover:brightness-110"
                    style={{ background: `${cfg.colour}15`, borderColor: `${cfg.colour}30` }}>
                    <span className="text-xl">{cfg.icon}</span>
                    <span className="text-xs font-semibold text-center leading-tight" style={{ color: cfg.colour }}>{cfg.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── FEEDBACK ── */}
        {phase === 'feedback' && scenario && (
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 z-10 flex justify-center">
            <div className="bg-black/85 backdrop-blur-md border border-white/10 rounded-2xl p-5 max-w-sm w-full shadow-2xl">
              <div className="flex items-start gap-3 mb-3">
                <span className="text-2xl flex-shrink-0">{isCorrect ? '✅' : '❌'}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm">{isCorrect ? 'Correct!' : 'Not quite'}</p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Answer: <span className="font-semibold" style={{ color: ANSWER_CONFIG[scenario.correctAnswer].colour }}>
                      {ANSWER_CONFIG[scenario.correctAnswer].icon} {ANSWER_CONFIG[scenario.correctAnswer].label}
                    </span>
                  </p>
                </div>
                {isCorrect && (
                  <span className="text-sm font-black text-amber-400 flex-shrink-0">
                    +{50 + (streak > 0 ? (streak - 1) * 15 : 0) + difficulty * 10}
                  </span>
                )}
              </div>
              <p className="text-xs text-neutral-300 leading-relaxed mb-3 border-l-2 border-sky-500/40 pl-3 italic">
                {scenario.explanation}
              </p>
              <div className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-1.5 mb-3">
                <span className="text-xs text-neutral-500">Aurora score this round</span>
                <span className="text-sm font-bold" style={{ color: ANSWER_CONFIG[scenario.correctAnswer].colour }}>
                  {scenario.auroraScore.toFixed(0)} / 100
                </span>
              </div>
              <button onClick={nextRound}
                className="w-full py-2.5 rounded-xl text-sm font-bold text-white bg-sky-500/20 border border-sky-500/35 hover:bg-sky-500/30 transition-colors active:scale-95">
                {round + 1 >= TOTAL_ROUNDS ? 'See Results →' : 'Next Round →'}
              </button>
            </div>
          </div>
        )}

        {/* ── GAME OVER ── */}
        {phase === 'gameover' && (
          <div className="absolute inset-0 flex items-center justify-center z-10 px-4">
            <div className="bg-black/85 backdrop-blur-md border border-white/10 rounded-2xl p-7 max-w-sm w-full text-center shadow-2xl">
              <div className="text-4xl mb-2">🌌</div>
              <h2 className="text-xl font-extrabold text-white mb-1">Round complete!</h2>
              <p className="text-neutral-500 text-xs mb-4">{DIFF_NAMES[difficulty]} · {TOTAL_ROUNDS} rounds</p>
              <div className="text-4xl font-black mb-0.5" style={{ color: '#38bdf8' }}>{currentScore}</div>
              <p className="text-xs text-neutral-500 mb-5">{currentScore >= highScore && currentScore > 0 ? '🏆 New high score!' : `High score: ${highScore}`}</p>
              <div className="flex gap-1.5 justify-center mb-4">
                {roundScores.map((pts, i) => (
                  <div key={i} className="w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center"
                    style={{ background: pts > 0 ? 'rgba(52,211,153,0.18)' : 'rgba(248,113,113,0.15)', color: pts > 0 ? '#34d399' : '#f87171' }}>
                    {pts > 0 ? '✓' : '✗'}
                  </div>
                ))}
              </div>
              <div className="flex justify-center gap-5 text-xs text-neutral-500 mb-5">
                <span>Final streak: <span className="text-amber-400 font-bold">{streak}</span></span>
                <span>Best ever: <span className="text-amber-400 font-bold">{bestStreak}</span></span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setScenario(null); scenarioRef.current = null; setPhase('menu'); }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-neutral-300 bg-white/5 border border-white/10 hover:bg-white/10 transition-colors">
                  Menu
                </button>
                <button onClick={() => startGame(difficulty)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-sky-500/20 border border-sky-500/35 hover:bg-sky-500/30 transition-colors">
                  Play again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── DASHBOARD ── */}
      {scenario && (phase === 'observing' || phase === 'answering') && (
        <div className="flex-shrink-0 bg-black/92 border-t border-white/6 px-4 py-3" style={{ minHeight: '148px' }}>
          <div className="max-w-2xl mx-auto h-full grid grid-rows-2 gap-y-3">
            {/* Row 1 */}
            <div className="grid grid-cols-4 gap-4">
              <Stat label="Bz" value={`${scenario.bz > 0 ? '+' : ''}${scenario.bz.toFixed(1)} nT`}
                sub={scenario.bz < -3 ? '↓ southward' : scenario.bz > 3 ? '↑ northward' : '≈ flat'}
                accent={bzColour(scenario.bz)} trend={scenario.bzTrend} />
              <Stat label="Solar Wind Speed" value={`${scenario.speed.toFixed(0)} km/s`}
                sub={scenario.speed > 600 ? 'fast' : scenario.speed > 450 ? 'moderate' : 'slow'}
                accent={scenario.speed > 600 ? '#fbbf24' : '#d4d4d4'} />
              <Stat label="Bt Total" value={`${scenario.bt.toFixed(1)} nT`} sub="total field strength" />
              <Stat label="Density / Pressure" value={`${scenario.density.toFixed(1)} p/cm³`}
                sub={`${scenario.pressure.toFixed(1)} nPa`} />
            </div>
            {/* Row 2 */}
            <div className="grid grid-cols-4 gap-4">
              <Stat label="Hemispheric Power" value={`${scenario.hp.toFixed(0)} GW`}
                sub={scenario.hp > 200 ? 'high' : scenario.hp > 100 ? 'moderate' : 'low'}
                accent={scenario.hp > 200 ? '#34d399' : scenario.hp > 100 ? '#38bdf8' : '#737373'} />
              <Stat label="Moon" value={`${scenario.moonIllumination.toFixed(0)}%`}
                sub={scenario.moonUp ? 'above horizon' : 'below horizon'}
                accent={scenario.moonUp && scenario.moonIllumination > 60 ? '#f87171' : '#d4d4d4'} />
              <Stat label="Bz Southward For" value={`${scenario.southwardMinutes} min`}
                accent={scenario.southwardMinutes > 20 ? '#34d399' : scenario.southwardMinutes > 8 ? '#fbbf24' : '#737373'} />
              <Stat label="Alerts"
                value={scenario.bayOnset ? '⚡ Bay onset' : scenario.cmeSheath ? '💥 CME sheath' : '— None'}
                accent={scenario.bayOnset ? '#fbbf24' : scenario.cmeSheath ? '#f87171' : '#525252'} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SpotTheAuroraGame;
// --- END OF FILE ---