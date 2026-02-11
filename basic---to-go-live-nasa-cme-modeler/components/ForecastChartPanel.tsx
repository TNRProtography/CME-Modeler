// --- START OF FILE src/components/ForecastChartPanel.tsx ---

import React from 'react';
import GuideIcon from './icons/GuideIcon';

interface ForecastChartPanelProps {
  title: string;
  currentValue: string; // HTML string for value + units
  emoji: string;
  onOpenModal: () => void;
  children: React.ReactNode;
  isImap?: boolean;
  lastDataReceived?: string;
}

const ForecastChartPanel: React.FC<ForecastChartPanelProps> = ({
  title,
  currentValue,
  emoji,
  onOpenModal,
  children,
  isImap = false,
  lastDataReceived,
}) => {
  return (
    <div
      className={`col-span-12 card bg-neutral-950/80 p-4 flex flex-col ${
        isImap ? 'border border-sky-400/30 bg-gradient-to-br from-sky-500/10 via-transparent to-transparent' : ''
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xl font-semibold text-white">{title}</h3>
          {isImap && (
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
                <defs>
                  <linearGradient id="imapGradient" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#56c2ff" />
                    <stop offset="100%" stopColor="#2d7ff9" />
                  </linearGradient>
                </defs>
                <circle cx="12" cy="12" r="10" fill="url(#imapGradient)" opacity="0.9" />
                <path d="M6.5 12h11" stroke="#0b1b3a" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M12 6.5v11" stroke="#0b1b3a" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              IMAP
            </span>
          )}
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
          {lastDataReceived && (
            <div className="text-[11px] text-neutral-400 mt-1">
              Last updated: {lastDataReceived}
            </div>
          )}
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
