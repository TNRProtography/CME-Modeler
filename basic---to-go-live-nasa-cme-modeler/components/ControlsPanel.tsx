import React from 'react';
import { TimeRange, ViewMode, FocusTarget, CMEFilter } from '../types';
import CloseIcon from './icons/CloseIcon';
import ColorScaleGuide from './ColorScaleGuide';
import GuideIcon from './icons/GuideIcon';
import ToggleSwitch from './ToggleSwitch';

interface ControlsPanelProps {
  activeTimeRange: TimeRange;
  onTimeRangeChange: (range: TimeRange) => void;
  activeView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  activeFocus: FocusTarget | null;
  onFocusChange: (target: FocusTarget) => void;
  isLoading: boolean;
  onOpenGuide: () => void;
  onClose?: () => void;
  showLabels: boolean;
  onShowLabelsChange: (show: boolean) => void;
  showExtraPlanets: boolean;
  onShowExtraPlanetsChange: (show: boolean) => void;
  showMoonL1: boolean;
  onShowMoonL1Change: (show: boolean) => void;
  cmeFilter: CMEFilter;
  onCmeFilterChange: (filter: CMEFilter) => void;
}

const Button: React.FC<{ onClick: () => void; isActive: boolean; children: React.ReactNode, className?: string }> = ({ onClick, isActive, children, className }) => (
  <button
    onClick={onClick}
    className={`flex-grow border text-sm transition-all duration-200 ease-in-out px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-neutral-950 focus:ring-neutral-400 ${className} ${
      isActive
        ? `bg-neutral-100 text-neutral-900 border-neutral-100 font-semibold`
        : `bg-transparent border-neutral-600 text-neutral-300 hover:bg-neutral-800 hover:border-neutral-500`
    }`}
  >
    {children}
  </button>
);

// === UPDATED DISCLAIMER COMPONENT ===
const Disclaimer = () => (
  <div className="mt-6 pt-4 border-t border-neutral-700/80 text-xs text-neutral-500 space-y-1">
    <p className="font-semibold text-neutral-400">Data & Accuracy Disclaimer</p>
    <p>
      Orbital and Coronal Mass Ejection (CME) data is provided by the National Aeronautics and Space Administration (NASA). This model is a visual representation for illustrative purposes only and is not to scale. No guarantee is provided for the accuracy of source data or its derived impact predictions.
    </p>
  </div>
);

const ControlsPanel: React.FC<ControlsPanelProps> = ({
  activeTimeRange,
  onTimeRangeChange,
  activeView,
  onViewChange,
  activeFocus,
  onFocusChange,
  isLoading,
  onOpenGuide,
  onClose,
  showLabels,
  onShowLabelsChange,
  showExtraPlanets,
  onShowExtraPlanetsChange,
  showMoonL1,
  onShowMoonL1Change,
  cmeFilter,
  onCmeFilterChange,
}) => {
  return (
    <div className="panel lg:bg-neutral-950/80 backdrop-blur-md lg:border lg:border-neutral-800/90 lg:rounded-lg p-4 lg:shadow-xl space-y-5 lg:max-w-xs w-full h-full flex flex-col">
      <div className="flex justify-between items-center border-b border-neutral-700/80 pb-2 mb-3">
        <div className="flex items-center space-x-3">
          <h1 className={`text-2xl font-bold text-neutral-100`}>Spot the Aurora - CME Modeler by TNR Protography</h1>
          <button
            onClick={onOpenGuide}
            className="p-1 text-neutral-400 hover:text-neutral-100 hover:bg-white/10 rounded-full transition-colors"
            title="Show App Guide"
          >
            <GuideIcon className="w-5 h-5" />
          </button>
        </div>
        {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 text-neutral-400 hover:text-white">
                <CloseIcon className="w-6 h-6"/>
            </button>
        )}
      </div>

      <div className="flex-grow overflow-y-auto pr-2 space-y-5">
        <div>
          <label className="block text-sm font-medium text-neutral-400 mb-1.5">Date Range:</label>
          <div className="flex space-x-2">
            <Button onClick={() => onTimeRangeChange(TimeRange.H24)} isActive={activeTimeRange === TimeRange.H24}>24 Hours</Button>
            <Button onClick={() => onTimeRangeChange(TimeRange.D3)} isActive={activeTimeRange === TimeRange.D3}>3 Days</Button>
            <Button onClick={() => onTimeRangeChange(TimeRange.D7)} isActive={activeTimeRange === TimeRange.D7}>7 Days</Button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-400 mb-1.5">View:</label>
          <div className="flex space-x-2">
            <Button onClick={() => onViewChange(ViewMode.TOP)} isActive={activeView === ViewMode.TOP}>Top-Down</Button>
            <Button onClick={() => onViewChange(ViewMode.SIDE)} isActive={activeView === ViewMode.SIDE}>Side View</Button>
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-neutral-400 mb-1.5">Focus:</label>
          <div className="flex space-x-2">
            <Button onClick={() => onFocusChange(FocusTarget.SUN)} isActive={activeFocus === FocusTarget.SUN}>Sun</Button>
            <Button onClick={() => onFocusChange(FocusTarget.EARTH)} isActive={activeFocus === FocusTarget.EARTH}>Earth</Button>
          </div>
        </div>

        <div className="pt-2">
          <label className="block text-sm font-medium text-neutral-400 mb-2 border-t border-neutral-700/50 pt-3">Display Options:</label>
          <div className="space-y-3">
            <ToggleSwitch label="Show Labels" checked={showLabels} onChange={onShowLabelsChange} />
            <ToggleSwitch label="Show Other Planets" checked={showExtraPlanets} onChange={onShowExtraPlanetsChange} />
            <ToggleSwitch label="Show Moon & L1" checked={showMoonL1} onChange={onShowMoonL1Change} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-neutral-400 mb-1.5">Filter CMEs:</label>
          <div className="flex space-x-2 text-xs">
            <Button onClick={() => onCmeFilterChange(CMEFilter.ALL)} isActive={cmeFilter === CMEFilter.ALL}>All</Button>
            <Button onClick={() => onCmeFilterChange(CMEFilter.EARTH_DIRECTED)} isActive={cmeFilter === CMEFilter.EARTH_DIRECTED}>Earth-Directed</Button>
            <Button onClick={() => onCmeFilterChange(CMEFilter.NOT_EARTH_DIRECTED)} isActive={cmeFilter === CMEFilter.NOT_EARTH_DIRECTED}>Not Earth-Directed</Button>
          </div>
        </div>

        {isLoading && (
          <div className={`mt-3 text-sm text-neutral-400 italic`}>Fetching Data... Please Wait.</div>
        )}

        {/* Disclaimer with professional wording is placed here */}
        <Disclaimer />

      </div>

      <div className="mt-auto pt-4">
        <ColorScaleGuide isMobileView={true} />
      </div>
    </div>
  );
};

export default ControlsPanel;