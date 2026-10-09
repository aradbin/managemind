# ADR 0009: Database schemas, roles and row-level security

- Status: Accepted
- Date: 2026-10-09
- Builds on: ADR 0002 (guarded tenant function, transaction-local tenant)

## Context

PLAN.md requires tenant isolation in two layers:

- the code refuses to query without a tenant;
- Postgres row-level security (RLS) with `FORCE ROW LEVEL SECURITY` applies the same rule in the database.

The application must connect with a role that cannot bypass RLS. Migrations and platform jobs use a separate role. Store data and platform data live in separate schemas so that a tenant can later be exported or purged cleanly.

## Decision

### Schemas

| Schema | Holds | RLS |
| --- | --- | --- |
| `app` | Helper functions: `current_tenant_id()`, `set_updated_at()` and, from PR 10, the system functions | — |
| `platform` | Our records about clients: `tenants` now; staff auth, plans, billing and the platform audit log later | No; access is controlled by grants |
| `store` | Everything a client creates or collects | **Every table:** `tenant_id` + `ENABLE` + `FORCE` + `tenant_isolation` policy |

### Roles

| Role | Login | Purpose |
| --- | --- | --- |
| Migration role (`neondb_owner` on Neon, `postgres` locally and in CI) | Yes | Owns every object; runs migrations and the seed. Never used by a Worker |
| `app_rw` | No | Group role holding every application privilege. `NOBYPASSRLS` |
| `mm_app` | Yes, member of `app_rw` | The role behind Hyperdrive. Created **with SQL** by the provisioning step, never through the Neon console or API, so that it is not a member of `neon_superuser` (which has `BYPASSRLS`). Its password exists only in GitHub Actions and the Hyperdrive config |
| `mm_system` | No | Owns the few `SECURITY DEFINER` functions that must work across tenants (outbox claim, expired-row cleanup; PR 10). Each store table it touches has a policy `TO mm_system` limited to what those functions do. `app_rw` can run the functions but cannot `SET ROLE mm_system` |

### Tenant isolation

- **Columns:** each tenant table starts with `tenantColumns()`. That gives `tenant_id uuid not null default app.current_tenant_id()`, a foreign key to `platform.tenants(id)` with `ON DELETE RESTRICT`, and `tenant_id` as the first column of every index. The one documented exception is the outbox sweep index (ADR 0010).
- **Policy:** `tenantPolicy(t)` declares `tenant_isolation` as `FOR ALL TO app_rw`, with `USING` and `WITH CHECK` both `tenant_id = (select app.current_tenant_id())`. drizzle-kit generates it, along with `ENABLE ROW LEVEL SECURITY`.
- **Guard:** `app.current_tenant_id()` is the guarded function from ADR 0002. It returns the tenant only when `app.tenant_at` equals `now()` of the current transaction, so values left on pooled connections are ignored. With no tenant set, every policy matches zero rows.

### Migrations

drizzle-kit generates table and policy SQL into `packages/db/migrations`. It does not generate a few things, so those are hand-written custom migrations in the same journal:

- `0000_bootstrap`: the `app` schema, roles, `current_tenant_id()` and `set_updated_at()`;
- `0002_force_rls_and_grants`: `FORCE ROW LEVEL SECURITY` on every store table, grants, `updated_at` triggers.

Every new store table needs the same additions in a new custom migration. The catalog test (PR 10) fails CI if any store table lacks `FORCE`, the policy, a leading `tenant_id`, or a grant to `app_rw`.

Column names are snake_case through drizzle-kit's `casing: 'snake_case'`; TypeScript property names stay camelCase.

### Privileges

| Object | `app_rw` | Note |
| --- | --- | --- |
| `platform.tenants` | `SELECT` | Hostname-to-store lookup |
| `store.outbox` | `SELECT`, `INSERT` | The dispatcher works through `mm_system` functions |
| `store.audit_log` | `SELECT`, `INSERT` | Append-only: `UPDATE` and `DELETE` are denied |
| `store.idempotency_keys` | `SELECT`, `INSERT`, `UPDATE`, `DELETE` | |

`PUBLIC` has no access to the `app`, `platform` or `store` schemas.

## Verified (local Postgres 18, 2026-10-09)

- Migrations apply to an empty database and are no-ops when run again.
- As a login role in `app_rw`:
  - an insert without `tenant_id` is filled with the transaction's tenant;
  - a query with no tenant set sees 0 rows;
  - tenant B sees none of tenant A's rows;
  - an insert with A's `tenant_id` while acting as B is rejected by the policy;
  - `UPDATE` on `audit_log` is denied.
- PR 10 turns these into the isolation test suite, generated from the catalog so new tables are covered automatically.

## Consequences

- Each new store table costs four lines in a custom migration: `FORCE` plus grants. CI catches any that are forgotten.
- `outbox` keeps `created_at` and `dispatched_at` but no `updated_at`, since only the dispatcher changes it. `audit_log` is append-only and has `created_at` only. Every other table has both timestamps.
- Purging a tenant (Phase 5B) deletes `store` rows in dependency order, running as the migration role. `ON DELETE RESTRICT` on `tenant_id` makes sure the tenant registry entry is never removed while store rows remain.
