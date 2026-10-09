// Every tenant-owned table is `store.table(name, { ...tenantColumns(), ... },
// (t) => [tenantPolicy(t), ...])`: `tenant_id` (non-null, defaulting to the
// current transaction's tenant, foreign key to platform.tenants) and the
// `tenant_isolation` policy for the app role.
// FORCE ROW LEVEL SECURITY and grants are added by a hand-written migration,
// because drizzle-kit does not generate them; the catalog test enforces both.
import { sql } from 'drizzle-orm';
import { type AnyPgColumn, pgPolicy, pgRole, pgSchema, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './platform';

export const store = pgSchema('store');

/** The group role behind the app's login role (ADR 0009). Created by migration. */
export const appRw = pgRole('app_rw').existing();

/** Matches rows of the tenant set in the current transaction (ADR 0002). */
export const currentTenant = sql`(select app.current_tenant_id())`;

export const tenantId = () =>
  uuid()
    .notNull()
    .default(sql`app.current_tenant_id()`)
    .references(() => tenants.id, { onDelete: 'restrict' });

/** Columns every tenant-owned table starts with. */
export const tenantColumns = () => ({ tenantId: tenantId() });

/** The tenant isolation policy; pass it as the first extra-config entry. */
export const tenantPolicy = (t: { tenantId: AnyPgColumn }) =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    to: appRw,
    using: sql`${t.tenantId} = ${currentTenant}`,
    withCheck: sql`${t.tenantId} = ${currentTenant}`,
  });
