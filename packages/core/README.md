# @managemind/core

Domain logic, independent of Hono and Workers. Every database access goes through a `TenantTx` from `withTenant`; nothing here receives a raw connection except the outbox relay, which runs after commit.

| File | Owns |
| --- | --- |
| `tenant.ts` | `withTenant`: one transaction per command, tenant set in the first round trip (ADR 0002) |
| `outbox.ts`, `events.ts` | `emit` inside the transaction, `relayEvents` after commit (ADR 0010) |
| `idempotency.ts` | `runIdempotent` for retryable writes |
| `audit.ts` | `recordAudit` for staff actions |
| `access.ts` | `Actor`, `authorize` (store permissions) and `requirePlatformRole` |
| `platform.ts` | `withPlatform` and `recordPlatformAudit` for platform tables outside a store |
| `tenancy/` | `createTenant`, `getStore`, `updateStoreProfile`, `transitionTenant`, the lifecycle machine, `resolveHost` and `hostEntries` (ADR 0015) |

Modules arrive with their phases, each in its own folder exposing a service API (PLAN.md conventions): tenancy and identity (Phase 1), catalog and inventory (Phase 2), cart, checkout, orders, promotions, customers and fulfillment (Phase 4), payments, notifications and returns (Phase 5A). No module imports another module's tables.

Tests run against a real Postgres as the app role (`managemind_test_core`), so RLS is always on.
