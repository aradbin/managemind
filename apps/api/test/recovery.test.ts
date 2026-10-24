// Sales recovery's admin routes over HTTP (phase-6-plan §6, §10): the score
// on the routes that show it, and what one store's records never reveal to
// another.
import {
  cancelOrder,
  createManualOrder,
  createProduct,
  createTenant,
  issueLink,
  receive,
  systemActor,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { browser, signIn } from './staff';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
let app: pg.Client;
interface Store {
  id: string;
  host: string;
  email: string;
  variant: string;
  actor: Parameters<typeof createManualOrder>[1];
}
let a: Store;
let b: Store;

async function makeStore(name: string): Promise<Store> {
  const slug = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `${slug}@example.test`;
  const created = await createTenant(app, systemActor, {
    slug,
    name,
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
      translations: { en: { title: 'Kurta' } },
      variant: { price: 150_000 },
    });
    const id = p.variants[0]?.id as string;
    await receive(tx, actor, { variantId: id, quantity: 50, reason: 'received' });
    return id;
  });
  return { id: created.id, host: `${slug}.${makeEnv().STORE_DOMAIN}`, email, variant, actor };
}

beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  a = await makeStore('Recovery A');
  b = await makeStore('Recovery B');
});
afterAll(() => Promise.all([owner.end(), app.end()]));

async function staff(s: Store) {
  const br = browser(makeEnv());
  expect((await signIn(br, owner, s.email)).status).toBe(200);
  expect((await br.call('PUT', '/api/admin/me/active-store', { tenantId: s.id })).status).toBe(200);
  return br;
}

const address = { divisionId: 6, districtId: 47, areaId: 513, line: 'Flat 3B' };
const order = (s: Store, phone: string) =>
  withTenant(app, s.id, (tx) =>
    createManualOrder(tx, s.actor, {
      source: 'phone',
      lines: [{ variantId: s.variant, quantity: 1 }],
      contact: { name: 'Nasrin', phone },
      address,
    }),
  );

describe('the delivery success score', () => {
  it('shows on the phone route, the order list and the order', async () => {
    const phone = '+8801712000201';
    const first = await order(a, phone);
    await withTenant(app, a.id, (tx) =>
      cancelOrder(tx, a.actor, first.id, { reason: 'Never ordered', code: 'fake' }),
    );
    const second = await order(a, phone);
    const br = await staff(a);
    const risk = (await (await br.get('/api/admin/phones/01712000201/risk')).json()) as Json;
    expect(risk).toMatchObject({ score: 0, decided: 1, history: { fake: 1, open: 1 } });
    const list = (await (await br.get('/api/admin/orders?q=12000201')).json()) as Json;
    expect(list.items[0]).toMatchObject({ id: second.id, risk: { score: 0 }, flags: [] });
    const detail = (await (await br.get(`/api/admin/orders/${second.id}`)).json()) as Json;
    expect(detail).toMatchObject({ phoneScoreAtPlacement: 0, risk: { score: 0 } });
    const cancelled = (await (await br.get(`/api/admin/orders/${first.id}`)).json()) as Json;
    expect(cancelled.cancelCode).toBe('fake');
    expect((await br.get('/api/admin/phones/12345/risk')).status).toBe(422);
  });

  it("never counts another store's orders", async () => {
    const phone = '+8801712000202';
    const theirs = await order(b, phone);
    await withTenant(app, b.id, (tx) =>
      cancelOrder(tx, b.actor, theirs.id, { reason: 'Fake', code: 'fake' }),
    );
    const br = await staff(a);
    const risk = (await (await br.get(`/api/admin/phones/${phone}/risk`)).json()) as Json;
    expect(risk).toMatchObject({ score: null, decided: 0, history: { fake: 0, open: 0 } });
  });

  it('takes a cancel code on the cancel route, and refuses an unknown one', async () => {
    const placed = await order(a, '+8801712000203');
    const br = await staff(a);
    const bad = await br.post(`/api/admin/orders/${placed.id}/cancel`, {
      reason: 'x',
      code: 'bogus',
    });
    expect(bad.status).toBe(422);
    const ok = await br.post(`/api/admin/orders/${placed.id}/cancel`, {
      reason: 'Wrong number',
      code: 'wrong_number',
    });
    expect(ok.status).toBe(200);
    const detail = (await (await br.get(`/api/admin/orders/${placed.id}`)).json()) as Json;
    expect(detail.cancelCode).toBe('wrong_number');
  });
});

describe('duplicates over HTTP', () => {
  it('flags, then merges once per key', async () => {
    const phone = '+8801712000301';
    const older = await order(a, phone);
    const newer = await order(a, phone);
    const br = await staff(a);
    const detail = (await (await br.get(`/api/admin/orders/${newer.id}`)).json()) as Json;
    expect(detail).toMatchObject({ flags: ['possible_duplicate'], duplicateOf: { id: older.id } });
    const key = { 'idempotency-key': `merge-${Date.now()}` };
    const merged = await br.post(`/api/admin/orders/${newer.id}/duplicate/merge`, {}, key);
    expect(merged.status).toBe(200);
    expect(((await merged.json()) as Json).lines[0].quantity).toBe(2);
    const again = await br.post(`/api/admin/orders/${newer.id}/duplicate/merge`, {}, key);
    expect(((await again.json()) as Json).id).toBe(older.id);
  });

  it('dismisses, and answers 409 for an order that is not flagged', async () => {
    const phone = '+8801712000302';
    await order(a, phone);
    const newer = await order(a, phone);
    const br = await staff(a);
    const res = await br.post(`/api/admin/orders/${newer.id}/duplicate/dismiss`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).flags).toEqual([]);
    expect((await br.post(`/api/admin/orders/${newer.id}/duplicate/dismiss`)).status).toBe(409);
  });
});

describe('the SMS link page over HTTP', () => {
  const env = makeEnv();
  const call = async (host: string, path: string, body: unknown, ip = '203.0.113.21') => {
    const ctx = makeCtx();
    const res = await createApp().request(
      path,
      {
        method: 'POST',
        headers: {
          'x-forwarded-host': host,
          'x-shopper-ip': ip,
          origin: `https://${host}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      },
      env,
      ctx,
    );
    await ctx.settle();
    return res;
  };
  const linked = async (phone: string) => {
    const placed = await order(a, phone);
    const code = (await withTenant(app, a.id, (tx) =>
      issueLink(tx, 'test-key', placed.id, 1),
    )) as string;
    return { placed, code };
  };

  it("shows the order on its store's host only, then confirms it once", async () => {
    const { placed, code } = await linked('+8801712000401');
    const view = await call(a.host, '/v1/store/confirm/view', { code });
    expect(view.status).toBe(200);
    expect(view.headers.get('cache-control')).toBe('no-store');
    const body = (await view.json()) as Json;
    expect(body).toMatchObject({ displayNumber: placed.displayNumber, storeName: 'Recovery A' });
    expect(JSON.stringify(body)).not.toMatch(/Flat 3B|01712000401|8801712000401/);
    // Store A's code on store B's host finds nothing.
    expect((await call(b.host, '/v1/store/confirm/view', { code })).status).toBe(404);

    const answer = await call(a.host, '/v1/store/confirm', { code, action: 'confirm' });
    expect(((await answer.json()) as Json).result).toBe('confirmed');
    expect((await call(a.host, '/v1/store/confirm', { code, action: 'confirm' })).status).toBe(404);
  });

  it('locks an IP out after 5 wrong codes', async () => {
    const { code } = await linked('+8801712000402');
    const ip = '203.0.113.77';
    for (let i = 0; i < 5; i++) {
      const res = await call(a.host, '/v1/store/confirm/view', { code: `Wrong${i}abcd` }, ip);
      expect(res.status).toBe(404);
    }
    expect((await call(a.host, '/v1/store/confirm/view', { code }, ip)).status).toBe(429);
    // Another IP still gets in.
    expect((await call(a.host, '/v1/store/confirm/view', { code })).status).toBe(200);
  });
});

describe('saving the checkout over HTTP', () => {
  const env = makeEnv();
  /** A shopper with a cart on store A: the cart cookie the API set. */
  async function shopperWithCart() {
    const jar = new Map<string, string>();
    const call = async (method: string, path: string, body?: unknown) => {
      const ctx = makeCtx();
      const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await createApp().request(
        path,
        {
          method,
          headers: {
            'x-forwarded-host': a.host,
            'x-shopper-ip': '203.0.113.31',
            origin: `https://${a.host}`,
            ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            ...(cookie ? { cookie } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        env,
        ctx,
      );
      await ctx.settle();
      for (const line of res.headers.getSetCookie()) {
        const [pair = ''] = line.split(';');
        const [name = '', value = ''] = pair.split('=');
        jar.set(name, value);
      }
      return res;
    };
    expect(
      (await call('POST', '/v1/store/cart/lines', { variantId: a.variant, quantity: 1 })).status,
    ).toBe(200);
    return call;
  }
  const saved = (phone: string) =>
    owner
      .query<{ status: string }>('select status from store.incomplete_orders where phone = $1', [
        phone,
      ])
      .then((r) => r.rows);

  it("saves the cookie's cart, says so at checkout, and stops on Don't save", async () => {
    const call = await shopperWithCart();
    const state = (await (await call('GET', '/v1/store/checkout')).json()) as Json;
    expect(state.recovery).toEqual({ save: true });
    const phone = '+8801712000501';
    expect((await call('PUT', '/v1/store/checkout/draft', { phone: '01712000501' })).status).toBe(
      204,
    );
    expect(await saved(phone)).toEqual([{ status: 'open' }]);
    expect((await call('PUT', '/v1/store/checkout/draft', { phone: 'nope' })).status).toBe(422);
    expect((await call('DELETE', '/v1/store/checkout/draft')).status).toBe(204);
    expect(await saved(phone)).toEqual([]);
    expect((await call('PUT', '/v1/store/checkout/draft', { phone })).status).toBe(409);
    const after = (await (await call('GET', '/v1/store/checkout')).json()) as Json;
    expect(after.recovery).toEqual({ save: false });
  });

  it('refuses a save without a cart', async () => {
    const ctx = makeCtx();
    const res = await createApp().request(
      '/v1/store/checkout/draft',
      {
        method: 'PUT',
        headers: {
          'x-forwarded-host': a.host,
          origin: `https://${a.host}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ phone: '01712000502' }),
      },
      env,
      ctx,
    );
    await ctx.settle();
    expect(res.status).toBe(404);
  });

  it('lists it for staff, who see the score and can dismiss it', async () => {
    await owner.query(
      `update platform.tenants set settings = jsonb_set(settings, '{recovery}', '{"showAfterMinutes": 0}') where id = $1`,
      [a.id],
    );
    try {
      const call = await shopperWithCart();
      await call('PUT', '/v1/store/checkout/draft', { phone: '01712000503', name: 'Lima' });
      const br = await staff(a);
      const list = (await (await br.get('/api/admin/incomplete-orders')).json()) as Json;
      const item = list.items.find((i: Json) => i.phone === '+8801712000503');
      expect(item).toMatchObject({ name: 'Lima', status: 'open', risk: { score: null } });
      const dismissed = await br.post(`/api/admin/incomplete-orders/${item.id}/dismiss`, {
        note: 'Test order',
      });
      expect(((await dismissed.json()) as Json).status).toBe('dismissed');
    } finally {
      await owner.query(
        `update platform.tenants set settings = settings - 'recovery' where id = $1`,
        [a.id],
      );
    }
  });
});
