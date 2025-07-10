import React, { useEffect, useState, useMemo } from 'react';
import { fetchSolarActivityData, SolarFlareData } from '../services/nasaService';
import DataChart from './DataChart';
import SunImageViewer from './SunImageViewer';
import HomeIcon from './icons/HomeIcon';
import ForecastIcon from './icons/ForecastIcon';
import LoadingSpinner from './icons/LoadingSpinner';

type TimeRangeHours = 1 | 6 | 12 | 24;

interface SolarFlaresPageProps {
  onNavChange: (page: 'modeler' | 'forecast') => void;
}

const SolarFlaresPage: React.FC<SolarFlaresPageProps> = ({ onNavChange }) => {
  const [fullXrayData, setFullXrayData] = useState<any[]>([]);
  const [fullProtonData, setFullProtonData] = useState<any[]>([]);
  const [flareData, setFlareData] = useState<SolarFlareData[]>([]);
  const [timeRange, setTimeRange] = useState<TimeRangeHours>(6);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setIsLoading(true);
        setError(null);
        
        // This single call gets all data, now fully processed by the server
        const { xray, proton, flares } = await fetchSolarActivityData();

        setFullXrayData(xray || []);
        setFullProtonData(proton || []);
        setFlareData(flares || []);

      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, []);
  
  const chartData = useMemo(() => {
    const now = Date.now();
    const startTime = now - timeRange * 60 * 60 * 1000;
    
    const nzTimeOptions: Intl.DateTimeFormatOptions = {
        timeZone: 'Pacific/Auckland',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };

    const filterDataByTime = (data: any[]) => {
      if (!data) return [];
      // This now uses the reliable numeric timestamp from the server
      return data.filter(d => d.timestamp && d.timestamp >= startTime);
    };

    const filteredXray = filterDataByTime(fullXrayData);
    const filteredProton = filterDataByTime(fullProtonData);

    return {
      xray: {
        labels: filteredXray.map(d => new Date(d.timestamp).toLocaleTimeString('en-NZ', nzTimeOptions)),
        datasets: [{
          label: 'X-Ray Flux (watts/m^2)',
          data: filteredXray.map(d => d.flux), // Correctly using the 'flux' field
          borderColor: '#facc15', backgroundColor: 'rgba(250, 204, 21, 0.2)',
          fill: true, pointRadius: 0, borderWidth: 1.5,
        }],
      },
      proton: {
        labels: filteredProton.map(d => new Date(d.timestamp).toLocaleTimeString('en-NZ', nzTimeOptions)),
        datasets: [{
          label: 'Proton Flux (>10 MeV)',
          data: filteredProton.map(d => d.flux),
          borderColor: '#f87171', backgroundColor: 'rgba(248, 113, 113, 0.2)',
          fill: true, pointRadius: 0, borderWidth: 1.5,
        }],
      },
    };
  }, [fullXrayData, fullProtonData, timeRange]);

  const xrayAnnotationsPlugin = {
    id: 'xrayAnnotations',
    afterDraw: (chart: any) => {
      const { ctx, chartArea: { left, right }, scales: { y } } = chart;
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
        if (yPos >= chart.chartArea.top && yPos <= chart.chartArea.bottom) {
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
  
  const xrayChartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#a3a3a3', maxRotation: 0, autoSkip: true, maxTicksLimit: 8 }, grid: { color: '#404040' } },
      y: {
        type: 'logarithmic', min: 1e-9, max: 1e-2,
        ticks: { color: '#a3a3a3', callback: (value: any) => {
            switch(Number(value)) {
                case 1e-8: return 'A'; case 1e-7: return 'B';
                case 1e-6: return 'C'; case 1e-5: return 'M';
                case 1e-4: return 'X'; default: return null;
            }
        }},
        grid: { color: '#404040' },
      },
    },
    interaction: { intersect: false, mode: 'index' },
  };

  const protonChartOptions = { ...xrayChartOptions, scales: { ...xrayChartOptions.scales, y: { ...xrayChartOptions.scales.y, min: 1e-1, max: 1e5, type: 'logarithmic', ticks: { color: '#a3a3a3'} } } };
  
  const ActiveRegionsList = ({ flares }: { flares: SolarFlareData[] }) => {
    const activeRegions = flares.reduce((acc, flare) => {
      if (flare.activeRegionNum && !acc.some(item => item.activeRegionNum === flare.activeRegionNum)) {
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
                  {([1, 6, 12, 24] as TimeRangeHours[]).map(h => (
                    <button key={h} onClick={() => setTimeRange(h)} className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${timeRange === h ? 'bg-neutral-200 text-black border-neutral-200' : 'bg-transparent border-neutral-600 hover:bg-neutral-700'}`}>
                      {h}H
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative h-72">
                {chartData.xray.datasets[0].data.length > 0 
                  ? <DataChart data={chartData.xray} options={xrayChartOptions} plugins={[xrayAnnotationsPlugin]} /> 
                  : <p className="text-center text-neutral-400 pt-10">No X-Ray data available for this time range.</p>}
              </div>
            </div>
            <ActiveRegionsList flares={flareData} />
            <div className="bg-neutral-900/80 p-4 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                 <h3 className="text-lg font-semibold text-neutral-200">GOES Proton Flux (NZT)</h3>
              </div>
              <div className="relative h-72">
                {chartData.proton.datasets[0].data.length > 0 
                  ? <DataChart data={chartData.proton} options={protonChartOptions} /> 
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