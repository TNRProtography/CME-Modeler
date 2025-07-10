import React, { useState } from 'react';

// --- MODIFIED: Swapped to SUVI and corrected HMI links ---
const sdoImages = {
  'SUVI 304': 'https://services.swpc.noaa.gov/images/animations/suvi/primary/304/latest.png',
  'SUVI 131': 'https://services.swpc.noaa.gov/images/animations/suvi/primary/131/latest.png',
  'HMI Continuum': 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_hmiic.jpg',
};

// This component no longer needs the flare data, as it's being moved to a separate card.
const SunImageViewer: React.FC = () => {
  const [activeImage, setActiveImage] = useState<keyof typeof sdoImages>('SUVI 304');

  return (
    <div className="bg-neutral-900/80 p-4 rounded-lg flex flex-col gap-4">
        <h3 className="text-lg font-semibold text-neutral-200 text-center">Live Sun Images</h3>
        <div className="relative aspect-square w-full bg-neutral-800 rounded-md mx-auto max-w-lg">
          <img src={sdoImages[activeImage]} alt={`Live SUVI/HMI image of the sun - ${activeImage}`} className="rounded-md w-full h-full object-cover" />
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
  );
};

export default SunImageViewer;