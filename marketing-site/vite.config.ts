import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// The marketing site imports the real components from the app source next door,
// so there is one implementation of the CME scene, the coronal hole detector and
// the magnetotail, not a copy. APP_SRC points at it.
const APP_SRC = resolve(__dirname, '../basic---to-go-live-nasa-cme-modeler');

export default defineConfig({
  root: __dirname,
  // Everything in public/ is copied to dist verbatim: sky.js, robots.txt,
  // sitemap.xml, _headers and the screenshots.
  publicDir: resolve(__dirname, 'public'),
  plugins: [react()],
  resolve: {
    alias: { '@app': APP_SRC },
    // Packages imported by app files are resolved from THIS site's
    // node_modules. The deploy installs only the marketing site's packages,
    // so a bare import from a file in the app folder would otherwise look for
    // the app's node_modules, which is not there. Every package the embedded
    // app code imports has to be listed here and in package.json.
    dedupe: [
      'react', 'react-dom',
      'chart.js', 'chartjs-adapter-date-fns', 'chartjs-plugin-annotation', 'date-fns', 'react-chartjs-2',
    ],
  },
  server: { fs: { allow: [__dirname, APP_SRC] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        features: resolve(__dirname, 'features.html'),
        how: resolve(__dirname, 'how-it-works.html'),
        data: resolve(__dirname, 'data.html'),
        faq: resolve(__dirname, 'faq.html'),
        about: resolve(__dirname, 'about.html'),
        changelog: resolve(__dirname, 'changelog.html'),
        notfound: resolve(__dirname, '404.html')
      }
    }
  }
});
