// The back office's reports over HTTP (phase-8-plan §3.8, §8): sales,
// products and profit for the owner; a viewer reads sales and products
// without costs and is refused profit; staff, without reports.read, are
// refused all three; the order list's profit and the dashboard's month
// only for cost holders.
import { createTenant, systemActor } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Browser, browser, signIn } from './staff';
import { appUrl, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
let app: pg.Client;
const unique = () => `rp${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
let store: string;
let emails: Record<'owner' | 'viewer' | 'staff', string>;

async function member(role: string) {
  const email = `${unique()}@example.test`;
  const { rows } = await owner.query<{ id: string }>(
    `insert into platform.users (name, email, email_verified) values ('Member', $1, true) returning id`,
    [email],
  );
  await owner.query(
    `insert into platform.memberships (tenant_id, user_id, role) values ($1, $2, $3)`,
    [store, rows[0]?.id, role],
  );
  return email;
}

async function as(email: string): Promise<Browser> {
  const b = browser(makeEnv());
  expect((await signIn(b, owner, email)).status).toBe(200);
  expect((await b.call('PUT', '/api/admin/me/active-store', { tenantId: store })).status).toBe(200);
  return b;
}

beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const slug = unique();
  const email = `${slug}@example.test`;
  store = (
    await createTenant(app, systemActor, {
      slug,
      name: 'Reports',
      defaultLocale: 'en',
      owner: { email, name: 'Owner' },
    })
  ).id;
  emails = { owner: email, viewer: await member('viewer'), staff: await member('staff') };
});
afterAll(() => Promise.all([owner.end(), app.end()]));

const range = 'from=2026-10-01&to=2026-10-26';

describe('reports over HTTP', () => {
  it('gives the owner sales, products and profit with the period before', async () => {
    const b = await as(emails.owner);
    const sales = await b.get(`/api/admin/reports/sales?${range}&by=month`);
    expect(sales.status).toBe(200);
    expect((await sales.json()) as Json).toMatchObject({
      by: 'month',
      buckets: [{ start: '2026-10-01', netSales: 0 }],
      totals: { units: 0 },
    });
    expect((await b.get(`/api/admin/reports/products?${range}`)).status).toBe(200);
    const profit = (await (await b.get(`/api/admin/reports/profit?${range}`)).json()) as Json;
    expect(profit).toMatchObject({
      current: { from: '2026-10-01', to: '2026-10-26', netProfit: 0, missingCostUnits: 0 },
      previous: { from: '2026-09-05', to: '2026-09-30' },
    });
    const dashboard = (await (await b.get('/api/admin/dashboard')).json()) as Json;
    expect(dashboard.profit).toMatchObject({ grossProfit: 0, netProfit: 0 });
    expect((await b.get('/api/admin/reports/sales?from=2026-10-26&to=2026-10-01')).status).toBe(
      422,
    );
  });

  it('refuses profit to a viewer and every report to staff', async () => {
    const viewer = await as(emails.viewer);
    expect((await viewer.get(`/api/admin/reports/sales?${range}`)).status).toBe(200);
    expect((await viewer.get(`/api/admin/reports/products?${range}`)).status).toBe(200);
    expect((await viewer.get(`/api/admin/reports/profit?${range}`)).status).toBe(403);
    expect(((await (await viewer.get('/api/admin/dashboard')).json()) as Json).profit).toBeNull();

    // Values and dues need costs and payments; slow movers, expenses and COD don't.
    expect((await viewer.get('/api/admin/reports/stock')).status).toBe(403);
    expect((await viewer.get(`/api/admin/reports/suppliers?${range}`)).status).toBe(403);
    expect((await viewer.get(`/api/admin/reports/expenses?${range}`)).status).toBe(200);
    expect((await viewer.get('/api/admin/reports/cod-outstanding')).status).toBe(200);
    expect((await viewer.get('/api/admin/reports/slow-movers?days=30')).status).toBe(200);

    const staff = await as(emails.staff);
    for (const path of [
      'sales',
      'products',
      'profit',
      'stock',
      'slow-movers',
      'suppliers',
      'expenses',
      'cod-outstanding',
    ]) {
      expect((await staff.get(`/api/admin/reports/${path}?${range}`)).status, path).toBe(403);
    }
  });

  it('gives the owner stock, suppliers, expenses and COD outstanding', async () => {
    const b = await as(emails.owner);
    const stock = (await (await b.get('/api/admin/reports/stock')).json()) as Json;
    expect(stock).toMatchObject({ month: null, totals: { units: 0, value: 0 }, items: [] });
    expect((await b.get('/api/admin/reports/stock?month=2026-13')).status).toBe(422);
    expect(
      ((await (await b.get(`/api/admin/reports/suppliers?${range}`)).json()) as Json).duesTotal,
    ).toMatchObject({ balance: 0 });
    const expenses = (await (await b.get(`/api/admin/reports/expenses?${range}`)).json()) as Json;
    expect(expenses).toMatchObject({ months: ['2026-10'], total: 0 });
    expect(await (await b.get('/api/admin/reports/cod-outstanding')).json()).toEqual({
      holders: [],
      total: 0,
    });
  });

  it('needs the back office in the plan', async () => {
    await owner.query(
      `update platform.tenants set entitlements = jsonb_build_object(
         'limits', '{"products":null,"staff":null,"ordersPerMonth":null,"emailsPerMonth":null,"storageMb":null,"customDomains":null}'::jsonb,
         'features', '{"sslcommerz":true,"sms":true,"shopperAccounts":true,"promotionCoupons":true,"promotionAutomatic":true,"promotionBuyXGetY":true,"promotionFreeDelivery":true,"reports":true,"customEmailKey":true,"backOffice":false}'::jsonb)
        where id = $1`,
      [store],
    );
    const b = await as(emails.owner);
    const res = await b.get(`/api/admin/reports/sales?${range}`);
    expect(res.status).toBe(402);
    expect(((await res.json()) as Json).code).toBe('feature_not_in_plan');
    expect(((await (await b.get('/api/admin/dashboard')).json()) as Json).profit).toBeNull();
  });
});
