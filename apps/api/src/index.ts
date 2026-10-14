import type { OutboxEvent } from '@managemind/core';
import { sentryOptions } from '@managemind/shared/sentry';
import { withSentry } from '@sentry/cloudflare';
import { createApp } from './app';
import type { Env } from './env';
import { handleQueue, runDailyJobs } from './jobs';

// Durable Object classes must be exported from the Worker's entry point.
export { RateLimiter } from './rate-limit/durable-object';

const app = createApp();

// Sentry reports what escapes the handlers (queue and cron failures); the
// API's own 5xx problems are reported in errors.ts.
export default withSentry<Env, OutboxEvent>((env) => sentryOptions(env), {
  fetch: app.fetch,
  queue: (batch, env, ctx) => handleQueue(batch, env, ctx),
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(runDailyJobs(env, ctx));
  },
} satisfies ExportedHandler<Env, OutboxEvent>);
