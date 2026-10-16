import type { ImportMessage, OutboxEvent } from '@managemind/core';
import { sentryOptions } from '@managemind/shared/sentry';
import { withSentry } from '@sentry/cloudflare';
import { createApp } from './app';
import type { Env } from './env';
import { handleImportDeadLetters, handleImportQueue, handleQueue, runDailyJobs } from './jobs';

// Durable Object classes must be exported from the Worker's entry point.
export { RateLimiter } from './rate-limit/durable-object';

const app = createApp();

// Sentry reports what escapes the handlers (queue and cron failures); the
// API's own 5xx problems are reported in errors.ts.
type Message = OutboxEvent | ImportMessage;

/**
 * One queue handler for every queue: imports (managemind-imports, or a
 * preview's managemind-imports-pr-<n>), their dead letters, and the outbox.
 */
function routeQueue(batch: MessageBatch<Message>, env: Env, ctx: ExecutionContext) {
  if (batch.queue.startsWith('managemind-imports')) {
    const imports = batch as MessageBatch<ImportMessage>;
    return batch.queue.endsWith('-dlq')
      ? handleImportDeadLetters(imports, env, ctx)
      : handleImportQueue(imports, env, ctx);
  }
  return handleQueue(batch as MessageBatch<OutboxEvent>, env, ctx);
}

export default withSentry<Env, Message>((env) => sentryOptions(env), {
  fetch: app.fetch,
  queue: routeQueue,
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(runDailyJobs(env, ctx));
  },
} satisfies ExportedHandler<Env, Message>);
