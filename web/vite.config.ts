import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Dev server proxies API calls to the Spring API (8080) so the SPA can use
// relative /graphql and /api paths (no CORS in dev). Mirrors promptlydo's setup.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/graphql': { target: 'http://localhost:8080', changeOrigin: true, ws: true },
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
