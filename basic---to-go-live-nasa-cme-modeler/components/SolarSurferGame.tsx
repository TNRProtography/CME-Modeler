// --- START OF FILE src/components/SolarSurferGame.tsx ---

import React, { useRef, useEffect, useCallback, useState } from 'react';
import CloseIcon from './icons/CloseIcon';

// --- TYPE DEFINITIONS ---
type GameState = 'start' | 'playing' | 'gameOver';
type ParticleType = 'good' | 'bad';

interface Particle {
  x: number;
  y: number;
  radius: number;
  speed: number;
  type: ParticleType;
}

interface Star {
  x: number;
  y: number;
  radius: number;
  opacity: number;
}

// --- GAME CONFIGURATION ---
const PLAYER_WIDTH = 150;
const IS_MOBILE = window.innerWidth < 768;
const INITIAL_SPEED = IS_MOBILE ? 2 : 3;
const INITIAL_SPAWN_RATE = IS_MOBILE ? 15 : 10; // Lower is more frequent
const MAX_SPEED = 12;
const CME_DURATION = 7 * 60; // 7 seconds at 60fps

const AuroraCollector: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  
  // Game logic refs for performance
  const playerX = useRef(window.innerWidth / 2);
  const targetX = useRef(window.innerWidth / 2);
  const particlesRef = useRef<Particle[]>([]);
  const starsRef = useRef<Star[]>([]);
  const frameRef = useRef(0);
  const cmeStateRef = useRef({ active: false, timer: 0 });
  const screenShakeRef = useRef(0);
  
  // React state for UI updates
  const [gameState, setGameState] = useState<GameState>('start');
  const [score, setScore] = useState(0);
  const [shield, setShield] = useState(100);
  const [cmeCharge, setCmeCharge] = useState(0);

  const resetGame = useCallback(() => {
    playerX.current = window.innerWidth / 2;
    targetX.current = window.innerWidth / 2;
    particlesRef.current = [];
    frameRef.current = 0;
    cmeStateRef.current = { active: false, timer: 0 };
    
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

  // Input Handling
  useEffect(() => {
    const handleMove = (x: number) => {
        if(gameState === 'playing') {
            targetX.current = x;
        }
    };
    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const handleTouchMove = (e: TouchEvent) => { e.preventDefault(); if (e.touches[0]) handleMove(e.touches[0].clientX); };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, [gameState]);

  // Game Loop
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let isRunning = true;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      starsRef.current = Array.from({length: 200}, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: Math.random() * 1.5,
        opacity: 0.2 + Math.random() * 0.5
      }));
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const gameLoop = () => {
        if (!isRunning) return;
        frameRef.current++;
        const { width, height } = canvas;

        // --- BACKGROUND ---
        ctx.fillStyle = '#010418';
        ctx.fillRect(0, 0, width, height);
        starsRef.current.forEach(star => {
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
            ctx.fill();
        });

        if (gameState === 'playing') {
            // --- DIFFICULTY & SPEED ---
            const difficulty = 1 + score / 5000;
            const currentSpeed = Math.min(MAX_SPEED, INITIAL_SPEED * difficulty);
            const spawnRate = Math.max(2, INITIAL_SPAWN_RATE / difficulty);

            // --- CME STATE ---
            if (cmeStateRef.current.active) {
                cmeStateRef.current.timer--;
                if (cmeStateRef.current.timer <= 0) cmeStateRef.current.active = false;
            }

            // --- PARTICLE SPAWNING ---
            const isCME = cmeStateRef.current.active;
            if (frameRef.current % Math.floor(isCME ? 1 : spawnRate) === 0) {
                const particleCount = isCME ? 5 : 1;
                for (let i = 0; i < particleCount; i++) {
                    const type: ParticleType = Math.random() > (isCME ? 0.4 : 0.3) ? 'good' : 'bad';
                    particlesRef.current.push({
                        x: Math.random() * width,
                        y: -20,
                        radius: type === 'good' ? 8 + Math.random() * 4 : 10 + Math.random() * 6,
                        speed: currentSpeed + Math.random() * 2 + (isCME ? 5 : 0),
                        type,
                    });
                }
            }

            // --- UPDATE & DRAW PARTICLES ---
            particlesRef.current.forEach((p, index) => {
                p.y += p.speed;
                if (p.y > height + 20) particlesRef.current.splice(index, 1);
                
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
                if (p.type === 'good') {
                    gradient.addColorStop(0, 'rgba(150, 255, 200, 1)');
                    gradient.addColorStop(1, 'rgba(50, 200, 150, 0)');
                } else {
                    gradient.addColorStop(0, 'rgba(255, 150, 150, 1)');
                    gradient.addColorStop(1, 'rgba(200, 50, 50, 0)');
                }
                ctx.fillStyle = gradient;
                ctx.fill();
            });
            
            // --- PLAYER ---
            playerX.current += (targetX.current - playerX.current) * 0.1;
            const playerY = height - 40;
            const playerHalfWidth = PLAYER_WIDTH / 2;

            // Collision Detection
            particlesRef.current.forEach((p, index) => {
                if (p.y > playerY - 20 && p.y < playerY + 20 && p.x > playerX.current - playerHalfWidth && p.x < playerX.current + playerHalfWidth) {
                    if (p.type === 'good') {
                        setScore(s => s + (isCME ? 20 : 10));
                        setCmeCharge(c => Math.min(100, c + 2));
                    } else {
                        setShield(s => {
                            const newShield = s - (isCME ? 15 : 10);
                            if (newShield <= 0) {
                                setGameState('gameOver');
                            }
                            return Math.max(0, newShield);
                        });
                        screenShakeRef.current = 15;
                    }
                    particlesRef.current.splice(index, 1);
                }
            });

            // Screen Shake
            if (screenShakeRef.current > 0) {
                ctx.save();
                const dx = (Math.random() - 0.5) * screenShakeRef.current;
                const dy = (Math.random() - 0.5) * screenShakeRef.current;
                ctx.translate(dx, dy);
                screenShakeRef.current *= 0.9;
            }

            // Draw Player
            const playerGrad = ctx.createLinearGradient(playerX.current - playerHalfWidth, 0, playerX.current + playerHalfWidth, 0);
            playerGrad.addColorStop(0, 'rgba(0, 150, 255, 0)');
            playerGrad.addColorStop(0.2, 'rgba(100, 200, 255, 0.8)');
            playerGrad.addColorStop(0.5, 'rgba(200, 255, 255, 1)');
            playerGrad.addColorStop(0.8, 'rgba(100, 200, 255, 0.8)');
            playerGrad.addColorStop(1, 'rgba(0, 150, 255, 0)');
            ctx.fillStyle = playerGrad;
            ctx.beginPath();
            ctx.moveTo(playerX.current - playerHalfWidth, playerY);
            ctx.quadraticCurveTo(playerX.current, playerY - 40, playerX.current + playerHalfWidth, playerY);
            ctx.quadraticCurveTo(playerX.current, playerY - 20, playerX.current - playerHalfWidth, playerY);
            ctx.fill();

            if (screenShakeRef.current > 0) ctx.restore();
        }
        animationFrameId.current = requestAnimationFrame(gameLoop);
    };
    gameLoop();
    return () => { isRunning = false; window.removeEventListener('resize', resizeCanvas); if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current); };
  }, [gameState]);

  const isCmeReady = cmeCharge >= 100;

  return (
    <div className="fixed inset-0 z-[4000] bg-black/90 flex items-center justify-center cursor-crosshair">
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
      <button onClick={onClose} className="absolute top-5 right-5 p-2 bg-black/50 rounded-full text-white hover:bg-white/20 transition-colors z-20"><CloseIcon className="w-8 h-8"/></button>

      {gameState === 'playing' && (
        <div className="absolute top-4 left-4 right-4 text-white font-bold text-lg flex justify-between items-center pointer-events-none z-10">
            <div className="bg-black/50 p-2 rounded-md">Aurora Power: {score}</div>
            <div className="bg-black/50 p-2 rounded-md flex flex-col items-end">
                <span>Shield: {shield}%</span>
                <div className="w-32 h-2 bg-neutral-700 rounded mt-1"><div className="h-2 bg-green-500 rounded" style={{width: `${shield}%`}}></div></div>
            </div>
        </div>
      )}

      {gameState === 'start' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-lg pointer-events-none" onClick={resetGame}>
            <h1 className="text-5xl font-extrabold mb-4 text-sky-300">Aurora Collector</h1>
            <h2 className="text-xl font-semibold mb-6">Harness the Solar Wind!</h2>
            <div className="text-left space-y-3 mb-8">
                <p><strong>Controls:</strong> Move your mouse or finger to control the magnetic field.</p>
                <p><strong>Goal:</strong> Collect <strong className="text-green-400">Green (-Bz)</strong> particles to build Aurora Power. Avoid <strong className="text-red-400">Red (+Bz)</strong> particles that damage your shield!</p>
                <p><strong>CME Power-Up:</strong> As you collect particles, your CME meter charges. When full, click the button to unleash a particle storm for a massive score boost!</p>
            </div>
            <p className="text-2xl font-bold animate-pulse">Click anywhere to Start</p>
        </div>
      )}
      
      {gameState === 'gameOver' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-lg pointer-events-none" onClick={resetGame}>
            <h1 className="text-5xl font-extrabold mb-4 text-red-500">Shields Down!</h1>
            <h2 className="text-3xl font-semibold mb-2">Final Aurora Power: {score}</h2>
            <p className="text-xl mt-8 animate-pulse">Click anywhere to try again</p>
        </div>
      )}

      {gameState === 'playing' && (
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20">
            <button 
                id="cme-button"
                onClick={(e) => { e.stopPropagation(); activateCME(); }}
                onTouchStart={(e) => { e.stopPropagation(); activateCME(); }}
                disabled={!isCmeReady}
                className={`w-36 h-16 rounded-lg flex items-center justify-center text-black font-bold text-xl border-4 shadow-lg transition-all duration-300 ${isCmeReady ? 'bg-yellow-400/90 border-yellow-200 animate-pulse cursor-pointer' : 'bg-neutral-600/70 border-neutral-500 cursor-not-allowed'}`}
                title="Activate CME"
            >
                CME Ready!
            </button>
        </div>
      )}
    </div>
  );
};

export default AuroraCollector;
// --- END OF FILE src/components/SolarSurferGame.tsx ---