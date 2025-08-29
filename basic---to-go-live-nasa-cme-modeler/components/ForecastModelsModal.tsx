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
  // ADDED: New prop to trigger preloading from the parent component
  shouldPreload?: boolean; 
}

// --- CONSTANTS for the models ---
const ENLIL_BASE_URL = 'https://noaa-enlil-proxy.thenamesrock.workers.dev/';
const MAX_FRAMES_TO_CHECK = 400;
const HUXT_ANIMATION_URL = 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_animation_latest.mp4';
// ADDED: URL for the new static HUXT image
const HUXT_FORECAST_IMAGE_URL = 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_forecast_latest.png';
const ELEVO_ANIMATION_URL = 'https://helioforecast.space/static/sync/elevo/elevo.mp4';
const EUHFORIA_ANIMATION_URL = 'https://swe.ssa.esa.int/DOCS/portal_images/uk_ral_euhforia_earth.mp4';


const ForecastModelsModal: React.FC<ForecastModelsModalProps> = ({ isOpen, onClose, setViewerMedia, shouldPreload = false }) => {
  const [enlilImageUrls, setEnlilImageUrls] = useState<string[]>([]);
  const [isLoadingEnlil, setIsLoadingEnlil] = useState(true);
  const [enlilError, setEnlilError] = useState<string | null>(null);

  // Use a ref to prevent fetching data multiple times
  const hasTriggeredFetch = useRef(false);

  useEffect(() => {
    // Condition to start fetching: either the modal is open or the parent wants to preload
    const shouldStartFetching = isOpen || shouldPreload;

    // Exit if we shouldn't fetch yet or if the fetch has already been started
    if (!shouldStartFetching || hasTriggeredFetch.current) {
      return;
    }

    // Mark that we are starting the fetch process
    hasTriggeredFetch.current = true;

    // --- Preload the static HUXT image ---
    const huxtImage = new Image();
    huxtImage.src = HUXT_FORECAST_IMAGE_URL;

    // --- Fetch the ENLIL animation frames ---
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

    // Cleanup: revoke object URLs when component unmounts
    return () => {
      enlilImageUrls.forEach(url => URL.revokeObjectURL(url));
    };
    // Depend on both isOpen and shouldPreload to trigger the effect
  }, [isOpen, shouldPreload]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[3000] flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div 
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-6xl max-h-[90vh] text-neutral-300 flex flex-col"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h2 className="text-2xl font-bold text-neutral-200">Official CME Forecast Models</h2>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* HUXT Model Section */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">HUXT (University of Reading)</h3>
            <div className="text-sm text-neutral-400 leading-relaxed">
               <p>The Heliospheric Upwind Extrapolation (HUXT) model is a fast solar wind model from the <a href="https://research.reading.ac.uk/met-spate/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">University of Reading</a> that simulates the propagation of solar wind and CMEs through the inner heliosphere.</p>
            </div>
            {/* MODIFIED: Container for HUXT visualizations */}
            <div className="space-y-4">
                <div onClick={() => setViewerMedia({ url: HUXT_ANIMATION_URL, type: 'video' })} className="block bg-neutral-900 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer">
                    <h4 className="font-semibold text-center mb-2">HUXT Animation</h4>
                    <video src={HUXT_ANIMATION_URL} autoPlay loop muted playsInline className="rounded w-full">Your browser does not support the video tag.</video>
                </div>

                {/* --- ADDED: New HUXT Forecast Image --- */}
                <div onClick={() => setViewerMedia({ url: HUXT_FORECAST_IMAGE_URL, type: 'image' })} className="block bg-neutral-900 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer">
                    <h4 className="font-semibold text-center mb-2">HUXT Forecast</h4>
                    <img src={HUXT_FORECAST_IMAGE_URL} alt="HUXT Forecast" className="rounded w-full" />
                </div>
                {/* --- END ADDED SECTION --- */}

                <p className="text-neutral-500 text-xs text-right">Data Source: <a href="https://research.reading.ac.uk/met-spate/huxt-forecast/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">University of Reading & Met Office</a></p>
            </div>
          </section>

          {/* WSA-ENLIL Model Section */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">WSA-ENLIL (NOAA)</h3>
             <div className="text-sm text-neutral-400 leading-relaxed">
                <p>The WSA-ENLIL model is the primary operational forecasting model used by the <a href="https://www.swpc.noaa.gov/models/wsa-enlil" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">U.S. National Oceanic and Atmospheric Administration (NOAA)</a> to predict solar wind conditions.</p>
            </div>
            <div 
              onClick={() => enlilImageUrls.length > 0 && setViewerMedia({ urls: enlilImageUrls, type: 'animation' })}
              className="bg-neutral-900 p-2 rounded-lg relative min-h-[300px] flex items-center justify-center hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
            >
                <h4 className="font-semibold text-center mb-2 absolute top-2 left-0 right-0">WSA-ENLIL Animation</h4>
                {isLoadingEnlil && <div className="flex flex-col items-center gap-4"><LoadingSpinner /><p className="text-neutral-400 italic">Fetching & processing forecast...</p></div>}
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
            <p className="text-neutral-500 text-xs text-right mt-2">Data Source: <a href="https://www.swpc.noaa.gov/models/wsa-enlil" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a></p>
          </section>

          {/* ELEVO Model Section */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">ELEVO (Helio4Cast)</h3>
             <div className="text-sm text-neutral-400 leading-relaxed">
                <p>The Ellipse Evolution (ELEvo) model is a drag-based method used to predict CME arrival times. It is developed and maintained by the <a href="https://helioforecast.space/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Helio4Cast</a> group at GeoSphere Austria.</p>
            </div>
            <div 
              onClick={() => setViewerMedia({ url: ELEVO_ANIMATION_URL, type: 'video' })}
              className="bg-neutral-900 p-2 rounded-lg relative min-h-[300px] flex items-center justify-center hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
            >
                <h4 className="font-semibold text-center mb-2 absolute top-2 left-0 right-0">ELEVO Animation</h4>
                <video src={ELEVO_ANIMATION_URL} autoPlay loop muted playsInline className="rounded w-full">Your browser does not support the video tag.</video>
            </div>
            <p className="text-neutral-500 text-xs text-right mt-2">Data Source: <a href="https://helioforecast.space/cme" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">Helio4Cast</a></p>
          </section>

          {/* EUHFORIA Model Section */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">EUHFORIA (ESA)</h3>
             <div className="text-sm text-neutral-400 leading-relaxed">
                <p>EUHFORIA is a 3D magnetohydrodynamic (MHD) model that simulates the journey of CMEs through the heliosphere. It is used for operational space weather forecasting by the <a href="https://swe.ssa.esa.int/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">European Space Agency (ESA)</a>.</p>
            </div>
            <div 
              onClick={() => setViewerMedia({ url: EUHFORIA_ANIMATION_URL, type: 'video' })}
              className="bg-neutral-900 p-2 rounded-lg relative min-h-[300px] flex items-center justify-center hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
            >
                <h4 className="font-semibold text-center mb-2 absolute top-2 left-0 right-0">EUHFORIA Animation</h4>
                <video src={EUHFORIA_ANIMATION_URL} autoPlay loop muted playsInline className="rounded w-full">Your browser does not support the video tag.</video>
            </div>
            <p className="text-neutral-500 text-xs text-right mt-2">Data Source: <a href="https://swe.ssa.esa.int/heliospheric-weather" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">ESA Space Weather Network</a></p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ForecastModelsModal;