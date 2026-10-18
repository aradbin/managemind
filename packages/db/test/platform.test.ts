// Platform tables have no RLS, so their grants are the access control
// (phase-1-plan §4.1). The app role's privileges are pinned here: a new grant
// must change this test on purpose.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appUrl, connect, ownerUrl, TENANT_A } from './helpers';

let owner: Awaited<ReturnType<typeof connect>>;
let app: Awaited<ReturnType<typeof connect>>;
let userId: string;
beforeAll(async () => {
  owner = await connect(ownerUrl);
  app = await connect(appUrl);
  const { rows } = await owner.query<{ id: string }>(
    `insert into platform.users (name, email) values ('Platform test', 'platform-test@example.test')
     returning id`,
  );
  userId = rows[0]?.id as string;
});
afterAll(async () => {
  await app.end();
  await owner.end();
});

const ALL = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
const EXPECTED: Record<string, { table: string[]; update?: string[] }> = {
  tenants: {
    table: ['INSERT', 'SELECT'],
    update: ['default_locale', 'name', 'plan', 'settings', 'status'],
  },
  tenant_domains: {
    table: ['INSERT', 'SELECT'],
    update: [
      'check_attempts',
      'failure_reason',
      'is_primary',
      'last_checked_at',
      'ownership_record',
      'provider_ref',
      'ssl_status',
      'status',
      'turnstile',
      'verified_at',
    ],
  },
  tenant_domain_history: { table: ['INSERT', 'SELECT'] },
  users: {
    table: ['INSERT', 'SELECT'],
    update: [
      'email_verified',
      'image',
      'locale',
      'name',
      'platform_role',
      'two_factor_enabled',
      'updated_at',
    ],
  },
  sessions: { table: ALL },
  accounts: { table: ALL },
  verifications: { table: ALL },
  two_factors: { table: ALL },
  memberships: { table: ['DELETE', 'INSERT', 'SELECT'], update: ['role', 'updated_at'] },
  invitations: {
    table: ['INSERT', 'SELECT'],
    update: ['accepted_at', 'accepted_by', 'expires_at', 'status', 'token_hash', 'updated_at'],
  },
  support_grants: { table: ['INSERT', 'SELECT'], update: ['revoked_at', 'updated_at'] },
  audit_log: { table: ['INSERT', 'SELECT'] },
  dev_emails: { table: ['INSERT', 'SELECT'] },
};

describe('app_rw privileges on platform tables', () => {
  it('covers every platform table', async () => {
    const { rows } = await owner.query<{ name: string }>(
      `select c.relname as name from pg_class c
        where c.relnamespace = 'platform'::regnamespace and c.relkind = 'r' order by 1`,
    );
    expect(rows.map((r) => r.name)).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(Object.entries(EXPECTED))('%s has exactly the reviewed grants', async (table, want) => {
    const tableGrants = await owner.query<{ p: string }>(
      `select privilege_type as p from information_schema.role_table_grants
        where grantee = 'app_rw' and table_schema = 'platform' and table_name = $1 order by 1`,
      [table],
    );
    expect(tableGrants.rows.map((r) => r.p)).toEqual(want.table);
    if (want.table.includes('UPDATE')) return;
    const columns = await owner.query<{ c: string }>(
      `select column_name as c from information_schema.column_privileges
        where grantee = 'app_rw' and table_schema = 'platform' and table_name = $1
          and privilege_type = 'UPDATE' order by 1`,
      [table],
    );
    expect(columns.rows.map((r) => r.c)).toEqual(want.update ?? []);
  });
});

describe('platform table rules', () => {
  it("never lets a store's slug change", async () => {
    await expect(
      owner.query(`update platform.tenants set slug = 'renamed-store' where id = $1`, [TENANT_A]),
    ).rejects.toThrow(/slug cannot be changed/);
    await expect(
      app.query(`update platform.tenants set slug = 'renamed-store' where id = $1`, [TENANT_A]),
    ).rejects.toThrow(/permission denied/);
  });

  it('lets the app write platform_role but not change a user id or email', async () => {
    await app.query(`update platform.users set platform_role = 'support' where id = $1`, [userId]);
    await app.query(`update platform.users set platform_role = null where id = $1`, [userId]);
    await expect(
      app.query(`update platform.users set email = 'other@example.test' where id = $1`, [userId]),
    ).rejects.toThrow(/permission denied/);
    await expect(app.query(`delete from platform.users where id = $1`, [userId])).rejects.toThrow(
      /permission denied/,
    );
  });

  it('stores emails in lowercase only', async () => {
    await expect(
      owner.query(`insert into platform.users (name, email) values ('X', 'Upper@Example.test')`),
    ).rejects.toThrow(/users_email_lowercase/);
  });

  it('limits support grants to 4 hours with a reason', async () => {
    const grant = (interval: string, reason: string) =>
      owner.query(
        `insert into platform.support_grants (tenant_id, user_id, role, reason, granted_by, expires_at)
         values ($1, $2, 'viewer', $3, $2, now() + $4::interval)`,
        [TENANT_A, userId, reason, interval],
      );
    await grant('4 hours', 'Customer asked for help with settings');
    await expect(grant('4 hours 1 minute', 'Customer asked for help')).rejects.toThrow(
      /support_grants_max_4_hours/,
    );
    await expect(grant('1 hour', 'help')).rejects.toThrow(/support_grants_reason_length/);
  });

  it('allows one pending invitation per email per store', async () => {
    const invite = (hash: string) =>
      owner.query(
        `insert into platform.invitations (tenant_id, email, role, token_hash, invited_by)
         values ($1, 'twice@example.test', 'viewer', $2, $3)`,
        [TENANT_A, hash, userId],
      );
    await invite('twice-1');
    await expect(invite('twice-2')).rejects.toThrow(/invitations_one_pending/);
  });

  it('allows one active primary domain per store, in lowercase', async () => {
    const domain = (host: string) =>
      owner.query(
        `insert into platform.tenant_domains (tenant_id, hostname, status, is_primary)
         values ($1, $2, 'active', true)`,
        [TENANT_A, host],
      );
    await domain('www.shop-a.example.test');
    await expect(domain('shop-a.example.test')).rejects.toThrow(/tenant_domains_one_primary/);
    await expect(domain('WWW.Upper.example.test')).rejects.toThrow(/hostname_format/);
  });

  it('keeps the platform audit log append-only for the app', async () => {
    await app.query(
      `insert into platform.audit_log (actor_type, action) values ('system', 'test')`,
    );
    await expect(app.query(`update platform.audit_log set action = 'x'`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query('delete from platform.audit_log')).rejects.toThrow(/permission denied/);
  });
});
