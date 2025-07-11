import React, { useEffect, useState, useCallback } from 'react';
import { fetchSolarActivityData, SolarFlareData } from '../services/nasaService';
import ChartCard from './ChartCard'; // Import our new component
import SunImageViewer from './SunImageViewer';
import HomeIcon from './icons/HomeIcon';
import ForecastIcon from './icons/ForecastIcon';
import LoadingSpinner from './icons/LoadingSpinner';

type TimeRangeHours = 1 | 2 | 4 | 6;

// Helper function to create the X-Ray chart configuration
const createXrayChartConfig = (rawData: any[], timeRangeHours: TimeRangeHours) => {
  if (!Array.isArray(rawData) || rawData.length === 0) return null;

  const now = Date.now();
  const startTime = now - timeRangeHours * 60 * 60 * 1000;
  const filteredData = rawData.filter(d => d && typeof d.timestamp === 'number' && d.timestamp >= startTime);

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
        min: 1e-9,
        max: 1e-2,
        ticks: {
          color: '#a3a3a3',
          callback: (value: any) => {
            switch (Number(value)) {
              case 1e-8: return 'A';
              case 1e-7: return 'B';
              case 1e-6: return 'C';
              case 1e-5: return 'M';
              case 1e-4: return 'X';
              default: return null;
            }
          },
        },
        grid: { color: '#404040' },
      },
    },
  };

  return { data, options };
};

// Helper function to create the Proton chart configuration
const createProtonChartConfig = (rawData: any[], timeRangeHours: TimeRangeHours) => {
    if (!Array.isArray(rawData) || rawData.length === 0) return null;

    const now = Date.now();
    const startTime = now - timeRangeHours * 60 * 60 * 1000;
    const filteredData = rawData.filter(d => d && typeof d.timestamp === 'number' && d.timestamp >= startTime);

    const dataByEnergy: { [key: string]: { x: number, y: number }[] } = {};
    filteredData.forEach(p => {
        if (!p.energy) return;
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
                time: { tooltipFormat: 'HH:mm', displayFormats: { hour: 'HH:mm' } },
                adapters: { date: { locale: 'en-NZ', timeZone: 'Pacific/Auckland' } },
                ticks: { color: '#a3a3a3' },
                grid: { color: '#404040' },
            },
            y: {
                type: 'logarithmic' as const,
                min: 1e-1,
                ticks: { color: '#a3a3a3' },
                grid: { color: '#404040' },
            },
        },
    };
    
    return { data, options };
};

const ActiveRegionsList = ({ flares }: { flares: SolarFlareData[] }) => {
    const activeRegions = (flares || []).reduce((acc, flare) => {
      if (flare && flare.activeRegionNum && !acc.some(item => item.activeRegionNum === flare.activeRegionNum)) {
        acc.push({
          activeRegionNum: flare.activeRegionNum,
          classType: flare.classType,
          location: flare.sourceLocation,
        });
      }
      return acc;
    }, [] as { activeRegionNum: number; classType: string; location: string }[]);
    
    activeRegions.sort((a, b) => a.activeRegionNum - b.activeRegionNum);
    
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

const SolarFlaresPage: React.FC<SolarFlaresPageProps> = ({ onNavChange }) => {
  // State for the raw data from the API
  const [rawXrayData, setRawXrayData] = useState<any[]>([]);
  const [rawProtonData, setRawProtonData] = useState<any[]>([]);
  const [flareData, setFlareData] = useState<SolarFlareData[]>([]);

  // State for the final, processed chart configurations
  const [xrayChartConfig, setXrayChartConfig] = useState<{ data: any; options: any } | null>(null);
  const [protonChartConfig, setProtonChartConfig] = useState<{ data: any; options: any } | null>(null);
  
  const [timeRange, setTimeRange] = useState<TimeRangeHours>(2);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Effect to fetch data from the API. Runs only once on component mount.
  useEffect(() => {
    const doFetch = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const { xray, proton, flares } = await fetchSolarActivityData();
        setRawXrayData(xray || []);
        setRawProtonData(proton || []);
        setFlareData(flares || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };
    doFetch();
  }, []);

  // Effect to process the data and update chart configs.
  // Runs whenever the raw data changes or the user selects a new time range.
  useEffect(() => {
    if (!isLoading) {
      setXrayChartConfig(createXrayChartConfig(rawXrayData, timeRange));
      setProtonChartConfig(createProtonChartConfig(rawProtonData, timeRange));
    }
  }, [isLoading, rawXrayData, rawProtonData, timeRange]);

  return (
    <div className="w-screen h-screen bg-black flex flex-col text-neutral-300">
      <header className="flex-shrink-0 p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-between items-center">
        <h1 className="text-xl lg:text-2xl font-bold text-white">Live Solar Activity</h1>
        <div className="flex items-center gap-4">
          <button onClick={() => onNavChange('forecast')} className="flex items-center space-x-2 px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-700/90 transition-colors" title="View Aurora Forecast">
            <ForecastIcon className="w-5 h-5" />
            <span className="text-sm font-semibold">Aurora Forecast</span>
          </button>
          <button onClick={() => onNavChange('modeler')} className="flex items-center space-x-2 px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-700/90 transition-colors" title="Back to 3D CME Modeler">
            <HomeIcon className="w-5 h-5" />
            <span className="text-sm font-semibold">3D CME Modeler</span>
          </button>
        </div>
      </header>
      
      <main className="flex-grow p-4 overflow-y-auto styled-scrollbar">
        {error && <div className="text-center text-red-400 text-lg p-8">Error: {error.toString()}</div>}
        
        {/* We no longer need a separate loading check here because the ChartCard handles it */}
        {!error && (
          <div className="space-y-6 max-w-7xl mx-auto">
            <SunImageViewer />

            <ChartCard title="GOES X-Ray Flux (NZT)" isLoading={isLoading} chartConfig={xrayChartConfig}>
              <div className="flex gap-1">
                {([1, 2, 4, 6] as TimeRangeHours[]).map(h => (
                  <button key={h} onClick={() => setTimeRange(h)} className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${timeRange === h ? 'bg-neutral-200 text-black border-neutral-200' : 'bg-transparent border-neutral-600 hover:bg-neutral-700'}`}>
                    {h}H
                  </button>
                ))}
              </div>
            </ChartCard>
            
            <ActiveRegionsList flares={flareData} />
            
            <ChartCard title="GOES Proton Flux (NZT)" isLoading={isLoading} chartConfig={protonChartConfig} />
          </div>
        )}
      </main>
    </div>
  );
};

export default SolarFlaresPage;