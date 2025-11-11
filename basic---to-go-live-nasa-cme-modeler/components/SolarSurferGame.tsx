// --- START OF FILE src/components/SolarSurferGame.tsx ---

import React, { useRef, useEffect, useCallback, useState } from 'react';
import CloseIcon from './icons/CloseIcon';

// --- TYPE DEFINITIONS ---
type GameState = 'start' | 'playing' | 'gameOver';

interface Player {
  x: number;
  y: number;
  radius: number;
  velocityY: number;
  trail: { x: number; y: number }[];
}

interface Pillar {
  x: number;
  gapY: number; // Center of the gap
  gapHeight: number;
  scored: boolean;
}

interface Star {
  x: number;
  y: number;
  radius: number;
  speed: number;
}

interface PowerUp {
    x: number;
    y: number;
    radius: number;
    active: boolean;
}

// --- GAME CONFIGURATION ---
const GRAVITY = 0.3;
const FLAP_STRENGTH = 7;
const PLAYER_X = 150;
const PILLAR_WIDTH = 100;
const INITIAL_PILLAR_FREQUENCY = 180; // frames between pillars
const INITIAL_GAME_SPEED = 3;
const SCORE_MULTIPLIER = 5;
const CME_DURATION = 10 * 60; // 10 seconds at 60fps

// --- COMPONENT ---
const SolarFlap: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  
  // Game logic refs (for high-frequency updates inside the loop)
  const playerRef = useRef<Player>({ x: PLAYER_X, y: 300, radius: 15, velocityY: 0, trail: [] });
  const pillarsRef = useRef<Pillar[]>([]);
  const frameRef = useRef(0);
  const powerRef = useRef(0);
  const gameSpeedRef = useRef(INITIAL_GAME_SPEED);
  const pillarFrequencyRef = useRef(INITIAL_PILLAR_FREQUENCY);
  const starsRef = useRef<Star[]>([]);
  const cmeStateRef = useRef({ active: false, timer: 0 });
  const powerUpRef = useRef<PowerUp | null>(null);
  const gameStateRef = useRef<GameState>('start');

  // React state (for UI rendering and triggering re-renders)
  const [uiState, setUiState] = useState<GameState>('start');
  const [hemisphericPower, setHemisphericPower] = useState(0);
  const [cmeCharge, setCmeCharge] = useState(0);

  const activateCME = useCallback(() => {
    if (cmeCharge >= 100 && !cmeStateRef.current.active && gameStateRef.current === 'playing') {
        cmeStateRef.current = { active: true, timer: CME_DURATION };
        gameSpeedRef.current = INITIAL_GAME_SPEED * 1.8;
        pillarFrequencyRef.current = INITIAL_PILLAR_FREQUENCY / 2;
        setCmeCharge(0);
    }
  }, [cmeCharge]);

  const resetGame = useCallback((canvas: HTMLCanvasElement) => {
    playerRef.current = { x: PLAYER_X, y: canvas.height / 2, radius: 15, velocityY: 0, trail: [] };
    pillarsRef.current = [];
    frameRef.current = 0;
    powerRef.current = 0;
    setHemisphericPower(0);
    gameSpeedRef.current = INITIAL_GAME_SPEED;
    pillarFrequencyRef.current = INITIAL_PILLAR_FREQUENCY;
    cmeStateRef.current = { active: false, timer: 0 };
    setCmeCharge(0);
    powerUpRef.current = null;
    gameStateRef.current = 'playing';
    setUiState('playing');
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleInput = (e: Event) => {
      // Stop propagation if the click is on the CME button
      if (e.target instanceof HTMLElement && e.target.id === 'cme-button') {
        return;
      }
      
      if (gameStateRef.current === 'playing') {
        playerRef.current.velocityY = -FLAP_STRENGTH;
      } else if (gameStateRef.current === 'start' || gameStateRef.current === 'gameOver') {
        resetGame(canvas);
      }
    };
    
    const handleCMEKey = (e: KeyboardEvent) => {
        if(e.key.toLowerCase() === 'c') {
            activateCME();
        }
    };

    canvas.addEventListener('mousedown', handleInput);
    window.addEventListener('keydown', (e) => e.key === ' ' && handleInput());
    window.addEventListener('keydown', handleCMEKey);
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        handleInput(e);
    });

    return () => {
      canvas.removeEventListener('mousedown', handleInput);
      window.removeEventListener('keydown', (e) => e.key === ' ' && handleInput());
      window.removeEventListener('keydown', handleCMEKey);
      canvas.removeEventListener('touchstart', handleInput);
    };
  }, [resetGame, activateCME]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      starsRef.current = [];
      for(let i=0; i<100; i++) {
        starsRef.current.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            radius: Math.random() * 1.5,
            speed: 0.5 + Math.random() * 0.5,
        });
      }
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const gameLoop = () => {
        if (!isRunning) return;

        const { width, height } = canvas;
        frameRef.current++;
        
        ctx.fillStyle = cmeStateRef.current.active ? '#300' : '#010418';
        ctx.fillRect(0, 0, width, height);

        starsRef.current.forEach(star => {
            star.x -= star.speed * gameSpeedRef.current * 0.5;
            if (star.x < 0) star.x = width;
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fill();
        });

        if (gameStateRef.current === 'playing') {
            if (frameRef.current % Math.floor(pillarFrequencyRef.current) === 0) {
                const gapHeight = 180 - Math.min(powerRef.current / 500, 60);
                pillarsRef.current.push({
                    x: width,
                    gapY: (height * 0.2) + Math.random() * (height * 0.6),
                    gapHeight: gapHeight,
                    scored: false,
                });
            }

            pillarsRef.current.forEach(p => {
                p.x -= gameSpeedRef.current;
                
                ctx.fillStyle = 'rgba(10, 200, 120, 0.2)';
                ctx.fillRect(p.x, p.gapY - p.gapHeight / 2, PILLAR_WIDTH, p.gapHeight);

                const topGrad = ctx.createLinearGradient(p.x, 0, p.x + PILLAR_WIDTH, 0);
                topGrad.addColorStop(0, '#ff4444'); topGrad.addColorStop(1, '#ff8888');
                ctx.fillStyle = topGrad;
                ctx.fillRect(p.x, 0, PILLAR_WIDTH, p.gapY - p.gapHeight / 2);

                const botGrad = ctx.createLinearGradient(p.x, 0, p.x + PILLAR_WIDTH, 0);
                botGrad.addColorStop(0, '#ff4444'); botGrad.addColorStop(1, '#ff8888');
                ctx.fillStyle = botGrad;
                ctx.fillRect(p.x, p.gapY + p.gapHeight / 2, PILLAR_WIDTH, height);

                if (!p.scored && p.x + PILLAR_WIDTH < playerRef.current.x) {
                    powerRef.current += gameSpeedRef.current * SCORE_MULTIPLIER;
                    setCmeCharge(c => Math.min(100, c + 5));
                    p.scored = true;
                }
            });
            pillarsRef.current = pillarsRef.current.filter(p => p.x + PILLAR_WIDTH > 0);
            
            playerRef.current.velocityY += GRAVITY;
            playerRef.current.y += playerRef.current.velocityY;
            
            playerRef.current.trail.push({ x: playerRef.current.x, y: playerRef.current.y });
            if(playerRef.current.trail.length > 20) playerRef.current.trail.shift();

            for(let i=playerRef.current.trail.length - 1; i>=0; i--) {
                const t = playerRef.current.trail[i];
                const ratio = i / playerRef.current.trail.length;
                ctx.beginPath();
                ctx.arc(t.x, t.y, playerRef.current.radius * ratio, 0, Math.PI * 2);
                const color = cmeStateRef.current.active ? `rgba(255, 200, 50, ${ratio * 0.5})` : `rgba(150, 200, 255, ${ratio * 0.5})`;
                ctx.fillStyle = color;
                ctx.fill();
            }

            ctx.beginPath();
            ctx.arc(playerRef.current.x, playerRef.current.y, playerRef.current.radius, 0, Math.PI * 2);
            const playerGrad = ctx.createRadialGradient(playerRef.current.x, playerRef.current.y, 0, playerRef.current.x, playerRef.current.y, playerRef.current.radius);
            const pColor1 = cmeStateRef.current.active ? '#ffff88' : '#aaccff';
            const pColor2 = cmeStateRef.current.active ? '#ff8800' : '#4488ff';
            playerGrad.addColorStop(0, pColor1); playerGrad.addColorStop(1, pColor2);
            ctx.fillStyle = playerGrad;
            ctx.fill();

            if(!powerUpRef.current && Math.random() < 0.002) {
                powerUpRef.current = { x: width, y: height * 0.2 + Math.random() * height * 0.6, radius: 20, active: true };
            }
            if(powerUpRef.current && powerUpRef.current.active) {
                powerUpRef.current.x -= gameSpeedRef.current;
                const p = powerUpRef.current;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                const sunGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
                sunGrad.addColorStop(0, '#fff5e6'); sunGrad.addColorStop(0.8, '#ffcc00'); sunGrad.addColorStop(1, 'rgba(255, 100, 0, 0)');
                ctx.fillStyle = sunGrad;
                ctx.fill();
                if(Math.hypot(p.x - playerRef.current.x, p.y - playerRef.current.y) < p.radius + playerRef.current.radius) {
                    setCmeCharge(c => Math.min(100, c + 34));
                    p.active = false;
                }
                if(p.x < -p.radius) powerUpRef.current = null;
            }

            if(cmeStateRef.current.active) {
                cmeStateRef.current.timer--;
                if(cmeStateRef.current.timer <= 0) {
                    cmeStateRef.current.active = false;
                    gameSpeedRef.current = INITIAL_GAME_SPEED;
                    pillarFrequencyRef.current = INITIAL_PILLAR_FREQUENCY;
                }
            }

            const p = pillarsRef.current[0];
            if(p && playerRef.current.x + playerRef.current.radius > p.x && playerRef.current.x - playerRef.current.radius < p.x + PILLAR_WIDTH) {
                if(playerRef.current.y - playerRef.current.radius < p.gapY - p.gapHeight/2 || playerRef.current.y + playerRef.current.radius > p.gapY + p.gapHeight/2) {
                    gameStateRef.current = 'gameOver';
                    setUiState('gameOver');
                }
            }
            if(playerRef.current.y > height || playerRef.current.y < 0) {
                 gameStateRef.current = 'gameOver';
                 setUiState('gameOver');
            }

            setHemisphericPower(powerRef.current);
        }

        animationFrameId.current = requestAnimationFrame(gameLoop);
    };

    gameLoop();
    
    return () => {
      isRunning = false;
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [resetGame]);

  const isCmeReady = cmeCharge >= 100 && !cmeStateRef.current.active;

  return (
    <div className="fixed inset-0 z-[4000] bg-black/80 backdrop-blur-md flex items-center justify-center cursor-pointer">
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
      
      <button onClick={onClose} className="absolute top-5 right-5 p-2 bg-black/50 rounded-full text-white hover:bg-white/20 transition-colors z-20">
        <CloseIcon className="w-8 h-8"/>
      </button>

      {uiState === 'playing' && (
        <div className="absolute top-4 left-4 right-4 text-white font-bold text-lg flex justify-between items-center pointer-events-none z-10">
            <div className="bg-black/50 p-2 rounded-md">
                Power: {Math.floor(hemisphericPower)} GW
            </div>
            <div className="bg-black/50 p-2 rounded-md flex items-center gap-2">
                <span>CME Charge</span>
                <div className="w-24 h-4 bg-neutral-700 rounded">
                    <div className={`h-4 rounded transition-all ${isCmeReady ? 'bg-yellow-400' : 'bg-orange-500'}`} style={{width: `${cmeCharge}%`}}></div>
                </div>
            </div>
        </div>
      )}

      {uiState === 'start' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-lg pointer-events-none">
            <h1 className="text-5xl font-extrabold mb-4 text-amber-300">Solar Flap</h1>
            <h2 className="text-xl font-semibold mb-6">Can you create an aurora?</h2>
            <div className="text-left space-y-3 mb-8">
                <p><strong>Controls:</strong> Click, Tap, or press Spacebar to flap upwards.</p>
                <p><strong>Goal:</strong> Fly through the <strong className="text-green-400">green (-Bz)</strong> gaps to increase Hemispheric Power. Avoid the <strong className="text-red-400">red (+Bz)</strong> pillars!</p>
                <p><strong>Power Up:</strong> Collect sun icons to charge your CME. When full, press <strong className="text-yellow-400">'C'</strong> or <strong className="text-yellow-400">tap the icon</strong> to unleash it for double pillars and faster speeds!</p>
            </div>
            <p className="text-2xl font-bold animate-pulse">Click anywhere to Start</p>
        </div>
      )}
      
      {uiState === 'gameOver' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-lg pointer-events-none">
            <h1 className="text-5xl font-extrabold mb-4 text-red-500">Impact Failure</h1>
            <h2 className="text-3xl font-semibold mb-2">Final Power: {Math.floor(hemisphericPower)} GW</h2>
            <p className="text-xl mt-8 animate-pulse">Click anywhere to try again</p>
        </div>
      )}

      {isCmeReady && uiState === 'playing' && (
        <button 
            id="cme-button"
            onClick={(e) => {
                e.stopPropagation();
                activateCME();
            }}
            onTouchStart={(e) => {
                e.stopPropagation();
                activateCME();
            }}
            className="absolute top-20 left-4 w-20 h-20 bg-yellow-400/80 rounded-full z-20 flex items-center justify-center text-black font-bold text-4xl border-4 border-yellow-200 shadow-lg animate-pulse"
            style={{ textShadow: '0 0 10px white' }}
            title="Activate CME (C Key)"
        >
            C
        </button>
      )}
    </div>
  );
};

export default SolarFlap;
// --- END OF FILE src/components/SolarSurferGame.tsx ---