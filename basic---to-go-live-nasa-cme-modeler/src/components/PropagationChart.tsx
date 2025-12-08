import { Line } from 'react-chartjs-2';
import { CMEMilestone } from '../types';

interface Props {
  milestones: CMEMilestone[];
}

export function PropagationChart({ milestones }: Props) {
  const data = {
    labels: milestones.map((m) => `${m.timeHours.toFixed(1)} h`),
    datasets: [
      {
        type: 'line' as const,
        label: 'Distance (AU)',
        data: milestones.map((m) => m.distanceAU),
        borderColor: 'rgba(102, 224, 255, 0.9)',
        backgroundColor: 'rgba(102, 224, 255, 0.2)',
        tension: 0.35,
        fill: true,
        yAxisID: 'y',
      },
      {
        type: 'line' as const,
        label: 'Speed (km/s)',
        data: milestones.map((m) => m.speed),
        borderColor: 'rgba(132, 240, 200, 0.9)',
        backgroundColor: 'rgba(132, 240, 200, 0.2)',
        tension: 0.35,
        fill: true,
        yAxisID: 'y1',
      },
    ],
  };

  const options = {
    responsive: true,
    interaction: { mode: 'index' as const, intersect: false },
    plugins: {
      legend: {
        labels: {
          color: '#e8f1ff',
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
        ticks: { color: '#99a9c2' },
        grid: { color: 'rgba(255,255,255,0.05)' },
      },
      y: {
        position: 'left' as const,
        ticks: { color: '#99a9c2' },
        grid: { color: 'rgba(255,255,255,0.05)' },
        title: { display: true, text: 'Distance (AU)', color: '#99a9c2' },
        min: 0,
        max: 1,
      },
      y1: {
        position: 'right' as const,
        ticks: { color: '#99a9c2' },
        grid: { drawOnChartArea: false },
        title: { display: true, text: 'Speed (km/s)', color: '#99a9c2' },
        min: 0,
      },
    },
  };

  return (
    <div className="panel">
      <h2>Propagation profile</h2>
      <Line data={data} options={options} />
    </div>
  );
}
