// One short-lived connection per request or job, through Hyperdrive (which
// pools the real connections next to Neon). Closed after the response.
// Previews without the binding connect straight to their Neon branch's
// pooler (ADR 0011, amended Oct 23).
import type { EventSink, OutboxEvent } from '@managemind/core';
import pg from 'pg';
import type { Env } from './env';

export async function withClient<T>(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: connectionString(env) });
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

/** Hyperdrive when it's bound, else a preview's direct URL. */
export function connectionString(env: Pick<Env, 'HYPERDRIVE' | 'DATABASE_URL'>): string {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) throw new Error('no database: bind HYPERDRIVE or set DATABASE_URL');
  return url;
}
