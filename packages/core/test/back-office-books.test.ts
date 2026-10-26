// The back office's other reports (phase-8-plan §3.8, §10), each against a
// hand-computed fixture: stock valuation today and at a past month's end,
// by location and category with negative stock apart; slow movers; supplier
// dues and purchases; expenses by category and month; and COD outstanding
// with couriers and with the store's own riders.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addToCart,
  codOutstanding,
  confirmOrder,
  createCategory,
  createExpense,
  createGoodsReceipt,
  createProduct,
  createShipment,
  createSupplier,
  createSupplierPayment,
  createTenant,
  deliverShipment,
  expenseReport,
  listExpenseCategories,
  placeOrder,
  receive,
  setCartArea,
  shipShipment,
  shopperActor,
  slowMovers,
  stockValuation,
  supplierReport,
  systemActor,
  type TenantTx,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let su: pg.Client;
let store: string;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000f7',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
let owner: Actor;
const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);
const dhakaToday = () => new Date(Date.now() + 6 * 3_600_000).toISOString().slice(0, 10);

let seq = 0;
async function variant(cost: number | null, stock: number, categoryIds: string[] = []) {
  const p = await run((tx) =>
    createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: `Book ${++seq}` } },
      variant: { price: 500_00, ...(cost !== null ? { costPrice: cost } : {}) },
      ...(categoryIds.length ? { categoryIds } : {}),
    }),
  );
  const id = p.variants[0]?.id as string;
  if (stock)
    await run((tx) => receive(tx, owner, { variantId: id, quantity: stock, reason: 'received' }));
  return id;
}

let a: string;
let b: string;
let c: string;
let sarees: string;
let supplierId: string;

beforeAll(async () => {
  [app, su] = await Promise.all([connectApp(), connectOwner()]);
  const slug = `bks${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Books test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
  sarees = (
    await run((tx) => createCategory(tx, owner, { translations: { en: { name: 'Sarees' } } }))
  ).id;
  // a: 10 at ৳300, in Sarees; b: 4 without a cost; c: 2 below zero at ৳50.
  a = await variant(300_00, 10, [sarees]);
  b = await variant(null, 4);
  c = await variant(50_00, 1);
  await su.query(
    `update store.inventory_levels set on_hand = -2 where tenant_id = $1 and variant_id = $2`,
    [store, c],
  );
  // A supplier opened at ৳500 owed; 2 more of a received at ৳300 (৳600) and ৳200 paid.
  supplierId = (
    await run((tx) =>
      createSupplier(tx, owner, { name: 'Tangail Weavers', phones: [], openingBalance: 500_00 }),
    )
  ).id;
  await run((tx) =>
    createGoodsReceipt(tx, owner, {
      supplierId,
      lines: [{ variantId: a, quantity: 2, unitCost: 300_00 }],
    }),
  );
  await run((tx) =>
    createSupplierPayment(tx, owner, {
      supplierId,
      paidOn: dhakaToday(),
      amount: 200_00,
      method: 'cash',
    }),
  );
});
afterAll(() => Promise.all([app.end(), su.end()]));

describe('stock valuation', () => {
  it('values on hand above zero at the cost now, with negative stock apart', async () => {
    const v = await run((tx) => stockValuation(tx, owner, {}));
    expect(v.asOf).toBe(dhakaToday());
    expect(v.items.map((r) => [r.variantId, r.onHand, r.unitCost, r.value])).toEqual([
      [a, 12, 300_00, 3_600_00],
      [b, 4, null, 0],
    ]);
    expect(v.negative.map((r) => [r.variantId, r.onHand, r.value])).toEqual([[c, -2, 0]]);
    expect(v.totals).toEqual({ units: 16, value: 3_600_00, missingCostUnits: 4 });
    expect(v.byLocation).toEqual([
      expect.objectContaining({ units: 16, value: 3_600_00, location: expect.any(String) }),
    ]);
    expect(v.byCategory.map((g) => [g.category?.en ?? null, g.units, g.value])).toEqual([
      ['Sarees', 12, 3_600_00],
      [null, 4, 0],
    ]);
  });

  it('reads a past month from its month-end values', async () => {
    const { rows } = await su.query<{ id: string }>(
      `select location_id as id from store.inventory_levels where tenant_id = $1 and variant_id = $2`,
      [store, a],
    );
    await su.query(
      `insert into store.monthly_stock_values (tenant_id, month, variant_id, location_id, on_hand, unit_cost, value)
       values ($1, '2026-09-30', $2, $3, 8, 29000, 232000)`,
      [store, a, rows[0]?.id],
    );
    const v = await run((tx) => stockValuation(tx, owner, { month: '2026-09' }));
    expect(v).toMatchObject({
      asOf: '2026-09-30',
      month: '2026-09',
      totals: { units: 8, value: 2_320_00, missingCostUnits: 0 },
      negative: [],
    });
    expect(v.months).toContain('2026-09-30');
  });

  it('needs the cost permission', async () => {
    await expect(run((tx) => stockValuation(tx, actorAs('viewer'), {}))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});

describe('slow movers', () => {
  it('lists what is on hand without a sale, largest value first; values only with cost', async () => {
    const owners = await run((tx) => slowMovers(tx, owner, {}));
    expect(owners.days).toBe(60);
    expect(owners.items.map((r) => [r.variantId, r.onHand, r.value, r.lastSoldAt])).toEqual([
      [a, 12, 3_600_00, null],
      [b, 4, 0, null],
    ]);
    const viewers = await run((tx) => slowMovers(tx, actorAs('viewer'), { days: '30' }));
    expect(viewers.days).toBe(30);
    expect(viewers.items[0]).not.toHaveProperty('value');
  });
});

describe('suppliers', () => {
  it('ages what is owed and totals the range’s purchases and payments', async () => {
    const today = dhakaToday();
    const r = await run((tx) =>
      supplierReport(tx, owner, { from: `${today.slice(0, 8)}01`, to: today }),
    );
    // ৳500 + ৳600 − ৳200, all of it recent.
    expect(r.dues).toEqual([expect.objectContaining({ supplierId, balance: 900_00 })]);
    expect(r.duesTotal).toEqual({
      balance: 900_00,
      buckets: { '0_30': 900_00, '31_60': 0, '61_90': 0, over_90: 0 },
    });
    expect(r.purchases).toEqual([
      { supplierId, name: 'Tangail Weavers', receipts: 1, received: 600_00, paid: 200_00 },
    ]);
    await expect(
      run((tx) => supplierReport(tx, actorAs('viewer'), { from: today, to: today })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('expenses', () => {
  it('totals by category and month, with empty months kept', async () => {
    const cats = await run((tx) => listExpenseCategories(tx, owner));
    const id = (key: string) => cats.find((x) => x.key === key)?.id as string;
    for (const [spentOn, key, amount] of [
      ['2026-06-05', 'rent', 1_000_00],
      ['2026-08-05', 'rent', 1_000_00],
      ['2026-08-20', 'ads', 300_00],
    ] as const) {
      await run((tx) =>
        createExpense(tx, owner, { spentOn, categoryId: id(key), amount, method: 'cash' }),
      );
    }
    const r = await run((tx) =>
      expenseReport(tx, actorAs('viewer'), { from: '2026-06-01', to: '2026-08-31' }),
    );
    expect(r.months).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(r.categories.map((x) => [x.name.en, x.amounts, x.total])).toEqual([
      ['Rent', [1_000_00, 0, 1_000_00], 2_000_00],
      ['Facebook and online ads', [0, 0, 300_00], 300_00],
    ]);
    expect(r.monthTotals).toEqual([1_000_00, 0, 1_300_00]);
    expect(r.total).toBe(2_300_00);
    await expect(
      run((tx) => expenseReport(tx, actorAs('staff'), { from: '2026-06-01', to: '2026-08-31' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

/** A confirmed COD order of one unit, shipped and delivered `daysAgo` days back. */
async function deliveredCod(variantId: string, daysAgo: number, cashCollected: boolean) {
  let token: string | null = null;
  const r = await run((tx) => addToCart(tx, token, { variantId, quantity: 1 }, 'en'));
  token = r.token ?? token;
  const cart = await run((tx) => setCartArea(tx, token, { areaId: 513 }));
  const placed = await run((tx) =>
    placeOrder(tx, shopperActor(), {
      channel: 'storefront',
      source: 'website',
      cartToken: token,
      contact: { name: 'Salma', phone: `+88017123456${20 + seq++}` },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 4' },
      payment: { kind: 'cod' },
      expectedTotal: cart.quote.totals.total,
      locale: 'en',
    }),
  );
  await run((tx) => confirmOrder(tx, owner, placed.id));
  const { rows } = await su.query<{ id: string; total: string }>(
    `select l.id, o.total from store.order_lines l join store.orders o on o.id = l.order_id
      where l.order_id = $1`,
    [placed.id],
  );
  const s = await run((tx) =>
    createShipment(tx, owner, placed.id, { lines: [{ orderLineId: rows[0]?.id, quantity: 1 }] }),
  );
  await run((tx) => shipShipment(tx, owner, s.id));
  await run((tx) => deliverShipment(tx, owner, s.id, { cashCollected }));
  await su.query(
    `update store.shipments set delivered_at = now() - make_interval(days => $2) where id = $1`,
    [s.id, daysAgo],
  );
  return { shipmentId: s.id, total: Number(rows[0]?.total) };
}

describe('COD outstanding', () => {
  it('ages what couriers haven’t paid out, net of fees, and what the own riders hold', async () => {
    const d = await variant(100_00, 5);
    // Steadfast: ৳1,000 collected 10 days ago less ৳60, and one parcel already paid out.
    const owed = await deliveredCod(d, 10, true);
    const paid = await deliveredCod(d, 2, true);
    await su.query(
      `update store.shipments set courier = 'steadfast', cod_amount = 100000, cod_collected = 100000,
              courier_fee = 6000 where id = any($1::uuid[])`,
      [[owed.shipmentId, paid.shipmentId]],
    );
    const { rows } = await su.query<{ id: string }>(
      `insert into store.courier_payouts (tenant_id, courier, reference, paid_at, amount, source)
       values ($1, 'steadfast', 'PAY-1', now(), 94000, 'manual') returning id`,
      [store],
    );
    await su.query(
      `insert into store.courier_payout_lines (tenant_id, payout_id, shipment_id, collected, fee, net)
       values ($1, $2, $3, 100000, 6000, 94000)`,
      [store, rows[0]?.id, paid.shipmentId],
    );
    // An own rider delivered 3 days ago, and nobody marked the cash received.
    const rider = await deliveredCod(d, 3, false);

    const r = await run((tx) => codOutstanding(tx, owner));
    expect(r.holders).toEqual([
      {
        courier: 'steadfast',
        parcels: 1,
        amount: 940_00,
        buckets: { '0_7': 0, '8_14': 940_00, '15_30': 0, over_30: 0 },
        oldestDays: 10,
      },
      {
        courier: null,
        parcels: 1,
        amount: rider.total,
        buckets: { '0_7': rider.total, '8_14': 0, '15_30': 0, over_30: 0 },
        oldestDays: 3,
      },
    ]);
    expect(r.total).toBe(940_00 + rider.total);
  });
});
