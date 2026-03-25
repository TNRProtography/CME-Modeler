import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initLogCapture } from './utils/logCapture';
import './styles.css';

// Start capturing console output immediately so the debug panel
// has a full session history available from the first page load.
initLogCapture();

// Chart.js is NOT registered here — it is registered lazily inside ForecastDashboard
// and SolarActivityDashboard via chartSetup.ts, so it never loads on the CME modeler
// page or on initial boot before any charts are rendered.

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
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.log('[SW] Registered successfully. Scope:', reg.scope, 'State:', reg.active?.state ?? 'installing');
      })
      .catch((err) => {
        console.error('[SW] Registration failed:', err);
      });
  });
}