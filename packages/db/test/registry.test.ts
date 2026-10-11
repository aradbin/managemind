// The tenant table registry stays complete and in a safe purge order.
import { afterAll, describe, expect, it } from 'vitest';
import { PLATFORM_TENANT_ROWS, STORE_TABLES } from '../src/registry';
import { connect, ownerUrl, storeTables } from './helpers';

const db = await connect(ownerUrl);
afterAll(() => db.end());

describe('tenant table registry', () => {
  it('lists every store table exactly once', async () => {
    expect(new Set(STORE_TABLES).size).toBe(STORE_TABLES.length);
    expect([...STORE_TABLES].sort()).toEqual(await storeTables(db));
  });

  it('puts every store table before the store tables it references', async () => {
    const { rows } = await db.query<{ child: string; parent: string }>(
      `select c.relname as child, p.relname as parent
         from pg_constraint k
         join pg_class c on c.oid = k.conrelid
         join pg_class p on p.oid = k.confrelid
        where k.contype = 'f'
          and c.relnamespace = 'store'::regnamespace
          and p.relnamespace = 'store'::regnamespace
          and c.oid <> p.oid`,
    );
    const order: readonly string[] = STORE_TABLES;
    for (const { child, parent } of rows) {
      expect(order.indexOf(child), `${child} must come before ${parent}`).toBeLessThan(
        order.indexOf(parent),
      );
    }
  });

  it('says what a purge does with every platform table that references a tenant', async () => {
    const { rows } = await db.query<{ name: string }>(
      `select distinct c.relname as name
         from pg_constraint k join pg_class c on c.oid = k.conrelid
        where k.contype = 'f' and k.confrelid = 'platform.tenants'::regclass
          and c.relnamespace = 'platform'::regnamespace
        order by 1`,
    );
    expect(Object.keys(PLATFORM_TENANT_ROWS).sort()).toEqual(rows.map((r) => r.name));
  });
});
