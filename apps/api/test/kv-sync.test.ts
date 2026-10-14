import { createTenant, type OutboxEvent, systemActor, transitionTenant } from '@managemind/core';
import { connect } from '@managemind/db/testing';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleQueue } from '../src/jobs';
import { appUrl, makeCtx, makeEnv } from './support';

/** KVNamespace in memory, counting writes. */
function fakeKv() {
  const data = new Map<string, string>();
  const kv = {
    data,
    writes: 0,
    get: async (key: string) => data.get(key) ?? null,
    put: async (key: string, value: string) => {
      kv.writes++;
      data.set(key, value);
    },
    delete: async (key: string) => {
      kv.writes++;
      data.delete(key);
    },
  };
  return kv;
}

let app: pg.Client;
beforeAll(async () => {
  app = await connect(appUrl);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => app.end());

async function store() {
  const slug = `kv${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const events: OutboxEvent[] = [];
  const { id } = await createTenant(
    app,
    systemActor,
    { slug, name: 'KV Store', owner: { email: `${slug}@example.test`, name: 'Owner' } },
    { afterCommit: (e) => void events.push(...e) },
  );
  return { id, slug, events };
}

function batch(events: OutboxEvent[]) {
  const outcome: Record<string, 'ack' | 'retry'> = {};
  const messages = events.map((body) => ({
    id: body.id,
    attempts: 1,
    body,
    ack: () => {
      outcome[body.id] = 'ack';
    },
    retry: () => {
      outcome[body.id] = 'retry';
    },
  }));
  return {
    outcome,
    batch: { queue: 'managemind-outbox', messages } as unknown as MessageBatch<OutboxEvent>,
  };
}

describe('KV host sync', () => {
  it('writes the default host on tenant.created, and nothing on a redelivery', async () => {
    const kv = fakeKv();
    const env = makeEnv({ EDGE: kv as unknown as KVNamespace });
    const { id, slug, events } = await store();
    const first = batch(events);
    await handleQueue(first.batch, env, makeCtx());
    expect(Object.values(first.outcome)).toEqual(['ack']);
    expect(JSON.parse(kv.data.get(`host:${slug}.stores.example.test`) ?? '{}')).toEqual({
      tenantId: id,
      slug,
      name: 'KV Store',
      defaultLocale: 'bn',
      status: 'active',
      primaryHost: `${slug}.stores.example.test`,
    });
    expect(kv.writes).toBe(1);
    await handleQueue(batch([...events, ...events]).batch, env, makeCtx());
    expect(kv.writes).toBe(1);
  });

  it('follows a suspension', async () => {
    const kv = fakeKv();
    const env = makeEnv({ EDGE: kv as unknown as KVNamespace });
    const { id, slug, events } = await store();
    await transitionTenant(
      app,
      systemActor,
      id,
      'suspend',
      { reason: 'abuse report' },
      {
        afterCommit: (e) => void events.push(...e),
      },
    );
    await handleQueue(batch(events).batch, env, makeCtx());
    expect(JSON.parse(kv.data.get(`host:${slug}.stores.example.test`) ?? '{}').status).toBe(
      'suspended',
    );
    expect(kv.writes).toBe(1); // two events, one store, one write
  });

  it('acknowledges other events, and everything when KV is not bound (previews)', async () => {
    const { events } = await store();
    const seeded = { ...events[0], id: 'other', eventType: 'tenant.seeded' } as OutboxEvent;
    const kv = fakeKv();
    const withKv = batch([seeded]);
    await handleQueue(withKv.batch, makeEnv({ EDGE: kv as unknown as KVNamespace }), makeCtx());
    expect(withKv.outcome).toEqual({ other: 'ack' });
    const preview = batch(events);
    await handleQueue(preview.batch, makeEnv(), makeCtx());
    expect(Object.values(preview.outcome)).toEqual(['ack']);
    expect(kv.writes).toBe(0);
  });

  it('retries the store’s messages when the database is unreachable', async () => {
    const { events } = await store();
    const env = makeEnv({
      EDGE: fakeKv() as unknown as KVNamespace,
      HYPERDRIVE: {
        connectionString: 'postgres://nobody:x@127.0.0.1:1/none',
      } as unknown as Hyperdrive,
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const b = batch(events);
    await handleQueue(b.batch, env, makeCtx());
    errors.mockRestore();
    expect(Object.values(b.outcome)).toEqual(['retry']);
  });
});
