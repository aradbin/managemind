// Queue messages for stores that are gone (phase-5b-plan §3.11, point 4).
// Cloudflare Queues can't delete one store's messages, so each consumer
// asks first: a purged store's messages are acknowledged and dropped, and a
// closed store keeps only what closing itself needs (its lifecycle, domain
// and billing events, cache purges, and checks on money already paid).
import type { OutboxEvent } from '@managemind/core';
import { withClient } from './db';
import type { Env } from './env';
import { log } from './log';

export type QueueKind = 'outbox' | 'imports' | 'cache' | 'delayed';

/** Outbox events a closed store still needs: closing, its export, its domains, our billing. */
const CLOSED_EVENTS = ['tenant.', 'tenant_domain.', 'invoice.', 'subscription.'];

function keptWhenClosed(kind: QueueKind, body: unknown): boolean {
  switch (kind) {
    case 'outbox':
      return CLOSED_EVENTS.some((p) => (body as OutboxEvent).eventType.startsWith(p));
    case 'cache':
      // Its pages must leave the cache so the storefront answers 410.
      return true;
    case 'delayed': {
      const k = (body as { kind?: string }).kind;
      return k === 'payment_check' || k === 'refund_check';
    }
    default:
      return false;
  }
}

/**
 * Acknowledges and drops the messages of purged (or unknown) stores, and of
 * closed ones except what they still need; returns the rest. One query per
 * batch, for the batch's stores.
 */
export async function liveMessages<T extends { tenantId: string }>(
  batch: MessageBatch<T>,
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  kind: QueueKind,
): Promise<MessageBatch<T>> {
  const ids = [...new Set(batch.messages.map((m) => m.body.tenantId).filter(Boolean))];
  if (!ids.length) return batch;
  const statuses = await withClient(env, ctx, async (client) => {
    const { rows } = await client.query<{ id: string; status: string }>(
      'select id, status from platform.tenants where id = any($1::uuid[])',
      [ids],
    );
    return new Map(rows.map((r) => [r.id, r.status]));
  });
  const kept: Message<T>[] = [];
  for (const m of batch.messages) {
    const status = statuses.get(m.body.tenantId);
    const keep =
      status === 'active' ||
      status === 'suspended' ||
      (status === 'closed' && keptWhenClosed(kind, m.body));
    if (keep) kept.push(m);
    else {
      log('info', 'message for a gone store dropped', {
        tenant_id: m.body.tenantId,
        queue: kind,
        status: status ?? 'unknown',
      });
      m.ack();
    }
  }
  return kept.length === batch.messages.length ? batch : { ...batch, messages: kept };
}
