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
  progress: number;
  statusText: string;
  reloadNotice?: string | null;
  reloadCountdown?: number | null;
}

const getParticleColor = (progress: number): string => {
  if (progress < 0.1) return `hsl(240, 100%, ${70 + progress * 200}%)`; // Blue-ish wake
  if (progress < 0.4) return `hsl(50, 100%, ${60 + progress * 100}%)`;  // Yellow core
  return `hsl(25, 100%, ${55 + (1-progress) * 50}%)`; // Orange/Red shock front
};

const InitialLoadingScreen: React.FC<InitialLoadingScreenProps> = ({ isFadingOut, progress, statusText, reloadNotice, reloadCountdown }) => {
  const [sloganIndex, setSloganIndex] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number>();
  const starsRef = useRef<{ x: number; y: number; r: number; o: number }[]>([]);
  const cmesRef = useRef<any[]>([]);

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
      speed: 0.2 + Math.random() * 0.1,
      halfAngle: (Math.PI / 180) * (25 + Math.random() * 15),
      particles: [] as any[],
    };

    const particleCount = 700 + Math.random() * 300;
    for (let i = 0; i < particleCount; i++) {
      const spawnProgress = Math.random(); // How far "into" the CME the particle is
      newCME.particles.push({
        angleOffset: (Math.random() - 0.5) * newCME.halfAngle * 2,
        velocity: newCME.speed * (0.8 + Math.random() * 0.4),
        size: Math.random() * 1.5 + 0.5,
        color: getParticleColor(spawnProgress),
        spawnProgress: spawnProgress,
      });
    }
    cmesRef.current.push(newCME);
  }, []);

  const handleInteraction = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = 'clientX' in e ? e.clientX - rect.left : e.touches[0].clientX - rect.top;
    const y = 'clientY' in e ? e.clientY - rect.top : e.touches[0].clientY - rect.top;

    const sunX = rect.width / 2;
    const sunY = rect.height / 2 + 150;
    const sunRadius = Math.min(rect.width, rect.height) * 0.08;

    const dx = x - sunX;
    const dy = y - sunY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < sunRadius * 1.5) { // Increase clickable area
      createCME(Math.atan2(dy, dx));
    } else {
      createCME(Math.random() * Math.PI * 2);
    }
  }, [createCME]);
  
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
      
      starsRef.current = [];
      const starCount = Math.floor((canvas.width * canvas.height) / 2000);
      for (let i = 0; i < starCount; i++) {
        starsRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: Math.random() * 1.5 * window.devicePixelRatio,
          o: Math.random() * 0.5 + 0.5,
        });
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const animate = (time: number) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      const sunX = canvas.width / 2;
      const sunY = canvas.height / 2 + 150 * window.devicePixelRatio;
      const sunRadius = Math.min(canvas.width, canvas.height) * 0.08;

      // Draw stars
      for (const star of starsRef.current) {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.o})`;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Draw Sun
      const pulse = 1 + 0.03 * Math.sin(time / 400);
      const sunGradient = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunRadius * pulse);
      sunGradient.addColorStop(0, '#fff5e6');
      sunGradient.addColorStop(0.5, '#ffcc00');
      sunGradient.addColorStop(0.9, '#ff8800');
      sunGradient.addColorStop(1, 'rgba(255, 100, 0, 0.3)');

      ctx.fillStyle = sunGradient;
      ctx.beginPath();
      ctx.arc(sunX, sunY, sunRadius * pulse, 0, Math.PI * 2);
      ctx.fill();
      
      const hotSpotPulse = sunRadius * (1 + 0.05 * Math.sin(time / 333));
      ctx.globalCompositeOperation = 'lighter';
      const hotspotGradient = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, hotSpotPulse * 0.6);
      hotspotGradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
      hotspotGradient.addColorStop(1, 'rgba(255, 200, 0, 0)');
      ctx.fillStyle = hotspotGradient;
      ctx.beginPath();
      ctx.arc(sunX, sunY, hotSpotPulse * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';


      // Draw CMEs
      cmesRef.current.forEach((cme, index) => {
        const elapsed = time - cme.creationTime;
        
        if (elapsed * cme.speed > Math.max(canvas.width, canvas.height)) {
          cmesRef.current.splice(index, 1);
          return;
        }

        cme.particles.forEach((p: any) => {
          const distance = elapsed * p.velocity;
          const particleAngle = cme.angle + p.angleOffset;
          const px = sunX + distance * Math.cos(particleAngle);
          const py = sunY + distance * Math.sin(particleAngle);

          const maxDist = Math.max(canvas.width, canvas.height) * 0.8;
          const lifeProgress = distance / maxDist;
          const alpha = Math.sin(Math.min(lifeProgress, 1.0) * Math.PI);

          ctx.fillStyle = p.color;
          ctx.globalAlpha = alpha * 0.8;
          ctx.beginPath();
          ctx.arc(px, py, p.size * window.devicePixelRatio, 0, Math.PI * 2);
          ctx.fill();
        });
        ctx.globalAlpha = 1;
      });

      animationFrameId.current = requestAnimationFrame(animate);
    };

    animationFrameId.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [createCME]);

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
      
      <div className="absolute top-1/4 flex flex-col items-center px-6">
        <img 
          src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" 
          alt="TNR Protography Logo"
          className="w-full max-w-xs h-auto mb-8 animate-pulse"
          style={{ animation: 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}
        />
        <p className="text-neutral-200 text-lg font-medium tracking-wide text-center w-80 h-12 transition-opacity duration-300">
          {statusText || SLOGANS[sloganIndex]}
        </p>
        <div className="w-80 mt-3">
          <div className="flex justify-between text-xs text-neutral-300 mb-1">
            <span>Loading data</span>
            <span>{Math.max(0, Math.min(100, Math.round(progress)))}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-white/15 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-sky-400 via-cyan-300 to-emerald-300 transition-all duration-300"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
        </div>
        {reloadNotice && (
          <div className="mt-4 w-80 rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-center text-sm text-amber-200">
            <p>{reloadNotice}</p>
            {typeof reloadCountdown === 'number' && reloadCountdown >= 0 && (
              <p className="mt-1 text-xs text-amber-100/90">Reloading in {reloadCountdown}s…</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default InitialLoadingScreen;
// --- END OF FILE src/components/InitialLoadingScreen.tsx ---