import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // This is the main landing page (Forecast Dashboard)
        main: resolve(__dirname, 'index.html'),

        // This is the secondary page (CME Modeler)
        cme: resolve(__dirname, 'cme.html'),
      },
    },
  },
})