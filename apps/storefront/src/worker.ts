// The storefront Worker's entry: Astro's handler wrapped with Sentry
// (phase-0-plan §9). Astro turns errors in pages into a 500 page before they
// reach this wrapper, so middleware.ts reports those itself.
import handler from '@astrojs/cloudflare/entrypoints/server';
import { sentryOptions } from '@managemind/shared/sentry';
import { withSentry } from '@sentry/cloudflare';

export default withSentry((env: Cloudflare.Env) => sentryOptions(env), handler);
