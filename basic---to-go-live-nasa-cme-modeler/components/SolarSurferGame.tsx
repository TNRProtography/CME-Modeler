// --- START OF FILE src/components/SolarSurferGame.tsx ---

import React, { useRef, useEffect, useCallback, useState } from 'react';
import CloseIcon from './icons/CloseIcon';

// --- TYPE DEFINITIONS ---
type GameState = 'start' | 'playing' | 'gameOver';

interface Player { x: number; y: number; radius: number; velocityY: number; rotation: number; isOnGround: boolean; invincibilityTimer: number; }
interface Obstacle { x: number; width: number; height: number; type: '+Bz' } // Red obstacles to jump over
interface Ring { x: number; y: number; radius: number; scored: boolean; type: '-Bz' } // Green rings to jump through
interface Star { x: number; y: number; radius: number; speed: number; }
interface PowerUp { x: number; y: number; radius: number; active: boolean; }
interface SmokeParticle { x: number; y: number; radius: number; opacity: number; velocityX: number; velocityY: number; }
interface MegaCME { x: number; gapY: number; gapHeight: number; active: boolean; }

// --- GAME CONFIGURATION ---
const GRAVITY = 0.5;
const JUMP_STRENGTH = 12;
const PLAYER_X_POS = 150;

const IS_MOBILE = window.innerWidth < 768;
const DESKTOP_BASE_SPEED = 5;
const MOBILE_BASE_SPEED = DESKTOP_BASE_SPEED * 0.7; // 30% slower for better control
const BASE_SPEED = IS_MOBILE ? MOBILE_BASE_SPEED : DESKTOP_BASE_SPEED;

const CME_DURATION = 5 * 60; // 5 seconds
const CME_SPEED_MULTIPLIER = 1.5;

const GW_LOW_THRESHOLD = 50;
const GW_HIGH_THRESHOLD = 300;
const GW_CRITICAL_THRESHOLD = 500;
const LOW_GW_DURATION = 10 * 60;
const CRITICAL_GW_DURATION = 5 * 60;

const MEGA_CME_MIN_INTERVAL = 15 * 60;
const MEGA_CME_MAX_INTERVAL = 30 * 60;
const MEGA_CME_SPEED = 15;

const EarthJumper: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  
  // Game logic refs
  const playerRef = useRef<Player>({ x: PLAYER_X_POS, y: 300, radius: 30, velocityY: 0, rotation: 0, isOnGround: true, invincibilityTimer: 0 });
  const obstaclesRef = useRef<Obstacle[]>([]);
  const ringsRef = useRef<Ring[]>([]);
  const frameRef = useRef(0);
  const starsRef = useRef<Star[]>([]);
  const cmeStateRef = useRef({ active: false, timer: 0 });
  const gameStateRef = useRef<GameState>('start');
  const smokeParticlesRef = useRef<SmokeParticle[]>([]);
  const lowGwTimerRef = useRef(0);
  const highGwTimerRef = useRef(0);
  const megaCmeRef = useRef<MegaCME>({ x: 0, gapY: 0, gapHeight: 0, active: false });
  const nextMegaCmeFrameRef = useRef(0);

  // React state for UI
  const [uiState, setUiState] = useState<GameState>('start');
  const [gw, setGw] = useState(50);
  const [happiness, setHappiness] = useState(100);
  const [cmeCharge, setCmeCharge] = useState(0);
  const [gameOverReason, setGameOverReason] = useState('');

  const activateCME = useCallback(() => {
    if (cmeCharge >= 100 && !cmeStateRef.current.active && gameStateRef.current === 'playing') {
        cmeStateRef.current = { active: true, timer: CME_DURATION };
        setCmeCharge(0);
    }
  }, [cmeCharge]);

  const resetGame = useCallback((canvas: HTMLCanvasElement) => {
    playerRef.current = { x: PLAYER_X_POS, y: canvas.height - 50, radius: 30, velocityY: 0, rotation: 0, isOnGround: true, invincibilityTimer: 0 };
    obstaclesRef.current = [];
    ringsRef.current = [];
    frameRef.current = 0;
    setGw(50);
    setHappiness(100);
    cmeStateRef.current = { active: false, timer: 0 };
    setCmeCharge(0);
    gameStateRef.current = 'playing';
    setUiState('playing');
    lowGwTimerRef.current = 0;
    highGwTimerRef.current = 0;
    nextMegaCmeFrameRef.current = frameRef.current + MEGA_CME_MIN_INTERVAL + Math.random() * (MEGA_CME_MAX_INTERVAL - MEGA_CME_MIN_INTERVAL);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const handleInput = (e: Event) => {
      if (e.target instanceof HTMLElement && e.target.id === 'cme-button') return;
      if (gameStateRef.current === 'playing' && playerRef.current.isOnGround) { playerRef.current.velocityY = -JUMP_STRENGTH; playerRef.current.isOnGround = false; } 
      else if (gameStateRef.current !== 'playing') { resetGame(canvas); }
    };
    const handleCMEKey = (e: KeyboardEvent) => { if(e.key.toLowerCase() === 'c') activateCME(); };
    canvas.addEventListener('mousedown', handleInput);
    window.addEventListener('keydown', handleCMEKey);
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleInput(e); });
    return () => {
      canvas.removeEventListener('mousedown', handleInput);
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
        const groundY = height - 20;
        frameRef.current++;
        const gameSpeed = cmeStateRef.current.active ? BASE_SPEED * CME_SPEED_MULTIPLIER : BASE_SPEED;
        
        ctx.fillStyle = cmeStateRef.current.active ? '#400' : '#010418'; ctx.fillRect(0, 0, width, height);
        starsRef.current.forEach(star => {
            star.x -= star.speed * gameSpeed * 0.2; if (star.x < 0) star.x = width;
            ctx.beginPath(); ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; ctx.fill();
        });
        ctx.fillStyle = '#222'; ctx.fillRect(0, groundY, width, 20);

        if (gameStateRef.current === 'playing') {
            // --- Obstacle & Ring Spawning ---
            if (frameRef.current % Math.floor(BASE_PILLAR_FREQUENCY / (gameSpeed / BASE_SPEED)) === 0) {
                if(Math.random() > 0.5) {
                    obstaclesRef.current.push({ x: width, width: 40 + Math.random() * 40, height: 40 + Math.random() * 80, type: '+Bz' });
                } else {
                    const radius = 35 + Math.random() * 25;
                    ringsRef.current.push({ x: width, y: groundY - radius - 20 - Math.random() * 150, radius, scored: false, type: '-Bz' });
                }
            }

            // --- Update & Draw Obstacles ---
            obstaclesRef.current.forEach(obs => {
                obs.x -= gameSpeed;
                ctx.fillStyle = '#ff4444'; ctx.fillRect(obs.x, groundY - obs.height, obs.width, obs.height);
                if (playerRef.current.invincibilityTimer === 0 && playerRef.current.x + playerRef.current.radius > obs.x && playerRef.current.x - playerRef.current.radius < obs.x + obs.width && playerRef.current.y + playerRef.current.radius > groundY - obs.height) {
                    setGw(g => Math.max(0, g - 50));
                    playerRef.current.invincibilityTimer = 60;
                }
            });
            obstaclesRef.current = obstaclesRef.current.filter(o => o.x + o.width > 0);

            // --- Update & Draw Rings ---
            ringsRef.current.forEach(ring => {
                ring.x -= gameSpeed;
                ctx.beginPath(); ctx.arc(ring.x, ring.y, ring.radius, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(10, 200, 120, ${ring.scored ? 0.3 : 1})`; ctx.lineWidth = 5; ctx.stroke();
                
                const dist = Math.hypot(playerRef.current.x - ring.x, playerRef.current.y - ring.y);
                if (!ring.scored && dist < playerRef.current.radius + ring.radius) {
                    const baseReward = cmeStateRef.current.active ? 50 : 5;
                    const sizeFactor = 60 / ring.radius; // Smaller rings worth more
                    setGw(g => g + Math.floor(baseReward * sizeFactor));
                    setCmeCharge(c => Math.min(100, c + 10));
                    ring.scored = true;
                }
            });
            ringsRef.current = ringsRef.current.filter(r => r.x + r.radius > 0);

            // --- Player Physics & Drawing ---
            if (playerRef.current.invincibilityTimer > 0) playerRef.current.invincibilityTimer--;
            playerRef.current.velocityY += GRAVITY;
            playerRef.current.y += playerRef.current.velocityY;
            playerRef.current.rotation += 0.02 * gameSpeed;

            if (playerRef.current.y + playerRef.current.radius > groundY) {
                playerRef.current.y = groundY - playerRef.current.radius;
                playerRef.current.velocityY = 0;
                playerRef.current.isOnGround = true;
            }
            
            ctx.save();
            ctx.translate(playerRef.current.x, playerRef.current.y);
            ctx.rotate(playerRef.current.rotation);
            ctx.globalAlpha = playerRef.current.invincibilityTimer % 10 < 5 ? 0.5 : 1;
            const earthGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, playerRef.current.radius);
            earthGrad.addColorStop(0, '#8cb1de'); earthGrad.addColorStop(1, '#1d4f7a');
            ctx.fillStyle = earthGrad; ctx.beginPath(); ctx.arc(0, 0, playerRef.current.radius, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            ctx.globalAlpha = 1;
            
            // --- Mega CME ---
            if (frameRef.current > nextMegaCmeFrameRef.current && !megaCmeRef.current.active) {
                megaCmeRef.current = { x: width, gapY: height * 0.4 + Math.random() * (height*0.5), gapHeight: 200, active: true };
                nextMegaCmeFrameRef.current = frameRef.current + MEGA_CME_MIN_INTERVAL + Math.random() * (MEGA_CME_MAX_INTERVAL - MEGA_CME_MIN_INTERVAL);
            }
            if (megaCmeRef.current.active) {
                const cme = megaCmeRef.current; cme.x -= MEGA_CME_SPEED;
                ctx.fillStyle = 'rgba(10, 255, 150, 0.4)';
                ctx.fillRect(cme.x, 0, 150, cme.gapY - cme.gapHeight/2);
                ctx.fillRect(cme.x, cme.gapY + cme.gapHeight/2, 150, height);
                ctx.fillStyle = 'white'; ctx.font = 'bold 24px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('AVOID!', cme.x + 75, 30);
                if (playerRef.current.x + playerRef.current.radius > cme.x && playerRef.current.x - playerRef.current.radius < cme.x + 150) {
                    if (playerRef.current.y - playerRef.current.radius > cme.gapY - cme.gapHeight/2 && playerRef.current.y + playerRef.current.radius < cme.gapY + cme.gapHeight/2) {
                        // Safe
                    } else {
                        setGw(g => g + 500); cme.active = false;
                    }
                }
                if (cme.x + 150 < 0) cme.active = false;
            }
            
            // --- Happiness & Game Over Logic ---
            setGw(g => {
                if (g < GW_LOW_THRESHOLD) lowGwTimerRef.current++; else lowGwTimerRef.current = 0;
                if (g > GW_CRITICAL_THRESHOLD) highGwTimerRef.current++; else highGwTimerRef.current = 0;
                return g;
            });
            setHappiness(h => {
                let newH = h;
                if (lowGwTimerRef.current > 0) newH -= (lowGwTimerRef.current / LOW_GW_DURATION) * 0.2;
                if (gw > GW_HIGH_THRESHOLD) newH -= (gw - GW_HIGH_THRESHOLD) * 0.001;
                else if (lowGwTimerRef.current === 0) newH = Math.min(100, h + 0.1);
                
                if (newH <= 0) { gameStateRef.current = 'gameOver'; setUiState('gameOver'); setGameOverReason('The grid collapsed from lack of power!'); }
                if (highGwTimerRef.current > CRITICAL_GW_DURATION) { gameStateRef.current = 'gameOver'; setUiState('gameOver'); setGameOverReason('The grid was overloaded and destroyed!'); }
                return Math.max(0, newH);
            });
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
            <div className="bg-black/50 p-2 rounded-md flex flex-col items-end">
                <span>Grid Happiness: {Math.floor(happiness)}%</span>
                <div className="w-32 h-2 bg-neutral-700 rounded mt-1"><div className="h-2 bg-green-500 rounded" style={{width: `${happiness}%`}}></div></div>
            </div>
        </div>
      )}

      {uiState === 'start' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-2xl pointer-events-none">
            <h1 className="text-5xl font-extrabold mb-4 text-amber-300">Earth Jumper</h1>
            <h2 className="text-xl font-semibold mb-6">Power the World with Auroras!</h2>
            <div className="text-left space-y-3 mb-8">
                <p><strong>Controls:</strong> Click, Tap, or press Spacebar to jump.</p>
                <p><strong>Goal:</strong> Maintain grid power between <strong className="text-green-400">50 GW</strong> and <strong className="text-red-500">500 GW</strong>. Keep happiness high!</p>
                <p><strong>Gameplay:</strong> Jump through <strong className="text-green-400">green (-Bz) rings</strong> for power. Jump over <strong className="text-red-500">red (+Bz) pillars</strong> to avoid losing power.</p>
                <p><strong>Danger:</strong> Happiness drops if power is too high (&gt;300GW) or too low. Dodge the giant <strong className="text-green-400">MEGA CME</strong> waves!</p>
                <p><strong>Power Up:</strong> Charge your CME. When ready, click the button to enter hyper mode!</p>
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

export default EarthJumper;
// --- END OF FILE src/components/SolarSurferGame.tsx ---