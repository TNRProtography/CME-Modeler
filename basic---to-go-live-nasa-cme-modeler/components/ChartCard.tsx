import React from 'react';
import DataChart from './DataChart';
import LoadingSpinner from './icons/LoadingSpinner';

interface ChartCardProps {
  title: string;
  // This config object contains everything Chart.js needs
  chartConfig: { data: any; options: any } | null;
  isLoading: boolean;
  children?: React.ReactNode; // For adding buttons, etc.
}

const ChartCard: React.FC<ChartCardProps> = ({ title, chartConfig, isLoading, children }) => {
  return (
    <div className="bg-neutral-900/80 p-4 rounded-lg">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-lg font-semibold text-neutral-200">{title}</h3>
        {children}
      </div>
      <div className="relative h-72">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : chartConfig && chartConfig.data.datasets.some((ds: any) => ds.data.length > 0) ? (
          <DataChart data={chartConfig.data} options={chartConfig.options} />
        ) : (
          <p className="text-center text-neutral-400 pt-10">
            No data available for this time range.
          </p>
        )}
      </div>
    </div>
  );
};

export default ChartCard;