// --- START OF FILE src/components/ImpactGraphModal.tsx ---

import React from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import 'chartjs-adapter-date-fns';
import CloseIcon from './icons/CloseIcon';

interface ImpactDataPoint {
  time: number;
  speed: number;
  density: number;
}

interface ImpactGraphModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: ImpactDataPoint[];
}

const chartOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: {
    mode: 'index',
    intersect: false,
  },
  scales: {
    x: {
      type: 'time',
      time: {
        tooltipFormat: 'MMM d, yyyy HH:mm',
        unit: 'day',
      },
      ticks: {
        color: '#a3a3a3',
      },
      grid: {
        color: '#3f3f46',
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: '#a3a3a3',
      },
      grid: {
        color: '#3f3f46',
      },
    },
  },
  plugins: {
    legend: {
      display: false,
    },
  },
};

const ImpactGraphModal: React.FC<ImpactGraphModalProps> = ({ isOpen, onClose, data }) => {
  if (!isOpen) {
    return null;
  }

  const chartDataSpeed = {
    labels: data.map(d => d.time),
    datasets: [{
      label: 'Solar Wind Speed',
      data: data.map(d => d.speed),
      borderColor: 'rgb(56, 189, 248)',
      backgroundColor: 'rgba(56, 189, 248, 0.2)',
      fill: 'origin',
      pointRadius: 0,
      tension: 0.2,
    }],
  };
  
  const chartDataDensity = {
    labels: data.map(d => d.time),
    datasets: [{
      label: 'Relative Density',
      data: data.map(d => d.density),
      borderColor: 'rgb(250, 204, 21)',
      backgroundColor: 'rgba(250, 204, 21, 0.2)',
      fill: 'origin',
      pointRadius: 0,
      tension: 0.2,
    }],
  };

  const speedOptions: ChartOptions<'line'> = { ...chartOptions, scales: { ...chartOptions.scales, y: { ...chartOptions.scales?.y, title: { display: true, text: 'Speed (km/s)' } } } };
  const densityOptions: ChartOptions<'line'> = { ...chartOptions, scales: { ...chartOptions.scales, y: { ...chartOptions.scales?.y, title: { display: true, text: 'Relative Density' } } } };

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[3000] flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div 
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-4xl h-[70vh] max-h-[700px] text-neutral-300 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h2 className="text-xl font-bold text-neutral-200">Simulated Earth Impact Forecast</h2>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="overflow-y-auto p-4 styled-scrollbar pr-2 flex-grow space-y-6">
            <p className="text-sm text-neutral-400 text-center italic">This graph shows the calculated solar wind speed and density at Earth's position based on the CMEs in the 3D simulation. It is a visual guide and not an official forecast.</p>
            <div className="h-64">
                <Line options={speedOptions} data={chartDataSpeed} />
            </div>
             <div className="h-64">
                <Line options={densityOptions} data={chartDataDensity} />
            </div>
        </div>
      </div>
    </div>
  );
};

export default ImpactGraphModal;
// --- END OF FILE src/components/ImpactGraphModal.tsx ---