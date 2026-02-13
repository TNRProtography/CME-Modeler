// --- START OF FILE index.tsx ---

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary'; // Import the new component
import { Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, TimeScale } from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';

ChartJS.register(
  CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, TimeScale,
  annotationPlugin
);

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
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  const host = window.location.hostname;
  const shouldRegisterServiceWorker = host === 'localhost' || host === '127.0.0.1' || host === 'spottheaurora.co.nz' || host === 'www.spottheaurora.co.nz';

  if (shouldRegisterServiceWorker) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Silently ignore SW registration issues on unsupported browser states.
      });
    });
  }
}
// --- END OF FILE index.tsx ---