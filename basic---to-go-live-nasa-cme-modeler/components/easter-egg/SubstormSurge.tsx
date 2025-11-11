// --- START OF FILE src/components/easter-egg/SubstormSurge.tsx ---

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useHighScore } from '../../hooks/useHighScore';

interface Particle {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  startTime: number;
  duration: number;
  active: boolean;
}

interface Effect {
  id: number;
  x: number;
  y: number;
  radius: number;
  alpha: number;
  color: string;
}

const SubstormSurge: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
  const effectsRef = useRef<Effect[]>([]);
  const lastSpawnTimeRef = useRef(0);
  
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [misses, setMisses] = useState(0);
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameOver'>('idle');
  
  const { highScore, updateHighScore } = useHighScore('substorm-surge');

  const startGame = () => {
    setScore(0);
    setStreak(0);
    setMisses(0);
    particlesRef.current = [];
    effectsRef.current = [];
    lastSpawnTimeRef.current = 0;
    setGameState('playing');
  };

  const handleTap = useCallback(() => {
    if (gameState !== 'playing' || !canvasRef.current) return;

    const now = performance.now();
    const targetX = canvasRef.current.width / 2;
    const hitWindow = 50; // pixels
    let hit = false;

    particlesRef.current.forEach(p => {
      if (p.active && Math.abs(p.x - targetX) < hitWindow) {
        p.active = false;
        hit = true;
        setScore(prev => prev + 10 + streak * 2);
        setStreak(prev => prev + 1);
        effectsRef.current.push({ id: Date.now(), x: p.x, y: p.y, radius: 0, alpha: 1, color: '255, 255, 255' });
      }
    });

    if (!hit) {
      setStreak(0);
      setMisses(prev => prev + 1);
      effectsRef.current.push({ id: Date.now(), x: targetX, y: canvasRef.current.height * 0.75, radius: 0, alpha: 0.8, color: '255, 50, 50' });
    }
  }, [gameState, streak]);

  useEffect(() => {
    if (misses >= 5 && gameState === 'playing') {
      setGameState('gameOver');
      updateHighScore(score);
    }
  }, [misses, score, updateHighScore, gameState]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const animate = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // --- Draw Aurora Arc ---
      const arcY = canvas.height * 0.75;
      const arcRadius = canvas.width * 0.4;
      const arcGradient = ctx.createRadialGradient(canvas.width / 2, arcY + arcRadius, 0, canvas.width / 2, arcY + arcRadius, arcRadius);
      const baseOpacity = 0.3 + streak * 0.02;
      arcGradient.addColorStop(0, `rgba(50, 205, 50, ${baseOpacity})`);
      arcGradient.addColorStop(1, `rgba(50, 205, 50, 0)`);
      ctx.fillStyle = arcGradient;
      ctx.beginPath();
      ctx.arc(canvas.width / 2, arcY + arcRadius, arcRadius, Math.PI, 2 * Math.PI);
      ctx.fill();

      // --- Draw Target Zone ---
      if (gameState === 'playing') {
        ctx.strokeStyle = `rgba(255, 255, 255, 0.5)`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(canvas.width / 2, arcY - 30);
        ctx.lineTo(canvas.width / 2, arcY + 10);
        ctx.stroke();
      }
      
      // --- Spawn Particles ---
      const spawnInterval = Math.max(500, 2000 - streak * 50);
      if (gameState === 'playing' && time - lastSpawnTimeRef.current > spawnInterval) {
        lastSpawnTimeRef.current = time;
        const fromLeft = Math.random() > 0.5;
        const startY = arcY - Math.random() * 50;
        particlesRef.current.push({
          id: time,
          x: fromLeft ? 0 : canvas.width,
          y: startY,
          startX: fromLeft ? 0 : canvas.width,
          startY,
          endX: canvas.width / 2,
          endY: arcY,
          startTime: time,
          duration: 3000,
          active: true,
        });
      }

      // --- Update & Draw Particles ---
      particlesRef.current.forEach((p, i) => {
        const elapsed = time - p.startTime;
        if (elapsed > p.duration) {
          if (p.active) {
            setStreak(0);
            setMisses(prev => prev + 1);
          }
          particlesRef.current.splice(i, 1);
          return;
        }
        const progress = elapsed / p.duration;
        p.x = p.startX + (p.endX - p.startX) * progress;
        p.y = p.startY + (p.endY - p.startY) * progress;

        ctx.fillStyle = `rgba(255, 255, 224, 0.8)`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5 * window.devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      });

      // --- Update & Draw Effects ---
      effectsRef.current.forEach((e, i) => {
        e.radius += 20;
        e.alpha -= 0.04;
        if (e.alpha <= 0) {
          effectsRef.current.splice(i, 1);
          return;
        }
        ctx.strokeStyle = `rgba(${e.color}, ${e.alpha})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
        ctx.stroke();
      });

      animationFrameId.current = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [gameState]);

  return (
    <div className="w-full h-full bg-black cursor-pointer" onClick={handleTap}>
      <canvas ref={canvasRef} className="w-full h-full" />
      <div className="absolute top-20 left-1/2 -translate-x-1/2 p-4 text-center text-white">
        <h3 className="text-3xl font-bold">Substorm Surge</h3>
        {gameState === 'playing' && (
          <div className="mt-4 text-lg">
            <div>Score: {score}</div>
            <div>Streak: {streak}</div>
            <div>Misses: {5 - misses} left</div>
          </div>
        )}
        {gameState === 'gameOver' && (
          <div className="mt-4 text-lg p-4 bg-neutral-800/70 rounded-lg">
            <h4 className="text-xl font-semibold text-red-500">Game Over</h4>
            <div>Final Score: {score}</div>
            <div>High Score: {highScore}</div>
            <button onClick={startGame} className="mt-4 px-4 py-2 bg-sky-600 rounded-md hover:bg-sky-700">Play Again</button>
          </div>
        )}
        {gameState === 'idle' && (
          <div className="mt-4 text-lg p-4 bg-neutral-800/70 rounded-lg">
            <p className="mb-4">Tap when the energy particles reach the center line to trigger a substorm!</p>
            <button onClick={startGame} className="px-6 py-3 bg-green-600 rounded-md hover:bg-green-700 text-xl font-bold">Start Game</button>
          </div>
        )}
      </div>
    </div>
  );
};

//export default SubstormSurge;
// --- END OF FILE src/components/easter-egg/SubstormSurge.tsx ---