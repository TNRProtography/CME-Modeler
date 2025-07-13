// src/index.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// --- CRITICAL FIX: GLOBAL CHART.JS REGISTRATION ---
import { Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, TimeScale } from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation'; // IMPORT ANNOTATION PLUGIN

// Register all Chart.js components and scales
ChartJS.register(
  CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, TimeScale,
  annotationPlugin // REGISTER ANNOTATION PLUGIN
);
// --- END CRITICAL FIX ---


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
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(registration => {
      console.log('SW registered with scope: ', registration.scope);
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}