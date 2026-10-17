// Structural rules for every store table, read from the Postgres catalog.
// A table that skips any of them fails CI before it can leak data.
import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURES } from '../src/testing';
import { connect, ownerUrl, storeTables } from './helpers';

/** Indexes allowed not to start with tenant_id, with the reason. */
const INDEX_EXCEPTIONS: Record<string, string> = {
  outbox_pending_idx: 'the dispatcher sweeps pending events across all tenants (ADR 0010)',
};

const db = await connect(ownerUrl);
const tables = await storeTables(db);
afterAll(() => db.end());

describe.each(tables)('store.%s', (table) => {
  it('forces row-level security', async () => {
    const { rows } = await db.query(
      `select relrowsecurity, relforcerowsecurity from pg_class where oid = $1::regclass`,
      [`store.${table}`],
    );
    expect(rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it('has the tenant_isolation policy for app_rw', async () => {
    const { rows } = await db.query<{ roles: string[]; qual: string; with_check: string }>(
      `select roles::text[] as roles, qual, with_check from pg_policies
        where schemaname = 'store' and tablename = $1 and policyname = 'tenant_isolation'`,
      [table],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.roles).toEqual(['app_rw']);
    expect(rows[0]?.qual).toContain('app.current_tenant_id()');
    expect(rows[0]?.with_check).toContain('app.current_tenant_id()');
  });

  it('has tenant_id: not null, defaulted from the tenant context, referencing tenants', async () => {
    const col = await db.query(
      `select is_nullable, column_default from information_schema.columns
        where table_schema = 'store' and table_name = $1 and column_name = 'tenant_id'`,
      [table],
    );
    expect(col.rows[0]).toEqual({ is_nullable: 'NO', column_default: 'app.current_tenant_id()' });
    const fk = await db.query(
      `select 1 from pg_constraint
        where conrelid = $1::regclass and contype = 'f' and confrelid = 'platform.tenants'::regclass
          and conkey = array[(select attnum from pg_attribute where attrelid = $1::regclass and attname = 'tenant_id')]`,
      [`store.${table}`],
    );
    expect(fk.rowCount).toBe(1);
  });

  it('starts every index with tenant_id, except primary keys and documented exceptions', async () => {
    const { rows } = await db.query<{ name: string; is_pk: boolean; first: string }>(
      `select c.relname as name, i.indisprimary as is_pk, a.attname as first
         from pg_index i join pg_class c on c.oid = i.indexrelid
         left join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
        where i.indrelid = $1::regclass`,
      [`store.${table}`],
    );
    const offenders = rows.filter(
      (r) => r.first !== 'tenant_id' && !(r.is_pk && r.first === 'id') && !INDEX_EXCEPTIONS[r.name],
    );
    expect(offenders.map((r) => r.name)).toEqual([]);
  });

  it('is granted to app_rw and has an isolation fixture', async () => {
    const { rowCount } = await db.query(
      `select 1 from information_schema.role_table_grants
        where grantee = 'app_rw' and table_schema = 'store' and table_name = $1`,
      [table],
    );
    expect(rowCount).toBeGreaterThan(0);
    expect(FIXTURES[table], `add a fixture for store.${table} in test/fixtures.ts`).toBeTypeOf(
      'function',
    );
  });
});

describe('database-wide rules', () => {
  it.each(['audit_log', 'stock_movements', 'order_history', 'order_notes'])(
    'keeps %s append-only for the app',
    async (table) => {
      const { rows } = await db.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
        where grantee = 'app_rw' and table_schema = 'store' and table_name = $1 order by 1`,
        [table],
      );
      expect(rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
    },
  );

  it('gives PUBLIC no access to app, platform, ref or store', async () => {
    const { rows } = await db.query<{ nspname: string }>(
      `select nspname from pg_namespace
        where nspname in ('app', 'platform', 'ref', 'store') and has_schema_privilege('public', oid, 'USAGE')`,
    );
    expect(rows).toEqual([]);
  });

  it('owns every SECURITY DEFINER function by mm_system with a fixed search_path', async () => {
    const { rows } = await db.query<{ name: string; owner: string; config: string[] | null }>(
      `select p.proname as name, pg_get_userbyid(p.proowner) as owner, p.proconfig as config
         from pg_proc p where p.pronamespace = 'app'::regnamespace and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const fn of rows) {
      expect(fn.owner, fn.name).toBe('mm_system');
      expect(fn.config, fn.name).toContain('search_path=""');
    }
  });
});
