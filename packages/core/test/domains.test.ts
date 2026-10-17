// Custom domains (phase-3-plan §3.9, §9): validation, the state machine with
// a fake provider, history rows, events, primary and removal.

import { createDb } from '@managemind/db';
import { fakeHostnames } from '@managemind/providers/hostnames';
import { permissionsOf } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Actor,
  addDomain,
  checkCustomHostname,
  checkDomain,
  createTenant,
  domainLifecycle,
  hostEntries,
  isBareDomain,
  listDomains,
  makePrimaryDomain,
  removeDomain,
  resolveHost,
  systemActor,
  type TenantTx,
  withTenant,
} from '../src';
import { connectApp } from './setup';

const rules = { platformDomain: 'managemind.site', storeDomain: 'managemind.store' };
let app: pg.Client;
let store: string;
let other: string;
let owner: Actor;
let staff: Actor;

beforeAll(async () => {
  app = await connectApp();
  const make = async (s: string) => {
    const slug = `dm${Date.now().toString(36)}${s}`;
    return (
      await createTenant(app, systemActor, {
        slug,
        name: `Domains ${s}`,
        owner: { email: `${slug}@example.test`, name: 'Owner' },
      })
    ).id;
  };
  store = await make('a');
  other = await make('b');
  const actor = (role: 'owner' | 'staff'): Actor => ({
    kind: 'user',
    userId: '0199d000-0000-7000-8000-0000000000ae',
    platformRole: null,
    permissions: permissionsOf(role),
    tenantId: store,
    storeRole: role,
  });
  owner = actor('owner');
  staff = actor('staff');
});
afterAll(() => app.end());

const run = <T>(fn: (tx: TenantTx) => Promise<T>, tenantId = store) =>
  withTenant(app, tenantId, fn);
const host = () => `www.shop${Date.now().toString(36)}${Math.floor(Math.random() * 1e6)}.com.bd`;

describe('hostname rules', () => {
  it('normalizes and refuses our domains and bare domains', () => {
    expect(checkCustomHostname(' WWW.Shop.com.bd. ', rules)).toBe('www.shop.com.bd');
    expect(checkCustomHostname('https://shop.example.com/path', rules)).toBe('shop.example.com');
    const code = (h: string) => {
      try {
        checkCustomHostname(h, rules);
        return 'ok';
      } catch (e) {
        return (e as { fields: { code: string }[] }).fields[0]?.code;
      }
    };
    expect(code('demo.managemind.store')).toBe('reserved');
    expect(code('managemind.site')).toBe('reserved');
    expect(code('shop.com.bd')).toBe('bare_domain');
    expect(code('example.com')).toBe('bare_domain');
    expect(code('not a domain')).toBe('invalid');
    expect(isBareDomain('www.example.com')).toBe(false);
  });

  it('allows only the transitions of the lifecycle', () => {
    expect(domainLifecycle.can('pending', 'activate')).toBe(true);
    expect(domainLifecycle.can('active', 'fail')).toBe(false);
    expect(domainLifecycle.can('removed', 'activate')).toBe(false);
  });
});

describe('custom domains', () => {
  it('adds a pending domain, at most two, never another store’s', async () => {
    const provider = fakeHostnames();
    const deps = { ...rules, provider };
    const hostname = host();
    const added = await run(async (tx) => {
      const d = await addDomain(tx, owner, { hostname }, deps);
      return { d, events: tx.events.map((e) => e.eventType) };
    });
    expect(added.d).toMatchObject({
      hostname,
      status: 'pending',
      isPrimary: false,
      sslStatus: 'pending_validation',
    });
    expect(added.events).toEqual(['tenant_domain.added']);
    expect(provider.hostnames.has(hostname)).toBe(true);

    await expect(
      run((tx) => addDomain(tx, staff, { hostname: host() }, deps)),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      run((tx) => addDomain(tx, owner, { hostname }, deps), other),
    ).rejects.toMatchObject({ code: 'conflict' });
    await run((tx) => addDomain(tx, owner, { hostname: host() }, deps));
    await expect(
      run((tx) => addDomain(tx, owner, { hostname: host() }, deps)),
    ).rejects.toMatchObject({
      code: 'limit_exceeded',
    });
    // Another store sees none of these.
    const otherOwner = { ...owner, tenantId: other };
    expect(await run((tx) => listDomains(tx, otherOwner), other)).toEqual([]);
    for (const d of await run((tx) => listDomains(tx, owner))) {
      await run((tx) => removeDomain(tx, owner, d.id, { provider }));
    }
  });

  it('becomes active once live, then primary, and the store resolves on it', async () => {
    const provider = fakeHostnames();
    const hostname = host();
    const d = await run((tx) => addDomain(tx, owner, { hostname }, { ...rules, provider }));

    const waiting = await run((tx) => checkDomain(tx, systemActor, d.id, { provider }));
    expect(waiting).toMatchObject({ done: false, domain: { status: 'pending', checkAttempts: 1 } });
    expect(waiting.domain.failureReason).toMatch(/waiting for the DNS record/);

    provider.set(hostname, { status: 'active', sslStatus: 'active' });
    const live = await run(async (tx) => {
      const r = await checkDomain(tx, systemActor, d.id, { provider });
      return { r, events: tx.events.map((e) => e.eventType) };
    });
    expect(live.r).toMatchObject({ done: true, domain: { status: 'active', failureReason: null } });
    expect(live.events).toEqual(['tenant_domain.updated']);

    const primary = await run((tx) => makePrimaryDomain(tx, owner, d.id));
    expect(primary.isPrimary).toBe(true);
    const db = createDb(app);
    const record = await resolveHost(db, hostname, rules.storeDomain);
    expect(record).toMatchObject({ tenantId: store, primaryHost: hostname });
    const entries = await hostEntries(db, store, rules.storeDomain);
    expect(entries.put.map((e) => e.key)).toContain(`host:${hostname}`);

    const { rows } = await run((tx) =>
      tx.db.execute<{ from_status: string | null; to_status: string }>(
        sql`select from_status, to_status from platform.tenant_domain_history where domain_id = ${d.id} order by created_at`,
      ),
    );
    expect(rows.map((r) => [r.from_status, r.to_status])).toEqual([
      [null, 'pending'],
      ['pending', 'active'],
    ]);

    // Removing deletes the hostname at the provider first, and frees it.
    await run((tx) => removeDomain(tx, owner, d.id, { provider }));
    expect(provider.hostnames.has(hostname)).toBe(false);
    expect(await resolveHost(db, hostname, rules.storeDomain)).toBeNull();
    expect((await hostEntries(db, store, rules.storeDomain)).delete).toContain(`host:${hostname}`);
  });

  it('fails after 7 days with the provider’s reason, and a manual check starts again', async () => {
    const provider = fakeHostnames();
    const hostname = host();
    const d = await run((tx) => addDomain(tx, owner, { hostname }, { ...rules, provider }));
    provider.set(hostname, { errors: ['CNAME record not found'] });
    const later = new Date(Date.now() + 8 * 86_400_000);
    const failed = await run((tx) => checkDomain(tx, systemActor, d.id, { provider, now: later }));
    expect(failed).toMatchObject({
      done: true,
      domain: { status: 'failed', failureReason: 'CNAME record not found' },
    });

    await expect(run((tx) => makePrimaryDomain(tx, owner, d.id))).rejects.toMatchObject({
      code: 'illegal_transition',
    });
    const retried = await run((tx) => checkDomain(tx, owner, d.id, { provider, manual: true }));
    expect(retried).toMatchObject({ done: false, domain: { status: 'pending', checkAttempts: 1 } });
    await run((tx) => removeDomain(tx, owner, d.id, { provider }));
  });

  it('flags an active domain that broke, once, without deactivating it', async () => {
    const provider = fakeHostnames();
    const hostname = host();
    const d = await run((tx) => addDomain(tx, owner, { hostname }, { ...rules, provider }));
    provider.set(hostname, { status: 'active', sslStatus: 'active' });
    await run((tx) => checkDomain(tx, systemActor, d.id, { provider }));

    provider.set(hostname, {
      status: 'pending',
      sslStatus: 'pending_validation',
      errors: ['CNAME changed'],
    });
    const flagged = await run((tx) => checkDomain(tx, systemActor, d.id, { provider }));
    expect(flagged).toMatchObject({
      newlyFlagged: true,
      domain: { status: 'active', failureReason: 'CNAME changed' },
    });
    const again = await run((tx) => checkDomain(tx, systemActor, d.id, { provider }));
    expect(again.newlyFlagged).toBe(false);
    // Gone from Cloudflare altogether: still flagged, still active.
    const gone = await run((tx) => checkDomain(tx, systemActor, d.id, { provider, state: null }));
    expect(gone.domain).toMatchObject({
      status: 'active',
      failureReason: 'Cloudflare no longer knows this hostname',
    });
    await run((tx) => removeDomain(tx, owner, d.id, { provider }));
  });
});
