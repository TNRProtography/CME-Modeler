// --- START OF FILE src/components/easter-egg/AuroraPainter.tsx ---

import React, { useRef, useEffect, useCallback, useState } from 'react';

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

const AuroraPainter: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);
  const isPaintingRef = useRef(false);
  const [currentColor, setCurrentColor] = useState('green');
  const [brushSize, setBrushSize] = useState(2);

  const colors = [
    { name: 'green', value: 'hsl(120, 100%, 50%)' },
    { name: 'pink', value: 'hsl(320, 100%, 70%)' },
    { name: 'purple', value: 'hsl(270, 100%, 70%)' },
    { name: 'cyan', value: 'hsl(180, 100%, 60%)' },
  ];

  const createParticle = useCallback((x: number, y: number) => {
    const life = 80 + Math.random() * 50;
    particlesRef.current.push({
      id: Date.now() + Math.random(),
      x,
      y,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -0.2 - Math.random() * 0.3,
      life: life,
      maxLife: life,
      color: colors.find(c => c.name === currentColor)?.value || 'hsl(120, 100%, 50%)',
      size: (1 + Math.random() * 2) * brushSize,
    });
  }, [currentColor, brushSize]);

  const handlePointerDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    isPaintingRef.current = true;
    const { clientX, clientY } = 'touches' in e ? e.touches[0] : e;
    for (let i = 0; i < 5; i++) {
        createParticle(clientX * window.devicePixelRatio, clientY * window.devicePixelRatio);
    }
  }, [createParticle]);

  const handlePointerMove = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isPaintingRef.current) return;
    const { clientX, clientY } = 'touches' in e ? e.touches[0] : e;
    for (let i = 0; i < 5; i++) {
      createParticle(clientX * window.devicePixelRatio, clientY * window.devicePixelRatio);
    }
  }, [createParticle]);

  const handlePointerUp = useCallback(() => {
    isPaintingRef.current = false;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth * window.devicePixelRatio;
      canvas.height = window.innerHeight * window.devicePixelRatio;
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    const animate = () => {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      particlesRef.current = particlesRef.current.filter(p => p.life > 0);
      
      particlesRef.current.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;

        const alpha = Math.sin((p.life / p.maxLife) * Math.PI) * 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        gradient.addColorStop(0, `${p.color.slice(0,-1)}, ${alpha})`);
        gradient.addColorStop(1, `${p.color.slice(0,-1)}, 0)`);
        ctx.fillStyle = gradient;
        ctx.fill();
      });

      animationFrameId.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, []);

  return (
    <div className="w-full h-full bg-black">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      />
      <div className="absolute top-20 left-1/2 -translate-x-1/2 p-4 bg-neutral-900/70 backdrop-blur-sm rounded-lg border border-neutral-700/60 shadow-lg flex flex-col items-center gap-4">
        <h3 className="text-xl font-bold text-white">Aurora Painter</h3>
        <div className="flex gap-2">
            {colors.map(color => (
                <button
                    key={color.name}
                    onClick={() => setCurrentColor(color.name)}
                    className={`w-8 h-8 rounded-full border-2 transition-transform ${currentColor === color.name ? 'border-white scale-110' : 'border-neutral-500'}`}
                    style={{ backgroundColor: color.value }}
                    title={`Color: ${color.name}`}
                />
            ))}
        </div>
        <div className="flex items-center gap-2 text-white">
            <span className="text-sm">Brush Size</span>
            <input 
                type="range" 
                min="1" 
                max="5" 
                step="0.5" 
                value={brushSize} 
                onChange={(e) => setBrushSize(parseFloat(e.target.value))}
            />
        </div>
      </div>
    </div>
  );
};

export default AuroraPainter;
// --- END OF FILE src/components/easter-egg/AuroraPainter.tsx ---