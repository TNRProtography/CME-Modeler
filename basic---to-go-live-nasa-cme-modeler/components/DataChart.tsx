import React, { useEffect, useRef } from 'react';

// Assuming Chart.js is loaded globally from index.html
declare const Chart: any;

interface DataChartProps {
  data: any;
  options: any;
}

const DataChart: React.FC<DataChartProps> = ({ data, options }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<any>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Destroy previous chart instance if it exists
    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: data,
      options: options,
    });

    // Cleanup on component unmount
    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [data, options]);

  return <canvas ref={canvasRef} />;
};

// --- THIS IS THE CRUCIAL FIX ---
export default DataChart;