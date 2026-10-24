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
  anonymizeCustomer,
  answerLink,
  cancelOrder,
  claimConfirmation,
  confirmOrder,
  createManualOrder,
  createProduct,
  createShipment,
  createTenant,
  deliverShipment,
  dismissDuplicate,
  dismissIncompleteOrder,
  failShipment,
  getCustomer,
  getIncompleteOrder,
  getOrder,
  getPhoneRisk,
  getRecoveryReport,
  hashLinkCode,
  incompletePrefill,
  inventoryDrift,
  linkCode,
  linkView,
  listConfirmations,
  listIncompleteOrders,
  listOrders,
  markIncompleteContacted,
  mergeDuplicate,
  type OutboxEvent,
  optOutCheckoutDraft,
  placeOrder,
  planMessages,
  previewManualOrder,
  receive,
  recordOutcome,
  resendLink,
  returnShipment,
  saveCheckoutDraft,
  setCartArea,
  shipShipment,
  shopperActor,
  systemActor,
  type TenantTx,
  triggeredBy,
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
const manualOrder = (
  variantId: string | { variantId: string; quantity: number }[],
  phone: string,
  quantity = 1,
  extra: Record<string, unknown> = {},
) =>
  run((tx) =>
    createManualOrder(tx, owner, {
      source: 'phone',
      lines: typeof variantId === 'string' ? [{ variantId, quantity }] : variantId,
      contact: { name: 'Karim', phone },
      address,
      ...extra,
    }),
  );
const reserved = (variantId: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{ reserved: number }>(
      sql`select coalesce(sum(reserved), 0)::int as reserved from store.inventory_levels where variant_id = ${variantId}`,
    );
    return rows[0]?.reserved;
  });

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

describe('duplicate orders', () => {
  it('flags the same set of variants from the same phone within the window', async () => {
    const [a, b] = [await product(), await product()];
    const phone = newPhone();
    const first = await manualOrder(
      [
        { variantId: a, quantity: 1 },
        { variantId: b, quantity: 1 },
      ],
      phone,
    );
    // Other quantities, same variants: a possible duplicate of the first.
    const second = await manualOrder(
      [
        { variantId: b, quantity: 3 },
        { variantId: a, quantity: 1 },
      ],
      phone,
    );
    const detail = await run((tx) => getOrder(tx, owner, second.id));
    expect(detail.flags).toContain('possible_duplicate');
    expect(detail.duplicateOf).toMatchObject({ id: first.id, status: 'pending' });
    // Another set of variants, or another phone, isn't.
    const third = await manualOrder(a, phone);
    const fourth = await manualOrder(
      [
        { variantId: a, quantity: 1 },
        { variantId: b, quantity: 1 },
      ],
      newPhone(),
    );
    for (const o of [third, fourth]) {
      expect((await run((tx) => getOrder(tx, owner, o.id))).flags).not.toContain(
        'possible_duplicate',
      );
    }
    const flagged = await run((tx) => listOrders(tx, owner, { flag: 'possible_duplicate' }));
    expect(flagged.items.map((o) => o.id)).toContain(second.id);
    // The manual order screen warns before saving.
    const preview = await run((tx) =>
      previewManualOrder(tx, owner, {
        source: 'phone',
        lines: [
          { variantId: b, quantity: 1 },
          { variantId: a, quantity: 2 },
        ],
        contact: { phone },
        address,
      }),
    );
    expect(preview.duplicate?.id).toBe(second.id);
  });

  it('ignores cancelled orders, orders outside the window, and a store that turned it off', async () => {
    const v = await product();
    const phone = newPhone();
    const cancelled = await manualOrder(v, phone);
    await run((tx) => cancelOrder(tx, owner, cancelled.id, { reason: 'x', code: 'other' }));
    const old = await manualOrder(v, phone);
    await run((tx) =>
      tx.db.execute(
        sql`update store.orders set placed_at = now() - interval '31 minutes' where id = ${old.id}`,
      ),
    );
    const next = await manualOrder(v, phone);
    expect((await run((tx) => getOrder(tx, owner, next.id))).flags).not.toContain(
      'possible_duplicate',
    );
    await setFraud({ duplicateMinutes: 0 });
    try {
      const off = await manualOrder(v, phone);
      expect((await run((tx) => getOrder(tx, owner, off.id))).duplicateOf).toBeNull();
    } finally {
      await setFraud({});
    }
  });

  it('merges the newer order into the older: one order, one delivery charge, stock right', async () => {
    const [a, b] = [await product(30_000), await product(20_000)];
    const phone = newPhone();
    const older = await manualOrder(
      [
        { variantId: a, quantity: 1 },
        { variantId: b, quantity: 1 },
      ],
      phone,
    );
    const newer = await manualOrder(
      [
        { variantId: a, quantity: 2 },
        { variantId: b, quantity: 1 },
      ],
      phone,
    );
    const before = await run((tx) => getOrder(tx, owner, older.id));
    expect([await reserved(a), await reserved(b)]).toEqual([3, 2]);

    const { orderId } = await run((tx) => mergeDuplicate(tx, owner, newer.id));
    expect(orderId).toBe(older.id);
    const merged = await run((tx) => getOrder(tx, owner, older.id));
    expect(merged.lines.map((l) => [l.variantId, l.quantity])).toEqual([
      [a, 3],
      [b, 2],
    ]);
    expect(merged.totals.deliveryFee).toBe(before.totals.deliveryFee);
    expect(merged.totals.total).toBe(3 * 30_000 + 2 * 20_000 + before.totals.deliveryFee);
    expect(merged.totals.codDue).toBe(merged.totals.total);
    const cancelled = await run((tx) => getOrder(tx, owner, newer.id));
    expect(cancelled).toMatchObject({ status: 'cancelled', cancelCode: 'duplicate' });
    expect(cancelled.flags).not.toContain('possible_duplicate');
    // Both histories point at each other.
    expect(cancelled.timeline.some((e) => e.event === 'merged_into')).toBe(true);
    expect(merged.timeline.some((e) => e.event === 'merged_from')).toBe(true);
    // Reservations follow: the merged order holds what both did.
    expect([await reserved(a), await reserved(b)]).toEqual([3, 2]);
    expect(await run((tx) => inventoryDrift(tx))).toEqual([]);
    // A second merge finds nothing to merge.
    await expect(run((tx) => mergeDuplicate(tx, owner, newer.id))).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it("won't merge a newer order with a payment, or one that's shipped", async () => {
    const v = await product();
    const phone = newPhone();
    await manualOrder(v, phone);
    const paid = await manualOrder(v, phone, 1, {
      payment: { method: 'bkash', amount: 10_000, reference: 'TX1' },
    });
    await expect(run((tx) => mergeDuplicate(tx, owner, paid.id))).rejects.toMatchObject({
      code: 'illegal_transition',
      extensions: { reason: 'paid' },
    });
    const phone2 = newPhone();
    const first = await manualOrder(v, phone2);
    const second = await manualOrder(v, phone2);
    await ship(first.id);
    await expect(run((tx) => mergeDuplicate(tx, owner, second.id))).rejects.toMatchObject({
      extensions: { reason: 'shipped' },
    });
  });

  it('clears the flag when staff say it is not a duplicate, keeping the link', async () => {
    const v = await product();
    const phone = newPhone();
    const first = await manualOrder(v, phone);
    const second = await manualOrder(v, phone);
    await run((tx) => dismissDuplicate(tx, owner, second.id));
    const detail = await run((tx) => getOrder(tx, owner, second.id));
    expect(detail.flags).not.toContain('possible_duplicate');
    expect(detail.duplicateOf?.id).toBe(first.id);
    expect(detail.timeline.some((e) => e.event === 'duplicate_dismissed')).toBe(true);
    await expect(run((tx) => dismissDuplicate(tx, owner, second.id))).rejects.toMatchObject({
      code: 'conflict',
    });
    await expect(
      run((tx) => mergeDuplicate(tx, actorAs('viewer'), second.id)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('sends the shopper nothing for an order cancelled as a duplicate', () => {
    const event = (code?: string) =>
      triggeredBy({
        id: 'e',
        eventType: 'order.cancelled',
        aggregateType: 'order',
        aggregateId: 'o',
        payload: { number: 1, by: 'staff', ...(code ? { code } : {}) },
      } as never);
    expect(event('duplicate')?.shopper).toEqual([]);
    expect(event('fake')?.shopper).toEqual(['order_cancelled']);
  });
});

describe('the confirmation queue', () => {
  const caller = (n: number): Actor => ({
    ...actorAs('staff'),
    userId: `0199d000-0000-7000-8000-00000000c0${n}0`,
  });
  const inQueue = async (orderId: string, tab = 'to_call') =>
    (await run((tx) => listConfirmations(tx, owner, { tab, limit: 100 }))).items.find(
      (i) => i.orderId === orderId,
    );
  const outcome = (orderId: string, input: Record<string, unknown>, who = owner) =>
    run((tx) => recordOutcome(tx, who, orderId, input));

  it('lists pending COD orders, not confirmed or prepaid ones', async () => {
    const v = await product();
    const cod = await manualOrder(v, newPhone());
    const prepaid = await manualOrder(v, newPhone(), 1, {
      payment: { method: 'bkash', amount: 50_000 + 6_000, reference: 'TX' },
      deliveryFee: { amount: 6_000, reason: 'flat' },
    });
    const confirmed = await manualOrder(v, newPhone(), 1, { confirm: true });
    const item = await inQueue(cod.id);
    expect(item).toMatchObject({ attempts: 0, claim: null, codDue: cod.codAmount });
    expect(item?.items[0]?.quantity).toBe(1);
    expect(await inQueue(prepaid.id)).toBeUndefined();
    expect(await inQueue(confirmed.id)).toBeUndefined();
    await run((tx) => updateStoreProfile(tx, owner, { confirmation: { includePaid: true } }));
    try {
      expect(await inQueue(prepaid.id)).toBeDefined();
    } finally {
      await run((tx) => updateStoreProfile(tx, owner, { confirmation: {} }));
    }
  });

  it('gives the claim to one caller; the other sees who holds it', async () => {
    const placed = await manualOrder(await product(), newPhone());
    const panel = await run((tx) => claimConfirmation(tx, caller(1), placed.id));
    expect(panel).toMatchObject({ orderId: placed.id, attempts: 0, maxAttempts: 3 });
    expect(panel.script).toContain(placed.displayNumber);
    expect(panel.script).toContain('Recovery test');
    await expect(run((tx) => claimConfirmation(tx, caller(2), placed.id))).rejects.toMatchObject({
      code: 'conflict',
      extensions: { reason: 'claimed' },
    });
    // Claiming again extends the caller's own claim.
    await run((tx) => claimConfirmation(tx, caller(1), placed.id));
    expect((await inQueue(placed.id))?.claim).toMatchObject({ userId: caller(1).userId });
    // Someone else can't record an outcome while it's held.
    await expect(outcome(placed.id, { outcome: 'no_answer' }, caller(2))).rejects.toMatchObject({
      code: 'conflict',
    });
    await outcome(placed.id, { outcome: 'no_answer' }, caller(1));
    expect((await inQueue(placed.id, 'later'))?.claim).toBeNull();
  });

  it('lets exactly one of two simultaneous claims win', async () => {
    const placed = await manualOrder(await product(), newPhone());
    const [one, two] = [await connectApp(), await connectApp()];
    try {
      const results = await Promise.allSettled([
        withTenant(one, store, (tx) => claimConfirmation(tx, caller(3), placed.id)),
        withTenant(two, store, (tx) => claimConfirmation(tx, caller(4), placed.id)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    } finally {
      await Promise.all([one.end(), two.end()]);
    }
  });

  it('retries an unanswered order later, and marks it unreachable at the limit', async () => {
    const placed = await manualOrder(await product(), newPhone());
    const first = await outcome(placed.id, { outcome: 'no_answer' });
    expect(first).toMatchObject({ attempts: 1, unreachable: false, status: 'pending' });
    expect(await inQueue(placed.id)).toBeUndefined();
    expect((await inQueue(placed.id, 'later'))?.attempts).toBe(1);
    await outcome(placed.id, { outcome: 'no_answer' });
    const third = await outcome(placed.id, { outcome: 'no_answer', note: 'Switched off' });
    expect(third).toMatchObject({ attempts: 3, unreachable: true, status: 'pending' });
    expect((await inQueue(placed.id, 'unreachable'))?.lastNote).toBe('Switched off');
    const order = await run((tx) => getOrder(tx, owner, placed.id));
    expect(order.flags).toContain('unreachable');
    expect(order.confirmation).toMatchObject({
      inQueue: true,
      attempts: 3,
      lastOutcome: 'no_answer',
    });
    expect(order.timeline.filter((e) => e.machine === 'confirmation')).toHaveLength(3);
  });

  it('cancels at the limit as no answer when the store says so', async () => {
    await run((tx) =>
      updateStoreProfile(tx, owner, { confirmation: { maxAttempts: 1, cancelUnreachable: true } }),
    );
    try {
      const v = await product();
      const phone = newPhone();
      const placed = await manualOrder(v, phone);
      expect(await outcome(placed.id, { outcome: 'no_answer' })).toMatchObject({
        status: 'cancelled',
        unreachable: true,
      });
      const order = await run((tx) => getOrder(tx, owner, placed.id));
      expect(order.cancelCode).toBe('no_answer');
      expect((await run((tx) => getPhoneRisk(tx, owner, phone))).history.noAnswer).toBe(1);
    } finally {
      await run((tx) => updateStoreProfile(tx, owner, { confirmation: {} }));
    }
  });

  it('calls back at the time chosen, with a note', async () => {
    const placed = await manualOrder(await product(), newPhone());
    await expect(outcome(placed.id, { outcome: 'call_back' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const at = new Date(Date.now() + 3 * 3_600_000).toISOString();
    const r = await outcome(placed.id, { outcome: 'call_back', dueAt: at, note: 'At work' });
    expect(r).toMatchObject({ attempts: 0, dueAt: at });
    expect((await inQueue(placed.id, 'later'))?.lastOutcome).toBe('call_back');
    const past = new Date(Date.now() - 60_000).toISOString();
    await expect(
      outcome(placed.id, { outcome: 'call_back', dueAt: past, note: 'x' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('confirms by call, and records how', async () => {
    const placed = await manualOrder(await product(), newPhone());
    expect(await outcome(placed.id, { outcome: 'confirmed' })).toMatchObject({
      status: 'confirmed',
    });
    const order = await run((tx) => getOrder(tx, owner, placed.id));
    expect(order.confirmation).toMatchObject({ inQueue: false, confirmedVia: 'call' });
    const event = await run(async (tx) => {
      const { rows } = await tx.db.execute<{ payload: { via: string } }>(
        sql`select payload from store.outbox where aggregate_id = ${placed.id} and event_type = 'order.confirmed'`,
      );
      return rows[0]?.payload;
    });
    expect(event?.via).toBe('call');
    // Staff's button says staff.
    const other = await manualOrder(await product(), newPhone());
    await run((tx) => confirmOrder(tx, owner, other.id));
    expect((await run((tx) => getOrder(tx, owner, other.id))).confirmation?.confirmedVia).toBe(
      'staff',
    );
    // An order that left the queue takes no more outcomes.
    await expect(outcome(placed.id, { outcome: 'no_answer' })).rejects.toMatchObject({
      code: 'illegal_transition',
    });
  });

  it('cancels a wrong number, blocking it when asked, and a fake order with its code', async () => {
    const v = await product();
    const phone = newPhone();
    const wrong = await manualOrder(v, phone);
    await outcome(wrong.id, { outcome: 'wrong_number', block: true });
    expect((await run((tx) => getOrder(tx, owner, wrong.id))).cancelCode).toBe('wrong_number');
    const blocked = await run(
      async (tx) =>
        (await tx.db.execute(sql`select 1 from store.blocked_phones where phone = ${phone}`)).rows,
    );
    expect(blocked).toHaveLength(1);
    // Staff without settings.write can't block, and nothing is recorded.
    const other = await manualOrder(v, newPhone());
    await expect(
      outcome(other.id, { outcome: 'wrong_number', block: true }, caller(5)),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect((await run((tx) => getOrder(tx, owner, other.id))).status).toBe('pending');

    const fake = await manualOrder(v, newPhone());
    await expect(outcome(fake.id, { outcome: 'cancelled' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await outcome(fake.id, { outcome: 'cancelled', code: 'fake', note: 'Never ordered' });
    const order = await run((tx) => getOrder(tx, owner, fake.id));
    expect(order).toMatchObject({ status: 'cancelled', cancelCode: 'fake' });
    expect(order.risk.history.fake).toBe(1);
  });

  it('auto-confirms a trusted phone when the store says so', async () => {
    const v = await product();
    const phone = newPhone();
    for (let i = 0; i < 3; i++) await delivered((await manualOrder(v, phone)).id);
    await run((tx) => updateStoreProfile(tx, owner, { confirmation: { autoConfirm: 'trusted' } }));
    try {
      const placed = await manualOrder(v, phone);
      expect(placed.status).toBe('confirmed');
      const order = await run((tx) => getOrder(tx, owner, placed.id));
      expect(order.confirmation?.confirmedVia).toBe('auto');
      expect(order.timeline.find((e) => e.event === 'confirm')?.actorType).toBe('system');
      // A new phone still waits for a call.
      expect((await manualOrder(v, newPhone())).status).toBe('pending');
    } finally {
      await run((tx) => updateStoreProfile(tx, owner, { confirmation: {} }));
    }
  });

  it('is empty when the store turns the queue off', async () => {
    await run((tx) => updateStoreProfile(tx, owner, { confirmation: { queue: false } }));
    try {
      const queue = await run((tx) => listConfirmations(tx, owner, {}));
      expect(queue).toMatchObject({ enabled: false, items: [] });
    } finally {
      await run((tx) => updateStoreProfile(tx, owner, { confirmation: {} }));
    }
  });
});

describe('the SMS link', () => {
  const KEY = 'test-link-key';
  const options = {
    trackUrl: 'https://shop.example.test/track',
    pageUrl: (path: string) => `https://shop.example.test/${path}`,
    linkKey: KEY,
    smsGateway: true,
  };
  const latestEvent = (type: string, orderId: string) =>
    run(async (tx) => {
      const { rows } = await tx.db.execute<{ id: string; payload: unknown }>(
        sql`select id, payload from store.outbox where event_type = ${type} and aggregate_id = ${orderId}
             order by created_at desc limit 1`,
      );
      const r = rows[0] as { id: string; payload: unknown };
      return {
        id: r.id,
        tenantId: store,
        eventType: type,
        aggregateType: 'order',
        aggregateId: orderId,
        payload: r.payload,
        requestId: null,
        createdAt: new Date().toISOString(),
      } as OutboxEvent;
    });
  const planFor = async (type: string, orderId: string, opts = options) => {
    const event = await latestEvent(type, orderId);
    return run((tx) => planMessages(tx, event, opts));
  };
  const linkOn = (extra: Record<string, unknown> = {}) =>
    run((tx) => updateStoreProfile(tx, owner, { confirmation: { smsLink: true, ...extra } }));
  const linkOff = () => run((tx) => updateStoreProfile(tx, owner, { confirmation: {} }));
  /** A COD order whose placed event was planned: the link's code, from the SMS. */
  async function linked(phone = newPhone()) {
    const placed = await manualOrder(await product(), phone);
    const planned = await planFor('order.placed', placed.id);
    const sms = planned.find((m) => m.event === 'confirm_request');
    const url = sms?.values.confirm_url ?? '';
    return { placed, sms, code: url.split('#')[1] ?? '' };
  }

  it('sends one SMS with a short code, stored only as its hash, the same on redelivery', async () => {
    await linkOn();
    try {
      const { placed, sms, code } = await linked();
      expect(sms).toMatchObject({ channel: 'sms', skip: null });
      expect(sms?.values.confirm_url).toMatch(/^https:\/\/shop\.example\.test\/c#[0-9A-Za-z]{10}$/);
      expect(code).toBe(await linkCode(KEY, store, placed.id, 1));
      const row = await run(async (tx) => {
        const { rows } = await tx.db.execute<{ link_hash: string; link_sends: number }>(
          sql`select link_hash, link_sends from store.order_confirmations where order_id = ${placed.id}`,
        );
        return rows[0];
      });
      expect(row).toEqual({ link_hash: await hashLinkCode(code), link_sends: 1 });
      // Planning the event again gives the same code: the SMS already sent still works.
      const again = await planFor('order.placed', placed.id);
      expect(again.find((m) => m.event === 'confirm_request')?.values.confirm_url).toBe(
        sms?.values.confirm_url,
      );
      const view = await run((tx) => linkView(tx, code));
      expect(view).toMatchObject({ displayNumber: placed.displayNumber, total: placed.total });
      expect(JSON.stringify(view)).not.toContain('House 1');
    } finally {
      await linkOff();
    }
  });

  it('sends nothing when the store has the link off, and is skipped without a gateway', async () => {
    const off = await linked();
    expect(off.sms).toBeUndefined();
    await linkOn();
    try {
      const placed = await manualOrder(await product(), newPhone());
      const planned = await planFor('order.placed', placed.id, {
        ...options,
        smsGateway: false,
      });
      expect(planned.find((m) => m.event === 'confirm_request')?.skip).toBe('no_gateway');
    } finally {
      await linkOff();
    }
  });

  it('confirms once; a second use, a wrong code and an expired one all fail the same way', async () => {
    await linkOn();
    try {
      const { placed, code } = await linked();
      expect(await run((tx) => answerLink(tx, code, 'confirm'))).toBe('confirmed');
      const order = await run((tx) => getOrder(tx, owner, placed.id));
      expect(order).toMatchObject({ status: 'confirmed', confirmation: { confirmedVia: 'link' } });
      // No "order confirmed" message for a shopper who just confirmed.
      expect(triggeredBy(await latestEvent('order.confirmed', placed.id))?.shopper).toEqual([]);
      for (const c of [code, 'AAAAAAAAAA', 'short']) {
        await expect(run((tx) => answerLink(tx, c, 'confirm'))).rejects.toMatchObject({
          code: 'not_found',
        });
        expect(await run((tx) => linkView(tx, c))).toBeNull();
      }
      const late = await linked();
      await run((tx) =>
        tx.db.execute(sql`update store.order_confirmations set link_expires_at = now() - interval '1 minute'
                          where order_id = ${late.placed.id}`),
      );
      await expect(run((tx) => answerLink(tx, late.code, 'confirm'))).rejects.toMatchObject({
        code: 'not_found',
      });
    } finally {
      await linkOff();
    }
  });

  it("notes a risky phone's confirmation and keeps it in the queue; cancels as the shopper", async () => {
    const v = await product();
    const phone = newPhone();
    // A delivery that came back: risky under Phase 5A's default.
    await cameBack((await manualOrder(v, phone)).id);
    await setFraud({ flagAfterFailed: 1 });
    await linkOn();
    try {
      const { placed, code } = await linked(phone);
      expect(await run((tx) => answerLink(tx, code, 'confirm'))).toBe('noted');
      const queue = await run((tx) => listConfirmations(tx, owner, { limit: 100 }));
      expect(queue.items.find((i) => i.orderId === placed.id)?.linkAnswer).toBe('confirm');
      expect((await run((tx) => getOrder(tx, owner, placed.id))).status).toBe('pending');

      const other = await linked();
      expect(await run((tx) => answerLink(tx, other.code, 'cancel'))).toBe('cancelled');
      const cancelled = await run((tx) => getOrder(tx, owner, other.placed.id));
      expect(cancelled).toMatchObject({ status: 'cancelled', cancelCode: 'shopper_request' });
      expect(cancelled.cancelledBy).toBe('shopper');
    } finally {
      await linkOff();
      await setFraud({});
    }
  });

  it('sends the link again twice at most, each with a new code that replaces the old', async () => {
    await linkOn();
    try {
      const { placed, code } = await linked();
      const ready = { smsReady: true };
      for (const send of [2, 3]) {
        expect(await run((tx) => resendLink(tx, owner, placed.id, ready))).toEqual({ sends: send });
        const event = await latestEvent('confirmation.link_requested', placed.id);
        const planned = await run((tx) => planMessages(tx, event, options));
        const url = planned.find((m) => m.event === 'confirm_request')?.values.confirm_url;
        expect(url?.split('#')[1]).toBe(await linkCode(KEY, store, placed.id, send));
      }
      expect(await run((tx) => linkView(tx, code))).toBeNull();
      await expect(run((tx) => resendLink(tx, owner, placed.id, ready))).rejects.toMatchObject({
        extensions: { reason: 'limit' },
      });
      await expect(
        run((tx) => resendLink(tx, owner, placed.id, { smsReady: false })),
      ).rejects.toMatchObject({ extensions: { reason: 'link_off' } });
    } finally {
      await linkOff();
    }
  });
});

describe('incomplete orders', () => {
  const setRecovery = (recovery: Record<string, unknown>) =>
    run((tx) => updateStoreProfile(tx, owner, { recovery }));
  /** A cart with an item and an area, as a shopper at checkout has. */
  async function cart(variantId: string, quantity = 1) {
    const added = await run((tx) => addToCart(tx, null, { variantId, quantity }, 'en'));
    await run((tx) => setCartArea(tx, added.token, { areaId: 513 }));
    return added.token as string;
  }
  const records = (phone: string) =>
    run(async (tx) => {
      const { rows } = await tx.db.execute<{ id: string; status: string; name: string | null }>(
        sql`select id, status, name from store.incomplete_orders where phone = ${phone} order by created_at`,
      );
      return rows;
    });
  const checkout = async (token: string, phone: string) => {
    const view = await run((tx) => setCartArea(tx, token, { areaId: 513 }));
    return run((tx) =>
      placeOrder(tx, shopperActor(), {
        channel: 'storefront',
        source: 'website',
        cartToken: token,
        contact: { name: 'Rahim', phone },
        address,
        payment: { kind: 'cod' },
        expectedTotal: view.quote.totals.total,
        locale: 'en',
      }),
    );
  };

  it('keeps one record per cart, replaced by each save, with the lines as shown', async () => {
    const v = await product(40_000);
    const token = await cart(v, 2);
    const phone = newPhone();
    expect(await run((tx) => saveCheckoutDraft(tx, token, { phone }))).toBe(true);
    await run((tx) =>
      saveCheckoutDraft(tx, token, {
        phone,
        name: 'Sumi',
        address: { divisionId: 6, districtId: 47, areaId: 513 },
      }),
    );
    expect(await records(phone)).toEqual([
      expect.objectContaining({ status: 'open', name: 'Sumi' }),
    ]);
    // Typed as 01…, stored as +880….
    const local = `0${phone.slice(4)}`;
    await run((tx) => saveCheckoutDraft(tx, token, { phone: local, name: 'Sumi' }));
    expect(await records(phone)).toHaveLength(1);
    const [rec] = await records(phone);
    const detail = await run((tx) => getIncompleteOrder(tx, owner, rec?.id as string));
    expect(detail.lines).toEqual([
      expect.objectContaining({ variantId: v, quantity: 2, price: 40_000, orderable: true }),
    ]);
    expect(detail.subtotal).toBe(80_000);
    // Without customers.read it isn't shown at all.
    await expect(
      run((tx) => getIncompleteOrder(tx, actorAs('viewer'), rec?.id as string)),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses an invalid phone, and saves nothing when the store turned it off', async () => {
    const token = await cart(await product());
    await expect(
      run((tx) => saveCheckoutDraft(tx, token, { phone: '12345' })),
    ).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await setRecovery({ incomplete: false });
    try {
      const phone = newPhone();
      expect(await run((tx) => saveCheckoutDraft(tx, token, { phone }))).toBe(false);
      expect(await records(phone)).toEqual([]);
    } finally {
      await setRecovery({});
    }
  });

  it('deletes the record on "Don\'t save" and refuses later saves from the cart', async () => {
    const token = await cart(await product());
    const phone = newPhone();
    await run((tx) => saveCheckoutDraft(tx, token, { phone }));
    await run((tx) => optOutCheckoutDraft(tx, token));
    expect(await records(phone)).toEqual([]);
    await expect(run((tx) => saveCheckoutDraft(tx, token, { phone }))).rejects.toMatchObject({
      code: 'conflict',
      extensions: { reason: 'opted_out' },
    });
  });

  it("lists a record only after the shopper stopped typing for the store's delay", async () => {
    const token = await cart(await product());
    const phone = newPhone();
    await run((tx) => saveCheckoutDraft(tx, token, { phone }));
    const listed = async () =>
      (await run((tx) => listIncompleteOrders(tx, owner, { limit: 100 }))).items.some(
        (i) => i.phone === phone,
      );
    expect(await listed()).toBe(false);
    await setRecovery({ showAfterMinutes: 0 });
    try {
      expect(await listed()).toBe(true);
    } finally {
      await setRecovery({});
    }
  });

  it('is recovered when the shopper finishes the cart, or orders from the same phone', async () => {
    const v = await product();
    const phone = newPhone();
    const token = await cart(v);
    await run((tx) => saveCheckoutDraft(tx, token, { phone }));
    const placed = await checkout(token, phone);
    expect(await records(phone)).toEqual([expect.objectContaining({ status: 'recovered' })]);
    const [rec] = await records(phone);
    expect((await run((tx) => getIncompleteOrder(tx, owner, rec?.id as string))).orderId).toBe(
      placed.id,
    );

    const other = newPhone();
    const t2 = await cart(v);
    await run((tx) => saveCheckoutDraft(tx, t2, { phone: other }));
    await manualOrder(v, other);
    expect(await records(other)).toEqual([expect.objectContaining({ status: 'recovered' })]);
  });

  it('becomes an order in one click: the manual order from its prefill is converted', async () => {
    const v = await product(30_000);
    const phone = newPhone();
    const token = await cart(v, 3);
    await run((tx) =>
      saveCheckoutDraft(tx, token, {
        phone,
        name: 'Mitu',
        address: { divisionId: 6, districtId: 47, areaId: 513, line: 'Road 7' },
      }),
    );
    const [rec] = await records(phone);
    const id = rec?.id as string;
    await run((tx) => markIncompleteContacted(tx, owner, id, { note: 'Will order tonight' }));
    const prefill = await run((tx) => incompletePrefill(tx, owner, id));
    expect(prefill).toMatchObject({
      contact: { name: 'Mitu' },
      lines: [{ variantId: v, quantity: 3 }],
      address: { areaId: 513, line: 'Road 7' },
    });
    const placed = await run((tx) =>
      createManualOrder(tx, owner, {
        source: 'phone',
        lines: prefill.lines,
        contact: { name: prefill.contact.name, phone: prefill.contact.phone },
        address: prefill.address,
        incompleteOrderId: id,
      }),
    );
    const order = await run((tx) => getOrder(tx, owner, placed.id));
    expect(order).toMatchObject({ source: 'website', metadata: { incompleteOrderId: id } });
    expect(await records(phone)).toEqual([expect.objectContaining({ status: 'converted' })]);
    // It can't be converted twice.
    await expect(
      run((tx) =>
        createManualOrder(tx, owner, {
          source: 'phone',
          lines: prefill.lines,
          contact: { name: 'Mitu', phone: prefill.contact.phone },
          address: prefill.address,
          incompleteOrderId: id,
        }),
      ),
    ).rejects.toMatchObject({ code: 'conflict' });
    await expect(run((tx) => dismissIncompleteOrder(tx, owner, id, {}))).rejects.toMatchObject({
      code: 'illegal_transition',
    });
  });

  it("goes with the customer's anonymization", async () => {
    const v = await product();
    const phone = newPhone();
    const placed = await manualOrder(v, phone);
    const t2 = await cart(v);
    await run((tx) => saveCheckoutDraft(tx, t2, { phone }));
    const order = await run((tx) => getOrder(tx, owner, placed.id));
    await run((tx) => anonymizeCustomer(tx, owner, order.customer.id));
    expect(await records(phone)).toEqual([]);
  });
});

describe('the Sales recovery report', () => {
  it("counts the queue's work, delivery by score and duplicates for the range", async () => {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());
    const before = await run((tx) => getRecoveryReport(tx, owner, { from: day, to: day }));
    const v = await product();
    const phone = newPhone();
    const a = await manualOrder(v, phone);
    await run((tx) => recordOutcome(tx, owner, a.id, { outcome: 'confirmed' }));
    await delivered(a.id);
    const b = await manualOrder(v, newPhone());
    await run((tx) => recordOutcome(tx, owner, b.id, { outcome: 'cancelled', code: 'fake' }));
    const c = await manualOrder(v, phone);
    // Same items, same phone, minutes apart: flagged.
    await manualOrder(v, phone);
    const after = await run((tx) => getRecoveryReport(tx, owner, { from: day, to: day }));
    expect(after.confirmation.confirmedBy.call - before.confirmation.confirmedBy.call).toBe(1);
    const fake = (r: typeof after) =>
      r.confirmation.cancelledBy.find((x) => x.code === 'fake')?.orders ?? 0;
    expect(fake(after) - fake(before)).toBe(1);
    expect(after.confirmation.medianMinutes).not.toBeNull();
    // Order a was placed for a new phone and delivered; b, new too, was fake.
    const band = (r: typeof after) => r.deliveryByScore.find((x) => x.band === 'new');
    expect((band(after)?.delivered ?? 0) - (band(before)?.delivered ?? 0)).toBe(1);
    expect((band(after)?.notReceived ?? 0) - (band(before)?.notReceived ?? 0)).toBe(1);
    expect(after.duplicates.flagged).toBeGreaterThan(before.duplicates.flagged);
    expect(c.id).toBeTruthy();
    await expect(
      run((tx) => getRecoveryReport(tx, actorAs('staff'), { from: day, to: day })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
