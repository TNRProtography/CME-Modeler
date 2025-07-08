import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // 'main' now points to the new index.html (the forecast page).
        // This is served by default at the root URL.
        main: resolve(__dirname, 'index.html'),

        // 'cme' now points to the cme.html file (the React modeler app).
        // This will be accessible at /cme.html.
        cme: resolve(__dirname, 'cme.html'),
      },
    },
  },
})