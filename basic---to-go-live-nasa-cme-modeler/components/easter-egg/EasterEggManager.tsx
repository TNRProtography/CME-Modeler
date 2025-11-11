// --- START OF FILE src/components/easter-egg/EasterEggManager.tsx ---

import React, { useState, useMemo } from 'react';
import AuroraPainter from './AuroraPainter';
import SubstormSurge from './SubstormSurge';
import CatchTheCorona from './CatchTheCorona';
import MagneticMusician from './MagneticMusician';

const games = [
  { id: 'painter', component: AuroraPainter },
  { id: 'surge', component: SubstormSurge },
  { id: 'corona', component: CatchTheCorona },
  { id: 'musician', component: MagneticMusician },
];

interface EasterEggManagerProps {
  onClose: () => void;
}

export const EasterEggManager: React.FC<EasterEggManagerProps> = ({ onClose }) => {
  const [selectedGame] = useState(() => {
    const randomIndex = Math.floor(Math.random() * games.length);
    return games[randomIndex];
  });

  const GameComponent = selectedGame.component;

  return (
    <div className="fixed inset-0 z-[1000] w-screen h-screen bg-black">
      <div className="absolute top-0 left-0 w-full h-full">
        <GameComponent />
      </div>
      <button
        onClick={onClose}
        className="absolute bottom-5 left-5 px-4 py-2 bg-neutral-800/80 border border-neutral-600/80 rounded-lg text-neutral-200 hover:bg-neutral-700/90 transition-colors z-10 text-sm font-semibold backdrop-blur-sm"
      >
        &larr; Back to CME Modeler
      </button>
    </div>
  );
};

// No default export anymore
// --- END OF FILE src/components/easter-egg/EasterEggManager.tsx ---