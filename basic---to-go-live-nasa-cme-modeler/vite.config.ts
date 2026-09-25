import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { OutputBundle, OutputChunk } from 'rollup'

/**
 * Starts downloading the landing page's code while the app's own entry is
 * still downloading.
 *
 * Each page is its own lazy chunk, so without this the browser only learns
 * it needs the forecast page's code after the entry has downloaded and run -
 * on a phone, half a second of doing nothing. This writes the files each page
 * needs into index.html, and a few lines there preload the ones for the page
 * being opened (window.__stLandingPage, set by the script that starts the
 * forecast feeds early).
 */
function landingPagePreload(): Plugin {
  const PAGES: Record<string, string[]> = {
    forecast: ['components/ForecastDashboard.tsx'],
    'solar-activity': ['components/SolarActivityDashboard.tsx'],
    modeler: ['components/SimulationCanvas.tsx', 'components/ControlsPanel.tsx', 'components/CMEListPanel.tsx', 'components/TimelineControls.tsx'],
    dashboard: ['components/UnifiedDashboardMode.tsx'],
  };
  return {
    name: 'landing-page-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle as OutputBundle | undefined;
        if (!bundle) return html;
        const chunks = Object.values(bundle).filter((c): c is OutputChunk => c.type === 'chunk');
        const walk = (file: string, into: Set<string>) => {
          if (into.has(file)) return;
          into.add(file);
          const c = bundle[file];
          if (c && c.type === 'chunk') c.imports.forEach((f) => walk(f, into));
        };
        // Everything the entry already loads is in the page anyway.
        const inEntry = new Set<string>();
        chunks.filter((c) => c.isEntry).forEach((c) => walk(c.fileName, inEntry));
        const files: Record<string, { js: string[]; css: string[] }> = {};
        for (const [page, modules] of Object.entries(PAGES)) {
          const js = new Set<string>();
          for (const m of modules) {
            const chunk = chunks.find((c) => c.facadeModuleId?.replace(/\\/g, '/').endsWith(m));
            if (chunk) walk(chunk.fileName, js);
          }
          const need = [...js].filter((f) => !inEntry.has(f));
          const css = new Set<string>();
          for (const f of need) {
            const c = bundle[f] as OutputChunk & { viteMetadata?: { importedCss?: Set<string> } };
            c.viteMetadata?.importedCss?.forEach((x) => css.add(x));
          }
          files[page] = { js: need, css: [...css] };
        }
        const script = `<script>(function(){try{var m=${JSON.stringify(files)};var f=m[window.__stLandingPage||'forecast'];if(!f)return;` +
          `f.js.forEach(function(x){var l=document.createElement('link');l.rel='modulepreload';l.href='/'+x;document.head.appendChild(l);});` +
          `f.css.forEach(function(x){var l=document.createElement('link');l.rel='preload';l.as='style';l.href='/'+x;document.head.appendChild(l);});` +
          `}catch(e){}})();</script>`;
        return html.replace('</head>', `  ${script}\n</head>`);
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), landingPagePreload()],
  build: {
    // Raise the chunk size warning threshold - we split intentionally
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Chart.js and related - only needed by forecast + solar activity pages
          if (
            id.includes('chart.js') ||
            id.includes('react-chartjs-2') ||
            id.includes('chartjs-plugin-annotation') ||
            id.includes('chartjs-adapter-date-fns') ||
            id.includes('date-fns')
          ) {
            return 'charts';
          }

          // Three.js - only needed by CME modeler (lazy-loaded at runtime)
          if (id.includes('three') || id.includes('gsap')) {
            return 'three';
          }

          // React core - keep stable for long-term caching
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/')
          ) {
            return 'react-vendor';
          }

          // Leaflet - only needed by the aurora sightings map
          if (id.includes('leaflet')) {
            return 'leaflet';
          }
        },
      },
    },
  },
})