// Background entry points: the queue consumer and the daily Cron batch.
import { type EventType, type OutboxEvent, relayEvents } from '@managemind/core';
import { captureMessage } from '@sentry/cloudflare';
import { queueSink, withClient } from './db';
import { type Env, getConfig } from './env';
import { syncTenantHosts, touchesHosts } from './kv-sync';
import { log } from './log';

/**
 * Outbox consumer (ADR 0010). Events that change a store's hosts update the
 * KV map; everything else is logged and acknowledged until its module adds a
 * handler. Handlers recompute state rather than apply deltas, so redeliveries
 * are harmless. Messages that keep failing go to the dead-letter queue.
 */
export async function handleQueue(
  batch: MessageBatch<OutboxEvent>,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  // One sync per store per batch, however many of its events arrived.
  const tenants = new Map<string, Message<OutboxEvent>[]>();
  for (const message of batch.messages) {
    log('info', 'event received', {
      event_id: message.body.id,
      event_type: message.body.eventType,
      tenant_id: message.body.tenantId,
      attempts: message.attempts,
    });
    if (env.EDGE && touchesHosts(message.body)) {
      const list = tenants.get(message.body.tenantId) ?? [];
      list.push(message);
      tenants.set(message.body.tenantId, list);
    } else {
      message.ack();
    }
  }
  const storeDomain = getConfig(env).STORE_DOMAIN;
  for (const [tenantId, messages] of tenants) {
    try {
      const result = await syncTenantHosts(
        env,
        env.EDGE as KVNamespace,
        ctx,
        tenantId,
        storeDomain,
      );
      log('info', 'kv hosts synced', { tenant_id: tenantId, ...result });
      for (const m of messages) m.ack();
    } catch (e) {
      log('error', 'kv host sync failed', { tenant_id: tenantId, error: String(e) });
      for (const m of messages) m.retry();
    }
  }
}

interface OutboxRow {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string | null;
  payload: unknown;
  request_id: string | null;
  created_at: Date;
}

const toEvent = (r: OutboxRow): OutboxEvent => ({
  id: r.id,
  tenantId: r.tenant_id,
  eventType: r.event_type as EventType,
  aggregateType: r.aggregate_type,
  aggregateId: r.aggregate_id,
  payload: r.payload,
  requestId: r.request_id,
  createdAt: new Date(r.created_at).toISOString(),
});

/**
 * The daily batch: relay outbox events the request path missed (older than
 * five minutes, across tenants), then delete expired technical rows.
 */
export async function runDailyJobs(
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  await withClient(env, ctx, async (client) => {
    await client.query('begin');
    try {
      // The claimed rows stay locked (SKIP LOCKED) until this commit.
      const { rows } = await client.query<OutboxRow>(
        "select * from app.outbox_claim(1000, interval '5 minutes')",
      );
      const result = await relayEvents(client, rows.map(toEvent), queueSink(env.OUTBOX));
      await client.query('commit');
      if (rows.length > 0) {
        const level = result.failed > 0 ? 'error' : 'warning';
        log(result.failed > 0 ? 'error' : 'warn', 'outbox sweep relayed leftovers', {
          claimed: rows.length,
          ...result,
        });
        // The request path should leave nothing behind (ADR 0010), so any
        // leftover is worth an alert.
        captureMessage('outbox sweep relayed leftovers', {
          level,
          extra: { claimed: rows.length, ...result },
        });
      }
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    }
    const cleanup = await client.query<{ name: string; deleted: string }>(
      'select * from app.cleanup_expired()',
    );
    log(
      'info',
      'daily cleanup',
      Object.fromEntries(cleanup.rows.map((r) => [r.name, Number(r.deleted)])),
    );
  });
}
