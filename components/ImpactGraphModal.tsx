// --- START OF FILE src/components/ImpactGraphModal.tsx ---

import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import { ImpactDataPoint } from '../types';
import '../utils/chartSetup';
import CloseIcon from './icons/CloseIcon';

interface ImpactGraphModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: ImpactDataPoint[];
}

const axisStyle = {
  ticks: { color: '#a3a3a3' },
  grid:  { color: '#3f3f46' },
};

const baseOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { mode: 'index', intersect: false },
  animation: false,
  scales: {
    x: {
      type: 'time',
      time: { tooltipFormat: 'MMM d HH:mm', displayFormats: { hour: 'MMM d HH:mm', day: 'MMM d' } },
      ...axisStyle,
    },
    y: { beginAtZero: true, ...axisStyle },
  },
  plugins: { legend: { display: false } },
};

const ImpactGraphModal: React.FC<ImpactGraphModalProps> = ({ isOpen, onClose, data }) => {
  if (!isOpen) return null;

  // ── Disturbance onset markers ─────────────────────────────────────────
  const disturbanceAnnotations = useMemo(() => {
    const annotations: Record<string, any> = {};
    let lastLabel: string | null = null;
    let idx = 0;
    data.forEach(point => {
      if (!point.disturbanceType) { lastLabel = null; return; }
      const label = point.disturbanceType === 'CME'
        ? `CME: ${(point.disturbanceName ?? '').replace(/^.*?(\d{4}-\d{2}-\d{2}).*$/, '$1') || 'Unknown'}`
        : 'HSS';
      if (label === lastLabel) return;
      lastLabel = label;
      annotations[`d${idx}`] = {
        type: 'line',
        xMin: point.time, xMax: point.time,
        borderColor: 'rgba(255,255,255,0.3)',
        borderWidth: 1, borderDash: [4, 4],
        label: {
          display: true, content: label,
          color: '#e5e7eb', backgroundColor: 'rgba(10,10,10,0.80)',
          borderColor: 'rgba(163,163,163,0.3)', borderWidth: 1,
          position: 'start', yAdjust: 8 + (idx % 2) * 18,
          font: { size: 10, weight: '600' }, padding: 4,
        },
      };
      idx++;
    });
    // "Now" line
    annotations['now'] = {
      type: 'line',
      xMin: Date.now(), xMax: Date.now(),
      borderColor: 'rgba(250,204,21,0.7)',
      borderWidth: 1.5,
      label: {
        display: true, content: 'Now',
        color: '#fbbf24', backgroundColor: 'rgba(10,10,10,0.80)',
        position: 'end', yAdjust: -4,
        font: { size: 9, weight: '700' }, padding: 3,
      },
    };
    return annotations;
  }, [data]);

  const speedOptions: ChartOptions<'line'> = {
    ...baseOptions,
    scales: {
      ...baseOptions.scales,
      y: {
        ...baseOptions.scales?.y,
        title: { display: true, text: 'Speed (km/s)', color: '#a3a3a3' },
        suggestedMin: 250,
        suggestedMax: 900,
      },
    },
    plugins: {
      ...baseOptions.plugins,
      annotation: { annotations: disturbanceAnnotations } as any,
    },
  };

  const densityOptions: ChartOptions<'line'> = {
    ...baseOptions,
    scales: {
      ...baseOptions.scales,
      y: {
        ...baseOptions.scales?.y,
        title: { display: true, text: 'Density (cm⁻³)', color: '#a3a3a3' },
        suggestedMin: 0,
      },
    },
    plugins: {
      ...baseOptions.plugins,
      annotation: { annotations: { now: disturbanceAnnotations['now'] } } as any,
    },
  };

  const labels = data.map(d => d.time);

  const speedDataset = {
    label: 'Solar Wind Speed',
    data: data.map(d => d.speed),
    borderColor: 'rgb(56,189,248)',
    backgroundColor: 'rgba(56,189,248,0.15)',
    fill: 'origin', pointRadius: 0, tension: 0.25,
  };

  const densityDataset = {
    label: 'Density',
    data: data.map(d => d.density),
    borderColor: 'rgb(250,204,21)',
    backgroundColor: 'rgba(250,204,21,0.15)',
    fill: 'origin', pointRadius: 0, tension: 0.25,
  };

  const hasCME = data.some(d => d.disturbanceType === 'CME');
  const hasHSS = data.some(d => d.disturbanceType === 'Coronal Hole');

  return (
    <div
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[3000] flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-4xl h-[75vh] max-h-[720px] text-neutral-300 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80 flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-neutral-200">Simulated Earth Impact Forecast</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              Speed shown is predicted arrival speed at Earth · Density reflects concurrent CME compression
              {hasHSS && ' · HSS density peak leads speed rise (SIR)'}
            </p>
          </div>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>

        {/* Charts */}
        <div className="overflow-y-auto p-4 flex-grow space-y-6">
          {/* Disturbances summary */}


          <div>
            <div className="text-xs text-neutral-500 mb-1 font-medium uppercase tracking-wide">Solar Wind Speed</div>
            <div className="h-56">
              <Line options={speedOptions} data={{ labels, datasets: [speedDataset] }} />
            </div>
          </div>

          <div>
            <div className="text-xs text-neutral-500 mb-1 font-medium uppercase tracking-wide">Relative Plasma Density</div>
            <div className="h-56">
              <Line options={densityOptions} data={{ labels, datasets: [densityDataset] }} />
            </div>
          </div>

          <p className="text-xs text-neutral-600 text-center italic pb-2">
            Drag-based model (Vršnak et al. 2013). Visual guide only — not an official forecast.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ImpactGraphModal;
// --- END OF FILE src/components/ImpactGraphModal.tsx ---