// One short-lived connection per request or job, through Hyperdrive (which
// pools the real connections next to Neon). Closed after the response.
import type { EventSink, OutboxEvent } from '@managemind/core';
import pg from 'pg';
import type { Env } from './env';

export async function withClient<T>(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: env.HYPERDRIVE.connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    ctx.waitUntil(client.end());
  }
}

/** Cloudflare Queues as the outbox sink; sendBatch takes at most 100 messages. */
export function queueSink(queue: Queue<OutboxEvent>): EventSink {
  return {
    async send(events) {
      for (let i = 0; i < events.length; i += 100) {
        await queue.sendBatch(
          events.slice(i, i + 100).map((body) => ({ body, contentType: 'json' })),
        );
      }
    },
  };
}
