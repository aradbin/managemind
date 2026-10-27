// Purchasing (phase-8-plan §3.1–§3.3, §3.7, §10): acceptance criterion 1 (a
// PO of three lines received in two parts: stock, the weighted average a hand
// calculation gives, and the supplier's balance, with no inventory drift), a
// doubled receipt, staff receiving without costs, a market purchase paid on
// the spot, the cost history, returns restocked at their line's cost, the
// line's cost frozen at its first shipment, and the plan feature.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addToCart,
  closePurchaseOrder,
  confirmOrder,
  createGoodsReceipt,
  createProduct,
  createPurchaseOrder,
  createShipment,
  createSupplier,
  createSupplierPayment,
  createTenant,
  deletePurchaseOrder,
  deleteSupplierPayment,
  failShipment,
  getPurchaseOrder,
  getSupplier,
  inventoryDrift,
  listSuppliers,
  placeOrder,
  placePurchaseOrder,
  receive,
  reorderSuggestions,
  returnShipment,
  setCartArea,
  shipShipment,
  shopperActor,
  supplierDues,
  supplierLedger,
  systemActor,
  type TenantTx,
  updatePurchaseOrder,
  updateVariant,
  variantCostHistory,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let owner_: pg.Client;
let store: string;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000ee',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
let owner: Actor;
let staff: Actor;
let viewer: Actor;

beforeAll(async () => {
  [app, owner_] = await Promise.all([connectApp(), connectOwner()]);
  const slug = `buy${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Purchasing test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
  staff = actorAs('staff');
  viewer = actorAs('viewer');
});
afterAll(() => Promise.all([app.end(), owner_.end()]));

const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
let seq = 0;
async function variant(cost: number | null, stock = 0, threshold: number | null = null) {
  const p = await run((tx) =>
    createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: `Bought ${++seq}` } },
      variant: { price: 500_00, ...(cost !== null ? { costPrice: cost } : {}) },
    }),
  );
  const id = p.variants[0]?.id as string;
  if (threshold !== null)
    await run((tx) => updateVariant(tx, owner, id, { lowStockThreshold: threshold }));
  if (stock)
    await run((tx) => receive(tx, owner, { variantId: id, quantity: stock, reason: 'received' }));
  return id;
}
const state = (variantId: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{ on_hand: number; cost: string | null }>(sql`
      select coalesce((select sum(on_hand) from store.inventory_levels where variant_id = v.id), 0)::int as on_hand,
             v.cost_price as cost
        from store.variants v where v.id = ${variantId}`);
    const r = rows[0];
    return { onHand: r?.on_hand, cost: r?.cost === null ? null : Number(r?.cost) };
  });
const drift = () => run((tx) => inventoryDrift(tx));
const dhakaToday = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);
const supplier = (name = 'Chawkbazar Traders', openingBalance = 0) =>
  run((tx) => createSupplier(tx, owner, { name, phones: ['01711000000'], openingBalance }));

describe('acceptance criterion 1: a PO received in two parts', () => {
  it('adds the stock, moves the average as by hand, and owes the supplier the rest', async () => {
    // On hand before: a at ৳100 × 10, b none yet (no cost), c at ৳50 × 4.
    const a = await variant(100_00, 10);
    const b = await variant(null);
    const c = await variant(50_00, 4);
    const s = await supplier('Islampur Wholesale', 1_000_00);
    const order = await run((tx) =>
      createPurchaseOrder(tx, owner, {
        supplierId: s.id,
        lines: [
          { variantId: a, quantity: 20, unitCost: 130_00 },
          { variantId: b, quantity: 10, unitCost: 200_00 },
          { variantId: c, quantity: 6, unitCost: 50_00 },
        ],
        // Transport: ৳490 over ৳2,600 + ৳2,000 + ৳300 of goods.
        otherCosts: [{ label: 'Transport', amount: 490_00 }],
      }),
    );
    expect(order).toMatchObject({
      reference: expect.stringMatching(/^PO-\d{4}$/),
      status: 'draft',
      subtotal: 4_900_00,
      otherCostTotal: 490_00,
      total: 5_390_00,
    });
    await run((tx) => placePurchaseOrder(tx, owner, order.id));

    // First delivery: 10 of a and all of b. Value at the PO's costs: ৳1,300 +
    // ৳2,000 = ৳3,300 of ৳4,900, so ৳330 of the transport (10% of each line).
    const first = await run((tx) =>
      createGoodsReceipt(tx, owner, {
        purchaseOrderId: order.id,
        lines: [
          { variantId: a, quantity: 10 },
          { variantId: b, quantity: 10 },
        ],
      }),
    );
    expect(first).toMatchObject({ subtotal: 3_300_00, otherCostTotal: 330_00, total: 3_630_00 });
    // Landed: a 130 + 13 = ৳143, b 200 + 20 = ৳220.
    expect(first.lines.map((l) => [l.quantity, l.landedUnitCost])).toEqual([
      [10, 143_00],
      [10, 220_00],
    ]);
    // a: (10 × 100 + 10 × 143) / 20 = ৳121.50; b had no cost: ৳220.
    expect(await state(a)).toEqual({ onHand: 20, cost: 121_50 });
    expect(await state(b)).toEqual({ onHand: 10, cost: 220_00 });
    expect((await run((tx) => getPurchaseOrder(tx, owner, order.id))).status).toBe(
      'partially_received',
    );

    // Second delivery: the rest of a and c, with ৳100 of its own transport.
    // The PO's other ৳160 complete its ৳490.
    const second = await run((tx) =>
      createGoodsReceipt(tx, owner, {
        purchaseOrderId: order.id,
        lines: [
          { variantId: a, quantity: 10 },
          { variantId: c, quantity: 6 },
        ],
        otherCosts: [{ label: 'Rickshaw van', amount: 100_00 }],
      }),
    );
    expect(second).toMatchObject({ subtotal: 1_600_00, otherCostTotal: 260_00, total: 1_860_00 });
    // ৳260 over ৳1,300 and ৳300: a gets 211.25 → 211_25, c 48_75; per unit a
    // 130 + 21.125 = 151.125 → ৳151.13, c 50 + 8.125 → ৳58.13.
    expect(second.lines.map((l) => l.landedUnitCost)).toEqual([151_13, 58_13]);
    // a: (20 × 121.50 + 10 × 151.13) / 30 = 131.3767 → ৳131.38.
    expect(await state(a)).toEqual({ onHand: 30, cost: 131_38 });
    // c: (4 × 50 + 6 × 58.13) / 10 = 54.878 → ৳54.88.
    expect(await state(c)).toEqual({ onHand: 10, cost: 54_88 });
    expect((await run((tx) => getPurchaseOrder(tx, owner, order.id))).status).toBe('received');

    // The supplier: ৳1,000 opening + ৳3,630 + ৳1,860, less ৳4,000 paid.
    await run((tx) =>
      createSupplierPayment(tx, owner, {
        supplierId: s.id,
        paidOn: dhakaToday(),
        amount: 4_000_00,
        method: 'bkash',
        reference: 'TRX123',
      }),
    );
    expect((await run((tx) => getSupplier(tx, owner, s.id))).balance).toBe(2_490_00);
    const ledger = await run((tx) => supplierLedger(tx, owner, s.id));
    expect(ledger.entries.map((e) => [e.kind, e.amount])).toEqual([
      ['opening', 1_000_00],
      ['receipt', 3_630_00],
      ['receipt', 1_860_00],
      ['payment', -4_000_00],
    ]);
    expect(ledger.closing).toBe(2_490_00);

    // The history follows each cost to its receipt.
    const history = await run((tx) => variantCostHistory(tx, owner, a));
    expect(history.items.map((h) => [h.source, h.oldCost, h.newCost, h.onHand])).toEqual([
      ['receipt', 121_50, 131_38, 20],
      ['receipt', 100_00, 121_50, 10],
      ['manual', null, 100_00, 0],
    ]);
    expect(await drift()).toEqual([]);
  });

  it('closes a PO whose rest won’t come, and receives it no more', async () => {
    const a = await variant(10_00);
    const s = await supplier();
    const order = await run((tx) =>
      createPurchaseOrder(tx, owner, { supplierId: s.id, lines: [{ variantId: a, quantity: 5 }] }),
    );
    expect(order.lines[0]?.unitCost).toBe(10_00); // prefilled from the variant
    await run((tx) => placePurchaseOrder(tx, owner, order.id));
    await run((tx) =>
      createGoodsReceipt(tx, owner, {
        purchaseOrderId: order.id,
        lines: [{ variantId: a, quantity: 2 }],
      }),
    );
    const closed = await run((tx) => closePurchaseOrder(tx, owner, order.id));
    expect(closed).toMatchObject({
      status: 'closed',
      lines: [{ quantity: 5, receivedQuantity: 2, remaining: 3 }],
    });
    await expect(
      run((tx) =>
        createGoodsReceipt(tx, owner, {
          purchaseOrderId: order.id,
          lines: [{ variantId: a, quantity: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'illegal_transition' });
  });
});

describe('receiving', () => {
  it('writes a doubled receipt once', async () => {
    const a = await variant(20_00);
    const input = { lines: [{ variantId: a, quantity: 3, unitCost: 20_00 }] };
    const once = await run((tx) =>
      createGoodsReceipt(tx, owner, input, { idempotencyKey: `gr-${a}` }),
    );
    const twice = await run((tx) =>
      createGoodsReceipt(tx, owner, input, { idempotencyKey: `gr-${a}` }),
    );
    expect(twice.id).toBe(once.id);
    expect(await state(a)).toEqual({ onHand: 3, cost: 20_00 });
  });

  it('lets staff receive an ordered PO’s quantities, at its costs, without seeing them', async () => {
    const a = await variant(30_00);
    const s = await supplier();
    const order = await run((tx) =>
      createPurchaseOrder(tx, owner, {
        supplierId: s.id,
        lines: [{ variantId: a, quantity: 4, unitCost: 40_00 }],
      }),
    );
    await run((tx) => placePurchaseOrder(tx, owner, order.id));
    const seen = await run((tx) => getPurchaseOrder(tx, staff, order.id));
    expect(seen).not.toHaveProperty('total');
    expect(seen.lines[0]).not.toHaveProperty('unitCost');

    // Staff can't name a cost, or receive without a PO.
    await expect(
      run((tx) =>
        createGoodsReceipt(tx, staff, {
          purchaseOrderId: order.id,
          lines: [{ variantId: a, quantity: 1, unitCost: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run((tx) =>
        createGoodsReceipt(tx, staff, { lines: [{ variantId: a, quantity: 1, unitCost: 1 }] }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });

    // Five arrive though four were ordered: received, with a warning.
    const receipt = await run((tx) =>
      createGoodsReceipt(tx, staff, {
        purchaseOrderId: order.id,
        lines: [{ variantId: a, quantity: 5 }],
      }),
    );
    expect(receipt).not.toHaveProperty('total');
    expect(receipt.lines[0]).not.toHaveProperty('landedUnitCost');
    expect(receipt.warnings).toEqual([{ variantId: a, code: 'over_received', extra: 1 }]);
    expect(await state(a)).toEqual({ onHand: 5, cost: 40_00 });
    await expect(
      run((tx) =>
        createPurchaseOrder(tx, staff, {
          supplierId: s.id,
          lines: [{ variantId: a, quantity: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('receives a market purchase without a PO, paid on the spot', async () => {
    const a = await variant(null);
    const s = await supplier('Gausia Market');
    const receipt = await run((tx) =>
      createGoodsReceipt(tx, owner, {
        supplierId: s.id,
        lines: [{ variantId: a, quantity: 12, unitCost: 75_00 }],
        otherCosts: [{ label: 'CNG', amount: 60_00 }],
        payment: { amount: 600_00, method: 'cash' },
      }),
    );
    expect(receipt).toMatchObject({
      purchaseOrder: null,
      total: 960_00,
      payment: { amount: 600_00 },
    });
    expect(await state(a)).toEqual({ onHand: 12, cost: 80_00 });
    expect((await run((tx) => getSupplier(tx, owner, s.id))).balance).toBe(360_00);
    // A cost is needed when the variant has none.
    const none = await variant(null);
    await expect(
      run((tx) => createGoodsReceipt(tx, owner, { lines: [{ variantId: none, quantity: 1 }] })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('averages onto stock sold ahead at the receipt’s cost alone', async () => {
    const a = await variant(10_00);
    await run((tx) => updateVariant(tx, owner, a, { allowBackorder: true }));
    await run((tx) => receive(tx, owner, { variantId: a, quantity: 1, reason: 'received' }));
    // Sell 3 of the 1 on hand: −2.
    const { adjust } = await import('../src/inventory/service');
    await run((tx) => adjust(tx, owner, { variantId: a, quantity: -3, reason: 'correction' }));
    await run((tx) =>
      createGoodsReceipt(tx, owner, { lines: [{ variantId: a, quantity: 5, unitCost: 16_00 }] }),
    );
    expect(await state(a)).toEqual({ onHand: 3, cost: 16_00 });
  });
});

describe('purchase orders', () => {
  it('edits an ordered PO only in what isn’t received yet, and deletes only drafts', async () => {
    const a = await variant(10_00);
    const b = await variant(20_00);
    const s = await supplier();
    const other = await supplier('Another');
    const order = await run((tx) =>
      createPurchaseOrder(tx, owner, {
        supplierId: s.id,
        lines: [
          { variantId: a, quantity: 5 },
          { variantId: b, quantity: 5 },
        ],
      }),
    );
    await run((tx) => placePurchaseOrder(tx, owner, order.id));
    await expect(run((tx) => deletePurchaseOrder(tx, owner, order.id))).rejects.toMatchObject({
      code: 'illegal_transition',
    });
    await run((tx) =>
      createGoodsReceipt(tx, owner, {
        purchaseOrderId: order.id,
        lines: [{ variantId: a, quantity: 3 }],
      }),
    );
    await expect(
      run((tx) => updatePurchaseOrder(tx, owner, order.id, { supplierId: other.id })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run((tx) =>
        updatePurchaseOrder(tx, owner, order.id, { lines: [{ variantId: b, quantity: 5 }] }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run((tx) =>
        updatePurchaseOrder(tx, owner, order.id, { lines: [{ variantId: a, quantity: 2 }] }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const edited = await run((tx) =>
      updatePurchaseOrder(tx, owner, order.id, {
        lines: [{ variantId: a, quantity: 4, unitCost: 11_00 }],
        otherCosts: [{ label: 'Labour', amount: 5_00 }],
      }),
    );
    expect(edited).toMatchObject({
      lines: [{ variantId: a, quantity: 4, receivedQuantity: 3, remaining: 1, unitCost: 11_00 }],
      subtotal: 44_00,
      total: 49_00,
    });
    const draft = await run((tx) =>
      createPurchaseOrder(tx, owner, { supplierId: s.id, lines: [{ variantId: a, quantity: 1 }] }),
    );
    await run((tx) => deletePurchaseOrder(tx, owner, draft.id));
    await expect(run((tx) => getPurchaseOrder(tx, owner, draft.id))).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('suggests reordering what the supplier last delivered and is running low', async () => {
    const low = await variant(10_00, 0, 5);
    const fine = await variant(10_00, 0, 5);
    const s = await supplier('Reorder Co');
    await run((tx) =>
      createGoodsReceipt(tx, owner, {
        supplierId: s.id,
        lines: [
          { variantId: low, quantity: 3, unitCost: 10_00 },
          { variantId: fine, quantity: 20, unitCost: 10_00 },
        ],
      }),
    );
    const lines = await run((tx) => reorderSuggestions(tx, owner, s.id));
    // Back to twice the threshold: 2 × 5 − 3 = 7.
    expect(lines.map((l) => [l.variantId, l.available, l.quantity])).toEqual([[low, 3, 7]]);
  });
});

describe('payments and dues', () => {
  it('ages what is owed oldest first, and audits a deleted payment', async () => {
    const a = await variant(10_00);
    const s = await supplier('Ageing Ltd', 500_00);
    await run((tx) =>
      createGoodsReceipt(tx, owner, {
        supplierId: s.id,
        receivedOn: '2026-07-01',
        lines: [{ variantId: a, quantity: 30, unitCost: 10_00 }],
      }),
    );
    const payment = await run((tx) =>
      createSupplierPayment(tx, owner, {
        supplierId: s.id,
        paidOn: '2026-10-01',
        amount: 600_00,
        method: 'cash',
      }),
    );
    const due = (await run((tx) => supplierDues(tx, owner, '2026-10-26'))).find(
      (d) => d.supplierId === s.id,
    );
    // The ৳500 opening is paid first, then ৳100 of July's ৳300: the ৳200 left
    // is 117 days old on Oct 26, over 90.
    expect(due).toMatchObject({ balance: 200_00, buckets: { over_90: 200_00, '0_30': 0 } });
    await run((tx) => deleteSupplierPayment(tx, owner, payment.id));
    expect((await run((tx) => getSupplier(tx, owner, s.id))).balance).toBe(800_00);
    const { rows } = await run((tx) =>
      tx.db.execute<{ before: { amount: number } }>(sql`
        select before from store.audit_log where action = 'supplier_payment.deleted' and entity_id = ${payment.id}`),
    );
    expect(rows[0]?.before.amount).toBe(600_00);
  });

  it('keeps balances from those without purchasing.pay', async () => {
    const s = await supplier('Hidden');
    const seen = await run((tx) => getSupplier(tx, staff, s.id));
    expect(seen).not.toHaveProperty('balance');
    await expect(run((tx) => supplierLedger(tx, staff, s.id))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(run((tx) => createSupplier(tx, viewer, { name: 'Nope' }))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(
      (await run((tx) => listSuppliers(tx, viewer, { q: 'hidd' }))).items.map((x) => x.name),
    ).toEqual(['Hidden']);
  });
});

/** An order of `quantity` units of `variantId`, confirmed and shipped. */
async function shippedOrder(variantId: string, quantity: number) {
  let token: string | null = null;
  const r = await run((tx) => addToCart(tx, token, { variantId, quantity }, 'en'));
  token = r.token ?? token;
  const cart = await run((tx) => setCartArea(tx, token, { areaId: 513 }));
  const placed = await run((tx) =>
    placeOrder(tx, shopperActor(), {
      channel: 'storefront',
      source: 'website',
      cartToken: token,
      contact: { name: 'Rahim', phone: '+8801712345678' },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
      payment: { kind: 'cod' },
      expectedTotal: cart.quote.totals.total,
      locale: 'en',
    }),
  );
  await run((tx) => confirmOrder(tx, owner, placed.id));
  const { rows } = await run((tx) =>
    tx.db.execute<{ id: string }>(
      sql`select id from store.order_lines where order_id = ${placed.id}`,
    ),
  );
  const shipment = await run((tx) =>
    createShipment(tx, owner, placed.id, { lines: [{ orderLineId: rows[0]?.id, quantity }] }),
  );
  return { orderId: placed.id, lineId: rows[0]?.id as string, shipmentId: shipment.id };
}
const lineCost = (lineId: string) =>
  run(async (tx) => {
    const { rows } = await tx.db.execute<{ cost: string | null }>(
      sql`select cost_price as cost from store.order_lines where id = ${lineId}`,
    );
    return rows[0]?.cost === null ? null : Number(rows[0]?.cost);
  });

describe('orders and the average (§3.3, Q10)', () => {
  it('freezes the line’s cost at its first shipment, and restocks a failed delivery at it', async () => {
    const a = await variant(100_00, 10);
    const order = await shippedOrder(a, 2);
    // Bought between placement and shipping: 10 more at ৳160 → ৳130.
    await run((tx) =>
      createGoodsReceipt(tx, owner, { lines: [{ variantId: a, quantity: 10, unitCost: 160_00 }] }),
    );
    expect(await state(a)).toEqual({ onHand: 20, cost: 130_00 });
    await run((tx) => shipShipment(tx, owner, order.shipmentId));
    expect(await lineCost(order.lineId)).toBe(130_00);

    // Then 18 at ৳130; a receipt of 2 at ৳40 → (18 × 130 + 2 × 40) / 20 = ৳121.
    await run((tx) =>
      createGoodsReceipt(tx, owner, { lines: [{ variantId: a, quantity: 2, unitCost: 40_00 }] }),
    );
    expect(await state(a)).toEqual({ onHand: 20, cost: 121_00 });
    // The 2 come back at ৳130: (20 × 121 + 2 × 130) / 22 = ৳121.82.
    await run((tx) => failShipment(tx, owner, order.shipmentId, { reason: 'refused' }));
    await run((tx) => returnShipment(tx, owner, order.shipmentId));
    expect(await state(a)).toEqual({ onHand: 22, cost: 121_82 });
    const history = await run((tx) => variantCostHistory(tx, owner, a));
    expect(history.items[0]).toMatchObject({ source: 'return', referenceType: 'shipment' });
    const { rows } = await run((tx) =>
      tx.db.execute<{ unit_cost: string }>(sql`
        select unit_cost from store.stock_movements
         where reference_id = ${order.shipmentId} and type = 'return'`),
    );
    expect(rows.map((r) => Number(r.unit_cost))).toEqual([130_00]);
    expect(await drift()).toEqual([]);
  });

  it('values an adjustment at the variant’s cost, and records a hand correction', async () => {
    const a = await variant(25_00, 4);
    const { adjust } = await import('../src/inventory/service');
    await run((tx) => adjust(tx, owner, { variantId: a, quantity: -1, reason: 'damaged' }));
    const { rows } = await run((tx) =>
      tx.db.execute<{ unit_cost: string }>(sql`
        select unit_cost from store.stock_movements where variant_id = ${a} and type = 'adjustment'`),
    );
    expect(rows.map((r) => Number(r.unit_cost))).toEqual([25_00]);
    await run((tx) => updateVariant(tx, owner, a, { costPrice: 27_00 }));
    const history = await run((tx) => variantCostHistory(tx, owner, a));
    expect(history.items[0]).toMatchObject({
      source: 'manual',
      oldCost: 25_00,
      newCost: 27_00,
      onHand: 3,
    });
    await expect(run((tx) => variantCostHistory(tx, staff, a))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('the plan feature (Q13)', () => {
  it('refuses purchasing to a plan without the back office', async () => {
    await owner_.query(
      `update platform.tenants set entitlements = jsonb_build_object(
         'limits', '{"products":null,"staff":null,"ordersPerMonth":null,"emailsPerMonth":null,"storageMb":null,"customDomains":null}'::jsonb,
         'features', '{"sslcommerz":true,"sms":true,"shopperAccounts":true,"promotionCoupons":true,"promotionAutomatic":true,"promotionBuyXGetY":true,"promotionFreeDelivery":true,"reports":true,"customEmailKey":true,"backOffice":false}'::jsonb)
        where id = $1`,
      [store],
    );
    try {
      await expect(run((tx) => listSuppliers(tx, owner))).rejects.toMatchObject({
        code: 'feature_not_in_plan',
      });
    } finally {
      await owner_.query(`update platform.tenants set entitlements = '{}' where id = $1`, [store]);
    }
  });
});
