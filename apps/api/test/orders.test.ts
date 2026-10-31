// The admin's order, customer, delivery and settings routes end to end
// (phase-4-plan §6.2, §13): a manual order from entry to completed over HTTP,
// idempotent commands, masking for viewers, zones, the blocklist and the
// checkout settings.
import { createProduct, createTenant, receive, systemActor, withTenant } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, signIn } from './staff';
import { appUrl, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
let app: pg.Client;
let tenantId: string;
let variant: string;
let ownerEmail: string;
beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  const slug = `o${Date.now().toString(36)}`;
  ownerEmail = `${slug}@example.test`;
  const created = await createTenant(app, systemActor, {
    slug,
    name: 'Admin orders',
    defaultLocale: 'en',
    owner: { email: ownerEmail, name: 'Owner' },
  });
  tenantId = created.id;
  const actor = {
    kind: 'user' as const,
    userId: created.ownerUserId,
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId,
    storeRole: 'owner' as const,
  };
  variant = await withTenant(app, tenantId, async (tx) => {
    const p = await createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: 'Kurta' } },
      variant: { price: 150_000 },
    });
    const id = p.variants[0]?.id as string;
    await receive(tx, actor, { variantId: id, quantity: 10, reason: 'received' });
    return id;
  });
});
afterAll(() => Promise.all([owner.end(), app.end()]));

async function staff(email: string) {
  const b = browser(makeEnv());
  expect((await signIn(b, owner, email)).status).toBe(200);
  expect((await b.call('PUT', '/api/admin/me/active-store', { tenantId })).status).toBe(200);
  return b;
}

const manual = (extra: Record<string, unknown> = {}) => ({
  source: 'facebook',
  lines: [{ variantId: variant, quantity: 2 }],
  contact: { name: 'Nasrin', phone: '01712-000111' },
  address: { divisionId: 6, districtId: 47, areaId: 513, line: 'Flat 3B' },
  ...extra,
});

describe('a manual order from entry to completed', () => {
  it('prices, places once per key, confirms, ships, delivers and completes', async () => {
    const b = await staff(ownerEmail);
    // Prices show while the order is typed, before the customer is entered.
    const early = (await (
      await b.post('/api/admin/orders/quote', manual({ contact: undefined }))
    ).json()) as Json;
    expect(early).toMatchObject({ blocked: false, quote: { totals: { total: 307_000 } } });
    const quote = (await (await b.post('/api/admin/orders/quote', manual())).json()) as Json;
    expect(quote).toMatchObject({
      blocked: false,
      firstOrder: true,
      quote: { totals: { total: 307_000 } },
    });

    const key = { 'idempotency-key': `manual-${Date.now()}` };
    const placed = await b.post('/api/admin/orders', manual(), key);
    expect(placed.status).toBe(201);
    const order = (await placed.json()) as Json;
    const again = (await (await b.post('/api/admin/orders', manual(), key)).json()) as Json;
    expect(again.id).toBe(order.id);

    expect((await b.post(`/api/admin/orders/${order.id}/confirm`)).status).toBe(200);
    const detail = (await (await b.get(`/api/admin/orders/${order.id}`)).json()) as Json;
    expect(detail.actions).toContain('create_shipment');
    const line = detail.lines[0];
    const shipment = (await (
      await b.post(`/api/admin/orders/${order.id}/shipments`, {
        lines: [{ orderLineId: line.id, quantity: 2 }],
        carrier: 'Pathao',
      })
    ).json()) as Json;
    expect(
      (await (await b.post(`/api/admin/shipments/${shipment.id}/ship`)).json()) as Json,
    ).toMatchObject({
      status: 'processing',
      deliveryStatus: 'shipped',
    });
    const done = (await (
      await b.post(`/api/admin/shipments/${shipment.id}/deliver`, { cashCollected: true })
    ).json()) as Json;
    expect(done).toMatchObject({
      status: 'completed',
      paymentStatus: 'paid',
      deliveryStatus: 'delivered',
    });

    const list = (await (await b.get('/api/admin/orders?status=completed')).json()) as Json;
    expect(list.items.map((o: Json) => o.id)).toContain(order.id);
    const print = (await (await b.get(`/api/admin/orders/print?ids=${order.id}`)).json()) as Json;
    expect(print).toMatchObject({ store: { name: 'Admin orders' }, orders: [{ id: order.id }] });
    const dash = await b.get('/api/admin/dashboard');
    expect(dash.headers.get('cache-control')).toBe('private, max-age=60');
    expect(((await dash.json()) as Json).sales.today.orders).toBeGreaterThan(0);
  });

  it('masks the shopper for a viewer, who can’t change anything', async () => {
    const b = await staff(ownerEmail);
    const order = (await (await b.post('/api/admin/orders', manual())).json()) as Json;
    const viewerEmail = `viewer-${Date.now()}@example.test`;
    const { rows } = await owner.query<{ id: string }>(
      `insert into platform.users (name, email, email_verified) values ('Viewer', $1, true) returning id`,
      [viewerEmail],
    );
    await owner.query(
      `insert into platform.memberships (tenant_id, user_id, role) values ($1, $2, 'viewer')`,
      [tenantId, rows[0]?.id],
    );
    const viewer = await staff(viewerEmail);
    const seen = (await (await viewer.get(`/api/admin/orders/${order.id}`)).json()) as Json;
    expect(seen.contact.phone).toBe('01712-•••111');
    expect(seen.address.line).toBe('•••');
    expect((await viewer.post(`/api/admin/orders/${order.id}/confirm`)).status).toBe(403);
    expect((await viewer.get('/api/admin/customers')).status).toBe(403);
  });
});

describe('orders from chat (phase-9-plan §3.1)', () => {
  it('reads a pasted chat, places a WhatsApp order and writes its summary for the chat', async () => {
    const b = await staff(ownerEmail);
    const first = (await (
      await b.post('/api/admin/orders', manual({ source: 'whatsapp' }))
    ).json()) as Json;
    const placed = (await (await b.get(`/api/admin/orders/${first.id}`)).json()) as Json;
    expect(placed.source).toBe('whatsapp');

    const chat = [
      'Assalamu alaikum, ami ei ta nite chai:',
      `https://shop.example.test/products/kurta?v=${variant} × 3`,
      'https://shop.example.test/products/no-such-thing',
      `my number ০১৭১২-০০০১১১, ager order ${first.displayNumber}`,
    ].join('\n');
    const res = await b.post('/api/admin/orders/parse-chat', { text: chat });
    const parsed = (await res.json()) as Json;
    expect(res.status, JSON.stringify(parsed)).toBe(200);
    expect(parsed).toMatchObject({
      phone: '+8801712000111',
      customer: { name: 'Nasrin' },
      lines: [{ variantId: variant, quantity: 3, title: { en: 'Kurta' }, orderable: true }],
      unknownProducts: ['no-such-thing'],
      orders: [{ id: first.id, displayNumber: first.displayNumber }],
    });

    const summary = (await (
      await b.post(`/api/admin/orders/${first.id}/chat-message`, { kind: 'summary' })
    ).json()) as Json;
    expect(summary.text).toContain('Hello Nasrin, here is your order');
    expect(summary.text).toContain('• Kurta × 2');
    expect(summary.whatsappUrl).toMatch(/^https:\/\/wa\.me\/8801712000111\?text=Hello/);
  });
});

describe('settings for selling', () => {
  it('edits delivery zones, the blocklist and the checkout settings', async () => {
    const b = await staff(ownerEmail);
    const zones = (await (await b.get('/api/admin/delivery-zones')).json()) as Json;
    expect(zones.map((z: Json) => z.name.en)).toEqual([
      'Inside Dhaka',
      'Dhaka suburbs',
      'Outside Dhaka',
    ]);
    const fee = (await (
      await b.post('/api/admin/delivery-zones/quote', { areaId: 513, weightGrams: 2500 })
    ).json()) as Json;
    expect(fee).toMatchObject({ fee: 11_000, zone: { name: { en: 'Inside Dhaka' } } });
    // A district already covered can't go into a second zone.
    const taken = await b.post('/api/admin/delivery-zones', {
      name: { en: 'Again' },
      fee: 5000,
      areaIds: [513],
    });
    expect(taken.status).toBe(409);

    expect(
      (await b.post('/api/admin/blocked-phones', { phone: '01999-000000', reason: 'fake orders' }))
        .status,
    ).toBe(201);
    const blocked = (await (await b.get('/api/admin/blocked-phones')).json()) as Json;
    expect(blocked[0]).toMatchObject({ phone: '+8801999000000', reason: 'fake orders' });
    const warned = (await (
      await b.post(
        '/api/admin/orders/quote',
        manual({ contact: { name: 'X', phone: '01999000000' } }),
      )
    ).json()) as Json;
    expect(warned.blocked).toBe(true);
    expect(
      (await b.call('DELETE', `/api/admin/blocked-phones/${encodeURIComponent('+8801999000000')}`))
        .status,
    ).toBe(204);

    const store = (await (
      await b.call('PATCH', '/api/admin/store', {
        checkout: {
          email: 'required',
          maxQuantityPerLine: 5,
          orderNumberPrefix: 'AR-',
          rateLimits: { perPhoneHour: 3, perPhoneDay: 10, perIpHour: 10 },
          accounts: false,
          termsCheckbox: false,
        },
        cod: { enabled: true, maxOrderValue: 1_000_000, advance: 'never' },
      })
    ).json()) as Json;
    expect(store.checkout.orderNumberPrefix).toBe('AR-');
    const next = (await (await b.post('/api/admin/orders', manual())).json()) as Json;
    expect(next.displayNumber).toMatch(/^AR-\d+$/);
  });
});

describe('promotions over HTTP', () => {
  it('builds a campaign, tries it on the test cart, generates codes and lists the figures', async () => {
    const b = await staff(ownerEmail);
    const draft = {
      title: { en: 'Free delivery over ৳2,000' },
      kind: 'automatic',
      status: 'active',
      conditions: { minSubtotal: 200_000 },
      action: { type: 'delivery_percent_off', percentBp: 10_000 },
    };
    const tried = (await (
      await b.post('/api/admin/promotions/test', {
        lines: [{ variantId: variant, quantity: 1 }],
        areaId: 513,
        draft,
      })
    ).json()) as Json;
    expect(tried.results).toEqual([
      expect.objectContaining({ applied: false, reason: 'min_subtotal' }),
    ]);
    const created = await b.post('/api/admin/promotions', draft);
    expect(created.status).toBe(201);
    const promo = (await created.json()) as Json;
    expect(promo).toMatchObject({ state: 'live', orders: 0, sales: 0 });

    const coded = (await (
      await b.post('/api/admin/promotions', {
        title: { en: 'VIP' },
        kind: 'code',
        action: { type: 'percent_off_order', percentBp: 500 },
      })
    ).json()) as Json;
    const batch = await b.post(`/api/admin/promotions/${coded.id}/codes`, { count: 25 });
    expect(batch.status).toBe(201);
    expect(((await batch.json()) as Json).codes).toHaveLength(25);
    const codes = (await (await b.get(`/api/admin/promotions/${coded.id}/codes`)).json()) as Json;
    expect(codes.items).toHaveLength(25);

    const ended = await b.call('PATCH', `/api/admin/promotions/${promo.id}`, { status: 'ended' });
    expect(((await ended.json()) as Json).state).toBe('ended');
    const list = (await (await b.get('/api/admin/promotions?state=ended')).json()) as Json;
    expect(list.map((p: Json) => p.id)).toEqual([promo.id]);
  });
});
