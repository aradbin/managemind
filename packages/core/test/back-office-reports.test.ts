// The back office's reports (phase-8-plan §3.8, §3.9, §10): a hand-computed
// fixture over three Dhaka days (a line shipped in two parts, its discount
// shared so the parts add up; a sale without a cost; a failed delivery; a
// return; a refund without one; a loss; an expense), the summary tables
// equal to the live figures, month-end stock values, and who may see profit.
import { permissionsOf, type StoreRole } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addToCart,
  confirmOrder,
  createExpense,
  createProduct,
  createRefund,
  createReturn,
  createShipment,
  createTenant,
  dailyFacts,
  dashboard,
  deliverShipment,
  failShipment,
  listExpenseCategories,
  listOrders,
  monthToDateProfit,
  moveReturn,
  placeOrder,
  productsReport,
  productTotals,
  profitReport,
  receive,
  refreshStoreReports,
  refreshSummaries,
  returnShipment,
  salesReport,
  setCartArea,
  shipShipment,
  shopperActor,
  systemActor,
  type TenantTx,
  updateVariant,
  withTenant,
  writeMonthEndValues,
} from '../src';
import { adjust } from '../src/inventory/service';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let su: pg.Client;
let store: string;
const actorAs = (role: StoreRole): Actor => ({
  kind: 'user',
  userId: '0199d000-0000-7000-8000-0000000000f6',
  platformRole: null,
  permissions: permissionsOf(role),
  tenantId: store,
  storeRole: role,
});
let owner: Actor;
const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, store, fn);

let seq = 0;
async function variant(price: number, cost: number | null, stock: number) {
  const p = await run((tx) =>
    createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: `Sold ${++seq}` } },
      variant: { price, ...(cost !== null ? { costPrice: cost } : {}) },
    }),
  );
  const id = p.variants[0]?.id as string;
  await run((tx) => receive(tx, owner, { variantId: id, quantity: stock, reason: 'received' }));
  return id;
}

async function order(variantId: string, quantity: number, phone: string) {
  let token: string | null = null;
  const r = await run((tx) => addToCart(tx, token, { variantId, quantity }, 'en'));
  token = r.token ?? token;
  const cart = await run((tx) => setCartArea(tx, token, { areaId: 513 }));
  const placed = await run((tx) =>
    placeOrder(tx, shopperActor(), {
      channel: 'storefront',
      source: 'website',
      cartToken: token,
      contact: { name: 'Karim', phone },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 9' },
      payment: { kind: 'cod' },
      expectedTotal: cart.quote.totals.total,
      locale: 'en',
    }),
  );
  await run((tx) => confirmOrder(tx, owner, placed.id));
  const { rows } = await su.query<{ id: string; fee: string }>(
    `select l.id, o.delivery_fee - o.delivery_discount as fee
       from store.order_lines l join store.orders o on o.id = l.order_id where l.order_id = $1`,
    [placed.id],
  );
  return { id: placed.id, lineId: rows[0]?.id as string, fee: Number(rows[0]?.fee) };
}

/** Ships `quantity` of the line and delivers it at `at`, with the courier's fee. */
async function deliver(
  o: { id: string; lineId: string },
  quantity: number,
  at: string,
  fee: number | null,
) {
  const s = await run((tx) =>
    createShipment(tx, owner, o.id, { lines: [{ orderLineId: o.lineId, quantity }] }),
  );
  await run((tx) => shipShipment(tx, owner, s.id));
  await run((tx) => deliverShipment(tx, owner, s.id, { cashCollected: true }));
  await su.query(`update store.shipments set delivered_at = $2, courier_fee = $3 where id = $1`, [
    s.id,
    at,
    fee,
  ]);
  return s.id;
}

const D1 = '2026-09-01';
const D2 = '2026-09-02';
const D3 = '2026-09-03';
let a: string;
let b: string;
let fees: number;
const orders: string[] = [];

beforeAll(async () => {
  [app, su] = await Promise.all([connectApp(), connectOwner()]);
  const slug = `rep${Date.now().toString(36)}`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Reports test',
      defaultLocale: 'en',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    })
  ).id;
  owner = actorAs('owner');
  a = await variant(500_00, 300_00, 20);
  b = await variant(200_00, null, 5);

  // Order 1: three of a with ৳10 off the line, delivered two on D1 and one on D2.
  const o1 = await order(a, 3, '+8801712345611');
  await su.query(
    `update store.order_lines set discount_total = 1000, line_total = line_subtotal - 1000 where id = $1`,
    [o1.lineId],
  );
  await deliver(o1, 2, `${D1}T12:00:00+06:00`, 60_00);
  await deliver(o1, 1, `${D2}T10:00:00+06:00`, 60_00);
  // Order 2: one of b, which has no cost, at 23:30 in Dhaka: still D1.
  const o2 = await order(b, 1, '+8801712345612');
  await deliver(o2, 1, `${D1}T23:30:00+06:00`, null);
  fees = o1.fee + o2.fee;

  // Order 3: one of a that came back on D2, costing ৳50; restocked at its line's cost.
  const o3 = await order(a, 1, '+8801712345613');
  orders.push(o1.id, o2.id, o3.id);
  const s3 = await run((tx) =>
    createShipment(tx, owner, o3.id, { lines: [{ orderLineId: o3.lineId, quantity: 1 }] }),
  );
  await run((tx) => shipShipment(tx, owner, s3.id));
  await run((tx) => failShipment(tx, owner, s3.id, { reason: 'refused' }));
  await run((tx) => returnShipment(tx, owner, s3.id, { returnCost: 50_00 }));
  await su.query(`update store.shipments set returned_at = $2 where id = $1`, [
    s3.id,
    `${D2}T15:00:00+06:00`,
  ]);

  // One of order 1's units returned on D3; ৳20 refunded on order 2 without a return.
  const ret = await run((tx) =>
    createReturn(tx, owner, {
      orderId: o1.id,
      reason: 'changed_mind',
      lines: [{ orderLineId: o1.lineId, quantity: 1 }],
    }),
  );
  await run((tx) => moveReturn(tx, owner, ret.id, 'receive'));
  await su.query(`update store.returns set received_at = $2 where id = $1`, [
    ret.id,
    `${D3}T11:00:00+06:00`,
  ]);
  // (An edit after delivery took ৳20 off order 2, leaving it overpaid.)
  await su.query(`update store.orders set total = total - 2000 where id = $1`, [o2.id]);
  const refund = await run((tx) => createRefund(tx, owner, o2.id, { method: 'cash' }));
  expect(refund.amount).toBe(20_00);
  await su.query(`update store.refunds set processed_at = $2 where id = $1`, [
    refund.id,
    `${D3}T12:00:00+06:00`,
  ]);

  // One of a damaged on D2, at its cost; ৳1,000 of rent on D1.
  await run((tx) => adjust(tx, owner, { variantId: a, quantity: -1, reason: 'damaged' }));
  await su.query(
    `update store.stock_movements set created_at = $2
      where tenant_id = $1 and type = 'adjustment' and reason = 'damaged'`,
    [store, `${D2}T09:00:00+06:00`],
  );
  const rent = (await run((tx) => listExpenseCategories(tx, owner))).find((c) => c.key === 'rent');
  await run((tx) =>
    createExpense(tx, owner, {
      spentOn: D1,
      categoryId: rent?.id as string,
      amount: 1_000_00,
      method: 'cash',
    }),
  );
});
afterAll(() => Promise.all([app.end(), su.end()]));

describe('the hand-computed fixture', () => {
  it('books each fact on its own day, with the discount shared so the parts add up', async () => {
    const days = await run((tx) => dailyFacts(tx, D1, D3, { live: true }));
    expect(days.map((d) => d.day)).toEqual([D1, D2, D3]);
    const [d1, d2, d3] = days;
    // D1: two of a (৳1,000, ৳6.67 of the ৳10 off) and one of b (no cost).
    expect(d1).toMatchObject({
      ordersDelivered: 2,
      units: 3,
      grossSales: 1_200_00,
      discounts: 6_67,
      netSales: 1_193_33,
      deliveryIncome: fees,
      courierFees: 60_00,
      cogs: 600_00,
      missingCostUnits: 1,
      failedDeliveryCosts: 0,
      stockLosses: 0,
    });
    // D2: the third of a with the rest of the discount, the failed delivery, the loss.
    expect(d2).toMatchObject({
      ordersDelivered: 0,
      units: 1,
      grossSales: 500_00,
      discounts: 3_33,
      netSales: 496_67,
      deliveryIncome: 0,
      courierFees: 60_00,
      failedDeliveryCosts: 50_00,
      cogs: 300_00,
      stockLosses: 300_00,
    });
    // D3: one of a back at a third of ৳1,490, and ৳20 refunded without a return.
    const { rows } = await su.query<{ delivery: string }>(
      `select delivery_amount as delivery from store.refunds where tenant_id = $1`,
      [store],
    );
    // An overpaid edit's refund gives no delivery back.
    expect(Number(rows[0]?.delivery)).toBe(0);
    expect(d3).toMatchObject({
      units: 0,
      returnedUnits: 1,
      returns: 496_67 + 20_00,
      returnedCogs: 300_00,
      deliveryIncome: 0,
    });
  });

  it('states the profit as by hand, beside the days before', async () => {
    const { current, previous } = await run((tx) => profitReport(tx, owner, { from: D1, to: D3 }));
    const returns = 496_67 + 20_00;
    const deliveryResult = fees - 120_00 - 50_00;
    expect(current).toMatchObject({
      netSales: 1_690_00,
      returns,
      cogs: 600_00,
      grossProfit: 1_690_00 - returns - 600_00,
      deliveryResult,
      stockLosses: 300_00,
      expenses: 1_000_00,
      netProfit: 1_690_00 - returns - 600_00 + deliveryResult - 300_00 - 1_000_00,
      missingCostUnits: 1,
      ordersDelivered: 2,
    });
    expect(current.expensesByCategory).toEqual([
      expect.objectContaining({ amount: 1_000_00, name: expect.objectContaining({ en: 'Rent' }) }),
    ]);
    expect(previous).toMatchObject({ from: '2026-08-29', to: '2026-08-31', netProfit: 0 });
  });

  it('totals sales by week and month, and products best seller first', async () => {
    const weekly = await run((tx) => salesReport(tx, owner, { from: D1, to: D3, by: 'week' }));
    // 1 September 2026 is a Tuesday: its week starts on Monday the 31st.
    expect(weekly.buckets.map((x) => x.start)).toEqual(['2026-08-31']);
    expect(weekly.totals).toMatchObject({ units: 4, netSales: 1_690_00, returnedUnits: 1 });
    const products = await run((tx) => productsReport(tx, owner, { from: D1, to: D3 }));
    expect(products.items.map((x) => [x.variantId, x.units, x.netSales])).toEqual([
      [a, 3, 1_490_00],
      [b, 1, 200_00],
    ]);
    expect(products.items[0]).toMatchObject({
      returns: 496_67,
      cogs: 600_00,
      grossProfit: 1_490_00 - 496_67 - 600_00,
      marginBp: Math.round(((1_490_00 - 496_67 - 600_00) * 10_000) / (1_490_00 - 496_67)),
    });
    expect(products.items[1]).toMatchObject({ missingCostUnits: 1, cogs: 0 });
  });
});

describe('per order and on the dashboard', () => {
  it('gives each order its gross profit, adding up to the statement’s', async () => {
    const list = await run((tx) => listOrders(tx, owner, {}));
    const byId = new Map(list.items.map((o) => [o.id, o]));
    // Order 1: ৳1,490 delivered − ৳496.67 back − 2 kept × ৳300.
    expect(byId.get(orders[0] as string)).toMatchObject({
      grossProfit: 1_490_00 - 496_67 - 600_00,
      missingCostUnits: 0,
    });
    // Order 2: ৳200 less the ৳20 refunded, with no cost to take off.
    expect(byId.get(orders[1] as string)).toMatchObject({
      grossProfit: 180_00,
      missingCostUnits: 1,
    });
    // Order 3 was never delivered.
    expect(byId.get(orders[2] as string)?.grossProfit).toBeNull();
    const { current } = await run((tx) => profitReport(tx, owner, { from: D1, to: D3 }));
    expect(1_490_00 - 496_67 - 600_00 + 180_00).toBe(current.grossProfit);

    const staffList = await run((tx) => listOrders(tx, actorAs('staff'), {}));
    expect(staffList.items[0]).not.toHaveProperty('grossProfit');
  });

  it('shows the month so far on the dashboard', async () => {
    const month = await run((tx) => monthToDateProfit(tx, D3));
    const { current } = await run((tx) => profitReport(tx, owner, { from: D1, to: D3 }));
    expect(month).toEqual({
      grossProfit: current.grossProfit,
      expenses: 1_000_00,
      netProfit: current.netProfit,
      missingCostUnits: 1,
    });
    expect((await run((tx) => dashboard(tx, actorAs('staff')))).profit).toBeNull();
    expect((await run((tx) => dashboard(tx, owner))).profit).toMatchObject({ missingCostUnits: 0 });
  });
});

describe('the summary tables (§3.9)', () => {
  it('hold the same figures as the live SQL, and the reports read them', async () => {
    await run((tx) => refreshSummaries(tx, D1, D3));
    const stored = await run((tx) => dailyFacts(tx, D1, D3));
    const live = await run((tx) => dailyFacts(tx, D1, D3, { live: true }));
    expect(stored).toEqual(live);
    const { rows } = await su.query<{ n: number }>(
      `select count(*)::int as n from store.daily_sales where tenant_id = $1`,
      [store],
    );
    expect(rows[0]?.n).toBe(3);
    const byProduct = (live: boolean) =>
      run(async (tx) =>
        (await productTotals(tx, D1, D3, { live })).sort((x, y) =>
          x.variantId < y.variantId ? -1 : 1,
        ),
      );
    expect(await byProduct(false)).toEqual(await byProduct(true));

    // A summary row is what the report reads: change it and the report follows.
    await su.query(
      `update store.daily_sales set net_sales = net_sales + 1 where tenant_id = $1 and day = $2`,
      [store, D2],
    );
    const report = await run((tx) => salesReport(tx, owner, { from: D1, to: D3 }));
    expect(report.totals.netSales).toBe(1_690_01);
    await run((tx) => refreshSummaries(tx, D2, D2));
    expect((await run((tx) => salesReport(tx, owner, { from: D1, to: D3 }))).totals.netSales).toBe(
      1_690_00,
    );
  });

  it('redoes an older day in the nightly refresh when its courier fee came late', async () => {
    await su.query(
      `update store.shipments set courier_fee = 7000
        where tenant_id = $1 and courier_fee is null and delivered_at is not null`,
      [store],
    );
    const before = await run((tx) => dailyFacts(tx, D1, D1));
    expect(before[0]?.courierFees).toBe(60_00);
    // The week before, and D1–D3: this fixture moved all their dates today.
    expect(await run((tx) => refreshStoreReports(tx, '2026-10-26'))).toEqual({ days: 10 });
    expect((await run((tx) => dailyFacts(tx, D1, D1)))[0]?.courierFees).toBe(130_00);
  });

  it('values the stock at a month’s end at the cost then', async () => {
    // The stock and its costs arrived in mid-August; everything else happened after.
    await su.query(
      `update store.stock_movements set created_at = '2026-08-15T10:00:00+06:00'
        where tenant_id = $1 and type = 'receive' and reference_type is null`,
      [store],
    );
    await su.query(
      `update store.cost_changes set created_at = '2026-08-15T10:00:00+06:00' where tenant_id = $1`,
      [store],
    );
    // a's cost changes today: August's value stays at the ৳300 it had then.
    await run((tx) => updateVariant(tx, owner, a, { costPrice: 320_00 }));
    expect(await run((tx) => writeMonthEndValues(tx, '2026-08-01'))).toBe(2);
    const values = async (month: string) => {
      const { rows } = await su.query<{
        variant_id: string;
        on_hand: number;
        unit_cost: string | null;
        value: string;
      }>(
        `select variant_id, on_hand, unit_cost, value from store.monthly_stock_values
          where tenant_id = $1 and month = $2`,
        [store, month],
      );
      return Object.fromEntries(
        rows.map((r) => [
          r.variant_id,
          [r.on_hand, r.unit_cost === null ? null : Number(r.unit_cost), Number(r.value)],
        ]),
      );
    };
    // All of it on hand then; b had no cost, so no value.
    expect(await values('2026-08-31')).toEqual({ [a]: [20, 300_00, 6_000_00], [b]: [5, null, 0] });
    // This month: 20 − 3 delivered − 1 damaged (the failed one came back, the
    // return isn't inspected), at the cost now.
    expect(await run((tx) => writeMonthEndValues(tx, '2026-10-01'))).toBe(2);
    expect(await values('2026-10-31')).toEqual({ [a]: [16, 320_00, 5_120_00], [b]: [4, null, 0] });
    // Rewriting a month replaces it.
    expect(await run((tx) => writeMonthEndValues(tx, '2026-08-20'))).toBe(2);
  });
});

describe('who may see what', () => {
  it('needs the cost permission for profit, and hides costs in products without it', async () => {
    await expect(
      run((tx) => profitReport(tx, actorAs('staff'), { from: D1, to: D3 })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const viewer = actorAs('viewer');
    if (!viewer.permissions.has('catalog.cost')) {
      await expect(
        run((tx) => profitReport(tx, viewer, { from: D1, to: D3 })),
      ).rejects.toMatchObject({ code: 'forbidden' });
    }
    const manager = { ...actorAs('manager'), permissions: new Set(['reports.read']) } as Actor;
    const products = await run((tx) => productsReport(tx, manager, { from: D1, to: D3 }));
    expect(products.items[0]).not.toHaveProperty('cogs');
    expect(products.items[0]).not.toHaveProperty('grossProfit');
  });

  it('refuses a range over two years, or backwards', async () => {
    await expect(
      run((tx) => salesReport(tx, owner, { from: '2024-01-01', to: '2026-01-02' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(run((tx) => salesReport(tx, owner, { from: D3, to: D1 }))).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});
