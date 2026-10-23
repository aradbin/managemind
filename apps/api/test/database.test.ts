import { slugFromHost } from '@managemind/core';
import { connect, inTenant, TENANT_A, TENANT_B } from '@managemind/db/testing';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import { connectionString } from '../src/db';
import { checkInventoryDrift, handleQueue, runDailyJobs } from '../src/jobs';
import { makeCtx, makeEnv, ownerUrl } from './support';

const call = async (path: string, init: RequestInit = {}, env = makeEnv()) => {
  const ctx = makeCtx();
  const res = await createApp().request(path, init, env, ctx);
  await ctx.settle();
  return res;
};

describe('GET /health/deep', () => {
  it('reaches the database', async () => {
    const res = await call('/health/deep');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('connects with DATABASE_URL when Hyperdrive is not bound, as previews do', async () => {
    const { HYPERDRIVE, ...rest } = makeEnv();
    const env = { ...rest, DATABASE_URL: HYPERDRIVE?.connectionString ?? '' };
    const res = await call('/health/deep', {}, env);
    expect(res.status).toBe(200);
  });

  it('prefers Hyperdrive when both are set', () => {
    expect(
      connectionString({
        HYPERDRIVE: { connectionString: 'postgres://hd' } as unknown as Hyperdrive,
        DATABASE_URL: 'postgres://direct',
      }),
    ).toBe('postgres://hd');
    expect(() => connectionString({})).toThrow(/no database/);
  });

  it('reports 503 when the database is unreachable', async () => {
    const env = makeEnv({
      HYPERDRIVE: {
        connectionString: 'postgres://nobody:x@127.0.0.1:1/none',
      } as unknown as Hyperdrive,
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await call('/health/deep', {}, env);
    errors.mockRestore();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unavailable', database_ms: null });
  });
});

describe('GET /v1/store/context', () => {
  const lookup = (host?: string) =>
    call('/v1/store/context', host ? { headers: { 'x-forwarded-host': host } } : {});

  it('resolves {slug}.<STORE_DOMAIN> to the store', async () => {
    const res = await lookup('Demo-Fashion.stores.example.test:443');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: TENANT_A,
      slug: 'demo-fashion',
      name: 'Demo Fashion',
      defaultLocale: 'en',
      status: 'active',
      primaryHost: 'demo-fashion.stores.example.test',
    });
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('returns store_not_found for unknown stores and foreign domains', async () => {
    for (const host of [
      'nope.stores.example.test',
      'demo-fashion.evil.test',
      'stores.example.test',
    ]) {
      const res = await lookup(host);
      expect(res.status, host).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'store_not_found' });
    }
  });

  it('resolves a suspended store with its status, and not a closed one', async () => {
    const owner = await connect(ownerUrl);
    await owner.query("update platform.tenants set status = 'suspended' where id = $1", [TENANT_B]);
    try {
      const suspended = await lookup('demo-grocery.stores.example.test');
      expect(suspended.status).toBe(200);
      expect(await suspended.json()).toMatchObject({ slug: 'demo-grocery', status: 'suspended' });
      await owner.query("update platform.tenants set status = 'closed' where id = $1", [TENANT_B]);
      expect((await lookup('demo-grocery.stores.example.test')).status).toBe(404);
    } finally {
      await owner.query("update platform.tenants set status = 'active' where id = $1", [TENANT_B]);
      await owner.end();
    }
  });

  it('requires the host header', async () => {
    const res = await lookup();
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'validation_failed' });
  });

  it('parses hosts strictly', () => {
    expect(slugFromHost('a.localhost', 'localhost')).toBeNull(); // slug too short
    expect(slugFromHost('shop-1.localhost.', 'localhost')).toBe('shop-1');
    expect(slugFromHost('a.b.localhost', 'localhost')).toBeNull();
  });
});

describe('daily jobs', () => {
  it('relays leftover outbox events from every tenant and cleans up', async () => {
    const owner = await connect(ownerUrl);
    const ids: string[] = [];
    for (const tenant of [TENANT_A, TENANT_B]) {
      await inTenant(owner, tenant, async () => {
        const { rows } = await owner.query<{ id: string }>(
          `insert into store.outbox (event_type, aggregate_type, payload, created_at)
           values ('tenant.seeded', 'tenant', '{"slug":"x"}', now() - interval '1 hour') returning id`,
        );
        ids.push(rows[0]?.id as string);
      });
    }
    const env = makeEnv();
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = makeCtx();
    await runDailyJobs(env, ctx);
    await ctx.settle();
    info.mockRestore();
    warn.mockRestore();
    expect(env.OUTBOX.sent.map((e) => e.id)).toEqual(expect.arrayContaining(ids));
    const { rows } = await owner.query(
      'select count(*)::int as n from store.outbox where id = any($1) and dispatched_at is null',
      [ids],
    );
    expect(rows[0]).toEqual({ n: 0 });
    await owner.end();
  });

  it('alerts when a stock level differs from its movements', async () => {
    const owner = await connect(ownerUrl);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await checkInventoryDrift(owner)).toBe(0);
      // Inside a transaction that is rolled back: a level nothing explains.
      await owner.query('begin');
      await owner.query(
        `update store.inventory_levels set on_hand = on_hand + 1
          where tenant_id = $1 and variant_id = (select variant_id from store.inventory_levels where tenant_id = $1 limit 1)`,
        [TENANT_A],
      );
      expect(await checkInventoryDrift(owner)).toBe(1);
    } finally {
      await owner.query('rollback');
      error.mockRestore();
      await owner.end();
    }
  });

  it('acknowledges queue messages', async () => {
    const acked: string[] = [];
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    await handleQueue(
      {
        queue: 'managemind-outbox',
        messages: [
          {
            id: 'm1',
            attempts: 1,
            body: { id: 'e1', eventType: 'tenant.seeded', tenantId: TENANT_A },
            ack: () => acked.push('m1'),
          },
        ],
      } as unknown as MessageBatch<never>,
      makeEnv(),
      makeCtx(),
    );
    info.mockRestore();
    expect(acked).toEqual(['m1']);
  });
});
