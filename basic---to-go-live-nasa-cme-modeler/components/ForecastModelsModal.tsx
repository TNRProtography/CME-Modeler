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
}

// --- CONSTANTS for the models ---
const ENLIL_BASE_URL = 'https://noaa-enlil-proxy.thenamesrock.workers.dev/';
const MAX_FRAMES_TO_CHECK = 400;
const HUXT_ANIMATION_URL = 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_animation_latest.mp4';
const HUXT_FORECAST_IMAGE_URL = 'https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_forecast_latest.png';
const ELEVO_ANIMATION_URL = 'https://helioforecast.space/static/sync/elevo/elevo.mp4';
const EUHFORIA_ANIMATION_URL = 'https://swe.ssa.esa.int/DOCS/portal_images/uk_ral_euhforia_earth.mp4';

// --- HELPERS ---
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

const generateEnlilGifUrl = (simulation: WSAEnlilSimulation): string | null => {
  if (!simulation.modelCompletionTime || !simulation.simulationID) {
    return null;
  }
  try {
    const date = new Date(simulation.modelCompletionTime);
    const year = date.getUTCFullYear();
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    const dateTimeString = `${year}${month}${day}_${hours}${minutes}${seconds}`;
    const versionMatch = simulation.simulationID.match(/(\d+\.\d+)$/);
    const version = versionMatch?.[1] || '2.0'; // Default to 2.0 if parsing fails
    return `https://iswa.gsfc.nasa.gov/downloads/${dateTimeString}_${version}_anim.tim-den.gif`;
  } catch (error) {
    console.error("Error generating ENLIL GIF URL:", error);
    return null;
  }
};


const ModelCard: React.FC<{ title: string; source: string; sourceUrl: string; children: React.ReactNode; description: React.ReactNode; }> = ({ title, source, sourceUrl, children, description }) => (
    <section className="bg-neutral-900/70 border border-neutral-700/60 rounded-lg p-4 flex flex-col">
        <h3 className="text-xl font-semibold text-neutral-200 border-b border-neutral-600 pb-2 mb-3">{title}</h3>
        <div className="text-sm text-neutral-400 leading-relaxed mb-4">
            {description}
        </div>
        <div className="flex-grow space-y-4">
            {children}
        </div>
        <p className="text-neutral-500 text-xs text-right mt-3 pt-2 border-t border-neutral-700/50">
            Data Source: <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:underline">{source}</a>
        </p>
    </section>
);


const ForecastModelsModal: React.FC<ForecastModelsModalProps> = ({ isOpen, onClose, setViewerMedia }) => {
  const [noaaEnlilUrls, setNoaaEnlilUrls] = useState<string[]>([]);
  const [isLoadingNoaaEnlil, setIsLoadingNoaaEnlil] = useState(true);
  const [noaaEnlilError, setNoaaEnlilError] = useState<string | null>(null);
  
  const [nasaEnlilSimulations, setNasaEnlilSimulations] = useState<WSAEnlilSimulation[]>([]);
  const [isLoadingNasaEnlil, setIsLoadingNasaEnlil] = useState(true);
  const [nasaEnlilError, setNasaEnlilError] = useState<string | null>(null);

  const hasTriggeredFetch = useRef(false);

  useEffect(() => {
    if (!isOpen || hasTriggeredFetch.current) {
      return;
    }
    hasTriggeredFetch.current = true;

    const huxtImage = new Image();
    huxtImage.src = HUXT_FORECAST_IMAGE_URL;

    const fetchNoaaEnlilImages = async () => {
      setIsLoadingNoaaEnlil(true);
      setNoaaEnlilError(null);
      try {
        const potentialUrls = Array.from({ length: MAX_FRAMES_TO_CHECK }, (_, i) => `${ENLIL_BASE_URL}${i + 1}`);
        const results = await Promise.allSettled(
          potentialUrls.map(url => fetch(url, { signal: AbortSignal.timeout(5000) }).then(res => {
              if (!res.ok) throw new Error(`Frame load failed: ${res.status}`);
              return res.blob();
          }))
        );
        const successfulUrls = results
          .map(r => r.status === 'fulfilled' ? URL.createObjectURL(r.value) : null)
          .filter((url): url is string => url !== null);

        if (successfulUrls.length > 0) {
          setNoaaEnlilUrls(successfulUrls);
        } else {
          setNoaaEnlilError('No NOAA ENLIL images could be loaded. The proxy may be down or has no new data.');
        }
      } catch (error) {
          setNoaaEnlilError(error instanceof Error ? error.message : "An unknown error occurred.");
      } finally {
        setIsLoadingNoaaEnlil(false);
      }
    };

    const fetchNasaEnlilList = async () => {
        setIsLoadingNasaEnlil(true);
        setNasaEnlilError(null);
        try {
            const data = await fetchWSAEnlilSimulations();
            const sortedData = data.sort((a, b) => {
                if (a.isEarthGB && !b.isEarthGB) return -1;
                if (!a.isEarthGB && b.isEarthGB) return 1;
                return new Date(b.modelCompletionTime).getTime() - new Date(a.modelCompletionTime).getTime();
            });
            setNasaEnlilSimulations(sortedData);
        } catch (error) {
            setNasaEnlilError(error instanceof Error ? error.message : "An unknown error occurred.");
        }
        setIsLoadingNasaEnlil(false);
    };

    fetchNoaaEnlilImages();
    fetchNasaEnlilList();

    return () => {
      noaaEnlilUrls.forEach(url => URL.revokeObjectURL(url));
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[3000] flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div 
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-7xl max-h-[90vh] text-neutral-300 flex flex-col"
        onClick={(e: React.MouseEvent) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80 flex-shrink-0">
          <h2 className="text-2xl font-bold text-neutral-200">Official CME Forecast Models</h2>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="overflow-y-auto p-5 styled-scrollbar pr-4 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6">
          
          <ModelCard 
            title="HUXT" 
            source="University of Reading" 
            sourceUrl="https://research.reading.ac.uk/met-spate/huxt-forecast/"
            description={<p>A fast solar wind model that simulates CME propagation through the inner heliosphere.</p>}
          >
            <div onClick={() => setViewerMedia({ url: HUXT_ANIMATION_URL, type: 'video' })} className="block bg-neutral-800/50 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer">
                <h4 className="font-semibold text-center mb-2 text-neutral-300">HUXT Animation</h4>
                <video src={HUXT_ANIMATION_URL} autoPlay loop muted playsInline className="rounded w-full aspect-square object-cover bg-black">Your browser does not support the video tag.</video>
            </div>
            <div onClick={() => setViewerMedia({ url: HUXT_FORECAST_IMAGE_URL, type: 'image' })} className="block bg-neutral-800/50 p-2 rounded-lg hover:ring-2 ring-sky-400 transition-shadow cursor-pointer">
                <h4 className="font-semibold text-center mb-2 text-neutral-300">HUXT Forecast Timeline</h4>
                <img src={HUXT_FORECAST_IMAGE_URL} alt="HUXT Forecast" className="rounded w-full bg-black" />
            </div>
          </ModelCard>

          <ModelCard 
            title="WSA-ENLIL (NOAA)" 
            source="NOAA SWPC" 
            sourceUrl="https://www.swpc.noaa.gov/models/wsa-enlil"
            description={<p>The primary operational model used by NOAA to predict solar wind conditions and CME arrivals.</p>}
          >
            <div 
              onClick={() => noaaEnlilUrls.length > 0 && setViewerMedia({ urls: noaaEnlilUrls, type: 'animation' })}
              className="bg-neutral-800/50 p-2 rounded-lg relative min-h-[250px] flex items-center justify-center hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
            >
                {isLoadingNoaaEnlil && <div className="flex flex-col items-center gap-4"><LoadingSpinner /><p className="text-neutral-400 italic">Fetching NOAA forecast...</p></div>}
                {noaaEnlilError && <p className="text-red-400 text-center text-sm p-4">{noaaEnlilError}</p>}
                {!isLoadingNoaaEnlil && noaaEnlilUrls.length > 0 && (
                  <>
                    <img src={noaaEnlilUrls[0]} alt="ENLIL Forecast Preview" className="rounded w-full aspect-square object-cover bg-black" />
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                      <p className="text-white text-lg font-bold">Click to Play Animation</p>
                    </div>
                  </>
                )}
                {!isLoadingNoaaEnlil && noaaEnlilUrls.length === 0 && !noaaEnlilError && <p className="text-neutral-400 italic">No forecast animation available.</p>}
            </div>
          </ModelCard>

          <ModelCard 
            title="WSA-ENLIL (NASA)" 
            source="NASA CCMC" 
            sourceUrl="https://ccmc.gsfc.nasa.gov/tools/DONKI/"
            description={<p>A list of recent, detailed simulations run by NASA, with analysis of potential Earth impacts.</p>}
          >
            <div className="bg-neutral-800/50 p-2 rounded-lg min-h-[250px] flex flex-col h-full">
                {isLoadingNasaEnlil && <div className="flex-grow flex items-center justify-center"><div className="flex flex-col items-center gap-4"><LoadingSpinner /><p className="text-neutral-400 italic">Fetching simulations...</p></div></div>}
                {nasaEnlilError && <p className="text-red-400 text-center text-sm p-4 flex-grow flex items-center justify-center">{nasaEnlilError}</p>}
                {!isLoadingNasaEnlil && nasaEnlilSimulations.length > 0 && (
                   <div className="space-y-2 overflow-y-auto max-h-[500px] styled-scrollbar pr-2">
                       {nasaEnlilSimulations.slice(0, 10).map(sim => {
                            const gifUrl = generateEnlilGifUrl(sim);
                            return (
                               <button
                                 key={sim.simulationID}
                                 onClick={() => gifUrl && setViewerMedia({ url: gifUrl, type: 'image' })}
                                 disabled={!gifUrl}
                                 className="w-full text-left bg-neutral-900/60 p-3 rounded-md text-xs transition-colors hover:bg-neutral-700/80 disabled:opacity-50 disabled:cursor-not-allowed"
                               >
                                 <div className="flex justify-between items-start mb-2">
                                   <div>
                                     <p className="font-bold text-neutral-200">Model Time:</p>
                                     <p>{formatNZTimestamp(sim.modelCompletionTime)}</p>
                                   </div>
                                   {sim.isEarthGB ? (
                                     <span className="px-2 py-1 rounded bg-green-500/20 text-green-300 font-bold text-xs border border-green-500/50">
                                       Earth Directed
                                     </span>
                                   ) : (
                                     <span className="px-2 py-1 rounded bg-red-500/20 text-red-300 font-bold text-xs border border-red-500/50">
                                       Not Earth Directed
                                     </span>
                                   )}
                                 </div>
                                 <p className="text-neutral-300">
                                   <strong>CMEs:</strong> {sim.cmeIDs?.join(', ') || 'N/A'}
                                 </p>
                                 {sim.estimatedShockArrivalTime && (
                                   <p className="text-neutral-300">
                                     <strong>Shock Arrival:</strong> <span className="text-amber-300 font-semibold">{formatNZTimestamp(sim.estimatedShockArrivalTime)}</span>
                                   </p>
                                 )}
                               </button>
                            )
                       })}
                   </div>
                )}
                 {!isLoadingNasaEnlil && nasaEnlilSimulations.length === 0 && <p className="text-neutral-400 italic text-center flex-grow flex items-center justify-center">No recent NASA simulations found.</p>}
            </div>
          </ModelCard>

          <div className="flex flex-col gap-6">
              <ModelCard 
                title="ELEVO (Helio4Cast)" 
                source="Helio4Cast" 
                sourceUrl="https://helioforecast.space/cme"
                description={<p>An Ellipse Evolution (ELEvo) drag-based model used to predict CME arrival times.</p>}
              >
                <div 
                  onClick={() => setViewerMedia({ url: ELEVO_ANIMATION_URL, type: 'video' })}
                  className="bg-neutral-800/50 p-2 rounded-lg relative flex items-center justify-center hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
                >
                    <video src={ELEVO_ANIMATION_URL} autoPlay loop muted playsInline className="rounded w-full aspect-square object-cover bg-black">Your browser does not support the video tag.</video>
                </div>
              </ModelCard>

              <ModelCard 
                title="EUHFORIA (ESA)" 
                source="ESA Space Weather" 
                sourceUrl="https://swe.ssa.esa.int/heliospheric-weather"
                description={<p>A 3D magnetohydrodynamic model from the European Space Agency for operational forecasting.</p>}
              >
                <div 
                  onClick={() => setViewerMedia({ url: EUHFORIA_ANIMATION_URL, type: 'video' })}
                  className="bg-neutral-800/50 p-2 rounded-lg relative flex items-center justify-center hover:ring-2 ring-sky-400 transition-shadow cursor-pointer"
                >
                    <video src={EUHFORIA_ANIMATION_URL} autoPlay loop muted playsInline className="rounded w-full aspect-square object-cover bg-black">Your browser does not support the video tag.</video>
                </div>
              </ModelCard>
            </div>

        </div>
      </div>
    </div>
  );
};

export default ForecastModelsModal;
// --- END OF FILE src/components/ForecastModelsModal.tsx ---