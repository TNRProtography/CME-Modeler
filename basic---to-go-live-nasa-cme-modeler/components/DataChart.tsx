import React from 'react';
import { Line } from 'react-chartjs-2';

interface DataChartProps {
  data: any;
  options: any;
  plugins?: any[];
}

const DataChart: React.FC<DataChartProps> = ({ data, options, plugins = [] }) => {
  return <Line data={data} options={options} plugins={plugins} />;
};

export default DataChart;