import React from 'react';
import { PRIMARY_COLOR, TEXT_COLOR } from '../constants';

interface ColorScaleGuideProps {
  isMobileView?: boolean;
}

const colorScaleData = [
  { color: '#ff69b4', label: '≥ 2500 km/s' }, // Hot Pink
  { color: '#9370db', label: '≥ 1800 km/s' }, // Medium Purple
  { color: '#ff4500', label: '≥ 1000 km/s' }, // OrangeRed
  { color: '#ffa500', label: '≥ 800 km/s' },  // Orange
  { color: '#ffff00', label: '≥ 500 km/s' },  // Yellow
];

const ColorScaleGuide: React.FC<ColorScaleGuideProps> = ({ isMobileView = false }) => {
  const containerClasses = isMobileView
    ? "w-full"
    : "panel bg-[#14193c]/80 backdrop-blur-md border border-sky-500/30 rounded-lg p-3 shadow-xl max-w-xs w-full mt-4";

  return (
    <div className={containerClasses}>
      <h3 className={`text-sm font-bold text-[${PRIMARY_COLOR}] border-b border-sky-500/50 pb-1 mb-2`}>CME Speed Guide</h3>
      <ul className="space-y-1.5">
        {colorScaleData.map(({ color, label }) => (
          <li key={color} className="flex items-center text-xs">
            <span
              className="w-4 h-4 rounded-full mr-3 border border-white/20"
              style={{ backgroundColor: color }}
            ></span>
            <span className={`text-[${TEXT_COLOR}]/90`}>{label}</span>
          </li>
        ))}
        <li className="flex items-center text-xs">
            <span
              className="w-4 h-4 rounded-full mr-3 border border-white/20 bg-gradient-to-t from-gray-500 to-yellow-400"
            ></span>
            <span className={`text-[${TEXT_COLOR}]/90`}>350 - 500 km/s</span>
        </li>
         <li key="grey" className="flex items-center text-xs">
            <span
              className="w-4 h-4 rounded-full mr-3 border border-white/20"
              style={{ backgroundColor: '#808080' }}
            ></span>
            <span className={`text-[${TEXT_COLOR}]/90`}>&lt; 350 km/s</span>
          </li>
      </ul>
    </div>
  );
};

export default ColorScaleGuide;
