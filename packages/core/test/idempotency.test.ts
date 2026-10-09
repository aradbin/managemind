import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalJson, runIdempotent, withTenant } from '../src';
import { connectApp, TENANT_A, TENANT_B } from './setup';

let app: pg.Client;
let app2: pg.Client;
beforeAll(async () => {
  app = await connectApp();
  app2 = await connectApp();
});
afterAll(async () => {
  await app.end();
  await app2.end();
});

const key = () => `test-${crypto.randomUUID()}`;
const run = (
  client: pg.Client,
  tenant: string,
  k: string,
  request: unknown,
  fn: () => Promise<{ status: number; body: unknown }>,
) =>
  withTenant(client, tenant, (tx) =>
    runIdempotent(tx, { scope: 'test.place', key: k, request }, fn),
  );

describe('runIdempotent', () => {
  it('runs once and replays the stored result for a retry', async () => {
    const k = key();
    let calls = 0;
    const fn = async () => ({ status: 201, body: { order: `ORD-${++calls}` } });
    const first = await run(app, TENANT_A, k, { items: [1, 2] }, fn);
    const retry = await run(app, TENANT_A, k, { items: [1, 2] }, fn);
    expect(first).toEqual({ status: 201, body: { order: 'ORD-1' }, replayed: false });
    expect(retry).toEqual({ status: 201, body: { order: 'ORD-1' }, replayed: true });
    expect(calls).toBe(1);
  });

  it('refuses the same key with a different request', async () => {
    const k = key();
    const fn = async () => ({ status: 201, body: {} });
    await run(app, TENANT_A, k, { items: [1] }, fn);
    await expect(run(app, TENANT_A, k, { items: [2] }, fn)).rejects.toMatchObject({
      code: 'idempotency_key_reused',
      status: 422,
    });
  });

  it('lets a retry run again when the first attempt failed', async () => {
    const k = key();
    await expect(
      run(app, TENANT_A, k, {}, async () => {
        throw new Error('stock gone');
      }),
    ).rejects.toThrow('stock gone');
    const retry = await run(app, TENANT_A, k, {}, async () => ({
      status: 201,
      body: { ok: true },
    }));
    expect(retry.replayed).toBe(false);
  });

  it('keeps keys separate per tenant', async () => {
    const k = key();
    const a = await run(app, TENANT_A, k, {}, async () => ({ status: 201, body: 'A' }));
    const b = await run(app, TENANT_B, k, {}, async () => ({ status: 201, body: 'B' }));
    expect([a.body, b.body, b.replayed]).toEqual(['A', 'B', false]);
  });

  it('runs a concurrent duplicate only once', async () => {
    const k = key();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = run(app, TENANT_A, k, { n: 1 }, async () => {
      calls += 1;
      await gate;
      return { status: 201, body: { n: calls } };
    });
    await new Promise((r) => setTimeout(r, 50));
    const second = run(app2, TENANT_A, k, { n: 1 }, async () => {
      calls += 1;
      return { status: 201, body: { n: calls } };
    });
    await new Promise((r) => setTimeout(r, 50));
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect([r1.replayed, r2.replayed]).toEqual([false, true]);
    expect(r2.body).toEqual(r1.body);
  });

  it('rejects keys that are too short or too long', async () => {
    const fn = async () => ({ status: 200, body: null });
    await expect(run(app, TENANT_A, 'short', {}, fn)).rejects.toMatchObject({
      code: 'validation_failed',
    });
    await expect(run(app, TENANT_A, 'x'.repeat(256), {}, fn)).rejects.toMatchObject({
      code: 'validation_failed',
    });
  });

  it('hashes requests independently of key order', () => {
    expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });
});
