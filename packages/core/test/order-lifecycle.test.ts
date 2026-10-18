// The order after placement (phase-4-plan §3.6–§3.9, §10, §13): acceptance
// criterion 3 (a COD order from placed to delivered with stock and history
// right at every step), partial shipments, failed deliveries, cancellation,
// edits, manual payments, walk-ins, and what each reader sees.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addOrderNote,
  addToCart,
  cancelOrder,
  completeWalkIn,
  confirmOrder,
  createProduct,
  createShipment,
  createTenant,
  dashboard,
  deleteShipment,
  deliverShipment,
  editOrder,
  failShipment,
  findOrderForTracking,
  getOrder,
  inventoryDrift,
  listOrders,
  placeOrder,
  receive,
  recordPayment,
  returnShipment,
  setCartArea,
  setCartCode,
  shipShipment,
  shopperActor,
  shopperOrderView,
  systemActor,
  type TenantTx,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000dd',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
let owner: Actor;
const shopper = shopperActor();
const address = { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1, Road 2' };

beforeAll(async () => {
  app = await connectApp();
  const slug = `life${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Lifecycle test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
});
afterAll(() => app.end());

const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
let seq = 0;
async function product(price: number, stock: number) {
  const p = await run((tx) =>
    createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: `Thing ${++seq}` } },
      variant: { price },
    }),
  );
  const id = p.variants[0]?.id as string;
  await run((tx) => receive(tx, owner, { variantId: id, quantity: stock, reason: 'received' }));
  return id;
}
const stock = (variantId: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{ on_hand: number; reserved: number }>(
      sql`select sum(on_hand)::int as on_hand, sum(reserved)::int as reserved from store.inventory_levels where variant_id = ${variantId}`,
    );
    return rows[0];
  });
const drift = () => run((tx) => inventoryDrift(tx));
const lines = (orderId: string) =>
  run(
    async (tx) =>
      (
        await tx.db.execute<{ id: string; quantity: number }>(
          sql`select id, quantity from store.order_lines where order_id = ${orderId} order by position`,
        )
      ).rows,
  );

async function shopperOrder(items: [string, number][], phone = '+8801712345678', code?: string) {
  let token: string | null = null;
  for (const [variantId, quantity] of items) {
    const r = await run((tx) => addToCart(tx, token, { variantId, quantity }, 'en'));
    token = r.token ?? token;
  }
  if (code) await run((tx) => setCartCode(tx, token, { code }));
  const cart = await run((tx) => setCartArea(tx, token, { areaId: 513 }));
  return run((tx) =>
    placeOrder(tx, shopper, {
      channel: 'storefront',
      source: 'website',
      cartToken: token,
      contact: { name: 'Rahim', phone },
      address,
      payment: { kind: 'cod' },
      expectedTotal: cart.quote.totals.total,
      locale: 'en',
    }),
  );
}

describe('acceptance criterion 3: a COD order from placed to delivered', () => {
  it('keeps stock, payment and history right at every step', async () => {
    const v = await product(50_000, 10);
    const placed = await shopperOrder([[v, 2]]);
    expect(await stock(v)).toEqual({ on_hand: 10, reserved: 2 });

    await run((tx) => confirmOrder(tx, owner, placed.id));
    const [line] = await lines(placed.id);
    const shipment = await run((tx) =>
      createShipment(tx, owner, placed.id, {
        lines: [{ orderLineId: line?.id, quantity: 2 }],
        carrier: 'Steadfast',
        trackingNumber: 'SF123',
        trackingUrl: 'https://steadfast.com.bd/t/SF123',
      }),
    );
    expect((await run((tx) => getOrder(tx, owner, placed.id))).status).toBe('processing');
    expect(await stock(v)).toEqual({ on_hand: 10, reserved: 2 });

    const shipped = await run((tx) => shipShipment(tx, owner, shipment.id));
    expect(shipped).toMatchObject({ deliveryStatus: 'shipped', paymentStatus: 'unpaid' });
    expect(await stock(v)).toEqual({ on_hand: 8, reserved: 0 });

    const delivered = await run((tx) =>
      deliverShipment(tx, owner, shipment.id, { cashCollected: true }),
    );
    expect(delivered).toMatchObject({
      status: 'completed',
      deliveryStatus: 'delivered',
      paymentStatus: 'paid',
    });
    expect(await stock(v)).toEqual({ on_hand: 8, reserved: 0 });
    expect(await drift()).toEqual([]);

    const detail = await run((tx) => getOrder(tx, owner, placed.id));
    expect(detail.payments).toMatchObject([{ provider: 'cod', status: 'paid', amount: 107_000 }]);
    expect(
      detail.timeline.map((t) => `${t.machine}:${t.from ?? ''}>${t.to ?? ''}:${t.actorType}`),
    ).toEqual([
      'order:>pending:shopper',
      'order:pending>confirmed:staff',
      'order:confirmed>processing:staff',
      'shipment:>pending:staff',
      'shipment:pending>shipped:staff',
      'delivery:not_shipped>shipped:staff',
      'shipment:shipped>delivered:staff',
      'payment:unpaid>paid:staff',
      'delivery:shipped>delivered:staff',
      'order:processing>completed:staff',
    ]);
    const spent = await run((tx) =>
      tx.db.execute<{ total_spent: string }>(
        sql`select total_spent from store.customers where id = ${detail.customer.id}`,
      ),
    );
    expect(Number(spent.rows[0]?.total_spent)).toBeGreaterThanOrEqual(107_000);
  });
});

describe('shipments', () => {
  it('ship part of an order now and the rest later', async () => {
    const v = await product(10_000, 10);
    const placed = await shopperOrder([[v, 3]], '+8801700000201');
    await run((tx) => confirmOrder(tx, owner, placed.id));
    const [line] = await lines(placed.id);
    const first = await run((tx) =>
      createShipment(tx, owner, placed.id, { lines: [{ orderLineId: line?.id, quantity: 1 }] }),
    );
    await expect(
      run((tx) =>
        createShipment(tx, owner, placed.id, { lines: [{ orderLineId: line?.id, quantity: 3 }] }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await run((tx) => shipShipment(tx, owner, first.id))).toMatchObject({
      deliveryStatus: 'partially_shipped',
    });
    const second = await run((tx) =>
      createShipment(tx, owner, placed.id, { lines: [{ orderLineId: line?.id, quantity: 2 }] }),
    );
    await run((tx) => shipShipment(tx, owner, second.id));
    await run((tx) => deliverShipment(tx, owner, first.id, { cashCollected: false }));
    const done = await run((tx) => deliverShipment(tx, owner, second.id, { cashCollected: true }));
    expect(done).toMatchObject({ status: 'completed', deliveryStatus: 'delivered' });
    expect(await stock(v)).toEqual({ on_hand: 7, reserved: 0 });
  });

  it('bring a failed delivery back into stock, reserved for the order again, and cancel it', async () => {
    const v = await product(10_000, 5);
    const placed = await shopperOrder([[v, 2]], '+8801700000202');
    await run((tx) => confirmOrder(tx, owner, placed.id));
    const [line] = await lines(placed.id);
    const s = await run((tx) =>
      createShipment(tx, owner, placed.id, { lines: [{ orderLineId: line?.id, quantity: 2 }] }),
    );
    await run((tx) => shipShipment(tx, owner, s.id));
    await expect(
      run((tx) => cancelOrder(tx, owner, placed.id, { reason: 'x' })),
    ).rejects.toMatchObject({
      code: 'illegal_transition',
    });
    expect(
      await run((tx) => failShipment(tx, owner, s.id, { reason: 'refused at the door' })),
    ).toMatchObject({
      deliveryStatus: 'failed',
    });
    expect(await stock(v)).toEqual({ on_hand: 3, reserved: 0 });
    await run((tx) => returnShipment(tx, owner, s.id));
    expect(await stock(v)).toEqual({ on_hand: 5, reserved: 2 });
    await run((tx) => cancelOrder(tx, owner, placed.id, { reason: 'refused' }));
    expect(await stock(v)).toEqual({ on_hand: 5, reserved: 0 });
    expect(await drift()).toEqual([]);
  });

  it('can be deleted only before shipping', async () => {
    const v = await product(10_000, 5);
    const placed = await shopperOrder([[v, 1]], '+8801700000203');
    await run((tx) => confirmOrder(tx, owner, placed.id));
    const [line] = await lines(placed.id);
    const s = await run((tx) =>
      createShipment(tx, owner, placed.id, { lines: [{ orderLineId: line?.id, quantity: 1 }] }),
    );
    await run((tx) => deleteShipment(tx, owner, s.id));
    const again = await run((tx) =>
      createShipment(tx, owner, placed.id, { lines: [{ orderLineId: line?.id, quantity: 1 }] }),
    );
    await run((tx) => shipShipment(tx, owner, again.id));
    await expect(run((tx) => deleteShipment(tx, owner, again.id))).rejects.toMatchObject({
      code: 'illegal_transition',
    });
  });
});

describe('cancelling', () => {
  it('releases stock, voids the COD payment and gives the code use back', async () => {
    const v = await product(100_000, 5);
    await run((tx) =>
      tx.db.execute(sql`
        with p as (insert into store.promotions (title, kind, status, usage_limit, action)
                   values ('{"en": "Ten off"}', 'code', 'active', 1, '{"type": "amount_off_order", "amount": 10000}') returning id)
        insert into store.promotion_codes (promotion_id, code) select id, 'TENOFF' from p`),
    );
    const placed = await shopperOrder([[v, 1]], '+8801700000204', 'tenoff');
    expect(placed.total).toBe(97_000);
    const used = () =>
      run(
        async (tx) =>
          (
            await tx.db.execute<{ usage_count: number }>(
              sql`select usage_count from store.promotions where title->>'en' = 'Ten off'`,
            )
          ).rows[0]?.usage_count,
      );
    expect(await used()).toBe(1);
    await run((tx) => cancelOrder(tx, shopper, placed.id, { reason: 'changed my mind' }));
    expect(await used()).toBe(0);
    expect(await stock(v)).toEqual({ on_hand: 5, reserved: 0 });
    const d = await run((tx) => getOrder(tx, owner, placed.id));
    expect(d).toMatchObject({ status: 'cancelled', cancelledBy: 'shopper' });
    expect(d.payments[0]?.status).toBe('voided');
    // The code works again for the next order.
    expect((await shopperOrder([[v, 1]], '+8801700000205', 'TENOFF')).total).toBe(97_000);
  });

  it('by the shopper only while pending', async () => {
    const v = await product(10_000, 5);
    const placed = await shopperOrder([[v, 1]], '+8801700000206');
    await run((tx) => confirmOrder(tx, owner, placed.id));
    await expect(
      run((tx) => cancelOrder(tx, shopper, placed.id, { reason: 'x' })),
    ).rejects.toMatchObject({
      code: 'illegal_transition',
    });
  });
});

describe('editing', () => {
  it('adjusts reservations, keeps the ordered price and re-checks promotions', async () => {
    const a = await product(100_000, 10);
    const b = await product(20_000, 10);
    await run((tx) =>
      tx.db.execute(sql`insert into store.promotions (title, kind, status, conditions, action)
        values ('{"en": "Over 1500"}', 'automatic', 'active', '{"minSubtotal": 150000}', '{"type": "amount_off_order", "amount": 5000}')`),
    );
    const placed = await shopperOrder([[a, 2]], '+8801700000207');
    expect(placed.total).toBe(200_000 + 7_000 - 5_000);
    // The price goes up after the order: the order keeps its own.
    await run((tx) => tx.db.execute(sql`update store.variants set price = 120000 where id = ${a}`));
    const preview = await run((tx) =>
      editOrder(
        tx,
        owner,
        placed.id,
        {
          lines: [
            { variantId: a, quantity: 1 },
            { variantId: b, quantity: 1 },
          ],
        },
        { preview: true },
      ),
    );
    expect(preview.quote.totals.subtotal).toBe(120_000);
    expect(preview.dropped.map((d) => (d.title as { en: string }).en)).toEqual(['Over 1500']);
    expect(await stock(a)).toEqual({ on_hand: 10, reserved: 2 });
    await run((tx) =>
      editOrder(tx, owner, placed.id, {
        lines: [
          { variantId: a, quantity: 1 },
          { variantId: b, quantity: 1 },
        ],
      }),
    );
    expect(await stock(a)).toEqual({ on_hand: 10, reserved: 1 });
    expect(await stock(b)).toEqual({ on_hand: 10, reserved: 1 });
    const d = await run((tx) => getOrder(tx, owner, placed.id));
    expect(d.totals).toMatchObject({
      subtotal: 120_000,
      discountTotal: 0,
      total: 127_000,
      codDue: 127_000,
    });
    expect(d.timeline.some((t) => t.machine === 'edit')).toBe(true);
    expect(await drift()).toEqual([]);
  });
});

describe('payments', () => {
  it('record an advance that shrinks the COD amount', async () => {
    const v = await product(50_000, 5);
    const placed = await shopperOrder([[v, 1]], '+8801700000208');
    const after = await run((tx) =>
      recordPayment(tx, owner, placed.id, { method: 'bkash', amount: 20_000, reference: 'BK1' }),
    );
    expect(after.paymentStatus).toBe('partially_paid');
    const d = await run((tx) => getOrder(tx, owner, placed.id));
    expect(d.totals).toMatchObject({ paidTotal: 20_000, codDue: 37_000 });
  });
});

describe('walk-ins', () => {
  it('are saved, shipped and delivered in one action', async () => {
    const v = await product(30_000, 5);
    const placed = await run((tx) =>
      placeOrder(tx, owner, {
        channel: 'admin',
        source: 'walk_in',
        lines: [{ variantId: v, quantity: 2 }],
        contact: { name: 'Walk-in', phone: '+8801700000209' },
        address: null,
        zone: 'none',
        payment: { kind: 'cod' },
        locale: 'en',
      }),
    );
    expect(placed.total).toBe(60_000);
    const done = await run((tx) => completeWalkIn(tx, owner, placed.id));
    expect(done).toMatchObject({
      status: 'completed',
      paymentStatus: 'paid',
      deliveryStatus: 'delivered',
    });
    expect(await stock(v)).toEqual({ on_hand: 3, reserved: 0 });
  });
});

describe('reading orders', () => {
  it('masks shoppers’ details for a viewer, and lists with filters and search', async () => {
    const v = await product(10_000, 5);
    const placed = await shopperOrder([[v, 1]], '+8801712340210');
    await run((tx) => addOrderNote(tx, owner, placed.id, { body: 'Call before delivery' }));
    const viewer = actorAs('viewer');
    const masked = await run((tx) => getOrder(tx, viewer, placed.id));
    expect(masked.contact.phone).toBe('01712-•••210');
    expect(masked.address?.line).toBe('•••');
    expect(masked.actions).toEqual([]);
    expect(masked.lines[0]).not.toHaveProperty('costPrice');
    const found = await run((tx) => listOrders(tx, owner, { q: '01712340210' }));
    expect(found.items.map((o) => o.id)).toEqual([placed.id]);
    // A viewer can't search by phone.
    expect((await run((tx) => listOrders(tx, viewer, { q: '01712340210' }))).items).toEqual([]);
    const pending = await run((tx) => listOrders(tx, owner, { status: 'pending', limit: 2 }));
    expect(pending.items.every((o) => o.status === 'pending')).toBe(true);
    if (pending.nextCursor) {
      const next = await run((tx) =>
        listOrders(tx, owner, {
          status: 'pending',
          limit: 2,
          after: pending.nextCursor ?? undefined,
        }),
      );
      expect(next.items.some((o) => pending.items.some((p) => p.id === o.id))).toBe(false);
    }
  });

  it('tracks an order by number and phone, and shows the shopper nothing internal', async () => {
    const v = await product(10_000, 5);
    const placed = await shopperOrder([[v, 1]], '+8801700000211');
    expect(
      await run((tx) =>
        findOrderForTracking(tx, { number: placed.displayNumber, phone: '+8801700000211' }),
      ),
    ).toBe(placed.id);
    expect(
      await run((tx) =>
        findOrderForTracking(tx, { number: placed.displayNumber, phone: '+8801700000299' }),
      ),
    ).toBeNull();
    const view = await run((tx) => shopperOrderView(tx, placed.id));
    expect(view).toMatchObject({
      status: 'pending',
      cancellable: true,
      totals: { total: 17_000, codDue: 17_000 },
    });
    expect(view).not.toHaveProperty('timeline');
  });

  it('summarizes the dashboard, with sales only for reports.read', async () => {
    const d = await run((tx) => dashboard(tx, owner));
    expect(d.counts.awaitingConfirmation).toBeGreaterThan(0);
    expect(d.sales?.days).toHaveLength(7);
    expect(d.sales?.today.orders).toBeGreaterThan(0);
    expect((await run((tx) => dashboard(tx, actorAs('staff')))).sales).toBeNull();
  });
});
