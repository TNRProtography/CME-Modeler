import React, { useEffect, useState } from 'react';
import { fetchSolarActivityData, SolarFlareData } from '../services/nasaService';
import DataChart from './DataChart';
import SunImageViewer from './SunImageViewer';
import HomeIcon from './icons/HomeIcon';
import LoadingSpinner from './icons/LoadingSpinner';

interface SolarFlaresPageProps {
  onClose: () => void;
}

const SolarFlaresPage: React.FC<SolarFlaresPageProps> = ({ onClose }) => {
  const [xrayData, setXrayData] = useState<any>(null);
  const [protonData, setProtonData] = useState<any>(null);
  const [flareData, setFlareData] = useState<SolarFlareData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // This now fetches everything in one go from our secure proxy
        const { xray, proton, flares } = await fetchSolarActivityData();

        // Process X-Ray data for chart
        if (xray && xray.length > 0) {
          setXrayData({
            labels: xray.map(d => new Date(d.time_tag).toLocaleTimeString()),
            datasets: [{
              label: 'X-Ray Flux (watts/m^2)',
              data: xray.map(d => d.flux),
              borderColor: '#facc15',
              backgroundColor: 'rgba(250, 204, 21, 0.2)',
              fill: true,
              pointRadius: 0,
              borderWidth: 1.5,
            }],
          });
        }
        
        // Process Proton data for chart
        if (proton && proton.length > 0) {
          setProtonData({
            labels: proton.map(d => new Date(d.time_tag).toLocaleTimeString()),
            datasets: [{
              label: 'Proton Flux (>10 MeV)',
              data: proton.map(d => d.flux),
              borderColor: '#f87171',
              backgroundColor: 'rgba(248, 113, 113, 0.2)',
              fill: true,
              pointRadius: 0,
              borderWidth: 1.5,
            }],
          });
        }
        
        setFlareData(flares);

      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const commonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { color: '#a3a3a3', maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
        grid: { color: '#404040' },
      },
      y: {
        type: 'logarithmic',
        ticks: { color: '#a3a3a3' },
        grid: { color: '#404040' },
      },
    },
    plugins: {
      legend: { labels: { color: '#e5e5e5' } },
    },
    interaction: {
        intersect: false,
        mode: 'index',
    },
  };

  const ActiveRegionsList = ({ flares }: { flares: SolarFlareData[] }) => {
    const activeRegions = flares.reduce((acc, flare) => {
      if (!acc.some(item => item.activeRegionNum === flare.activeRegionNum)) {
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
          ) : (
            <p className="text-neutral-400 italic p-2">No numbered active regions with recent flares.</p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-screen h-screen bg-black flex flex-col text-neutral-300">
      <header className="flex-shrink-0 p-4 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-700/60 flex justify-between items-center">
        <h1 className="text-xl lg:text-2xl font-bold text-white">Live Solar Activity</h1>
        <button
          onClick={onClose}
          className="flex items-center space-x-2 px-4 py-2 bg-neutral-800/80 border border-neutral-700/60 rounded-lg text-neutral-200 shadow-lg hover:bg-neutral-700/90 transition-colors"
          title="Back to 3D CME Modeler"
        >
          <HomeIcon className="w-5 h-5" />
          <span className="text-sm font-semibold">3D CME Modeler</span>
        </button>
      </header>
      
      <main className="flex-grow p-4 overflow-y-auto styled-scrollbar">
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-full">
            <LoadingSpinner />
            <p className="mt-4 text-lg">Fetching live solar data...</p>
          </div>
        )}
        {error && <div className="text-center text-red-400 text-lg p-8">Error: {error}</div>}
        {!isLoading && !error && (
          <div className="space-y-6 max-w-7xl mx-auto">
            
            <SunImageViewer />

            <div className="bg-neutral-900/80 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-neutral-200 mb-2">GOES X-Ray Flux (5-min)</h3>
              <div className="relative h-72">
                {xrayData ? <DataChart data={xrayData} options={commonChartOptions} /> : <p>No X-Ray data available.</p>}
              </div>
            </div>

            <ActiveRegionsList flares={flareData} />

            <div className="bg-neutral-900/80 p-4 rounded-lg">
              <h3 className="text-lg font-semibold text-neutral-200 mb-2">GOES Proton Flux (5-min)</h3>
              <div className="relative h-72">
                {protonData ? <DataChart data={protonData} options={commonChartOptions} /> : <p>No Proton Flux data available.</p>}
              </div>
            </div>

          </div>
        )}
      </main>
    </div>
  );
};

export default SolarFlaresPage;