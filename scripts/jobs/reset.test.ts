// A demo or test store's reset (phase-5b-plan §3.12): its rows and files go,
// the store, its people and settings stay, and it starts again with the
// defaults; a demo store also gets its sample catalog and a month of orders.
// The weekly job queues the demo stores' resets.
import {
  type Actor,
  createProduct,
  createTenant,
  type OutboxEvent,
  requestReset,
  systemActor,
  withTenant,
} from '@managemind/core';
import { DEMO_TENANTS } from '@managemind/db/seed';
import { connect, testUrls } from '@managemind/db/testing';
import { permissionsOf } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ObjectStore } from './export';
import { queueDemoResets, runJobs } from './runner';

const { ownerUrl } = testUrls('managemind_test_scripts');
let client: pg.Client;
beforeAll(async () => {
  client = await connect(ownerUrl);
});
afterAll(() => client.end());

function memoryFiles(): ObjectStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async *list(prefix: string) {
      for (const [key, body] of objects)
        if (key.startsWith(prefix)) yield { key, size: body.length };
    },
    get: async (key) => objects.get(key) ?? null,
    put: async (key, body) => void objects.set(key, body),
    delete: async (keys) => {
      for (const k of keys) objects.delete(k);
    },
  };
}

const admin: Actor = {
  kind: 'user',
  userId: null,
  platformRole: 'super_admin',
  permissions: new Set(),
};
const one = async (q: string, params: unknown[]) => (await client.query(q, params)).rows[0];
const n = async (q: string, params: unknown[]) => Number((await one(q, params))?.n ?? 0);

function deps(files: ObjectStore, sent: OutboxEvent[]) {
  return {
    client,
    files,
    kv: { list: async () => [], delete: async () => {} },
    storeDomain: 'stores.example.test',
    sink: { send: async (events: readonly OutboxEvent[]) => void sent.push(...events) },
    log: () => {},
  };
}

describe('resetting a store', () => {
  it('empties a test store and gives it the defaults again; the store and people stay', async () => {
    const slug = `rs${Date.now().toString(36)}`;
    const { id, ownerUserId } = await createTenant(client, systemActor, {
      slug,
      name: 'Reset Me',
      defaultLocale: 'en',
      kind: 'test',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    });
    const owner: Actor = {
      kind: 'user',
      userId: ownerUserId,
      platformRole: null,
      permissions: permissionsOf('owner'),
      tenantId: id,
      storeRole: 'owner',
    };
    await withTenant(client, id, (tx) =>
      createProduct(tx, owner, {
        status: 'active',
        translations: { en: { title: 'Old' } },
        variant: { price: 100 },
      }),
    );
    const files = memoryFiles();
    files.objects.set(`tenants/${id}/products/old.webp`, new Uint8Array([1]));
    files.objects.set(`exports/tenants/${id}/live.zip`, new Uint8Array([2]));

    // A client store is never reset, and the address must be typed.
    await expect(
      withTenant(client, id, (tx) => requestReset(tx, admin, { slug: 'wrong' })),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const { job } = await withTenant(client, id, (tx) => requestReset(tx, admin, { slug }));
    const sent: OutboxEvent[] = [];
    expect((await runJobs(deps(files, sent), { jobId: job.id })).succeeded).toEqual([job.id]);

    expect(await n('select count(*) as n from store.products where tenant_id = $1', [id])).toBe(0);
    expect([...files.objects.keys()]).toEqual([`exports/tenants/${id}/live.zip`]);
    // The defaults again: the brand attribute, a stock location, the zones and the legal drafts.
    expect(
      await n(`select count(*) as n from store.attributes where tenant_id = $1 and is_system`, [
        id,
      ]),
    ).toBe(1);
    expect(
      await n('select count(*) as n from store.stock_locations where tenant_id = $1', [id]),
    ).toBe(1);
    expect(
      await n('select count(*) as n from store.delivery_zones where tenant_id = $1', [id]),
    ).toBeGreaterThan(0);
    expect(
      await n(`select count(*) as n from store.pages where tenant_id = $1 and kind = 'terms'`, [
        id,
      ]),
    ).toBe(1);
    // The store and its owner stay.
    expect(await one('select status, kind from platform.tenants where id = $1', [id])).toEqual({
      status: 'active',
      kind: 'test',
    });
    expect(
      await n('select count(*) as n from platform.memberships where tenant_id = $1', [id]),
    ).toBe(1);
    // One store-wide cache purge; nothing else is left to send.
    expect(sent.map((e) => e.eventType)).toEqual(['tenant.reset']);
    expect(
      await n(
        'select count(*) as n from store.outbox where tenant_id = $1 and dispatched_at is null',
        [id],
      ),
    ).toBe(0);
  });

  it('refuses a client store', async () => {
    const slug = `rc${Date.now().toString(36)}`;
    const { id } = await createTenant(client, systemActor, {
      slug,
      name: 'Client',
      owner: { email: `${slug}@example.test`, name: 'Owner' },
    });
    await expect(
      withTenant(client, id, (tx) => requestReset(tx, admin, { slug })),
    ).rejects.toMatchObject({
      code: 'illegal_transition',
    });
  });

  it('gives a demo store its catalog and a month of sample orders, weekly', async () => {
    const demo = DEMO_TENANTS[0] as (typeof DEMO_TENANTS)[number];
    expect(await queueDemoResets(client, [demo.slug])).toBe(1);
    // Queued once: the job is open.
    expect(await queueDemoResets(client, [demo.slug])).toBe(0);
    const files = memoryFiles();
    const summary = await runJobs(deps(files, []));
    expect(summary.failed).toEqual([]);
    expect(summary.succeeded.length).toBeGreaterThan(0);
    expect(
      await n('select count(*) as n from store.products where tenant_id = $1', [demo.id]),
    ).toBeGreaterThan(0);
    const orders = await client.query<{ status: string; days: number }>(
      `select status, extract(day from now() - placed_at)::int as days from store.orders where tenant_id = $1`,
      [demo.id],
    );
    expect(orders.rows.length).toBe(30);
    expect(new Set(orders.rows.map((o) => o.status))).toEqual(
      new Set(['pending', 'confirmed', 'processing', 'completed', 'cancelled']),
    );
    expect(Math.max(...orders.rows.map((o) => o.days))).toBeGreaterThan(20);
    const shipments = await client.query<{ status: string }>(
      'select distinct status from store.shipments where tenant_id = $1',
      [demo.id],
    );
    expect(new Set(shipments.rows.map((r) => r.status))).toEqual(
      new Set(['pending', 'shipped', 'delivered', 'failed', 'returned']),
    );
  });
});
