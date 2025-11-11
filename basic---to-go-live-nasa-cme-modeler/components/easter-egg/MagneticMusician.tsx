// --- START OF FILE src/components/easter-egg/MagneticMusician.tsx ---

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useHighScore } from '../../hooks/useHighScore';

const NUM_CURTAINS = 4;
const COLORS = [
  'hsl(120, 100%, 60%)', // Green
  'hsl(180, 100%, 60%)', // Cyan
  'hsl(320, 100%, 70%)', // Pink
  'hsl(270, 100%, 70%)', // Purple
];

const MagneticMusician: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();

  const [gameState, setGameState] = useState<'idle' | 'showing' | 'playing' | 'gameOver'>('idle');
  const [sequence, setSequence] = useState<number[]>([]);
  const [playerSequence, setPlayerSequence] = useState<number[]>([]);
  const [score, setScore] = useState(0);
  const [flashInfo, setFlashInfo] = useState<{ index: number; alpha: number } | null>(null);
  
  const { highScore, updateHighScore } = useHighScore('magnetic-musician');

  const startGame = () => {
    setSequence([]);
    setPlayerSequence([]);
    setScore(0);
    setGameState('showing');
  };

  const nextRound = useCallback(() => {
    const nextItem = Math.floor(Math.random() * NUM_CURTAINS);
    const newSequence = [...sequence, nextItem];
    setSequence(newSequence);
    setPlayerSequence([]);
    setGameState('showing');

    newSequence.forEach((item, i) => {
      setTimeout(() => {
        setFlashInfo({ index: item, alpha: 1 });
      }, (i + 1) * 600);
    });
    
    setTimeout(() => {
        setGameState('playing');
    }, (newSequence.length + 1) * 600);

  }, [sequence]);

  useEffect(() => {
    if (gameState === 'showing' && sequence.length === 0) {
      nextRound();
    }
  }, [gameState, sequence, nextRound]);

  const handleTap = useCallback((e: React.MouseEvent) => {
    if (gameState !== 'playing' || !canvasRef.current) return;
    
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const curtainWidth = window.innerWidth / NUM_CURTAINS;
    const tappedIndex = Math.floor(x / curtainWidth);
    
    setFlashInfo({ index: tappedIndex, alpha: 1 });
    
    const newPlayerSequence = [...playerSequence, tappedIndex];
    
    if (newPlayerSequence[newPlayerSequence.length - 1] !== sequence[newPlayerSequence.length - 1]) {
      setGameState('gameOver');
      updateHighScore(score);
      return;
    }
    
    setPlayerSequence(newPlayerSequence);

    if (newPlayerSequence.length === sequence.length) {
      setScore(prev => prev + 1);
      setTimeout(() => nextRound(), 1000);
    }
  }, [gameState, playerSequence, sequence, score, nextRound, updateHighScore]);
  
  useEffect(() => {
    if (flashInfo) {
      const timer = setTimeout(() => setFlashInfo(null), 400);
      return () => clearTimeout(timer);
    }
  }, [flashInfo]);

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

      const curtainWidth = canvas.width / NUM_CURTAINS;

      for (let i = 0; i < NUM_CURTAINS; i++) {
        const curtainX = i * curtainWidth;
        const isActive = flashInfo?.index === i;
        const alpha = isActive ? flashInfo.alpha : 0.2;

        const gradient = ctx.createLinearGradient(curtainX, 0, curtainX, canvas.height);
        gradient.addColorStop(0, 'rgba(0,0,0,0)');
        gradient.addColorStop(0.5, `${COLORS[i].slice(0,-1)}, ${alpha * 0.8})`);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(curtainX, 0, curtainWidth, canvas.height);

        // Add some noise/texture for visual flair
        if (isActive) {
            ctx.fillStyle = `rgba(255,255,255, ${alpha * 0.1})`;
            for(let j=0; j<10; j++) {
                ctx.fillRect(curtainX + Math.random() * curtainWidth, 0, 2, canvas.height);
            }
        }
      }

      animationFrameId.current = requestAnimationFrame(animate);
    };

    animate();
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [flashInfo]);

  return (
    <div className="w-full h-full bg-black cursor-pointer" onClick={handleTap}>
      <canvas ref={canvasRef} className="w-full h-full" />
      <div className="absolute top-20 left-1/2 -translate-x-1/2 p-4 text-center text-white w-full max-w-md">
        <h3 className="text-3xl font-bold">Magnetic Musician</h3>
        <div className="mt-4 text-2xl">
            Score: <span className="font-bold">{score}</span>
        </div>
        {gameState === 'gameOver' && (
          <div className="mt-4 text-lg p-4 bg-neutral-800/70 rounded-lg">
            <h4 className="text-xl font-semibold text-red-500">Sequence Lost!</h4>
            <div>Final Score: {score}</div>
            <div>High Score: {highScore}</div>
            <button onClick={startGame} className="mt-4 px-4 py-2 bg-sky-600 rounded-md hover:bg-sky-700">Try Again</button>
          </div>
        )}
        {gameState === 'idle' && (
          <div className="mt-4 text-lg p-4 bg-neutral-800/70 rounded-lg">
            <p className="mb-4">Watch the aurora curtains light up, then repeat the sequence.</p>
            <button onClick={startGame} className="px-6 py-3 bg-green-600 rounded-md hover:bg-green-700 text-xl font-bold">Start Game</button>
          </div>
        )}
         {gameState === 'showing' && (
            <div className="mt-4 text-lg p-2 bg-neutral-800/70 rounded-lg">
                <p>Watch...</p>
            </div>
        )}
        {gameState === 'playing' && (
            <div className="mt-4 text-lg p-2 bg-neutral-800/70 rounded-lg">
                <p>Your turn!</p>
            </div>
        )}
      </div>
    </div>
  );
};

//export default MagneticMusician;
// --- END OF FILE src/components/easter-egg/MagneticMusician.tsx ---