// Background entry points: the queue consumer and the daily Cron batch.
import { type EventType, type OutboxEvent, relayEvents } from '@managemind/core';
import { captureMessage } from '@sentry/cloudflare';
import { queueSink, withClient } from './db';
import type { Env } from './env';
import { log } from './log';

/**
 * Outbox consumer. Phase 0 only logs and acknowledges; each module adds its
 * handlers (email, SMS, cache refresh), keyed by event id so redeliveries are
 * harmless (ADR 0010). Messages that keep failing go to the dead-letter queue.
 */
export async function handleQueue(batch: MessageBatch<OutboxEvent>): Promise<void> {
  for (const message of batch.messages) {
    log('info', 'event received', {
      event_id: message.body.id,
      event_type: message.body.eventType,
      tenant_id: message.body.tenantId,
      attempts: message.attempts,
    });
    message.ack();
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
