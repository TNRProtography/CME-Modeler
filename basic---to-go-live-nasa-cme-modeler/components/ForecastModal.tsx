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
      {/* --- THIS HEADER SECTION IS MODIFIED --- */}
      <header className="flex-shrink-0 p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-end items-center">
        {/* The h1 title has been removed from here. */}
        
        {/* The justification is changed to 'justify-end' to align the button to the right. */}
        <button
          onClick={onClose}
          className="flex items-center space-x-2 px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-700/90 transition-colors"
          title="Back to 3D CME Modeler" // Title attribute also updated
        >
          <HomeIcon className="w-5 h-5" />
          {/* The button text is now updated. */}
          <span className="text-sm font-semibold">3D CME Modeler</span>
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