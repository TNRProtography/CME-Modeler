import React from 'react';
import { Line } from 'react-chartjs-2';
// IMPORTANT: Removed ChartJS imports and ChartJS.register call.
// These are now handled globally in index.tsx.

interface DataChartProps {
  data: any;
  options: any;
  plugins?: any[];
}

const DataChart: React.FC<DataChartProps> = ({ data, options, plugins = [] }) => {
  return <Line data={data} options={options} plugins={plugins} />;
};

export default DataChart;