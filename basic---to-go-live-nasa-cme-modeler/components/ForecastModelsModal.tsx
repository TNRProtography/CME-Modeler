import React, { useState, useEffect, useRef } from 'react';
import CloseIcon from './icons/CloseIcon';
import LoadingSpinner from './icons/LoadingSpinner';

// Define the media object type to ensure type safety when calling setViewerMedia
type MediaObject = 
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'animation', urls: string[] };

interface ForecastModelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  setViewerMedia: (media: MediaObject | null) => void;
}

const ForecastModelsModal: React.FC<ForecastModelsModalProps> = ({ isOpen, onClose, setViewerMedia }) => {
  const [enlilImageUrls, setEnlilImageUrls] = useState<string[]>([]);
  const [isLoadingEnlil, setIsLoadingEnlil] = useState(true);
  const [enlilError, setEnlilError] = useState<string | null>(null);

  const ENLIL_BASE_URL = 'https://noaa-enlil-proxy.thenamesrock.workers.dev/';
  const MAX_FRAMES_TO_CHECK = 400;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const fetchEnlilImages = async () => {
      setIsLoadingEnlil(true);
      setEnlilError(null);
      
      const potentialUrls = Array.from({ length: MAX_FRAMES_TO_CHECK }, (_, i) => `${ENLIL_BASE_URL}${i + 1}`);
      
      const results = await Promise.allSettled(
        potentialUrls.map(url => 
          fetch(url).then(res => {
            if (!res.ok) throw new Error(`Frame load failed: ${res.status}`);
            return res.blob();
          })
        )
      );

      const successfulUrls = results
        .map(r => r.status === 'fulfilled' ? URL.createObjectURL(r.value) : null)
        .filter((url): url is string => url !== null);

      if (successfulUrls.length > 0) {
        setEnlilImageUrls(successfulUrls);
      } else {
        setEnlilError('No ENLIL images could be loaded from the proxy.');
      }
      setIsLoadingEnlil(false);
    };

    fetchEnlilImages();

    // Cleanup: revoke object URLs when component unmounts or isOpen becomes false
    return () => {
      enlilImageUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [isOpen]); // Depend on isOpen to refetch when modal opens

  if (!isOpen) return null;

  return (
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
               <p>The Heliospheric Upwind Extrapolation (HUXT) model is a fast solar wind model developed by the <a href="https://www.metoffice.gov.uk/weather/guides/space-weather" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">UK's Met Office Space Weather Operations Centre (MOSWOC)</a>. It simulates the propagation of solar wind structures, like Coronal Mass Ejections (CMEs), through the inner heliosphere.</p>
               <p className="mt-2">Unlike more complex models, HUXT simplifies the physics to run very quickly, making it ideal for real-time forecasting. It takes data from models like WSA (which provides the initial solar wind structure at the Sun) and "pushes" it outwards to predict the arrival time and speed of CMEs at Earth and other planets.</p>
            </div>
            <div className="space-y-4">
                <div onClick={() => setViewerMedia({ url: 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_forecast_latest.png', type: 'image' })} className="block bg-neutral-900 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer">
                    <h4 className="font-semibold text-center mb-2">Latest HUXT Forecast</h4>
                    <img src="https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_forecast_latest.png" alt="HUXT Forecast" className="rounded border border-neutral-700 w-full" />
                </div>
                <div onClick={() => setViewerMedia({ url: 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_animation_latest.mp4', type: 'video' })} className="block bg-neutral-900 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer">
                    <h4 className="font-semibold text-center mb-2">HUXT Animation</h4>
                    <video src="https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_animation_latest.mp4" autoPlay loop muted playsInline className="rounded w-full">Your browser does not support the video tag.</video>
                </div>
                {/* Attribution for HUXT data */}
                <p className="text-neutral-500 text-xs text-right">Data Source: <a href="https://www.metoffice.gov.uk/weather/guides/space-weather" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Met Office</a></p>
            </div>
          </section>

          {/* WSA-ENLIL Model Section */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">WSA-ENLIL (NOAA)</h3>
             <div className="text-sm text-neutral-400 leading-relaxed">
                <p>The Wang-Sheeley-Arge (WSA)-ENLIL model is the primary operational space weather forecasting model used by the <a href="https://www.swpc.noaa.gov/models/wsa-enlil" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">U.S. National Oceanic and Atmospheric Administration (NOAA)</a>. It provides a comprehensive, large-scale prediction of solar wind conditions throughout the heliosphere.</p>
                <p className="mt-2">This animation shows the model's prediction of solar wind density. Watch for dense clouds (red/yellow) erupting from the Sun (center) and traveling outwards past the planets (colored dots).</p>
            </div>
            <div 
              onClick={() => enlilImageUrls.length > 0 && setViewerMedia({ urls: enlilImageUrls, type: 'animation' })}
              className="bg-neutral-900 p-2 rounded-lg relative min-h-[300px] flex items-center justify-center hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
            >
                <h4 className="font-semibold text-center mb-2 absolute top-2 left-0 right-0">WSA-ENLIL Animation</h4>
                {isLoadingEnlil && <div className="flex flex-col items-center gap-4"><LoadingSpinner /><p className="text-neutral-400 italic">Fetching & processing forecast models...</p></div>}
                {enlilError && <p className="text-red-400 text-center">{enlilError}</p>}
                {!isLoadingEnlil && enlilImageUrls.length > 0 && (
                  <>
                    <img src={enlilImageUrls[0]} alt="ENLIL Forecast Preview" className="rounded w-full" />
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <p className="text-white text-lg font-bold">Click to Play Animation</p>
                    </div>
                  </>
                )}
            </div>
            {/* Attribution for WSA-ENLIL data */}
            <p className="text-neutral-500 text-xs text-right mt-2">Data Source: <a href="https://www.swpc.noaa.gov/models/wsa-enlil" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a></p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ForecastModelsModal;