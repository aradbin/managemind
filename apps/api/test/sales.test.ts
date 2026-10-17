// Scheduled sales at the edge (phase-4-plan §3.14): the outbox event becomes
// delayed messages, capped at the queue's 12 hours; an early message sends
// itself on again; a due one refreshes the price range and purges; the daily
// job catches an edge whose message was lost.
import {
  createProduct,
  createTenant,
  type OutboxEvent,
  systemActor,
  updateVariant,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  catchUpSaleEdges,
  handleSaleEdges,
  MAX_DELAY_SECONDS,
  type SaleEdgeMessage,
  saleEdgeMessages,
} from '../src/sales';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

let owner: pg.Client;
let app: pg.Client;
let tenantId: string;
let productId: string;
let variantId: string;
const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  const slug = `s${Date.now().toString(36)}`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: 'Sales API',
    defaultLocale: 'en',
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  tenantId = created.id;
  const actor = {
    kind: 'user' as const,
    userId: created.ownerUserId,
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId,
    storeRole: 'owner' as const,
  };
  const p = await withTenant(app, tenantId, async (tx) => {
    const made = await createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: 'Lehenga' } },
      variant: { price: 500_000 },
    });
    await updateVariant(tx, actor, made.variants[0]?.id as string, {
      salePrice: 400_000,
      saleStartsAt: hours(1),
      saleEndsAt: hours(30),
    });
    return made;
  });
  productId = p.id;
  variantId = p.variants[0]?.id as string;
});
afterAll(() => Promise.all([owner.end(), app.end()]));

class DelayQueue {
  sent: { body: SaleEdgeMessage; delaySeconds?: number | undefined }[] = [];
  async send(body: SaleEdgeMessage, options?: { delaySeconds?: number }) {
    this.sent.push({ body, delaySeconds: options?.delaySeconds });
  }
  async sendBatch() {}
}

const message = (body: SaleEdgeMessage) => {
  const m = { body, acked: false, retried: false } as {
    body: SaleEdgeMessage;
    acked: boolean;
    retried: boolean;
    ack: () => void;
    retry: () => void;
  };
  m.ack = () => {
    m.acked = true;
  };
  m.retry = () => {
    m.retried = true;
  };
  return m;
};

describe('sale edges', () => {
  it('turns the outbox event into delayed messages, never more than 12 hours away', async () => {
    const { rows } = await owner.query<{ id: string; payload: unknown }>(
      `select id, payload from store.outbox where aggregate_id = $1 and event_type = 'catalog.sale_scheduled'`,
      [productId],
    );
    const event = {
      id: rows[0]?.id,
      tenantId,
      eventType: 'catalog.sale_scheduled',
      payload: rows[0]?.payload,
    } as unknown as OutboxEvent;
    const messages = saleEdgeMessages([event]);
    expect(messages).toHaveLength(2);
    const [start, end] = messages;
    expect(start?.delaySeconds).toBeGreaterThan(3_500);
    expect(start?.delaySeconds).toBeLessThanOrEqual(3_600);
    expect(end?.delaySeconds).toBe(MAX_DELAY_SECONDS);
    expect(end?.body).toMatchObject({ kind: 'sale_edge', tenantId, productIds: [productId] });
  });

  it('sends an early message on again, and applies a due one', async () => {
    const queue = new DelayQueue();
    const env = makeEnv({ DOMAINS: queue as unknown as Queue });
    const early = message({ kind: 'sale_edge', tenantId, productIds: [productId], at: hours(20) });
    await handleSaleEdges([early as never], env, makeCtx());
    expect(early.acked).toBe(true);
    expect(queue.sent[0]?.delaySeconds).toBe(MAX_DELAY_SECONDS);

    await owner.query(
      `update store.variants set sale_starts_at = now() - interval '1 minute' where id = $1`,
      [variantId],
    );
    const due = message({ kind: 'sale_edge', tenantId, productIds: [productId], at: hours(0) });
    await handleSaleEdges([due as never], env, makeCtx());
    expect(due.acked).toBe(true);
    const { rows } = await owner.query('select price_min from store.products where id = $1', [
      productId,
    ]);
    expect(Number(rows[0]?.price_min)).toBe(400_000);
  });

  it('catches up an edge whose message was lost', async () => {
    await owner.query(
      `update store.variants set sale_starts_at = now() - interval '2 hours',
              sale_ends_at = now() - interval '1 hour' where id = $1`,
      [variantId],
    );
    expect(await catchUpSaleEdges(makeEnv(), app)).toBeGreaterThanOrEqual(1);
    const { rows } = await owner.query('select price_min from store.products where id = $1', [
      productId,
    ]);
    expect(Number(rows[0]?.price_min)).toBe(500_000);
  });
});
