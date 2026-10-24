// Sales recovery's admin routes over HTTP (phase-6-plan §6, §10): the score
// on the routes that show it, and what one store's records never reveal to
// another.
import {
  cancelOrder,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browser, signIn } from './staff';
import { appUrl, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

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
  return { id: created.id, email, variant, actor };
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
