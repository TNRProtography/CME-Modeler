// src/components/ForecastModal.tsx
import React from 'react';
import HomeIcon from './icons/HomeIcon'; // Correct path from within the components folder

interface ForecastPageProps {
  onClose: () => void;
}

// Note: We are keeping the filename ForecastModal but it now functions as a page
const ForecastModal: React.FC<ForecastPageProps> = ({ onClose }) => {
  return (
    <div className="w-screen h-screen bg-black flex flex-col">
      <header className="flex-shrink-0 p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-between items-center">
        <h1 className="text-xl font-bold text-neutral-100">Live Aurora Forecast</h1>
        <button
          onClick={onClose}
          className="flex items-center space-x-2 px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-700/90 transition-colors"
          title="Back to CME Modeler"
        >
          <HomeIcon className="w-5 h-5" />
          <span className="text-sm font-semibold">Back to Modeler</span>
        </button>
      </header>
      <main className="flex-grow">
        <iframe
          src="/forecast.html" // This file MUST be in your `public` folder
          title="Live West Coast Aurora Forecast by TNR Protography"
          className="w-full h-full border-none"
        />
      </main>
    </div>
  );
};

export default ForecastModal;