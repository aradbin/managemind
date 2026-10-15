// The catalog and inventory API end to end (phase-2-plan §6, §8): requests
// through the real app with a signed-in staff member, against Postgres as
// the app role. Isolation for these routes is in admin.test.ts.
import { createTenant, systemActor } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Browser, browser, signIn } from './staff';
import { appUrl, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
let app: pg.Client;
let store: { id: string; email: string };
let ownerBrowser: Browser;
beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  const slug = `c${Date.now().toString(36)}`;
  const email = `${slug}@example.test`;
  const { id } = await createTenant(app, systemActor, {
    slug,
    name: 'Catalog API',
    defaultLocale: 'en',
    owner: { email, name: 'Owner' },
  });
  store = { id, email };
  ownerBrowser = await staffIn(email);
});
afterAll(() => Promise.all([owner.end(), app.end()]));

let seq = 0;
async function staffIn(email: string) {
  const b = browser(makeEnv());
  expect((await signIn(b, owner, email)).status).toBe(200);
  expect((await b.call('PUT', '/api/admin/me/active-store', { tenantId: store.id })).status).toBe(
    200,
  );
  return b;
}

async function memberWith(role: string) {
  const email = `m${Date.now().toString(36)}${seq++}@example.test`;
  const { rows } = await owner.query<{ id: string }>(
    `insert into platform.users (name, email, email_verified) values ('Member', $1, true) returning id`,
    [email],
  );
  await owner.query(
    `insert into platform.memberships (tenant_id, user_id, role) values ($1, $2, $3)`,
    [store.id, rows[0]?.id, role],
  );
  return staffIn(email);
}

const call = async (b: Browser, method: string, path: string, body?: unknown, headers = {}) => {
  const res = await b.call(method, `/api/admin${path}`, body, headers);
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as Json };
};

describe('products over the API', () => {
  it('creates once per Idempotency-Key, reads, edits and lists', async () => {
    const input = {
      translations: { en: { title: 'API Shirt' }, bn: { title: 'এপিআই শার্ট' } },
      variant: { price: 99_900, costPrice: 50_000, sku: `API-${Date.now()}` },
    };
    const headers = { 'idempotency-key': `create-${Date.now()}` };
    const first = await call(ownerBrowser, 'POST', '/products', input, headers);
    expect(first.status).toBe(201);
    const replay = await call(ownerBrowser, 'POST', '/products', input, headers);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    const id = first.body.id as string;

    const read = await call(ownerBrowser, 'GET', `/products/${id}`);
    expect(read.body).toMatchObject({
      status: 'draft',
      translations: { en: { slug: 'api-shirt' }, bn: { slug: 'এপিআই-শার্ট' } },
      variants: [{ price: 99_900, costPrice: 50_000, stock: { onHand: 0 } }],
    });

    const options = await call(ownerBrowser, 'PUT', `/products/${id}/options`, [
      { name: { en: 'Size' }, values: [{ label: { en: 'M' } }, { label: { en: 'L' } }] },
    ]);
    expect(options.status).toBe(200);
    expect(options.body.variants).toHaveLength(2);

    const patched = await call(ownerBrowser, 'PATCH', `/products/${id}`, {
      status: 'active',
      tags: ['New'],
    });
    expect(patched.body).toMatchObject({ status: 'active', tags: ['new'] });

    const list = await call(ownerBrowser, 'GET', '/products?q=api%20shirt&limit=5');
    expect(list.body.items.map((p: Json) => p.id)).toContain(id);
  });

  it('answers problems for bad input, conflicts and missing rows', async () => {
    expect((await call(ownerBrowser, 'POST', '/products', { translations: {} })).status).toBe(422);
    const sku = `DUP-${Date.now()}`;
    const make = () =>
      call(ownerBrowser, 'POST', '/products', {
        translations: { en: { title: `Dup ${seq++}` } },
        variant: { price: 1, sku },
      });
    expect((await make()).status).toBe(201);
    const duplicate = await make();
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('sku_taken');
    expect((await call(ownerBrowser, 'GET', `/products/${crypto.randomUUID()}`)).status).toBe(404);
  });

  it('leaves cost prices out for roles without catalog.cost', async () => {
    const created = await call(ownerBrowser, 'POST', '/products', {
      translations: { en: { title: `Costed ${seq++}` } },
      variant: { price: 1000, costPrice: 400 },
    });
    const staff = await memberWith('staff');
    const seen = await call(staff, 'GET', `/products/${created.body.id}`);
    expect(seen.status).toBe(200);
    expect(seen.body.variants[0]).not.toHaveProperty('costPrice');
    const variant = created.body.variants[0].id;
    expect((await call(staff, 'PATCH', `/variants/${variant}`, { costPrice: 1 })).status).toBe(403);
    expect((await call(staff, 'PATCH', `/variants/${variant}`, { price: 1200 })).status).toBe(200);
    const viewer = await memberWith('viewer');
    expect(
      (await call(viewer, 'POST', '/products', { translations: { en: { title: 'No' } } })).status,
    ).toBe(403);
  });
});

describe('categories, attributes and collections over the API', () => {
  it('builds a tree, a template and a rule collection', async () => {
    const root = await call(ownerBrowser, 'POST', '/categories', {
      translations: { en: { name: `Clothing ${seq++}` } },
    });
    expect(root.status).toBe(201);
    const attribute = await call(ownerBrowser, 'POST', '/attributes', {
      key: `fabric_${seq++}`,
      type: 'choice',
      translations: { en: { name: 'Fabric' } },
    });
    expect(attribute.status).toBe(201);
    const values = await call(ownerBrowser, 'PUT', `/attributes/${attribute.body.id}/values`, [
      { label: { en: 'Cotton' } },
    ]);
    expect(values.body.values).toHaveLength(1);
    const template = await call(ownerBrowser, 'PUT', `/categories/${root.body.id}/attributes`, [
      attribute.body.id,
    ]);
    expect(template.body.attributeIds).toEqual([attribute.body.id]);
    const ids = await call(ownerBrowser, 'GET', `/template-attributes?categoryIds=${root.body.id}`);
    expect(ids.body).toEqual([attribute.body.id]);

    const product = await call(ownerBrowser, 'POST', '/products', {
      translations: { en: { title: `Cotton tee ${seq++}` } },
      categoryIds: [root.body.id],
      attributes: [
        { type: 'choice', attributeId: attribute.body.id, valueIds: [values.body.values[0].id] },
      ],
    });
    expect(product.status).toBe(201);
    const collection = await call(ownerBrowser, 'POST', '/collections', {
      kind: 'rule',
      translations: { en: { name: `Cotton ${seq++}` } },
      rules: {
        conditions: [
          { type: 'category', categoryId: root.body.id },
          {
            type: 'attribute_value',
            attributeId: attribute.body.id,
            valueId: values.body.values[0].id,
          },
        ],
      },
    });
    expect(collection.status).toBe(201);
    const matched = await call(ownerBrowser, 'GET', `/collections/${collection.body.id}/products`);
    expect(matched.body.items.map((p: Json) => p.id)).toEqual([product.body.id]);
    const preview = await call(ownerBrowser, 'POST', `/collections/${collection.body.id}/preview`, {
      conditions: [{ type: 'tag', tag: 'nothing-has-this' }],
    });
    expect(preview.body.total).toBe(0);
    // The category has a product now, so it can't be deleted.
    const refused = await call(ownerBrowser, 'DELETE', `/categories/${root.body.id}`);
    expect(refused.status).toBe(409);
  });
});

describe('inventory over the API', () => {
  it('adjusts stock once per Idempotency-Key and shows the ledger', async () => {
    const product = await call(ownerBrowser, 'POST', '/products', {
      translations: { en: { title: `Stocked ${seq++}` } },
      variant: { price: 100, lowStockThreshold: 5 },
    });
    const variantId = product.body.variants[0].id;
    const body = [{ mode: 'delta', variantId, quantity: 3, reason: 'received' }];
    const headers = { 'idempotency-key': `adjust-${variantId}` };
    const first = await call(ownerBrowser, 'POST', '/inventory/adjustments', body, headers);
    expect(first.status).toBe(200);
    await call(ownerBrowser, 'POST', '/inventory/adjustments', body, headers);
    const ledger = await call(ownerBrowser, 'GET', `/variants/${variantId}/movements`);
    expect(ledger.body.items.map((m: Json) => [m.type, m.quantity])).toEqual([['receive', 3]]);
    const low = await call(ownerBrowser, 'GET', '/inventory?lowStock=true&limit=100');
    expect(low.body.items.map((i: Json) => i.variantId)).toContain(variantId);
    const tooMuch = await call(ownerBrowser, 'POST', '/inventory/adjustments', [
      { mode: 'delta', variantId, quantity: -10, reason: 'damaged' },
    ]);
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe('insufficient_stock');
  });

  it('renames the default location and sets VAT in the store settings', async () => {
    const [location] = (await call(ownerBrowser, 'GET', '/locations')).body;
    expect(location).toMatchObject({ isDefault: true, name: 'Main stock' });
    const renamed = await call(ownerBrowser, 'PATCH', `/locations/${location.id}`, {
      name: 'Warehouse',
      address: { line1: 'House 1, Road 2', city: 'Dhaka' },
    });
    expect(renamed.body).toMatchObject({ name: 'Warehouse', address: { city: 'Dhaka' } });
    const vat = await call(ownerBrowser, 'PATCH', '/store', { tax: { vatEnabled: true } });
    expect(vat.status).toBe(200);
    expect(vat.body.tax).toEqual({
      vatEnabled: true,
      rateBasisPoints: 1500,
      pricesIncludeVat: true,
      categories: [],
    });
  });
});
