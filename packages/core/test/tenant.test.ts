import { AppError } from '@managemind/shared';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emit, recordAudit, withTenant } from '../src';
import { connectApp, TENANT_A } from './setup';

let app: pg.Client;
beforeAll(async () => {
  app = await connectApp();
});
afterAll(() => app.end());

const currentTenant = async () =>
  (await app.query<{ t: string | null }>('select app.current_tenant_id() as t')).rows[0]?.t;

describe('withTenant', () => {
  it.each([
    '',
    'not-a-uuid',
    "x'; drop table store.outbox; --",
    '0199D000-0000-7000-8000-00000000F001',
  ])('refuses %j as a tenant id', async (bad) => {
    await expect(withTenant(app, bad, async () => 1)).rejects.toMatchObject({
      code: 'tenant_context_missing',
    });
  });

  it('sets the tenant for the transaction only', async () => {
    const inside = await withTenant(app, TENANT_A, async (tx) => {
      const { rows } = await app.query<{ t: string }>('select app.current_tenant_id() as t');
      return [rows[0]?.t, tx.tenantId];
    });
    expect(inside).toEqual([TENANT_A, TENANT_A]);
    expect(await currentTenant()).toBeNull();
  });

  it('rolls back everything when fn throws', async () => {
    const marker = `rollback-${crypto.randomUUID()}`;
    await expect(
      withTenant(app, TENANT_A, async (tx) => {
        await recordAudit(tx, { actorType: 'system', action: marker });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const count = await withTenant(
      app,
      TENANT_A,
      async () =>
        (await app.query('select 1 from store.audit_log where action = $1', [marker])).rowCount,
    );
    expect(count).toBe(0);
  });

  it('refuses to nest on the same connection', async () => {
    await expect(
      withTenant(app, TENANT_A, () => withTenant(app, TENANT_A, async () => 1)),
    ).rejects.toBeInstanceOf(AppError);
    expect(await currentTenant()).toBeNull();
  });

  it('hands emitted events to afterCommit only after a commit', async () => {
    const seen: string[] = [];
    const afterCommit = (events: readonly { eventType: string }[]) => {
      seen.push(...events.map((e) => e.eventType));
    };
    await withTenant(
      app,
      TENANT_A,
      (tx) => emit(tx, 'tenant.seeded', { aggregateType: 'tenant', payload: { slug: 'x' } }),
      { afterCommit },
    );
    await withTenant(
      app,
      TENANT_A,
      async (tx) => {
        await emit(tx, 'tenant.seeded', { aggregateType: 'tenant', payload: { slug: 'y' } });
        throw new Error('rolled back');
      },
      { afterCommit },
    ).catch(() => {});
    expect(seen).toEqual(['tenant.seeded']);
  });
});
