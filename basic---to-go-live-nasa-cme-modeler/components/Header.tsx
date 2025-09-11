// --- START OF FILE src/components/Header.tsx ---

import React from 'react';
import { NavLink } from 'react-router-dom';

// Icon Imports
import SettingsIcon from './icons/SettingsIcon';
import ForecastIcon from './icons/ForecastIcon';
import SunIcon from './icons/SunIcon';
import CmeIcon from './icons/CmeIcon';

interface HeaderProps {
  onOpenSettings: () => void;
  highlightedElementId: string | null;
}

const Header: React.FC<HeaderProps> = ({ onOpenSettings, highlightedElementId }) => {
  const getNavLinkClass = (isActive: boolean, page: 'forecast' | 'solar' | 'modeler') => {
    let activeBgClass = '';
    if (page === 'forecast') activeBgClass = 'bg-sky-500/30 border border-sky-400';
    if (page === 'solar') activeBgClass = 'bg-amber-500/30 border border-amber-400';
    if (page === 'modeler') activeBgClass = 'bg-indigo-500/30 border border-indigo-400';

    const baseClass = 'flex flex-col md:flex-row items-center justify-center md:space-x-2 px-3 py-1 md:px-4 md:py-2 rounded-lg text-neutral-200 shadow-lg transition-all';
    const inactiveClass = 'bg-neutral-800/80 border border-neutral-700/60 hover:bg-neutral-700/90';

    return `${baseClass} ${isActive ? activeBgClass : inactiveClass}`;
  };

  return (
    <header className="flex-shrink-0 p-2 md:p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-center items-center gap-4 relative z-[2001]">
      <div className="flex items-center space-x-2">
        <NavLink 
          id="nav-forecast" 
          to="/" 
          className={({ isActive }) => `${getNavLinkClass(isActive, 'forecast')} ${highlightedElementId === 'nav-forecast' ? 'tutorial-highlight' : ''}`}
          title="View Live Aurora Forecasts"
        >
          <ForecastIcon className="w-5 h-5" />
          <span className="text-xs md:text-sm font-semibold mt-1 md:mt-0">Spot The Aurora</span>
        </NavLink>
        <NavLink 
          id="nav-solar-activity" 
          to="/solar-activity" 
          className={({ isActive }) => `${getNavLinkClass(isActive, 'solar')} ${highlightedElementId === 'nav-solar-activity' ? 'tutorial-highlight' : ''}`}
          title="View Solar Activity"
        >
          <SunIcon className="w-5 h-5" />
          <span className="text-xs md:text-sm font-semibold mt-1 md:mt-0">Solar Activity</span>
        </NavLink>
        <NavLink 
          id="nav-modeler" 
          to="/3d-cme-visualization" 
          className={({ isActive }) => `${getNavLinkClass(isActive, 'modeler')} ${highlightedElementId === 'nav-modeler' ? 'tutorial-highlight' : ''}`}
          title="View CME Visualization"
        >
          <CmeIcon className="w-5 h-5" />
          <span className="text-xs md:text-sm font-semibold mt-1 md:mt-0">CME Visualization</span>
        </NavLink>
      </div>
      <div className="flex-grow flex justify-end">
        <button 
          id="nav-settings" 
          onClick={onOpenSettings} 
          className={`p-2 bg-neutral-800/80 border border-neutral-700/60 rounded-full text-neutral-300 shadow-lg transition-all hover:bg-neutral-700/90 ${highlightedElementId === 'nav-settings' ? 'tutorial-highlight' : ''}`}
          title="Open Settings"
        >
          <SettingsIcon className="w-6 h-6" />
        </button>
      </div>
    </header>
  );
};

export default Header;
// --- END OF FILE src/components/Header.tsx ---