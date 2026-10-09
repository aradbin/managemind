# Phase 0 plan — Foundations

Oct 9, 2026 · Status: **draft, awaiting approval** · Source: `docs/PLAN.md` § Phase 0

Phase 0 has two goals. The first is to prove the six risky technical assumptions with spikes, each ending in an ADR. The second is to build a deployable skeleton: a monorepo, the base database with RLS, shared utilities, an API Worker, a storefront Worker, CI/CD with previews, and monitoring. No commerce features are built. Estimate: 1–2 weeks, with about half of that on the spikes.

## 1. Prerequisites status

Checked from this session on Oct 9, 2026.

| Item | Status |
| --- | --- |
| GitHub private repository `aradbin/managemind` | Done |
| Cloudflare account, `workers.dev` subdomain (`aradworkspace`), R2 enabled | Verified via API |
| Cloudflare session token: Workers Scripts, KV, R2, Queues, Hyperdrive, Analytics (GraphQL), Observability | Verified with read-only calls |
| Neon project `managemind`: `aws-ap-southeast-1` (Singapore), Postgres 18, fixed 0.25 CU, branch `production` | Verified via API |
| Session env vars `CLOUDFLARE_ACCOUNT_ID`, `NEON_PROJECT_ID`, `WRANGLER_SEND_METRICS`, `BASH_DEFAULT_TIMEOUT_MS` | Verified |
| Network: Cloudflare API, `*.workers.dev`, Sentry, docs sites, npm, PostgreSQL apt repository | Reachable (the network looks like **Full** rather than the Custom list) |
| GitHub Actions secrets (4), variables (3), workflow permissions | **Cannot check from the session** — owner to confirm |
| Sentry organization and slug | **Cannot check** — owner to confirm |
| Sentry projects and DSNs (api, admin, storefront) | **Missing** — needed by PR 15 (§11) |
| Platform name and Part 5 answers (pilots, providers, who onboards, merge rights) | **Missing** |
| Uptime monitor | Not needed until the end of Phase 0 (`/health` URL given then) |
| A zone (domain) for the cache-purge spike | **Decision needed** — see §3.6 |

Things the session found that the owner should know:

- An existing Worker, `managemind-communication`, is on the account and has served about 3,100 requests since Oct 1. It shares the free plan's 100,000 requests a day and its 5 Cron Triggers. Measurements filter it out by script name.
- The session has no Docker daemon, so the "Postgres in Docker" local environment becomes native Postgres 18 from the PostgreSQL apt repository, installed by the SessionStart hook (ADR 0008). CI still uses a `postgres:18` service container.
- Postgres 18 is also needed locally because it has a built-in `uuidv7()`, which the schema uses as its default. The preinstalled Postgres 16 does not have it.

## 2. Research: what is borrowed

Phase 0 builds cross-cutting infrastructure only. Tenancy, catalog and the other domain modules are studied in their own phase plans.

| Concern | How others do it | What we take | What we simplify, and why |
| --- | --- | --- | --- |
| Money | Vendure stores integers in minor units. Medusa v2 moved to `numeric` with a BigNumber raw value for multi-currency precision. Saleor uses `Decimal`. Shopify's API exposes `MoneyV2` (decimal string plus currency code) | Vendure's integer minor units, plus a currency code beside every amount (Shopify) | Medusa's BigNumber isn't needed: one currency with 2 decimals, and integers are exact and cheap on CPU. Stored as `bigint` (aggregates can exceed `int4`) |
| State machines | Vendure's `FSM` class: transitions defined as data, `onTransitionStart` guards and `onTransitionEnd` hooks, one place that rejects illegal moves | A data-defined machine with states, events, guards and declared side effects; a single `transition()` that throws `illegal_transition` | Effects are only declared here, not executed: the core service runs them inside its own transaction, which keeps the helper pure and unit-testable |
| Events and side effects | Medusa v2 groups workflow events and releases them when the workflow succeeds. Vendure publishes events only after the transaction commits. Saleor stores `EventPayload` and `EventDelivery` rows with retry attempts. Shopify webhooks are at least once, with a delivery ID for deduplication | A transactional outbox row in the same transaction (Saleor-style durable record), an event ID that consumers deduplicate on (Shopify), and release only after commit (Vendure and Medusa) | No event bus service: Cloudflare Queues is the bus, and one queue message per event |
| Idempotency | Stripe: a client key, the first result stored and replayed, an error when the same key arrives with different parameters, 24-hour retention | All of it, scoped per tenant and per operation, with a request hash and an in-progress lock | Retention is 2 days (as PLAN.md says), and the cron job does the cleanup |
| Audit and history | Vendure `HistoryEntry` rows per order and customer. Shopify timeline events | One append-only `audit_log` with before and after JSON for staff actions | Per-entity history tables (order status history and so on) come with their modules. The audit log is the generic record |
| Errors | Saleor returns enum error codes per mutation. Shopify returns `userErrors` with a code and field. Stripe returns a stable `code` and `param` | Stable machine-readable error codes plus a field path, delivered as RFC 9457 problem details | — |

## 3. Spikes

Each spike runs in a throwaway Worker under `spikes/<name>/` that uses the real stack (Hono, zod, Drizzle, Better Auth). Spike Workers are named `managemind-spike-<name>` and get deleted when their ADR merges. Spike code is not held to the full definition of done, but it stays in the repository so the measurements can be reproduced. The spikes use a throwaway Neon branch named `spike`, created from `production` and deleted afterwards (see question Q3).

How measurements are taken:

- **CPU time:** the Workers Analytics GraphQL API (`workersInvocationsAdaptive`, `cpuTime` p50, p99 and max per `scriptName`), after 200–500 requests driven from the session.
- **Latency:** timings returned by the spike Worker itself, plus `request.cf.colo`, also written to Workers Logs.
- **Bundle size:** `wrangler deploy --dry-run --outdir`, then gzip size.

### 3.1 Database path (ADR 0002)

- Compare drivers over Hyperdrive to Neon: `pg` (node-postgres) and `postgres` (postgres.js), both with Drizzle.
- Use an interactive transaction: `BEGIN`, then `set_config('app.tenant_id', $1, true)`, then reads through a FORCE RLS table, then `COMMIT`. Count round trips. Also try packing `BEGIN` and `set_config` into one round trip.
- Prove that the tenant setting does not leak between pooled transactions. Interleave requests for two tenants on one Hyperdrive pool and assert that no row from the wrong tenant appears and that a transaction without context gets zero rows.
- Fallback: Neon's serverless driver. WebSocket mode supports interactive transactions. HTTP mode only supports batched non-interactive transactions, but that is enough for "set_config + query" and avoids a WebSocket, so it is measured too.
- Latency from Bangladesh: Bangladeshi users reach Cloudflare at DAC, or sometimes at SIN, BOM or CCU depending on the ISP. The session can't send traffic from there, so the owner opens a spike URL from a Bangladeshi mobile network and from broadband, about five times each. The page shows the colo and timings and logs them, and the agent reads the logs. This is not a secret and takes about 5 minutes (Q4). Also measured: Cloudflare placement hints (`placement.region` near `aws:ap-southeast-1`) against the default placement.
- **Pass:** p50 under 60 ms for a request with "set tenant + 3 queries" from DAC/SIN, and zero leaks. The ADR records the numbers and the chosen driver.

### 3.2 CPU budget (ADR 0003)

- The "typical API request": a Hono route that validates a cookie session (a Better Auth session lookup), runs 3–5 queries in one tenant transaction, validates output with zod, and returns JSON (about 5 KB).
- The "typical page": an Astro server-rendered product page with layout, i18n strings and about 20 product fields, data fetched over a service binding.
- **Pass:** p99 under 10 ms CPU for both. If either fails, the ADR names what to cache (for example storefront HTML at the edge, OpenAPI schema objects built once per isolate, lazy route registration) or the cost of moving to the paid plan.

### 3.3 Bundle size (ADR 0004)

- Measure the API Worker (Hono, zod-openapi, Drizzle, driver, Better Auth with both instances, `@sentry/cloudflare`) and the storefront Worker (Astro, adapter, Sentry).
- **Pass:** each under 3 MiB compressed. A CI check is added to the build: a warning at 2.5 MiB and a failure at 3 MiB.

### 3.4 Auth (ADR 0005)

- **Staff instance:** tables in the `platform` schema, with the organization plugin. An organization is a store membership container linked 1:1 to `platform.tenants`. Plural snake_case table names via Better Auth's `modelName` and field mapping.
- **Shopper instance:** tables in the `store` schema (`shopper_users`, `shopper_sessions`, `shopper_accounts`, `shopper_verifications`).
  - Each table has `tenant_id uuid not null default app.current_tenant_id()`, so Better Auth inserts get the tenant automatically.
  - Uniqueness is per store: `unique (tenant_id, email)`.
  - RLS means Better Auth's own lookups only ever see the current store.
  - The handler runs inside one tenant transaction per request. Better Auth's internal transactions become savepoints; the spike verifies this.
- **Proof test:** the same email signs up in store A and in store B. That gives two users, two sessions, and no cross-sign-in; a store A session cookie is rejected on store B.
- **Password hashing CPU:** Better Auth's default scrypt (`@noble/hashes`) against native Web Crypto PBKDF2-SHA-256 through the custom `password.hash/verify` hooks. If neither fits in 10 ms, staff sign in with email codes now and passkeys later, until the paid plan (PLAN.md's fallback).
- Email codes go to the local mail catcher (Mailpit through its HTTP API) during the spike.

### 3.5 Edge state on the free plan (ADR 0006)

- Deploy the Workers rate-limiting binding on the free account and confirm that it enforces limits. The docs don't state which plans include it. It is per colo and eventually consistent, which is fine for login and OTP throttling. Fallback: a SQLite-backed Durable Object counter, which is on the free plan.
- KV only for the domain-to-store map and cache versions. The Astro Cloudflare adapter stays (it is what runs Astro on Workers); only its session feature is turned off with `session: false`, so there is no KV session binding and no KV write per session change. Cart and shopper login state live in the API (Postgres) behind first-party cookies instead.
- Astro `imageService: 'passthrough'`, so the adapter's default Cloudflare Images binding (`cloudflare-binding`) is never used. Images are already resized in the browser at fixed widths, and the storefront builds `srcset` from those stored sizes.
- Queues: confirm on the free plan that delayed messages (`delaySeconds`, needed for the 30-minute payment re-check in Phase 5A), a dead-letter queue and consumer retries all work.
- Cron: one trigger per Worker. The account allows 5, and `managemind-communication` may use some of them.

### 3.6 Per-store cache invalidation (ADR 0007) — needs a zone

The Cache API only works for Workers on a custom domain, and the purge API is per zone. `workers.dev` can therefore test neither. On a zone, the spike tests:

- purge by `Cache-Tag` (`tenant:<id>`, `tenant:<id>:product:<id>`) and purge by hostname. Both are on the free plan, limited to 5 requests a minute with a bucket of 25 — a limit that matters for bulk changes.
- the fallback: a per-store catalog version in the cache key, kept in KV and bumped with a debounce.

Options (Q2):

- **(a) Recommended:** buy the main domain now, as PLAN.md already recommends, and add **Zone → Cache Purge: Purge** and **Zone: Read** to the session token for that zone. The spike runs on a throwaway hostname.
- **(b)** Defer this spike to Phase 1, when the main domain is due, and design Phase 3 against the version-key fallback until then.

## 4. Repository layout and tooling

```
/apps
  /api            Hono Worker: /v1/*, /health, /openapi.json, queue + cron handlers, serves /admin assets
  /admin          React + Vite placeholder page (Sentry wired), built into apps/api assets
  /storefront     Astro on Workers: placeholder page that resolves the tenant from the hostname
/packages
  /db             Drizzle schema, SQL migrations, roles, RLS helper, seed, test database harness
  /core           Empty module folders plus the tenant-transaction and outbox and idempotency services
  /shared         money, uuidv7, state machine, problem+json errors, i18n, config schema
/spikes           Throwaway spike Workers (deleted after the ADRs)
/docs/adr         ADRs
/.claude          settings.json SessionStart hook
/.github/workflows
```

`packages/providers`, `packages/sdk` and `packages/ui` are created when their first real content arrives (Phases 1, 5A and 3) rather than left empty.

Tooling:

- pnpm workspaces and Turborepo (`build`, `typecheck`, `test`, `lint` pipelines with caching).
- Biome for lint and format. TypeScript strict, with a shared `tsconfig.base.json` (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`).
- Node 22 and pnpm 10, pinned through `packageManager` and `.nvmrc`.
- Current versions, to be pinned exactly when the scaffold PR lands: wrangler 4.149, hono 4.13, @hono/zod-openapi 1.6, zod 4.6, drizzle-orm 0.45 / drizzle-kit 0.31, better-auth 1.7, astro 7.3 / @astrojs/cloudflare 14.3, biome 2.5, turbo 2.11, vitest 5, @sentry/cloudflare 11.6, vite 8, react 19.3.
- TypeScript 7.0 (the native compiler) if Astro's and Drizzle's type tooling work with it; otherwise the latest 6.x. This is decided in the scaffold PR.
- Playwright uses the preinstalled Chromium (`executablePath: '/opt/pw-browsers/chromium'` if versions differ).
- SessionStart hook (`.claude/settings.json`): installs Postgres 18 from the PGDG apt repository if it is missing, `initdb` into `.local/pg` (gitignored), starts it on port 5432, creates the `managemind` and `managemind_test` databases, runs `pnpm install --frozen-lockfile`, and starts Mailpit if it is present. It is idempotent and safe on resume.
- Renovate config and `pnpm audit` in CI.

## 5. Data model

### 5.1 Schemas and roles (ADR 0009)

| Name | Type | Purpose |
| --- | --- | --- |
| `platform` schema | — | Our own records: tenants now; staff auth, plans, billing and the platform audit log later |
| `store` schema | — | Tenant-owned data. Every table has `tenant_id` and FORCE RLS |
| `app` schema | — | Helper functions, such as `app.current_tenant_id()` |
| `neondb_owner` (Neon) / `postgres` (local, CI) | Login | **Migration role.** Owns every object. Used only by CI migrations, the seed and the provisioning workflow |
| `app_rw` | NOLOGIN group | All app privileges: `USAGE` on schemas, DML on store tables as each table allows, `SELECT` on readable platform tables, `EXECUTE` on `app` functions. No `BYPASSRLS` |
| `mm_app` | Login, member of `app_rw` | The role behind Hyperdrive. Created with SQL (not the Neon console or API) so that it is **not** in `neon_superuser`; the spike asserts `rolbypassrls = false` and checks its memberships. Its password is generated inside GitHub Actions and goes straight into the Hyperdrive config, so it is never stored anywhere else |
| `mm_system` | NOLOGIN | Owns a few `SECURITY DEFINER` functions that need to work across tenants (outbox claim, expired-row cleanup). Each store table has a policy `TO mm_system` limited to exactly what those functions do. The app can run the functions but cannot `SET ROLE mm_system` |

`app.current_tenant_id()` returns `nullif(current_setting('app.tenant_id', true), '')::uuid`. With no context it returns NULL, so every tenant policy matches zero rows. PLAN.md's "missing WHERE returns nothing" rule then holds even without a context.

### 5.2 Tables

Every table has `created_at` and `updated_at` (`timestamptz`, default `now()`; `updated_at` is maintained by a shared trigger), except append-only tables, which have `created_at` only. IDs are `uuid default uuidv7()`.

**`platform.tenants`** (the full lifecycle comes in Phase 1)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `slug` | text unique | `^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$`, checked against the reserved list in code and with a CHECK constraint |
| `name` | text | |
| `status` | text CHECK in (`active`, `suspended`, `closed`, `purged`) | |
| `default_locale` | text CHECK in (`bn`, `en`) | default `bn` |
| `settings` | jsonb default `'{}'` | Validated by a zod schema in `packages/shared` |

`app_rw` can `SELECT (id, slug, name, status, default_locale, settings)`. Writes are reserved for the migration role and super-admin paths in Phase 1.

**`store.outbox`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | Also the event ID that consumers deduplicate on |
| `tenant_id` | uuid not null FK, default `app.current_tenant_id()` | |
| `event_type` | text | For example `tenant.created`, `order.placed` |
| `aggregate_type`, `aggregate_id` | text, uuid | |
| `payload` | jsonb | Validated by a zod schema per event type before insert |
| `request_id` | text | For tracing |
| `dispatched_at` | timestamptz null | |
| `attempts` | smallint default 0 | |
| `last_error` | text null | |

- Indexes: `(tenant_id, created_at)`. Also a partial index `(created_at) WHERE dispatched_at IS NULL` for the system sweep. This is a documented exception to "tenant first in every composite index", because the sweep runs across all tenants (ADR 0010).
- Privileges: `app_rw` has `INSERT` and `SELECT` under the tenant policy. `mm_system` has a policy for `SELECT` and `UPDATE` (claim, mark) and `DELETE` (cleanup after 7 days).

**`store.audit_log`** (append-only: `INSERT` and `SELECT` only, never `UPDATE` or `DELETE` for `app_rw`)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `tenant_id` | uuid not null FK, default `app.current_tenant_id()` | |
| `actor_type` | text CHECK in (`staff`, `platform`, `system`) | |
| `actor_id` | uuid null | |
| `action` | text | For example `settings.updated` |
| `entity_type`, `entity_id` | text, uuid null | |
| `before`, `after` | jsonb null | |
| `request_id`, `ip` | text, inet null | |

- Indexes: `(tenant_id, created_at desc)`, `(tenant_id, entity_type, entity_id, created_at desc)`.

**`store.idempotency_keys`**

| Column | Type | Notes |
| --- | --- | --- |
| `tenant_id` | uuid not null FK, default `app.current_tenant_id()` | |
| `scope` | text | The operation, for example `checkout.place_order` |
| `key` | text, 8–255 chars | |
| `request_hash` | text | SHA-256 of the canonical request body |
| `state` | text CHECK in (`in_progress`, `completed`) | |
| `response_status` | smallint null | |
| `response_body` | jsonb null | |
| `locked_until` | timestamptz | Lets a crashed request be retried |
| `expires_at` | timestamptz | `now() + 2 days` |

- PK `(tenant_id, scope, key)`. Index `(expires_at)` for the cleanup function run by `mm_system`.
- Behavior, after Stripe:
  - Same key and hash, completed: replay the stored response.
  - Same key, different hash: `422 idempotency_key_reused`.
  - Still in progress and locked: `409 idempotency_request_in_progress`.
  - The key row is inserted in the same transaction as the command, so a rollback leaves no stale lock.

**Demo shopper auth tables** come from the auth spike. They are kept only if ADR 0005 confirms the design; otherwise they are created in Phase 4.

### 5.3 RLS helper and safety nets

- `tenantTable(name, columns, extra)` in `packages/db` adds the `tenant_id` column, the FK, the default and Drizzle `pgPolicy` definitions (`tenant_isolation` `TO app_rw` `USING` and `WITH CHECK` `tenant_id = app.current_tenant_id()`), so drizzle-kit generates the policies.
- drizzle-kit has no output for `FORCE ROW LEVEL SECURITY` or for role grants, so a small generator adds them as a hand-written SQL migration step that is checked in CI.
- **Catalog test:** a CI test queries `pg_class` and `pg_policies` and fails if any `store` table is missing `relrowsecurity`, `relforcerowsecurity`, a `tenant_isolation` policy, or a `tenant_id` column that is the first column of every index (the documented exceptions are allow-listed). Phase 1 extends it to the purge-order registry.
- **Code layer:** `withTenant(db, tenantId, fn)` is the only way to get a `TenantTx`. Repositories accept only `TenantTx`. The raw `db` handle is not exported from `packages/db` to `core`. A Biome `noRestrictedImports` rule enforces this, and a unit test asserts that `withTenant` throws `tenant_context_missing` on an empty or invalid ID.

### 5.4 Migrations and seed

- drizzle-kit generates the SQL in `packages/db/migrations`, and it is reviewed in the PR. Migrations follow expand, then contract. A `pnpm db:migrate` script runs as the migration role.
- `pnpm db:seed` creates two demo tenants (`demo-fashion` with locale `en`, and `demo-grocery` with locale `bn`), each with an outbox event and an audit entry. The seed is idempotent.

## 6. Packages

**`packages/shared`**

- **money:** the `Money` type `{ amount: number /* poisha, safe integer */, currency: 'BDT' }`, with `add`, `subtract`, `multiply` (integer quantity), `percentOf` (basis points, rounded half away from zero, once), and `allocate` (largest remainder, so splits always add up).
  - It also has `format(money, locale, numerals)`, which uses `Intl.NumberFormat`, prints `৳`, and offers Bangla or Western digits.
  - Every operation asserts `Number.isSafeInteger`. No floats; a test checks that no division leaves the helpers.
- **uuidv7:** a generator of about 30 lines on `crypto.getRandomValues`, so no dependency. It is monotonic within a millisecond and has a test against RFC 9562 vectors.
- **state machine:** `defineMachine({ initial, states, transitions: { [from]: { [event]: { to, guard?, effects? } } } })`, with `can()`, `transition()` (returns `{ from, to, event, effects }` or throws `illegal_transition`), and `toMermaid()` for docs.
- **errors:** `AppError(code, status, detail, fields?)`, a registry of stable codes (`validation_failed`, `not_found`, `tenant_context_missing`, `illegal_transition`, `idempotency_key_reused`, `idempotency_request_in_progress`, `rate_limited`, `internal`), and `toProblem()` (RFC 9457: `type` set to `https://errors.managemind.dev/<code>` (the placeholder is replaced once the domain exists), `title`, `status`, `detail`, `instance` = request ID, `code`, `errors[]`).
- **i18n:** typed message catalogs `bn.ts` and `en.ts`. `t(key, params)` interpolates safely and uses `Intl.PluralRules`; `bn` falls back to `en`. A CI test fails if a key is missing from either catalog. No i18n dependency.
- **config:** zod schemas for each Worker's env, validated once per isolate. A bad config fails every request with a clear 500 in the logs, not a crash later on.

**`packages/core` (Phase 0 contents)**

- `db/withTenant`.
- `outbox.emit(tx, event)` (zod-validated per event type).
- `idempotency.run(tx, scope, key, hash, fn)`.
- `audit.record(tx, entry)`.
- Empty module folders with a README naming what each will own.

## 7. Workers and endpoints

### 7.1 API Worker (`managemind-api`)

| Method and path | Purpose |
| --- | --- |
| `GET /health` | `{ status, version, commit }`. Never touches the database |
| `GET /health/deep` | Runs `SELECT 1` through Hyperdrive. For the hourly check only, not the uptime monitor |
| `GET /openapi.json` | Generated from the zod route definitions |
| `GET /v1/store/context` | The storefront calls this over the service binding with `X-Forwarded-Host`. It resolves the host to a tenant and returns `{ id, slug, name, defaultLocale }` or a `404 store_not_found` problem |
| `GET /admin/*` | Static assets (SPA fallback to `/admin/index.html`) |
| `* /v1/_spike/*` | Present only while the spikes run. Never in production builds |

Middleware, in order:

1. Request ID (incoming `cf-ray` plus a uuidv7 request ID, returned in `X-Request-Id`).
2. Structured JSON logger (one line per request: `request_id`, `tenant_id`, `user_id`, `route`, `status`, `duration_ms`, `colo`; 2xx sampled at 10% in production, everything else always kept).
3. Config validation.
4. zod validation.
5. Error handler that maps everything to problem+json, reports 5xx to Sentry, and returns no stack traces.
6. Security headers.

Queue consumer: `outbox-events` with DLQ `outbox-events-dlq`. A stub handler logs each event and acks it, keyed by event ID.

Cron (one daily trigger, `CRON_TZ`-aware): stubs for the outbox sweep and the expired idempotency-key cleanup. The cron exits without a query when there is nothing to do.

**Outbox relay (ADR 0010).** After the transaction commits, the request does `ctx.waitUntil(relay(ids))`, which sends to the queue and marks `dispatched_at`, with 3 quick retries. The daily cron sweeps anything left over and alerts through Sentry.

This follows PLAN.md's "nothing polls on a short timer" rule. The cost is that an event whose relay fails can wait until the daily sweep. An hourly sweep would add about 15 CU-hours a month by waking Neon, which is about 15% of the free compute.

### 7.2 Storefront Worker (`managemind-storefront`)

- Astro SSR with `@astrojs/cloudflare`, `session: false`, `imageService: 'passthrough'`, and a service binding `API` to `managemind-api`.
- Host resolution:
  - `{slug}.localhost` → slug, for local development.
  - `{slug}.<STORE_DOMAIN>` → slug, from Phase 3.
  - Custom domains → KV map, from Phase 3.
  - On `workers.dev` and in preview: the **dev store selector** (`?store=<slug>` sets a `dev_store` cookie and shows a small banner), active only when `ENVIRONMENT !== 'production'`.
- Placeholder page: the store name, locale switch (Bangla and English), and a "store not found" page in both languages. `/api/*` is forwarded to `API` (`/v1/store/*`) to prove the routing rule.

### 7.3 Admin placeholder

A Vite + React page at `/admin` with a Bangla and English title, `/health` status and Sentry initialized. The real shell (TanStack Router, shadcn/ui, PWA) comes in Phase 1.

### 7.4 Events in Phase 0

`tenant.seeded` is the only event, emitted by the seed, so the outbox to queue to consumer path is proven end to end. The real catalog starts in Phase 1 with `tenant.created`.

## 8. Environments, CI/CD and infrastructure

| Environment | Workers | Database | Notes |
| --- | --- | --- | --- |
| Local | `wrangler dev` (API on :8787, storefront on :4321) | Native Postgres 18, through Hyperdrive `localConnectionString` | Mailpit for codes |
| CI tests | — | `postgres:18` service container | Migrations run as `postgres`, tests as `mm_app` |
| Preview | Preview versions with alias `pr-<n>` on `managemind-api-preview` and `managemind-storefront-preview` | Shared Neon `preview` branch; its own branch when labeled `db-branch` | Q1 decided |
| Production | `managemind-api` and `managemind-storefront` on `workers.dev` until the domains arrive | Neon `production` | |

Workflows:

1. **`ci.yml`** (pull requests):
   - install with the pnpm cache, then `biome ci`, typecheck, and unit plus integration tests against `postgres:18`, including the isolation suite.
   - build, the bundle-size check, and `wrangler versions upload --preview-alias pr-<n>` for both preview Workers.
   - Playwright smoke tests against the preview URLs, then the URLs commented on the PR.
2. **`db-branch.yml`** (label `db-branch` added, or a push while the label is on):
   - create the Neon branch `pr-<n>` from `production`, run the migrations, create the Hyperdrive config `pr-<n>` and upload the preview bound to it.
   - when the PR closes: delete the branch and the Hyperdrive config.
3. **`deploy.yml`** (push to `main`): `needs: ci`. Migrations with `DATABASE_URL_MIGRATIONS`, then deploy the API, then the storefront, then a smoke test of `/health`. Rollback with `wrangler rollback` (documented in `docs/runbooks/rollback.md`).
4. **`provision.yml`** (manual, idempotent):
   - create the `mm_app` password and the Hyperdrive configs (production, preview).
   - create the Queues and DLQs, the KV namespace, and the R2 buckets `managemind-files` and `managemind-files-preview`, with lifecycle rules: `exports/` 7 days, `tmp-uploads/` 1 day, `backups/daily/` 8 days, `backups/weekly/` 35 days.
   - Source: `scripts/provision/*.ts`, which calls the Cloudflare and Neon APIs.

Neon compute stays fixed at 0.25 CU (already set). Cloudflare bot protection waits for each domain to be added (Phases 1 and 3), since there is no zone yet.

## 9. Monitoring

- Workers Logs (observability on, head sampling for 2xx), plus Workers Analytics for CPU and requests. The agent reads both through the API, since `wrangler tail` needs WebSockets.
- Sentry for the API (`@sentry/cloudflare`), the storefront (the same SDK in the Astro Worker entry) and the admin (`@sentry/react`). Source maps are uploaded from CI with `SENTRY_AUTH_TOKEN`. Errors are sampled at 100% and traces at 0% on the free plan.
- External uptime check on `https://managemind-api.aradworkspace.workers.dev/health`. The owner sets it up at the end of the phase.

## 10. Tests in Phase 0

| Layer | Tests |
| --- | --- |
| Unit | money (including allocation sums and rounding), uuidv7 order and format, state machine (legal, illegal, guards), problem mapping, i18n catalog parity, config schemas |
| Integration | migrations apply cleanly to an empty Postgres 18; `withTenant` sets context and refuses without it; idempotency replay, conflict and in-progress; outbox emit and claim through `mm_system`; audit log append-only (`UPDATE` and `DELETE` denied for `mm_app`) |
| Isolation suite | For **every** table in `store`, generated from the catalog: (1) as `mm_app` with tenant A's context, `SELECT` returns zero of tenant B's rows; (2) `INSERT` and `UPDATE` with B's `tenant_id` fail on `WITH CHECK`; (3) no context returns zero rows; (4) `mm_app` cannot `SET ROLE` to `mm_system` or to the owner, and has no `BYPASSRLS`. The catalog test from §5.3 makes sure new tables join automatically |
| API | `/health`, `/openapi.json` validity, problem+json on 404 and 422, request ID echo, `/v1/store/context` for both demo tenants and an unknown host |
| E2E smoke (Playwright) | The preview storefront with `?store=demo-fashion` and `?store=demo-grocery` shows the right store and locale; the admin placeholder loads; `/health` returns 200 |

## 11. Pull requests

Each PR is under about 400 changed lines, excluding lockfile and generated migrations.

| # | PR | Notes |
| --- | --- | --- |
| 1 | Monorepo scaffold, Biome, tsconfig, Turborepo, SessionStart hook, ADR 0001 (ADR format) and ADR 0008 (local Postgres) | |
| 2 | Spike: database path → ADR 0002 | Needs Q3, and Q4 for the Bangladesh numbers |
| 3 | Spike: auth → ADR 0005 | |
| 4 | Spike: CPU and bundle → ADRs 0003 and 0004 | Reuses the spike Workers |
| 5 | Spike: edge state → ADR 0006 | |
| 6 | Spike: cache invalidation → ADR 0007 | Needs Q2 (a zone) |
| 7–8 | `packages/shared` (money, uuidv7, errors; then state machine, i18n, config) | |
| 9–10 | `packages/db` (roles, schemas, RLS helper, base tables, ADR 0009; then seed, test harness, isolation suite, catalog test) | |
| 11 | `packages/core` base services (withTenant, outbox, idempotency, audit), ADR 0010 | |
| 12–13 | `apps/api` (skeleton, middleware, health, OpenAPI; then database wiring, store context, queue and cron) | |
| 14 | `apps/admin` placeholder and `apps/storefront` placeholder with host resolution | |
| 15 | Sentry wiring (needs DSNs) | |
| 16 | `ci.yml` and the bundle check | |
| 17 | Previews, Playwright smoke, `db-branch.yml`, ADR 0011 (preview databases) | |
| 18 | `provision.yml`, `deploy.yml`, rollback runbook | Needs the GitHub secrets |
| 19 | `docs/phases/phase-0-report.md` | |

ADR 0012 records the dependency choices (driver, zod-openapi, home-grown i18n and uuidv7, Mailpit) and lands with the PR that first adds each dependency.

## 12. Acceptance criteria (from PLAN.md) and how they're verified

| Criterion | Verification |
| --- | --- |
| A PR gets its own preview API and storefront automatically, and a database branch when labeled | A test PR shows the preview URLs in a comment and the Playwright smoke passes; adding `db-branch` creates `pr-<n>` in Neon and closing the PR deletes it (checked through the Neon API) |
| The isolation harness exists and runs in CI | The isolation and catalog tests run in `ci.yml`. A deliberately broken table (no policy) in a test-only migration makes CI fail, shown once in the PR |
| Spike ADRs record measured CPU time, latency and bundle sizes | ADRs 0002–0007 with raw numbers, method and date; summarized in the phase report |

## 13. Open questions for the owner

- **Q1 — Preview database for unlabeled PRs. Decided (Oct 9):** a single shared Neon `preview` branch, reseeded when migrations change; it sleeps when unused but shares the project's 100 CU-hours.
- **Q2 — A zone for the cache spike:** option (a) buy the main domain now, or (b) defer the spike (§3.6).
- **Q3 — Throwaway Neon spike branch. Decided (Oct 9):** yes. The agent creates the `spike` branch through the API and uses its connection string from the session; the branch is empty and deleted after the spikes. Production credentials never enter the session.
- **Q4 — Bangladesh latency.** Can you open a spike URL a few times from a Bangladeshi mobile network and from broadband during spike week?
- **Q5 — `managemind-communication` Worker.** What is it, and should it stay on this account? It shares the free daily request and Cron Trigger allowances.
- **Q6 — Merge rights:** may the agent merge its own PRs once every check is green, or will you merge each one?
- **Q7 — Spike code. Decided (Oct 9):** keep `spikes/` until Phase 1 ends, then delete it.
