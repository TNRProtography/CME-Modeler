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
  
  // Use a ref for stars so we don't re-allocate arrays constantly
  const starsRef = useRef<{ x: number; y: number; z: number; o: number }[]>([]);

  useEffect(() => {
    const sloganTimer = setInterval(() => {
      setSloganIndex((prevIndex) => (prevIndex + 1) % SLOGANS.length);
    }, 2000);
    return () => clearInterval(sloganTimer);
  }, []);

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
      
      // Initialize stars with a Z depth for warp effect
      starsRef.current = [];
      const starCount = Math.floor((canvas.width * canvas.height) / 1000);
      for (let i = 0; i < starCount; i++) {
        starsRef.current.push({
          x: (Math.random() - 0.5) * canvas.width,
          y: (Math.random() - 0.5) * canvas.height,
          z: Math.random() * canvas.width, // Depth
          o: Math.random(),
        });
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    const animate = (time: number) => {
      // Fade effect for trails
      ctx.fillStyle = 'rgba(0, 0, 0, 0.2)'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;

      // 1. Draw Warp Stars
      const speed = 5;
      ctx.fillStyle = '#ffffff';
      
      starsRef.current.forEach((star) => {
        star.z -= speed;
        if (star.z <= 0) {
          star.z = canvas.width;
          star.x = (Math.random() - 0.5) * canvas.width;
          star.y = (Math.random() - 0.5) * canvas.height;
        }

        const k = 128.0 / star.z;
        const px = star.x * k + cx;
        const py = star.y * k + cy;

        if (px >= 0 && px <= canvas.width && py >= 0 && py <= canvas.height) {
          const size = (1 - star.z / canvas.width) * 2.5;
          const alpha = (1 - star.z / canvas.width);
          ctx.globalAlpha = alpha;
          ctx.beginPath();
          ctx.arc(px, py, size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1.0;

      // 2. Draw Stylized Sun
      const sunY = cy - 50 * window.devicePixelRatio; // Move slightly up
      const sunRadius = Math.min(canvas.width, canvas.height) * 0.12;
      
      // Outer Glow
      const pulse = 1 + 0.05 * Math.sin(time / 500);
      const glowGrad = ctx.createRadialGradient(cx, sunY, sunRadius * 0.5, cx, sunY, sunRadius * 2.5 * pulse);
      glowGrad.addColorStop(0, 'rgba(253, 184, 19, 0.8)');
      glowGrad.addColorStop(0.4, 'rgba(255, 100, 0, 0.2)');
      glowGrad.addColorStop(1, 'rgba(255, 50, 0, 0)');
      
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(cx, sunY, sunRadius * 3, 0, Math.PI * 2);
      ctx.fill();

      // Core
      const coreGrad = ctx.createRadialGradient(cx, sunY, 0, cx, sunY, sunRadius);
      coreGrad.addColorStop(0, '#fff');
      coreGrad.addColorStop(0.3, '#fdb813');
      coreGrad.addColorStop(0.8, '#f5821f');
      coreGrad.addColorStop(1, '#b93d00');

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, sunY, sunRadius, 0, Math.PI * 2);
      ctx.fill();

      animationFrameId.current = requestAnimationFrame(animate);
    };

    animationFrameId.current = requestAnimationFrame(animate);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[5000] flex flex-col items-center justify-center bg-black transition-opacity duration-1000 ease-in-out ${isFadingOut ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
    >
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full"
      />
      
      <div className="absolute bottom-1/4 flex flex-col items-center z-10">
        <img 
          src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" 
          alt="TNR Protography Logo"
          className="w-48 h-auto mb-6 drop-shadow-[0_0_15px_rgba(0,0,0,0.8)]"
        />
        <div className="h-8 flex items-center justify-center">
            <p className="text-sky-300 font-mono text-sm tracking-widest uppercase animate-pulse">
            {SLOGANS[sloganIndex]}
            </p>
        </div>
      </div>
    </div>
  );
};

export default InitialLoadingScreen;