import React from 'react';
import { SolarFlareData } from '../services/nasaService';

interface SunImageViewerProps {
  sdoImageUrl: string;
  flares: SolarFlareData[];
}

const SunImageViewer: React.FC<SunImageViewerProps> = ({ sdoImageUrl, flares }) => {
  
  const activeRegions = flares.reduce((acc, flare) => {
    if (!acc.some(item => item.activeRegionNum === flare.activeRegionNum)) {
      acc.push({
        activeRegionNum: flare.activeRegionNum,
        classType: flare.classType,
        location: flare.sourceLocation,
      });
    }
    return acc;
  }, [] as { activeRegionNum: number; classType: string; location: string }[]);
  
  activeRegions.sort((a, b) => a.activeRegionNum - b.activeRegionNum);

  return (
    <div className="bg-neutral-900/80 p-4 rounded-lg flex flex-col lg:flex-row gap-4">
      <div className="flex-shrink-0 lg:w-1/2">
        <h3 className="text-lg font-semibold text-neutral-200 mb-2">Live Sun Image (SDO/AIA 193)</h3>
        {sdoImageUrl ? (
          <img src={sdoImageUrl} alt="Live SDO image of the sun" className="rounded-md w-full" />
        ) : (
          <div className="aspect-square w-full bg-neutral-800 flex items-center justify-center rounded-md">
            <p>Loading image...</p>
          </div>
        )}
      </div>
      <div className="flex-grow">
        <h3 className="text-lg font-semibold text-neutral-200 mb-2">Active Sunspot Regions</h3>
        <div className="bg-neutral-950/70 p-3 rounded-md h-96 overflow-y-auto styled-scrollbar">
          {activeRegions.length > 0 ? (
            <ul className="space-y-2">
              {activeRegions.map(region => (
                <li key={region.activeRegionNum} className="text-sm text-neutral-300">
                  <strong className="text-white">AR{region.activeRegionNum}:</strong>
                  <span className="ml-2 text-amber-400 font-mono">{region.classType}</span>
                  <span className="ml-2 text-neutral-400">({region.location})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-neutral-400 italic">No numbered active regions with recent flares.</p>
          )}
        </div>
      </div>
    </div>
  );
};

// --- THIS IS THE CRUCIAL FIX ---
export default SunImageViewer;