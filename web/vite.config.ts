import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// During dev, forward Subsonic + our custom endpoints to a running
// subsonic-proxy so the web app talks to the real Navidrome/Antra pipeline
// without needing CORS. In production the frontend is served from the
// same FastAPI process, so calls are same-origin naturally.
//
// Override for your own deployment: `VITE_UPSTREAM=https://... npm run dev`
// or set it in a local `.env` file (which is gitignored).
const UPSTREAM = process.env.VITE_UPSTREAM ?? 'http://localhost:4544'

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/rest':    { target: UPSTREAM, changeOrigin: true, secure: true },
      '/api':     { target: UPSTREAM, changeOrigin: true, secure: true },
      '/healthz': { target: UPSTREAM, changeOrigin: true, secure: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
