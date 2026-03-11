import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles.css';

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