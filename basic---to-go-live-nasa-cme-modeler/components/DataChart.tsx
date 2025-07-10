import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale, // Import TimeScale
} from 'chart.js';
import 'chartjs-adapter-date-fns'; // Import the date adapter

// Register all necessary components, including the TimeScale
ChartJS.register(
  CategoryScale,
  LinearScale,
  LogarithmicScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeScale
);

interface DataChartProps {
  data: any;
  options: any;
  plugins?: any[];
}

const DataChart: React.FC<DataChartProps> = ({ data, options, plugins = [] }) => {
  return <Line data={data} options={options} plugins={plugins} />;
};

export default DataChart;