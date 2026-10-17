// Applies migrations as the migration role. Used locally, in CI and by the
// production deploy (with DATABASE_URL_MIGRATIONS from GitHub secrets).
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export const migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url));

/**
 * Refuses a database whose character classification is plain `C`: pg_trgm
 * makes no trigrams from Bangla there, so every Bangla search would find
 * nothing (phase-3-plan §3.7, ADR 0008). `C.UTF-8`, ICU and the builtin
 * `C.UTF-8` locale all work. Every migration run checks, so production and
 * previews are checked on each deploy.
 */
export async function checkDatabaseLocale(client: pg.Client): Promise<void> {
  const { rows } = await client.query<{ provider: string; ctype: string; locale: string | null }>(
    `select datlocprovider as provider, datctype as ctype, datlocale as locale
       from pg_database where datname = current_database()`,
  );
  const db = rows[0];
  if (!db) throw new Error('current database not found in pg_database');
  const plain = (value: string | null) => value === null || /^(C|POSIX)$/i.test(value);
  const bad = (db.provider === 'c' && plain(db.ctype)) || (db.provider === 'b' && plain(db.locale));
  if (bad) {
    throw new Error(
      `The database's locale (provider ${db.provider}, ctype ${db.ctype}, locale ${db.locale}) makes no trigrams from Bangla text. Recreate it with LOCALE 'C.UTF-8' (ADR 0008).`,
    );
  }
}

export async function runMigrations(connectionString: string): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await checkDatabaseLocale(client);
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
