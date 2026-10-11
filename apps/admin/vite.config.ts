import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Built into dist/admin and served by the API Worker as static assets at
// /admin (free, no Worker invocation). Phase 1 moves it to the admin host.
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  build: {
    outDir: 'dist/admin',
    emptyOutDir: true,
    // Source maps only for production deploys, which upload them to Sentry
    // and delete them before deploying; they are never served.
    sourcemap: process.env.SENTRY_SOURCEMAPS ? 'hidden' : false,
  },
});
