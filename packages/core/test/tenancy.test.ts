import { createDb } from '@managemind/db';
import { permissionsOf } from '@managemind/shared';
import { defaultTenantSettings } from '@managemind/shared/settings';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  closeTenant,
  createTenant,
  getStore,
  hostEntries,
  type OutboxEvent,
  reopenTenant,
  requestExport,
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

async function closeStore(id: string) {
  const [row] = await one<{ slug: string }>('select slug from platform.tenants where id = $1', [
    id,
  ]);
  return closeTenant(app, systemActor, id, { slug: row?.slug as string, reason: 'client left' });
}

describe('createTenant', () => {
  it('creates the store, its owner and membership, audits and an event, in one go', async () => {
    const { id, slug, ownerUserId, events } = await newStore({ defaultLocale: 'en' });
    const [tenant] = await one(
      `select slug, status, default_locale, settings from platform.tenants where id = $1`,
      [id],
    );
    expect(tenant).toMatchObject({ slug, status: 'active', default_locale: 'en' });
    expect(tenant?.settings).toEqual(defaultTenantSettings());
    const [member] = await one(
      `select role from platform.memberships where tenant_id = $1 and user_id = $2`,
      [id, ownerUserId],
    );
    expect(member?.role).toBe('owner');
    // The store's defaults: the built-in brand attribute and a default stock location.
    expect(
      await one(`select key, is_system from store.attributes where tenant_id = $1 order by key`, [
        id,
      ]),
    ).toEqual([{ key: 'brand', is_system: true }]);
    expect(
      await one(`select name from store.stock_locations where tenant_id = $1 and is_default`, [id]),
    ).toEqual([{ name: 'Main stock' }]);
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
    // The four legal drafts (phase-5b-plan §3.2) are pages too.
    expect(events.map((e) => [e.eventType, e.tenantId, e.payload])).toEqual([
      ...Array.from({ length: 4 }, () => [
        'catalog.page.changed',
        id,
        { change: 'created', navigation: false },
      ]),
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
    expect(tenantLifecycle.events('closed').sort()).toEqual(['purge', 'reopen']);
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

describe('closing and reopening (phase-5b-plan §3.1)', () => {
  it('closes with the slug typed and a reason, 30 days before the purge may run', async () => {
    const { id, slug } = await newStore();
    await transitionTenant(app, systemActor, id, 'suspend', {
      reason: 'invoice unpaid',
      category: 'overdue',
    });
    await expect(
      closeTenant(app, systemActor, id, { slug: 'other-store', reason: 'client left' }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      closeTenant(app, user('support'), id, { slug, reason: 'client left' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const events: OutboxEvent[] = [];
    const closed = await closeTenant(
      app,
      systemActor,
      id,
      { slug: slug.toUpperCase(), reason: 'client left' },
      { afterCommit: (e) => void events.push(...e) },
    );
    expect(closed).toMatchObject({ from: 'suspended', to: 'closed' });
    const days = (Date.parse(closed.purgeAfter) - Date.parse(closed.closedAt)) / 86_400_000;
    expect(days).toBe(30);
    expect(events.map((e) => e.eventType)).toEqual(['tenant.status_changed', 'tenant.closed']);
    const [row] = await one('select status, status_reason from platform.tenants where id = $1', [
      id,
    ]);
    expect(row).toEqual({ status: 'closed', status_reason: null });
    // Its export is queued in the same commit (§3.10).
    const [job] = await one('select kind, status from platform.tenant_jobs where id = $1', [
      closed.exportJobId,
    ]);
    expect(job).toEqual({ kind: 'export', status: 'pending' });
  });

  it('takes an export request from an owner or a super admin only', async () => {
    const { id } = await newStore();
    const as = (actor: Actor) => withTenant(app, id, (tx) => requestExport(tx, actor));
    const store = (role: 'owner' | 'manager') => ({
      ...user(),
      tenantId: id,
      storeRole: role,
      permissions: permissionsOf(role),
    });
    await expect(as(store('manager'))).rejects.toMatchObject({ code: 'forbidden' });
    await expect(as(user('support'))).rejects.toMatchObject({ code: 'forbidden' });
    const first = await as(store('owner'));
    expect(first.created).toBe(true);
    // Open: the same job; done today: refused until tomorrow; a super admin any time.
    expect((await as(store('owner'))).job.id).toBe(first.job.id);
    await owner.query(`update platform.tenant_jobs set status = 'succeeded' where id = $1`, [
      first.job.id,
    ]);
    await expect(as(store('owner'))).rejects.toMatchObject({ code: 'rate_limited' });
    expect((await as(user('super_admin'))).created).toBe(true);
  });

  it('lets a demo or test store be purged at once', async () => {
    const { id } = await newStore();
    await owner.query(`update platform.tenants set kind = 'test' where id = $1`, [id]);
    const closed = await closeStore(id);
    expect(closed.purgeAfter).toBe(closed.closedAt);
  });

  it('reopens a closed store with its data, until the purge starts', async () => {
    const { id } = await newStore();
    await closeStore(id);
    await expect(reopenTenant(app, systemActor, id, { reason: '' })).rejects.toMatchObject({
      code: 'illegal_transition',
    });
    expect(await reopenTenant(app, systemActor, id, { reason: 'client came back' })).toEqual({
      from: 'closed',
      to: 'active',
    });
    const [row] = await one(
      'select status, closed_at, purge_after from platform.tenants where id = $1',
      [id],
    );
    expect(row).toEqual({ status: 'active', closed_at: null, purge_after: null });

    await closeStore(id);
    await owner.query(
      `insert into platform.tenant_jobs (tenant_id, kind, status) values ($1, 'purge', 'running')`,
      [id],
    );
    await expect(
      reopenTenant(app, systemActor, id, { reason: 'client came back' }),
    ).rejects.toMatchObject({ code: 'conflict' });
  });

  it('reactivates only an overdue suspension when asked to', async () => {
    const { id } = await newStore();
    await transitionTenant(app, systemActor, id, 'suspend', {
      reason: 'abuse report',
      category: 'abuse',
    });
    expect(
      await transitionTenant(app, systemActor, id, 'reactivate', { onlyIf: 'overdue' }),
    ).toEqual({ from: 'suspended', to: 'suspended' });
    await transitionTenant(app, systemActor, id, 'reactivate');
    const [row] = await one('select status, status_reason from platform.tenants where id = $1', [
      id,
    ]);
    expect(row).toEqual({ status: 'active', status_reason: null });
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

  it('keeps suspended stores resolvable (maintenance), closed ones on their subdomain only (410)', async () => {
    const { id, slug } = await newStore();
    await addDomain(id, `shop-${slug}.example.com`, 'active');
    await transitionTenant(app, systemActor, id, 'suspend', { reason: 'abuse report' });
    expect(await resolveHost(db(), `${slug}.${STORE_DOMAIN}`, STORE_DOMAIN)).toMatchObject({
      status: 'suspended',
    });
    await closeStore(id);
    expect(await resolveHost(db(), `${slug}.${STORE_DOMAIN}`, STORE_DOMAIN)).toMatchObject({
      status: 'closed',
      primaryHost: `${slug}.${STORE_DOMAIN}`,
    });
    // Its custom domain is released at once (phase-5b-plan §3.1).
    expect(await resolveHost(db(), `shop-${slug}.example.com`, STORE_DOMAIN)).toBeNull();
    await owner.query(
      `update platform.tenants set status = 'purged', purged_at = now() where id = $1`,
      [id],
    );
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

    await closeStore(id);
    const closed = await hostEntries(db(), id, STORE_DOMAIN);
    expect(closed.put.map((p) => [p.key, p.value.status])).toEqual([
      [`host:${slug}.${STORE_DOMAIN}`, 'closed'],
    ]);
    expect(closed.delete.sort()).toEqual(
      [`host:live-${slug}.example.com`, `host:gone-${slug}.example.com`].sort(),
    );
  });
});
