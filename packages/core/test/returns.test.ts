// Returns, refunds, store credit and exchanges (phase-5a-plan §3.12, §3.13,
// §10). Acceptance criterion 2: a partial return of an order discounted by a
// code and an order-level promotion refunds exactly the returned units'
// share, inspection restocks by condition with the ledger balanced, and
// refunds never exceed what was paid.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { refundShare } from '@managemind/shared/orders';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addToCart,
  confirmOrder,
  createProduct,
  createPromotion,
  createRefund,
  createReturn,
  createShipment,
  createTenant,
  deliverShipment,
  exchangeReturn,
  getOrder,
  getReturn,
  inspectReturn,
  inventoryDrift,
  moveReturn,
  placeOrder,
  previewRefund,
  receive,
  setCartArea,
  setCartCode,
  shipShipment,
  shopperActor,
  shopperReturnable,
  systemActor,
  type TenantTx,
  updateStoreProfile,
  withTenant,
} from '../src';
import { connectApp } from './setup';

let app: pg.Client;
let store: string;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000de',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
let owner: Actor;
const address = { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1, Road 2' };

beforeAll(async () => {
  app = await connectApp();
  const slug = `ret${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Returns test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
  // An order-level promotion for every order, and a code on top (criterion 2).
  await run((tx) =>
    createPromotion(tx, owner, {
      title: { en: '৳100 off' },
      kind: 'automatic',
      status: 'active',
      action: { type: 'amount_off_order', amount: 10_000 },
    }),
  );
  await run((tx) =>
    createPromotion(tx, owner, {
      title: { en: '7% off' },
      kind: 'code',
      status: 'active',
      code: 'SEVEN',
      action: { type: 'percent_off_order', percentBp: 700 },
    }),
  );
});
afterAll(() => app.end());

const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
let seq = 0;
async function product(price: number, stock = 20) {
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
const lines = (orderId: string) =>
  run(async (tx) =>
    (
      await tx.db.execute<{ id: string; quantity: number; line_total: string }>(
        sql`select id, quantity, line_total from store.order_lines where order_id = ${orderId} order by position`,
      )
    ).rows.map((l) => ({ ...l, lineTotal: Number(l.line_total) })),
  );

/** A delivered, paid COD order with a code, as a shopper would place it. */
async function deliveredOrder(items: [string, number][], phone = '+8801712345601', code = 'SEVEN') {
  let token: string | null = null;
  for (const [variantId, quantity] of items) {
    const r = await run((tx) => addToCart(tx, token, { variantId, quantity }, 'en'));
    token = r.token ?? token;
  }
  if (code) await run((tx) => setCartCode(tx, token, { code }));
  const cart = await run((tx) => setCartArea(tx, token, { areaId: 513 }));
  const placed = await run((tx) =>
    placeOrder(tx, shopperActor(), {
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
  await run((tx) => confirmOrder(tx, owner, placed.id));
  const orderLines = await lines(placed.id);
  const shipment = await run((tx) =>
    createShipment(tx, owner, placed.id, {
      lines: orderLines.map((l) => ({ orderLineId: l.id, quantity: l.quantity })),
    }),
  );
  await run((tx) => shipShipment(tx, owner, shipment.id));
  await run((tx) => deliverShipment(tx, owner, shipment.id, { cashCollected: true }));
  return { placed, lines: orderLines };
}

async function receivedReturn(
  orderId: string,
  items: { orderLineId: string; quantity: number }[],
  reason: 'damaged' | 'changed_mind' = 'changed_mind',
) {
  const ret = await run((tx) => createReturn(tx, owner, { orderId, reason, lines: items }));
  await run((tx) => moveReturn(tx, owner, ret.id, 'receive'));
  return ret;
}

describe('acceptance criterion 2: a partial return of a discounted order', () => {
  it('refunds exactly the returned units’ share, restocking by condition', async () => {
    const a = await product(33_333);
    const b = await product(50_000);
    const {
      placed,
      lines: [la, lb],
    } = await deliveredOrder([
      [a, 3],
      [b, 1],
    ]);
    const order = await run((tx) => getOrder(tx, owner, placed.id));
    expect(order.adjustments.length).toBe(2);
    expect(order.paymentStatus).toBe('paid');
    // The line totals carry both discounts.
    expect(la?.lineTotal).toBeLessThan(3 * 33_333);
    const before = await stock(a);

    // One unit back, damaged.
    const ret = await receivedReturn(placed.id, [{ orderLineId: la?.id as string, quantity: 1 }]);
    const inspected = await run((tx) =>
      inspectReturn(tx, owner, ret.id, {
        lines: [{ orderLineId: la?.id, sellable: 0, damaged: 1 }],
      }),
    );
    expect(inspected).toMatchObject({ status: 'inspected', lines: [{ writtenOff: 1 }] });
    // Back on hand and written off: on hand ends where it was, and the ledger balances.
    expect(await stock(a)).toEqual(before);
    expect(await run((tx) => inventoryDrift(tx))).toEqual([]);

    const share = refundShare(la?.lineTotal as number, 3, 0, 1);
    expect(share).toBe(Math.round((la?.lineTotal as number) / 3));
    const preview = await run((tx) => previewRefund(tx, owner, placed.id, { returnId: ret.id }));
    expect(preview).toMatchObject({ amount: share, delivery: 0, lines: [{ quantity: 1 }] });

    const refund = await run((tx) =>
      createRefund(tx, owner, placed.id, {
        returnId: ret.id,
        method: 'bkash',
        reference: 'BK123',
      }),
    );
    expect(refund).toMatchObject({ status: 'succeeded', amount: share });
    const after = await run((tx) => getOrder(tx, owner, placed.id));
    expect(after).toMatchObject({
      paymentStatus: 'partially_refunded',
      returnStatus: 'partially_returned',
      totals: { refundedTotal: share },
    });
    expect((await run((tx) => getReturn(tx, owner, ret.id))).resolution).toBe('refunded');

    // The other two units of the line, sellable this time: the shares add up to the line total.
    const rest = await receivedReturn(placed.id, [{ orderLineId: la?.id as string, quantity: 2 }]);
    await run((tx) =>
      inspectReturn(tx, owner, rest.id, {
        lines: [{ orderLineId: la?.id, sellable: 2, damaged: 0 }],
      }),
    );
    expect(await stock(a)).toEqual({ on_hand: (before?.on_hand ?? 0) + 2, reserved: 0 });
    const second = await run((tx) =>
      createRefund(tx, owner, placed.id, { returnId: rest.id, method: 'cash' }),
    );
    expect(share + second.amount).toBe(la?.lineTotal);

    // Line B, the last unit, for a reason the shopper pays the return for: no delivery fee back.
    const last = await receivedReturn(placed.id, [{ orderLineId: lb?.id as string, quantity: 1 }]);
    await run((tx) =>
      inspectReturn(tx, owner, last.id, {
        lines: [{ orderLineId: lb?.id, sellable: 1, damaged: 0 }],
      }),
    );
    const lastPreview = await run((tx) =>
      previewRefund(tx, owner, placed.id, { returnId: last.id }),
    );
    expect(lastPreview).toMatchObject({ amount: lb?.lineTotal, delivery: 0 });
    await run((tx) => createRefund(tx, owner, placed.id, { returnId: last.id, method: 'cash' }));
    expect(await run((tx) => getOrder(tx, owner, placed.id))).toMatchObject({
      returnStatus: 'returned',
      paymentStatus: 'partially_refunded',
    });
  });

  it('gives the delivery fee back when the whole order returns for the store’s fault', async () => {
    const a = await product(40_000);
    const {
      placed,
      lines: [la],
    } = await deliveredOrder([[a, 2]], '+8801712345602', '');
    const order = await run((tx) => getOrder(tx, owner, placed.id));
    const ret = await receivedReturn(
      placed.id,
      [{ orderLineId: la?.id as string, quantity: 2 }],
      'damaged',
    );
    await run((tx) =>
      inspectReturn(tx, owner, ret.id, {
        lines: [{ orderLineId: la?.id, sellable: 0, damaged: 2 }],
      }),
    );
    const preview = await run((tx) => previewRefund(tx, owner, placed.id, { returnId: ret.id }));
    const fee = order.totals.deliveryFee - order.totals.deliveryDiscount;
    expect(fee).toBeGreaterThan(0);
    expect(preview).toMatchObject({ delivery: fee, amount: la?.lineTotal + fee });
    await run((tx) => createRefund(tx, owner, placed.id, { returnId: ret.id, method: 'cash' }));
    expect(await run((tx) => getOrder(tx, owner, placed.id))).toMatchObject({
      paymentStatus: 'refunded',
      totals: { refundedTotal: order.totals.paidTotal },
    });
  });

  it('never refunds more than was paid, nor twice for the same units', async () => {
    const a = await product(20_000);
    const {
      placed,
      lines: [la],
    } = await deliveredOrder([[a, 1]], '+8801712345603', '');
    const ret = await receivedReturn(placed.id, [{ orderLineId: la?.id as string, quantity: 1 }]);
    await run((tx) =>
      inspectReturn(tx, owner, ret.id, {
        lines: [{ orderLineId: la?.id, sellable: 1, damaged: 0 }],
      }),
    );
    const preview = await run((tx) => previewRefund(tx, owner, placed.id, { returnId: ret.id }));
    await expect(
      run((tx) =>
        createRefund(tx, owner, placed.id, {
          returnId: ret.id,
          method: 'cash',
          amount: preview.amount + 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Lower needs a reason.
    await expect(
      run((tx) =>
        createRefund(tx, owner, placed.id, { returnId: ret.id, method: 'cash', amount: 100 }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // bKash needs its transaction ID.
    await expect(
      run((tx) => createRefund(tx, owner, placed.id, { returnId: ret.id, method: 'bkash' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    // Staff without payments.refund can't.
    await expect(
      run((tx) =>
        createRefund(tx, actorAs('staff'), placed.id, { returnId: ret.id, method: 'cash' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // Two at once, on two connections: the order lock lets one through.
    const other = await connectApp();
    const [first, second] = await Promise.allSettled([
      run((tx) => createRefund(tx, owner, placed.id, { returnId: ret.id, method: 'cash' })),
      withTenant(other, store, (tx) =>
        createRefund(tx, owner, placed.id, { returnId: ret.id, method: 'cash' }),
      ),
    ]).finally(() => other.end());
    const outcomes = [first, second].map((r) => r.status);
    expect(outcomes.sort()).toEqual(['fulfilled', 'rejected']);
    const refused = [first, second].find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(refused.reason).toMatchObject({
      code: expect.stringMatching(/conflict|illegal_transition/),
    });
  });
});

describe('the return machine and the shopper’s window', () => {
  it('lets a shopper ask within the window, for delivered units only, and waits for approval', async () => {
    const a = await product(25_000);
    const {
      placed,
      lines: [la],
    } = await deliveredOrder([[a, 2]], '+8801712345604', '');
    const window = await run((tx) => shopperReturnable(tx, placed.id));
    expect(window).toMatchObject({ open: true, lines: [{ returnable: 2 }] });
    await expect(
      run((tx) =>
        createReturn(
          tx,
          shopperActor(),
          { reason: 'wrong_size', lines: [{ orderLineId: la?.id, quantity: 3 }] },
          { by: 'shopper', orderId: placed.id, photos: [] },
        ),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const asked = await run((tx) =>
      createReturn(
        tx,
        shopperActor(),
        { reason: 'wrong_size', lines: [{ orderLineId: la?.id, quantity: 1 }] },
        { by: 'shopper', orderId: placed.id, photos: [] },
      ),
    );
    const ret = await run((tx) => getReturn(tx, owner, asked.id));
    expect(ret).toMatchObject({
      status: 'requested',
      shopperPaysReturn: true,
      requestedBy: 'shopper',
    });
    expect((await run((tx) => getOrder(tx, owner, placed.id))).returnStatus).toBe('requested');
    // Units asked for aren't returnable twice.
    expect((await run((tx) => shopperReturnable(tx, placed.id))).lines[0]?.returnable).toBe(1);

    await expect(run((tx) => moveReturn(tx, owner, asked.id, 'receive'))).rejects.toMatchObject({
      code: 'illegal_transition',
    });
    await run((tx) => moveReturn(tx, owner, asked.id, 'reject', { reason: 'Worn' }));
    expect(await run((tx) => getReturn(tx, owner, asked.id))).toMatchObject({
      status: 'rejected',
      rejectReason: 'Worn',
    });
    expect((await run((tx) => getOrder(tx, owner, placed.id))).returnStatus).toBe('none');

    // Outside the window, or with requests turned off, shoppers can't ask.
    const later = new Date(Date.now() + 8 * 86_400_000);
    expect((await run((tx) => shopperReturnable(tx, placed.id, later))).open).toBe(false);
    await run((tx) => updateStoreProfile(tx, owner, { returns: { shopperRequests: false } }));
    expect((await run((tx) => shopperReturnable(tx, placed.id))).open).toBe(false);
    await run((tx) => updateStoreProfile(tx, owner, { returns: { shopperRequests: true } }));
  });

  it('refuses returns of what wasn’t delivered', async () => {
    const a = await product(25_000);
    let token: string | null = null;
    const r = await run((tx) => addToCart(tx, token, { variantId: a, quantity: 1 }, 'en'));
    token = r.token ?? token;
    const cart = await run((tx) => setCartArea(tx, token, { areaId: 513 }));
    const placed = await run((tx) =>
      placeOrder(tx, shopperActor(), {
        channel: 'storefront',
        source: 'website',
        cartToken: token,
        contact: { name: 'Rahim', phone: '+8801712345605' },
        address,
        payment: { kind: 'cod' },
        expectedTotal: cart.quote.totals.total,
        locale: 'en',
      }),
    );
    const [line] = await lines(placed.id);
    await expect(
      run((tx) =>
        createReturn(tx, owner, {
          orderId: placed.id,
          reason: 'damaged',
          lines: [{ orderLineId: line?.id, quantity: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('store credit and exchanges', () => {
  it('refunds as a single-use code for the phone, and reissues what an order leaves', async () => {
    const a = await product(30_000);
    const phone = '+8801712345606';
    const {
      placed,
      lines: [la],
    } = await deliveredOrder([[a, 1]], phone, '');
    const ret = await receivedReturn(placed.id, [{ orderLineId: la?.id as string, quantity: 1 }]);
    await run((tx) =>
      inspectReturn(tx, owner, ret.id, {
        lines: [{ orderLineId: la?.id, sellable: 1, damaged: 0 }],
      }),
    );
    const credit = await run((tx) =>
      createRefund(tx, owner, placed.id, { returnId: ret.id, method: 'store_credit' }),
    );
    expect(credit.creditCode).toMatch(/^CR[A-Z2-9]{8}$/);
    expect((await run((tx) => getReturn(tx, owner, ret.id))).resolution).toBe('store_credit');

    // Spent on a smaller order (৳150, ৳100 off automatically): the rest comes back as a new code.
    const cheap = await product(15_000);
    let token: string | null = null;
    const added = await run((tx) => addToCart(tx, token, { variantId: cheap, quantity: 1 }, 'en'));
    token = added.token ?? token;
    await run((tx) => setCartCode(tx, token, { code: credit.creditCode as string }));
    await run((tx) => setCartArea(tx, token, { areaId: 513 }));
    // The code is for this phone, so it applies once the phone is known: the
    // shopper sees the new total and places the order again, as checkout does.
    const place = (expectedTotal: number) =>
      run((tx) =>
        placeOrder(tx, shopperActor(), {
          channel: 'storefront',
          source: 'website',
          cartToken: token,
          contact: { name: 'Rahim', phone },
          address,
          payment: { kind: 'cod' },
          expectedTotal,
          locale: 'en',
        }),
      );
    const changed = await place(0).catch((e) => e);
    expect(changed).toMatchObject({ code: 'price_changed' });
    const spent = await place(changed.extensions.totals.total);
    const issued = await run(async (tx) => {
      const { rows } = await tx.db.execute<{ payload: { amount: number; creditCode: string } }>(
        sql`select payload from store.outbox where event_type = 'store_credit.issued'
             and aggregate_id = ${spent.id}`,
      );
      return rows[0]?.payload;
    });
    const used = (await run((tx) => getOrder(tx, owner, spent.id))).adjustments
      .filter((x) => x.code)
      .reduce((s, x) => s + x.amount, 0);
    expect(used).toBe(5_000);
    expect(issued?.amount).toBe(credit.amount - used);
    // The first code is spent.
    const uses = await run(async (tx) => {
      const { rows } = await tx.db.execute<{ usage_count: number }>(
        sql`select usage_count from store.promotion_codes where code = ${credit.creditCode}`,
      );
      return rows[0]?.usage_count;
    });
    expect(uses).toBe(1);
  });

  it('exchanges for a new order, crediting the returned units', async () => {
    const a = await product(30_000);
    const bigger = await product(45_000);
    const {
      placed,
      lines: [la],
    } = await deliveredOrder([[a, 1]], '+8801712345607', '');
    const ret = await receivedReturn(
      placed.id,
      [{ orderLineId: la?.id as string, quantity: 1 }],
      'damaged',
    );
    await run((tx) =>
      inspectReturn(tx, owner, ret.id, {
        lines: [{ orderLineId: la?.id, sellable: 0, damaged: 1 }],
      }),
    );
    const before = await stock(bigger);
    const ex = await run((tx) =>
      exchangeReturn(tx, owner, ret.id, { lines: [{ variantId: bigger, quantity: 1 }] }),
    );
    expect(ex).toMatchObject({ credit: la?.lineTotal, applied: la?.lineTotal, refundDue: 0 });
    const next = await run((tx) => getOrder(tx, owner, ex.order.id));
    expect(next).toMatchObject({ source: 'exchange', status: 'confirmed' });
    // The store pays the return (damaged), so the replacement ships free; the rest is COD.
    expect(next.totals.deliveryFee - next.totals.deliveryDiscount).toBe(0);
    // Today's prices and offers (the store's ৳100 off), then the credit.
    expect(next.adjustments).toContainEqual(
      expect.objectContaining({ kind: 'manual', amount: la?.lineTotal }),
    );
    expect(next.totals.total).toBe(45_000 - 10_000 - (la?.lineTotal as number));
    expect(await stock(bigger)).toEqual({ on_hand: before?.on_hand, reserved: 1 });
    expect(await run((tx) => getReturn(tx, owner, ret.id))).toMatchObject({
      status: 'resolved',
      resolution: 'exchanged',
      exchangeOrderId: ex.order.id,
    });
  });
});
