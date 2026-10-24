// The E2E's people and stores on a preview database (phase-1-plan §9). For
// each viewport the Playwright suite runs at, a store with its owner and a
// super admin, all named after the run, so runs and viewports never share
// state. Emails are on example.test: the capture provider keeps them for the
// dev mailbox and nothing is ever sent.
import { STORE_TABLES } from '@managemind/db/registry';
import type pg from 'pg';
import { grantRole, tenantCreate } from '../platform/commands';

export const E2E_PROJECTS = ['phone', 'desktop'] as const;

/** The names the suite derives from E2E_RUN; e2e/tests/people.ts mirrors these. */
export function e2eNames(run: string, project: string) {
  const base = `e2e-${run}-${project}`;
  return {
    slug: base,
    storeName: `E2E ${project} ${run}`,
    owner: `${base}-owner@example.test`,
    admin: `${base}-admin@example.test`,
    /** The launch flows' super admin (e2e/tests/launch.spec.ts), with its own two-factor setup. */
    platform: `${base}-platform@example.test`,
  };
}

export async function seedE2E(client: pg.Client, run: string, storeDomain: string): Promise<void> {
  if (!/^[a-z0-9]{4,12}$/.test(run))
    throw new Error('--e2e must be 4-12 lowercase letters or digits');
  for (const project of E2E_PROJECTS) {
    const n = e2eNames(run, project);
    await tenantCreate(
      client,
      null,
      { storeDomain, adminHost: 'unused' },
      {
        slug: n.slug,
        name: n.storeName,
        ownerEmail: n.owner,
        ownerName: 'E2E Owner',
        locale: 'bn',
        // Never billed, and reset or purged instead of piling up (phase-5b-plan §3.12).
        setup: { kind: 'test' },
      },
    );
    await grantRole(client, { email: n.admin, role: 'super_admin', name: 'E2E Admin' });
    await grantRole(client, { email: n.platform, role: 'super_admin', name: 'E2E Platform' });
  }
}

/**
 * Purges the E2E runs older than a day on the shared preview branch (Neon's
 * 0.5 GB; phase-5b-plan §3.12): each store is marked purged, then its store
 * rows, memberships and E2E people are deleted. Each run's catalog flow adds
 * about 6.5 MB, mostly the 500-product import. Runs younger than a day are
 * left alone: another PR's E2E may be using them. Their R2 files are the
 * preview bucket's, which its own lifecycle rules keep small. Returns the
 * number of stores purged.
 */
export async function cleanOldE2E(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ id: string }>(
    `select id from platform.tenants
     where slug like 'e2e-%' and status <> 'purged' and created_at < now() - interval '1 day'`,
  );
  const ids = rows.map((r) => r.id);
  if (!ids.length) return 0;
  // A database without a PR's new migrations (the shared branch) lacks its new tables.
  const { rows: present } = await client.query<{ name: string }>(
    `select table_name as name from information_schema.tables where table_schema = 'store'`,
  );
  const existing = new Set(present.map((r) => r.name));
  await client.query('begin');
  try {
    // Purged first: the brand attribute can only go once its store is closed or purged.
    await client.query(
      `update platform.tenants
          set status = 'purged', closed_at = coalesce(closed_at, now()),
              purge_after = coalesce(purge_after, now()), purged_at = now()
        where id = any($1::uuid[])`,
      [ids],
    );
    for (const table of STORE_TABLES.filter((t) => existing.has(t))) {
      await client.query(`delete from store.${table} where tenant_id = any($1::uuid[])`, [ids]);
    }
    await client.query('delete from platform.memberships where tenant_id = any($1::uuid[])', [ids]);
    await client.query(
      `delete from platform.users u where u.email like 'e2e-%@example.test'
          and not exists (select 1 from platform.memberships m where m.user_id = u.id)
          and not exists (select 1 from platform.tenants t where t.slug like 'e2e-%'
                            and t.status <> 'purged' and u.email like t.slug || '-%')`,
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
  return ids.length;
}
