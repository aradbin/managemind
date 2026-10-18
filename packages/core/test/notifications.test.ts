// The notification pipeline (phase-5a-plan §3.6–§3.9, §10): what each event
// sends, what is skipped and why, and that a redelivered event sends nothing
// twice. Acceptance criterion 3: a store without SMS logs its SMS as skipped.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addToCart,
  cancelOrder,
  createProduct,
  createTenant,
  formatTaka,
  markMessage,
  type OutboxEvent,
  placeOrder,
  planMessages,
  receive,
  recordMessages,
  renderMessage,
  setCartArea,
  shopperActor,
  systemActor,
  type TenantTx,
  triggeredBy,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
let owner: Actor;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000ab',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
const options = { trackUrl: 'https://shop.example.test/track', smsGateway: false };

beforeAll(async () => {
  app = await connectApp();
  const slug = `note${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Notify Store',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
});
afterAll(() => app.end());

async function order(email?: string) {
  const p = await run((tx) =>
    createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: `Thing ${Date.now()}` } },
      variant: { price: 60_000 },
    }),
  );
  const variantId = p.variants[0]?.id as string;
  await run((tx) => receive(tx, owner, { variantId, quantity: 5, reason: 'received' }));
  const { token } = await run((tx) => addToCart(tx, null, { variantId, quantity: 1 }, 'en'));
  const cart = await run((tx) => setCartArea(tx, token ?? null, { areaId: 513 }));
  return run((tx) =>
    placeOrder(tx, shopperActor(), {
      channel: 'storefront',
      source: 'website',
      cartToken: token ?? null,
      contact: { name: 'Rina', phone: '+8801712000111', ...(email ? { email } : {}) },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
      payment: { kind: 'cod' },
      expectedTotal: cart.quote.totals.total,
      locale: 'en',
    }),
  );
}

/** The outbox event of a type for an order, as the queue would deliver it. */
const eventFor = (type: string, aggregateId: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{
      id: string;
      event_type: string;
      aggregate_type: string;
      aggregate_id: string;
      payload: unknown;
    }>(
      sql`select id, event_type, aggregate_type, aggregate_id, payload from store.outbox
           where event_type = ${type} and aggregate_id = ${aggregateId} order by created_at desc limit 1`,
    );
    const r = rows[0];
    if (!r) throw new Error(`no ${type} event`);
    return {
      id: r.id,
      tenantId: store,
      eventType: r.event_type,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      payload: r.payload,
      requestId: null,
      createdAt: new Date().toISOString(),
    } as OutboxEvent;
  });

describe('notifications', () => {
  it('plan the shopper email, a skipped SMS without a gateway, and a staff push', async () => {
    const placed = await order('rina@example.test');
    const event = await eventFor('order.placed', placed.id);
    const planned = await run((tx) => planMessages(tx, event, options));
    const summary = planned.map((p) => [p.event, p.channel, p.recipientType, p.skip]);
    expect(summary).toEqual(
      expect.arrayContaining([
        ['order_placed', 'email', 'shopper', null],
        // Acceptance criterion 3: no gateway, no error, a reason in the log.
        ['order_placed', 'sms', 'shopper', 'no_gateway'],
        // The owner has no push device yet.
        ['new_order', 'push', 'staff', 'no_device'],
      ]),
    );
    // Staff email is off by default.
    expect(summary.some(([e, c]) => e === 'new_order' && c === 'email')).toBe(false);
    const email = planned.find((p) => p.channel === 'email');
    expect(email?.values).toMatchObject({
      store_name: 'Notify Store',
      customer_name: 'Rina',
      order_url: options.trackUrl,
    });
    expect(email?.values.order_number).toMatch(/^#\d+$/);
  });

  it('send each message once, however often the event arrives', async () => {
    const placed = await order('once@example.test');
    const event = await eventFor('order.placed', placed.id);
    const planned = await run((tx) => planMessages(tx, event, options));
    const first = await run((tx) => recordMessages(tx, planned));
    expect(first.map((q) => q.channel)).toEqual(['email']);
    // A redelivery before sending finds the same queued message, not a new one.
    const again = await run((tx) => recordMessages(tx, planned));
    expect(again.map((q) => q.id)).toEqual(first.map((q) => q.id));
    await run((tx) =>
      markMessage(tx, first[0]?.id as string, { status: 'sent', provider: 'capture' }),
    );
    expect(await run((tx) => recordMessages(tx, planned))).toEqual([]);
    const { rows } = await run((tx) =>
      tx.db.execute<{ status: string; n: number }>(
        sql`select status, count(*)::int as n from store.messages where order_id = ${placed.id} group by status order by status`,
      ),
    );
    expect(rows).toEqual([
      { status: 'sent', n: 1 },
      { status: 'skipped', n: 2 },
    ]);
  });

  it('keep a retryable failure queued and a permanent one failed', async () => {
    const placed = await order('fail@example.test');
    const event = await eventFor('order.placed', placed.id);
    const planned = await run((tx) => planMessages(tx, event, options));
    const [queued] = await run((tx) => recordMessages(tx, planned));
    await run((tx) =>
      markMessage(tx, queued?.id as string, { status: 'failed', reason: 'timeout', retry: true }),
    );
    expect(await run((tx) => recordMessages(tx, planned))).toHaveLength(1);
    await run((tx) =>
      markMessage(tx, queued?.id as string, {
        status: 'failed',
        reason: 'bad address',
        retry: false,
      }),
    );
    expect(await run((tx) => recordMessages(tx, planned))).toEqual([]);
  });

  it('skip email for a shopper who gave none', async () => {
    const placed = await order();
    const event = await eventFor('order.placed', placed.id);
    const planned = await run((tx) => planMessages(tx, event, options));
    expect(planned.find((p) => p.channel === 'email')?.skip).toBe('no_address');
  });

  it('alert staff when the shopper cancels, and only then', async () => {
    const placed = await order('cancel@example.test');
    await run((tx) => cancelOrder(tx, shopperActor(), placed.id, { reason: 'changed mind' }));
    const event = await eventFor('order.cancelled', placed.id);
    expect(triggeredBy(event)?.staff).toEqual(['shopper_cancelled']);
    expect(triggeredBy({ ...event, payload: { number: 1, by: 'staff' } })?.staff).toEqual([]);
  });

  it("render with the store's own template when it has one", async () => {
    const message = {
      event: 'order_placed' as const,
      channel: 'sms' as const,
      locale: 'en' as const,
      values: { store_name: 'Notify Store', order_number: '#1001', total: '৳600', order_url: 'u' },
    };
    expect((await run((tx) => renderMessage(tx, message)))?.body).toBe(
      'Notify Store: order #1001 received. Total ৳600. Track: u',
    );
    await run((tx) =>
      tx.db.execute(
        sql`insert into store.message_templates (event, channel, locale, body)
             values ('order_placed', 'sms', 'en', 'Got {order_number}!')`,
      ),
    );
    expect((await run((tx) => renderMessage(tx, message)))?.body).toBe('Got #1001!');
  });

  it('show whole taka without zeros, in Bangla digits for Bangla', () => {
    expect(formatTaka(60_000, 'en')).toBe('৳600');
    expect(formatTaka(60_050, 'en')).toBe('৳600.50');
    expect(formatTaka(60_000, 'bn')).toBe('৬০০৳');
  });
});
