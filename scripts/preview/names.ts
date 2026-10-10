// Names of every preview resource, in one place (ADR 0011). The shared
// database serves every PR without the db-branch label; a labeled PR gets
// its own Neon branch and Hyperdrive config, deleted when the PR closes.

export type Database = 'shared' | 'own';

export const SHARED_BRANCH = 'preview';
export const PREVIEW_QUEUE = 'managemind-outbox-preview';

export const branchName = (pr: number, db: Database) =>
  db === 'shared' ? SHARED_BRANCH : `pr-${pr}`;
export const hyperdriveName = (pr: number, db: Database) =>
  db === 'shared' ? 'managemind-preview' : `managemind-pr-${pr}`;
export const apiWorker = (pr: number) => `managemind-api-pr-${pr}`;
export const storefrontWorker = (pr: number) => `managemind-storefront-pr-${pr}`;

/** Serializes migrations, seeding and role setup on one preview database. */
export const DATABASE_LOCK = 72_616_002;

export function parseDatabase(value: string | undefined): Database {
  if (value === 'shared' || value === 'own') return value;
  throw new Error('--database shared|own is required');
}
