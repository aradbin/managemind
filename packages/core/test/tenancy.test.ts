import { createDb } from '@managemind/db';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  createTenant,
  getStore,
  hostEntries,
  type OutboxEvent,
  resolveHost,
  systemActor,
  tenantLifecycle,
  transitionTenant,
  updateStoreProfile,
  withTenant,
} from '../src';
import { connectApp, connectOwner } from './setup';

const STORE_DOMAIN = 'stores.example.test';

let app: pg.Client;
let owner: pg.Client;
beforeAll(async () => {
  [app, owner] = await Promise.all([connectApp(), connectOwner()]);
});
afterAll(() => Promise.all([app.end(), owner.end()]));

let seq = 0;
const unique = () => `t${Date.now().toString(36)}${seq++}`;

const user = (platformRole: Actor['platformRole'] = null): Actor => ({
  kind: 'user',
  userId: null,
  platformRole,
  permissions: new Set(),
});
const ownerOf = (): Actor => ({ ...user(), permissions: permissionsOf('owner') });
const viewer = (): Actor => ({ ...user(), permissions: permissionsOf('viewer') });

async function newStore(overrides: Partial<Parameters<typeof createTenant>[2]> = {}) {
  const slug = unique();
  const events: OutboxEvent[] = [];
  const created = await createTenant(
    app,
    systemActor,
    {
      slug,
      name: `Store ${slug}`,
      owner: { email: `${slug}@example.test`, name: 'Owner' },
      ...overrides,
    },
    { afterCommit: (e) => void events.push(...e) },
  );
  return { ...created, events };
}

const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[]) =>
  (await owner.query<T>(sql, params)).rows;

describe('createTenant', () => {
  it('creates the store, its owner and membership, audits and an event, in one go', async () => {
    const { id, slug, ownerUserId, events } = await newStore({ defaultLocale: 'en' });
    const [tenant] = await one(
      `select slug, status, default_locale, settings from platform.tenants where id = $1`,
      [id],
    );
    expect(tenant).toMatchObject({ slug, status: 'active', default_locale: 'en' });
    expect(tenant?.settings).toEqual({ version: 1, profile: {}, display: {} });
    const [member] = await one(
      `select role from platform.memberships where tenant_id = $1 and user_id = $2`,
      [id, ownerUserId],
    );
    expect(member?.role).toBe('owner');
    const [u] = await one(`select email_verified, locale from platform.users where id = $1`, [
      ownerUserId,
    ]);
    expect(u).toEqual({ email_verified: false, locale: 'en' });
    expect(
      await one(
        `select actor_type from platform.audit_log where tenant_id = $1 and action = 'tenant.created'`,
        [id],
      ),
    ).toEqual([{ actor_type: 'system' }]);
    expect(
      await one(
        `select 1 from store.audit_log where tenant_id = $1 and action = 'tenant.created'`,
        [id],
      ),
    ).toHaveLength(1);
    expect(events.map((e) => [e.eventType, e.tenantId, e.payload])).toEqual([
      ['tenant.created', id, { slug, name: `Store ${slug}` }],
    ]);
  });

  it('reuses an existing user as the owner', async () => {
    const first = await newStore();
    const [{ email } = { email: '' }] = await one<{ email: string }>(
      `select email from platform.users where id = $1`,
      [first.ownerUserId],
    );
    const second = await newStore({ owner: { email: email.toUpperCase(), name: 'Someone else' } });
    expect(second.ownerUserId).toBe(first.ownerUserId);
  });

  it('refuses taken, reserved and malformed slugs, leaving nothing behind', async () => {
    const { slug } = await newStore();
    const attempt = (s: string) =>
      createTenant(app, systemActor, {
        slug: s,
        name: 'X',
        owner: { email: `${unique()}@example.test`, name: 'X' },
      });
    await expect(attempt(slug)).rejects.toMatchObject({ code: 'slug_taken' });
    await expect(attempt('admin')).rejects.toMatchObject({ code: 'slug_reserved' });
    await expect(attempt('Not A Slug')).rejects.toMatchObject({ code: 'validation_failed' });
    expect(await one(`select 1 from platform.tenants where slug = $1`, [slug])).toHaveLength(1);
  });

  it('is for super admins and the CLI only', async () => {
    const input = {
      slug: unique(),
      name: 'X',
      owner: { email: `${unique()}@example.test`, name: 'X' },
    };
    await expect(createTenant(app, user(), input)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(createTenant(app, user('support'), input)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(createTenant(app, user('super_admin'), input)).resolves.toMatchObject({
      slug: input.slug,
    });
  });
});

describe('store profile', () => {
  it('reads and edits the profile, normalizing phones, with audit and event', async () => {
    const { id } = await newStore();
    const events: OutboxEvent[] = [];
    const store = await withTenant(
      app,
      id,
      (tx) =>
        updateStoreProfile(tx, ownerOf(), {
          name: '  New Name ',
          profile: { contactPhone: '01712345678' },
        }),
      { afterCommit: (e) => void events.push(...e) },
    );
    expect(store).toMatchObject({ name: 'New Name', profile: { contactPhone: '+8801712345678' } });
    expect(events.map((e) => e.payload)).toEqual([{ fields: ['name', 'profile'] }]);
    const read = await withTenant(app, id, (tx) => getStore(tx, viewer()));
    expect(read).toMatchObject({
      name: 'New Name',
      status: 'active',
      profile: { contactPhone: '+8801712345678' },
    });
    const [audit] = await one(
      `select before, after from store.audit_log where tenant_id = $1 and action = 'store.profile_updated'`,
      [id],
    );
    expect(audit?.after).toMatchObject({ name: 'New Name' });
  });

  it('emits nothing when nothing changed', async () => {
    const { id } = await newStore();
    const events: OutboxEvent[] = [];
    await withTenant(app, id, (tx) => updateStoreProfile(tx, ownerOf(), {}), {
      afterCommit: (e) => void events.push(...e),
    });
    expect(events).toEqual([]);
  });

  it('checks permissions, and refuses edits while suspended', async () => {
    const { id } = await newStore();
    await expect(withTenant(app, id, (tx) => getStore(tx, user()))).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(
      withTenant(app, id, (tx) => updateStoreProfile(tx, viewer(), { name: 'X' })),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await transitionTenant(app, systemActor, id, 'suspend', { reason: 'unpaid invoice' });
    await expect(
      withTenant(app, id, (tx) => updateStoreProfile(tx, ownerOf(), { name: 'X' })),
    ).rejects.toMatchObject({ code: 'tenant_suspended' });
    await expect(withTenant(app, id, (tx) => getStore(tx, viewer()))).resolves.toMatchObject({
      status: 'suspended',
    });
  });
});

describe('lifecycle', () => {
  it('declares the Phase 1 and 5B transitions', () => {
    expect(tenantLifecycle.events('active').sort()).toEqual(['close', 'suspend']);
    expect(tenantLifecycle.events('suspended').sort()).toEqual(['close', 'reactivate']);
    expect(tenantLifecycle.isFinal('purged')).toBe(true);
  });

  it('suspends with a reason and reactivates, auditing both', async () => {
    const { id } = await newStore();
    const events: OutboxEvent[] = [];
    const afterCommit = (e: readonly OutboxEvent[]) => void events.push(...e);
    await expect(transitionTenant(app, systemActor, id, 'suspend', {})).rejects.toMatchObject({
      code: 'illegal_transition',
    });
    expect(
      await transitionTenant(
        app,
        systemActor,
        id,
        'suspend',
        { reason: 'abuse report' },
        { afterCommit },
      ),
    ).toEqual({ from: 'active', to: 'suspended' });
    await expect(
      transitionTenant(app, systemActor, id, 'suspend', { reason: 'again' }),
    ).rejects.toMatchObject({ code: 'illegal_transition' });
    await transitionTenant(app, systemActor, id, 'reactivate', {}, { afterCommit });
    expect(events.map((e) => e.payload)).toEqual([
      { from: 'active', to: 'suspended', reason: 'abuse report' },
      { from: 'suspended', to: 'active' },
    ]);
    const audit = await one(
      `select action, after from platform.audit_log where tenant_id = $1 and action like 'tenant.%' order by created_at`,
      [id],
    );
    expect(audit.map((a) => a.action)).toEqual([
      'tenant.created',
      'tenant.suspend',
      'tenant.reactivate',
    ]);
    expect(audit[1]?.after).toEqual({ status: 'suspended', reason: 'abuse report' });
    await expect(
      transitionTenant(app, user('support'), id, 'suspend', { reason: 'nope' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});

describe('hosts', () => {
  const db = () => createDb(app);
  const addDomain = (tenantId: string, hostname: string, status: string, isPrimary = false) =>
    owner.query(
      `insert into platform.tenant_domains (tenant_id, hostname, status, is_primary) values ($1, $2, $3, $4)`,
      [tenantId, hostname, status, isPrimary],
    );

  it('resolves the default address, ignoring case, port and a trailing dot', async () => {
    const { id, slug } = await newStore();
    const record = await resolveHost(
      db(),
      `${slug.toUpperCase()}.Stores.Example.Test:443.`.replace(':443.', '.:443'),
      STORE_DOMAIN,
    );
    expect(record).toMatchObject({
      tenantId: id,
      slug,
      status: 'active',
      primaryHost: `${slug}.${STORE_DOMAIN}`,
    });
    expect(await resolveHost(db(), `${slug}.elsewhere.test`, STORE_DOMAIN)).toBeNull();
    expect(await resolveHost(db(), `nope-${slug}.${STORE_DOMAIN}`, STORE_DOMAIN)).toBeNull();
  });

  it('resolves active custom domains only, and uses the primary as canonical', async () => {
    const { id, slug } = await newStore();
    const shop = `shop-${slug}.example.com`;
    await addDomain(id, shop, 'active', true);
    await addDomain(id, `pending-${slug}.example.com`, 'pending');
    expect(await resolveHost(db(), shop, STORE_DOMAIN)).toMatchObject({
      tenantId: id,
      primaryHost: shop,
    });
    expect(await resolveHost(db(), `pending-${slug}.example.com`, STORE_DOMAIN)).toBeNull();
    expect((await resolveHost(db(), `${slug}.${STORE_DOMAIN}`, STORE_DOMAIN))?.primaryHost).toBe(
      shop,
    );
  });

  it('keeps suspended stores resolvable (for the maintenance page) and drops closed ones', async () => {
    const { id, slug } = await newStore();
    await transitionTenant(app, systemActor, id, 'suspend', { reason: 'abuse report' });
    expect(await resolveHost(db(), `${slug}.${STORE_DOMAIN}`, STORE_DOMAIN)).toMatchObject({
      status: 'suspended',
    });
    await owner.query(`update platform.tenants set status = 'closed' where id = $1`, [id]);
    expect(await resolveHost(db(), `${slug}.${STORE_DOMAIN}`, STORE_DOMAIN)).toBeNull();
  });

  it('computes the KV entries a store should have', async () => {
    const { id, slug } = await newStore();
    await addDomain(id, `live-${slug}.example.com`, 'active');
    await addDomain(id, `gone-${slug}.example.com`, 'removed');
    const entries = await hostEntries(db(), id, STORE_DOMAIN);
    expect(entries.put.map((p) => p.key).sort()).toEqual(
      [`host:${slug}.${STORE_DOMAIN}`, `host:live-${slug}.example.com`].sort(),
    );
    expect(entries.put[0]?.value).toMatchObject({ tenantId: id, slug, status: 'active' });
    expect(entries.delete).toEqual([`host:gone-${slug}.example.com`]);

    await owner.query(`update platform.tenants set status = 'closed' where id = $1`, [id]);
    const closed = await hostEntries(db(), id, STORE_DOMAIN);
    expect(closed.put).toEqual([]);
    expect(closed.delete.sort()).toEqual(
      [
        `host:${slug}.${STORE_DOMAIN}`,
        `host:live-${slug}.example.com`,
        `host:gone-${slug}.example.com`,
      ].sort(),
    );
  });
});
