// --- START OF FILE src/components/SolarSurferGame.tsx ---

import React, { useRef, useEffect, useCallback, useState } from 'react';
import CloseIcon from './icons/CloseIcon';

// --- TYPE DEFINITIONS ---
type GameState = 'start' | 'playing' | 'gameOver';
type ParticleType = 'good' | 'bad' | 'proton';

interface Particle {
  x: number;
  y: number;
  radius: number;
  speed: number;
  type: ParticleType;
  opacity: number;
}

interface Star {
  x: number;
  y: number;
  radius: number;
  opacity: number;
}

interface Flare {
    y: number;
    height: number;
    active: boolean;
    warningTimer: number;
    speed: number;
}

// --- GAME CONFIGURATION ---
const PLAYER_WIDTH = 150;
const IS_MOBILE = window.innerWidth < 768;
const INITIAL_SPEED = IS_MOBILE ? 1.8 : 2.5;
const INITIAL_SPAWN_RATE = IS_MOBILE ? 12 : 8; 
const MAX_SPEED = IS_MOBILE ? 9 : 14;
const CME_DURATION = 7 * 60; // 7 seconds at 60fps

const AuroraCollector: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  
  const playerX = useRef(window.innerWidth / 2);
  const targetX = useRef(window.innerWidth / 2);
  const particlesRef = useRef<Particle[]>([]);
  const starsRef = useRef<Star[]>([]);
  const frameRef = useRef(0);
  const cmeStateRef = useRef({ active: false, timer: 0 });
  const screenShakeRef = useRef(0);
  const flareRef = useRef<Flare>({ y: 0, height: 20, active: false, warningTimer: 0, speed: 15 });
  const comboRef = useRef(0);
  const scoreMultiplierRef = useRef(1);
  const comboMessageRef = useRef({ text: '', alpha: 0, timer: 0 });
  
  const [gameState, setGameState] = useState<GameState>('start');
  const [score, setScore] = useState(0);
  const [shield, setShield] = useState(100);
  const [cmeCharge, setCmeCharge] = useState(0);
  const [highScore, setHighScore] = useState(() => Number(localStorage.getItem('auroraCollectorHighScore') || '0'));
  const [finalCombo, setFinalCombo] = useState(0);
  // --- FIX: Added missing state declaration ---
  const [gameOverReason, setGameOverReason] = useState('');

  const resetGame = useCallback(() => {
    playerX.current = window.innerWidth / 2;
    targetX.current = window.innerWidth / 2;
    particlesRef.current = [];
    frameRef.current = 0;
    cmeStateRef.current = { active: false, timer: 0 };
    comboRef.current = 0;
    scoreMultiplierRef.current = 1;
    
    setScore(0);
    setShield(100);
    setCmeCharge(0);
    setGameState('playing');
  }, []);

  const activateCME = useCallback(() => {
    if (cmeCharge >= 100 && !cmeStateRef.current.active && gameState === 'playing') {
        cmeStateRef.current = { active: true, timer: CME_DURATION };
        setCmeCharge(0);
    }
  }, [cmeCharge, gameState]);

  useEffect(() => {
    const handleMove = (x: number) => { if(gameState === 'playing') targetX.current = x; };
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => { e.preventDefault(); if (e.touches[0]) handleMove(e.touches[0].clientX); };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, [gameState]);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let isRunning = true;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      starsRef.current = Array.from({length: 200}, () => ({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, radius: Math.random() * 1.5, opacity: 0.2 + Math.random() * 0.5 }));
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const gameLoop = () => {
        if (!isRunning) return;
        frameRef.current++;
        const { width, height } = canvas;

        ctx.fillStyle = cmeStateRef.current.active ? '#4d0f0f' : '#010418';
        ctx.fillRect(0, 0, width, height);
        starsRef.current.forEach(star => {
            ctx.beginPath(); ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2); ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`; ctx.fill();
        });

        if (gameState === 'playing') {
            const difficulty = 1 + score / 3000;
            const currentSpeed = Math.min(MAX_SPEED, INITIAL_SPEED * difficulty);
            const spawnRate = Math.max(1, INITIAL_SPAWN_RATE / difficulty);

            if (cmeStateRef.current.active) { cmeStateRef.current.timer--; if (cmeStateRef.current.timer <= 0) cmeStateRef.current.active = false; }

            const isCME = cmeStateRef.current.active;
            if (frameRef.current % Math.floor(isCME ? 2 : spawnRate) === 0) {
                const particleCount = isCME ? 4 : 1;
                for (let i = 0; i < particleCount; i++) {
                    let type: ParticleType = 'good';
                    const rand = Math.random();
                    if (rand < (isCME ? 0.4 : 0.3)) type = 'bad';
                    if (rand < 0.05 && score > 1000) type = 'proton'; // Protons appear after 1000 score
                    
                    particlesRef.current.push({
                        x: Math.random() * width, y: -20,
                        radius: type === 'good' ? 8 + Math.random() * 4 : (type === 'proton' ? 6 : 10 + Math.random() * 6),
                        speed: currentSpeed + Math.random() * 2 + (isCME ? 5 : 0) + (type === 'proton' ? 3 : 0),
                        type, opacity: 1,
                    });
                }
            }

            if(score > 2000 && !flareRef.current.active && flareRef.current.warningTimer <= 0 && Math.random() < 0.005) {
                flareRef.current.warningTimer = 120; // 2 second warning
                flareRef.current.y = Math.random() * height;
            }

            // Update and draw everything in a single loop
            ctx.save();
            if (screenShakeRef.current > 1) { ctx.translate((Math.random() - 0.5) * screenShakeRef.current, (Math.random() - 0.5) * screenShakeRef.current); screenShakeRef.current *= 0.9; }

            // DRAW PLAYER
            playerX.current += (targetX.current - playerX.current) * 0.1;
            const playerY = height - 40;
            const playerHalfWidth = PLAYER_WIDTH / 2;
            const playerGrad = ctx.createLinearGradient(playerX.current - playerHalfWidth, 0, playerX.current + playerHalfWidth, 0);
            playerGrad.addColorStop(0, 'rgba(0, 150, 255, 0)'); playerGrad.addColorStop(0.2, 'rgba(100, 200, 255, 0.8)'); playerGrad.addColorStop(0.5, 'rgba(200, 255, 255, 1)'); playerGrad.addColorStop(0.8, 'rgba(100, 200, 255, 0.8)'); playerGrad.addColorStop(1, 'rgba(0, 150, 255, 0)');
            ctx.fillStyle = playerGrad; ctx.beginPath(); ctx.moveTo(playerX.current - playerHalfWidth, playerY); ctx.quadraticCurveTo(playerX.current, playerY - 40, playerX.current + playerHalfWidth, playerY); ctx.quadraticCurveTo(playerX.current, playerY - 20, playerX.current - playerHalfWidth, playerY); ctx.fill();
            
            // DRAW PARTICLES & HANDLE COLLISIONS
            const particlesToRemove: number[] = [];
            particlesRef.current.forEach((p, index) => {
                p.y += p.speed;
                if (p.y > height + 20 || p.opacity <= 0) particlesToRemove.push(index);

                ctx.globalAlpha = p.opacity; ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
                if (p.type === 'good') { gradient.addColorStop(0, 'rgba(150, 255, 200, 1)'); gradient.addColorStop(1, 'rgba(50, 200, 150, 0)'); } 
                else if (p.type === 'bad') { gradient.addColorStop(0, 'rgba(255, 150, 150, 1)'); gradient.addColorStop(1, 'rgba(200, 50, 50, 0)'); }
                else { gradient.addColorStop(0, 'rgba(255, 100, 255, 1)'); gradient.addColorStop(1, 'rgba(180, 50, 180, 0)'); }
                ctx.fillStyle = gradient; ctx.fill(); ctx.globalAlpha = 1;

                if (p.y > playerY - 40 && p.y < playerY + 40 && p.x > playerX.current - playerHalfWidth && p.x < playerX.current + playerHalfWidth && p.opacity > 0.5) {
                    if (p.type === 'good') {
                        comboRef.current++;
                        scoreMultiplierRef.current = 1 + Math.floor(comboRef.current / 5);
                        setScore(s => s + (isCME ? 20 : 10) * scoreMultiplierRef.current);
                        setCmeCharge(c => Math.min(100, c + 2));
                    } else {
                        comboRef.current = 0; scoreMultiplierRef.current = 1;
                        const damage = p.type === 'proton' ? 20 : 10;
                        setShield(s => {
                            const newShield = s - (isCME ? damage * 1.5 : damage);
                            if (newShield <= 0) { setGameOverReason('Your shields were depleted!'); setGameState('gameOver'); }
                            return Math.max(0, newShield);
                        });
                        screenShakeRef.current = p.type === 'proton' ? 25 : 15;
                    }
                    p.opacity = 0;
                }
            });
            for (let i = particlesToRemove.length - 1; i >= 0; i--) particlesRef.current.splice(particlesToRemove[i], 1);

            // DRAW FLARE
            if(score > 2000 && !flareRef.current.active && flareRef.current.warningTimer <= 0 && Math.random() < 0.005) {
                flareRef.current.warningTimer = 120; // 2 second warning
                flareRef.current.y = Math.random() * height;
            }
            if(flareRef.current.warningTimer > 0) {
                flareRef.current.warningTimer--;
                ctx.fillStyle = `rgba(255, 100, 0, ${0.5 * Math.sin(frameRef.current * 0.5)})`;
                ctx.fillRect(0, flareRef.current.y - 2, width, 4);
                if(flareRef.current.warningTimer <= 0) flareRef.current.active = true;
            }
            if(flareRef.current.active) {
                ctx.fillStyle = 'rgba(255, 150, 50, 0.8)'; ctx.fillRect(0, flareRef.current.y - flareRef.current.height/2, width, flareRef.current.height);
                flareRef.current.height -= 0.2;
                if(playerY > flareRef.current.y - flareRef.current.height/2 && playerY < flareRef.current.y + flareRef.current.height/2) {
                    comboRef.current = 0; scoreMultiplierRef.current = 1; setShield(s => Math.max(0, s - 0.5));
                }
                if(flareRef.current.height <= 0) { flareRef.current.active = false; flareRef.current.height = 20; }
            }

            ctx.restore();
        }
        animationFrameId.current = requestAnimationFrame(gameLoop);
    };
    gameLoop();
    return () => { isRunning = false; window.removeEventListener('resize', resizeCanvas); if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); };
  }, [gameState]);

  useEffect(() => {
    if (gameState === 'gameOver' && score > highScore) {
        setHighScore(score);
        localStorage.setItem('auroraCollectorHighScore', score.toString());
    }
    if (gameState === 'gameOver') {
        setFinalCombo(comboRef.current);
    }
  }, [gameState, score, highScore]);

  const isCmeReady = cmeCharge >= 100;

  return (
    <div className="fixed inset-0 z-[4000] bg-black/90 flex items-center justify-center cursor-crosshair" onClick={() => { if (gameState !== 'playing') resetGame(); }}>
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
      <button onClick={onClose} className="absolute top-5 right-5 p-2 bg-black/50 rounded-full text-white hover:bg-white/20 transition-colors z-20"><CloseIcon className="w-8 h-8"/></button>

      {gameState === 'playing' && (
        <div className="absolute top-4 left-4 right-4 text-white font-bold text-lg flex justify-between items-center pointer-events-none z-10">
            <div className="bg-black/50 p-2 rounded-md">Aurora Power: {score}</div>
            <div className="bg-black/50 p-2 rounded-md text-yellow-300">
                x{scoreMultiplierRef.current} Combo!
            </div>
            <div className="bg-black/50 p-2 rounded-md flex flex-col items-end">
                <span>Shield: {Math.ceil(shield)}%</span>
                <div className="w-32 h-2 bg-neutral-700 rounded mt-1"><div className="h-2 bg-green-500 rounded" style={{width: `${shield}%`}}></div></div>
            </div>
        </div>
      )}

      {gameState === 'start' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-2xl pointer-events-none">
            <h1 className="text-5xl font-extrabold mb-4 text-sky-300">Aurora Collector</h1>
            <h2 className="text-xl font-semibold mb-6">Harness the Solar Wind!</h2>
            <div className="text-left space-y-3 mb-8">
                <p><strong>Controls:</strong> Move your mouse or finger to control the magnetic field.</p>
                <p><strong>Goal:</strong> Collect <strong className="text-green-400">Green (-Bz)</strong> particles to build Aurora Power and get a high score!</p>
                <p><strong>Avoid:</strong> <strong className="text-red-400">Red (+Bz)</strong> particles damage your shield. <strong className="text-purple-400">Purple (Protons)</strong> are faster and deal double damage!</p>
                <p><strong>Watch out for <span className="text-orange-400">Solar Flares!</span></strong> A warning will appear before a horizontal beam sweeps across the screen.</p>
                <p><strong>Combos:</strong> Collect green particles without getting hit to build your score multiplier!</p>
            </div>
            <p className="text-sm">High Score: {highScore}</p>
            <p className="text-2xl font-bold animate-pulse mt-4">Click anywhere to Start</p>
        </div>
      )}
      
      {gameState === 'gameOver' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-lg pointer-events-none">
            <h1 className="text-5xl font-extrabold mb-4 text-red-500">Shields Down!</h1>
            <h2 className="text-3xl font-semibold">Final Power: {score}</h2>
            <p className="text-xl text-yellow-300">Highest Combo: {finalCombo}</p>
            {score > highScore && <p className="text-2xl text-green-400 mt-4 font-bold">New High Score!</p>}
            <p className="text-xl mt-8 animate-pulse">Click anywhere to try again</p>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20">
            <button 
                id="cme-button" onClick={(e) => { e.stopPropagation(); activateCME(); }} onTouchStart={(e) => { e.stopPropagation(); activateCME(); }}
                disabled={!isCmeReady}
                className={`w-36 h-16 rounded-lg flex items-center justify-center text-black font-bold text-xl border-4 shadow-lg transition-all duration-300 ${isCmeReady ? 'bg-yellow-400/90 border-yellow-200 animate-pulse cursor-pointer' : 'bg-neutral-600/70 border-neutral-500 cursor-not-allowed'}`}
                title="Activate CME" >
                {isCmeReady ? "CME Ready!" : `Charge: ${Math.floor(cmeCharge)}%`}
            </button>
        </div>
      )}
    </div>
  );
};

export default AuroraCollector;
// --- END OF FILE src/components/SolarSurferGame.tsx ---