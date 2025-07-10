import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // --- NEW SECTION TO ADD ---
  server: {
    proxy: {
      // Proxy requests from /functions/ to the Cloudflare dev server
      '/functions': {
        target: 'http://localhost:8788', // Default wrangler port
        changeOrigin: true,
      },
    },
  },
})