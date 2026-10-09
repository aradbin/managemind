// Applies migrations as the migration role. Used locally, in CI and by the
// production deploy (with DATABASE_URL_MIGRATIONS from GitHub secrets).
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Set DATABASE_URL_MIGRATIONS (or DATABASE_URL) to the migration role connection string.',
    );
    process.exit(1);
  }
  await runMigrations(url);
  console.log('Migrations applied.');
}
