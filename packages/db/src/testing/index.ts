// Test database helpers shared by every package's integration tests. Each
// package uses its own database (so turbo can run them in parallel) on the
// Postgres server in TEST_DATABASE_URL, rebuilt once per test run.
import pg from 'pg';
import { runMigrations } from '../migrate';
import { DEMO_TENANTS, seed } from '../seed';
import { FIXTURES } from './fixtures';

export { FIXTURES } from './fixtures';

/** A login role in app_rw, standing in for mm_app. */
export const APP_ROLE = 'mm_app_test';
export const [TENANT_A, TENANT_B] = DEMO_TENANTS.map((t) => t.id) as [string, string];

/** Connection strings for one test database: as the owner, and as the app role. */
export function testUrls(database: string): { ownerUrl: string; appUrl: string } {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) throw new Error('TEST_DATABASE_URL is not set; see docs/adr/0008-local-postgres.md');
  const owner = new URL(base);
  owner.pathname = `/${database}`;
  const app = new URL(owner);
  app.username = APP_ROLE;
  app.password = APP_ROLE;
  return { ownerUrl: owner.toString(), appUrl: app.toString() };
}

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

/**
 * Creates (if needed) and rebuilds `database`: empty schemas, all migrations,
 * the app login role, the demo tenants and one fixture row per tenant per
 * store table.
 */
export async function prepareTestDatabase(database: string): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) throw new Error(`bad database name: ${database}`);
  const { ownerUrl } = testUrls(database);
  const server = await connect(process.env.TEST_DATABASE_URL as string);
  try {
    const exists = await server.query('select 1 from pg_database where datname = $1', [database]);
    if (exists.rowCount === 0) await server.query(`create database ${database}`);
    // Roles are server-wide; parallel test runs may race to create it.
    await server.query(`
      do $$ begin
        create role ${APP_ROLE} login password '${APP_ROLE}';
      exception when duplicate_object then null;
      end $$`);
  } finally {
    await server.end();
  }
  const owner = await connect(ownerUrl);
  try {
    await owner.query('set client_min_messages = warning');
    await owner.query('drop schema if exists store, platform, app, drizzle cascade');
    await runMigrations(ownerUrl);
    await owner.query(`grant app_rw to ${APP_ROLE}`);
    await seed(ownerUrl);
    for (const tenant of [TENANT_A, TENANT_B]) {
      await inTenant(owner, tenant, async () => {
        for (const insert of Object.values(FIXTURES)) await owner.query(insert('default'));
      });
    }
  } finally {
    await owner.end();
  }
}
