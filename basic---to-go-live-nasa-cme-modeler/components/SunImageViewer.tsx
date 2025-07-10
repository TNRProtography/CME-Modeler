import React, { useState } from 'react';
import { SolarFlareData } from '../services/nasaService';

interface SunImageViewerProps {
  flares: SolarFlareData[];
}

const sdoImages = {
  'AIA 304': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg',
  'AIA 131': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0131.jpg',
  'HMI Continuum': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_hmiic.jpg',
};

const SunImageViewer: React.FC<SunImageViewerProps> = ({ flares }) => {
  const [activeImage, setActiveImage] = useState<keyof typeof sdoImages>('AIA 304');
  const [hoveredRegionImage, setHoveredRegionImage] = useState<string | null>(null);

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

  const handleRegionHover = (regionNum: number) => {
    const imageUrl = `https://sdo.gsfc.nasa.gov/assets/img/ar_viz/ar_viz_${String(regionNum).padStart(5, '0')}.jpg`;
    setHoveredRegionImage(imageUrl);
  };

  return (
    <div className="bg-neutral-900/80 p-4 rounded-lg flex flex-col lg:flex-row gap-4">
      <div className="flex-shrink-0 lg:w-1/2">
        <h3 className="text-lg font-semibold text-neutral-200 mb-2">Live Sun Image</h3>
        <div className="relative aspect-square w-full bg-neutral-800 rounded-md">
          <img src={hoveredRegionImage || sdoImages[activeImage]} alt={`Live SDO image of the sun - ${activeImage}`} className="rounded-md w-full h-full object-cover" />
        </div>
        <div className="flex justify-center gap-2 mt-2">
          {(Object.keys(sdoImages) as Array<keyof typeof sdoImages>).map(key => (
            <button
              key={key}
              onClick={() => setActiveImage(key)}
              className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                activeImage === key 
                  ? 'bg-neutral-200 text-black border-neutral-200' 
                  : 'bg-transparent border-neutral-600 hover:bg-neutral-700'
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-grow">
        <h3 className="text-lg font-semibold text-neutral-200 mb-2">Active Sunspot Regions</h3>
        <div className="bg-neutral-950/70 p-3 rounded-md h-[430px] overflow-y-auto styled-scrollbar">
          {activeRegions.length > 0 ? (
            <ul className="space-y-1">
              {activeRegions.map(region => (
                <li
                  key={region.activeRegionNum}
                  className="text-sm text-neutral-300 p-2 rounded-md transition-colors hover:bg-neutral-800"
                  onMouseEnter={() => handleRegionHover(region.activeRegionNum)}
                  onMouseLeave={() => setHoveredRegionImage(null)}
                >
                  <strong className="text-white">AR{region.activeRegionNum}:</strong>
                  <span className="ml-2 text-amber-400 font-mono">{region.classType}</span>
                  <span className="ml-2 text-neutral-400">({region.location})</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-neutral-400 italic p-2">No numbered active regions with recent flares.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default SunImageViewer;