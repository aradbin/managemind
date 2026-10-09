// Builds the test database once per run: empty schemas, all migrations, a
// login role in app_rw, the demo tenants and one fixture row per tenant per
// store table.
import { runMigrations } from '../src/migrate';
import { seed } from '../src/seed';
import { FIXTURES } from './fixtures';
import { APP_ROLE, connect, inTenant, ownerUrl, TENANT_A, TENANT_B } from './helpers';

export default async function setup(): Promise<void> {
  const owner = await connect(ownerUrl);
  try {
    await owner.query('set client_min_messages = warning');
    await owner.query('drop schema if exists store, platform, app, drizzle cascade');
    await runMigrations(ownerUrl);
    await owner.query(`
      do $$ begin
        if not exists (select from pg_roles where rolname = '${APP_ROLE}') then
          create role ${APP_ROLE} login password '${APP_ROLE}' in role app_rw;
        end if;
      end $$`);
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
