// Local development database: migrate, seed the demo stores, and create a
// login role in app_rw for wrangler dev, so local requests run with RLS on,
// exactly like production. Local only: the password is not a secret.
import pg from 'pg';
import { runMigrations } from './migrate';
import { seed } from './seed';

export const DEV_ROLE = 'mm_app_dev';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'Set DATABASE_URL to the local migration role, e.g. postgres://postgres:postgres@127.0.0.1:5432/managemind',
  );
  process.exit(1);
}
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error('db:dev-setup only runs against a local database.');
  process.exit(1);
}
await runMigrations(url);
await seed(url);
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query(`
    do $$ begin
      create role ${DEV_ROLE} login password '${DEV_ROLE}';
    exception when duplicate_object then null;
    end $$`);
  await client.query(`grant app_rw to ${DEV_ROLE}`);
} finally {
  await client.end();
}
console.log(`Local database ready; wrangler dev connects as ${DEV_ROLE}.`);
