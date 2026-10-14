import type { OutboxEvent } from '@managemind/core';
import { connect, testUrls } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { grantRole, kvSync, type PlatformTargets, tenantCreate } from './commands';

// The CLI runs as the migration role in production, the owner here.
const { ownerUrl } = testUrls('managemind_test_scripts');
let client: pg.Client;
beforeAll(async () => {
  client = await connect(ownerUrl);
});
afterAll(() => client.end());

function fakeTargets() {
  const kv = new Map<string, string>();
  const sent: OutboxEvent[] = [];
  const targets: PlatformTargets = {
    sendEvents: async (events) => void sent.push(...events),
    kvPut: async (entries) => {
      for (const e of entries) kv.set(e.key, e.value);
    },
    kvDelete: async (keys) => {
      for (const k of keys) kv.delete(k);
    },
  };
  return { targets, kv, sent };
}

const domains = { storeDomain: 'stores.example.test', adminHost: 'admin.example.test' };
let seq = 0;
const unique = () => `c${Date.now().toString(36)}${seq++}`;

describe('tenant:create', () => {
  it('creates the store, relays tenant.created and prints the URLs', async () => {
    const { targets, sent } = fakeTargets();
    const slug = unique();
    const result = await tenantCreate(client, targets, domains, {
      slug,
      name: 'CLI Store',
      ownerEmail: `${slug}@Example.test`,
      locale: 'en',
    });
    expect(result).toMatchObject({
      slug,
      adminUrl: 'https://admin.example.test/admin/',
      storeUrl: `https://${slug}.stores.example.test/`,
      relayed: 1,
    });
    expect(sent.map((e) => e.eventType)).toEqual(['tenant.created']);
    const { rows } = await client.query(
      `select dispatched_at from store.outbox where tenant_id = $1`,
      [result.id],
    );
    expect(rows[0]?.dispatched_at).not.toBeNull();
  });

  it('leaves events for the daily sweep without Cloudflare', async () => {
    const slug = unique();
    const result = await tenantCreate(client, null, domains, {
      slug,
      name: 'Local',
      ownerEmail: `${slug}@example.test`,
    });
    expect(result.relayed).toBe(0);
  });
});

describe('platform:grant-role', () => {
  it('creates the user if needed, sets and clears the role, and audits it', async () => {
    const email = `${unique()}@example.test`;
    const first = await grantRole(client, { email, role: 'super_admin' });
    expect(first).toMatchObject({ created: true, role: 'super_admin' });
    const again = await grantRole(client, { email: email.toUpperCase(), role: 'none' });
    expect(again).toMatchObject({ created: false, role: null, userId: first.userId });
    const { rows } = await client.query(
      `select actor_type, after from platform.audit_log where entity_id = $1 order by created_at`,
      [first.userId],
    );
    expect(rows.map((r) => [r.actor_type, r.after])).toEqual([
      ['system', { role: 'super_admin' }],
      ['system', { role: null }],
    ]);
    await expect(grantRole(client, { email, role: 'owner' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });
});

describe('kv:sync', () => {
  it('writes every store’s host keys, or one store’s', async () => {
    const slug = unique();
    const created = await tenantCreate(client, null, domains, {
      slug,
      name: 'Synced',
      ownerEmail: `${slug}@example.test`,
    });
    const one = fakeTargets();
    expect(await kvSync(client, one.targets, 'stores.example.test', created.id)).toEqual({
      stores: 1,
      put: 1,
      deleted: 0,
    });
    expect(JSON.parse(one.kv.get(`host:${slug}.stores.example.test`) ?? '{}')).toMatchObject({
      tenantId: created.id,
      slug,
    });

    const all = fakeTargets();
    const result = await kvSync(client, all.targets, 'stores.example.test');
    expect(result.stores).toBeGreaterThan(1);
    expect(all.kv.has(`host:${slug}.stores.example.test`)).toBe(true);
  });
});
