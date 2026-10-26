// The back office for a demo store (phase-8-plan §9): two suppliers, one
// with an opening balance; a purchase order received five weeks ago with
// its transport and half of it paid, which gives the catalog its costs;
// another placed and waiting; and two months of expenses with a monthly
// rent. Runs after the catalog and before the sample orders, so the orders'
// lines take these costs when they ship. As app_rw, like the API; the dates
// are moved back as the migration role.
import {
  createExpense,
  createGoodsReceipt,
  createPurchaseOrder,
  createRecurringExpense,
  createSupplier,
  listExpenseCategories,
  placePurchaseOrder,
  refreshSummaries,
  storeEntitlements,
  type TenantTx,
  withTenant,
  writeMonthEndValues,
} from '@managemind/core';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { ownerActor } from './catalog';

const DAY_MS = 86_400_000;
const dhakaDay = (offset = 0) =>
  new Date(Date.now() + 6 * 3_600_000 + offset * DAY_MS).toISOString().slice(0, 10);

const inStore = <T>(client: pg.Client, tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(client, tenantId, async (tx) => {
    await tx.db.execute(sql`set local role app_rw`);
    return fn(tx);
  });

/** Suppliers, purchases and expenses; false when the plan has no back office or nothing to buy. */
export async function seedDemoBackOffice(client: pg.Client, tenantId: string): Promise<boolean> {
  const actor = ownerActor(tenantId);
  await client.query('grant app_rw to current_user with set true, inherit false');
  const { rows: variants } = await client.query<{ id: string; price: string }>(
    `select v.id, v.price from store.variants v
      where v.tenant_id = $1 and v.archived_at is null order by v.created_at limit 6`,
    [tenantId],
  );
  if (variants.length < 2) return false;
  if (
    !(await inStore(
      client,
      tenantId,
      async (tx) => (await storeEntitlements(tx)).features.backOffice,
    ))
  ) {
    return false;
  }
  // Bought at about 60% of the selling price, rounded to the taka.
  const cost = (price: string) => Math.round((Number(price) * 0.6) / 100) * 100;
  const receiptId = await inStore(client, tenantId, async (tx) => {
    const wholesale = await createSupplier(tx, actor, {
      name: 'Islampur Wholesale',
      phones: ['01711000001'],
      contactName: 'Jamal Hossain',
      openingBalance: 15_000_00,
    });
    const local = await createSupplier(tx, actor, {
      name: 'Chawkbazar Traders',
      phones: ['01811000002'],
    });
    const first = await createPurchaseOrder(tx, actor, {
      supplierId: wholesale.id,
      lines: variants
        .slice(0, 4)
        .map((v) => ({ variantId: v.id, quantity: 10, unitCost: cost(v.price) })),
      otherCosts: [{ label: 'Transport', amount: 500_00 }],
    });
    await placePurchaseOrder(tx, actor, first.id);
    const total = first.total ?? 0;
    const receipt = await createGoodsReceipt(tx, actor, {
      purchaseOrderId: first.id,
      lines: variants.slice(0, 4).map((v) => ({ variantId: v.id, quantity: 10 })),
      payment: { amount: Math.round(total / 2 / 100) * 100, method: 'bkash', reference: 'DEMO1' },
    });
    const second = await createPurchaseOrder(tx, actor, {
      supplierId: local.id,
      lines: variants
        .slice(-2)
        .map((v) => ({ variantId: v.id, quantity: 6, unitCost: cost(v.price) })),
    });
    await placePurchaseOrder(tx, actor, second.id);

    const categories = await listExpenseCategories(tx, actor);
    const id = (key: string) => categories.find((c) => c.key === key)?.id as string;
    const spent: [number, string, number, string, string?][] = [
      [-56, 'rent', 15_000_00, 'bank', 'Landlord'],
      [-50, 'salaries', 20_000_00, 'cash'],
      [-45, 'ads', 2_500_00, 'card', 'Meta'],
      [-38, 'ads', 2_500_00, 'card', 'Meta'],
      [-33, 'packaging', 1_800_00, 'cash', 'Box Mart'],
      [-28, 'internet', 1_000_00, 'bkash'],
      [-26, 'rent', 15_000_00, 'bank', 'Landlord'],
      [-20, 'salaries', 20_000_00, 'cash'],
      [-17, 'ads', 3_000_00, 'card', 'Meta'],
      [-10, 'ads', 3_000_00, 'card', 'Meta'],
      [-6, 'delivery', 1_200_00, 'cash'],
    ];
    for (const [offset, key, amount, method, payee] of spent) {
      await createExpense(tx, actor, {
        spentOn: dhakaDay(offset),
        categoryId: id(key),
        amount,
        method,
        ...(payee ? { payee } : {}),
      });
    }
    await createRecurringExpense(tx, actor, {
      categoryId: id('rent'),
      amount: 15_000_00,
      method: 'bank',
      payee: 'Landlord',
      cadence: 'monthly',
      day: 1,
      startsOn: dhakaDay(),
    });
    return receipt.id;
  });
  // The purchase happened five weeks ago.
  const back = 35;
  await client.query(
    `update store.goods_receipts set received_on = received_on - $2::int, created_at = created_at - make_interval(days => $2)
      where id = $1`,
    [receiptId, back],
  );
  await client.query(
    `update store.supplier_payments set paid_on = paid_on - $2::int, created_at = created_at - make_interval(days => $2)
      where tenant_id = $1`,
    [tenantId, back],
  );
  await client.query(
    `update store.stock_movements set created_at = created_at - make_interval(days => $2)
      where tenant_id = $1 and reference_id = $3`,
    [tenantId, back, receiptId],
  );
  await client.query(
    `update store.cost_changes set created_at = created_at - make_interval(days => $2) where tenant_id = $1`,
    [tenantId, back],
  );
  return true;
}

/** After the sample orders: the summaries for the last 60 days and last month's end. */
export async function refreshDemoReports(client: pg.Client, tenantId: string): Promise<void> {
  await client.query('grant app_rw to current_user with set true, inherit false');
  await inStore(client, tenantId, (tx) => refreshSummaries(tx, dhakaDay(-60), dhakaDay(-1)));
  const lastMonth = new Date(Date.now() + 6 * 3_600_000);
  lastMonth.setUTCDate(0);
  await inStore(client, tenantId, (tx) =>
    writeMonthEndValues(tx, lastMonth.toISOString().slice(0, 10)),
  );
}
