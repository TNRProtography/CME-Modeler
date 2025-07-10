import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// Define THREE and gsap on window for TypeScript if not using modules for them
declare global {
  interface Window {
    THREE: any;
    gsap: any;
  }
}
// Ensure API_KEY is available in the environment, e.g., through a .env file and bundler setup
// For this example, we'll hardcode it as a placeholder if not found, with a warning.
// In a real build process, process.env.REACT_APP_NASA_API_KEY would be replaced.
if (!process.env.REACT_APP_NASA_API_KEY) {
  console.warn("NASA API Key not found in process.env.REACT_APP_NASA_API_KEY. Using placeholder. Please set your API key.");
  // @ts-ignore
  process.env.REACT_APP_NASA_API_KEY = "DEMO_KEY"; // Or your actual key for development
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