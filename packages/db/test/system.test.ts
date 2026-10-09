// The cross-tenant system functions (migration 0003), called as the app role
// with no tenant context, the way the dispatcher and the daily cron will.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appUrl, connect, inTenant, ownerUrl, TENANT_A, TENANT_B } from './helpers';

let app: Awaited<ReturnType<typeof connect>>;
let owner: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  app = await connect(appUrl);
  owner = await connect(ownerUrl);
});
afterAll(async () => {
  await app.end();
  await owner.end();
});

const addEvent = async (tenant: string, eventType: string) => {
  const { rows } = await inTenant(owner, tenant, () =>
    owner.query<{ id: string }>(
      `insert into store.outbox (event_type, aggregate_type, payload, created_at)
       values ($1, 'test', '{}', now() - interval '10 minutes') returning id`,
      [eventType],
    ),
  );
  return rows[0]?.id as string;
};

describe('outbox functions', () => {
  it('claims pending events from every tenant', async () => {
    const a = await addEvent(TENANT_A, 'test.claim');
    const b = await addEvent(TENANT_B, 'test.claim');
    const { rows } = await app.query<{ id: string; tenant_id: string }>(
      `select id, tenant_id from app.outbox_claim(1000, interval '1 minute') where event_type = 'test.claim'`,
    );
    expect(rows.map((r) => r.id).sort()).toEqual([a, b].sort());
  });

  it('skips events younger than min_age, which the request path is still relaying', async () => {
    const { rows } = await app.query(`select id from app.outbox_claim(1000, interval '1 hour')`);
    expect(rows).toEqual([]);
  });

  it('marks events dispatched exactly once', async () => {
    const id = await addEvent(TENANT_A, 'test.mark');
    const first = await app.query<{ n: number }>('select app.outbox_mark_dispatched($1) as n', [
      [id],
    ]);
    const second = await app.query<{ n: number }>('select app.outbox_mark_dispatched($1) as n', [
      [id],
    ]);
    expect([first.rows[0]?.n, second.rows[0]?.n]).toEqual([1, 0]);
  });

  it('records failed relay attempts', async () => {
    const id = await addEvent(TENANT_B, 'test.fail');
    await app.query('select app.outbox_mark_failed($1, $2)', [id, 'queue unavailable']);
    const { rows } = await owner.query(
      'select attempts, last_error from store.outbox where id = $1',
      [id],
    );
    expect(rows[0]).toEqual({ attempts: 1, last_error: 'queue unavailable' });
  });

  it('cannot be bypassed: the app has no direct UPDATE on the outbox', async () => {
    await expect(app.query('update store.outbox set dispatched_at = now()')).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('cleanup_expired', () => {
  it('deletes expired idempotency keys and old dispatched events, nothing else', async () => {
    await inTenant(owner, TENANT_A, async () => {
      await owner.query(
        `insert into store.idempotency_keys (scope, key, request_hash, locked_until, expires_at)
         values ('test.cleanup', 'expired-key-0001', 'h', now(), now() - interval '1 hour'),
                ('test.cleanup', 'current-key-0001', 'h', now(), now() + interval '1 hour')`,
      );
      await owner.query(
        `insert into store.outbox (event_type, aggregate_type, payload, dispatched_at)
         values ('test.cleanup', 'test', '{}', now() - interval '8 days'),
                ('test.cleanup', 'test', '{}', now() - interval '1 day')`,
      );
    });
    const { rows } = await app.query<{ name: string; deleted: string }>(
      'select * from app.cleanup_expired()',
    );
    const deleted = Object.fromEntries(rows.map((r) => [r.name, Number(r.deleted)]));
    expect(deleted).toEqual({ idempotency_keys: 1, outbox_dispatched: 1 });
    const left = await owner.query(
      `select (select count(*)::int from store.idempotency_keys where scope = 'test.cleanup') as keys,
              (select count(*)::int from store.outbox where event_type = 'test.cleanup') as events`,
    );
    expect(left.rows[0]).toEqual({ keys: 1, events: 1 });
  });
});
