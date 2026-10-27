// Purchasing over HTTP (phase-8-plan §3.1–§3.3, §6, §8, §10): a supplier, a
// PO placed and received with an Idempotency-Key sent twice, staff seeing
// no costs or balances, a viewer refused writes, and another store's
// suppliers, POs and receipts answering 404.
import { createProduct, createTenant, systemActor, withTenant } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Browser, browser, signIn } from './staff';
import { appUrl, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
let app: pg.Client;
const unique = () => `po${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface Store {
  id: string;
  email: string;
  variant: string;
}

async function makeStore(): Promise<Store> {
  const slug = unique();
  const email = `${slug}@example.test`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: `Store ${slug}`,
    defaultLocale: 'en',
    owner: { email, name: 'Owner' },
  });
  const actor = {
    kind: 'user' as const,
    userId: created.ownerUserId,
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: created.id,
    storeRole: 'owner' as const,
  };
  const variant = await withTenant(app, created.id, async (tx) => {
    const p = await createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: 'Lungi' } },
      variant: { price: 450_00, costPrice: 200_00 },
    });
    return p.variants[0]?.id as string;
  });
  return { id: created.id, email, variant };
}

async function member(tenantId: string, role: string) {
  const email = `${unique()}@example.test`;
  const { rows } = await owner.query<{ id: string }>(
    `insert into platform.users (name, email, email_verified) values ('Member', $1, true) returning id`,
    [email],
  );
  await owner.query(
    `insert into platform.memberships (tenant_id, user_id, role) values ($1, $2, $3)`,
    [tenantId, rows[0]?.id, role],
  );
  return email;
}

async function staffIn(email: string, tenantId: string): Promise<Browser> {
  const b = browser(makeEnv());
  expect((await signIn(b, owner, email)).status).toBe(200);
  expect((await b.call('PUT', '/api/admin/me/active-store', { tenantId })).status).toBe(200);
  return b;
}

let a: Store;
let b: Store;
beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  [a, b] = [await makeStore(), await makeStore()];
});
afterAll(() => Promise.all([owner.end(), app.end()]));

describe('purchasing over HTTP', () => {
  it('places and receives a PO once however often the receipt is sent', async () => {
    const ownerA = await staffIn(a.email, a.id);
    const supplier = (await (
      await ownerA.post('/api/admin/suppliers', { name: 'Islampur Cloth', openingBalance: 500_00 })
    ).json()) as Json;
    expect(supplier).toMatchObject({ name: 'Islampur Cloth', balance: 500_00 });

    const created = await ownerA.post('/api/admin/purchase-orders', {
      supplierId: supplier.id,
      lines: [{ variantId: a.variant, quantity: 10, unitCost: 220_00 }],
      otherCosts: [{ label: 'Transport', amount: 100_00 }],
    });
    expect(created.status).toBe(201);
    const order = (await created.json()) as Json;
    expect(order).toMatchObject({ status: 'draft', total: 2_300_00, actions: ['place', 'cancel'] });
    const placed = (await (
      await ownerA.post(`/api/admin/purchase-orders/${order.id}/place`)
    ).json()) as Json;
    expect(placed.status).toBe('ordered');

    const receipt = {
      purchaseOrderId: order.id,
      lines: [{ variantId: a.variant, quantity: 10 }],
      payment: { amount: 1_000_00, method: 'bkash', reference: 'TX9' },
    };
    const headers = { 'idempotency-key': `receipt-${order.id}` };
    const first = await ownerA.post('/api/admin/goods-receipts', receipt, headers);
    const again = await ownerA.post('/api/admin/goods-receipts', receipt, headers);
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    const [one, two] = [(await first.json()) as Json, (await again.json()) as Json];
    expect(two.id).toBe(one.id);
    expect(one).toMatchObject({ total: 2_300_00, lines: [{ landedUnitCost: 230_00 }] });

    const after = (await (await ownerA.get(`/api/admin/suppliers/${supplier.id}`)).json()) as Json;
    // ৳500 + ৳2,300 − ৳1,000.
    expect(after.balance).toBe(1_800_00);
    const history = (await (
      await ownerA.get(`/api/admin/variants/${a.variant}/cost-history`)
    ).json()) as Json;
    // 0 on hand at ৳200, so the receipt's ৳230 is the cost.
    expect(history.items[0]).toMatchObject({ source: 'receipt', oldCost: 200_00, newCost: 230_00 });
    const dues = (await (
      await ownerA.get('/api/admin/reports/suppliers?from=2026-01-01&to=2026-12-31')
    ).json()) as Json;
    expect(dues.dues.find((d: Json) => d.supplierId === supplier.id)?.balance).toBe(1_800_00);

    // Staff see the PO and the supplier without costs or balances.
    const staffA = await staffIn(await member(a.id, 'staff'), a.id);
    const seen = (await (
      await staffA.get(`/api/admin/purchase-orders/${order.id}`)
    ).json()) as Json;
    expect(seen.status).toBe('received');
    expect(seen).not.toHaveProperty('total');
    expect(seen.lines[0]).not.toHaveProperty('unitCost');
    const sup = (await (await staffA.get(`/api/admin/suppliers/${supplier.id}`)).json()) as Json;
    expect(sup).not.toHaveProperty('balance');
    expect((await staffA.get(`/api/admin/suppliers/${supplier.id}/ledger`)).status).toBe(403);
    expect((await staffA.get(`/api/admin/variants/${a.variant}/cost-history`)).status).toBe(403);

    // A viewer reads, and writes nothing.
    const viewerA = await staffIn(await member(a.id, 'viewer'), a.id);
    expect((await viewerA.get('/api/admin/purchase-orders')).status).toBe(200);
    expect((await viewerA.post('/api/admin/suppliers', { name: 'No' })).status).toBe(403);

    // Store B's owner finds none of it.
    const ownerB = await staffIn(b.email, b.id);
    for (const path of [
      `/api/admin/suppliers/${supplier.id}`,
      `/api/admin/purchase-orders/${order.id}`,
      `/api/admin/goods-receipts/${one.id}`,
      `/api/admin/variants/${a.variant}/cost-history`,
    ]) {
      expect((await ownerB.get(path)).status, path).toBe(404);
    }
    expect(
      (await ownerB.call('PATCH', `/api/admin/suppliers/${supplier.id}`, { name: 'Taken' })).status,
    ).toBe(404);
    const list = (await (await ownerB.get('/api/admin/suppliers')).json()) as Json;
    expect(list.items).toEqual([]);
  });
});
