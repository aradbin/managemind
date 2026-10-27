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
| `imports/` | Spreadsheet import jobs: create, start, cancel, fail; `processImportChunk` (one chunk per queue message, every product in a savepoint so a bad one becomes a row error, stock through `setOnHand` with an idempotency key per row, redeliveries skipped); errors and the image step |
| `inventory/` | The only writer of stock levels and the ledger: `applyMovements` (locks levels in a fixed order, checks backorder rules, skips repeated idempotency keys), `receive`, `sell` (with or without a reservation), `reserve`, `release`, `returnStock`, `adjust`, set-based `setOnHand`, admin adjustments, levels and movement lists, and `inventoryDrift` for the invariant |
| `cart/` | Carts found by a hashed token and repriced from current prices, stock, promotions and the delivery zone on every read (phase-4-plan §3.4) |
| `pricing/` | The promotion engine, one pure function for every discount, and the quote that cart, checkout and manual orders share (phase-4-plan §3.13) |
| `promotions/` | Campaigns, codes and code batches, and the test cart (phase-4-plan §3.13; ADR 0021) |
| `orders/` | Placing an order, manual orders and edits, the lifecycle and its history, delivery zones, the confirmation queue and SMS link, and duplicate detection (Phases 4 and 6) |
| `customers/` | One customer per phone per store, shopper accounts, the blocklist, and anonymizing a customer's personal data (phase-4-plan §3.10) |
| `payments/` | Gateway payments, refunds and store credit (phase-5a-plan) |
| `returns/` | Returns from request to resolution, restocking by condition (phase-5a-plan §3.12) |
| `notifications/` | Which messages an event sends, to shoppers by email and SMS and to staff by push and email, and the delivery log (phase-5a-plan §3.6; ADR 0025) |
| `credentials/` | Stores' provider credentials, checked before saving and encrypted at rest (ADR 0024) |
| `fraud/` | The delivery success score per phone and risky phones (phase-5a-plan §3.11, phase-6-plan §3.3) |
| `recovery/` | Incomplete orders: checkouts a shopper left after typing a phone (phase-6-plan §3.2) |
| `couriers/` | Courier connections, booking, status updates, payouts and COD reconciliation, and area mapping (ADR 0030) |
| `purchasing/` | Suppliers, purchase orders, goods receipts, costs and supplier payments (phase-8-plan; ADR 0031) |
| `expenses/` | Expense categories, entries with receipt photos, and recurring entries (phase-8-plan §3.6) |
| `reports/` | The reports, computed in SQL, and the back office's summary tables, nightly batch and backfill (phase-5a-plan §3.15, phase-8-plan §3.8–§3.9) |
| `billing/` | Our plans, entitlements and invoices to stores (ADR 0026) |
| `usage/` | Usage rollups, the platform dashboard and each store's health (phase-5b-plan §3.3) |
| `terms/` | Platform terms versions and owners' acceptance (phase-5b-plan §3.4) |
| `theme/` | The store's theme draft, presets and publishing (phase-3-plan §3.4) |
| `storefront/` | The storefront's read-only page queries and their cache tags (phase-3-plan §5) |

Each module lives in its own folder exposing a service API (PLAN.md conventions), and no module imports another module's tables. The phase plans and reports in `docs/phases/` describe each one in full.

Tests run against a real Postgres as the app role (`managemind_test_core`), so RLS is always on.
