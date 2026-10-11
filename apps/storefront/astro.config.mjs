import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  // No KV sessions (1,000 writes a day on the free plan) and no Cloudflare
  // Images; photos are resized in the admin before upload (ADR 0006).
  session: false,
  adapter: cloudflare({ imageService: 'passthrough' }),
  // Source maps only for production deploys, which upload them to Sentry and
  // delete them before deploying (scripts/production/sourcemaps.ts).
  vite: { build: { sourcemap: process.env.SENTRY_SOURCEMAPS ? 'hidden' : false } },
});
