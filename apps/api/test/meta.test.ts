// The Conversions API (phase-9-plan §3.1.6): a website purchase with the
// shopper's consent is reported once, with hashed contact details and the
// pixel's event ID; nothing without consent or for staff orders; at
// confirmation when the store says so; and a delivery when asked.
import { createHash } from 'node:crypto';
import {
  type Actor,
  createProduct,
  createTenant,
  importKeyring,
  type OutboxEvent,
  receive,
  saveCredentials,
  systemActor,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { fakeMetaEvents, reportToMeta } from '../src/meta';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const CREDENTIALS_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));
const env = makeEnv({ CREDENTIALS_KEY });
const PIXEL = '123456789012345';
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connect(appUrl), connect(ownerUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => Promise.all([app.end(), owner.end()]));
beforeEach(() => {
  fakeMetaEvents.length = 0;
  env.OUTBOX.sent.length = 0;
});

async function store(meta: Record<string, unknown> = {}) {
  const slug = `meta${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const { id } = await createTenant(app, systemActor, {
    slug,
    name: 'Meta Shop',
    defaultLocale: 'en',
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  const actor: Actor = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000b1',
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: id,
    storeRole: 'owner',
  };
  const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, id, fn);
  const product = await run((tx) =>
    createProduct(tx, actor, {
      status: 'active',
      translations: { en: { title: 'Saree' } },
      variant: { price: 100_000 },
    }),
  );
  const variant = product.variants[0]?.id as string;
  await run((tx) => receive(tx, actor, { variantId: variant, quantity: 5, reason: 'received' }));
  const keyring = await importKeyring(CREDENTIALS_KEY);
  await run((tx) =>
    saveCredentials(
      tx,
      actor,
      keyring,
      'meta_capi',
      { provider: 'meta_capi', secrets: { accessToken: 'fake' }, config: { pixelId: PIXEL } },
      async () => {},
    ),
  );
  await owner.query(
    `update platform.tenants set settings = jsonb_set(settings, '{meta}', $2::jsonb) where id = $1`,
    [
      id,
      JSON.stringify({
        feed: { enabled: false },
        purchaseAt: 'placed',
        deliveredEvent: false,
        ...meta,
      }),
    ],
  );
  return { id, host: `${slug}.${env.STORE_DOMAIN}`, variant, actor };
}

async function call(host: string, method: string, path: string, body?: unknown, extra = {}) {
  const ctx = makeCtx();
  const res = await createApp().request(
    path,
    {
      method,
      headers: {
        'x-forwarded-host': host,
        'x-shopper-ip': '203.0.113.9',
        'user-agent': 'Mozilla/5.0 test',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    env,
    ctx,
  );
  await ctx.settle();
  return res;
}

/** A storefront order, with what checkout sends when the shopper consented. */
async function checkout(s: Awaited<ReturnType<typeof store>>, attribution?: Json) {
  const jar: string[] = [];
  const shop = async (method: string, path: string, body?: unknown, extra = {}) => {
    const res = await call(s.host, method, path, body, {
      ...(jar.length ? { cookie: jar.join('; ') } : {}),
      ...extra,
    });
    for (const line of res.headers.getSetCookie()) jar.push(line.split(';')[0] as string);
    return res;
  };
  await shop('POST', '/v1/store/cart/lines', { variantId: s.variant, quantity: 1 });
  await shop('PUT', '/v1/store/cart/area', { areaId: 513 });
  const state: Json = await (await shop('GET', '/v1/store/checkout')).json();
  const res = await shop(
    'POST',
    '/v1/store/checkout/orders',
    {
      contact: { name: 'Rina Akter', phone: '01712345678', email: 'Rina@Example.test' },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'House 1' },
      expectedTotal: state.cart.totals.total,
      ...(attribution ? { attribution } : {}),
    },
    { 'idempotency-key': `k-${crypto.randomUUID()}` },
  );
  const order = (await res.json()) as Json;
  expect(res.status, JSON.stringify(order)).toBe(201);
  return order;
}

const eventsOf = (type: string) =>
  (env.OUTBOX.sent as OutboxEvent[]).filter((e) => e.eventType === type);
const report = async (events: OutboxEvent[]) => {
  for (const e of events) await reportToMeta(env, makeCtx(), e);
};
const logged = async (orderId: string) =>
  (
    await owner.query<{ name: string; status: string; reason: string | null }>(
      'select name, status, reason from store.meta_events where order_id = $1 order by name',
      [orderId],
    )
  ).rows;

const attribution = {
  fbp: 'fb.1.1730000000000.1234567890',
  fbc: 'fb.1.1730000000000.IwAR0abc',
  utm: { source: 'facebook', campaign: 'eid' },
};

describe('the Conversions API', () => {
  it('reports a consented purchase once, matched by hashed details and the pixel’s event ID', async () => {
    const s = await store();
    const order = await checkout(s, attribution);
    await report(eventsOf('order.placed'));
    expect(fakeMetaEvents).toHaveLength(1);
    const [event] = fakeMetaEvents as Json[];
    expect(event).toMatchObject({
      event_name: 'Purchase',
      event_id: order.id,
      action_source: 'website',
      user_data: {
        ph: [sha('8801712345678')],
        em: [sha('rina@example.test')],
        fn: [sha('rina')],
        ln: [sha('akter')],
        country: [sha('bd')],
        client_ip_address: '203.0.113.9',
        client_user_agent: 'Mozilla/5.0 test',
        fbp: attribution.fbp,
        fbc: attribution.fbc,
      },
      custom_data: {
        currency: 'BDT',
        contents: [{ id: s.variant, quantity: 1, item_price: 1000 }],
        num_items: 1,
      },
    });
    expect(event.event_source_url).toContain('/checkout');
    expect(await logged(order.id)).toEqual([{ name: 'Purchase', status: 'sent', reason: null }]);
    // A redelivered event reports nothing more.
    await report(eventsOf('order.placed'));
    expect(fakeMetaEvents).toHaveLength(1);
    const { rows } = await owner.query('select attribution from store.orders where id = $1', [
      order.id,
    ]);
    expect(rows[0].attribution).toMatchObject({ ...attribution, consentedAt: expect.any(String) });
  });

  it('sends nothing without consent, and logs why', async () => {
    const s = await store();
    const order = await checkout(s);
    await report(eventsOf('order.placed'));
    expect(fakeMetaEvents).toHaveLength(0);
    expect(await logged(order.id)).toEqual([
      { name: 'Purchase', status: 'skipped', reason: 'no_consent' },
    ]);
  });

  it('reports at confirmation when the store says so, and the pixel holds back', async () => {
    const s = await store({ purchaseAt: 'confirmed' });
    const order = await checkout(s, attribution);
    await report(eventsOf('order.placed'));
    expect(fakeMetaEvents).toHaveLength(0);
    const page: Json = await (await call(s.host, 'GET', '/v1/store/pages/layout')).json();
    expect(page.layout.pixelPurchase).toBe(false);
    await report([
      {
        id: crypto.randomUUID(),
        tenantId: s.id,
        eventType: 'order.confirmed',
        aggregateType: 'order',
        aggregateId: order.id,
        payload: { number: order.number },
        requestId: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(fakeMetaEvents).toHaveLength(1);
    expect(Math.abs((fakeMetaEvents[0]?.event_time ?? 0) - Date.now() / 1000)).toBeLessThan(60);
  });

  it('reports a delivery as its own event once the whole order is delivered', async () => {
    const s = await store({ deliveredEvent: true });
    const order = await checkout(s, attribution);
    const delivered = {
      id: crypto.randomUUID(),
      tenantId: s.id,
      eventType: 'shipment.delivered',
      aggregateType: 'shipment',
      aggregateId: crypto.randomUUID(),
      payload: { orderId: order.id },
      requestId: null,
      createdAt: new Date().toISOString(),
    } as OutboxEvent;
    await report([delivered]);
    expect(fakeMetaEvents).toHaveLength(0);
    await owner.query(`update store.orders set delivery_status = 'delivered' where id = $1`, [
      order.id,
    ]);
    await report([delivered]);
    expect(fakeMetaEvents.map((e) => [e.event_name, e.event_id])).toEqual([
      ['Delivered', `${order.id}:delivered`],
    ]);
  });

  it('sends nothing for an order staff entered', async () => {
    const s = await store();
    const placed = await withTenant(app, s.id, async (tx) => {
      const { createManualOrder } = await import('@managemind/core');
      return createManualOrder(tx, s.actor, {
        source: 'whatsapp',
        lines: [{ variantId: s.variant, quantity: 1 }],
        contact: { name: 'Nasrin', phone: '01712000555' },
        address: { divisionId: 6, districtId: 47, areaId: 513, line: 'Flat 3B' },
      });
    });
    await report([
      {
        id: crypto.randomUUID(),
        tenantId: s.id,
        eventType: 'order.placed',
        aggregateType: 'order',
        aggregateId: (placed as Json).id,
        payload: {},
        requestId: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    expect(fakeMetaEvents).toHaveLength(0);
    expect(await logged((placed as Json).id)).toEqual([]);
  });
});
