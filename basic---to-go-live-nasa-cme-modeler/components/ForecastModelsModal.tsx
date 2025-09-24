// --- START OF FILE src/components/ForecastModelsModal.tsx ---

import React, { useState, useEffect, useRef } from 'react';
import CloseIcon from './icons/CloseIcon';
import LoadingSpinner from './icons/LoadingSpinner'; 
import { fetchWSAEnlilSimulations, WSAEnlilSimulation } from '../services/nasaService';

// Define the media object type to ensure type safety when calling setViewerMedia
type MediaObject = 
    | { type: 'image', url: string }
    | { type: 'video', url: string }
    | { type: 'animation', urls: string[] };

interface ForecastModelsModalProps {
  isOpen: boolean;
  onClose: () => void;
  setViewerMedia: (media: MediaObject | null) => void;
  shouldPreload?: boolean; 
}

// --- CONSTANTS for the models ---
const ENLIL_BASE_URL = 'https://noaa-enlil-proxy.thenamesrock.workers.dev/';
const MAX_FRAMES_TO_CHECK = 400;
const HUXT_ANIMATION_URL = 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_animation_latest.mp4';
const HUXT_FORECAST_IMAGE_URL = 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_forecast_latest.png';
const ELEVO_ANIMATION_URL = 'https://helioforecast.space/static/sync/elevo/elevo.mp4';
const EUHFORIA_ANIMATION_URL = 'https://swe.ssa.esa.int/DOCS/portal_images/uk_ral_euhforia_earth.mp4';

const formatNZTimestamp = (isoString: string | null | number) => {
    if (!isoString) return 'N/A';
    try { 
        const d = new Date(isoString); 
        return isNaN(d.getTime()) ? "Invalid Date" : d.toLocaleString('en-NZ', { 
            timeZone: 'Pacific/Auckland', 
            dateStyle: 'medium', 
            timeStyle: 'short' 
        }); 
    } catch { return "Invalid Date"; }
};


const ForecastModelsModal: React.FC<ForecastModelsModalProps> = ({ isOpen, onClose, setViewerMedia, shouldPreload = false }) => {
  // --- START OF MODIFICATION: State now stores the preview and the list of URLs separately ---
  const [enlilPreviewUrl, setEnlilPreviewUrl] = useState<string | null>(null);
  const [enlilAllUrls, setEnlilAllUrls] = useState<string[]>([]);
  // --- END OF MODIFICATION ---
  const [isLoadingEnlil, setIsLoadingEnlil] = useState(true);
  const [enlilError, setEnlilError] = useState<string | null>(null);
  
  const [nasaEnlilSimulations, setNasaEnlilSimulations] = useState<WSAEnlilSimulation[]>([]);
  const [isLoadingNasaEnlil, setIsLoadingNasaEnlil] = useState(true);
  const [nasaEnlilError, setNasaEnlilError] = useState<string | null>(null);

  const hasTriggeredFetch = useRef(false);

  useEffect(() => {
    const shouldStartFetching = isOpen || shouldPreload;
    if (!shouldStartFetching || hasTriggeredFetch.current) {
      return;
    }
    hasTriggeredFetch.current = true;

    const huxtImage = new Image();
    huxtImage.src = HUXT_FORECAST_IMAGE_URL;

    // --- START OF MODIFICATION: More efficient and memory-safe image fetching logic ---
    const fetchNoaaEnlilImages = async () => {
      setIsLoadingEnlil(true);
      setEnlilError(null);
      const potentialUrls = Array.from({ length: MAX_FRAMES_TO_CHECK }, (_, i) => `${ENLIL_BASE_URL}${i + 1}`);
      const validUrls: string[] = [];
      let previewUrlSet = false;

      // Check each URL sequentially to find valid frames
      for (const url of potentialUrls) {
          try {
              const response = await fetch(url, { method: 'HEAD' }); // Use HEAD to check existence without downloading the body
              if (response.ok && response.headers.get('content-type')?.startsWith('image')) {
                  validUrls.push(url);
                  // If we haven't set a preview yet, fetch the full image for the first valid frame
                  if (!previewUrlSet) {
                      const imgResponse = await fetch(url);
                      const blob = await imgResponse.blob();
                      setEnlilPreviewUrl(URL.createObjectURL(blob));
                      previewUrlSet = true;
                  }
              }
          } catch (error) {
              // This can happen if the proxy worker fails or for network errors. We can ignore it and continue.
          }
      }

      if (validUrls.length > 0) {
        setEnlilAllUrls(validUrls);
      } else {
        setEnlilError('No NOAA ENLIL images could be loaded from the proxy.');
      }
      setIsLoadingEnlil(false);
    };
    // --- END OF MODIFICATION ---

    const fetchNasaEnlil = async () => {
        setIsLoadingNasaEnlil(true);
        setNasaEnlilError(null);
        try {
            const data = await fetchWSAEnlilSimulations();
            setNasaEnlilSimulations(data);
        } catch (error) {
            setNasaEnlilError(error instanceof Error ? error.message : "An unknown error occurred.");
        }
        setIsLoadingNasaEnlil(false);
    };

    fetchNoaaEnlilImages();
    fetchNasaEnlil();

    return () => {
      if (enlilPreviewUrl) {
        URL.revokeObjectURL(enlilPreviewUrl);
      }
    };
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
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">HUXT (University of Reading)</h3>
            <div className="text-sm text-neutral-400 leading-relaxed">
               <p>The Heliospheric Upwind Extrapolation (HUXT) model is a fast solar wind model from the <a href="https://research.reading.ac.uk/met-spate/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">University of Reading</a> that simulates the propagation of solar wind and CMEs through the inner heliosphere.</p>
            </div>
            <div className="space-y-4">
                <div onClick={() => setViewerMedia({ url: HUXT_ANIMATION_URL, type: 'video' })} className="block bg-neutral-900 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer">
                    <h4 className="font-semibold text-center mb-2">HUXT Animation</h4>
                    <video src={HUXT_ANIMATION_URL} autoPlay loop muted playsInline className="rounded w-full">Your browser does not support the video tag.</video>
                </div>
                <div onClick={() => setViewerMedia({ url: HUXT_FORECAST_IMAGE_URL, type: 'image' })} className="block bg-neutral-900 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer">
                    <h4 className="font-semibold text-center mb-2">HUXT Forecast</h4>
                    <img src={HUXT_FORECAST_IMAGE_URL} alt="HUXT Forecast" className="rounded w-full" />
                </div>
                <p className="text-neutral-500 text-xs text-right">Data Source: <a href="https://research.reading.ac.uk/met-spate/huxt-forecast/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">University of Reading & Met Office</a></p>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">WSA-ENLIL Model</h3>
            <div className="text-sm text-neutral-400 leading-relaxed">
                <p>The WSA-ENLIL model is the primary operational forecasting model used by both <a href="https://www.swpc.noaa.gov/models/wsa-enlil" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA</a> and <a href="https://ccmc.gsfc.nasa.gov/models/modelinfo.php?model=ENLIL" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA</a> to predict solar wind conditions and CME arrivals.</p>
            </div>
            
            <div 
              onClick={() => enlilAllUrls.length > 0 && setViewerMedia({ urls: enlilAllUrls, type: 'animation' })}
              className="bg-neutral-900 p-2 rounded-lg relative min-h-[300px] flex items-center justify-center hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
            >
                <h4 className="font-semibold text-center mb-2 absolute top-2 left-0 right-0">WSA-ENLIL Animation (NOAA)</h4>
                {isLoadingEnlil && <div className="flex flex-col items-center gap-4"><LoadingSpinner /><p className="text-neutral-400 italic">Finding latest NOAA forecast frames...</p></div>}
                {enlilError && <p className="text-red-400 text-center">{enlilError}</p>}
                {!isLoadingEnlil && enlilPreviewUrl && (
                  <>
                    <img src={enlilPreviewUrl} alt="ENLIL Forecast Preview" className="rounded w-full" />
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <p className="text-white text-lg font-bold">Click to Play Animation ({enlilAllUrls.length} frames)</p>
                    </div>
                  </>
                )}
            </div>
             <p className="text-neutral-500 text-xs text-right mt-2">Data Source: <a href="https://www.swpc.noaa.gov/models/wsa-enlil" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NOAA SWPC</a></p>

            <div className="bg-neutral-900 p-2 rounded-lg min-h-[300px] flex flex-col">
                 <h4 className="font-semibold text-center mb-2">WSA-ENLIL Simulations (NASA)</h4>
                {isLoadingNasaEnlil && <div className="flex-grow flex items-center justify-center"><LoadingSpinner /><p className="text-neutral-400 italic ml-2">Fetching NASA simulations...</p></div>}
                {nasaEnlilError && <p className="text-red-400 text-center flex-grow flex items-center justify-center">{nasaEnlilError}</p>}
                {!isLoadingNasaEnlil && nasaEnlilSimulations.length > 0 && (
                   <div className="space-y-3 overflow-y-auto max-h-96 styled-scrollbar pr-2">
                       {nasaEnlilSimulations.slice(0, 5).map(sim => (
                           <div key={sim.simulationID} className="bg-neutral-800/60 p-3 rounded-md text-xs">
                               <div className="flex justify-between items-center mb-2">
                                   <p className="font-bold text-neutral-200">Model Time: {formatNZTimestamp(sim.modelCompletionTime)}</p>
                                   <a href={sim.link} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-sky-600 text-white rounded text-xs hover:bg-sky-500">View Model</a>
                               </div>
                               <p className="text-neutral-300">
                                   <strong>Associated CMEs:</strong> {sim.cmeIDs && Array.isArray(sim.cmeIDs) ? sim.cmeIDs.join(', ') : 'N/A'}
                               </p>
                               <p className="text-neutral-300"><strong>Estimated Shock Arrival:</strong> <span className="text-amber-300">{formatNZTimestamp(sim.estimatedShockArrivalTime)}</span></p>
                           </div>
                       ))}
                   </div>
                )}
                 {!isLoadingNasaEnlil && nasaEnlilSimulations.length === 0 && <p className="text-neutral-400 italic text-center flex-grow flex items-center justify-center">No recent NASA ENLIL simulations found.</p>}
            </div>
            <p className="text-neutral-500 text-xs text-right mt-2">Data Source: <a href="https://ccmc.gsfc.nasa.gov/tools/DONKI/" target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">NASA CCMC</a></p>
          </section>

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
// --- END OF FILE src/components/ForecastModelsModal.tsx ---