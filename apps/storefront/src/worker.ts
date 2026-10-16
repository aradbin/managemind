// The storefront Worker's entry (phase-3-plan §3.1). The page cache comes
// first: a hit is answered here, before Sentry, Astro, the KV host map or the
// API, for about a millisecond of CPU. Misses go to Astro's handler wrapped
// with Sentry (phase-0-plan §9); Astro turns errors in pages into a 500 page
// before they reach this wrapper, so middleware.ts reports those itself.
import handler from '@astrojs/cloudflare/entrypoints/server';
import { sentryOptions } from '@managemind/shared/sentry';
import { withSentry } from '@sentry/cloudflare';
import { serveWithCache } from './lib/cache';

const app = withSentry((env: Cloudflare.Env) => sentryOptions(env), handler);

export default {
  async fetch(request, env, ctx) {
    return serveWithCache(request, {
      // Previews and local development never cache (ADR 0007 decision 7).
      enabled: env.ENVIRONMENT === 'production',
      cache: (caches as unknown as { default: Cache }).default,
      waitUntil: (p) => ctx.waitUntil(p),
      render: async (r) =>
        (app.fetch as ExportedHandlerFetchHandler<Cloudflare.Env>)(
          r as Parameters<ExportedHandlerFetchHandler<Cloudflare.Env>>[0],
          env,
          ctx,
        ),
    });
  },
} satisfies ExportedHandler<Cloudflare.Env>;
