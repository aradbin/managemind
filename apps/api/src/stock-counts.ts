// A large stock count's apply on the delayed-work queue (phase-8-plan §3.5,
// §7): one message applies 500 lines in its own transaction and sends the
// next until the count is applied. A message that keeps failing sends the
// count back to review with the error, for staff, and tells Sentry. Without
// the queue (previews, local development) the batches run one after another
// in the request.
import {
  applyStockCountBatch,
  failStockCountApply,
  relayEvents,
  systemActor,
  withTenant,
} from '@managemind/core';
import { captureMessage } from '@sentry/cloudflare';
import type pg from 'pg';
import { queueSink, withClient } from './db';
import type { Env } from './env';
import { log } from './log';

type Ctx = Pick<ExecutionContext, 'waitUntil'>;

export interface StockCountMessage {
  kind: 'stock_count_apply';
  tenantId: string;
  countId: string;
}

/** Hands a count that waits in `applying` to the queue, or applies it here without one. */
export async function queueStockCountApply(
  env: Env,
  client: pg.Client,
  tenantId: string,
  countId: string,
): Promise<void> {
  if (env.DOMAINS) {
    await env.DOMAINS.send(
      { kind: 'stock_count_apply', tenantId, countId },
      { contentType: 'json' },
    );
    return;
  }
  for (let i = 0; i < 10; i++) {
    const { done } = await applyBatch(env, client, tenantId, countId);
    if (done) return;
  }
}

function applyBatch(env: Env, client: pg.Client, tenantId: string, countId: string) {
  return withTenant(client, tenantId, (tx) => applyStockCountBatch(tx, systemActor, countId), {
    afterCommit: (events) => relayEvents(client, events, queueSink(env.OUTBOX)).then(() => {}),
  });
}

export async function handleStockCountMessages(
  messages: readonly Message<StockCountMessage>[],
  env: Env,
  ctx: Ctx,
): Promise<void> {
  await withClient(env, ctx, async (client) => {
    for (const message of messages) {
      const { tenantId, countId } = message.body;
      try {
        const { done, applied } = await applyBatch(env, client, tenantId, countId);
        log('info', 'stock count batch applied', {
          tenant_id: tenantId,
          count_id: countId,
          applied,
          done,
        });
        if (!done) await env.DOMAINS?.send(message.body, { contentType: 'json' });
        message.ack();
      } catch (e) {
        log('error', 'stock count batch failed', {
          tenant_id: tenantId,
          count_id: countId,
          error: String(e),
        });
        if (message.attempts >= 3) {
          await withTenant(client, tenantId, (tx) =>
            failStockCountApply(tx, countId, String(e)),
          ).catch(() => {});
          captureMessage('Stock count apply failed', {
            level: 'error',
            tags: { tenant_id: tenantId },
            extra: { countId, error: String(e) },
          });
          message.ack();
        } else message.retry({ delaySeconds: 60 });
      }
    }
  });
}
