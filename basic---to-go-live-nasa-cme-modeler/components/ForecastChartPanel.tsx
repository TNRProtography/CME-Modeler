// --- START OF FILE src/components/ForecastChartPanel.tsx ---

import React from 'react';
import GuideIcon from './icons/GuideIcon';

interface ForecastChartPanelProps {
  title: string;
  currentValue: string; // HTML string for value + units
  emoji: string;
  onOpenModal: () => void;
  children: React.ReactNode;
}

const ForecastChartPanel: React.FC<ForecastChartPanelProps> = ({
  title,
  currentValue,
  emoji,
  onOpenModal,
  children,
}) => {
  return (
    <div className="col-span-12 card bg-neutral-950/80 p-4 flex flex-col">
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          <button 
            onClick={onOpenModal} 
            className="p-1 text-neutral-400 hover:text-neutral-100" 
            title={`About ${title}`}
          >
            <GuideIcon className="w-5 h-5" />
          </button>
        </div>
        <div className="text-right">
          <div className="text-3xl font-bold text-white" dangerouslySetInnerHTML={{ __html: currentValue }}></div>
          <div className="text-2xl mt-1">{emoji}</div>
        </div>
      </div>
      <div className="flex-grow w-full">
        {children}
      </div>
    </div>
  );
};

export default ForecastChartPanel;
// --- END OF FILE src/components/ForecastChartPanel.tsx ---