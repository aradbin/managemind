// The reports backfill (phase-8-plan §3.9) through the tenant-jobs runner:
// every day from the store's first movement to yesterday, the month ends
// before this month, and a stopped run resumed from its saved progress.
import {
  adjust,
  backfillReports,
  createProduct,
  createTenant,
  queueJob,
  receive,
  systemActor,
  withTenant,
} from '@managemind/core';
import { connect, testUrls } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runJobs } from './runner';

const { ownerUrl, appUrl } = testUrls('managemind_test_scripts');
let client: pg.Client;
let app: pg.Client;
let store: string;

const dhakaDay = (offset: number) =>
  new Date(Date.now() + 6 * 3_600_000 + offset * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  [client, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  const slug = `bf${Date.now().toString(36)}`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: 'Backfill',
    defaultLocale: 'en',
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  store = created.id;
  const owner = {
    kind: 'user' as const,
    userId: created.ownerUserId,
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: store,
    storeRole: 'owner' as const,
  };
  await withTenant(app, store, async (tx) => {
    const p = await createProduct(tx, owner, {
      status: 'active',
      translations: { en: { title: 'Lungi' } },
      variant: { price: 450_00, costPrice: 200_00 },
    });
    const variantId = p.variants[0]?.id as string;
    await receive(tx, owner, { variantId, quantity: 10, reason: 'received' });
    await adjust(tx, owner, { variantId, quantity: -2, reason: 'damaged' });
  });
  // The stock and its cost arrived 70 days ago, and two were damaged 40 days ago.
  await client.query(
    `update store.stock_movements set created_at = now() - make_interval(days => case when quantity > 0 then 70 else 40 end)
      where tenant_id = $1`,
    [store],
  );
  await client.query(
    `update store.cost_changes set created_at = now() - make_interval(days => 70) where tenant_id = $1`,
    [store],
  );
});
afterAll(() => Promise.all([client.end(), app.end()]));

const count = async (table: string) =>
  Number(
    (
      await client.query<{ n: string }>(
        `select count(*) as n from store.${table} where tenant_id = $1`,
        [store],
      )
    ).rows[0]?.n,
  );

describe('the reports backfill', () => {
  it('fills every day to yesterday and the past month ends, through the runner', async () => {
    const { job } = await withTenant(app, store, (tx) =>
      queueJob(tx, store, 'reports_backfill', null),
    );
    const summary = await runJobs({ ...base(), sink: null }, { jobId: job.id });
    expect(summary.succeeded).toEqual([job.id]);
    const { rows } = await client.query<{ status: string; result: { days: number; from: string } }>(
      'select status, result from platform.tenant_jobs where id = $1',
      [job.id],
    );
    expect(rows[0]?.status).toBe('succeeded');
    // From 70 days ago (in Dhaka, give or take the hour) to yesterday.
    expect(rows[0]?.result.days).toBeGreaterThanOrEqual(69);
    expect(await count('daily_sales')).toBe(rows[0]?.result.days);
    const { rows: loss } = await client.query<{ day: string; stock_losses: string }>(
      `select day::text, stock_losses from store.daily_sales where tenant_id = $1 and stock_losses <> 0`,
      [store],
    );
    expect(loss.map((l) => Number(l.stock_losses))).toEqual([400_00]);
    // Past month ends with stock on hand then have their values.
    const { rows: months } = await client.query<{ month: string; on_hand: number; value: string }>(
      `select month::text, on_hand, value from store.monthly_stock_values where tenant_id = $1
        order by month`,
      [store],
    );
    expect(months.length).toBeGreaterThanOrEqual(2);
    expect(months.at(-1)).toMatchObject({ on_hand: 8, value: '160000' });
  });

  it('resumes from its saved progress', async () => {
    const yesterday = dhakaDay(-1);
    const saved: unknown[] = [];
    const result = await backfillReports(
      client,
      store,
      { phase: 'days', through: dhakaDay(-4) },
      async (p) => {
        saved.push(p);
      },
    );
    // Only the last three days, then every month end again.
    expect(result.days).toBe(3);
    expect(saved[0]).toEqual({ phase: 'days', through: yesterday });
    expect(saved.at(-1)).toEqual({ phase: 'done', through: yesterday });
  });
});

function base() {
  return {
    client,
    files: {
      async *list() {},
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    },
    kv: { list: async () => [], delete: async () => {} },
    storeDomain: 'stores.example.test',
    log: () => {},
  };
}
