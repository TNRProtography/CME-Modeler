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
  resolve: { alias: { '@app': APP_SRC } },
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
        notfound: resolve(__dirname, '404.html')
      }
    }
  }
});
