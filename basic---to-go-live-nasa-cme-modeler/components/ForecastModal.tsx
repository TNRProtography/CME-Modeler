import React from 'react';
import HomeIcon from './icons/HomeIcon';
import FlareIcon from './icons/FlareIcon';

interface ForecastPageProps {
  onNavChange: (page: 'modeler' | 'flares') => void;
}

const ForecastModal: React.FC<ForecastPageProps> = ({ onNavChange }) => {
  return (
    <div className="w-screen h-screen bg-black flex flex-col">
      <header className="flex-shrink-0 p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-end items-center gap-4">
        
        <button
          onClick={() => onNavChange('flares')}
          className="flex items-center space-x-2 px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-700/90 transition-colors"
          title="View Solar Activity"
        >
          <FlareIcon className="w-5 h-5" />
          <span className="text-sm font-semibold">Solar Activity</span>
        </button>

        <button
          onClick={() => onNavChange('modeler')}
          className="flex items-center space-x-2 px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-700/90 transition-colors"
          title="Back to 3D CME Modeler"
        >
          <HomeIcon className="w-5 h-5" />
          <span className="text-sm font-semibold">3D CME Modeler</span>
        </button>
      </header>
      
      <main className="flex-grow">
        <iframe
          src="/forecast.html"
          title="Live West Coast Aurora Forecast by TNR Protography"
          className="w-full h-full border-none"
        />
      </main>
    </div>
  );
};

export default ForecastModal;