// --- START OF FILE src/components/SolarSurferGame.tsx ---

import React, { useRef, useEffect, useState, useCallback } from 'react';
import CloseIcon from './icons/CloseIcon';

// --- TYPE DEFINITIONS ---
type GameState = 'start' | 'playing' | 'levelEnd' | 'gameOver';

interface Particle {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
}

interface Obstacle {
  x: number;
  y: number;
  z: number;
  radius: number;
  type: 'cloud' | 'ring';
  rotation: number;
  color: string;
}

interface Collectible {
  x: number;
  y: number;
  z: number;
  radius: number;
}

// --- GAME CONFIGURATION ---
const STAR_COUNT = 2000;
const PLAYER_TRAIL_LENGTH = 25;
const OBSTACLE_COUNT = 30;
const COLLECTIBLE_COUNT = 50;
const LEVEL_DISTANCE = 5000;
const INITIAL_SPEED = 3;
const MAX_SPEED = 12;

// --- COMPONENT ---
const SolarSurferGame: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameState = useRef<GameState>('start');
  const animationFrameId = useRef<number>();

  // Game state refs
  const playerPos = useRef({ x: 0, y: 0 });
  const playerTrail = useRef<{ x: number; y: number }[]>([]);
  const stars = useRef<Particle[]>([]);
  const obstacles = useRef<Obstacle[]>([]);
  const collectibles = useRef<Collectible[]>([]);
  
  const distance = useRef(0);
  const score = useRef(0);
  const cohesion = useRef(100);
  const gameSpeed = useRef(INITIAL_SPEED);
  const level = useRef(1);

  // Final gate state for level end
  const earthGateState = useRef({
    approaching: false,
    earthZ: 0,
    safeGateY: 0,
  });

  const mousePos = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

  // --- UTILITY FUNCTIONS ---
  const setupGame = useCallback((canvas: HTMLCanvasElement) => {
    const { width, height } = canvas;
    const center = { x: width / 2, y: height / 2 };

    // Initialize stars
    stars.current = [];
    for (let i = 0; i < STAR_COUNT; i++) {
      stars.current.push({
        x: (Math.random() - 0.5) * width,
        y: (Math.random() - 0.5) * height,
        z: Math.random() * width,
        px: 0,
        py: 0,
      });
    }
    
    // Initialize player trail
    playerTrail.current = Array(PLAYER_TRAIL_LENGTH).fill({ x: center.x, y: center.y });

    const spawnObstaclesAndCollectibles = () => {
        // Initialize obstacles
        obstacles.current = [];
        for (let i = 0; i < OBSTACLE_COUNT; i++) {
            const z = (i / OBSTACLE_COUNT) * LEVEL_DISTANCE + 500;
            obstacles.current.push({
                x: (Math.random() - 0.5) * width * 1.5,
                y: (Math.random() - 0.5) * height * 1.5,
                z: z,
                radius: 30 + Math.random() * 40,
                type: Math.random() > 0.4 ? 'cloud' : 'ring',
                rotation: Math.random() * Math.PI * 2,
                color: `rgba(${150 + Math.random() * 105}, 50, ${100 + Math.random() * 155}, 0.6)`,
            });
        }
        // Initialize collectibles
        collectibles.current = [];
        for (let i = 0; i < COLLECTIBLE_COUNT; i++) {
             const z = (i / COLLECTIBLE_COUNT) * LEVEL_DISTANCE + 500;
            collectibles.current.push({
                x: (Math.random() - 0.5) * width,
                y: (Math.random() - 0.5) * height,
                z: z,
                radius: 15,
            });
        }
    };
    
    spawnObstaclesAndCollectibles();

    // Reset game state
    distance.current = 0;
    score.current = 0;
    cohesion.current = 100;
    gameSpeed.current = INITIAL_SPEED + (level.current - 1) * 0.5;
    earthGateState.current = { approaching: false, earthZ: 0, safeGateY: 0 };
    gameState.current = 'playing';

  }, [level]);

  // --- MOUSE/TOUCH HANDLING ---
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mousePos.current = { x: e.clientX, y: e.clientY };
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        mousePos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
    };
  }, []);

  // --- GAME LOOP ---
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const gameLoop = () => {
      const { width, height } = canvas;
      const fov = width * 0.8;
      const center = { x: width / 2, y: height / 2 };

      // Clear canvas
      ctx.fillStyle = '#010418';
      ctx.fillRect(0, 0, width, height);
      
      if (gameState.current === 'start') {
        // Handled by React UI
      } else if (gameState.current === 'playing' || gameState.current === 'levelEnd') {
        // --- UPDATE LOGIC ---
        distance.current += gameSpeed.current;
        score.current += gameSpeed.current * 0.1;

        // Smoothly move player towards mouse
        playerPos.current.x += (mousePos.current.x - playerPos.current.x) * 0.1;
        playerPos.current.y += (mousePos.current.y - playerPos.current.y) * 0.1;
        
        // Update player trail
        playerTrail.current.push({ x: playerPos.current.x, y: playerPos.current.y });
        if (playerTrail.current.length > PLAYER_TRAIL_LENGTH) {
          playerTrail.current.shift();
        }

        // --- DRAWING LOGIC ---
        // Draw stars
        stars.current.forEach(star => {
          star.z -= gameSpeed.current;
          if (star.z <= 0) {
            star.z = width;
            star.x = (Math.random() - 0.5) * width;
            star.y = (Math.random() - 0.5) * height;
          }
          const scale = fov / (fov + star.z);
          const x = star.x * scale + center.x;
          const y = star.y * scale + center.y;
          const r = scale * 2;
          
          if (x > 0 && x < width && y > 0 && y < height) {
             ctx.beginPath();
             ctx.arc(x, y, r, 0, Math.PI * 2);
             ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + scale * 0.5})`;
             ctx.fill();
          }
        });
        
        // Draw Obstacles & check collisions
        obstacles.current.forEach(obs => {
          obs.z -= gameSpeed.current;
          if (obs.z <= 0) {
              obs.z = LEVEL_DISTANCE;
              obs.x = (Math.random() - 0.5) * width * 1.5;
              obs.y = (Math.random() - 0.5) * height * 1.5;
          }

          const scale = fov / (fov + obs.z);
          const x = obs.x * scale + center.x;
          const y = obs.y * scale + center.y;
          const r = obs.radius * scale;
          
          if (x + r > 0 && x - r < width && y + r > 0 && y - r < height) {
              if(obs.type === 'cloud') {
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
                gradient.addColorStop(0, obs.color.replace('0.6', '0.4'));
                gradient.addColorStop(1, obs.color.replace('0.6', '0'));
                ctx.fillStyle = gradient;
                ctx.fillRect(x - r, y - r, r * 2, r * 2);
              } else { // ring
                ctx.strokeStyle = obs.color;
                ctx.lineWidth = 10 * scale;
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.stroke();
              }
          }

          // Collision detection
          const distToPlayer = Math.hypot(x - playerPos.current.x, y - playerPos.current.y);
          if (obs.z < 50 && distToPlayer < r + 10) {
              cohesion.current -= 1;
              if (cohesion.current <= 0) {
                  gameState.current = 'gameOver';
              }
          }
        });

        // Draw Collectibles & check collisions
        collectibles.current.forEach(col => {
          col.z -= gameSpeed.current;
          if (col.z <= 0) {
              col.z = LEVEL_DISTANCE;
              col.x = (Math.random() - 0.5) * width;
              col.y = (Math.random() - 0.5) * height;
          }
          const scale = fov / (fov + col.z);
          const x = col.x * scale + center.x;
          const y = col.y * scale + center.y;
          const r = col.radius * scale;
          
           if (x + r > 0 && x - r < width && y + r > 0 && y - r < height) {
              ctx.beginPath();
              ctx.arc(x, y, r, 0, Math.PI * 2);
              const gradient = ctx.createRadialGradient(x,y,0,x,y,r);
              gradient.addColorStop(0, 'rgba(255, 255, 150, 1)');
              gradient.addColorStop(1, 'rgba(255, 200, 0, 0)');
              ctx.fillStyle = gradient;
              ctx.fill();
           }
            // Collision
           if (col.z < 50 && Math.hypot(x - playerPos.current.x, y - playerPos.current.y) < r + 10) {
              score.current += 500;
              col.z = LEVEL_DISTANCE; // Respawn
           }
        });

        // Draw player trail
        for (let i = 0; i < playerTrail.current.length; i++) {
          const pos = playerTrail.current[i];
          const alpha = (i / playerTrail.current.length) * 0.5;
          const radius = (i / playerTrail.current.length) * 15;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
          const gradient = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, radius);
          gradient.addColorStop(0, `rgba(150, 200, 255, ${alpha})`);
          gradient.addColorStop(0.8, `rgba(50, 100, 255, ${alpha * 0.5})`);
          gradient.addColorStop(1, `rgba(50, 100, 255, 0)`);
          ctx.fillStyle = gradient;
          ctx.fill();
        }

        // --- LEVEL END SEQUENCE ---
        if (distance.current >= LEVEL_DISTANCE && !earthGateState.current.approaching) {
          gameState.current = 'levelEnd';
          earthGateState.current = {
              approaching: true,
              earthZ: 800,
              safeGateY: center.y + (Math.random() - 0.5) * (height * 0.6)
          };
        }
        
        if (gameState.current === 'levelEnd') {
            earthGateState.current.earthZ -= gameSpeed.current * 1.5;
            const earthZ = earthGateState.current.earthZ;
            const scale = fov / (fov + earthZ);
            const earthRadius = 400 * scale;

            // Earth
            const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, earthRadius);
            gradient.addColorStop(0, '#8cb1de');
            gradient.addColorStop(0.9, '#2a6a9c');
            gradient.addColorStop(1, '#1d4f7a');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(center.x, center.y, earthRadius, 0, Math.PI * 2);
            ctx.fill();

            // Gates
            const gateHeight = 200 * scale;
            const gateWidth = 50 * scale;
            const safeY = earthGateState.current.safeGateY;
            
            // Safe Gate (Green)
            ctx.fillStyle = 'rgba(50, 255, 150, 0.8)';
            ctx.fillRect(center.x - gateWidth / 2, safeY - gateHeight / 2, gateWidth, gateHeight);
            ctx.strokeStyle = 'rgba(200, 255, 220, 1)';
            ctx.strokeRect(center.x - gateWidth / 2, safeY - gateHeight / 2, gateWidth, gateHeight);
            
            // Unsafe Gate (Red) - position it opposite to the green one
            const unsafeY = center.y - (safeY - center.y);
            ctx.fillStyle = 'rgba(255, 50, 100, 0.8)';
            ctx.fillRect(center.x - gateWidth / 2, unsafeY - gateHeight / 2, gateWidth, gateHeight);
            ctx.strokeStyle = 'rgba(255, 200, 220, 1)';
            ctx.strokeRect(center.x - gateWidth / 2, unsafeY - gateHeight / 2, gateWidth, gateHeight);

            if (earthZ < 50) {
                const playerY = playerPos.current.y;
                if (playerY > safeY - gateHeight / 2 && playerY < safeY + gateHeight / 2) {
                    // Level complete!
                    score.current += 1000 * level.current;
                    level.current += 1;
                    setupGame(canvas); // Resets for next level
                } else {
                    // Failed
                    gameState.current = 'gameOver';
                }
            }
        }

      } else if (gameState.current === 'gameOver') {
          // Handled by React UI
      }
      
      animationFrameId.current = requestAnimationFrame(gameLoop);
    };

    animationFrameId.current = requestAnimationFrame(gameLoop);
    
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [setupGame]);
  
  const startGame = () => {
    level.current = 1;
    if (canvasRef.current) {
        setupGame(canvasRef.current);
    }
  };

  const HUD = () => (
    <div className="absolute top-4 left-4 right-4 text-white font-bold text-lg flex justify-between items-center pointer-events-none">
        <div>Score: {Math.floor(score.current)}</div>
        <div className="text-center">Level: {level.current}<br/><span className="text-sm">Distance: {Math.floor(distance.current)} / {LEVEL_DISTANCE}</span></div>
        <div>
            Cohesion: {Math.max(0, Math.floor(cohesion.current))}%
            <div className="w-32 h-2 bg-neutral-700 rounded mt-1">
                <div className="h-2 bg-gradient-to-r from-sky-400 to-blue-500 rounded" style={{width: `${Math.max(0, cohesion.current)}%`}}></div>
            </div>
        </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[4000] bg-black/50 backdrop-blur-sm flex items-center justify-center">
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
      
      <button onClick={onClose} className="absolute top-5 right-5 p-2 bg-black/50 rounded-full text-white hover:bg-white/20 transition-colors z-10">
        <CloseIcon className="w-8 h-8"/>
      </button>

      {gameState.current === 'playing' || gameState.current === 'levelEnd' ? <HUD /> : null}
      
      {gameState.current === 'start' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-lg">
            <h1 className="text-5xl font-extrabold mb-4 text-amber-300">Solar Surfer</h1>
            <h2 className="text-xl font-semibold mb-6">Your Journey from the Sun to Earth!</h2>
            <div className="text-left space-y-3 mb-8">
                <p><strong>Objective:</strong> Guide your particle stream to Earth. Dodge obstacles and collect energy to score points.</p>
                <p><strong>Controls:</strong> Use your <strong>Mouse</strong> or <strong>Touch</strong> to move.</p>
                <p><strong>Hazards:</strong> Avoid plasma clouds and magnetic rings, they will reduce your cohesion.</p>
                <p><strong>The Final Gate:</strong> At the end of each level, you will approach Earth. You must pass through the <strong className="text-green-400">GREEN (Bz South)</strong> gate to create an aurora and complete the level. Hitting the <strong className="text-red-400">RED (Bz North)</strong> gate will end your journey!</p>
            </div>
            <button onClick={startGame} className="px-8 py-4 bg-sky-600 text-white font-bold text-xl rounded-lg hover:bg-sky-500 transition-transform hover:scale-105">
                Start Game
            </button>
        </div>
      )}

      {gameState.current === 'gameOver' && (
        <div className="relative z-10 text-white text-center bg-black/60 p-8 rounded-lg max-w-lg">
            <h1 className="text-5xl font-extrabold mb-4 text-red-500">Game Over</h1>
            <h2 className="text-2xl font-semibold mb-2">Final Score: {Math.floor(score.current)}</h2>
            <p className="mb-8">You completed {level.current - 1} level(s)!</p>
            <button onClick={startGame} className="px-8 py-4 bg-sky-600 text-white font-bold text-xl rounded-lg hover:bg-sky-500 transition-transform hover:scale-105">
                Play Again
            </button>
        </div>
      )}
    </div>
  );
};

export default SolarSurferGame;
// --- END OF FILE src/components/SolarSurferGame.tsx ---