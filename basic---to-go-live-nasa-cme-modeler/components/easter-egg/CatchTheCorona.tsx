// --- START OF FILE src/components/easter-egg/CatchTheCorona.tsx ---

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useHighScore } from '../../hooks/useHighScore';

interface Burst {
  id: number;
  x: number;
  y: number;
  life: number;
  maxLife: number;
  size: number;
  points: number;
  color: string;
}

const GAME_DURATION_S = 60;

const CatchTheCorona: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  const burstsRef = useRef<Burst[]>([]);
  const lastSpawnTimeRef = useRef(0);
  
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_S);
  const [gameState, setGameState] = useState<'idle' | 'playing' | 'gameOver'>('idle');
  
  const { highScore, updateHighScore } = useHighScore('catch-the-corona');

  const startGame = () => {
    setScore(0);
    setTimeLeft(GAME_DURATION_S);
    burstsRef.current = [];
    lastSpawnTimeRef.current = 0;
    setGameState('playing');
  };

  const handleTap = useCallback((e: React.MouseEvent) => {
    if (gameState !== 'playing' || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) * window.devicePixelRatio;
    const y = (e.clientY - rect.top) * window.devicePixelRatio;
    
    let hit = false;
    burstsRef.current.forEach((burst, i) => {
      const dx = x - burst.x;
      const dy = y - burst.y;
      if (Math.sqrt(dx * dx + dy * dy) < burst.size) {
        setScore(prev => prev + burst.points);
        burstsRef.current.splice(i, 1);
        hit = true;
      }
    });

  }, [gameState]);

  useEffect(() => {
    if (gameState === 'playing') {
      const timer = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            setGameState('gameOver');
            updateHighScore(score);
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [gameState, score, updateHighScore]);

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
      ctx.fillStyle = 'black';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Spawn new bursts
      const spawnInterval = Math.max(200, 800 - score / 10);
      if (gameState === 'playing' && time - lastSpawnTimeRef.current > spawnInterval) {
        lastSpawnTimeRef.current = time;
        const rarity = Math.random();
        let color = 'hsl(120, 100%, 50%)'; // Green
        let points = 10;
        let life = 120 + Math.random() * 60; // 2-3 seconds
        let size = (30 + Math.random() * 20) * window.devicePixelRatio;
        
        if (rarity > 0.85) {
          color = 'hsl(320, 100%, 70%)'; // Pink
          points = 50;
          life = 90 + Math.random() * 30; // Faster
        } else if (rarity > 0.98) {
          color = 'hsl(0, 100%, 60%)'; // Red
          points = 200;
          life = 60 + Math.random() * 20; // Very fast
        }

        burstsRef.current.push({
          id: time,
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          life,
          maxLife: life,
          size,
          points,
          color,
        });
      }

      // Update and draw bursts
      burstsRef.current.forEach((burst, i) => {
        burst.life -= 1;
        if (burst.life <= 0) {
          burstsRef.current.splice(i, 1);
          return;
        }

        const alpha = Math.sin((burst.life / burst.maxLife) * Math.PI);
        const currentSize = burst.size * alpha;
        const gradient = ctx.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, currentSize);
        gradient.addColorStop(0, `${burst.color.slice(0,-1)}, ${alpha * 0.8})`);
        gradient.addColorStop(1, `${burst.color.slice(0,-1)}, 0)`);
        
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(burst.x, burst.y, currentSize, 0, Math.PI * 2);
        ctx.fill();
      });

      animationFrameId.current = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [gameState, score]);

  return (
    <div className="w-full h-full bg-black cursor-crosshair">
      <canvas ref={canvasRef} className="w-full h-full" onClick={handleTap} />
      <div className="absolute top-20 left-1/2 -translate-x-1/2 p-4 text-center text-white w-full max-w-md">
        <h3 className="text-3xl font-bold">Catch the Corona</h3>
        {gameState === 'playing' && (
          <div className="mt-4 text-2xl flex justify-around">
            <div>Score: <span className="font-bold">{score}</span></div>
            <div>Time: <span className="font-bold">{timeLeft}</span>s</div>
          </div>
        )}
        {gameState === 'gameOver' && (
          <div className="mt-4 text-lg p-4 bg-neutral-800/70 rounded-lg">
            <h4 className="text-xl font-semibold text-red-500">Time's Up!</h4>
            <div>Final Score: {score}</div>
            <div>High Score: {highScore}</div>
            <button onClick={startGame} className="mt-4 px-4 py-2 bg-sky-600 rounded-md hover:bg-sky-700">Play Again</button>
          </div>
        )}
        {gameState === 'idle' && (
          <div className="mt-4 text-lg p-4 bg-neutral-800/70 rounded-lg">
            <p className="mb-4">Click on the aurora bursts before they fade away. You have 60 seconds!</p>
            <button onClick={startGame} className="px-6 py-3 bg-green-600 rounded-md hover:bg-green-700 text-xl font-bold">Start Game</button>
          </div>
        )}
      </div>
    </div>
  );
};

//export default CatchTheCorona;
// --- END OF FILE src/components/easter-egg/CatchTheCorona.tsx ---