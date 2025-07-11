// src/index.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// --- THIS IS THE CRITICAL FIX ---
// Import all necessary Chart.js components and the date adapter here
// for global registration at the application's entry point.
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

// Register all necessary components globally, before any React component uses them.
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
// --- END OF CRITICAL FIX ---

// Define THREE and gsap on window for TypeScript if not using modules for them
declare global {
  interface Window {
    THREE: any;
    gsap: any;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// --- Service Worker Registration with EXPLICIT SCOPE ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // We explicitly set the scope to '/' to ensure it controls the whole site.
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(registration => {
      console.log('SW registered with scope: ', registration.scope);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}