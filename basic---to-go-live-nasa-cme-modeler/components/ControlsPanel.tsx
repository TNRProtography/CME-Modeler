
import React from 'react';
import { TimeRange, ViewMode, FocusTarget, CMEFilter } from '../types';
import { PRIMARY_COLOR, TEXT_COLOR, HOVER_BG_COLOR } from '../constants';
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
    className={`flex-grow border text-sm transition-all duration-200 ease-in-out px-3 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[#02041b] focus:ring-[${PRIMARY_COLOR}] ${className} ${
      isActive
        ? `bg-[${PRIMARY_COLOR}] text-[#02041b] border-[${PRIMARY_COLOR}] font-semibold`
        : `bg-[${PRIMARY_COLOR}]/20 border-[${PRIMARY_COLOR}] text-[${TEXT_COLOR}] hover:bg-[${HOVER_BG_COLOR}] hover:border-[${PRIMARY_COLOR}]/70`
    }`}
  >
    {children}
  </button>
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
    <div className="panel lg:bg-[#14193c]/80 backdrop-blur-md lg:border lg:border-sky-500/30 lg:rounded-lg p-4 lg:shadow-xl space-y-5 lg:max-w-xs w-full h-full flex flex-col">
      <div className="flex justify-between items-center border-b border-sky-500/50 pb-2 mb-3">
        <div className="flex items-center space-x-3">
          <h1 className={`text-2xl font-bold text-[${PRIMARY_COLOR}]`}>Spot the Aurora - CME Modeler</h1>
          <body className={`text-2xl font-bold text-[${PRIMARY_COLOR}]`}>By TNR Protography</body>
          <button
            onClick={onOpenGuide}
            className="p-1 text-sky-300 hover:text-white hover:bg-sky-500/20 rounded-full transition-colors"
            title="Show App Guide"
          >
            <GuideIcon className="w-5 h-5" />
          </button>
        </div>
        {onClose && (
            <button onClick={onClose} className="lg:hidden p-1 text-gray-400 hover:text-white">
                <CloseIcon className="w-6 h-6"/>
            </button>
        )}
      </div>

      <div className="flex-grow overflow-y-auto pr-2 space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Date Range:</label>
          <div className="flex space-x-2">
            <Button onClick={() => onTimeRangeChange(TimeRange.H24)} isActive={activeTimeRange === TimeRange.H24}>24 Hours</Button>
            <Button onClick={() => onTimeRangeChange(TimeRange.D3)} isActive={activeTimeRange === TimeRange.D3}>3 Days</Button>
            <Button onClick={() => onTimeRangeChange(TimeRange.D7)} isActive={activeTimeRange === TimeRange.D7}>7 Days</Button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">View:</label>
          <div className="flex space-x-2">
            <Button onClick={() => onViewChange(ViewMode.TOP)} isActive={activeView === ViewMode.TOP}>Top-Down</Button>
            <Button onClick={() => onViewChange(ViewMode.SIDE)} isActive={activeView === ViewMode.SIDE}>Side View</Button>
          </div>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Focus:</label>
          <div className="flex space-x-2">
            <Button onClick={() => onFocusChange(FocusTarget.SUN)} isActive={activeFocus === FocusTarget.SUN}>Sun</Button>
            <Button onClick={() => onFocusChange(FocusTarget.EARTH)} isActive={activeFocus === FocusTarget.EARTH}>Earth</Button>
          </div>
        </div>

        <div className="pt-2">
          <label className="block text-sm font-medium text-gray-300 mb-2 border-t border-sky-500/30 pt-3">Display Options:</label>
          <div className="space-y-2">
            <ToggleSwitch label="Show Labels" checked={showLabels} onChange={onShowLabelsChange} />
            <ToggleSwitch label="Show Other Planets" checked={showExtraPlanets} onChange={onShowExtraPlanetsChange} />
            <ToggleSwitch label="Show Moon & L1" checked={showMoonL1} onChange={onShowMoonL1Change} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-300 mb-1.5">Filter CMEs:</label>
          <div className="flex space-x-2 text-xs">
            <Button onClick={() => onCmeFilterChange(CMEFilter.ALL)} isActive={cmeFilter === CMEFilter.ALL}>All</Button>
            <Button onClick={() => onCmeFilterChange(CMEFilter.EARTH_DIRECTED)} isActive={cmeFilter === CMEFilter.EARTH_DIRECTED}>Earth-Directed</Button>
            <Button onClick={() => onCmeFilterChange(CMEFilter.NOT_EARTH_DIRECTED)} isActive={cmeFilter === CMEFilter.NOT_EARTH_DIRECTED}>Not Earth-Directed</Button>
          </div>
        </div>


        {isLoading && (
          <div className={`mt-3 text-sm text-[${PRIMARY_COLOR}] italic`}>Fetching Data... Please Wait.</div>
        )}
      </div>

      <div className="mt-auto pt-4">
        <ColorScaleGuide isMobileView={true} />
      </div>
    </div>
  );
};

export default ControlsPanel;
