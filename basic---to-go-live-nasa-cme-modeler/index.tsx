import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initLogCapture } from './utils/logCapture';
import { reportNotificationClick } from './utils/notifications';
import { registerServiceWorker } from './utils/serviceWorker';
import { startSolarBoot } from './utils/solarBoot';
import './styles.css';

// Start capturing console output immediately so the debug panel
// has a full session history available from the first page load.
initLogCapture();

// If this load came from tapping a notification, report it before anything
// else touches the URL. Does nothing on an ordinary load.
reportNotificationClick();

// Opening on the solar page: start its core feeds now, while the page's code
// downloads and renders, rather than after (see utils/solarBoot). index.html
// has already started the forecast page's, and set which page this is.
if ((window as unknown as { __stLandingPage?: string }).__stLandingPage === 'solar-activity') startSolarBoot();

// Chart.js is NOT registered here - it is registered lazily inside ForecastDashboard
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

// Registers /sw.js and keeps it honest: checks for a new version on a timer
// and when the app returns to the foreground, pushes a waiting worker through
// rather than letting it strand, and reloads once - while the page is hidden -
// when a new version takes control.
registerServiceWorker();