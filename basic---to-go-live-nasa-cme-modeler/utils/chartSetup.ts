// chartSetup.ts
// Centralised Chart.js registration.
// Import this file ONLY inside lazy-loaded components (ForecastDashboard, SolarActivityDashboard)
// so it never runs during the initial page load for users who land on the CME modeler page.

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
  TimeScale,
} from 'chart.js';
import 'chartjs-adapter-date-fns';
import annotationPlugin from 'chartjs-plugin-annotation';

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
  TimeScale,
  annotationPlugin
);

// --- Mobile scroll-tooltip fix ---
// By default Chart.js listens to ['mousemove','mouseout','click','touchstart','touchmove'],
// which makes tooltips pop up while the user is merely scrolling past a chart on mobile.
// Removing the touch events fixes that: a deliberate tap still works because the browser
// synthesizes a 'click' after a tap (but NOT after a scroll), and desktop hover via
// 'mousemove' is unaffected.
ChartJS.defaults.events = ['mousemove', 'mouseout', 'click'];

export { ChartJS };