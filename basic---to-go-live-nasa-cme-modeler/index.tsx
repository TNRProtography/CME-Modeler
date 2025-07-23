// --- START OF FILE src/index.tsx ---

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { Chart as ChartJS, CategoryScale, LinearScale, LogarithmicScale, PointElement, LineElement, Title, Tooltip, Legend, Filler, TimeScale } from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';
import { requestNotificationPermission } from './utils/notifications'; // Corrected import path

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

/**
 * This function contains the actual React application startup logic.
 * It will only be called after we confirm the necessary global libraries are loaded.
 */
const startApp = () => {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    console.error("Fatal Error: Root element with id 'root' not found in the DOM.");
    document.body.innerHTML = '<div style="color: red; padding: 20px;">Error: Could not find root element. App cannot start.</div>';
    return;
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );

  // Move Service Worker registration here to ensure it runs after the app starts rendering
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(registration => {
        console.log('SW registered with scope: ', registration.scope);
        // Request notification permission after SW is registered
        requestNotificationPermission().then(permission => {
          if (permission === 'granted') {
            console.log('Notification permission granted.');
          } else {
            console.warn('Notification permission denied or dismissed:', permission);
          }
        });
      }).catch(registrationError => {
        console.log('SW registration failed: ', registrationError);
      });
    });
  }
};

/**
 * This function repeatedly checks if THREE.js and GSAP are available on the window object.
 * Once they are, it calls startApp() to boot the React application.
 * This prevents the "Cannot access 'b' before initialization" error.
 */
const checkLibsAndBoot = () => {
  if (window.THREE && window.gsap) {
    console.log("SUCCESS: THREE.js and GSAP are loaded. Starting React application.");
    startApp();
  } else {
    console.warn("Waiting for external libraries (THREE.js, GSAP)...");
    // If libraries are not ready, check again in 100 milliseconds.
    setTimeout(checkLibsAndBoot, 100);
  }
};

// Start the checking process. The app will not render until this completes.
checkLibsAndBoot();
// --- END OF FILE src/index.tsx ---