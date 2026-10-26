// Expenses over HTTP (phase-8-plan §3.6, §8): an expense with a receipt
// photo stored under the store's prefix, replaced and removed with it, only
// images accepted; and the daily batch's recurring posts, once a day.
import { createTenant, runRecurringExpenses, systemActor } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { browser, signIn } from './staff';
import { appUrl, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const env = makeEnv();
let owner: pg.Client;
let app: pg.Client;
let store: { id: string; email: string };

beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const slug = `ex${Date.now().toString(36)}`;
  const email = `${slug}@example.test`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: 'Expenses',
    defaultLocale: 'en',
    owner: { email, name: 'Owner' },
  });
  store = { id: created.id, email };
});
afterAll(() => Promise.all([owner.end(), app.end()]));

// The smallest JPEG start a sniffer recognizes, padded.
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(60).fill(1)]);
const png = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...new Array(60).fill(2),
]);

describe('expenses over HTTP', () => {
  it('stores, replaces and removes a receipt photo with its expense', async () => {
    const b = browser(env);
    expect((await signIn(b, owner, store.email)).status).toBe(200);
    expect((await b.call('PUT', '/api/admin/me/active-store', { tenantId: store.id })).status).toBe(
      200,
    );
    const categories = (await (await b.get('/api/admin/expense-categories')).json()) as Json;
    const ads = categories.find((c: Json) => c.key === 'ads');
    const created = await b.post(
      '/api/admin/expenses',
      {
        spentOn: '2026-10-20',
        categoryId: ads.id,
        amount: 3_500_00,
        method: 'card',
        payee: 'Meta',
      },
      { 'idempotency-key': `expense-${store.id}` },
    );
    expect(created.status).toBe(201);
    const expense = (await created.json()) as Json;

    const upload = (bytes: Uint8Array, type: string) =>
      b.call('POST', `/api/admin/expenses/${expense.id}/receipt`, bytes, { 'content-type': type });
    expect((await upload(new Uint8Array([1, 2, 3, 4]), 'image/jpeg')).status).toBe(415);
    const first = await upload(jpeg, 'image/jpeg');
    expect(first.status).toBe(200);
    expect(((await first.json()) as Json).hasReceipt).toBe(true);
    const keys = () =>
      [...env.FILES.objects.keys()].filter((k) => k.startsWith(`tenants/${store.id}/expenses/`));
    expect(keys()).toHaveLength(1);

    // A new photo replaces the old one, in the row and in R2.
    expect((await upload(png, 'image/png')).status).toBe(200);
    expect(keys()).toHaveLength(1);
    const photo = await b.get(`/api/admin/expenses/${expense.id}/receipt`);
    expect(photo.status).toBe(200);
    expect(photo.headers.get('content-type')).toBe('image/png');
    expect(photo.headers.get('cache-control')).toBe('private, no-store');

    // The usage rollup counts it in the store's storage.
    const { rows } = await owner.query<{ bytes: string }>(
      `select (receipt_media->>'bytes') as bytes from store.expenses where id = $1`,
      [expense.id],
    );
    expect(Number(rows[0]?.bytes)).toBe(png.byteLength);

    expect((await b.call('DELETE', `/api/admin/expenses/${expense.id}`)).status).toBe(204);
    expect(keys()).toHaveLength(0);
  });

  it('imports past expenses and suppliers once under one Idempotency-Key (phase-8-plan §3.10)', async () => {
    const b = browser(env);
    expect((await signIn(b, owner, store.email)).status).toBe(200);
    await b.call('PUT', '/api/admin/me/active-store', { tenantId: store.id });
    const categories = (await (await b.get('/api/admin/expense-categories')).json()) as Json;
    const rent = categories.find((c: Json) => c.key === 'rent');
    const rows = [
      { row: 2, spentOn: '2026-05-05', categoryId: rent.id, amount: 15_000_00, method: 'bank' },
      { row: 3, spentOn: '2026-06-05', categoryId: rent.id, amount: 15_000_00, method: 'bank' },
    ];
    const key = { 'idempotency-key': `expense-import-${store.id}` };
    const first = await b.post('/api/admin/expenses/import', rows, key);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ created: 2, skipped: [] });
    expect(await (await b.post('/api/admin/expenses/import', rows, key)).json()).toEqual({
      created: 2,
      skipped: [],
    });
    const { rows: saved } = await owner.query<{ n: number }>(
      `select count(*)::int as n from store.expenses where tenant_id = $1 and spent_on < '2026-07-01'`,
      [store.id],
    );
    expect(saved[0]?.n).toBe(2);

    const suppliers = await b.post(
      '/api/admin/suppliers/import',
      [{ row: 2, name: 'Imported Traders', phones: ['01711000009'], openingBalance: 7_000_00 }],
      { 'idempotency-key': `supplier-import-${store.id}` },
    );
    expect(suppliers.status).toBe(200);
    expect(await suppliers.json()).toEqual({ created: 1, skipped: [] });
    expect((await b.post('/api/admin/suppliers/import', [])).status).toBe(422);
  });

  it('posts recurring expenses once however often the batch runs', async () => {
    const { rows: cats } = await owner.query<{ id: string }>(
      `select id from store.expense_categories where tenant_id = $1 and key = 'rent'`,
      [store.id],
    );
    await owner.query(
      `insert into store.recurring_expenses (tenant_id, category_id, amount, method, cadence, day, starts_on, next_on)
       values ($1, $2, 100000, 'bank', 'monthly', 1, '2026-09-01', '2026-09-01')`,
      [store.id, cats[0]?.id],
    );
    const first = await runRecurringExpenses(app, '2026-10-26');
    expect(first.failed).toEqual([]);
    expect(first.posted).toBeGreaterThanOrEqual(2);
    await runRecurringExpenses(app, '2026-10-26');
    const { rows } = await owner.query<{ spent_on: string }>(
      `select spent_on::text from store.expenses where tenant_id = $1 and recurring_expense_id is not null
        order by spent_on`,
      [store.id],
    );
    expect(rows.map((r) => r.spent_on)).toEqual(['2026-09-01', '2026-10-01']);
  });
});
