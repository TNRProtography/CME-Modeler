// --- START OF FILE src/components/GraphModal.tsx ---

import React from 'react';
import CloseIcon from './icons/CloseIcon';
import { ExpandedGraphContent } from './ForecastCharts';

interface GraphModalProps {
    isOpen: boolean;
    onClose: () => void;
    graphId: string | null;
    // Pass-through props for ExpandedGraphContent
    solarWindTimeRange: number; setSolarWindTimeRange: (d: number, l: string) => void; solarWindTimeLabel: string;
    magneticFieldTimeRange: number; setMagneticFieldTimeRange: (d: number, l: string) => void; magneticFieldTimeLabel: string;
    hemisphericPowerChartTimeRange: number; setHemisphericPowerChartTimeRange: (d: number, l: string) => void; hemisphericPowerChartTimeLabel: string;
    magnetometerTimeRange: number; setMagnetometerTimeRange: (d: number, l: string) => void; magnetometerTimeLabel: string;
    openModal: (id: string) => void;
    allSpeedData: any[]; allDensityData: any[]; allMagneticData: any[]; hemisphericPowerHistory: any[];
    goes18Data: any[]; goes19Data: any[]; loadingMagnetometer: string | null; substormBlurb: { text: string; color: string };
    getMagnetometerAnnotations: (data: any[]) => any;
}

const graphTitles: Record<string, string> = {
    'speed-graph-container': 'Live Solar Wind Speed',
    'density-graph-container': 'Live Solar Wind Density',
    'imf-graph-container': 'Live Interplanetary Magnetic Field',
    'hemispheric-power-graph-container': 'Hemispheric Power Trend',
    'goes-mag-graph-container': 'GOES Magnetometer (Substorm Watch)',
};

const GraphModal: React.FC<GraphModalProps> = (props) => {
    const { isOpen, onClose, graphId } = props;

    if (!isOpen || !graphId) {
        return null;
    }
    
    return (
        <div 
            className="fixed inset-0 bg-black/80 backdrop-blur-md z-[2100] flex justify-center items-center p-4" 
            onClick={onClose}
        >
            <div 
                className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-4xl h-[70vh] max-h-[700px] text-neutral-300 flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex justify-between items-center p-4 border-b border-neutral-700/80 flex-shrink-0">
                    <h3 className="text-xl font-bold text-neutral-200">{graphTitles[graphId] || 'Chart'}</h3>
                    <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
                        <CloseIcon className="w-6 h-6" />
                    </button>
                </div>

                <div className="overflow-y-auto p-4 flex-grow min-h-0">
                   <ExpandedGraphContent {...props} />
                </div>
            </div>
        </div>
    );
};

export default GraphModal;
// --- END OF FILE src/components/GraphModal.tsx ---