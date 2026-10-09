import pg from 'pg';
import { DEMO_TENANTS } from '../src/seed';

export const ownerUrl = (() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set; see docs/adr/0008-local-postgres.md');
  return url;
})();

/** A login role in app_rw, standing in for mm_app (created by global setup). */
export const APP_ROLE = 'mm_app_test';
export const appUrl = (() => {
  const u = new URL(ownerUrl);
  u.username = APP_ROLE;
  u.password = APP_ROLE;
  return u.toString();
})();

export const [TENANT_A, TENANT_B] = DEMO_TENANTS.map((t) => t.id) as [string, string];

export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Runs `fn` in a transaction with the tenant set the way withTenant does. */
export async function inTenant<T>(
  client: pg.Client,
  tenantId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await client.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.tenant_at', now()::text, true)",
      [tenantId],
    );
    const result = await fn();
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

export async function storeTables(client: pg.Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'store' and c.relkind in ('r', 'p') order by 1`,
  );
  return rows.map((r) => r.name);
}
