import type { ImportMessage, OutboxEvent } from '@managemind/core';
import { sentryOptions } from '@managemind/shared/sentry';
import { withSentry } from '@sentry/cloudflare';
import { createApp } from './app';
import { pollCouriers } from './couriers';
import { type DelayedMessage, handleDelayedQueue } from './domains';
import type { Env } from './env';
import { liveMessages } from './gone-stores';
import { handleImportDeadLetters, handleImportQueue, handleQueue, runDailyJobs } from './jobs';
import { handlePurgeQueue, type PurgeMessage } from './purge/consumer';

// Durable Object classes must be exported from the Worker's entry point.
export { OtpCodes } from './otp/durable-object';
export { PurgeBudget } from './purge/durable-object';
export { RateLimiter } from './rate-limit/durable-object';

const app = createApp();

// Sentry reports what escapes the handlers (queue and cron failures); the
// API's own 5xx problems are reported in errors.ts.
type Message = OutboxEvent | ImportMessage | PurgeMessage | DelayedMessage;

/**
 * One queue handler for every queue: imports (managemind-imports, or a
 * preview's managemind-imports-pr-<n>), their dead letters, cache purges,
 * the delayed queue (domain re-checks and sale edges) and the outbox.
 */
async function routeQueue(batch: MessageBatch<Message>, env: Env, ctx: ExecutionContext) {
  if (batch.queue === 'managemind-purge') {
    const live = await liveMessages(batch as MessageBatch<PurgeMessage>, env, ctx, 'cache');
    return handlePurgeQueue(live, env);
  }
  if (batch.queue === 'managemind-domains') {
    const live = await liveMessages(batch as MessageBatch<DelayedMessage>, env, ctx, 'delayed');
    return handleDelayedQueue(live, env, ctx);
  }
  if (batch.queue.startsWith('managemind-imports')) {
    const imports = batch as MessageBatch<ImportMessage>;
    // Dead letters still fail their import job, whatever the store's state.
    if (batch.queue.endsWith('-dlq')) return handleImportDeadLetters(imports, env, ctx);
    return handleImportQueue(await liveMessages(imports, env, ctx, 'imports'), env, ctx);
  }
  const outbox = batch as MessageBatch<OutboxEvent>;
  return handleQueue(await liveMessages(outbox, env, ctx, 'outbox'), env, ctx);
}

/** Must match wrangler.jsonc's triggers; anything else is the daily batch. */
const COURIER_POLL_CRONS = new Set(['17 7 * * *', '17 13 * * *']);

export default withSentry<Env, Message>((env) => sentryOptions(env), {
  fetch: app.fetch,
  queue: routeQueue,
  // The daily batch, and the courier polls at 13:17 and 19:17 in Dhaka (phase-7-plan §7).
  scheduled: (controller, env, ctx) => {
    if (COURIER_POLL_CRONS.has(controller.cron)) ctx.waitUntil(pollCouriers(env, ctx));
    else ctx.waitUntil(runDailyJobs(env, ctx));
  },
} satisfies ExportedHandler<Env, Message>);
