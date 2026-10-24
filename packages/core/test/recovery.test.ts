// Sales recovery (phase-6-plan §10): the delivery success score and the
// rules that read it, duplicates, the confirmation queue, the SMS link and
// incomplete orders, against Postgres with RLS on.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addToCart,
  cancelOrder,
  confirmOrder,
  createManualOrder,
  createProduct,
  createShipment,
  createTenant,
  deliverShipment,
  failShipment,
  getCustomer,
  getOrder,
  getPhoneRisk,
  listOrders,
  placeOrder,
  previewManualOrder,
  receive,
  returnShipment,
  setCartArea,
  shipShipment,
  shopperActor,
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
  const slug = `rec${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Recovery test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
});
afterAll(() => app.end());

const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
let seq = 0;
async function product(price = 50_000, stock = 100) {
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
let phoneSeq = 0;
/** A phone no other test uses. */
const newPhone = () => `+88017${String(10_000_000 + ++phoneSeq * 7919).slice(-8)}`;

/** A COD order entered by staff. */
const manualOrder = (variantId: string, phone: string, quantity = 1) =>
  run((tx) =>
    createManualOrder(tx, owner, {
      source: 'phone',
      lines: [{ variantId, quantity }],
      contact: { name: 'Karim', phone },
      address,
    }),
  );

async function ship(orderId: string) {
  const order = await run((tx) => getOrder(tx, owner, orderId));
  if (order.status === 'pending') await run((tx) => confirmOrder(tx, owner, orderId));
  const shipment = await run((tx) =>
    createShipment(tx, owner, orderId, {
      lines: order.lines.map((l) => ({ orderLineId: l.id, quantity: l.quantity })),
    }),
  );
  await run((tx) => shipShipment(tx, owner, shipment.id));
  return shipment.id;
}
const delivered = async (orderId: string) => {
  const id = await ship(orderId);
  await run((tx) => deliverShipment(tx, owner, id, { cashCollected: true }));
};
const cameBack = async (orderId: string) => {
  const id = await ship(orderId);
  await run((tx) => failShipment(tx, owner, id, { reason: 'Not at home' }));
  await run((tx) => returnShipment(tx, owner, id));
};
const setFraud = (fraud: Record<string, unknown>) =>
  run((tx) => updateStoreProfile(tx, owner, { fraud: { flagAfterFailed: 20, ...fraud } }));

describe('the delivery success score', () => {
  it('counts delivered against returned, fake, wrong number and no answer', async () => {
    const v = await product();
    const phone = newPhone();
    for (let i = 0; i < 3; i++) await delivered((await manualOrder(v, phone)).id);
    await cameBack((await manualOrder(v, phone)).id);
    const fake = await manualOrder(v, phone);
    await run((tx) => cancelOrder(tx, owner, fake.id, { reason: 'Never ordered', code: 'fake' }));
    const changed = await manualOrder(v, phone);
    await run((tx) =>
      cancelOrder(tx, owner, changed.id, { reason: 'Changed mind', code: 'shopper_request' }),
    );
    await manualOrder(v, phone);

    const risk = await run((tx) => getPhoneRisk(tx, owner, phone));
    expect(risk.history).toEqual({
      delivered: 3,
      returned: 1,
      fake: 1,
      wrongNumber: 0,
      noAnswer: 0,
      cancelled: 1,
      open: 1,
    });
    // One delivery came back: Phase 5A's default flags the phone after one.
    expect(risk).toMatchObject({
      score: 60,
      decided: 5,
      risky: true,
      trusted: false,
      reasons: ['failed_deliveries'],
    });
    // Viewers see it too: counts only.
    const viewer = await run((tx) => getPhoneRisk(tx, actorAs('viewer'), phone));
    expect(viewer.score).toBe(60);
  });

  it('calls a phone with no orders new, and accepts it typed as 01…', async () => {
    const risk = await run((tx) => getPhoneRisk(tx, owner, '01799999999'));
    expect(risk).toMatchObject({ score: null, decided: 0, risky: false });
    await expect(run((tx) => getPhoneRisk(tx, owner, '12345'))).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('shows on the order list, the order, the customer and the manual order preview', async () => {
    const v = await product();
    const phone = newPhone();
    await delivered((await manualOrder(v, phone)).id);
    const second = await manualOrder(v, phone);
    const order = await run((tx) => getOrder(tx, owner, second.id));
    // The first order was delivered when the second was placed: 100%.
    expect(order.phoneScoreAtPlacement).toBe(100);
    expect(order.risk).toMatchObject({ score: 100, history: { delivered: 1, open: 1 } });
    expect(order.otherOpenOrders).toEqual([]);
    const third = await manualOrder(v, phone);
    const again = await run((tx) => getOrder(tx, owner, third.id));
    expect(again.otherOpenOrders.map((o) => o.id)).toEqual([second.id]);

    const list = await run((tx) => listOrders(tx, owner, { q: phone.slice(-8) }));
    expect(list.items.map((o) => o.risk.score)).toEqual([100, 100, 100]);
    const customer = await run((tx) => getCustomer(tx, owner, order.customer.id));
    expect(customer.risk.history.delivered).toBe(1);
    const preview = await run((tx) =>
      previewManualOrder(tx, owner, {
        source: 'phone',
        lines: [{ variantId: v, quantity: 1 }],
        contact: { phone },
        address,
      }),
    );
    expect(preview.risk?.score).toBe(100);
  });

  it('records a new phone as null at placement', async () => {
    const placed = await manualOrder(await product(), newPhone());
    const order = await run((tx) => getOrder(tx, owner, placed.id));
    expect(order.phoneScoreAtPlacement).toBeNull();
    expect(order.flags).not.toContain('flagged_phone');
  });
});

describe('the score threshold', () => {
  it('makes a phone risky under it, with enough decided orders, and flags its orders', async () => {
    const v = await product();
    const phone = newPhone();
    const one = await manualOrder(v, phone);
    await run((tx) => cancelOrder(tx, owner, one.id, { reason: 'Fake', code: 'fake' }));
    await setFraud({ minScore: 50, minDecided: 2 });
    try {
      // One decided order isn't enough.
      expect((await run((tx) => getPhoneRisk(tx, owner, phone))).risky).toBe(false);
      const two = await manualOrder(v, phone);
      await run((tx) => cancelOrder(tx, owner, two.id, { reason: 'No answer', code: 'no_answer' }));
      const risk = await run((tx) => getPhoneRisk(tx, owner, phone));
      expect(risk).toMatchObject({ score: 0, decided: 2, risky: true, reasons: ['low_score'] });
      const three = await manualOrder(v, phone);
      const order = await run((tx) => getOrder(tx, owner, three.id));
      expect(order.flags).toContain('flagged_phone');
      expect(order.phoneScoreAtPlacement).toBe(0);
      const flagged = await run((tx) => listOrders(tx, owner, { flag: 'flagged_phone' }));
      expect(flagged.items.map((o) => o.id)).toContain(three.id);
    } finally {
      await setFraud({});
    }
  });

  it('asks a risky phone for the code by SMS before cash on delivery', async () => {
    const v = await product();
    const phone = newPhone();
    for (const code of ['fake', 'wrong_number'] as const) {
      const o = await manualOrder(v, phone);
      await run((tx) => cancelOrder(tx, owner, o.id, { reason: 'Gone', code }));
    }
    await setFraud({ minScore: 50 });
    await run((tx) => updateStoreProfile(tx, owner, { cod: { otp: 'flagged' } }));
    try {
      const checkout = async (p: string) => {
        const added = await run((tx) => addToCart(tx, null, { variantId: v, quantity: 1 }, 'en'));
        const cart = await run((tx) => setCartArea(tx, added.token, { areaId: 513 }));
        return run((tx) =>
          placeOrder(tx, shopperActor(), {
            channel: 'storefront',
            source: 'website',
            cartToken: added.token,
            contact: { name: 'Rahim', phone: p },
            address,
            payment: { kind: 'cod' },
            expectedTotal: cart.quote.totals.total,
            locale: 'en',
            smsReady: true,
          }),
        );
      };
      await expect(checkout(phone)).rejects.toMatchObject({ code: 'otp_required' });
      // A phone with a good record, or a new one, goes straight through.
      await expect(checkout(newPhone())).resolves.toMatchObject({ status: 'pending' });
    } finally {
      await setFraud({});
      await run((tx) => updateStoreProfile(tx, owner, { cod: { otp: 'off' } }));
    }
  });
});

describe('cancel codes', () => {
  it('records the code, other when staff give none, and shopper_request for shoppers', async () => {
    const v = await product();
    const a = await manualOrder(v, newPhone());
    await run((tx) => cancelOrder(tx, owner, a.id, { reason: 'Out', code: 'out_of_stock' }));
    const b = await manualOrder(v, newPhone());
    await run((tx) => cancelOrder(tx, owner, b.id, { reason: 'Whatever' }));
    const c = await manualOrder(v, newPhone());
    await run((tx) => cancelOrder(tx, shopperActor(), c.id, { reason: 'Not needed' }));
    const codes = await run(async (tx) => {
      const { rows } = await tx.db.execute<{ id: string; cancel_code: string }>(
        sql`select id, cancel_code from store.orders where id in (${a.id}, ${b.id}, ${c.id})`,
      );
      return Object.fromEntries(rows.map((r) => [r.id, r.cancel_code]));
    });
    expect(codes).toEqual({ [a.id]: 'out_of_stock', [b.id]: 'other', [c.id]: 'shopper_request' });
    expect((await run((tx) => getOrder(tx, owner, a.id))).cancelCode).toBe('out_of_stock');
  });
});
