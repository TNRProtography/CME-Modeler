import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { fetchSolarActivityData, SolarFlareData } from '../services/nasaService';
// Assuming ChartCard.tsx exists in the same directory:
import ChartCard from './ChartCard';
import SunImageViewer from './SunImageViewer';
import HomeIcon from './icons/HomeIcon';
import ForecastIcon from './icons/ForecastIcon';
import LoadingSpinner from './icons/LoadingSpinner';

type TimeRangeHours = 1 | 2 | 4 | 6;

// Helper function to create the X-Ray chart configuration
const createXrayChartConfig = (rawData: any[], timeRangeHours: TimeRangeHours) => {
  console.log('createXrayChartConfig: rawData received:', rawData);

  // Ensure rawData is an array and not empty
  if (!Array.isArray(rawData) || rawData.length === 0) {
    console.warn('createXrayChartConfig: No raw X-ray data or not an array.');
    return null; // Return null if no data to prevent chart rendering
  }

  const now = Date.now();
  const startTime = now - timeRangeHours * 60 * 60 * 1000;
  console.log(`createXrayChartConfig: Filtering for data since ${new Date(startTime).toISOString()} (${timeRangeHours} hours)`);

  const filteredData = rawData.filter(d => {
    // IMPORTANT: Defensive checks for each data point
    const isValid = d && typeof d.timestamp === 'number' && !isNaN(d.timestamp) &&
                    typeof d.flux === 'number' && !isNaN(d.flux) &&
                    d.timestamp >= startTime;
    if (!isValid) {
      console.warn('createXrayChartConfig: Invalid X-ray data point filtered out:', d);
    }
    return isValid;
  });

  console.log(`createXrayChartConfig: Filtered X-ray data points: ${filteredData.length}`);
  if (filteredData.length === 0) return null;

  const data = {
    datasets: [{
      label: 'X-Ray Flux (watts/m^2)',
      data: filteredData.map(d => ({ x: d.timestamp, y: d.flux })),
      borderColor: '#facc15',
      backgroundColor: 'rgba(250, 204, 21, 0.2)',
      fill: true,
      pointRadius: 0,
      borderWidth: 1.5,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    interaction: { intersect: false, mode: 'index' as const },
    scales: {
      x: {
        type: 'time' as const,
        time: { tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } },
        adapters: { date: { locale: 'en-NZ', timeZone: 'Pacific/Auckland' } },
        ticks: { color: '#a3a3a3' },
        grid: { color: '#404040' },
      },
      y: {
        type: 'logarithmic' as const,
        min: 1e-9, // Ensure this min is appropriate for your data range
        max: 1e-2, // Ensure this max is appropriate for your data range
        ticks: {
          color: '#a3a3a3',
          callback: (value: any) => {
            // Ensure value is a number before comparison
            const numValue = Number(value);
            if (isNaN(numValue)) return null;

            if (numValue === 1e-8) return 'A';
            if (numValue === 1e-7) return 'B';
            if (numValue === 1e-6) return 'C';
            if (numValue === 1e-5) return 'M';
            if (numValue === 1e-4) return 'X';
            return null;
          },
        },
        grid: { color: '#404040' },
      },
    },
  };
  console.log('createXrayChartConfig: Returning X-ray chart config.');
  return { data, options };
};

// Helper function to create the Proton chart configuration
const createProtonChartConfig = (rawData: any[], timeRangeHours: TimeRangeHours) => {
    console.log('createProtonChartConfig: rawData received:', rawData);

    if (!Array.isArray(rawData) || rawData.length === 0) {
        console.warn('createProtonChartConfig: No raw Proton data or not an array.');
        return null;
    }

    const now = Date.now();
    const startTime = now - timeRangeHours * 60 * 60 * 1000;
    console.log(`createProtonChartConfig: Filtering for data since ${new Date(startTime).toISOString()} (${timeRangeHours} hours)`);

    const filteredData = rawData.filter(d => {
        // IMPORTANT: Defensive checks for each data point
        const isValid = d && typeof d.timestamp === 'number' && !isNaN(d.timestamp) &&
                        typeof d.flux === 'number' && !isNaN(d.flux) &&
                        typeof d.energy === 'string' && d.energy.length > 0 &&
                        d.timestamp >= startTime;
        if (!isValid) {
            console.warn('createProtonChartConfig: Invalid Proton data point filtered out:', d);
        }
        return isValid;
    });

    console.log(`createProtonChartConfig: Filtered Proton data points: ${filteredData.length}`);
    if (filteredData.length === 0) return null;

    const dataByEnergy: { [key: string]: { x: number, y: number }[] } = {};
    filteredData.forEach(p => {
        if (!dataByEnergy[p.energy]) dataByEnergy[p.energy] = [];
        dataByEnergy[p.energy].push({ x: p.timestamp, y: p.flux });
    });

    const protonColors: { [key: string]: string } = {
        '>=10 MeV': '#f87171', '>=50 MeV': '#fb923c',
        '>=100 MeV': '#fbbf24', '>=500 MeV': '#a3e635',
    };

    const data = {
        datasets: Object.keys(dataByEnergy).map(energy => ({
        label: `Proton Flux ${energy.replace('>=', '≥')}`,
        data: dataByEnergy[energy],
        borderColor: protonColors[energy] || '#a3a3a3',
        backgroundColor: 'transparent',
        pointRadius: 0,
        borderWidth: 1.5,
        })),
    };

    const options = {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e5e5e5' } } },
        interaction: { intersect: false, mode: 'index' as const },
        scales: {
            x: {
                type: 'time' as const,
                time: { tooltipFormat: 'HH:mm' },
                adapters: { date: { locale: 'en-NZ', timeZone: 'Pacific/Auckland' } },
                ticks: { color: '#a3a3a3' },
                grid: { color: '#404040' },
            },
            y: {
                type: 'logarithmic' as const,
                min: 1e-1, // Ensure this min is appropriate for your data range
                ticks: { color: '#a3a3a3' },
                grid: { color: '#404040' },
            },
        },
    };
    console.log('createProtonChartConfig: Returning Proton chart config.');
    return { data, options };
};

// Component for Active Regions List (extracted for clarity and robustness)
const ActiveRegionsList = ({ flares }: { flares: SolarFlareData[] }) => {
    // Memoize the calculation of active regions for performance
    const activeRegions = useMemo(() => {
        // Ensure flares is an array, provide empty array as fallback
        const allRegions = (flares || []).reduce((acc, flare) => {
            // Defensive check for flare object and its necessary properties
            if (flare && typeof flare.activeRegionNum === 'number' && !isNaN(flare.activeRegionNum)) {
                // Use nullish coalescing to ensure properties are never null/undefined if API sends them that way
                acc.push({
                    activeRegionNum: flare.activeRegionNum,
                    classType: flare.classType ?? 'Unknown Class', // Provide default
                    location: flare.sourceLocation ?? 'Unknown Location', // Provide default
                });
            } else {
                console.warn('ActiveRegionsList: Invalid flare data point filtered out:', flare);
            }
            return acc;
        }, [] as { activeRegionNum: number; classType: string; location: string }[]);

        // Filter out duplicate active region numbers (keep the last one in case of updates)
        const uniqueRegionsMap = new Map();
        allRegions.forEach(region => {
            uniqueRegionsMap.set(region.activeRegionNum, region);
        });

        const uniqueRegions = Array.from(uniqueRegionsMap.values());

        // Sort by active region number
        return uniqueRegions.sort((a, b) => a.activeRegionNum - b.activeRegionNum);
    }, [flares]); // Re-calculate only when 'flares' prop changes

    return (
      <div className="bg-neutral-900/80 p-4 rounded-lg">
        <h3 className="text-lg font-semibold text-neutral-200 mb-2">Active Sunspot Regions</h3>
        <div className="bg-neutral-950/70 p-3 rounded-md h-72 overflow-y-auto styled-scrollbar">
          {activeRegions.length > 0 ? (
            <ul className="space-y-1">
              {activeRegions.map(region => (
                <li key={region.activeRegionNum} className="text-sm text-neutral-300 p-2 rounded-md">
                  <strong className="text-white">AR{region.activeRegionNum}:</strong>
                  <span className="ml-2 text-amber-400 font-mono">{region.classType}</span>
                  <span className="ml-2 text-neutral-400">({region.location})</span>
                </li>
              ))}
            </ul>
          ) : (<p className="text-neutral-400 italic p-2">No numbered active regions with recent flares.</p>)}
        </div>
      </div>
    );
};


// Main SolarFlaresPage Component
interface SolarFlaresPageProps {
  onNavChange: (page: 'modeler' | 'forecast') => void;
}

const SolarFlaresPage: React.FC<SolarFlaresPageProps> = ({ onNavChange }) => {
  // State to hold the raw data as fetched from the API
  const [rawData, setRawData] = useState<{ xray: any[], proton: any[], flares: SolarFlareData[] }>({ xray: [], proton: [], flares: [] });
  
  // State for the selected time range (e.g., 1 hour, 2 hours, etc.)
  const [timeRange, setTimeRange] = useState<TimeRangeHours>(2);
  
  // State to manage loading indicator
  const [isLoading, setIsLoading] = useState(true);
  
  // State to store any fetch errors
  const [error, setError] = useState<string | null>(null);

  // Effect to fetch initial data from the API. Runs only once on component mount.
  useEffect(() => {
    const doFetch = async () => {
      try {
        setIsLoading(true);
        setError(null);
        console.log('Fetching solar activity data...');
        const fetchedData = await fetchSolarActivityData();
        console.log('Solar activity data fetched:', fetchedData);
        setRawData(fetchedData);
      } catch (err) {
        const errorMessage = (err instanceof Error) ? err.message : String(err);
        console.error('Error fetching solar activity data:', errorMessage);
        setError(`Failed to load data: ${errorMessage}`);
      } finally {
        setIsLoading(false);
      }
    };
    doFetch();
  }, []); // Empty dependency array means this runs once on mount

  // Memoized chart configurations, re-calculates only when rawData or timeRange changes
  const chartConfigs = useMemo(() => {
    if (isLoading) {
      console.log('chartConfigs: isLoading is true, returning null configs.');
      return { xray: null, proton: null };
    }
    
    // Create chart configs using the helper functions
    const xray = createXrayChartConfig(rawData.xray, timeRange);
    const proton = createProtonChartConfig(rawData.proton, timeRange);
    
    console.log('chartConfigs: Generated configs:', { xray, proton });
    return { xray, proton };
  }, [isLoading, rawData, timeRange]); // Dependencies for useMemo

  return (
    <div className="w-screen h-screen bg-black flex flex-col text-neutral-300">
      <header className="flex-shrink-0 p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-between items-center">
        <h1 className="text-xl lg:text-2xl font-bold text-white">Live Solar Activity</h1>
        <div className="flex items-center gap-4">
          <button onClick={() => onNavChange('forecast')} className="flex items-center space-x-2 px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-700/90 transition-colors" title="View Aurora Forecast"><ForecastIcon className="w-5 h-5" /><span className="text-sm font-semibold">Aurora Forecast</span></button>
          <button onClick={() => onNavChange('modeler')} className="flex items-center space-x-2 px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-700/90 transition-colors" title="Back to 3D CME Modeler"><HomeIcon className="w-5 h-5" /><span className="text-sm font-semibold">3D CME Modeler</span></button>
        </div>
      </header>
      
      <main className="flex-grow p-4 overflow-y-auto styled-scrollbar">
        {/* Conditional rendering for loading, error, or content */}
        {isLoading ? (
            <div className="flex flex-col items-center justify-center h-full"><LoadingSpinner /><p className="mt-4 text-lg">Fetching live solar data...</p></div>
        ) : error ? (
            <div className="text-center text-red-400 text-lg p-8">Error: {error}</div>
        ) : (
          <div className="space-y-6 max-w-7xl mx-auto">
            <SunImageViewer />

            {/* X-Ray Flux Chart Card */}
            <div className="bg-neutral-900/80 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-neutral-200">GOES X-Ray Flux (NZT)</h3>
                <div className="flex gap-1">
                  {([1, 2, 4, 6] as TimeRangeHours[]).map(h => (
                    <button key={h} onClick={() => setTimeRange(h)} className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${timeRange === h ? 'bg-neutral-200 text-black border-neutral-200' : 'bg-transparent border-neutral-600 hover:bg-neutral-700'}`}>{h}H</button>
                  ))}
                </div>
              </div>
              <div className="relative h-72">
                {/* Use chartConfigs.xray which is memoized */}
                {chartConfigs.xray && chartConfigs.xray.data.datasets[0].data.length > 0 ? (
                  <DataChart data={chartConfigs.xray.data} options={chartConfigs.xray.options} />
                ) : (<p className="text-center text-neutral-400 pt-10">No X-Ray data available for this time range.</p>)}
              </div>
            </div>
            
            {/* Active Regions List */}
            <ActiveRegionsList flares={rawData.flares} />
            
            {/* Proton Flux Chart Card */}
            <div className="bg-neutral-900/80 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2"><h3 className="text-lg font-semibold text-neutral-200">GOES Proton Flux (NZT)</h3></div>
              <div className="relative h-72">
                {/* Use chartConfigs.proton which is memoized */}
                {chartConfigs.proton && chartConfigs.proton.data.datasets.some((ds:any) => ds.data.length > 0) ? (
                    <DataChart data={chartConfigs.proton.data} options={chartConfigs.proton.options} />
                ) : (<p className="text-center text-neutral-400 pt-10">No Proton Flux data available.</p>)}
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
};

export default SolarFlaresPage;