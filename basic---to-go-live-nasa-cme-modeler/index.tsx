// --- START OF FILE index.tsx ---

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, TimeScale } from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';
// DELETED: We will no longer call this function on load.
// import { requestNotificationPermission } from './utils/notifications.ts';

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
    <App />
  </React.StrictMode>
);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(registration => {
      console.log('SW registered with scope: ', registration.scope);
      // --- REMOVED THE AUTOMATIC PERMISSION REQUEST ---
      // The request will now be triggered by the user in the SettingsModal.
    }).catch(registrationError => {
      console.log('SW registration failed: ', registrationError);
    });
  });
}
// --- END OF FILE index.tsx ---