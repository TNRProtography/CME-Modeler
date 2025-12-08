import { useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { CMEMilestone } from '../types';

interface Props {
  milestones: CMEMilestone[];
}

export function PropagationChart({ milestones }: Props) {
  const data = useMemo(() => ({
    labels: milestones.map((m) => `${m.timeHours.toFixed(1)} h`),
    datasets: [
      {
        type: 'line' as const,
        label: 'Distance (AU)',
        data: milestones.map((m) => m.distanceAU),
        borderColor: 'rgba(255, 179, 71, 0.9)',
        backgroundColor: 'rgba(255, 179, 71, 0.2)',
        tension: 0.4,
        fill: true,
        yAxisID: 'y',
        pointRadius: 4,
      },
      {
        type: 'line' as const,
        label: 'Speed (km/s)',
        data: milestones.map((m) => m.speed),
        borderColor: 'rgba(128, 222, 255, 0.95)',
        backgroundColor: 'rgba(128, 222, 255, 0.15)',
        tension: 0.4,
        fill: true,
        yAxisID: 'y1',
        pointRadius: 4,
      },
    ],
  }), [milestones]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        labels: {
          color: '#e0e6ff',
          boxWidth: 14,
          font: {
            family: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          },
        },
      },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const label = context.dataset.label ?? '';
            const value = context.raw as number;
            if (context.datasetIndex === 0) {
              return `${label}: ${value.toFixed(2)} AU`;
            }
            return `${label}: ${Math.max(value, 0).toFixed(0)} km/s`;
          },
        },
      },
    },
    scales: {
      x: {
        ticks: { color: '#8aa0c2' },
        grid: { color: 'rgba(255,255,255,0.04)' },
      },
      y: {
        position: 'left' as const,
        ticks: { color: '#8aa0c2' },
        grid: { color: 'rgba(255,255,255,0.04)' },
        title: { display: true, text: 'Distance (AU)', color: '#8aa0c2' },
        min: 0,
        max: 1,
      },
      y1: {
        position: 'right' as const,
        ticks: { color: '#8aa0c2' },
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Speed (km/s)', color: '#8aa0c2' },
        min: 0,
      },
    },
  };

  return (
    <div className="panel tall">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Propagation lab</p>
          <h2>Distance & deceleration</h2>
        </div>
        <div className="legend-note">Dual-scale chart of heliocentric distance and plasma speed.</div>
      </div>
      <div className="chart-wrap">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}
