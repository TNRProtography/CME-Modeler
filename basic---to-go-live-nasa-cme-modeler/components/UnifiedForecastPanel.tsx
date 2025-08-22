// --- START OF FILE src/components/UnifiedForecastPanel.tsx ---

import React, { useMemo } from 'react';
import GuideIcon from './icons/GuideIcon';
import { SubstormForecast } from '../types';

interface UnifiedForecastPanelProps {
  // Aurora forecast props
  score: number | null;
  blurb: string;
  lastUpdated: string;
  locationBlurb: string;
  getGaugeStyle: (v: number | null, type: 'power' | 'speed' | 'density' | 'bt' | 'bz') => { color: string; emoji: string; percentage: number };
  getScoreColorKey: (score: number) => 'gray' | 'yellow' | 'orange' | 'red' | 'purple' | 'pink';
  getAuroraEmoji: (score: number | null) => string;
  gaugeColors: Record<string, { solid: string }>;
  onOpenModal: (id: string) => void;
  
  // Substorm forecast props
  substormForecast: SubstormForecast;
}

export const UnifiedForecastPanel: React.FC<UnifiedForecastPanelProps> = ({
  score,
  blurb,
  lastUpdated,
  locationBlurb,
  getGaugeStyle,
  getScoreColorKey,
  getAuroraEmoji,
  gaugeColors,
  onOpenModal,
  substormForecast
}) => {
  const isDaylight = blurb.includes("The sun is currently up");
  const { status, likelihood, windowLabel, action } = substormForecast;
  
  // Determine if substorm activity is significant
  const isSubstormActive = status !== 'QUIET';
  const isSubstormImminent = status === 'IMMINENT_30' || status === 'ONSET';
  
  // Determine the overall status message
  const getOverallStatus = () => {
    if (isDaylight) return "Daylight Hours";
    if (status === 'ONSET') return "Substorm Erupting Now!";
    if (status === 'IMMINENT_30') return "Substorm Imminent";
    if (status === 'LIKELY_60') return "Substorm Likely Soon";
    if (status === 'WATCH') return "Energy Building";
    if ((score ?? 0) >= 50) return "Good Aurora Conditions";
    if ((score ?? 0) >= 25) return "Aurora Possible";
    return "Quiet Conditions";
  };
  
  // Determine status color based on combined conditions
  const getStatusColor = () => {
    if (status === 'ONSET') return 'text-pink-400';
    if (status === 'IMMINENT_30') return 'text-red-400';
    if (status === 'LIKELY_60') return 'text-orange-400';
    if (status === 'WATCH') return 'text-yellow-400';
    if ((score ?? 0) >= 50) return 'text-purple-400';
    if ((score ?? 0) >= 25) return 'text-green-400';
    return 'text-neutral-400';
  };
  
  // Combined action recommendation
  const getCombinedAction = () => {
    if (isDaylight) {
      return "The sun is currently up. Aurora visibility is not possible until after sunset. Check back later for an updated forecast!";
    }
    
    // If substorm is active, prioritize that message
    if (isSubstormActive) {
      return action;
    }
    
    // Otherwise use aurora forecast blurb
    return blurb;
  };
  
  // Likelihood gradient for substorm
  const likelihoodGrad = useMemo(() => {
    if (likelihood >= 80) return "from-emerald-400 to-green-600";
    if (likelihood >= 50) return "from-amber-400 to-orange-500";
    if (likelihood >= 25) return "from-yellow-300 to-amber-400";
    return "from-neutral-600 to-neutral-700";
  }, [likelihood]);

  return (
    <div id="unified-forecast-section" className="col-span-12 card bg-neutral-950/80 p-6">
      {/* Header with status */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-white">Aurora & Substorm Forecast</h2>
          <button 
            onClick={() => onOpenModal('unified-forecast')} 
            className="p-1 text-neutral-400 hover:text-neutral-100" 
            title="About this forecast"
          >
            <GuideIcon className="w-6 h-6" />
          </button>
        </div>
        <div className={`text-lg font-semibold ${getStatusColor()}`}>
          {getOverallStatus()}
        </div>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left column: Aurora Score & Gauge */}
        <div className="space-y-4">
          <div className="text-center lg:text-left">
            <div className="text-6xl font-extrabold text-white">
              {score !== null ? `${score.toFixed(1)}%` : '...'} 
              <span className="text-5xl ml-2">{getAuroraEmoji(score)}</span>
            </div>
            <div className="text-sm text-neutral-400 mt-1">Aurora Visibility Score</div>
          </div>
          
          {/* Aurora gauge */}
          <div className="w-full bg-neutral-700 rounded-full h-3">
            <div
              className="h-3 rounded-full transition-all duration-500"
              style={{
                width: `${score !== null ? getGaugeStyle(score, 'power').percentage : 0}%`,
                backgroundColor: score !== null ? gaugeColors[getScoreColorKey(score)].solid : gaugeColors.gray.solid,
              }}
            />
          </div>
          
          {/* Location and update info */}
          <div className="space-y-1">
            <div className="text-sm text-neutral-400">{lastUpdated}</div>
            <div className="text-xs text-neutral-500 italic">{locationBlurb}</div>
          </div>
        </div>

        {/* Right column: Substorm & Action */}
        <div className="space-y-4">
          {/* Substorm status section - only show if not quiet */}
          {isSubstormActive && (
            <div className="bg-neutral-900/50 rounded-lg p-4 border border-neutral-700/50">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="text-sm text-neutral-400">Substorm Activity</div>
                  <div className="text-xl font-semibold text-white">{windowLabel}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-neutral-400">Likelihood</div>
                  <div className="text-2xl font-bold text-white">{likelihood}%</div>
                </div>
              </div>
              
              {/* Substorm likelihood gauge */}
              <div className="h-2 w-full rounded-full bg-neutral-800 overflow-hidden">
                <div 
                  className={`h-full bg-gradient-to-r ${likelihoodGrad} transition-all duration-500`} 
                  style={{ width: `${likelihood}%` }}
                />
              </div>
              
              {/* Substorm status label */}
              <div className="mt-2 text-xs text-neutral-500">
                Status: {status.replace("_", " ")}
              </div>
            </div>
          )}
          
          {/* Combined action/advice box */}
          <div className={`rounded-lg p-4 ${isSubstormImminent ? 'bg-red-900/20 border border-red-700/50' : 'bg-neutral-900/50 border border-neutral-700/50'}`}>
            <div className="text-sm text-neutral-300 font-medium mb-1">
              {isSubstormActive ? 'Recommended Action' : 'Current Conditions'}
            </div>
            <p className="text-neutral-200">
              {getCombinedAction()}
            </p>
          </div>
        </div>
      </div>

      {/* Bottom status bar for critical alerts */}
      {isSubstormImminent && (
        <div className="mt-4 p-3 bg-gradient-to-r from-red-900/30 to-orange-900/30 border border-red-700/50 rounded-lg">
          <div className="flex items-center justify-center gap-2">
            <span className="animate-pulse text-red-400">⚡</span>
            <span className="text-sm font-semibold text-red-300">
              {status === 'ONSET' ? 'Substorm activity detected! Look now!' : 'High probability of substorm activity very soon!'}
            </span>
            <span className="animate-pulse text-red-400">⚡</span>
          </div>
        </div>
      )}
    </div>
  );
};
// --- END OF FILE src/components/UnifiedForecastPanel.tsx ---