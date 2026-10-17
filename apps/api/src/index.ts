import type { ImportMessage, OutboxEvent } from '@managemind/core';
import { sentryOptions } from '@managemind/shared/sentry';
import { withSentry } from '@sentry/cloudflare';
import { createApp } from './app';
import { type DomainCheckMessage, handleDomainQueue } from './domains';
import type { Env } from './env';
import { handleImportDeadLetters, handleImportQueue, handleQueue, runDailyJobs } from './jobs';
import { handlePurgeQueue, type PurgeMessage } from './purge/consumer';

// Durable Object classes must be exported from the Worker's entry point.
export { PurgeBudget } from './purge/durable-object';
export { RateLimiter } from './rate-limit/durable-object';

const app = createApp();

// Sentry reports what escapes the handlers (queue and cron failures); the
// API's own 5xx problems are reported in errors.ts.
type Message = OutboxEvent | ImportMessage | PurgeMessage | DomainCheckMessage;

/**
 * One queue handler for every queue: imports (managemind-imports, or a
 * preview's managemind-imports-pr-<n>), their dead letters, cache purges and
 * the outbox.
 */
function routeQueue(batch: MessageBatch<Message>, env: Env, ctx: ExecutionContext) {
  if (batch.queue === 'managemind-purge') {
    return handlePurgeQueue(batch as MessageBatch<PurgeMessage>, env);
  }
  if (batch.queue === 'managemind-domains') {
    return handleDomainQueue(batch as MessageBatch<DomainCheckMessage>, env, ctx);
  }
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
