import React from 'react';
import CloseIcon from './icons/CloseIcon';

interface ForecastModelsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ForecastModelsModal: React.FC<ForecastModelsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div 
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-5xl max-h-[90vh] text-neutral-300 flex flex-col"
        onClick={e => e.stopPropagation()}
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
            <div className="prose prose-invert prose-sm text-neutral-400 leading-relaxed">
              <p>
                The Heliospheric Upwind Extrapolation (HUXT) model is a fast solar wind model developed by the UK's Met Office Space Weather Operations Centre (MOSWOC). It simulates the propagation of solar wind structures, like Coronal Mass Ejections (CMEs), through the inner heliosphere.
              </p>
              <p>
                Unlike more complex models, HUXT simplifies the physics to run very quickly, making it ideal for real-time forecasting. It takes data from models like WSA (which provides the initial solar wind structure at the Sun) and "pushes" it outwards to predict the arrival time and speed of CMEs at Earth and other planets.
              </p>
            </div>
            <div className="space-y-4">
                <div className="bg-neutral-900 p-2 rounded-lg">
                    <h4 className="font-semibold text-center mb-2">Latest HUXT Forecast</h4>
                    <img 
                        src="https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_forecast_latest.png" 
                        alt="HUXT Forecast" 
                        className="rounded border border-neutral-700 w-full" 
                    />
                </div>
                <div className="bg-neutral-900 p-2 rounded-lg">
                    <h4 className="font-semibold text-center mb-2">HUXT Animation</h4>
                    <video 
                        src="https://huxt-bucket.s3.eu-west-2.amazonaws.com/wsa_huxt_animation_latest.mp4"
                        autoPlay 
                        loop 
                        muted 
                        playsInline
                        className="rounded w-full"
                    >
                        Your browser does not support the video tag.
                    </video>
                </div>
            </div>
          </section>

          {/* WSA-ENLIL Model Section */}
          <section className="space-y-4">
            <h3 className="text-xl font-semibold text-neutral-300 border-b border-neutral-600 pb-2">WSA-ENLIL (NOAA)</h3>
             <div className="prose prose-invert prose-sm text-neutral-400 leading-relaxed">
                <p>
                  The Wang-Sheeley-Arge (WSA)-ENLIL model is the primary operational space weather forecasting model used by the U.S. National Oceanic and Atmospheric Administration (NOAA). It provides a comprehensive, large-scale prediction of solar wind conditions throughout the heliosphere.
                </p>
                <p>
                  The model works in two parts: <strong>WSA</strong> uses observations of the Sun's magnetic field to estimate the speed and structure of the solar wind near the Sun. <strong>ENLIL</strong> (named after the Sumerian god of wind) is a complex physics model that takes the WSA output and simulates its evolution as it travels out to Earth and beyond, predicting the arrival and impact of major solar events.
                </p>
            </div>
            <div className="bg-neutral-900 p-2 rounded-lg">
                <h4 className="font-semibold text-center mb-2">WSA-ENLIL Animation</h4>
                <video 
                    src="https://services.swpc.noaa.gov/products/animations/enlil_global.mp4"
                    autoPlay 
                    loop 
                    muted 
                    playsInline
                    className="rounded w-full"
                >
                    Your browser does not support the video tag.
                </video>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};

export default ForecastModelsModal;