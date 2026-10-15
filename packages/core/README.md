# @managemind/core

Domain logic, independent of Hono and Workers. Every database access goes through a `TenantTx` from `withTenant`; nothing here receives a raw connection except the outbox relay, which runs after commit.

| File | Owns |
| --- | --- |
| `tenant.ts` | `withTenant`: one transaction per command, tenant set in the first round trip (ADR 0002) |
| `outbox.ts`, `events.ts` | `emit` inside the transaction, `relayEvents` after commit (ADR 0010) |
| `idempotency.ts` | `runIdempotent` for retryable writes |
| `audit.ts` | `recordAudit` for staff actions |
| `access.ts` | `Actor`, `actorFor` (membership or live support grant, re-read every request), `authorize` and `requirePlatformRole` |
| `platform.ts` | `withPlatform` and `recordPlatformAudit` for platform tables outside a store |
| `identity/` | Members (no escalation, last Owner, self rule), invitations (hashed tokens), support grants, my stores, active store, platform roles |
| `tenancy/` | `createTenant`, `getStore`, `updateStoreProfile`, `transitionTenant`, the lifecycle machine, `resolveHost` and `hostEntries` (ADR 0015) |
| `catalog/` | Products (translations, slugs and redirects, publishing), options and variant regeneration, variant and bulk edits, categories (tree, moves, attribute templates), collections (manual order, rules evaluated in SQL), attributes, brand and tags (ADR 0017), suggestions, images (registered from uploaded files, product and variant images, usage for the weekly cleanup; ADR 0016) |
| `inventory/` | The only writer of stock levels and the ledger: `applyMovements` (locks levels in a fixed order, checks backorder rules, skips repeated idempotency keys), `receive`, `sell` (with or without a reservation), `reserve`, `release`, `returnStock`, `adjust`, set-based `setOnHand`, admin adjustments, levels and movement lists, and `inventoryDrift` for the invariant |

Modules arrive with their phases, each in its own folder exposing a service API (PLAN.md conventions): tenancy and identity (Phase 1), catalog and inventory (Phase 2), cart, checkout, orders, promotions, customers and fulfillment (Phase 4), payments, notifications and returns (Phase 5A). No module imports another module's tables.

Tests run against a real Postgres as the app role (`managemind_test_core`), so RLS is always on.
