import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Static SPA build (RF-18 .. RF-24).
 *
 * The bundle is served by nginx from `dist/`. Every route is a client-side
 * route, so `index.html` is the single entry point; the nginx configuration
 * in the image falls back to it for unknown paths (deep links such as
 * `/auth/callback` and `/appointments/:id`).
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});
