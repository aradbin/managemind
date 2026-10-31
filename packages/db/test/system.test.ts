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
  it('deletes expired technical rows, nothing else', async () => {
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
    const { rows: users } = await owner.query<{ id: string }>(
      `insert into platform.users (name, email) values ('Cleanup', 'cleanup@example.test') returning id`,
    );
    const userId = users[0]?.id;
    await owner.query(
      `insert into platform.sessions (user_id, token, expires_at)
       values ($1, 'cleanup-old', now() - interval '2 days'), ($1, 'cleanup-new', now() - interval '1 hour')`,
      [userId],
    );
    await owner.query(
      `insert into platform.verifications (identifier, value, expires_at)
       values ('cleanup-old', 'x', now() - interval '2 days'), ('cleanup-new', 'x', now())`,
    );
    await owner.query(
      `insert into platform.dev_emails ("to", subject, text, html, created_at)
       values ('cleanup@example.test', 's', 't', 'h', now() - interval '2 days'),
              ('cleanup@example.test', 's', 't', 'h', now())`,
    );
    await owner.query(
      `insert into platform.invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
       values ($1, 'old@example.test', 'staff', 'cleanup-old', $2, now() - interval '1 minute'),
              ($1, 'new@example.test', 'staff', 'cleanup-new', $2, now() + interval '1 day')`,
      [TENANT_A, userId],
    );
    const { rows } = await app.query<{ name: string; deleted: string }>(
      'select * from app.cleanup_expired()',
    );
    const deleted = Object.fromEntries(rows.map((r) => [r.name, Number(r.deleted)]));
    expect(deleted).toEqual({
      idempotency_keys: 1,
      outbox_dispatched: 1,
      sessions: 1,
      verifications: 1,
      dev_emails: 1,
      invitations_expired: 1,
      carts: 0,
      shopper_sessions: 0,
      shopper_verifications: 0,
      order_ips: 0,
      order_attribution: 0,
      messages: 0,
      incomplete_orders: 0,
    });
    const platform = await owner.query(
      `select (select count(*)::int from platform.sessions where token like 'cleanup-%') as sessions,
              (select count(*)::int from platform.verifications where identifier like 'cleanup-%') as codes,
              (select count(*)::int from platform.dev_emails where "to" = 'cleanup@example.test') as emails,
              (select string_agg(status, ',' order by email) from platform.invitations
                where token_hash like 'cleanup-%') as invitations`,
    );
    expect(platform.rows[0]).toEqual({
      sessions: 1,
      codes: 1,
      emails: 1,
      invitations: 'pending,expired',
    });
    const left = await owner.query(
      `select (select count(*)::int from store.idempotency_keys where scope = 'test.cleanup') as keys,
              (select count(*)::int from store.outbox where event_type = 'test.cleanup') as events`,
    );
    expect(left.rows[0]).toEqual({ keys: 1, events: 1 });
  });
});

describe('cleanup_expired, Phase 4', () => {
  it('deletes old carts and expired shopper sessions, and clears old order IPs', async () => {
    const before = await inTenant(owner, TENANT_A, async () => {
      await owner.query(
        `insert into store.carts (token_hash, status, updated_at) values
           (encode(sha256('cleanup-1'::bytea), 'hex'), 'active', now() - interval '31 days'),
           (encode(sha256('cleanup-2'::bytea), 'hex'), 'active', now() - interval '29 days'),
           (encode(sha256('cleanup-3'::bytea), 'hex'), 'converted', now() - interval '8 days')`,
      );
      await owner.query(
        `insert into store.shopper_sessions (user_id, token, expires_at)
         select id, 'cleanup-' || gen_random_uuid(), now() - interval '1 minute'
           from store.shopper_users limit 1`,
      );
      await owner.query(
        `insert into store.shopper_verifications (identifier, value, expires_at)
         values ('cleanup', 'x', now() - interval '1 minute')`,
      );
      const { rows } = await owner.query<{ id: string }>(
        `insert into store.orders (number, source, customer_id, phone, contact, subtotal, total, locale, ip, user_agent, placed_at)
         select 99001, 'website', id, phone, '{}', 0, 0, 'en', '10.0.0.1', 'UA', now() - interval '91 days'
           from store.customers limit 1 returning id`,
      );
      return rows[0]?.id;
    });
    const { rows } = await app.query<{ name: string; deleted: string }>(
      'select * from app.cleanup_expired()',
    );
    const deleted = Object.fromEntries(rows.map((r) => [r.name, Number(r.deleted)]));
    expect(deleted).toMatchObject({
      carts: 2,
      shopper_sessions: 1,
      shopper_verifications: 1,
      order_ips: 1,
    });
    const left = await inTenant(owner, TENANT_A, () =>
      owner.query(
        `select (select count(*)::int from store.carts where token_hash in
                  (encode(sha256('cleanup-2'::bytea), 'hex'))) as carts,
                (select ip is null and user_agent is null from store.orders where id = $1) as cleared`,
        [before],
      ),
    );
    expect(left.rows[0]).toEqual({ carts: 1, cleared: true });
  });
});

describe('cleanup_expired, Phase 6', () => {
  it("deletes incomplete orders after the store's keepDays, 30 at most", async () => {
    const insert = (tenant: string, days: number) =>
      inTenant(owner, tenant, () =>
        owner.query(
          `insert into store.incomplete_orders (phone, lines, subtotal, locale, updated_at)
           values ('+8801700000009', '[{"quantity": 1}]', 100, 'en', now() - make_interval(days => $1))`,
          [days],
        ),
      );
    await owner.query(
      `update platform.tenants set settings = jsonb_set(settings, '{recovery}', '{"keepDays": 7}')
        where id = $1`,
      [TENANT_B],
    );
    try {
      await insert(TENANT_A, 31);
      await insert(TENANT_A, 29);
      await insert(TENANT_B, 8);
      await insert(TENANT_B, 6);
      const { rows } = await app.query<{ name: string; deleted: string }>(
        'select * from app.cleanup_expired()',
      );
      const deleted = Object.fromEntries(rows.map((r) => [r.name, Number(r.deleted)]));
      expect(deleted).toMatchObject({ incomplete_orders: 2 });
      const left = await owner.query<{ tenant_id: string; days: number }>(
        `select tenant_id, extract(day from now() - updated_at)::int as days
           from store.incomplete_orders where phone = '+8801700000009' order by tenant_id, days`,
      );
      expect(left.rows).toEqual(
        [
          { tenant_id: TENANT_A, days: 29 },
          { tenant_id: TENANT_B, days: 6 },
        ].sort((x, y) => x.tenant_id.localeCompare(y.tenant_id)),
      );
    } finally {
      await owner.query(
        `update platform.tenants set settings = settings - 'recovery' where id = $1`,
        [TENANT_B],
      );
      await owner.query(`delete from store.incomplete_orders where phone = '+8801700000009'`);
    }
  });
});

describe('cleanup_expired, Phase 9', () => {
  it("clears an order's ad attribution after 30 days and keeps its IP until 90", async () => {
    const [recent, old, older] = await inTenant(owner, TENANT_A, async () => {
      const { rows } = await owner.query<{ id: string }>(
        `insert into store.orders (number, source, customer_id, phone, contact, subtotal, total, locale,
                                   ip, user_agent, attribution, placed_at)
         select n, 'website', c.id, c.phone, '{}', 0, 0, 'en', '10.0.0.1', 'UA',
                '{"fbp": "fb.1.1.1", "consentedAt": "2026-01-01T00:00:00Z"}', now() - make_interval(days => d)
           from (select id, phone from store.customers limit 1) c,
                (values (99101, 29), (99102, 31), (99103, 91)) as v(n, d)
          order by n
         returning id`,
      );
      return rows.map((r) => r.id);
    });
    const { rows } = await app.query<{ name: string; deleted: string }>(
      'select * from app.cleanup_expired()',
    );
    const deleted = Object.fromEntries(rows.map((r) => [r.name, Number(r.deleted)]));
    expect(deleted).toMatchObject({ order_ips: 1, order_attribution: 1 });
    const left = await inTenant(owner, TENANT_A, () =>
      owner.query<{ id: string; attribution: boolean; ip: boolean }>(
        `select id, attribution is not null as attribution, ip is not null as ip
           from store.orders where id = any($1::uuid[])`,
        [[recent, old, older]],
      ),
    );
    const byId = Object.fromEntries(left.rows.map((r) => [r.id, r]));
    expect(byId[recent as string]).toMatchObject({ attribution: true, ip: true });
    expect(byId[old as string]).toMatchObject({ attribution: false, ip: true });
    expect(byId[older as string]).toMatchObject({ attribution: false, ip: false });
  });
});
