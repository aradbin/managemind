// The isolation suite (PLAN.md: "raw SQL as the app role with tenant A
// context returns zero store B rows"). Generated from the catalog: every
// table in the store schema is checked, so new tables join automatically.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURES } from '../src/testing';
import {
  APP_ROLE,
  appUrl,
  connect,
  inTenant,
  ownerUrl,
  storeTables,
  TENANT_A,
  TENANT_B,
} from './helpers';

const owner = await connect(ownerUrl);
const tables = await storeTables(owner);
const privileges = new Map<string, Set<string>>();
for (const table of tables) {
  const { rows } = await owner.query<{ privilege_type: string }>(
    `select privilege_type from information_schema.role_table_grants
      where grantee = 'app_rw' and table_schema = 'store' and table_name = $1`,
    [table],
  );
  privileges.set(table, new Set(rows.map((r) => r.privilege_type)));
}
await owner.end();

let app: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => {
  app = await connect(appUrl);
});
afterAll(async () => {
  await app.end();
});

const count = async (sql: string) => Number((await app.query<{ n: string }>(sql)).rows[0]?.n);

describe.each(tables)('store.%s', (table) => {
  const can = (p: string) => privileges.get(table)?.has(p) ?? false;

  it('shows a tenant only its own rows', async () => {
    const [own, foreign] = await inTenant(app, TENANT_A, async () => [
      await count(`select count(*) as n from store.${table}`),
      await count(`select count(*) as n from store.${table} where tenant_id <> '${TENANT_A}'`),
    ]);
    expect(own).toBeGreaterThan(0);
    expect(foreign).toBe(0);
  });

  it('shows nothing without a tenant', async () => {
    expect(await count(`select count(*) as n from store.${table}`)).toBe(0);
    await app.query('begin');
    expect(await count(`select count(*) as n from store.${table}`)).toBe(0);
    await app.query('rollback');
  });

  it('ignores a tenant left on the connection by an earlier transaction', async () => {
    await app.query(
      "select set_config('app.tenant_id', $1, false), set_config('app.tenant_at', now()::text, false)",
      [TENANT_A],
    );
    try {
      expect(await count(`select count(*) as n from store.${table}`)).toBe(0);
    } finally {
      await app.query('reset all');
    }
  });

  it.runIf(can('INSERT'))('refuses to insert rows for another tenant', async () => {
    const insert = FIXTURES[table];
    if (!insert) throw new Error(`no fixture for store.${table}`);
    await expect(inTenant(app, TENANT_A, () => app.query(insert(`'${TENANT_B}'`)))).rejects.toThrow(
      /row-level security/,
    );
  });

  it.runIf(can('UPDATE'))('refuses to move rows to another tenant', async () => {
    await expect(
      inTenant(app, TENANT_A, () =>
        app.query(`update store.${table} set tenant_id = '${TENANT_B}'`),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it.runIf(can('DELETE'))("cannot delete another tenant's rows", async () => {
    const result = await inTenant(app, TENANT_A, () =>
      app.query(`delete from store.${table} where tenant_id = '${TENANT_B}'`),
    );
    expect(result.rowCount).toBe(0);
  });

  it.runIf(!can('UPDATE'))('cannot update at all', async () => {
    await expect(
      inTenant(app, TENANT_A, () => app.query(`update store.${table} set tenant_id = tenant_id`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('the app login role', () => {
  it('cannot bypass row-level security or become a privileged role', async () => {
    const { rows } = await app.query<{
      rolbypassrls: boolean;
      rolsuper: boolean;
      groups: string[];
    }>(
      `select rolbypassrls, rolsuper,
              array(select b.rolname from pg_auth_members m join pg_roles b on b.oid = m.roleid
                     where m.member = r.oid order by 1)::text[] as groups
         from pg_roles r where rolname = $1`,
      [APP_ROLE],
    );
    expect(rows[0]).toEqual({ rolbypassrls: false, rolsuper: false, groups: ['app_rw'] });
    for (const role of ['mm_system', 'postgres']) {
      await expect(app.query(`set role ${role}`)).rejects.toThrow(/permission denied/);
    }
  });
});
