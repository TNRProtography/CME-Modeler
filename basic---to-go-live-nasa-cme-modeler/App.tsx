import React, { useState, useEffect, useCallback } from 'react';
import CmeModeler from './components/CmeModeler';
import ForecastDashboard from './components/ForecastDashboard';
import CmeIcon from './components/icons/CmeIcon';
import ForecastIcon from './components/icons/ForecastIcon';

// A simple custom hook to read the URL hash and update the component on change
const useHash = () => {
  const [hash, setHash] = useState(() => window.location.hash);

  const onHashChange = useCallback(() => {
    setHash(window.location.hash);
  }, []);

  useEffect(() => {
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [onHashChange]);

  return hash;
};

const App: React.FC = () => {
  const hash = useHash();

  // The modeler page is shown only when the hash is exactly '#/modeler'
  const isModelerPage = hash === '#/modeler';

  return (
    // This is the main container for the entire application
    <div className="w-screen h-screen bg-black">
      <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 flex items-center space-x-1 p-1 bg-neutral-900 border border-neutral-800 rounded-lg shadow-lg">
        {/* Link to the Forecast page (the default) */}
        <a
          href="#/"
          className={`flex items-center space-x-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${!isModelerPage ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}`}
        >
          <ForecastIcon className="w-5 h-5" />
          <span>Forecast</span>
        </a>
        {/* Link to the CME Modeler page */}
        <a
          href="#/modeler"
          className={`flex items-center space-x-2 px-3 py-1.5 text-sm font-semibold rounded-md transition-colors ${isModelerPage ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'}`}
        >
          <CmeIcon className="w-5 h-5" />
          <span>CME Modeler</span>
        </a>
      </header>

      {/* Conditionally render the correct "page" component */}
      <main className="w-full h-full pt-20 overflow-y-auto">
        {isModelerPage ? <CmeModeler /> : <ForecastDashboard />}
      </main>
    </div>
  );
};

export default App;