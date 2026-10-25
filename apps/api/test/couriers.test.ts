// Couriers over HTTP (phase-7-plan §3.3–§3.5, §6, §10) with the test
// courier: connecting it, booking one order and many, its parcel moving to
// delivered through the webhook, forged webhooks changing nothing, another
// store's parcels out of reach, the poll's messages, and no test courier in
// production.
import {
  confirmOrder,
  createManualOrder,
  createProduct,
  createTenant,
  receive,
  systemActor,
  withTenant,
} from '@managemind/core';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import {
  autoBook,
  type CourierMessage,
  courierFromParam,
  fakeAllowed,
  handleCourierMessages,
  pollCouriers,
} from '../src/couriers';
import { browser, signIn } from './staff';
import { appUrl, makeCtx, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

const CREDENTIALS_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
class Delayed {
  sent: CourierMessage[] = [];
  async send(body: CourierMessage) {
    this.sent.push(body);
  }
  async sendBatch(batch: { body: CourierMessage }[]) {
    for (const m of batch) this.sent.push(m.body);
  }
}
const delayed = new Delayed();
const env = makeEnv({ CREDENTIALS_KEY, DOMAINS: delayed as never });

let owner: pg.Client;
let app: pg.Client;
interface Store {
  id: string;
  email: string;
  variant: string;
  actor: Parameters<typeof createManualOrder>[1];
}
let a: Store;
let b: Store;

async function makeStore(name: string): Promise<Store> {
  const slug = `cr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
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
      translations: { en: { title: 'Panjabi' } },
      variant: { price: 120_000 },
    });
    const id = p.variants[0]?.id as string;
    await receive(tx, actor, { variantId: id, quantity: 50, reason: 'received' });
    return id;
  });
  return { id: created.id, email, variant, actor };
}

beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  a = await makeStore('Couriers A');
  b = await makeStore('Couriers B');
});
afterAll(() => Promise.all([owner.end(), app.end()]));

/** One signed-in browser per store: sign-in codes are rate-limited. */
const browsers = new Map<string, ReturnType<typeof browser>>();
async function staff(s: Store) {
  const known = browsers.get(s.id);
  if (known) return known;
  const br = browser(env);
  expect((await signIn(br, owner, s.email)).status).toBe(200);
  expect((await br.call('PUT', '/api/admin/me/active-store', { tenantId: s.id })).status).toBe(200);
  browsers.set(s.id, br);
  return br;
}

let phones = 0;
async function confirmed(s: Store) {
  const placed = await withTenant(app, s.id, (tx) =>
    createManualOrder(tx, s.actor, {
      source: 'phone',
      lines: [{ variantId: s.variant, quantity: 1 }],
      contact: { name: 'Karim', phone: `+88017130003${String(++phones).padStart(2, '0')}` },
      address: { divisionId: 6, districtId: 47, areaId: 513, line: 'Road 4' },
    }),
  );
  await withTenant(app, s.id, (tx) => confirmOrder(tx, s.actor, placed.id));
  return placed.id;
}

async function webhook(courier: string, tenantId: string, body: unknown, auth?: string) {
  const ctx = makeCtx();
  const res = await createApp().request(
    `/v1/webhooks/couriers/${courier}/${tenantId}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '203.0.113.21',
        ...(auth ? { authorization: auth } : {}),
      },
      body: JSON.stringify(body),
    },
    env,
    ctx,
  );
  await ctx.settle();
  return res;
}

describe('connecting a courier', () => {
  it('saves the keys, offers the test courier outside production, and shows the webhook', async () => {
    const br = await staff(a);
    expect(
      (await br.call('PUT', '/api/admin/couriers/fake', { secrets: { apiKey: 'wrong' } })).status,
    ).toBe(422);
    expect(
      (await br.call('PUT', '/api/admin/couriers/fake', { secrets: { apiKey: 'k' } })).status,
    ).toBe(200);
    const list = (await (await br.get('/api/admin/couriers')).json()) as Json;
    expect(list.available).toEqual(['steadfast', 'pathao', 'redx', 'fake']);
    expect(list.connected).toMatchObject([{ courier: 'fake' }]);
    const hook = (await (await br.get('/api/admin/couriers/fake/webhook')).json()) as Json;
    expect(hook.url).toBe(`https://admin.platform.example.test/v1/webhooks/couriers/fake/${a.id}`);
    expect(hook.secret).toMatch(/^[A-Za-z0-9_-]{32,64}$/);
    // Saving again keeps the secret the courier's panel has.
    await br.call('PUT', '/api/admin/couriers/fake', { secrets: { apiKey: 'k2' } });
    const again = (await (await br.get('/api/admin/couriers/fake/webhook')).json()) as Json;
    expect(again.secret).toBe(hook.secret);
    // The generic credentials route takes no courier.
    expect(
      (await br.call('PUT', '/api/admin/credentials/fake', { provider: 'fake', secrets: {} }))
        .status,
    ).toBe(422);
  });

  it('never offers the test courier in production', () => {
    const production = makeEnv({ ENVIRONMENT: 'production' });
    expect(fakeAllowed(production)).toBe(false);
    expect(() => courierFromParam(production, 'fake')).toThrow();
    expect(courierFromParam(production, 'steadfast')).toBe('steadfast');
  });
});

describe('booking and the webhook', () => {
  it('books one order, then delivers it from the courier’s webhook', async () => {
    const br = await staff(a);
    const orderId = await confirmed(a);
    const preview = (await (
      await br.post(`/api/admin/orders/${orderId}/booking/preview`, { courier: 'fake' })
    ).json()) as Json;
    expect(preview.problems).toEqual([]);
    const booked = (await (
      await br.post(`/api/admin/orders/${orderId}/booking`, { courier: 'fake' })
    ).json()) as Json;
    expect(booked).toMatchObject({ result: 'booked', consignmentId: expect.stringMatching(/^FK/) });

    const moved = await br.post(`/api/admin/couriers/fake/parcels/${booked.consignmentId}`, {
      status: 'delivered',
      codCollected: preview.codAmount,
    });
    expect(((await moved.json()) as Json).ok).toBe(true);
    const detail = (await (await br.get(`/api/admin/orders/${orderId}`)).json()) as Json;
    expect(detail).toMatchObject({ deliveryStatus: 'delivered', paymentStatus: 'paid' });
    expect(detail.shipments[0].courier.events.map((e: Json) => e.update)).toEqual([
      'booked',
      'delivered',
    ]);
  });

  it('refuses a forged webhook, and finds nothing of another store', async () => {
    const orderId = await confirmed(a);
    const br = await staff(a);
    const booked = (await (
      await br.post(`/api/admin/orders/${orderId}/booking`, { courier: 'fake' })
    ).json()) as Json;
    expect((await webhook('fake', a.id, { consignment_id: booked.consignmentId })).status).toBe(
      401,
    );
    expect(
      (await webhook('fake', a.id, { consignment_id: booked.consignmentId }, 'Bearer wrong'))
        .status,
    ).toBe(401);
    // Store B has no courier: its URL is a 404 whatever is sent.
    expect((await webhook('fake', b.id, { consignment_id: booked.consignmentId })).status).toBe(
      404,
    );
    expect((await webhook('steadfast', a.id, {})).status).toBe(404);
    expect((await webhook('fake', 'not-a-uuid', {})).status).toBe(404);
    expect(
      (await webhook('fake', a.id, { consignment_id: 'x'.repeat(20_000) }, 'Bearer x')).status,
    ).toBe(413);

    // B connects too; B's secret names A's parcel and finds nothing in B.
    const bb = await staff(b);
    await bb.call('PUT', '/api/admin/couriers/fake', { secrets: { apiKey: 'k' } });
    const hookB = (await (await bb.get('/api/admin/couriers/fake/webhook')).json()) as Json;
    const res = await webhook(
      'fake',
      b.id,
      { consignment_id: booked.consignmentId },
      `Bearer ${hookB.secret}`,
    );
    expect(res.status).toBe(200);
    expect((await bb.get(`/api/admin/orders/${orderId}`)).status).toBe(404);
    expect(
      (
        await bb.post(`/api/admin/couriers/fake/parcels/${booked.consignmentId}`, {
          status: 'delivered',
        })
      ).status,
    ).toBe(404);
    const detail = (await (await br.get(`/api/admin/orders/${orderId}`)).json()) as Json;
    expect(detail.shipments[0].status).toBe('booked');
  });

  it('cancels a booking at the courier, and syncs at most once a minute', async () => {
    const br = await staff(a);
    const orderId = await confirmed(a);
    const booked = (await (
      await br.post(`/api/admin/orders/${orderId}/booking`, { courier: 'fake' })
    ).json()) as Json;
    await br.post(`/api/admin/couriers/fake/parcels/${booked.consignmentId}`, { status: 'booked' });
    expect((await br.post(`/api/admin/shipments/${booked.shipmentId}/sync`)).status).toBe(200);
    expect((await br.post(`/api/admin/shipments/${booked.shipmentId}/sync`)).status).toBe(429);
    const cancelled = await br.post(`/api/admin/shipments/${booked.shipmentId}/cancel-booking`, {});
    expect(((await cancelled.json()) as Json).cancelledByApi).toBe(true);
    const detail = (await (await br.get(`/api/admin/orders/${orderId}`)).json()) as Json;
    expect(detail.shipments[0]).toMatchObject({ status: 'pending', courier: null });
  });
});

describe('bulk booking and the poll', () => {
  it('checks, queues 10 to a message, and books in the background', async () => {
    const br = await staff(a);
    const ids = [await confirmed(a), await confirmed(a)];
    const checks = (await (
      await br.post('/api/admin/shipments/book/check', { courier: 'fake', orderIds: ids })
    ).json()) as Json;
    expect(checks.map((c: Json) => c.problems)).toEqual([[], []]);
    delayed.sent = [];
    const queued = await br.post('/api/admin/shipments/book', { courier: 'fake', orderIds: ids });
    expect(queued.status).toBe(202);
    expect(delayed.sent).toMatchObject([{ kind: 'courier_book', orderIds: ids }]);

    const acks: string[] = [];
    await handleCourierMessages(
      delayed.sent.map((body) => ({
        body,
        attempts: 1,
        ack: () => acks.push('ack'),
        retry: () => acks.push('retry'),
      })) as never,
      env,
      makeCtx(),
    );
    expect(acks).toEqual(['ack']);
    const states = (await (
      await br.get(`/api/admin/shipments/bookings?orderIds=${ids.join(',')}`)
    ).json()) as Json;
    expect(states.map((s: Json) => s.status)).toEqual(['booked', 'booked']);
  });

  it('queues quiet parcels for the poll', async () => {
    const br = await staff(a);
    const orderId = await confirmed(a);
    const booked = (await (
      await br.post(`/api/admin/orders/${orderId}/booking`, { courier: 'fake' })
    ).json()) as Json;
    await owner.query(
      `update store.shipments set last_synced_at = now() - interval '7 hours' where id = $1`,
      [booked.shipmentId],
    );
    delayed.sent = [];
    await pollCouriers(env, makeCtx());
    const poll = delayed.sent.find(
      (m) => m.kind === 'courier_poll' && m.shipmentIds.includes(booked.shipmentId),
    );
    expect(poll).toMatchObject({ tenantId: a.id, courier: 'fake' });
  });
});

describe('auto-booking on confirm (Q8)', () => {
  it('queues a confirmed order only for a store that turned it on', async () => {
    const orderId = await confirmed(a);
    const event = {
      id: crypto.randomUUID(),
      tenantId: a.id,
      eventType: 'order.confirmed',
      aggregateType: 'order',
      aggregateId: orderId,
      payload: {},
    } as never;
    delayed.sent = [];
    await autoBook(env, makeCtx(), [event]);
    expect(delayed.sent).toEqual([]);
    await owner.query(
      `update platform.tenants set settings = jsonb_set(settings, '{couriers}', '{"autoBook": "on_confirm"}') where id = $1`,
      [a.id],
    );
    await autoBook(env, makeCtx(), [event]);
    expect(delayed.sent).toMatchObject([
      { kind: 'courier_book', tenantId: a.id, userId: null, courier: 'fake', orderIds: [orderId] },
    ]);
    await owner.query(
      `update platform.tenants set settings = settings - 'couriers' where id = $1`,
      [a.id],
    );
  });
});
