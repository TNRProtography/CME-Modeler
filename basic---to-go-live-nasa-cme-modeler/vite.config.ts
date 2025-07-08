import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        // This defines the main app entry point
        main: resolve(__dirname, 'index.html'),
        // This tells Vite to also build forecast.html as a separate page
        forecast: resolve(__dirname, 'forecast.html'),
      },
    },
  },
})