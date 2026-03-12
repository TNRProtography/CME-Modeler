// --- START OF FILE TimelineControls.tsx ---

import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import PlayIcon from './icons/PlayIcon';
import PauseIcon from './icons/PauseIcon';
import NextIcon from './icons/NextIcon';
import PrevIcon from './icons/PrevIcon';

interface TimelineControlsProps {
  isVisible: boolean;
  isPlaying: boolean;
  onPlayPause: () => void;
  onScrub: (value: number) => void;
  scrubberValue: number;
  onStepFrame: (direction: -1 | 1) => void;
  playbackSpeed: number;
  onSetSpeed: (speed: number) => void;
  minDate: number;
  maxDate: number;
  onOpenImpactGraph: () => void;
}

const ChartIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.5V19a1 1 0 001 1h16a1 1 0 001-1v-5.5M3 13.5L12 4l9 9.5M3 13.5h18" />
  </svg>
);

const PlaybackButton: React.FC<{ onClick: () => void; children: React.ReactNode; title: string; id?: string }> = ({ onClick, children, title, id }) => (
  <button id={id} onClick={onClick} title={title}
    className="p-2 rounded-md bg-neutral-800/50 text-neutral-200 hover:bg-neutral-700/60 border border-neutral-700/80 transition-colors focus:outline-none focus:ring-1 focus:ring-neutral-400">
    {children}
  </button>
);

const SpeedButton: React.FC<{ onClick: () => void; isActive: boolean; children: React.ReactNode; id?: string }> = ({ onClick, isActive, children, id }) => (
  <button id={id} onClick={onClick}
    className={`px-3 py-1 text-xs rounded border transition-colors ${isActive ? 'bg-neutral-200 text-neutral-900 border-neutral-200 font-semibold' : 'bg-transparent border-neutral-600 text-neutral-300 hover:bg-neutral-800'}`}>
    {children}
  </button>
);

const TimelineControls: React.FC<TimelineControlsProps> = ({
  isVisible, isPlaying, onPlayPause, onScrub, scrubberValue, onStepFrame,
  playbackSpeed, onSetSpeed, minDate, maxDate, onOpenImpactGraph,
}) => {
  // State-based portal target: resolved after mount so it's always available on mobile + desktop.
  // #timeline-portal is outside #root, unaffected by body overflow:hidden.
  const [portalTarget, setPortalTarget] = useState<Element | null>(null);
  useEffect(() => {
    setPortalTarget(document.getElementById('timeline-portal') ?? document.body);
  }, []);

  if (!isVisible || !portalTarget) return null;

  const getCurrentTimelineDate = () => {
    if (!minDate || !maxDate || maxDate <= minDate) return 'N/A';
    return new Date(minDate + (maxDate - minDate) * (scrubberValue / 1000)).toLocaleString();
  };

  const nowTimestamp = Date.now();
  const totalDuration = maxDate - minDate;
  let nowPositionPercent = -1;
  if (totalDuration > 0 && nowTimestamp >= minDate && nowTimestamp <= maxDate) {
    nowPositionPercent = ((nowTimestamp - minDate) / totalDuration) * 100;
  }

  // z-index 2003:
  //   above canvas (0) and header (2001)
  //   BELOW: mobile backdrop (2004), panels (2005), tutorial (2051),
  //          all modals (3000+), loading screen (5000), error boundary (9999)
  const containerStyle: React.CSSProperties = {
    position: 'fixed',
    bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '92%',
    maxWidth: '768px',
    backgroundColor: 'rgba(10, 10, 10, 0.92)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: '1px solid rgba(64, 64, 64, 0.9)',
    borderRadius: '10px',
    padding: '10px 12px',
    boxShadow: '0 4px 32px rgba(0,0,0,0.7)',
    color: '#d4d4d4',
    zIndex: 2003,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };

  return ReactDOM.createPortal(
    <div id="timeline-controls-container" style={containerStyle}>
      <div className="flex items-center space-x-2 md:space-x-3">
        <label htmlFor="timeline-scrubber" className="hidden md:block text-sm font-medium whitespace-nowrap">Time Control:</label>
        <PlaybackButton id="timeline-back-step-button" onClick={() => onStepFrame(-1)} title="Previous Frame"><PrevIcon className="w-4 h-4" /></PlaybackButton>
        <PlaybackButton id="timeline-play-pause-button" onClick={onPlayPause} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
        </PlaybackButton>
        <PlaybackButton id="timeline-forward-step-button" onClick={() => onStepFrame(1)} title="Next Frame"><NextIcon className="w-4 h-4" /></PlaybackButton>

        <div className="relative flex-grow flex items-center h-5">
          <input type="range" id="timeline-scrubber" min="0" max="1000" value={scrubberValue}
            onChange={(e) => onScrub(parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-neutral-700/80 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-200 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-neutral-200"
          />
          {nowPositionPercent >= 0 && (
            <>
              <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-red-400 rounded-full pointer-events-none shadow-md"
                style={{ left: `${nowPositionPercent}%` }} title={`Current Time: ${new Date(nowTimestamp).toLocaleString()}`} />
              <div className="absolute top-[-10px] text-[10px] text-red-400/90 pointer-events-none font-semibold uppercase tracking-wider"
                style={{ left: `calc(${nowPositionPercent}% + 6px)` }}>Forecast</div>
            </>
          )}
        </div>

        <PlaybackButton onClick={onOpenImpactGraph} title="Show Impact Graphs"><ChartIcon className="w-4 h-4" /></PlaybackButton>

        <div className="hidden sm:block text-xs tabular-nums whitespace-nowrap min-w-[150px] text-right text-neutral-400">
          {getCurrentTimelineDate()}
        </div>
      </div>

      <div className="flex items-center space-x-2 justify-center">
        <span className="text-sm">Speed:</span>
        <SpeedButton id="timeline-speed-05x-button" onClick={() => onSetSpeed(0.5)} isActive={playbackSpeed === 0.5}>0.5x</SpeedButton>
        <SpeedButton id="timeline-speed-1x-button"  onClick={() => onSetSpeed(1)}   isActive={playbackSpeed === 1}>1x</SpeedButton>
        <SpeedButton id="timeline-speed-2x-button"  onClick={() => onSetSpeed(2)}   isActive={playbackSpeed === 2}>2x</SpeedButton>
        <SpeedButton id="timeline-speed-5x-button"  onClick={() => onSetSpeed(5)}   isActive={playbackSpeed === 5}>5x</SpeedButton>
        <SpeedButton id="timeline-speed-10x-button" onClick={() => onSetSpeed(10)}  isActive={playbackSpeed === 10}>10x</SpeedButton>
        <SpeedButton id="timeline-speed-20x-button" onClick={() => onSetSpeed(20)}  isActive={playbackSpeed === 20}>20x</SpeedButton>
      </div>
    </div>,
    portalTarget,
  );
};

export default TimelineControls;
// --- END OF FILE TimelineControls.tsx ---