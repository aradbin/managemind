import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// The admin, served by the API Worker as static assets at the root of the
// admin host (phase-1-plan §3.5, §7.3). Navigation and assets never invoke
// the Worker; /api/*, /v1/*, /health and /openapi.json go to it first.
export default defineConfig({
  base: '/',
  plugins: [
    // File-based routes in src/routes; each route's code is its own chunk.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      // A new version waits for the user to reload (the update prompt).
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'managemind admin',
        short_name: 'managemind',
        lang: 'bn',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0e7a5a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // The app shell only: API responses are never cached.
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        // Inter's Greek, Cyrillic and Vietnamese files load only if needed.
        globIgnores: ['**/inter-{cyrillic,greek,vietnamese}*'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/v1\//, /^\/health/, /^\/openapi\.json/],
        runtimeCaching: [],
        // Staff alerts (phase-5a-plan §3.9): push and notification clicks.
        importScripts: ['/push-sw.js'],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    manifest: true,
    emptyOutDir: true,
    // Source maps only for production deploys, which upload them to Sentry
    // and delete them before deploying; they are never served.
    sourcemap: process.env.SENTRY_SOURCEMAPS ? 'hidden' : false,
  },
});
