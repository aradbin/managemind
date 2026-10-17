// Scheduled sales at the edge (phase-4-plan §3.14): when a sale is saved, the
// outbox event becomes one delayed message per window edge on the delayed
// queue. Queue delays are at most 12 hours, so a message that arrives early
// sends itself on again. On time, the products' price ranges are refreshed
// and their pages purged. The daily job catches any edge a lost message
// missed.
import { applySaleEdges, type OutboxEvent, relayEvents, withTenant } from '@managemind/core';
import { queueSink, withClient } from './db';
import type { Env } from './env';
import { log } from './log';

export interface SaleEdgeMessage {
  kind: 'sale_edge';
  tenantId: string;
  productIds: string[];
  /** When the window opens or closes (ISO). */
  at: string;
}

/** Cloudflare Queues' longest delay. */
export const MAX_DELAY_SECONDS = 12 * 60 * 60;

const delayUntil = (at: string, now = Date.now()) =>
  Math.min(MAX_DELAY_SECONDS, Math.max(0, Math.ceil((Date.parse(at) - now) / 1000)));

/** The delayed messages for the sale events in an outbox batch. */
export function saleEdgeMessages(events: readonly OutboxEvent[], now = Date.now()) {
  return events
    .filter((e) => e.eventType === 'catalog.sale_scheduled')
    .flatMap((e) => {
      const payload = e.payload as { productIds: string[]; edges: string[] };
      return payload.edges
        .filter((at) => Date.parse(at) > now)
        .map((at) => ({
          body: {
            kind: 'sale_edge' as const,
            tenantId: e.tenantId,
            productIds: payload.productIds,
            at,
          },
          contentType: 'json' as const,
          delaySeconds: delayUntil(at, now),
        }));
    });
}

/** Applies the edges that are due; sends the early ones on again. */
export async function handleSaleEdges(
  messages: readonly Message<SaleEdgeMessage>[],
  env: Env,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
): Promise<void> {
  const now = Date.now();
  // A minute's grace: the queue may deliver a little early.
  const early = messages.filter((m) => Date.parse(m.body.at) - now > 60_000);
  const due = messages.filter((m) => !early.includes(m));
  for (const m of early) {
    try {
      await env.DOMAINS?.send(m.body, {
        contentType: 'json',
        delaySeconds: delayUntil(m.body.at, now),
      });
      m.ack();
    } catch (e) {
      log('error', 'sale edge resend failed', { tenant_id: m.body.tenantId, error: String(e) });
      m.retry({ delaySeconds: 60 });
    }
  }
  if (!due.length) return;
  await withClient(env, ctx, async (client) => {
    for (const m of due) {
      try {
        await withTenant(client, m.body.tenantId, (tx) => applySaleEdges(tx, m.body.productIds), {
          afterCommit: (events) =>
            relayEvents(client, events, queueSink(env.OUTBOX)).then(() => {}),
        });
        log('info', 'sale edge applied', {
          tenant_id: m.body.tenantId,
          products: m.body.productIds.length,
          at: m.body.at,
        });
        m.ack();
      } catch (e) {
        log('error', 'sale edge failed', { tenant_id: m.body.tenantId, error: String(e) });
        m.retry({ delaySeconds: 60 });
      }
    }
  });
}

/** The daily catch-up: every product whose sale window opened or closed in the last 25 hours. */
export async function catchUpSaleEdges(
  env: Env,
  client: Parameters<Parameters<typeof withClient>[2]>[0],
): Promise<number> {
  const { rows } = await client.query<{ tenant_id: string; product_id: string }>(
    'select * from app.sale_edges(25, 5000)',
  );
  const byTenant = new Map<string, string[]>();
  for (const r of rows)
    byTenant.set(r.tenant_id, [...(byTenant.get(r.tenant_id) ?? []), r.product_id]);
  for (const [tenantId, productIds] of byTenant) {
    await withTenant(client, tenantId, (tx) => applySaleEdges(tx, productIds), {
      afterCommit: (events) => relayEvents(client, events, queueSink(env.OUTBOX)).then(() => {}),
    });
  }
  if (rows.length) log('info', 'sale edges caught up', { products: rows.length });
  return rows.length;
}
