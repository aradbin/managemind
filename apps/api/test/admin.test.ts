// The admin API end to end, and the isolation suite (phase-1-plan §9): every
// /v1/admin route that takes an ID is called by a store A user with store
// B's IDs and must answer 404. A route without a fixture fails the suite,
// so new routes join it automatically.
import {
  type Actor,
  actorFor,
  createAttribute,
  createCategory,
  createCollection,
  createProduct,
  createTenant,
  grantSupportAccess,
  listLocations,
  systemActor,
  transitionTenant,
  withTenant,
} from '@managemind/core';
import { createDb } from '@managemind/db';
import { connect } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_ROUTES } from '../src/admin/routes';
import { type Browser, browser, signIn } from './staff';
import { appUrl, makeEnv, ownerUrl } from './support';

// biome-ignore lint/suspicious/noExplicitAny: response bodies; the assertions check their shape
type Json = any;

let owner: pg.Client;
let app: pg.Client;
beforeAll(async () => {
  [owner, app] = await Promise.all([connect(ownerUrl), connect(appUrl)]);
});
afterAll(() => Promise.all([owner.end(), app.end()]));

let seq = 0;
const unique = () => `a${Date.now().toString(36)}${seq++}`;

async function store() {
  const slug = unique();
  const email = `${slug}@example.test`;
  const { id, ownerUserId } = await createTenant(app, systemActor, {
    slug,
    name: `Store ${slug}`,
    defaultLocale: 'en',
    owner: { email, name: 'Owner' },
  });
  return { id, slug, email, ownerUserId };
}

async function member(tenantId: string, role: string) {
  const email = `${unique()}@example.test`;
  const { rows } = await owner.query<{ id: string }>(
    `insert into platform.users (name, email, email_verified) values ('Member', $1, true) returning id`,
    [email],
  );
  const userId = rows[0]?.id as string;
  const m = await owner.query<{ id: string }>(
    `insert into platform.memberships (tenant_id, user_id, role) values ($1, $2, $3) returning id`,
    [tenantId, userId, role],
  );
  return { email, userId, memberId: m.rows[0]?.id as string };
}

/** Signs in as `email` and makes `tenantId` the active store. */
async function staffIn(email: string, tenantId?: string, b: Browser = browser(makeEnv())) {
  expect((await signIn(b, owner, email)).status).toBe(200);
  if (tenantId)
    expect((await b.call('PUT', '/api/admin/me/active-store', { tenantId })).status).toBe(200);
  return b;
}

describe('admin API', () => {
  it('starts without a store, then switches to one the user belongs to', async () => {
    const a = await store();
    const b = await store();
    const user = await staffIn(a.email);
    const me = (await (await user.get('/api/admin/me')).json()) as Json;
    expect(me).toMatchObject({
      activeStore: null,
      role: null,
      permissions: [],
      user: { email: a.email },
    });
    expect(me.stores.map((s: { tenantId: string }) => s.tenantId)).toEqual([a.id]);
    expect((await user.get('/api/admin/store')).status).toBe(403);
    expect((await user.call('PUT', '/api/admin/me/active-store', { tenantId: b.id })).status).toBe(
      403,
    );
    const switched = (await (
      await user.call('PUT', '/api/admin/me/active-store', { tenantId: a.id })
    ).json()) as Json;
    expect(switched).toMatchObject({ activeStore: a.id, role: 'owner' });
    expect(switched.permissions).toContain('staff.manage_owners');
  });

  it('reads and edits the store; refuses edits while suspended', async () => {
    const a = await store();
    const user = await staffIn(a.email, a.id);
    const patched = await user.call('PATCH', '/api/admin/store', {
      name: 'Renamed',
      profile: { contactPhone: '01712345678' },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      name: 'Renamed',
      profile: { contactPhone: '+8801712345678' },
    });
    expect(
      (await user.call('PATCH', '/api/admin/store', { profile: { contactPhone: '123' } })).status,
    ).toBe(422);

    await transitionTenant(app, systemActor, a.id, 'suspend', { reason: 'unpaid invoice' });
    expect((await user.call('PATCH', '/api/admin/store', { name: 'Nope' })).status).toBe(423);
    expect((await (await user.get('/api/admin/store')).json()) as Json).toMatchObject({
      status: 'suspended',
    });
    const m = await member(a.id, 'viewer');
    expect((await user.call('DELETE', `/api/admin/members/${m.memberId}`)).status).toBe(423);
  });

  it('lists members in pages, changes roles and removes members', async () => {
    const a = await store();
    const staff = await member(a.id, 'staff');
    await member(a.id, 'viewer');
    const user = await staffIn(a.email, a.id);
    const page = (await (await user.get('/api/admin/members?limit=2')).json()) as Json;
    expect(page.items).toHaveLength(2);
    const rest = (await (await user.get(`/api/admin/members?after=${page.next}`)).json()) as Json;
    expect([...page.items, ...rest.items]).toHaveLength(3);

    expect(
      (await user.call('PATCH', `/api/admin/members/${staff.memberId}`, { role: 'viewer' })).status,
    ).toBe(204);
    expect((await user.call('DELETE', `/api/admin/members/${staff.memberId}`)).status).toBe(204);
    expect((await user.call('DELETE', '/api/admin/members/me')).status).toBe(409); // last owner
  });

  it('invites by email and lets the invitee accept with the emailed link', async () => {
    const a = await store();
    const user = await staffIn(a.email, a.id);
    const email = `${unique()}@example.test`;
    const invited = await user.post(
      '/api/admin/invitations',
      { email, role: 'staff' },
      { 'idempotency-key': `k-${email}` },
    );
    expect(invited.status).toBe(201);
    const again = await user.post(
      '/api/admin/invitations',
      { email, role: 'staff' },
      { 'idempotency-key': `k-${email}` },
    );
    expect(await again.json()).toEqual(await invited.json());

    const emails = await owner.query<{ text: string; subject: string }>(
      `select text, subject from platform.dev_emails where "to" = $1`,
      [email],
    );
    expect(emails.rows).toHaveLength(1); // the replay sent nothing
    const token = emails.rows[0]?.text.match(/#t=([\w-]+)/)?.[1] ?? '';
    expect(token.length).toBeGreaterThan(30);
    expect((await (await user.get('/api/admin/invitations')).json()) as Json).toMatchObject([
      { email, role: 'staff' },
    ]);

    const invitee = await staffIn(email);
    const joined = await invitee.post('/api/admin/invitations/accept', { token });
    expect(joined.status).toBe(200);
    expect(await joined.json()).toMatchObject({ activeStore: a.id, role: 'staff' });
    expect((await invitee.post('/api/admin/invitations/accept', { token })).status).toBe(410);
  });

  it('signs out a removed member at once', async () => {
    const a = await store();
    const staff = await member(a.id, 'staff');
    const theirs = await staffIn(staff.email, a.id);
    const ownerSession = await staffIn(a.email, a.id);
    expect((await theirs.get('/api/admin/store')).status).toBe(200);
    await ownerSession.call('DELETE', `/api/admin/members/${staff.memberId}`);
    expect((await theirs.get('/api/admin/store')).status).toBe(401);
  });

  it('changes the user’s own name and language', async () => {
    const a = await store();
    const user = await staffIn(a.email);
    expect(
      (await user.call('PATCH', '/api/admin/me', { name: 'New Name', locale: 'bn' })).status,
    ).toBe(204);
    expect(((await (await user.get('/api/admin/me')).json()) as Json).user).toMatchObject({
      name: 'New Name',
      locale: 'bn',
    });
  });
});

describe('isolation suite', () => {
  it('answers 404 on every admin route given another store’s IDs', async () => {
    const a = await store();
    const b = await store();
    const bMember = await member(b.id, 'staff');
    const { rows } = await owner.query<{ id: string }>(
      `insert into platform.invitations (tenant_id, email, role, token_hash, invited_by)
       values ($1, $2, 'viewer', $3, $4) returning id`,
      [b.id, `${unique()}@example.test`, unique(), b.ownerUserId],
    );
    const bInvitation = rows[0]?.id as string;

    // Store B's catalog, created by its owner.
    const bOwner: Actor = {
      kind: 'user',
      userId: b.ownerUserId,
      platformRole: null,
      permissions: permissionsOf('owner'),
      tenantId: b.id,
      storeRole: 'owner',
    };
    const inB = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(app, b.id, fn);
    const product = await inB((tx) =>
      createProduct(tx, bOwner, {
        translations: { en: { title: 'B product' } },
        variant: { price: 100 },
      }),
    );
    const variant = product.variants[0]?.id as string;
    const category = await inB((tx) =>
      createCategory(tx, bOwner, { translations: { en: { name: 'B category' } } }),
    );
    const attribute = await inB((tx) =>
      createAttribute(tx, bOwner, {
        key: 'b_only',
        type: 'choice',
        translations: { en: { name: 'B attribute' } },
      }),
    );
    const collection = await inB((tx) =>
      createCollection(tx, bOwner, { kind: 'manual', translations: { en: { name: 'B picks' } } }),
    );
    const [location] = await inB((tx) => listLocations(tx, bOwner));

    /** Store B's resource for each route with an ID; a new route must add one. */
    const fixtures: Record<string, { id: string; body?: unknown }> = {
      'PATCH /v1/admin/members/{id}': { id: bMember.memberId, body: { role: 'viewer' } },
      'DELETE /v1/admin/members/{id}': { id: bMember.memberId },
      'POST /v1/admin/invitations/{id}/resend': { id: bInvitation },
      'DELETE /v1/admin/invitations/{id}': { id: bInvitation },
      'GET /v1/admin/products/{id}': { id: product.id },
      'PATCH /v1/admin/products/{id}': { id: product.id, body: { tags: ['x'] } },
      'PUT /v1/admin/products/{id}/options': { id: product.id, body: [] },
      'POST /v1/admin/products/{id}/archive': { id: product.id },
      'DELETE /v1/admin/products/{id}': { id: product.id },
      'PATCH /v1/admin/variants/{id}': { id: variant, body: { price: 1 } },
      'GET /v1/admin/variants/{id}/movements': { id: variant },
      'PATCH /v1/admin/categories/{id}': { id: category.id, body: {} },
      'POST /v1/admin/categories/{id}/move': { id: category.id, body: { parentId: null } },
      'DELETE /v1/admin/categories/{id}': { id: category.id },
      'PUT /v1/admin/categories/{id}/attributes': { id: category.id, body: [] },
      'PATCH /v1/admin/attributes/{id}': { id: attribute.id, body: { visible: false } },
      'DELETE /v1/admin/attributes/{id}': { id: attribute.id },
      'PUT /v1/admin/attributes/{id}/values': { id: attribute.id, body: [] },
      'PATCH /v1/admin/collections/{id}': { id: collection.id, body: { published: true } },
      'DELETE /v1/admin/collections/{id}': { id: collection.id },
      'PUT /v1/admin/collections/{id}/products': { id: collection.id, body: [] },
      'GET /v1/admin/collections/{id}/products': { id: collection.id },
      'POST /v1/admin/collections/{id}/preview': {
        id: collection.id,
        body: { conditions: [{ type: 'created_within_days', days: 7 }] },
      },
      'PATCH /v1/admin/locations/{id}': { id: location?.id as string, body: { name: 'x' } },
      'PUT /v1/admin/products/{id}/media': { id: product.id, body: { images: [] } },
      // A file of store B's: store A's lookups only see store A's prefix.
      'GET /v1/admin/media/files/{file}': { id: `${'b'.repeat(64)}.png` },
    };
    /** Routes whose path parameter names new content, not a stored row, with the reason. */
    const exempt: Record<string, string> = {
      'PUT /v1/admin/media/files/{file}':
        'the name is the uploaded bytes’ hash, and the file lands in the caller’s own store',
    };

    const withIds = Object.values(ADMIN_ROUTES).filter((r) => r.path.includes('{'));
    expect(withIds.length).toBeGreaterThan(0);
    const user = await staffIn(a.email, a.id);
    for (const route of withIds) {
      const key = `${route.method.toUpperCase()} ${route.path}`;
      if (exempt[key]) continue;
      const fixture = fixtures[key];
      expect(fixture, `no isolation fixture for ${key}`).toBeDefined();
      if (!fixture) continue;
      const path = route.path
        .replace('/v1/admin', '/api/admin')
        .replace(/\{(id|file)\}/, fixture.id);
      const res = await user.call(route.method.toUpperCase(), path, fixture.body);
      expect(res.status, key).toBe(404);
    }
    // Store B's rows are untouched.
    const still = await owner.query(`select 1 from platform.memberships where id = $1`, [
      bMember.memberId,
    ]);
    expect(still.rowCount).toBe(1);
    const catalog = await owner.query(
      `select (select status from store.products where id = $1) as status,
              (select count(*)::int from store.categories where id = $2) as categories,
              (select count(*)::int from store.attributes where id = $3) as attributes`,
      [product.id, category.id, attribute.id],
    );
    expect(catalog.rows[0]).toEqual({ status: 'draft', categories: 1, attributes: 1 });
    // A bulk edit naming B's variant is refused too.
    expect(
      (await user.call('PATCH', '/api/admin/variants', [{ id: variant, price: 5 }])).status,
    ).toBe(404);
  });

  it('a support grant for store A gives nothing in store B', async () => {
    const a = await store();
    const b = await store();
    const email = `${unique()}@example.test`;
    const { rows } = await owner.query<{ id: string }>(
      `insert into platform.users (name, email, email_verified, platform_role) values ('Support', $1, true, 'support') returning id`,
      [email],
    );
    const support = await actorFor(createDb(app), rows[0]?.id as string, null);
    await grantSupportAccess(app, support, a.id, {
      role: 'viewer',
      reason: 'customer asked for help',
      minutes: 30,
    });
    const user = await staffIn(email);
    expect((await user.call('PUT', '/api/admin/me/active-store', { tenantId: b.id })).status).toBe(
      403,
    );
    expect((await user.call('PUT', '/api/admin/me/active-store', { tenantId: a.id })).status).toBe(
      200,
    );
    expect((await (await user.get('/api/admin/me')).json()) as Json).toMatchObject({
      role: 'viewer',
      supportGrant: true,
    });
    expect((await user.call('PATCH', '/api/admin/store', { name: 'x' })).status).toBe(403);
  });
});
