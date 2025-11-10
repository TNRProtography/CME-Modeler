// --- START OF FILE src/components/InitialLoadingScreen.tsx ---

import React from 'react';
import LoadingSpinner from './icons/LoadingSpinner';

const InitialLoadingScreen: React.FC = () => {
  return (
    <div className="fixed inset-0 z-[5000] flex flex-col items-center justify-center bg-black">
      <img 
        src="https://www.tnrprotography.co.nz/uploads/1/3/6/6/136682089/white-tnr-protography-w_orig.png" 
        alt="TNR Protography Logo"
        className="w-full max-w-xs h-auto mb-8 animate-pulse"
      />
      <div className="flex items-center space-x-4">
        <LoadingSpinner />
        <p className="text-neutral-200 text-lg font-medium tracking-wide">
          Loading cosmic data...
        </p>
      </div>
    </div>
  );
};

export default InitialLoadingScreen;
// --- END OF FILE src/components/InitialLoadingScreen.tsx ---