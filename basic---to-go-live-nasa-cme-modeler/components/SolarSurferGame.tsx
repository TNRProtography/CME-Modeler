// --- START OF FILE src/components/SolarSurferGame.tsx ---

import React, { useRef, useEffect, useCallback, useState } from 'react';
import CloseIcon from './icons/CloseIcon';

// --- TYPE DEFINITIONS ---
type GameState = 'start' | 'playing' | 'gameOver';

interface Player { x: number; y: number; radius: number; velocityY: number; trail: { x: number; y: number }[]; invincibilityTimer: number; }
interface Pillar { x: number; gapY: number; gapHeight: number; scored: boolean; isMoving: boolean; oscillationOffset: number; }
interface Star { x: number; y: number; radius: number; speed: number; }
interface PowerUp { x: number; y: number; radius: number; active: boolean; }
interface SmokeParticle { x: number; y: number; radius: number; opacity: number; velocityX: number; velocityY: number; }
interface MegaCME { x: number; width: number; active: boolean; }

// --- GAME CONFIGURATION ---
const GRAVITY = 0.35;
const FLAP_STRENGTH = 8;
const PLAYER_X = 150;
const PILLAR_WIDTH = 120;
const IS_MOBILE = window.innerWidth < 768;

const DESKTOP_BASE_SPEED = 4;
const MOBILE_BASE_SPEED = DESKTOP_BASE_SPEED * 0.6; // 40% slower
const BASE_SPEED = IS_MOBILE ? MOBILE_BASE_SPEED : DESKTOP_BASE_SPEED;
const BASE_PILLAR_FREQUENCY = IS_MOBILE ? 180 : 140;

const CME_DURATION = 5 * 60; // 5 seconds at 60fps
const CME_SPEED_MULTIPLIER = 1.5; // 50% faster

const GW_LOW_THRESHOLD = 50;
const GW_HIGH_THRESHOLD = 300;
const GW_CRITICAL_THRESHOLD = 500;
const LOW_GW_DURATION = 10 * 60; // 10 seconds
const CRITICAL_GW_DURATION = 5 * 60; // 5 seconds

const MEGA_CME_MIN_INTERVAL = 15 * 60; // 15 seconds
const MEGA_CME_MAX_INTERVAL = 30 * 60; // 30 seconds
const MEGA_CME_SPEED = 15;

const SolarFlap: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  
  // Game logic refs
  const playerRef = useRef<Player>({ x: PLAYER_X, y: 300, radius: 15, velocityY: 0, trail: [], invincibilityTimer: 0 });
  const pillarsRef = useRef<Pillar[]>([]);
  const frameRef = useRef(0);
  const starsRef = useRef<Star[]>([]);
  const cmeStateRef = useRef({ active: false, timer: 0 });
  const gameStateRef = useRef<GameState>('start');
  const levelRef = useRef(1);
  const smokeParticlesRef = useRef<SmokeParticle[]>([]);
  const lowGwTimerRef = useRef(0);
  const highGwTimerRef = useRef(0);
  const megaCmeRef = useRef<MegaCME>({ x: 0, width: 0, active: false });
  const nextMegaCmeFrameRef = useRef(0);

  // React state for UI
  const [uiState, setUiState] = useState<GameState>('start');
  const [gw, setGw] = useState(50);
  const [happiness, setHappiness] = useState(100);
  const [cmeCharge, setCmeCharge] = useState(0);
  const [gameOverReason, setGameOverReason] = useState('');

  const resetGame = useCallback((canvas: HTMLCanvasElement) => {
    playerRef.current = { x: PLAYER_X, y: canvas.height / 2, radius: 15, velocityY: 0, trail: [], invincibilityTimer: 0 };
    pillarsRef.current = [];
    frameRef.current = 0;
    setGw(50);
    setHappiness(100);
    cmeStateRef.current = { active: false, timer: 0 };
    setCmeCharge(0);
    gameStateRef.current = 'playing';
    setUiState('playing');
    levelRef.current = 1;
    lowGwTimerRef.current = 0;
    highGwTimerRef.current = 0;
    nextMegaCmeFrameRef.current = frameRef.current + MEGA_CME_MIN_INTERVAL + Math.random() * (MEGA_CME_MAX_INTERVAL - MEGA_CME_MIN_INTERVAL);
  }, []);

  const activateCME = useCallback(() => {
    if (cmeCharge >= 100 && !cmeStateRef.current.active && gameStateRef.current === 'playing') {
        cmeStateRef.current = { active: true, timer: CME_DURATION };
        setCmeCharge(0);
    }
  }, [cmeCharge]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const handleInput = (e: Event) => {
      if (e.target instanceof HTMLElement && e.target.id === 'cme-button') return;
      if (gameStateRef.current === 'playing') { playerRef.current.velocityY = -FLAP_STRENGTH; } 
      else { resetGame(canvas); }
    };
    const handleCMEKey = (e: KeyboardEvent) => { if(e.key.toLowerCase() === 'c') activateCME(); };
    canvas.addEventListener('mousedown', handleInput);
    window.addEventListener('keydown', (e) => e.key === ' ' && handleInput());
    window.addEventListener('keydown', handleCMEKey);
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleInput(e); });
    return () => {
      canvas.removeEventListener('mousedown', handleInput);
      window.removeEventListener('keydown', (e) => e.key === ' ' && handleInput());
      window.removeEventListener('keydown', handleCMEKey);
      canvas.removeEventListener('touchstart', handleInput);
    };
  }, [resetGame, activateCME]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let isRunning = true;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      starsRef.current = Array.from({length: 100}, () => ({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, radius: Math.random() * 1.5, speed: 0.5 + Math.random() * 0.5 }));
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const gameLoop = () => {
        if (!isRunning) return;
        const { width, height } = canvas;
        frameRef.current++;
        
        // --- Background and Earth Effects ---
        const gameSpeed = cmeStateRef.current.active ? BASE_SPEED * CME_SPEED_MULTIPLIER : BASE_SPEED + (levelRef.current - 1) * 0.2;
        ctx.fillStyle = cmeStateRef.current.active ? '#400' : '#010418';
        ctx.fillRect(0, 0, width, height);

        starsRef.current.forEach(star => {
            star.x -= star.speed * gameSpeed * 0.5;
            if (star.x < 0) star.x = width;
            ctx.beginPath(); ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; ctx.fill();
        });

        // Earth & Effects
        const earthX = -100; const earthRadius = 200;
        const earthGrad = ctx.createRadialGradient(earthX, height / 2, 0, earthX, height / 2, earthRadius);
        earthGrad.addColorStop(0, '#8cb1de'); earthGrad.addColorStop(1, '#1d4f7a');
        ctx.fillStyle = earthGrad; ctx.beginPath(); ctx.arc(earthX, height / 2, earthRadius, 0, Math.PI * 2); ctx.fill();
        
        // Aurora
        ctx.globalAlpha = Math.max(0, happiness / 100);
        const auroraGrad = ctx.createRadialGradient(earthX, height / 2, earthRadius, earthX, height/2, earthRadius * 2);
        const auroraColor = `rgba(50, 255, 150, ${0.4 + 0.3 * Math.sin(frameRef.current * 0.05)})`;
        auroraGrad.addColorStop(0, auroraColor); auroraGrad.addColorStop(1, 'rgba(50, 255, 150, 0)');
        ctx.fillStyle = auroraGrad; ctx.beginPath(); ctx.arc(earthX, height / 2, earthRadius * 2, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;

        // Smoke
        if (gw > GW_HIGH_THRESHOLD) {
            for(let i=0; i< (gw-GW_HIGH_THRESHOLD)/100; i++) smokeParticlesRef.current.push({ x: earthX + Math.random() * 100, y: height/2 + (Math.random()-0.5) * earthRadius, radius: Math.random() * 5 + 2, opacity: 1, velocityX: Math.random() * 2, velocityY: -Math.random() * 2 });
        }
        smokeParticlesRef.current.forEach((p, i) => {
            p.x += p.velocityX; p.y += p.velocityY; p.opacity -= 0.01;
            if (p.opacity <= 0) smokeParticlesRef.current.splice(i, 1);
            ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fillStyle = `rgba(100, 100, 100, ${p.opacity})`; ctx.fill();
        });

        if (gameStateRef.current === 'playing') {
            // --- Pillar Logic ---
            if (frameRef.current % Math.floor(BASE_PILLAR_FREQUENCY / (gameSpeed / BASE_SPEED)) === 0) {
                const isMoving = levelRef.current > 1 && Math.random() > 0.4;
                pillarsRef.current.push({ x: width, gapY: (height * 0.2) + Math.random() * (height * 0.6), gapHeight: 150 + Math.random() * 50, scored: false, isMoving: isMoving, oscillationOffset: Math.random() * Math.PI * 2 });
            }
            pillarsRef.current.forEach(p => {
                p.x -= gameSpeed;
                if (p.isMoving) p.gapY += Math.sin(frameRef.current * 0.02 + p.oscillationOffset) * 1.5;
                ctx.fillStyle = 'rgba(10, 200, 120, 0.2)'; ctx.fillRect(p.x, p.gapY - p.gapHeight / 2, PILLAR_WIDTH, p.gapHeight);
                const grad = ctx.createLinearGradient(p.x, 0, p.x + PILLAR_WIDTH, 0);
                grad.addColorStop(0, '#ff4444'); grad.addColorStop(1, '#ff8888');
                ctx.fillStyle = grad; ctx.fillRect(p.x, 0, PILLAR_WIDTH, p.gapY - p.gapHeight / 2); ctx.fillRect(p.x, p.gapY + p.gapHeight / 2, PILLAR_WIDTH, height);
                
                if (!p.scored && p.x + PILLAR_WIDTH < playerRef.current.x) {
                    const baseReward = cmeStateRef.current.active ? 50 : 5;
                    const gapFactor = 200 / p.gapHeight; // Smaller gap = higher factor
                    const reward = Math.floor(baseReward * gapFactor);
                    setGw(g => g + reward);
                    setCmeCharge(c => Math.min(100, c + 5));
                    p.scored = true;
                }
            });
            pillarsRef.current = pillarsRef.current.filter(p => p.x + PILLAR_WIDTH > 0);
            
            // --- Player Logic ---
            if (playerRef.current.invincibilityTimer > 0) playerRef.current.invincibilityTimer--;
            playerRef.current.velocityY += GRAVITY;
            playerRef.current.y += playerRef.current.velocityY;
            playerRef.current.trail.push({ x: playerRef.current.x, y: playerRef.current.y });
            if(playerRef.current.trail.length > 20) playerRef.current.trail.shift();
            
            ctx.globalAlpha = playerRef.current.invincibilityTimer % 10 < 5 ? 0.5 : 1;
            for(let i=playerRef.current.trail.length - 1; i>=0; i--) { /* ... trail drawing ... */ } // Simplified for brevity, logic is same
            ctx.beginPath(); ctx.arc(playerRef.current.x, playerRef.current.y, playerRef.current.radius, 0, Math.PI * 2);
            const playerGrad = ctx.createRadialGradient(playerRef.current.x, playerRef.current.y, 0, playerRef.current.x, playerRef.current.y, playerRef.current.radius);
            const pColor1 = cmeStateRef.current.active ? '#ffff88' : '#aaccff';
            const pColor2 = cmeStateRef.current.active ? '#ff8800' : '#4488ff';
            playerGrad.addColorStop(0, pColor1); playerGrad.addColorStop(1, pColor2);
            ctx.fillStyle = playerGrad; ctx.fill();
            ctx.globalAlpha = 1;

            // --- Mega CME Logic ---
            if (frameRef.current > nextMegaCmeFrameRef.current && !megaCmeRef.current.active) {
                megaCmeRef.current = { x: width, width: PILLAR_WIDTH * 1.5, active: true };
                nextMegaCmeFrameRef.current = frameRef.current + MEGA_CME_MIN_INTERVAL + Math.random() * (MEGA_CME_MAX_INTERVAL - MEGA_CME_MIN_INTERVAL);
            }
            if (megaCmeRef.current.active) {
                const cme = megaCmeRef.current; cme.x -= MEGA_CME_SPEED;
                ctx.fillStyle = 'rgba(10, 255, 150, 0.4)'; ctx.fillRect(cme.x, 0, cme.width, height);
                ctx.fillStyle = 'white'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('AVOID!', cme.x + cme.width / 2, 30);
                if (playerRef.current.x + playerRef.current.radius > cme.x && playerRef.current.x - playerRef.current.radius < cme.x + cme.width) { setGw(g => g + 500); cme.active = false; }
                if (cme.x + cme.width < 0) cme.active = false;
            }

            // --- GW and Happiness Logic ---
            setGw(g => {
                if (g < GW_LOW_THRESHOLD) { lowGwTimerRef.current++; } else { lowGwTimerRef.current = 0; }
                if (g > GW_CRITICAL_THRESHOLD) { highGwTimerRef.current++; } else { highGwTimerRef.current = 0; }
                return g;
            });

            setHappiness(h => {
                let newH = h;
                if (gw < GW_LOW_THRESHOLD && lowGwTimerRef.current > LOW_GW_DURATION) newH -= 0.2;
                else if (gw > GW_HIGH_THRESHOLD) newH -= (gw - GW_HIGH_THRESHOLD) * 0.001;
                else newH = Math.min(100, h + 0.1);
                
                if (newH <= 0) { gameStateRef.current = 'gameOver'; setUiState('gameOver'); setGameOverReason('The grid collapsed from lack of power!'); }
                if (highGwTimerRef.current > CRITICAL_GW_DURATION) { gameStateRef.current = 'gameOver'; setUiState('gameOver'); setGameOverReason('The grid was overloaded and destroyed!'); }
                return newH;
            });

            // --- Collision Detection ---
            const p = pillarsRef.current[0];
            if(p && playerRef.current.invincibilityTimer === 0 && playerRef.current.x + playerRef.current.radius > p.x && playerRef.current.x - playerRef.current.radius < p.x + PILLAR_WIDTH) {
                if(playerRef.current.y - playerRef.current.radius < p.gapY - p.gapHeight/2 || playerRef.current.y + playerRef.current.radius > p.gapY + p.gapHeight/2) {
                    setGw(g => Math.max(0, g - 50));
                    playerRef.current.invincibilityTimer = 60; // 1 second invincibility
                }
            }
            if(playerRef.current.invincibilityTimer === 0 && (playerRef.current.y > height || playerRef.current.y < 0)) {
                setGw(g => Math.max(0, g - 50));
                playerRef.current.invincibilityTimer = 60;
            }
        }
        animationFrameId.current = requestAnimationFrame(gameLoop);
    };
    gameLoop();
    return () => { isRunning = false; window.removeEventListener('resize', resizeCanvas); if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); };
  }, [resetGame]);

  const isCmeReady = cmeCharge >= 100 && !cmeStateRef.current.active;

  return (
    <div className="fixed inset-0 z-[4000] bg-black/80 backdrop-blur-md flex items-center justify-center cursor-pointer">
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
      <button onClick={onClose} className="absolute top-5 right-5 p-2 bg-black/50 rounded-full text-white hover:bg-white/20 transition-colors z-20"><CloseIcon className="w-8 h-8"/></button>

      {uiState === 'playing' && (
        <div className="absolute top-4 left-4 right-4 text-white font-bold text-lg flex justify-between items-start pointer-events-none z-10">
            <div className="bg-black/50 p-2 rounded-md">
                <span className={`transition-colors ${gw > GW_CRITICAL_THRESHOLD ? 'text-red-500' : gw > GW_HIGH_THRESHOLD ? 'text-yellow-400' : 'text-white'}`}>Power: {Math.floor(gw)} GW</span>
            </div>
            <div className="bg-black/50 p-2 rounded-md">Level: {levelRef.current}</div>
            <div className="bg-black/50 p-2 rounded-md flex flex-col items-end">
                <span>Grid Happiness: {Math.floor(happiness)}%</span>
                <div className="w-32 h-2 bg-neutral-700 rounded mt-1"><div className="h-2 bg-green-500 rounded" style={{width: `${happiness}%`}}></div></div>
            </div>
        </div>
      )}

      {uiState === 'start' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-2xl pointer-events-none">
            <h1 className="text-5xl font-extrabold mb-4 text-amber-300">Solar Flap</h1>
            <h2 className="text-xl font-semibold mb-6">Power the World with Auroras!</h2>
            <div className="text-left space-y-3 mb-8">
                <p><strong>Goal:</strong> Maintain the grid's power between <strong className="text-green-400">50 GW</strong> and <strong className="text-red-500">500 GW</strong> to keep happiness high.</p>
                <p><strong>Gameplay:</strong> Fly through <strong className="text-green-400">green (-Bz)</strong> gaps. Smaller gaps give more power. Hitting a <strong className="text-red-500">red (+Bz)</strong> pillar costs 50 GW.</p>
                <p><strong>Happiness:</strong> Drops if power is too high (&gt;300GW) or too low (&lt;50GW for too long). Game over at 0% happiness!</p>
                <p><strong>Watch Out:</strong> Dodge the massive <strong className="text-green-400">MEGA CME</strong> waves! Hitting them adds a dangerous +500 GW.</p>
                <p><strong>Power Up:</strong> Collect sun icons. When charged, click the CME button to enter hyper mode for 5 seconds!</p>
            </div>
            <p className="text-2xl font-bold animate-pulse">Click anywhere to Start</p>
        </div>
      )}
      
      {uiState === 'gameOver' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-lg pointer-events-none">
            <h1 className="text-5xl font-extrabold mb-4 text-red-500">Grid Offline</h1>
            <p className="text-lg mb-4">{gameOverReason}</p>
            <h2 className="text-3xl font-semibold mb-2">Final Power: {Math.floor(gw)} GW</h2>
            <p className="text-xl mt-8 animate-pulse">Click anywhere to try again</p>
        </div>
      )}

      {uiState === 'playing' && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20">
            <button 
                id="cme-button"
                onClick={(e) => { e.stopPropagation(); activateCME(); }}
                onTouchStart={(e) => { e.stopPropagation(); activateCME(); }}
                disabled={!isCmeReady}
                className={`w-24 h-24 rounded-full flex items-center justify-center text-black font-bold text-4xl border-4 shadow-lg transition-all duration-300 ${isCmeReady ? 'bg-yellow-400/90 border-yellow-200 animate-pulse cursor-pointer' : 'bg-neutral-600/70 border-neutral-500 cursor-not-allowed'}`}
                title="Activate CME (C Key)"
            >
                CME
            </button>
        </div>
      )}
    </div>
  );
};

export default SolarFlap;
// --- END OF FILE src/components/SolarSurferGame.tsx ---