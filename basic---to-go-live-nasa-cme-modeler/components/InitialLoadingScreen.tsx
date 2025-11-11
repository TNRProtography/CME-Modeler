// --- START OF FILE src/components/InitialLoadingScreen.tsx ---

import React, { useState, useEffect } from 'react';
import LoadingSpinner from './icons/LoadingSpinner';

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

interface Spark {
  id: number;
  x: number;
  y: number;
}

interface InitialLoadingScreenProps {
  isFadingOut: boolean;
}

const InitialLoadingScreen: React.FC<InitialLoadingScreenProps> = ({ isFadingOut }) => {
  const [sloganIndex, setSloganIndex] = useState(0);
  const [sparks, setSparks] = useState<Spark[]>([]);

  // Cycle through slogans
  useEffect(() => {
    const sloganTimer = setInterval(() => {
      setSloganIndex((prevIndex) => (prevIndex + 1) % SLOGANS.length);
    }, 1500);

    return () => clearInterval(sloganTimer);
  }, []);

  const handleInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    const x = 'clientX' in e ? e.clientX : e.touches[0].clientX;
    const y = 'clientY' in e ? e.clientY : e.touches[0].clientY;
    
    const newSpark: Spark = { id: Date.now(), x, y };
    setSparks((prevSparks) => [...prevSparks, newSpark]);

    // Clean up the spark after the animation ends
    setTimeout(() => {
      setSparks((prev) => prev.filter((spark) => spark.id !== newSpark.id));
    }, 1000);
  };

  return (
    <div
      className={`fixed inset-0 z-[5000] flex flex-col items-center justify-center bg-black transition-opacity duration-500 ease-in-out ${isFadingOut ? 'opacity-0' : 'opacity-100'}`}
      onMouseDown={handleInteraction}
      onTouchStart={handleInteraction}
    >
      <style>{`
        @keyframes float {
          0% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
          100% { transform: translateY(0px); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
        @keyframes spark-burst {
          0% { transform: scale(0); opacity: 1; }
          100% { transform: scale(2); opacity: 0; }
        }
        .spark {
          position: fixed;
          width: 15px;
          height: 15px;
          background-color: #0ea5e9;
          border-radius: 50%;
          pointer-events: none;
          animation: spark-burst 1s ease-out forwards;
          box-shadow: 0 0 10px #0ea5e9, 0 0 20px #0ea5e9;
        }
      `}</style>
      
      <img 
        src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" 
        alt="TNR Protography Logo"
        className="w-full max-w-xs h-auto mb-8 animate-float"
      />
      
      <div className="flex items-center space-x-4">
        <p className="text-neutral-200 text-lg font-medium tracking-wide text-center w-64 h-12 transition-opacity duration-300">
          {SLOGANS[sloganIndex]}
        </p>
      </div>

      {sparks.map((spark) => (
        <div
          key={spark.id}
          className="spark"
          style={{ left: spark.x - 7.5, top: spark.y - 7.5 }}
        />
      ))}
      
      <div className="absolute bottom-8 text-neutral-500 text-sm">
        Click or tap anywhere...
      </div>
    </div>
  );
};

export default InitialLoadingScreen;
// --- END OF FILE src/components/InitialLoadingScreen.tsx ---