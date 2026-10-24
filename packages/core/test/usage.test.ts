// The daily usage rollup and store health (phase-5b-plan §3.3, §3.6).
import { permissionsOf } from '@managemind/shared';
import { addDays, dhakaDate } from '@managemind/shared/billing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  compactUsage,
  createProduct,
  createTenant,
  placeOrder,
  platformDashboard,
  readStoreHealth,
  runDailyRollup,
  systemActor,
  usageBetween,
  withPlatform,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connectApp(), connectOwner()]);
});
afterAll(() => Promise.all([app.end(), owner.end()]));

let seq = 0;
async function store() {
  const slug = `u${Date.now().toString(36)}${seq++}`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: `Usage ${slug}`,
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  // As if it had been open for a week, so earlier days count.
  await owner.query(
    `update platform.tenants set created_at = now() - interval '7 days' where id = $1`,
    [created.id],
  );
  await owner.query(
    `update platform.memberships set created_at = now() - interval '7 days' where tenant_id = $1`,
    [created.id],
  );
  return created;
}

/** A statement as the owner role in the store's context (RLS is forced for it too). */
async function asOwner(tenantId: string, text: string, params: unknown[]) {
  await owner.query('begin');
  try {
    await owner.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.tenant_at', now()::text, true)",
      [tenantId],
    );
    await owner.query(text, params);
    await owner.query('commit');
  } catch (e) {
    await owner.query('rollback');
    throw e;
  }
}

/** An admin order, moved to a Dhaka time as if placed then; returns its total. */
async function order(tenantId: string, at: string): Promise<number> {
  const staff: Actor = {
    kind: 'user',
    userId: null,
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId,
    storeRole: 'owner',
  };
  const placed = await withTenant(app, tenantId, async (tx) => {
    const p = await createProduct(tx, staff, {
      status: 'active',
      translations: { bn: { title: `পণ্য ${seq++}` } },
      variant: { price: 10_000, trackInventory: false },
    });
    return placeOrder(tx, staff, {
      channel: 'admin',
      source: 'facebook',
      lines: [{ variantId: p.variants[0]?.id as string, quantity: 1 }],
      contact: { name: 'Karim', phone: '+8801812345678' },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
      payment: { kind: 'cod' },
      locale: 'bn',
    });
  });
  await asOwner(tenantId, 'update store.orders set placed_at = $2 where id = $1', [placed.id, at]);
  await asOwner(tenantId, 'update store.products set created_at = $1 where created_at > $1', [at]);
  return placed.total;
}

describe('daily usage rollup', () => {
  const yesterday = addDays(dhakaDate(new Date()), -1);

  it("counts a Dhaka day's orders, and is the same when run again", async () => {
    const s = await store();
    // 00:30 in Dhaka belongs to yesterday; 23:59 the day before doesn't.
    const a = await order(s.id, `${yesterday}T00:30:00+06:00`);
    const b = await order(s.id, `${yesterday}T23:00:00+06:00`);
    await order(s.id, `${addDays(yesterday, -1)}T23:59:00+06:00`);
    const first = await runDailyRollup(app, yesterday, { catchUp: 0 });
    expect(first.failed).toEqual([]);
    await runDailyRollup(app, yesterday, { catchUp: 0 });
    const day = await withTenant(app, s.id, (tx) => usageBetween(tx, s.id, yesterday, yesterday));
    expect(day).toMatchObject({ orders: 2, order_total: a + b, staff: 1, custom_domains: 0 });
    expect(day.products).toBe(3);
    const { rows } = await owner.query(
      `select count(*)::int as n from platform.usage_daily where tenant_id = $1 and day = $2`,
      [s.id, yesterday],
    );
    expect(rows[0]?.n).toBe(8);
  });

  it('fills in a day it missed', async () => {
    const s = await store();
    const missed = addDays(yesterday, -2);
    await order(s.id, `${missed}T12:00:00+06:00`);
    await runDailyRollup(app, yesterday, { catchUp: 3 });
    const month = await withTenant(app, s.id, (tx) =>
      usageBetween(tx, s.id, addDays(yesterday, -5), yesterday),
    );
    expect(month.orders).toBe(1);
  });

  it("writes the store's health with its checklist", async () => {
    const s = await store();
    await runDailyRollup(app, yesterday, { catchUp: 0 });
    const health = await withPlatform(app, (tx) => readStoreHealth(tx, s.id));
    expect(health?.checklist).toMatchObject({ complete: false });
    expect(health?.email).toMatchObject({ sender: 'platform', failed24h: 0 });
    expect(health?.activity).toHaveProperty('lastOrderAt');
  });
});

describe('platform dashboard', () => {
  it('counts stores, sums client sales and lists use per store', async () => {
    const s = await store();
    const yesterday = addDays(dhakaDate(new Date()), -1);
    const total = await order(s.id, `${yesterday}T10:00:00+06:00`);
    await runDailyRollup(app, yesterday, { catchUp: 0 });
    const d = await withPlatform(app, (tx) =>
      platformDashboard(tx, systemActor, dhakaDate(new Date())),
    );
    expect(d.stores.active).toBeGreaterThan(0);
    expect(d.sales.yesterday.total).toBeGreaterThanOrEqual(total);
    expect(d.perStore.find((p) => p.tenantId === s.id)).toMatchObject({ products: 1 });
    expect(d.money.overdue.count).toBeGreaterThanOrEqual(0);
  });
});

describe('usage retention', () => {
  it('folds months older than 13 into one row per metric that sums the same', async () => {
    const s = await store();
    const put = (day: string, metric: string, value: number) =>
      owner.query(
        'insert into platform.usage_daily (tenant_id, day, metric, value) values ($1, $2, $3, $4)',
        [s.id, day, metric, value],
      );
    // August 2025 has three days; July 2025 one day mid-month; September 2025 is kept.
    for (const [day, orders, products] of [
      ['2025-08-01', 2, 10],
      ['2025-08-02', 3, 12],
      ['2025-08-15', 5, 11],
      ['2025-07-10', 4, 9],
      ['2025-09-01', 1, 13],
      ['2025-09-02', 1, 13],
    ] as const) {
      await put(day, 'orders', orders);
      await put(day, 'products', products);
    }
    const month = (from: string, to: string) =>
      withPlatform(app, (tx) => usageBetween(tx, s.id, from, to));
    const august = await month('2025-08-01', '2025-08-31');

    expect(await compactUsage(app, '2026-10-24')).toBeGreaterThanOrEqual(6);
    const { rows } = await owner.query<{ day: string; metric: string; value: string }>(
      `select day::text, metric, value from platform.usage_daily
        where tenant_id = $1 order by day, metric`,
      [s.id],
    );
    expect(rows.map((r) => [r.day, r.metric, Number(r.value)])).toEqual([
      ['2025-07-31', 'orders', 4],
      ['2025-07-31', 'products', 9],
      ['2025-08-31', 'orders', 10],
      ['2025-08-31', 'products', 11],
      ['2025-09-01', 'orders', 1],
      ['2025-09-01', 'products', 13],
      ['2025-09-02', 'orders', 1],
      ['2025-09-02', 'products', 13],
    ]);
    expect(await month('2025-08-01', '2025-08-31')).toEqual(august);
    // Folded months are left alone.
    expect(await compactUsage(app, '2026-10-24')).toBe(0);
  });
});
