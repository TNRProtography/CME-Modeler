import React from 'react';

interface ColorScaleGuideProps {
  isMobileView?: boolean;
}

const colorScaleData = [
  { swatch: 'bg-[#808080]', label: '< 350 km/s' },
  { swatch: 'bg-gradient-to-r from-[#808080] to-[#ffff00]', label: '350 – 500 km/s' },
  { swatch: 'bg-gradient-to-r from-[#ffff00] to-[#ffa500]', label: '500 – 800 km/s' },
  { swatch: 'bg-gradient-to-r from-[#ffa500] to-[#ff4500]', label: '800 – 1000 km/s' },
  { swatch: 'bg-gradient-to-r from-[#ff4500] to-[#9370db]', label: '1000 – 1800 km/s' },
  { swatch: 'bg-gradient-to-r from-[#9370db] to-[#ff69b4]', label: '1800 – 2500 km/s' },
  { swatch: 'bg-[#ff69b4]', label: '≥ 2500 km/s' },
];

const ColorScaleGuide: React.FC<ColorScaleGuideProps> = ({ isMobileView = false }) => {
  const containerClasses = isMobileView
    ? 'w-full'
    : 'panel bg-neutral-950/80 backdrop-blur-md border border-neutral-800/90 rounded-lg p-3 shadow-xl max-w-xs w-full mt-4';

  return (
    <div className={containerClasses}>
      <h3 className="text-sm font-bold text-neutral-200 border-b border-neutral-700/80 pb-1 mb-2">CME Speed Guide</h3>
      <ul className="space-y-1.5">
        {colorScaleData.map(({ swatch, label }) => (
          <li key={label} className="flex items-center text-xs">
            <span className={`w-4 h-4 rounded-full mr-3 border border-white/20 ${swatch}`} />
            <span className="text-neutral-300/90">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ColorScaleGuide;
