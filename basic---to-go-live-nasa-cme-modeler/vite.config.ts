// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    // React fast-refresh + automatic JSX runtime
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  esbuild: {
    // Force automatic JSX runtime so nothing calls a global `tsx()` factory
    jsx: 'automatic',
    // Defensive: clear any stray factories some deps might try to set
    jsxFactory: undefined,
    jsxFragment: undefined,
  },
});
