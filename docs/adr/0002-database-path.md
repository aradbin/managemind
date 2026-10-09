# ADR 0002: Database path from Workers to Neon

- Status: Accepted. The second-driver question (decision 1) is settled by ADR 0013: one driver.
- Date: 2026-10-09
- Spike code: `spikes/db/` (deleted after Phase 1)

## Context

Every API request reaches Neon Postgres (Singapore, `aws-ap-southeast-1`) from a Cloudflare Worker, and every tenant query must run in a transaction that sets `app.tenant_id` so row-level security (RLS) filters it. The plan's default path is Drizzle over Hyperdrive, with Neon's serverless driver as the fallback. This spike measured:

- latency per transaction, and per round trip;
- CPU time per request against the free plan's 10 ms;
- whether tenant context can leak between pooled connections.

## Method

- **Database:** a throwaway Neon branch `spike` (Postgres 18.6, fixed 0.25 CU) holding a FORCE RLS table with 500 rows for each of two tenants.
- **Roles:** `app_rw` (NOLOGIN, no `BYPASSRLS`) and `mm_app` (LOGIN, member of `app_rw`), both created with SQL.
- **Hyperdrive:** a config pointing at the branch as `mm_app`, with query caching off so that every query reaches the database.
- **Workers:** two copies of the same spike Worker on the free plan:
  - `default` placement;
  - `near-db`, with `placement.region = "aws:ap-southeast-1"`.
- **Transaction shape** ("set tenant + 3 queries"):
  1. `BEGIN`
  2. `set_config('app.tenant_id', …, true)`
  3. a count
  4. a list of 20 rows
  5. a lookup by ID
  6. `COMMIT`
- **Drivers:**
  - `pg` (node-postgres): 6 round trips;
  - `pg-packed`: `BEGIN` and `set_config` sent as one simple-query message, so 5 round trips;
  - `drizzle-pg`: Drizzle's `transaction()` over `pg`;
  - `postgresjs`;
  - `neon-http`: the whole transaction as one batched HTTP request, not interactive;
  - `neon-ws`: Neon's serverless driver over WebSocket.
- **Sources:** latency comes from timers inside the Worker; CPU time comes from Workers Logs (`$workers.cpuTimeMs`). The session runs in the US, so its requests enter Cloudflare at EWR (Newark).

## Results

### Latency (2026-10-09, warm, 8 runs per row, measured from the session)

| Driver | Round trips | p50, near-db (runs in SIN) | p50, default (runs in EWR) |
| --- | --- | --- | --- |
| pg | 6 | 50 ms | 1,448 ms |
| pg-packed | 5 | **33 ms** | 1,210 ms |
| drizzle-pg | 6 | 51 ms | 1,471 ms |
| postgresjs | 6 | 63 ms | 1,951 ms |
| neon-http | 1 | 41 ms | 765 ms |
| neon-ws | 6 | 72 ms | 2,401 ms |

- Each round trip costs about 5–8 ms when the Worker runs next to Neon, and about 245 ms from EWR. For a Worker that is not placed, latency is roughly round trips × the Worker-to-Singapore round-trip time.
- The free plan accepts the region placement hint (`cf-placement: remote-SIN`).
- A cold Neon compute added about 1.5 s to the first request after it had been suspended.

### CPU time per request (near-db Worker, 30 interleaved runs per driver, no other subrequests)

| Driver | min | p50 | p90 | max |
| --- | --- | --- | --- | --- |
| neon-http | 1 | **2.5** | 5 | 7 |
| pg, connect and authenticate only | 1 | 4 | 7 | 16 |
| pg-packed | 3 | **9** | 13 | 16 |
| pg | 5 | 11 | 17 | 19 |
| drizzle-pg | 4 | 11 | 18 | 45 |

Opening and authenticating the connection to Hyperdrive accounts for about 4 ms of every request on the TCP drivers.

### Tenant isolation through the Hyperdrive pool (40 concurrent clients per run, 2 Workers in parallel)

| Run | Rows from the other tenant inside a transaction | Rows seen outside a transaction (should be 0) |
| --- | --- | --- |
| Transaction-local setting only, clean pool | 0 | **0** |
| Every fifth client also calls `set_config(…, false)` (session level) | 0 | **10,500–11,500** |
| Next request, no session-level calls, pool left from the run above | 0 | **12,500–16,000**, including the other tenant's rows |
| Guarded policy (below), with session-level calls | 0 | **0** |
| Guarded policy, poisoned pool | 0 | **0** |

**Finding:** session-level settings survive on Hyperdrive's pooled connections across clients and across requests. Hyperdrive's documentation says connections are `RESET` when they are returned to the pool, but in practice that did not clear custom settings made with `set_config`. A single accidental session-level `set_config`, or one query run outside `withTenant`, would expose one store's data to another store's request.

Transaction-local settings never leaked: Postgres reverts them at `COMMIT`.

## Options

1. **Hyperdrive + node-postgres + Drizzle.** Interactive transactions, which `placeOrder` needs for conditional stock updates and branching inside the transaction. Connection pooling is included. About 33–50 ms per transaction when placed next to Neon. CPU is 9–11 ms at p50, so on the free plan the database path alone uses roughly the whole budget.
2. **Neon serverless driver over HTTP.** One round trip per batch and the lowest CPU (2.5 ms at p50). Not interactive: statements in a batch cannot depend on earlier results except through SQL. It does not count against Hyperdrive's 100,000 queries a day.
3. **postgres.js or the Neon WebSocket driver.** Slower than node-postgres in every measurement and more CPU. Rejected.

## Decision

1. **Driver:** node-postgres over Hyperdrive, with Drizzle as the query builder, for every tenant transaction. Neon HTTP stays as a candidate for read-only requests if the CPU budget spike (ADR 0003) shows that the TCP path does not fit. Whether to have one path or two is decided there, not here.
2. **One round trip to start a transaction.** `withTenant` sends `BEGIN` and `set_config` together as a single simple-query message, then runs Drizzle on the same client. The message contains the tenant UUID as a literal, so `withTenant` must validate it against a strict UUID pattern first; nothing else is ever interpolated.
3. **Guarded tenant function.** Every tenant policy uses `(select app.current_tenant_id())`:

   ```sql
   create function app.current_tenant_id() returns uuid language sql stable as $$
     select case when current_setting('app.tenant_at', true) = now()::text
                 then nullif(current_setting('app.tenant_id', true), '')::uuid end
   $$;
   ```

   `withTenant` sets both `app.tenant_id` and `app.tenant_at = now()::text`, transaction-local. `now()` is the transaction's start time, so a value left on a pooled connection by an earlier transaction never matches, and the policy returns zero rows. The function is wrapped in `select` so Postgres evaluates it once per statement rather than once per row.
4. **Placement:** the API Worker uses `placement.region = "aws:ap-southeast-1"`, confirmed from Bangladesh: about 90–125 ms for a tenant transaction instead of 275–360 ms. The storefront Worker is not placed, because it serves cached pages from the colo nearest the shopper. Cloudflare documents that placement applies to `fetch` handlers and not to RPC methods, but it does not say whether a `fetch` arriving over a service binding is placed. The CPU budget spike (ADR 0003) builds the storefront-to-API path and checks this through the `cf-placement` header.
5. **Hyperdrive query caching off.** The cache knows nothing about RLS context. Tenant reads run inside transactions anyway, and the plan's edge cache sits in front of the API.
6. **App role:** `mm_app` is created with SQL, so it is not a member of `neon_superuser` (confirmed: `rolbypassrls = false`, member only of `app_rw`). Roles created through the Neon console or API would be members and would bypass RLS.

### From Bangladesh (2026-10-09, owner's phone, 3 rounds per row)

The owner ran the spike page on Grameenphone mobile data, whose requests entered Cloudflare at CGP (Chittagong), and on Link3 broadband, which entered at DAC (Dhaka). Every request succeeded (81 of 81). The times below are database time measured inside the Worker, p50 in ms.

| Driver | Mobile, default (runs in CGP) | Mobile, near-db (CGP → SIN) | Broadband, default (runs in DAC) | Broadband, near-db (DAC → SIN) |
| --- | --- | --- | --- | --- |
| pg | 360 | 44 | 331 | 65 |
| pg-packed | 317 | **32** | 274 | **40** |
| drizzle-pg | 342 | 55 | 306 | 49 |
| postgresjs | 433 | 56 | 458 | 46 |
| neon-http | 179 | 51 | 156 | 34 |
| neon-ws | 497 | 1,231 | 509 | 152 |

- Without placement, each database round trip from Bangladesh costs about 55 ms (DAC) to 63 ms (CGP), so a 5–6 round-trip transaction spends about 275–360 ms waiting on the database.
- With placement, the request crosses to Singapore once, about one 55–63 ms round trip, and then pays 5–8 ms per database round trip. The estimated total for a Bangladeshi shopper is therefore about 90–125 ms with placement, against 275–360 ms without. Placement is about three times faster for every interactive driver.
- Even Neon HTTP's single round trip is faster placed (34–51 ms plus the one crossing) than not placed (156–179 ms), because the HTTP request itself is slower over the long path.
- Neon's WebSocket driver was slow and erratic from both networks, which confirms its rejection.

## Consequences

- Tenant isolation does not depend on every developer remembering a rule: even a session-level `set_config` cannot expose data. The isolation suite gets a test that poisons a connection and checks that a new transaction sees nothing.
- Every tenant query must go through `withTenant`. There is no shared "set it once per connection" shortcut.
- CPU is the binding constraint on the free plan, not latency. ADR 0003 must budget about 9 ms for the database path.
- **Bot protection on webhooks:** some non-browser clients got Cloudflare error 1010 (blocked browser signature) on `workers.dev` until they sent a normal `User-Agent`. Webhook endpoints (SSLCommerz IPN, couriers) must be exempt from browser-signature checks when the webhook host gets bot protection in Phase 1.
