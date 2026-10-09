// Spike: edge state on the Workers Free plan (phase-0-plan §3.5, ADR 0006).
// Throwaway code. Checks the rate-limiting binding, a SQLite Durable Object
// counter (the fallback), Queues with delayed messages, retries and a
// dead-letter queue, and a Cron Trigger.
import { DurableObject } from 'cloudflare:workers';

interface Env {
  RL: RateLimit;
  COUNTER: DurableObjectNamespace<Counter>;
  Q: Queue<Msg>;
  SPIKE_TOKEN: string;
}
interface Msg {
  id: string;
  sentAt: number;
  delay: number;
  fail: boolean;
}

// Fixed-window counter: the fallback if the rate-limiting binding is not
// available or not precise enough.
export class Counter extends DurableObject {
  async hit(windowSeconds: number, limit: number) {
    const now = Date.now();
    const windowStart = now - (now % (windowSeconds * 1000));
    this.ctx.storage.sql.exec(
      'create table if not exists hits (window integer primary key, count integer not null)',
    );
    this.ctx.storage.sql.exec(
      'insert into hits (window, count) values (?, 1) on conflict (window) do update set count = count + 1',
      windowStart,
    );
    const row = this.ctx.storage.sql
      .exec<{ count: number }>('select count from hits where window = ?', windowStart)
      .one();
    this.ctx.storage.sql.exec('delete from hits where window < ?', windowStart);
    return { count: row.count, allowed: row.count <= limit };
  }
}

const log = (o: Record<string, unknown>) => console.log(JSON.stringify({ spike: 'edge', ...o }));

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.searchParams.get('k') !== env.SPIKE_TOKEN)
      return new Response('not found', { status: 404 });
    const key = url.searchParams.get('key') ?? 'default';

    if (url.pathname === '/rl') {
      const { success } = await env.RL.limit({ key });
      return Response.json({ key, success });
    }
    if (url.pathname === '/do') {
      const stub = env.COUNTER.get(env.COUNTER.idFromName(key));
      return Response.json({ key, ...(await stub.hit(60, 5)) });
    }
    if (url.pathname === '/q') {
      const delay = Number(url.searchParams.get('delay') ?? 0);
      const fail = url.searchParams.get('fail') === '1';
      const msg: Msg = { id: crypto.randomUUID(), sentAt: Date.now(), delay, fail };
      await env.Q.send(msg, delay > 0 ? { delaySeconds: delay } : undefined);
      log({ event: 'sent', ...msg });
      return Response.json(msg);
    }
    return new Response('not found', { status: 404 });
  },

  async queue(batch, _env): Promise<void> {
    for (const m of batch.messages) {
      const body = m.body as Msg;
      const lagSeconds = Math.round((Date.now() - body.sentAt) / 1000);
      if (batch.queue.endsWith('-dlq')) {
        log({ event: 'dead-lettered', id: body.id, attempts: m.attempts, lagSeconds });
        m.ack();
        continue;
      }
      log({ event: 'received', id: body.id, delay: body.delay, lagSeconds, attempts: m.attempts });
      if (body.fail) m.retry({ delaySeconds: 5 });
      else m.ack();
    }
  },

  async scheduled(controller): Promise<void> {
    log({
      event: 'cron',
      cron: controller.cron,
      at: new Date(controller.scheduledTime).toISOString(),
    });
  },
} satisfies ExportedHandler<Env, Msg>;
