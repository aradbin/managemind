// The E2E's people and stores on a preview database (phase-1-plan §9). For
// each viewport the Playwright suite runs at, a store with its owner and a
// super admin, all named after the run, so runs and viewports never share
// state. Emails are on example.test: the capture provider keeps them for the
// dev mailbox and nothing is ever sent.
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
      },
    );
    await grantRole(client, { email: n.admin, role: 'super_admin', name: 'E2E Admin' });
  }
}
