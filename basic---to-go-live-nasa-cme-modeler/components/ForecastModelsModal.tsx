import React, { useState, useEffect, useRef, useCallback } from 'react';
import CloseIcon from './icons/CloseIcon';
import PlayIcon from './icons/PlayIcon';
import PauseIcon from './icons/PauseIcon';
import NextIcon from './icons/NextIcon';
import PrevIcon from './icons/PrevIcon';
import LoadingSpinner from './icons/LoadingSpinner';

// A simple Download Icon component to be used locally
const DownloadIcon: React.FC<{className?: string}> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
);


interface ForecastModelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  setViewerMedia: (media: { url: string, type: 'image' | 'video' } | null) => void;
}

const ForecastModelsModal: React.FC<ForecastModelsModalProps> = ({ isOpen, onClose, setViewerMedia }) => {
  // --- ENLIL Animation State ---
  const [enlilImageUrls, setEnlilImageUrls] = useState<string[]>([]);
  const [currentEnlilFrame, setCurrentEnlilFrame] = useState(0);
  const [isLoadingEnlil, setIsLoadingEnlil] = useState(true);
  const [enlilError, setEnlilError] = useState<string | null>(null);
  const [isEnlilPlaying, setIsEnlilPlaying] = useState(false);
  const intervalRef = useRef<number | null>(null);
  const ENLIL_BASE_URL = 'https://noaa-enlil-proxy.thenamesrock.workers.dev/';
  const MAX_FRAMES_TO_CHECK = 400; // Check for up to 400 frames

  // --- Fetching Logic for ENLIL Frames ---
  useEffect(() => {
    if (!isOpen) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setIsEnlilPlaying(false);
        return;
    }

    const fetchEnlilImages = async () => {
      setIsLoadingEnlil(true);
      setEnlilError(null);
      setEnlilImageUrls([]);

      try {
        // Create an array of potential URLs
        const potentialFrameNumbers = Array.from({ length: MAX_FRAMES_TO_CHECK }, (_, i) => i + 1);
        const potentialUrls = potentialFrameNumbers.map(num => `${ENLIL_BASE_URL}${num}`);
        
        // Use Promise.allSettled to fetch all images and see which ones succeed
        const results = await Promise.allSettled(potentialUrls.map(url => 
            fetch(url).then(res => {
                if (!res.ok) throw new Error(`Failed to load ${url}`);
                return res.blob(); // We get the blob to preload
            })
        ));
        
        const successfulUrls: string[] = [];
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            const blobUrl = URL.createObjectURL(result.value);
            successfulUrls.push(blobUrl);
          }
        });

        if (successfulUrls.length > 0) {
          setEnlilImageUrls(successfulUrls);
        } else {
          throw new Error('No ENLIL images could be loaded from the proxy.');
        }

      } catch (error) {
        console.error("Error fetching ENLIL images:", error);
        setEnlilError(error instanceof Error ? error.message : "An unknown error occurred.");
        setEnlilImageUrls([]);
      } finally {
        setIsLoadingEnlil(false);
      }
    };

    fetchEnlilImages();
    
    // Cleanup blobs on component unmount
    return () => {
        enlilImageUrls.forEach(url => URL.revokeObjectURL(url));
        if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [isOpen]);

  // --- Animation Playback Logic ---
   useEffect(() => {
    if (isEnlilPlaying && enlilImageUrls.length > 0) {
      intervalRef.current = window.setInterval(() => {
        setCurrentEnlilFrame((prevFrame) => (prevFrame + 1) % enlilImageUrls.length);
      }, 1000 / 12); // 12 FPS
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isEnlilPlaying, enlilImageUrls]);

  const handlePlayPause = () => {
    setIsEnlilPlaying(prev => !prev);
  };
  
  const handleStep = (direction: 1 | -1) => {
    setIsEnlilPlaying(false);
    setCurrentEnlilFrame(prev => (prev + direction + enlilImageUrls.length) % enlilImageUrls.length);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsEnlilPlaying(false);
    setCurrentEnlilFrame(Number(e.target.value));
  };
  
  const handleDownload = () => {
      const url = enlilImageUrls[currentEnlilFrame];
      if(!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.download = `enlil_frame_${currentEnlilFrame + 1}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
  };


  if (!isOpen) return null;

  return (
    <>
      <div 
        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex justify-center items-center p-4"
        onClick={onClose}
      >
        <div 
          className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] text-neutral-300 flex flex-col"
          onClick={(e: React.MouseEvent) => e.stopPropagation()}
        >
          <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
            <h2 className="text-2xl font-bold text-neutral-200">Other CME Forecast Models</h2>
            <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
              <CloseIcon className="w-6 h-6" />
            </button>
          </div>
          
          <div className="overflow-y-auto p-5 styled-scrollbar pr-4 grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* HUXT Model Section */}
            <section className="space-y-4">
              <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">HUXT (Met Office)</h3>
              <div className="text-sm text-neutral-400 leading-relaxed">
                 <p>
                    The Heliospheric Upwind Extrapolation (HUXT) model is a fast solar wind model developed by the UK's Met Office Space Weather Operations Centre (MOSWOC). It simulates the propagation of solar wind structures, like Coronal Mass Ejections (CMEs), through the inner heliosphere.
                </p>
                <p className="mt-2">
                    Unlike more complex models, HUXT simplifies the physics to run very quickly, making it ideal for real-time forecasting. It takes data from models like WSA (which provides the initial solar wind structure at the Sun) and "pushes" it outwards to predict the arrival time and speed of CMEs at Earth and other planets.
                </p>
              </div>
              <div className="space-y-4">
                  <div 
                    onClick={() => setViewerMedia({ url: 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_forecast_latest.png', type: 'image' })}
                    className="block bg-neutral-900 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
                  >
                      <h4 className="font-semibold text-center mb-2">Latest HUXT Forecast</h4>
                      <img 
                          src="https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_forecast_latest.png" 
                          alt="HUXT Forecast" 
                          className="rounded border border-neutral-700 w-full" 
                      />
                  </div>
                  <div 
                    onClick={() => setViewerMedia({ url: 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_animation_latest.mp4', type: 'video' })}
                    className="block bg-neutral-900 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
                  >
                      <h4 className="font-semibold text-center mb-2">HUXT Animation</h4>
                      <video 
                          src="https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_animation_latest.mp4"
                          autoPlay loop muted playsInline className="rounded w-full"
                      >
                          Your browser does not support the video tag.
                      </video>
                  </div>
              </div>
            </section>

            {/* WSA-ENLIL Model Section */}
            <section className="space-y-4 flex flex-col">
              <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">WSA-ENLIL (NOAA)</h3>
               <div className="text-sm text-neutral-400 leading-relaxed">
                  <p>
                    The Wang-Sheeley-Arge (WSA)-ENLIL model is the primary operational space weather forecasting model used by the U.S. National Oceanic and Atmospheric Administration (NOAA). It provides a comprehensive, large-scale prediction of solar wind conditions throughout the heliosphere.
                  </p>
                  <p className="mt-2">
                    This animation shows the model's prediction of solar wind density. Watch for dense clouds (red/yellow) erupting from the Sun (center) and traveling outwards past the planets (colored dots).
                  </p>
              </div>
              <div className="bg-neutral-900 p-3 rounded-lg flex-grow flex flex-col justify-center items-center">
                  {isLoadingEnlil && <div className="flex flex-col items-center gap-4"><LoadingSpinner /><p className="text-neutral-400 italic">Loading ENLIL animation frames...</p></div>}
                  {enlilError && <p className="text-red-400 text-center">Could not load ENLIL animation.<br/>{enlilError}</p>}
                  {!isLoadingEnlil && enlilImageUrls.length > 0 && (
                    <div className='w-full'>
                      <div className='relative w-full aspect-square'>
                          <img
                            src={enlilImageUrls[currentEnlilFrame]}
                            alt="ENLIL Forecast Animation"
                            className="rounded w-full h-full object-contain"
                          />
                      </div>
                      <div className='space-y-3 mt-3'>
                        <input
                            type="range"
                            min="0"
                            max={enlilImageUrls.length - 1}
                            value={currentEnlilFrame}
                            onChange={handleScrub}
                            className="w-full h-2 bg-neutral-700 rounded-lg appearance-none cursor-pointer"
                        />
                        <div className="flex justify-center items-center gap-3">
                            <button onClick={() => handleStep(-1)} className="p-2 bg-neutral-800 rounded-full hover:bg-neutral-700"><PrevIcon className="w-5 h-5"/></button>
                            <button onClick={handlePlayPause} className="p-3 bg-sky-600 rounded-full hover:bg-sky-500">
                                {isEnlilPlaying ? <PauseIcon className="w-6 h-6"/> : <PlayIcon className="w-6 h-6"/>}
                            </button>
                            <button onClick={() => handleStep(1)} className="p-2 bg-neutral-800 rounded-full hover:bg-neutral-700"><NextIcon className="w-5 h-5"/></button>
                            <button onClick={handleDownload} className="p-2 bg-neutral-800 rounded-full hover:bg-neutral-700" title="Download Current Frame">
                                <DownloadIcon className="w-6 h-6" />
                            </button>
                        </div>
                         <div className="text-center text-xs text-neutral-400">
                            Frame: {currentEnlilFrame + 1} / {enlilImageUrls.length}
                        </div>
                      </div>
                    </div>
                  )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
};

export default ForecastModelsModal;