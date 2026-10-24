// Seeds two demo stores for local development, previews and tests. Idempotent:
// a tenant that already exists is left alone. Runs as the migration role, but
// writes store rows through the same tenant transaction the app uses.
import pg from 'pg';

export const DEMO_TENANTS = [
  {
    id: '0199d000-0000-7000-8000-00000000f001',
    slug: 'demo-fashion',
    name: 'Demo Fashion',
    defaultLocale: 'en',
  },
  {
    id: '0199d000-0000-7000-8000-00000000f002',
    slug: 'demo-grocery',
    name: 'ডেমো গ্রোসারি',
    defaultLocale: 'bn',
  },
] as const;

export async function seed(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  const created: string[] = [];
  try {
    for (const t of DEMO_TENANTS) {
      await client.query('begin');
      const inserted = await client.query(
        `insert into platform.tenants (id, slug, name, default_locale, kind)
         values ($1, $2, $3, $4, 'demo') on conflict (slug) do nothing returning id`,
        [t.id, t.slug, t.name, t.defaultLocale],
      );
      if (inserted.rowCount === 1) {
        await client.query(
          "select set_config('app.tenant_id', $1, true), set_config('app.tenant_at', now()::text, true)",
          [t.id],
        );
        await client.query('select app.create_store_defaults()');
        await client.query(
          `insert into store.outbox (event_type, aggregate_type, aggregate_id, payload)
           values ('tenant.seeded', 'tenant', $1, $2)`,
          [t.id, JSON.stringify({ slug: t.slug })],
        );
        await client.query(
          `insert into store.audit_log (actor_type, action, entity_type, entity_id, after)
           values ('system', 'tenant.seeded', 'tenant', $1, $2)`,
          [t.id, JSON.stringify({ slug: t.slug, name: t.name })],
        );
        created.push(t.slug);
      }
      await client.query('commit');
    }
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
  return created;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Set DATABASE_URL_MIGRATIONS (or DATABASE_URL) to the migration role connection string.',
    );
    process.exit(1);
  }
  const created = await seed(url);
  console.log(created.length ? `Seeded: ${created.join(', ')}` : 'Demo tenants already present.');
}
