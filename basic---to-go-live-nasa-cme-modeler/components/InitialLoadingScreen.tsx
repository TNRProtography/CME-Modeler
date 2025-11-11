// --- START OF FILE src/components/InitialLoadingScreen.tsx ---

import React, { useState, useEffect, useRef, useCallback } from 'react';

const SLOGANS = [
  'Aligning planetary orbits...',
  'Riding the solar wind...',
  'Herding solar plasma...',
  'Untangling magnetic fields...',
  'Calculating cosmic forecasts...',
  'Sun-chronizing data streams...',
  'Plotting CME trajectories...',
  'Brewing a cosmic storm...',
  'Fetching data at near light speed...',
  'Warming up the simulation core...',
];

interface InitialLoadingScreenProps {
  isFadingOut: boolean;
}

const InitialLoadingScreen: React.FC<InitialLoadingScreenProps> = ({ isFadingOut }) => {
  const [sloganIndex, setSloganIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  const starsRef = useRef<{ x: number; y: number; r: number }[]>([]);
  const cmesRef = useRef<any[]>([]);

  // Cycle through slogans
  useEffect(() => {
    const sloganTimer = setInterval(() => {
      setSloganIndex((prevIndex) => (prevIndex + 1) % SLOGANS.length);
    }, 1500);
    return () => clearInterval(sloganTimer);
  }, []);

  const createCME = useCallback((angle: number) => {
    const newCME = {
      id: Date.now(),
      angle: angle,
      creationTime: performance.now(),
      speed: 0.2 + Math.random() * 0.1, // Pixels per millisecond
      halfAngle: (Math.PI / 180) * (20 + Math.random() * 15), // 20-35 degrees
      particles: [] as any[],
      color: `hsl(${Math.random() * 50 + 10}, 100%, 60%)`,
    };

    const particleCount = 500;
    for (let i = 0; i < particleCount; i++) {
      const spawnRadius = Math.random(); // 0 to 1
      const spawnAngle = (Math.random() - 0.5) * newCME.halfAngle * 2;
      newCME.particles.push({
        r: spawnRadius,
        a: spawnAngle,
        size: Math.random() * 1.5 + 0.5,
      });
    }
    cmesRef.current.push(newCME);
  }, []);

  const handleInteraction = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = 'clientX' in e ? e.clientX - rect.left : e.touches[0].clientX - rect.left;
      const y = 'clientY' in e ? e.clientY - rect.top : e.touches[0].clientY - rect.top;

      const sunX = rect.width / 2;
      const sunY = rect.height / 2;
      const sunRadius = Math.min(rect.width, rect.height) * 0.1;

      const dx = x - sunX;
      const dy = y - sunY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < sunRadius) {
        const angle = Math.atan2(dy, dx);
        createCME(angle);
      }
    },
    [createCME]
  );
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      
      // Regenerate stars on resize
      starsRef.current = [];
      const starCount = Math.floor((canvas.width * canvas.height) / 2000);
      for (let i = 0; i < starCount; i++) {
        starsRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.5,
        });
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const sunX = canvas.width / 2;
    const sunY = canvas.height / 2;
    let sunRadius = Math.min(canvas.width, canvas.height) * 0.1;

    const animate = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      sunRadius = Math.min(canvas.width, canvas.height) * 0.1;

      // Draw stars
      ctx.fillStyle = 'white';
      for (const star of starsRef.current) {
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw Sun
      const pulse = 1 + 0.05 * Math.sin(time / 500);
      const glowRadius = sunRadius * pulse * 2.5;
      const sunGradient = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius * pulse);
      sunGradient.addColorStop(0, 'rgba(255, 220, 150, 1)');
      sunGradient.addColorStop(0.6, 'rgba(255, 180, 50, 1)');
      sunGradient.addColorStop(1, 'rgba(255, 120, 0, 0.8)');
      
      ctx.shadowBlur = 40;
      ctx.shadowColor = 'rgba(255, 150, 0, 0.7)';
      ctx.fillStyle = sunGradient;
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunRadius * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Draw CMEs
      cmesRef.current.forEach((cme, index) => {
        const elapsed = time - cme.creationTime;
        const currentRadius = elapsed * cme.speed;
        
        if (currentRadius > Math.max(canvas.width, canvas.height)) {
          cmesRef.current.splice(index, 1);
          return;
        }

        ctx.fillStyle = cme.color;
        cme.particles.forEach((p: any) => {
          const particleDist = p.r * currentRadius;
          const particleAngle = cme.angle + p.a;
          const px = sunX + sunRadius + particleDist * Math.cos(particleAngle);
          const py = sunY + particleDist * Math.sin(particleAngle);
          const opacity = 1 - p.r;

          ctx.globalAlpha = opacity * 0.7;
          ctx.beginPath();
          ctx.arc(px, py, p.size, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      });

      animationFrameId.current = requestAnimationFrame(animate);
    };

    animationFrameId.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[5000] flex flex-col items-center justify-center bg-black transition-opacity duration-500 ease-in-out ${isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full -z-10"
        onMouseDown={handleInteraction}
        onTouchStart={handleInteraction}
      />
      
      <img 
        src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" 
        alt="TNR Protography Logo"
        className="w-full max-w-xs h-auto mb-8 animate-pulse"
        style={{ animation: 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
      />
      
      <div className="flex items-center space-x-4">
        <p className="text-neutral-200 text-lg font-medium tracking-wide text-center w-64 h-12 transition-opacity duration-300">
          {SLOGANS[sloganIndex]}
        </p>
      </div>
      
      <div className="absolute bottom-8 text-neutral-500 text-sm animate-pulse">
        Click the Sun...
      </div>
    </div>
  );
};

export default InitialLoadingScreen;
// --- END OF FILE src/components/InitialLoadingScreen.tsx ---