
import React from 'react';
import PlayIcon from './icons/PlayIcon';
import PauseIcon from './icons/PauseIcon';
import NextIcon from './icons/NextIcon';
import PrevIcon from './icons/PrevIcon';
import { PRIMARY_COLOR, TEXT_COLOR, HOVER_BG_COLOR } from '../constants';

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
}

const PlaybackButton: React.FC<{ onClick: () => void; children: React.ReactNode; title: string }> = ({ onClick, children, title }) => (
  <button
    onClick={onClick}
    title={title}
    className={`p-2 rounded-md bg-[${PRIMARY_COLOR}]/30 text-[${TEXT_COLOR}] hover:bg-[${HOVER_BG_COLOR}] border border-[${PRIMARY_COLOR}]/50 transition-colors focus:outline-none focus:ring-1 focus:ring-[${PRIMARY_COLOR}]`}
  >
    {children}
  </button>
);

const SpeedButton: React.FC<{ onClick: () => void; isActive: boolean; children: React.ReactNode }> = ({ onClick, isActive, children }) => (
 <button
    onClick={onClick}
    className={`px-3 py-1 text-xs rounded border transition-colors ${
      isActive
        ? `bg-[${PRIMARY_COLOR}] text-[#02041b] border-[${PRIMARY_COLOR}] font-semibold`
        : `bg-[${PRIMARY_COLOR}]/20 border-[${PRIMARY_COLOR}]/50 text-[${TEXT_COLOR}] hover:bg-[${HOVER_BG_COLOR}]`
    }`}
  >
    {children}
  </button>
);


const TimelineControls: React.FC<TimelineControlsProps> = ({
  isVisible, isPlaying, onPlayPause, onScrub, scrubberValue, onStepFrame,
  playbackSpeed, onSetSpeed, minDate, maxDate
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
  let nowPositionPercent = -1; // Default to off-screen

  if (totalDuration > 0 && nowTimestamp >= minDate && nowTimestamp <= maxDate) {
    nowPositionPercent = ((nowTimestamp - minDate) / totalDuration) * 100;
  }


  return (
    <div className={`fixed bottom-5 left-1/2 -translate-x-1/2 w-11/12 lg:w-4/5 lg:max-w-3xl bg-[#14193c]/80 backdrop-blur-md border border-sky-500/30 rounded-lg p-3 shadow-xl text-[${TEXT_COLOR}] space-y-2`}>
      <div className="flex items-center space-x-2 md:space-x-3">
        <label htmlFor="timeline-scrubber" className="hidden md:block text-sm font-medium whitespace-nowrap">Time Control:</label>
        <PlaybackButton onClick={() => onStepFrame(-1)} title="Previous Frame"><PrevIcon className="w-4 h-4" /></PlaybackButton>
        <PlaybackButton onClick={onPlayPause} title={isPlaying ? "Pause" : "Play"}>
          {isPlaying ? <PauseIcon className="w-4 h-4" /> : <PlayIcon className="w-4 h-4" />}
        </PlaybackButton>
        <PlaybackButton onClick={() => onStepFrame(1)} title="Next Frame"><NextIcon className="w-4 h-4" /></PlaybackButton>
        
        <div className="relative flex-grow flex items-center h-5">
            <input
            type="range"
            id="timeline-scrubber"
            min="0"
            max="1000"
            value={scrubberValue}
            onChange={(e) => onScrub(parseInt(e.target.value, 10))}
            className="w-full h-2 bg-sky-700/50 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-sky-400 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-sky-400"
            />
            {nowPositionPercent >= 0 && (
            <>
                <div
                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-red-400 rounded-full pointer-events-none shadow-md"
                style={{ left: `${nowPositionPercent}%` }}
                title={`Current Time: ${new Date(nowTimestamp).toLocaleString()}`}
                />
                <div
                className="absolute top-[-10px] text-[10px] text-red-400/90 pointer-events-none font-semibold uppercase tracking-wider"
                style={{ left: `calc(${nowPositionPercent}% + 6px)` }}
                >
                Forecast
                </div>
            </>
            )}
        </div>

        <div className="hidden sm:block text-xs tabular-nums whitespace-nowrap min-w-[150px] text-right text-gray-400">
          {getCurrentTimelineDate()}
        </div>
      </div>
      <div className="flex items-center space-x-2 justify-center">
        <span className="text-sm">Speed:</span>
        <SpeedButton onClick={() => onSetSpeed(0.5)} isActive={playbackSpeed === 0.5}>0.5x</SpeedButton>
        <SpeedButton onClick={() => onSetSpeed(1)} isActive={playbackSpeed === 1}>1x</SpeedButton>
        <SpeedButton onClick={() => onSetSpeed(2)} isActive={playbackSpeed === 2}>2x</SpeedButton>
        <SpeedButton onClick={() => onSetSpeed(5)} isActive={playbackSpeed === 5}>5x</SpeedButton>
      </div>
    </div>
  );
};

export default TimelineControls;