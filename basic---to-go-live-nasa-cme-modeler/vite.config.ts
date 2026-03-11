import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Raise the chunk size warning threshold — we split intentionally
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Chart.js and related — only needed by forecast + solar activity pages
          if (
            id.includes('chart.js') ||
            id.includes('react-chartjs-2') ||
            id.includes('chartjs-plugin-annotation') ||
            id.includes('chartjs-adapter-date-fns') ||
            id.includes('date-fns')
          ) {
            return 'charts';
          }

          // Three.js — only needed by CME modeler (lazy-loaded at runtime)
          if (id.includes('three') || id.includes('gsap')) {
            return 'three';
          }

          // React core — keep stable for long-term caching
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/')
          ) {
            return 'react-vendor';
          }

          // Leaflet — only needed by the aurora sightings map
          if (id.includes('leaflet')) {
            return 'leaflet';
          }
        },
      },
    },
  },
})