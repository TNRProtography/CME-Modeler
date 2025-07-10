// SolarFlaresPage.tsx

import React, { useEffect, useState, useMemo } from 'react';
import { fetchSolarActivityData, SolarFlareData } from '../services/nasaService';
import DataChart from './DataChart';
import SunImageViewer from './SunImageViewer';
import HomeIcon from './icons/HomeIcon';
import ForecastIcon from './icons/ForecastIcon';
import LoadingSpinner from './icons/LoadingSpinner';

type TimeRangeHours = 1 | 2 | 4 | 6;

interface SolarFlaresPageProps {
  onNavChange: (page: 'modeler' | 'forecast') => void;
}

const SolarFlaresPage: React.FC<SolarFlaresPageProps> = ({ onNavChange }) => {
  const [fullXrayData, setFullXrayData] = useState<any[]>([]);
  const [fullProtonData, setFullProtonData] = useState<any[]>([]);
  const [flareData, setFlareData] = useState<SolarFlareData[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRangeHours>(2);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const { xray, proton, flares } = await fetchSolarActivityData();
        setFullXrayData(Array.isArray(xray) ? xray : []);
        setFullProtonData(Array.isArray(proton) ? proton : []);
        setFlareData(Array.isArray(flares) ? flares : []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);

  const now = Date.now();
  const startTime = now - timeRange * 60 * 60 * 1000;
  
  const filteredXray = fullXrayData.filter(d => d.timestamp >= startTime);
  const filteredProton = fullProtonData.filter(d => d.timestamp >= startTime);
  
  const xrayChartData = {
    datasets: [{
      label: 'X-Ray Flux (watts/m^2)',
      data: filteredXray.map(d => ({ x: d.timestamp, y: d.flux })),
      borderColor: '#facc15',
      backgroundColor: 'rgba(250, 204, 21, 0.2)',
      fill: true,
      pointRadius: 0,
      borderWidth: 1.5,
    }],
  };

  const xrayChartOptions = {
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

  const protonDataByEnergy: { [key: string]: { x: number, y: number }[] } = {};
  filteredProton.forEach(p => {
    if (!protonDataByEnergy[p.energy]) protonDataByEnergy[p.energy] = [];
    protonDataByEnergy[p.energy].push({ x: p.timestamp, y: p.flux });
  });

  const protonColors: { [key: string]: string } = {
    '>=10 MeV': '#f87171', '>=50 MeV': '#fb923c',
    '>=100 MeV': '#fbbf24', '>=500 MeV': '#a3e635',
  };

  const protonChartData = {
    datasets: Object.keys(protonDataByEnergy).map(energy => ({
      label: `Proton Flux ${energy.replace('>=', '≥')}`,
      data: protonDataByEnergy[energy],
      borderColor: protonColors[energy] || '#a3a3a3',
      backgroundColor: 'transparent',
      pointRadius: 0,
      borderWidth: 1.5,
    })),
  };

  const protonChartOptions = {
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

  const xrayAnnotationsPlugin = {
    id: 'xrayAnnotations',
    afterDraw: (chart: any) => {
      // --- THIS IS THE BULLETPROOF FIX ---
      // We check not just for the parent objects, but for all the specific properties
      // we are about to use. This prevents any "Cannot read properties of undefined" errors.
      if (
        !chart.ctx ||
        !chart.chartArea ||
        typeof chart.chartArea.left === 'undefined' ||
        typeof chart.chartArea.right === 'undefined' ||
        typeof chart.chartArea.top === 'undefined' ||
        typeof chart.chartArea.bottom === 'undefined' ||
        !chart.scales ||
        !chart.scales.y
      ) {
        return; // Exit early if the chart isn't fully ready
      }
      // --- END OF FIX ---

      const { ctx, chartArea: { left, right, top, bottom }, scales: { y } } = chart;
      const flareClasses = [
        { level: 1e-8, label: 'A' }, { level: 1e-7, label: 'B' },
        { level: 1e-6, label: 'C' }, { level: 1e-5, label: 'M' },
        { level: 1e-4, label: 'X' },
      ];
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      flareClasses.forEach(({ level, label }) => {
        const yPos = y.getPixelForValue(level);
        // We use the destructured `top` and `bottom` for the check
        if (yPos >= top && yPos <= bottom) {
          ctx.beginPath();
          ctx.setLineDash([2, 4]);
          ctx.moveTo(left, yPos);
          ctx.lineTo(right, yPos);
          ctx.stroke();
          ctx.fillText(label, left - 5, yPos);
        }
      });
      ctx.restore();
    }
  };

  const ActiveRegionsList = ({ flares }: { flares: SolarFlareData[] }) => {
    const activeRegions = flares.reduce((acc, flare) => {
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
        {isLoading && (
          <div className="flex flex-col items-center justify-center h-full">
            <LoadingSpinner />
            <p className="mt-4 text-lg">Fetching live solar data...</p>
          </div>
        )}
        {error && <div className="text-center text-red-400 text-lg p-8">Error: {error.toString()}</div>}
        {!isLoading && !error && (
          <div className="space-y-6 max-w-7xl mx-auto">
            <SunImageViewer />
            <div className="bg-neutral-900/80 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-lg font-semibold text-neutral-200">GOES X-Ray Flux (NZT)</h3>
                <div className="flex gap-1">
                  {([1, 2, 4, 6] as TimeRangeHours[]).map(h => (
                    <button key={h} onClick={() => setTimeRange(h)} className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${timeRange === h ? 'bg-neutral-200 text-black border-neutral-200' : 'bg-transparent border-neutral-600 hover:bg-neutral-700'}`}>
                      {h}H
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative h-72">
                {xrayChartData.datasets[0].data.length > 0 
                  ? <DataChart data={xrayChartData} options={xrayChartOptions} plugins={[xrayAnnotationsPlugin]} /> 
                  : <p className="text-center text-neutral-400 pt-10">No X-Ray data available for this time range.</p>}
              </div>
            </div>
            <ActiveRegionsList flares={flareData} />
            <div className="bg-neutral-900/80 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                 <h3 className="text-lg font-semibold text-neutral-200">GOES Proton Flux (NZT)</h3>
              </div>
              <div className="relative h-72">
                {protonChartData.datasets.length > 0 && protonChartData.datasets.some(ds => ds.data.length > 0)
                  ? <DataChart data={protonChartData} options={protonChartOptions} /> 
                  : <p className="text-center text-neutral-400 pt-10">No Proton Flux data available.</p>}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default SolarFlaresPage;