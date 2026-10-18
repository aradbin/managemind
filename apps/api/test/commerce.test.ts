// The storefront's cart, checkout and order endpoints (phase-4-plan §6.1,
// §10): cookies only on /api, idempotent checkout, tracking with its
// lockout, and another store's host never reaching a cart or an order.
import {
  type Actor,
  createProduct,
  createTenant,
  receive,
  systemActor,
  type TenantTx,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { appUrl, makeCtx, makeEnv } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const env = makeEnv();
let app: pg.Client;
beforeAll(async () => {
  app = await connect(appUrl);
});
afterAll(() => app.end());

let seq = 0;
async function store() {
  const slug = `c${Date.now().toString(36)}${seq++}`;
  const { id } = await createTenant(app, systemActor, {
    slug,
    name: `Shop ${slug}`,
    defaultLocale: 'bn',
    owner: { email: `${slug}@example.test`, name: 'Owner' },
  });
  const actor: Actor = {
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000af',
    platformRole: null,
    permissions: permissionsOf('owner'),
    tenantId: id,
    storeRole: 'owner',
  };
  const run = <T>(fn: (tx: TenantTx) => Promise<T>) => withTenant(app, id, fn);
  const product = await run((tx) =>
    createProduct(tx, actor, {
      status: 'active',
      translations: { bn: { title: 'শাড়ি' } },
      variant: { price: 100_000 },
    }),
  );
  const variant = product.variants[0]?.id as string;
  await run((tx) => receive(tx, actor, { variantId: variant, quantity: 5, reason: 'received' }));
  return { id, host: `${slug}.${env.STORE_DOMAIN}`, variant, run };
}

/** A shopper's browser on one store host: keeps the cookies the API sets for /api. */
function shopper(host: string) {
  const jar = new Map<string, string>();
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const ctx = makeCtx();
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await createApp().request(
      path,
      {
        method,
        headers: {
          'x-forwarded-host': host,
          'x-shopper-ip': '203.0.113.9',
          origin: `https://${host}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
      env,
      ctx,
    );
    await ctx.settle();
    const cookies = res.headers.getSetCookie();
    for (const line of cookies) {
      const [pair = ''] = line.split(';');
      const [name = '', value = ''] = pair.split('=');
      if (/max-age=0/i.test(line)) jar.delete(name);
      else jar.set(name, value);
    }
    return { res, cookies, json: async () => (await res.json()) as Json };
  };
  return { jar, call };
}

const address = { divisionId: 6, districtId: 47, areaId: 513, line: 'বাসা ১, রোড ২' };
const checkoutBody = (expectedTotal: number, phone = '01712345678') => ({
  contact: { name: 'রহিম', phone },
  address,
  paymentMethod: 'cod',
  expectedTotal,
});

describe('the cart', () => {
  it('sets an HttpOnly cart cookie on /api only, and a readable count cookie', async () => {
    const s = await store();
    const b = shopper(s.host);
    const empty = await b.call('GET', '/v1/store/cart');
    expect(empty.res.status).toBe(200);
    expect(await empty.json()).toMatchObject({ itemCount: 0, lines: [] });
    const added = await b.call('POST', '/v1/store/cart/lines?locale=bn', {
      variantId: s.variant,
      quantity: 2,
    });
    expect(added.res.status).toBe(200);
    const cart = added.cookies.find((c) => c.startsWith('mm_cart='));
    expect(cart).toMatch(/Path=\/api; HttpOnly; Secure; SameSite=Lax/);
    const count = added.cookies.find((c) => c.startsWith('mm_cart_n='));
    expect(count).toMatch(/^mm_cart_n=2; Path=\/; Secure; SameSite=Lax/);
    expect(count).not.toMatch(/HttpOnly/);
    expect(added.res.headers.get('cache-control')).toBe('no-store');
    const area = await b.call('PUT', '/v1/store/cart/area', { areaId: 513 });
    expect((await area.json()).totals).toMatchObject({
      subtotal: 200_000,
      deliveryFee: 7_000,
      total: 207_000,
    });
  });

  it('refuses a write from another origin', async () => {
    const s = await store();
    const b = shopper(s.host);
    const r = await b.call(
      'POST',
      '/v1/store/cart/lines',
      { variantId: s.variant, quantity: 1 },
      { origin: 'https://evil.example' },
    );
    expect(r.res.status).toBe(403);
  });
});

describe('checkout', () => {
  it('places a COD order once per key, replays a retry, and clears the cart', async () => {
    const s = await store();
    const b = shopper(s.host);
    await b.call('POST', '/v1/store/cart/lines', { variantId: s.variant, quantity: 1 });
    await b.call('PUT', '/v1/store/cart/area', { areaId: 513 });
    const state = await (await b.call('GET', '/v1/store/checkout')).json();
    expect(state).toMatchObject({
      cod: { enabled: true },
      holiday: { active: false },
      email: 'optional',
    });
    const cartCookie = b.jar.get('mm_cart') as string;
    const key = `k-${Date.now()}-checkout`;
    const first = await b.call('POST', '/v1/store/checkout/orders', checkoutBody(107_000), {
      'idempotency-key': key,
    });
    expect(first.res.status).toBe(201);
    const order = await first.json();
    expect(order).toMatchObject({ total: 107_000, codAmount: 107_000, status: 'pending' });
    expect(order.viewToken).toMatch(/^[0-9a-f-]{36}\.\d+\./);
    expect(b.jar.has('mm_cart')).toBe(false);
    // A lost response: the same key (with a new Turnstile token) returns the same order.
    b.jar.set('mm_cart', cartCookie);
    const again = await b.call(
      'POST',
      '/v1/store/checkout/orders',
      { ...checkoutBody(107_000), turnstileToken: 'another' },
      { 'idempotency-key': key },
    );
    expect(again.res.status).toBe(201);
    expect(again.res.headers.get('idempotent-replayed')).toBe('true');
    expect((await again.json()).id).toBe(order.id);
    // The confirmation page reads it with the view token.
    const view = await (
      await b.call('POST', '/v1/store/orders/view', { token: order.viewToken })
    ).json();
    expect(view).toMatchObject({ displayNumber: order.displayNumber, cancellable: true });
  });

  it('answers price_changed with the new totals', async () => {
    const s = await store();
    const b = shopper(s.host);
    await b.call('POST', '/v1/store/cart/lines', { variantId: s.variant, quantity: 1 });
    await b.call('PUT', '/v1/store/cart/area', { areaId: 513 });
    const r = await b.call('POST', '/v1/store/checkout/orders', checkoutBody(100_000), {
      'idempotency-key': `k-${Date.now()}-pc`,
    });
    expect(r.res.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'price_changed', totals: { total: 107_000 } });
  });

  it('limits orders per phone, with the store’s numbers', async () => {
    const s = await store();
    for (let i = 0; i < 4; i += 1) {
      const b = shopper(s.host);
      await b.call('POST', '/v1/store/cart/lines', { variantId: s.variant, quantity: 1 });
      await b.call('PUT', '/v1/store/cart/area', { areaId: 513 });
      const r = await b.call(
        'POST',
        '/v1/store/checkout/orders',
        checkoutBody(107_000, '01811111111'),
        {
          'idempotency-key': `k-${Date.now()}-${i}-limit`,
        },
      );
      expect(r.res.status, `order ${i + 1}`).toBe(i < 3 ? 201 : 429);
    }
  });
});

describe('tracking', () => {
  it('finds an order by number and phone, cancels it, and locks a number after 5 wrong phones', async () => {
    const s = await store();
    const b = shopper(s.host);
    await b.call('POST', '/v1/store/cart/lines', { variantId: s.variant, quantity: 1 });
    await b.call('PUT', '/v1/store/cart/area', { areaId: 513 });
    const order = await (
      await b.call('POST', '/v1/store/checkout/orders', checkoutBody(107_000, '01922222222'), {
        'idempotency-key': `k-${Date.now()}-track`,
      })
    ).json();
    const found = await b.call('POST', '/v1/store/orders/track', {
      number: order.displayNumber,
      phone: '01922-222222',
    });
    expect(found.res.status).toBe(200);
    const tracked = await found.json();
    expect(tracked.order).toMatchObject({ status: 'pending', cancellable: true });
    // The view token can't cancel; the tracking token can.
    expect(
      (await b.call('POST', '/v1/store/orders/cancel', { token: order.viewToken })).res.status,
    ).toBe(404);
    const cancelled = await (
      await b.call('POST', '/v1/store/orders/cancel', { token: tracked.token })
    ).json();
    expect(cancelled).toMatchObject({ status: 'cancelled', cancellable: false });

    for (let i = 0; i < 5; i += 1) {
      expect(
        (
          await b.call('POST', '/v1/store/orders/track', {
            number: order.displayNumber,
            phone: '01900000000',
          })
        ).res.status,
      ).toBe(404);
    }
    // Locked now, even with the right phone.
    expect(
      (
        await b.call('POST', '/v1/store/orders/track', {
          number: order.displayNumber,
          phone: '01922222222',
        })
      ).res.status,
    ).toBe(429);
  });
});

describe('isolation', () => {
  it('never lets one store’s host reach another store’s cart or order', async () => {
    const a = await store();
    const bStore = await store();
    const shopperA = shopper(a.host);
    await shopperA.call('POST', '/v1/store/cart/lines', { variantId: a.variant, quantity: 1 });
    await shopperA.call('PUT', '/v1/store/cart/area', { areaId: 513 });
    const cart = shopperA.jar.get('mm_cart') as string;
    // The same cookie on store B's host is no cart at all.
    const onB = shopper(bStore.host);
    onB.jar.set('mm_cart', cart);
    expect(await (await onB.call('GET', '/v1/store/cart')).json()).toMatchObject({ itemCount: 0 });
    expect(
      (await onB.call('PATCH', `/v1/store/cart/lines/${a.variant}`, { quantity: 2 })).res.status,
    ).toBe(404);
    // Store A's variant can't be added to a cart on store B.
    expect(
      (await onB.call('POST', '/v1/store/cart/lines', { variantId: a.variant, quantity: 1 })).res
        .status,
    ).toBe(404);
    expect(
      (
        await onB.call('POST', '/v1/store/checkout/orders', checkoutBody(107_000), {
          'idempotency-key': `k-${Date.now()}-iso`,
        })
      ).res.status,
    ).toBe(404);
    const order = await (
      await shopperA.call(
        'POST',
        '/v1/store/checkout/orders',
        checkoutBody(107_000, '01733333333'),
        {
          'idempotency-key': `k-${Date.now()}-iso-a`,
        },
      )
    ).json();
    expect(
      (await onB.call('POST', '/v1/store/orders/view', { token: order.viewToken })).res.status,
    ).toBe(404);
    expect(
      (
        await onB.call('POST', '/v1/store/orders/track', {
          number: order.displayNumber,
          phone: '01733333333',
        })
      ).res.status,
    ).toBe(404);
  });
});
