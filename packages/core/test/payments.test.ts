// Online payments (phase-5a-plan §3.3–§3.5, §10). Acceptance criterion 1:
// a payment settles only from a valid validation of this store's pending
// payment for exactly its amount in BDT; forged, replayed and tampered ones
// change nothing.
import { permissionsOf } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addToCart,
  createProduct,
  createTenant,
  expireGatewayPayment,
  type GatewayValidation,
  gatewaySession,
  placeOrder,
  receive,
  setCartArea,
  settleGatewayPayment,
  shopperActor,
  systemActor,
  type TenantTx,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
let other: string;
const owner = (): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000ef',
  platformRole: null,
  permissions: permissionsOf('owner'),
  tenantId: store,
  storeRole: 'owner',
});
const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);

async function newStore(prefix: string) {
  const slug = `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  return (
    await createTenant(app, systemActor, {
      slug,
      name: 'Pay Store',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
}

beforeAll(async () => {
  app = await connectApp();
  [store, other] = [await newStore('pay'), await newStore('payb')];
});
afterAll(() => app.end());

async function onlineOrder(kind: 'online' | 'cod_with_advance' = 'online', stock = 5) {
  const p = await run((tx) =>
    createProduct(tx, owner(), {
      status: 'active',
      translations: { en: { title: `Thing ${Date.now()}${Math.random()}` } },
      variant: { price: 60_000 },
    }),
  );
  const variantId = p.variants[0]?.id as string;
  await run((tx) => receive(tx, owner(), { variantId, quantity: stock, reason: 'received' }));
  const { token } = await run((tx) => addToCart(tx, null, { variantId, quantity: 1 }, 'en'));
  const cart = await run((tx) => setCartArea(tx, token ?? null, { areaId: 513 }));
  const order = await run((tx) =>
    placeOrder(tx, shopperActor(), {
      channel: 'storefront',
      source: 'website',
      cartToken: token ?? null,
      contact: { name: 'Rina', phone: '+8801712000333', email: 'rina@example.test' },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
      payment: { kind },
      expectedTotal: cart.quote.totals.total,
      locale: 'en',
      onlineReady: true,
    }),
  );
  return { order, variantId };
}

const valid = (paymentId: string, amount: number, extra: Partial<GatewayValidation> = {}) => ({
  status: 'VALID',
  tranId: paymentId,
  valId: `val-${crypto.randomUUID()}`,
  amount,
  currency: 'BDT',
  tenantId: store,
  bankTranId: 'bank-1',
  riskLevel: 0,
  cardType: 'BKASH-BKash',
  cardIssuer: 'bKash',
  ...extra,
});

const payment = (id: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{ status: string; gateway_val_id: string | null }>(
      sql`select status, gateway_val_id from store.payments where id = ${id}`,
    );
    return rows[0];
  });
const orderRow = (id: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{
      status: string;
      payment_status: string;
      paid_total: string;
      flags: string[];
    }>(sql`select status, payment_status, paid_total, flags from store.orders where id = ${id}`);
    return rows[0];
  });

describe('placing an order paid online', () => {
  it('records one pending online payment for the total, and no COD', async () => {
    const { order } = await onlineOrder();
    expect(order.onlinePayment?.amount).toBe(order.total);
    expect(order.codAmount).toBe(0);
    const session = await run((tx) => gatewaySession(tx, order.onlinePayment?.id as string));
    expect(session).toMatchObject({ amount: order.total, orderNumber: order.displayNumber });
  });

  it('takes only the delivery charge online with an advance, the rest by COD', async () => {
    const { order } = await onlineOrder('cod_with_advance');
    expect(order.onlinePayment?.amount).toBeGreaterThan(0);
    expect((order.onlinePayment?.amount ?? 0) + order.codAmount).toBe(order.total);
  });

  it('refuses online payment when the store has no working gateway', async () => {
    const p = await run((tx) =>
      createProduct(tx, owner(), {
        status: 'active',
        translations: { en: { title: `Off ${Date.now()}` } },
        variant: { price: 60_000 },
      }),
    );
    const variantId = p.variants[0]?.id as string;
    await run((tx) => receive(tx, owner(), { variantId, quantity: 1, reason: 'received' }));
    const { token } = await run((tx) => addToCart(tx, null, { variantId, quantity: 1 }, 'en'));
    const cart = await run((tx) => setCartArea(tx, token ?? null, { areaId: 513 }));
    await expect(
      run((tx) =>
        placeOrder(tx, shopperActor(), {
          channel: 'storefront',
          source: 'website',
          cartToken: token ?? null,
          contact: { name: 'Rina', phone: '+8801712000333' },
          address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
          payment: { kind: 'online' },
          expectedTotal: cart.quote.totals.total,
          locale: 'en',
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('acceptance criterion 1: settling only from a valid validation', () => {
  it('settles a valid validation once, and a replay changes nothing', async () => {
    const { order } = await onlineOrder();
    const id = order.onlinePayment?.id as string;
    const v = valid(id, order.total);
    expect(await run((tx) => settleGatewayPayment(tx, v))).toMatchObject({ kind: 'settled' });
    expect(await payment(id)).toEqual({ status: 'paid', gateway_val_id: v.valId });
    expect(await orderRow(order.id)).toMatchObject({ payment_status: 'paid' });
    // The IPN again, or the return page after it: already done.
    expect(await run((tx) => settleGatewayPayment(tx, v))).toMatchObject({ kind: 'already' });
    // Another validation for a paid payment is a second charge, not a settlement.
    expect(await run((tx) => settleGatewayPayment(tx, { ...v, valId: 'another' }))).toMatchObject({
      kind: 'refused',
    });
    const { rows } = await run((tx) =>
      tx.db.execute<{ n: number }>(
        sql`select count(*)::int as n from store.outbox where event_type = 'payment.settled' and aggregate_id = ${id}`,
      ),
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('refuses a forged validation (not VALID), a tampered amount, another currency or store', async () => {
    const { order } = await onlineOrder();
    const id = order.onlinePayment?.id as string;
    for (const forged of [
      valid(id, order.total, { status: 'INVALID_TRANSACTION' }),
      valid(id, order.total - 100),
      valid(id, order.total, { currency: 'USD' }),
      valid(id, order.total, { tenantId: other }),
      valid(crypto.randomUUID(), order.total),
    ]) {
      expect(await run((tx) => settleGatewayPayment(tx, forged))).toMatchObject({
        kind: 'refused',
      });
    }
    expect(await payment(id)).toEqual({ status: 'pending', gateway_val_id: null });
    expect(await orderRow(order.id)).toMatchObject({ payment_status: 'unpaid' });
  });

  it("never settles another store's payment, whatever the validation says", async () => {
    const { order } = await onlineOrder();
    const id = order.onlinePayment?.id as string;
    const result = await withTenant(app, other, (tx) =>
      settleGatewayPayment(tx, { ...valid(id, order.total), tenantId: other }),
    );
    expect(result).toMatchObject({ kind: 'refused', reason: 'unknown transaction' });
  });

  it('settles a risky card, and flags the order for staff', async () => {
    const { order } = await onlineOrder();
    const id = order.onlinePayment?.id as string;
    const result = await run((tx) =>
      settleGatewayPayment(tx, valid(id, order.total, { riskLevel: 1 })),
    );
    expect(result).toMatchObject({ kind: 'settled', problem: 'risky' });
    expect((await orderRow(order.id))?.flags).toEqual(['payment_risk']);
  });
});

describe('unpaid online orders', () => {
  it('expire at 60 minutes, cancel the order and release the stock', async () => {
    const { order, variantId } = await onlineOrder('online', 2);
    const id = order.onlinePayment?.id as string;
    expect(await run((tx) => expireGatewayPayment(tx, id))).toBe(true);
    expect(await payment(id)).toMatchObject({ status: 'expired' });
    expect(await orderRow(order.id)).toMatchObject({ status: 'cancelled' });
    const { rows } = await run((tx) =>
      tx.db.execute<{ reserved: number }>(
        sql`select sum(reserved)::int as reserved from store.inventory_levels where variant_id = ${variantId}`,
      ),
    );
    expect(rows[0]?.reserved).toBe(0);
    // The cancellation says why, so the shopper gets one message.
    const { rows: events } = await run((tx) =>
      tx.db.execute<{ payload: { reason?: string } }>(
        sql`select payload from store.outbox where event_type = 'order.cancelled' and aggregate_id = ${order.id}`,
      ),
    );
    expect(events[0]?.payload.reason).toBe('payment_expired');
    // A second run does nothing.
    expect(await run((tx) => expireGatewayPayment(tx, id))).toBe(false);
  });

  it('still settle when the money arrives late, flagged for a refund', async () => {
    const { order } = await onlineOrder();
    const id = order.onlinePayment?.id as string;
    await run((tx) => expireGatewayPayment(tx, id));
    const result = await run((tx) => settleGatewayPayment(tx, valid(id, order.total)));
    expect(result).toMatchObject({ kind: 'settled', problem: 'late' });
    expect(await orderRow(order.id)).toMatchObject({
      status: 'cancelled',
      payment_status: 'paid',
      flags: ['late_payment'],
    });
  });
});
