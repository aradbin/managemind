// The admin API end to end, and the isolation suite (phase-1-plan §9): every
// /v1/admin route that takes an ID is called by a store A user with store
// B's IDs and must answer 404. A route without a fixture fails the suite,
// so new routes join it automatically.
import {
  type Actor,
  actorFor,
  addAddress,
  addDomain,
  blockPhone,
  createAttribute,
  createCategory,
  createCollection,
  createCustomer,
  createImportJob,
  createManualInvoice,
  createPage,
  createProduct,
  createPromotion,
  createShipment,
  createTenant,
  createZone,
  grantSupportAccess,
  listLocations,
  placeOrder,
  receive,
  setIssuer,
  systemActor,
  transitionTenant,
  withPlatform,
  withTenant,
} from '@managemind/core';
import { createDb } from '@managemind/db';
import { connect } from '@managemind/db/testing';
import { pendingHostnames } from '@managemind/providers/hostnames';
import { permissionsOf } from '@managemind/shared';
import { dhakaDate } from '@managemind/shared/billing';
import { sql } from 'drizzle-orm';
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

  it('saves the fraud, returns and notifications sections; the advance waits for SSLCommerz', async () => {
    const a = await store();
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));
    const user = await staffIn(a.email, a.id, browser(makeEnv({ CREDENTIALS_KEY: key })));
    const saved = await user.call('PATCH', '/api/admin/store', {
      fraud: { flagAfterFailed: 2 },
      returns: { windowDays: 10 },
      notifications: { sms: ['order_placed'], email: ['order_placed', 'order_shipped'] },
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      fraud: { flagAfterFailed: 2 },
      returns: { windowDays: 10, shopperRequests: true },
      notifications: { sms: ['order_placed'] },
    });

    const cod = { enabled: true, maxOrderValue: null, advance: 'flagged', otp: 'off' };
    const refused = await user.call('PATCH', '/api/admin/store', { cod });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as Json).errors).toEqual([
      expect.objectContaining({ path: 'cod.advance', code: 'needs_gateway' }),
    ]);
    expect(
      (
        await user.call('PATCH', '/api/admin/store', {
          cod: { ...cod, advance: 'never', otp: 'flagged' },
        })
      ).status,
    ).toBe(422);

    // A rule saved before the check (phase 4) doesn't block other saves.
    await owner.query(
      `update platform.tenants set settings = jsonb_set(settings, '{cod}', $2::jsonb) where id = $1`,
      [a.id, JSON.stringify({ ...cod, advance: 'always' })],
    );
    expect(
      (await user.call('PATCH', '/api/admin/store', { cod: { ...cod, advance: 'always' } })).status,
    ).toBe(200);

    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ status: 'SUCCESS', GatewayPageURL: 'https://gw', sessionkey: 'k' }),
      )) as typeof fetch;
    try {
      const put = await user.call('PUT', '/api/admin/credentials/sslcommerz', {
        provider: 'sslcommerz',
        mode: 'sandbox',
        secrets: { storeId: 'shop1234', storePassword: 'pw' },
      });
      expect(put.status).toBe(200);
    } finally {
      globalThis.fetch = realFetch;
    }
    const allowed = await user.call('PATCH', '/api/admin/store', { cod });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({ cod: { advance: 'flagged' } });
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
  // Every admin route against two whole stores: about 5 s on a CI runner, which
  // crossed vitest's 5 s default on the merge of Phase 2.
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
    const importJob = await inB((tx) =>
      createImportJob(tx, bOwner, { fileName: 'b.csv', chunkCount: 1, total: 1 }),
    );
    const page = await inB((tx) =>
      createPage(tx, bOwner, { kind: 'about', translations: { en: { title: 'B about' } } }),
    );
    const domain = await inB((tx) =>
      addDomain(
        tx,
        bOwner,
        { hostname: `www.${unique()}.example.com` },
        {
          platformDomain: 'platform.example.test',
          storeDomain: 'stores.example.test',
          provider: pendingHostnames(),
        },
      ),
    );

    // Store B's invoice from us (Phase 5B), issued so its owner could see it.
    await withPlatform(app, (tx) =>
      setIssuer(tx, systemActor, {
        legalName: 'managemind Ltd',
        address: 'Gulshan, Dhaka',
        vatRateBp: null,
        bank: { name: 'City Bank', accountName: 'managemind Ltd', accountNumber: '0001' },
        bkash: '01700000000',
      }),
    );
    const bInvoice = await createManualInvoice(
      app,
      systemActor,
      b.id,
      {
        lines: [
          { kind: 'plan', description: { bn: 'প্ল্যান', en: 'Plan' }, quantity: 1, unitPrice: 100 },
        ],
        issueNow: true,
      },
      { today: dhakaDate(new Date()) },
    );

    // Store B's orders, shipments, customers, zones and blocklist (Phase 4).
    const live = await inB((tx) =>
      createProduct(tx, bOwner, {
        status: 'active',
        translations: { en: { title: 'B live' } },
        variant: { price: 1000 },
      }),
    );
    const liveVariant = live.variants[0]?.id as string;
    await inB((tx) =>
      receive(tx, bOwner, { variantId: liveVariant, quantity: 5, reason: 'received' }),
    );
    const order = await inB((tx) =>
      placeOrder(tx, bOwner, {
        channel: 'admin',
        source: 'phone',
        lines: [{ variantId: liveVariant, quantity: 1 }],
        contact: { name: 'B shopper', phone: '+8801700009999' },
        address: null,
        zone: 'none',
        payment: { kind: 'cod' },
        locale: 'en',
        confirm: true,
      }),
    );
    const { rows: lineRows } = await inB((tx) =>
      tx.db.execute<{ id: string }>(
        sql`select id from store.order_lines where order_id = ${order.id} limit 1`,
      ),
    );
    const shipment = await inB((tx) =>
      createShipment(tx, bOwner, order.id, {
        lines: [{ orderLineId: lineRows[0]?.id, quantity: 1 }],
      }),
    );
    const customer = await inB((tx) =>
      createCustomer(tx, bOwner, { phone: '+8801700008888', name: 'B customer' }),
    );
    const bAddress = {
      name: 'B',
      phone: '+8801700008888',
      divisionId: 6,
      districtId: 47,
      areaId: 513,
      line: 'B road',
    };
    const address = await inB((tx) => addAddress(tx, bOwner, customer.id, bAddress));
    const zone = await inB((tx) => createZone(tx, bOwner, { name: { en: 'B zone' }, fee: 100 }));
    const promotion = await inB((tx) =>
      createPromotion(tx, bOwner, {
        title: { en: 'B promo' },
        kind: 'code',
        action: { type: 'amount_off_order', amount: 100 },
      }),
    );
    await inB((tx) => blockPhone(tx, bOwner, { phone: '+8801700007777', reason: 'B only' }));
    const bDevice = await inB(async (tx) => {
      const { rows } = await tx.db.execute<{ id: string }>(
        sql`insert into store.push_subscriptions (user_id, endpoint, p256dh, auth)
             select id, ${`https://push.example.test/${crypto.randomUUID()}`}, 'k', 'a'
               from platform.users order by created_at limit 1
             returning id`,
      );
      return rows[0]?.id as string;
    });
    const bMessage = await inB(async (tx) => {
      const { rows } = await tx.db.execute<{ id: string }>(
        sql`insert into store.messages (idempotency_key, event, channel, recipient_type, recipient, locale, status)
             values (${`b-${crypto.randomUUID()}`}, 'order_placed', 'email', 'shopper', 'b@example.test', 'en', 'failed')
             returning id`,
      );
      return rows[0]?.id as string;
    });

    // Store B's return and its photo (phase-5a-plan §3.12).
    const bReturn = await inB(async (tx) => {
      const { rows } = await tx.db.execute<{ id: string }>(
        sql`insert into store.returns (number, order_id, reason, requested_by)
             values (9001, ${order.id}, 'damaged', 'staff') returning id`,
      );
      return rows[0]?.id as string;
    });
    const bPhoto = await inB(async (tx) => {
      const { rows } = await tx.db.execute<{ id: string }>(
        sql`insert into store.return_photos (return_id, object_key, mime_type, bytes)
             values (${bReturn}, 'b/returns/x.png', 'image/png', 10) returning id`,
      );
      return rows[0]?.id as string;
    });

    /** Store B's resource for each route with an ID; a new route must add one. */
    const fixtures: Record<string, { id: string; second?: string; body?: unknown }> = {
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
      'GET /v1/admin/imports/{id}': { id: importJob.id },
      'PUT /v1/admin/imports/{id}/chunks/{n}': { id: importJob.id, body: [{}] },
      'POST /v1/admin/imports/{id}/start': { id: importJob.id },
      'POST /v1/admin/imports/{id}/cancel': { id: importJob.id },
      'GET /v1/admin/imports/{id}/errors': { id: importJob.id },
      'GET /v1/admin/imports/{id}/images': { id: importJob.id },
      'PATCH /v1/admin/imports/{id}/images/{imageId}': {
        id: importJob.id,
        body: { status: 'failed', error: 'x' },
      },
      'GET /v1/admin/pages/{id}': { id: page.id },
      'PATCH /v1/admin/pages/{id}': { id: page.id, body: { published: true } },
      'DELETE /v1/admin/pages/{id}': { id: page.id },
      'POST /v1/admin/domains/{id}/check': { id: domain.id },
      'POST /v1/admin/domains/{id}/primary': { id: domain.id },
      'DELETE /v1/admin/domains/{id}': { id: domain.id },
      'GET /v1/admin/orders/{id}': { id: order.id },
      'POST /v1/admin/orders/{id}/confirm': { id: order.id },
      'POST /v1/admin/orders/{id}/process': { id: order.id },
      'POST /v1/admin/orders/{id}/cancel': { id: order.id, body: { reason: 'x' } },
      'POST /v1/admin/orders/{id}/edit/preview': {
        id: order.id,
        body: { lines: [{ variantId: liveVariant, quantity: 2 }] },
      },
      'POST /v1/admin/orders/{id}/edit': {
        id: order.id,
        body: { lines: [{ variantId: liveVariant, quantity: 2 }] },
      },
      'POST /v1/admin/orders/{id}/notes': { id: order.id, body: { body: 'x' } },
      'PATCH /v1/admin/orders/{id}': { id: order.id, body: { tags: ['x'] } },
      'POST /v1/admin/orders/{id}/payment-link': { id: order.id },
      'GET /v1/admin/orders/{id}/returnable': { id: order.id },
      'POST /v1/admin/orders/{id}/refunds/preview': { id: order.id, body: {} },
      'POST /v1/admin/orders/{id}/refunds': { id: order.id, body: { method: 'cash' } },
      'GET /v1/admin/returns/{id}': { id: bReturn },
      'POST /v1/admin/returns/{id}/approve': { id: bReturn },
      'POST /v1/admin/returns/{id}/reject': { id: bReturn, body: { reason: 'x' } },
      'POST /v1/admin/returns/{id}/send': { id: bReturn },
      'POST /v1/admin/returns/{id}/receive': { id: bReturn },
      'POST /v1/admin/returns/{id}/inspect': {
        id: bReturn,
        body: { lines: [{ orderLineId: lineRows[0]?.id, sellable: 1, damaged: 0 }] },
      },
      'POST /v1/admin/returns/{id}/close': { id: bReturn, body: { reason: 'x' } },
      'POST /v1/admin/returns/{id}/exchange': {
        id: bReturn,
        body: { lines: [{ variantId: liveVariant, quantity: 1 }] },
      },
      'GET /v1/admin/returns/{id}/photos/{photo}': { id: bReturn, second: bPhoto },
      'POST /v1/admin/orders/{id}/payments': {
        id: order.id,
        body: { method: 'cash', amount: 100 },
      },
      'POST /v1/admin/orders/{id}/shipments': {
        id: order.id,
        body: { lines: [{ orderLineId: lineRows[0]?.id, quantity: 1 }] },
      },
      'POST /v1/admin/shipments/{id}/ship': { id: shipment.id },
      'POST /v1/admin/shipments/{id}/deliver': { id: shipment.id, body: {} },
      'POST /v1/admin/shipments/{id}/fail': { id: shipment.id, body: { reason: 'x' } },
      'POST /v1/admin/shipments/{id}/return': { id: shipment.id },
      'DELETE /v1/admin/shipments/{id}': { id: shipment.id },
      'GET /v1/admin/customers/{id}': { id: customer.id },
      'POST /v1/admin/customers/{id}/anonymize': { id: customer.id },
      'PATCH /v1/admin/customers/{id}': { id: customer.id, body: { name: 'x' } },
      'PUT /v1/admin/customers/{id}/flag': { id: customer.id, body: { flagged: true } },
      'DELETE /v1/admin/customers/{id}': { id: customer.id },
      'POST /v1/admin/customers/{id}/addresses': { id: customer.id, body: bAddress },
      'PATCH /v1/admin/customers/{id}/addresses/{addressId}': {
        id: customer.id,
        second: address.id,
        body: { line: 'x' },
      },
      'DELETE /v1/admin/customers/{id}/addresses/{addressId}': {
        id: customer.id,
        second: address.id,
      },
      'PATCH /v1/admin/delivery-zones/{id}': { id: zone.id, body: { fee: 1 } },
      'DELETE /v1/admin/delivery-zones/{id}': { id: zone.id },
      'DELETE /v1/admin/blocked-phones/{phone}': { id: '+8801700007777' },
      'GET /v1/admin/promotions/{id}': { id: promotion.id },
      'PATCH /v1/admin/promotions/{id}': { id: promotion.id, body: { priority: 1 } },
      'POST /v1/admin/promotions/{id}/codes': { id: promotion.id, body: { count: 1 } },
      'GET /v1/admin/promotions/{id}/codes': { id: promotion.id },
      'POST /v1/admin/messages/{id}/resend': { id: bMessage },
      'DELETE /v1/admin/me/push-devices/{id}': { id: bDevice },
      'GET /v1/admin/billing/invoices/{id}': { id: bInvoice },
      'POST /v1/admin/billing/invoices/{id}/pay': { id: bInvoice },
    };
    /** Routes whose path parameter names new content, not a stored row, with the reason. */
    const exempt: Record<string, string> = {
      'PUT /v1/admin/media/files/{file}':
        'the name is the uploaded bytes’ hash, and the file lands in the caller’s own store',
      'POST /v1/admin/theme/presets/{name}':
        'the name is a preset, not a stored row; it only ever changes the caller’s own draft',
      'PUT /v1/admin/credentials/{kind}':
        'the kind is one of three fixed names, resolved inside the caller’s own store',
      'DELETE /v1/admin/credentials/{kind}':
        'the kind is one of three fixed names, resolved inside the caller’s own store',
      'DELETE /v1/admin/templates/{event}/{channel}/{locale}':
        'the key names a template of the caller’s own store, never a row of another',
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
        .replace(/\{(id|file|phone)\}/, encodeURIComponent(fixture.id))
        .replace(/\{(addressId|photo)\}/, fixture.second ?? crypto.randomUUID())
        .replace('{n}', '0')
        .replace('{imageId}', crypto.randomUUID());
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
    // Store B's order and customer are untouched too.
    const orders = await inB((tx) =>
      tx.db.execute(
        sql`select (select status from store.orders where id = ${order.id}) as status,
                   (select count(*)::int from store.order_notes where order_id = ${order.id}) as notes,
                   (select deleted_at is null from store.customers where id = ${customer.id}) as customer,
                   (select count(*)::int from store.blocked_phones) as blocked`,
      ),
    );
    expect(orders.rows[0]).toEqual({ status: 'processing', notes: 0, customer: true, blocked: 1 });
    // A bulk edit naming B's variant is refused too.
    expect(
      (await user.call('PATCH', '/api/admin/variants', [{ id: variant, price: 5 }])).status,
    ).toBe(404);
  }, 30_000);

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
