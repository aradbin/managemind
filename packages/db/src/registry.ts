// What belongs to one tenant, for export and purge (Phase 5B). The purge job
// reads these lists and nothing else; registry.test.ts fails CI when a table
// is missing or the order would break a foreign key.

/**
 * Every table in the `store` schema, in purge order: each table comes before
 * the tables it references, so deleting in this order never hits a foreign key.
 */
export const STORE_TABLES = ['outbox', 'audit_log', 'idempotency_keys'] as const;

/**
 * What a purge does with a store's rows in a platform table:
 * - `delete`: the rows are the store's own (memberships, custom domains);
 * - `clear`: the reference is set to null (a session's active store);
 * - `keep`: platform history, kept with the purged tenant record (PLAN.md).
 */
export type PurgeAction = 'delete' | 'clear' | 'keep';

/** Every platform table that references platform.tenants. */
export const PLATFORM_TENANT_ROWS: Record<string, PurgeAction> = {
  tenant_domains: 'delete',
  memberships: 'delete',
  invitations: 'delete',
  sessions: 'clear',
  support_grants: 'keep',
  audit_log: 'keep',
};
