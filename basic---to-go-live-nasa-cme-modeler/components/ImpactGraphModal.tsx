// --- START OF FILE src/components/ImpactGraphModal.tsx ---

import React, { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { ChartOptions } from 'chart.js';
import { ImpactDataPoint } from '../types';
// chartSetup registers ALL required Chart.js components including TimeScale + adapter.
// Must be imported before any chart renders, or "time is not a registered scale" is thrown.
import '../utils/chartSetup';
import CloseIcon from './icons/CloseIcon';

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

  const disturbanceMarkers = useMemo(() => {
    const markers: { time: number; label: string }[] = [];
    let lastLabel: string | null = null;

    data.forEach((point) => {
      if (!point.disturbanceType) {
        lastLabel = null;
        return;
      }
      const label = point.disturbanceType === 'CME'
        ? `CME: ${point.disturbanceName ?? 'Unknown'}`
        : 'Coronal Hole';

      if (label !== lastLabel) {
        markers.push({ time: point.time, label });
      }
      lastLabel = label;
    });

    return markers.slice(0, 8);
  }, [data]);

  const disturbanceAnnotations = useMemo(() => {
    const annotations: Record<string, any> = {};
    disturbanceMarkers.forEach((marker, index) => {
      annotations[`disturbance-${index}`] = {
        type: 'line',
        xMin: marker.time,
        xMax: marker.time,
        borderColor: 'rgba(255, 255, 255, 0.35)',
        borderWidth: 1,
        borderDash: [4, 4],
        label: {
          display: true,
          content: marker.label,
          color: '#e5e7eb',
          backgroundColor: 'rgba(10,10,10,0.78)',
          borderColor: 'rgba(163,163,163,0.35)',
          borderWidth: 1,
          position: 'start',
          yAdjust: 10 + (index % 2) * 18,
          font: { size: 10, weight: '600' },
          padding: 4,
        },
      };
    });
    return annotations;
  }, [disturbanceMarkers]);

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

  // ── Bz forecast chart (from propagation engine) ──────────────────────
  const hasBzData = data.some(d => d.bz !== undefined && d.bz !== 0);
  const chartDataBz = {
    labels: data.map(d => d.time),
    datasets: [{
      label: 'Bz (nT)',
      data: data.map(d => d.bz ?? 0),
      borderColor: (ctx: any) => {
        const val = ctx.raw as number;
        if (val === undefined || val === null) return 'rgba(150,150,150,0.5)';
        return val < -5 ? 'rgb(239, 68, 68)' : val < 0 ? 'rgb(251, 146, 60)' : 'rgb(96, 165, 250)';
      },
      segment: {
        borderColor: (ctx: any) => {
          const yVal = ctx.p1.parsed.y;
          return yVal < -5 ? 'rgb(239, 68, 68)' : yVal < 0 ? 'rgb(251, 146, 60)' : 'rgb(96, 165, 250)';
        },
      },
      backgroundColor: 'rgba(96, 165, 250, 0.1)',
      fill: 'origin',
      pointRadius: 0,
      tension: 0.2,
    }],
  };

  // ── Interaction labels for the Bz chart ────────────────────────────
  const interactionAnnotations = useMemo(() => {
    const annotations: Record<string, any> = {};
    let lastFlag: string | null = null;
    let flagIndex = 0;
    data.forEach((point) => {
      const flag = point.interactionFlag;
      if (flag && flag !== 'none' && flag !== lastFlag) {
        const label = flag === 'cannibalism' ? 'CME–CME merger'
          : flag === 'preconditioning' ? 'Preconditioned'
          : flag === 'compression' ? 'Compressed'
          : flag;
        annotations[`interact-${flagIndex}`] = {
          type: 'line',
          xMin: point.time,
          xMax: point.time,
          borderColor: flag === 'cannibalism' ? 'rgba(239, 68, 68, 0.6)' : 'rgba(250, 204, 21, 0.5)',
          borderWidth: 1.5,
          borderDash: [3, 3],
          label: {
            display: true,
            content: label,
            color: '#fbbf24',
            backgroundColor: 'rgba(10,10,10,0.85)',
            borderColor: 'rgba(163,163,163,0.35)',
            borderWidth: 1,
            position: 'start',
            yAdjust: 10 + (flagIndex % 2) * 16,
            font: { size: 9, weight: '600' },
            padding: 3,
          },
        };
        flagIndex++;
      }
      lastFlag = flag ?? null;
    });
    return annotations;
  }, [data]);

  const speedOptions: ChartOptions<'line'> = { ...chartOptions, scales: { ...chartOptions.scales, y: { ...chartOptions.scales?.y, title: { display: true, text: 'Speed (km/s)' } } }, plugins: { ...chartOptions.plugins, annotation: { annotations: disturbanceAnnotations } as any } };
  const densityOptions: ChartOptions<'line'> = { ...chartOptions, scales: { ...chartOptions.scales, y: { ...chartOptions.scales?.y, title: { display: true, text: 'Relative Density (cm⁻³)' } } } };
  const bzOptions: ChartOptions<'line'> = { ...chartOptions, scales: { ...chartOptions.scales, y: { ...chartOptions.scales?.y, title: { display: true, text: 'Bz (nT)' }, grid: { ...((chartOptions.scales?.y as any)?.grid ?? {}), color: (ctx: any) => ctx.tick.value === 0 ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.05)' } } }, plugins: { ...chartOptions.plugins, annotation: { annotations: interactionAnnotations } as any } };

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md z-[3000] flex justify-center items-center p-4"
      onClick={onClose}
    >
      <div 
        className="relative bg-neutral-950/95 border border-neutral-800/90 rounded-lg shadow-2xl w-full max-w-4xl h-[85vh] max-h-[850px] text-neutral-300 flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-neutral-700/80">
          <h2 className="text-xl font-bold text-neutral-200">Simulated Earth Impact Forecast</h2>
          <button onClick={onClose} className="p-1 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors">
            <CloseIcon className="w-6 h-6" />
          </button>
        </div>
        
        <div className="overflow-y-auto p-4 styled-scrollbar pr-2 flex-grow space-y-6">
            <p className="text-sm text-neutral-400 text-center italic">Drag-based model (Vršnak et al. 2013) with CME–CME and CME–HSS interactions. Bz estimated from Bothmer-Schwenn chirality rules. This is a visual guide, not an official forecast.</p>
            {disturbanceMarkers.length > 0 && (
              <div className="text-xs text-neutral-400 text-center">
                Disturbances: {disturbanceMarkers.map((m) => m.label).join(' · ')}
              </div>
            )}
            <div className="h-52">
                <Line options={speedOptions} data={chartDataSpeed} />
            </div>
            <div className="h-52">
                <Line options={densityOptions} data={chartDataDensity} />
            </div>
            {hasBzData && (
              <>
                <div className="text-xs text-neutral-400 text-center mt-2">
                  <span className="text-red-400">Red</span> = southward Bz (storm risk) · <span className="text-blue-400">Blue</span> = northward (quiet)
                </div>
                <div className="h-52">
                    <Line options={bzOptions} data={chartDataBz} />
                </div>
              </>
            )}
        </div>
      </div>
    </div>
  );
};

export default ImpactGraphModal;
// --- END OF FILE src/components/ImpactGraphModal.tsx ---