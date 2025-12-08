// --- START OF FILE TimelineControls.tsx ---

import React from 'react';
import PlayIcon from './icons/PlayIcon';
import PauseIcon from './icons/PauseIcon';
import NextIcon from './icons/NextIcon';
import PrevIcon from './icons/PrevIcon';

interface TimelineControlsProps {
  isVisible: boolean;
  isPlaying: boolean;
  onPlayPause: () => void;
  onScrub: (value: number) => void; // Value 0-1000
  scrubberValue: number; // Value 0-1000
  onStepFrame: (direction: -1 | 1) => void;
  playbackSpeed: number;
  onSetSpeed: (speed: number) => void;
  minDate: number; // timestamp
  maxDate: number; // timestamp
  onOpenImpactGraph: () => void; // --- NEW PROP ---
}

const ChartIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 19.5h16.5m-16.5-6.375h16.5m-16.5-6.375h16.5m-16.5-6.375h16.5" />
    </svg>
);

const PlaybackButton: React.FC<{ onClick: () => void; children: React.ReactNode; title: string; id?: string }> = ({ onClick, children, title, id }) => (
  <button
    id={id}
    onClick={onClick}
    title={title}
    className={`p-2 rounded-xl bg-gradient-to-b from-slate-900/80 to-slate-800/60 text-slate-100 hover:border-cyan-400/80 border border-slate-700/80 shadow-md transition-all focus:outline-none focus:ring-1 focus:ring-cyan-400/60`}
  >
    {children}
  </button>
);

const SpeedButton: React.FC<{ onClick: () => void; isActive: boolean; children: React.ReactNode; id?: string }> = ({ onClick, isActive, children, id }) => (
 <button
    id={id}
    onClick={onClick}
    className={`px-3 py-1.5 text-xs rounded-full border transition-all shadow-sm ${
      isActive
        ? `bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-950 border-transparent font-semibold shadow-cyan-500/30`
        : `bg-slate-900/60 border-slate-700 text-neutral-200 hover:border-cyan-400/70 hover:text-white`
    }`}
  >
    {children}
  </button>
);


const TimelineControls: React.FC<TimelineControlsProps> = ({
  isVisible, isPlaying, onPlayPause, onScrub, scrubberValue, onStepFrame,
  playbackSpeed, onSetSpeed, minDate, maxDate, onOpenImpactGraph
}) => {
  if (!isVisible) return null;

  const getCurrentTimelineDate = () => {
    if (!minDate || !maxDate || maxDate <= minDate) return "N/A";
    const totalDuration = maxDate - minDate;
    const currentTimeOffset = totalDuration * (scrubberValue / 1000);
    return new Date(minDate + currentTimeOffset).toLocaleString();
  };

  const nowTimestamp = Date.now();
  const totalDuration = maxDate - minDate;
  let nowPositionPercent = -1;

  if (totalDuration > 0 && nowTimestamp >= minDate && nowTimestamp <= maxDate) {
    nowPositionPercent = ((nowTimestamp - minDate) / totalDuration) * 100;
  }


  return (
    <div id="timeline-controls-container" className={`fixed bottom-5 left-1/2 -translate-x-1/2 w-11/12 lg:w-4/5 lg:max-w-3xl bg-gradient-to-r from-slate-950/95 via-slate-900/80 to-indigo-950/80 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-4 shadow-2xl text-neutral-100 space-y-3`}>
      <div className="flex items-center space-x-2 md:space-x-3">
        <label htmlFor="timeline-scrubber" className="hidden md:block text-xs uppercase tracking-wide text-neutral-300 whitespace-nowrap">Timeline scrubber</label>
        <PlaybackButton id="timeline-back-step-button" onClick={() => onStepFrame(-1)} title="Previous Frame"><PrevIcon className="w-4 h-4" /></PlaybackButton>
        <PlaybackButton id="timeline-play-pause-button" onClick={onPlayPause} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
        </PlaybackButton>
        <PlaybackButton id="timeline-forward-step-button" onClick={() => onStepFrame(1)} title="Next Frame"><NextIcon className="w-4 h-4" /></PlaybackButton>
        
        <div className="relative flex-grow flex items-center h-5">
            <input
            type="range"
            id="timeline-scrubber"
            min="0"
            max="1000"
            value={scrubberValue}
            onChange={(e) => onScrub(parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-slate-800/80 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-r [&::-webkit-slider-thumb]:from-cyan-400 [&::-webkit-slider-thumb]:to-sky-500 [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-sky-400"
            />
            {nowPositionPercent >= 0 && (
            <>
                <div
                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-red-400 rounded-full pointer-events-none shadow-md"
                style={{ left: `${nowPositionPercent}%` }}
                title={`Current Time: ${new Date(nowTimestamp).toLocaleString()}`}
                />
                <div
                className="absolute top-[-10px] text-[10px] text-red-300 pointer-events-none font-semibold uppercase tracking-wider"
                style={{ left: `calc(${nowPositionPercent}% + 6px)` }}
                >
                Forecast edge
                </div>
            </>
            )}
        </div>
        
        {/* --- NEW: Graph Button --- */}
        <PlaybackButton onClick={onOpenImpactGraph} title="Show Impact Graphs">
            <ChartIcon className="w-4 h-4" />
        </PlaybackButton>

        <div className="hidden sm:block text-xs tabular-nums whitespace-nowrap min-w-[150px] text-right text-neutral-300">
          {getCurrentTimelineDate()}
        </div>
      </div>
      <div className="flex items-center space-x-2 justify-center">
        <span className="text-xs uppercase tracking-wide text-neutral-300">Playback speed</span>
        <SpeedButton id="timeline-speed-05x-button" onClick={() => onSetSpeed(0.5)} isActive={playbackSpeed === 0.5}>0.5x</SpeedButton>
        <SpeedButton id="timeline-speed-1x-button" onClick={() => onSetSpeed(1)} isActive={playbackSpeed === 1}>1x</SpeedButton>
        <SpeedButton id="timeline-speed-2x-button" onClick={() => onSetSpeed(2)} isActive={playbackSpeed === 2}>2x</SpeedButton>
        <SpeedButton id="timeline-speed-5x-button" onClick={() => onSetSpeed(5)} isActive={playbackSpeed === 5}>5x</SpeedButton>
        <SpeedButton id="timeline-speed-10x-button" onClick={() => onSetSpeed(10)} isActive={playbackSpeed === 10}>10x</SpeedButton>
        <SpeedButton id="timeline-speed-20x-button" onClick={() => onSetSpeed(20)} isActive={playbackSpeed === 20}>20x</SpeedButton>
      </div>
    </div>
  );
};

export default TimelineControls;
// --- END OF FILE TimelineControls.tsx ---