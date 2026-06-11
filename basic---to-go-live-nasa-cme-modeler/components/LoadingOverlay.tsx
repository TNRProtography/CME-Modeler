import React, { useState } from 'react';
import LoadingSpinner from './icons/LoadingSpinner';

// A pool of 10 fun, thematic loading messages
const LOADING_MESSAGES = [
  'Calculating cosmic forecasts...',
  'Sun-chronizing data...',
  'Herding solar plasma...',
  'Untangling magnetic fields...',
  'Plotting CME trajectories...',
  'Fetching data at near light speed...',
  'Warming up the simulation...',
  'Aligning planetary orbits...',
  'Riding the solar wind...',
  'Brewing a cosmic storm...',
];

const LoadingOverlay: React.FC = () => {
  const [message] = useState(() => {
    const randomIndex = Math.floor(Math.random() * LOADING_MESSAGES.length);
    return LOADING_MESSAGES[randomIndex];
  });

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex flex-col items-center space-y-4">
        <LoadingSpinner />
        <p className="text-neutral-200 text-lg font-medium tracking-wide">
          {message}
        </p>
      </div>
    </div>
  );
};

// This is the crucial line that was likely missing.
// It makes the LoadingOverlay component available for default import.
export default LoadingOverlay; 