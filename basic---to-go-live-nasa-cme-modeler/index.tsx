// src/index.tsx
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