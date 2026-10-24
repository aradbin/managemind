// Names of every preview resource, in one place (ADR 0011). The shared
// database serves every PR without the db-branch label; a labeled PR gets
// its own Neon branch and Hyperdrive config, deleted when the PR closes.

export type Database = 'shared' | 'own';

export const SHARED_BRANCH = 'preview';

export const branchName = (pr: number, db: Database) =>
  db === 'shared' ? SHARED_BRANCH : `pr-${pr}`;
export const hyperdriveName = (pr: number, db: Database) =>
  db === 'shared' ? 'managemind-preview' : `managemind-pr-${pr}`;
/**
 * The PR's own login role in app_rw, for its direct connection (ADR 0011,
 * amended Oct 23): its own on the shared branch, so a new password on one
 * PR's deploy never signs another PR's preview out.
 */
export const directRole = (pr: number) => `mm_app_pr_${pr}`;
export const apiWorker = (pr: number) => `managemind-api-pr-${pr}`;
export const storefrontWorker = (pr: number) => `managemind-storefront-pr-${pr}`;
/**
 * Each preview consumes its own outbox and import queues (a queue has one
 * consumer): its events send its notifications, to the dev mailbox.
 */
export const outboxQueue = (pr: number) => `managemind-outbox-pr-${pr}`;
export const importQueue = (pr: number) => `managemind-imports-pr-${pr}`;
export const importDeadLetters = (pr: number) => `managemind-imports-pr-${pr}-dlq`;

/** Serializes migrations, seeding and role setup on one preview database. */
export const DATABASE_LOCK = 72_616_002;

export function parseDatabase(value: string | undefined): Database {
  if (value === 'shared' || value === 'own') return value;
  throw new Error('--database shared|own is required');
}
