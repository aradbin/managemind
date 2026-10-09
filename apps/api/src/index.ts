import type { OutboxEvent } from '@managemind/core';
import { createApp } from './app';
import type { Env } from './env';
import { handleQueue, runDailyJobs } from './jobs';

const app = createApp();

export default {
  fetch: app.fetch,
  queue: (batch) => handleQueue(batch),
  scheduled: (_controller, env, ctx) => {
    ctx.waitUntil(runDailyJobs(env, ctx));
  },
} satisfies ExportedHandler<Env, OutboxEvent>;
