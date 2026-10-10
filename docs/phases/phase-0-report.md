# Phase 0 report — Foundations

Oct 10, 2026 · Plan: [`phase-0-plan.md`](phase-0-plan.md) · Source: `docs/PLAN.md` § Phase 0

## Summary

The skeleton is built and running in production, and every Phase 0 acceptance criterion is met and verified.

**What exists:**
- the monorepo;
- the database with row-level security;
- the shared, core and database packages;
- the API, storefront and admin placeholder;
- CI, per-PR previews and the production deploy.

**The spikes changed three plan assumptions** (details below):
- the free plan's 10 ms CPU limit is not enforced strictly enough to matter yet (ADR 0003, ADR 0013);
- staff sign in with email codes, not passwords, until Workers Paid (ADR 0005);
- rate limits need a Durable Object, because the rate-limiting binding never limited anything (ADR 0006).

**Three items wait on the owner:**

| Item | Waiting for |
| --- | --- |
| Sentry wiring (PR 15) | The Sentry organization slug and three DSNs |
| Per-store cache invalidation spike (ADR 0007, PR 6) | The main domain on Cloudflare, and Zone: Read plus Cache Purge: Purge on the session token |
| External uptime check | An uptime monitor on `https://managemind-api.aradworkspace.workers.dev/health` (§5) |

## 1. What was built

| Plan PR | GitHub | What |
| --- | --- | --- |
| Plan, 1 | #3 | Phase 0 plan; pnpm and Turborepo monorepo, Biome, strict TypeScript 6, SessionStart hook with native Postgres 18 (ADR 0001, ADR 0008) |
| 2 | #4 | Database path spike (ADR 0002) |
| 3 | #5 | Auth spike (ADR 0005) |
| — | #6 | Free plan first, Workers Paid later (ADR 0013) |
| 4, 5 | #7 | CPU budget, bundle size and edge state spikes (ADR 0003, ADR 0004, ADR 0006) |
| 7, 8 | #8, #9 | `packages/shared`: money, UUIDv7, problem-details errors, state machines, Bangla and English i18n, config validation |
| 9, 10 | #10, #11 | `packages/db`: `app`, `platform` and `store` schemas, roles, base tables with FORCE RLS, system functions, seed, isolation suite and catalog test (ADR 0009) |
| 11 | #12 | `packages/core`: `withTenant`, outbox, idempotency, audit (ADR 0010) |
| 12, 13 | #13, #14 | `apps/api` (`managemind-api`) |
| 14 | #15 | `apps/admin` placeholder and `apps/storefront` with tenant resolution |
| 16 | #16 | `ci.yml`, bundle-size check, Renovate config, `pnpm audit` |
| 17 | #18 | `preview.yml`: per-PR Workers, preview databases, Playwright smoke (ADR 0011) |
| 18 | #19, #20 | `provision.yml`, `deploy.yml`, rollback runbook; then a fix to the deploy smoke test |
| 19 | this PR | This report |

**`apps/api` in detail:**
- Hono with zod-openapi;
- request IDs and structured JSON logs;
- RFC 9457 problem responses;
- `/health`, `/health/deep`, `/openapi.json` and `/v1/store/context`;
- the outbox queue consumer and the daily cron batch;
- the admin served from static assets at `/admin`.

**Tests:** 118 unit, integration and isolation tests across 5 packages, plus the 6-test Playwright smoke. Every PR runs them against Postgres 18 in CI.

### Production, as deployed Oct 10

| Resource | Name |
| --- | --- |
| Workers | `managemind-api` (placed in `aws:ap-southeast-1`, daily cron `47 23 * * *`), `managemind-storefront` |
| URLs | `https://managemind-api.aradworkspace.workers.dev`, `https://managemind-storefront.aradworkspace.workers.dev` (workers.dev until the domains arrive) |
| Database | Neon `production` (Singapore, Postgres 18, fixed 0.25 CU), migrations 0000–0003, no stores yet |
| Hyperdrive | `managemind-production`, as `mm_app`, caching off |
| Queues | `managemind-outbox` (consumer: the API) and `managemind-outbox-dlq` |
| KV | `managemind-edge` (not bound yet; Phase 1) |
| R2 | `managemind-files` and `managemind-files-preview`, near Singapore, with the five lifecycle rules |

The production storefront answers its "Store not found" page, because stores are created from Phase 1 on.

## 2. Acceptance criteria

| Criterion (PLAN.md) | Verified |
| --- | --- |
| A pull request gets its own preview API and storefront automatically, and a database branch when labeled for it | **Met.** On #18, the first preview deploy created the shared Neon branch `preview`, deployed `managemind-api-pr-18` and `managemind-storefront-pr-18`, passed the smoke test, and commented the URLs. Adding `db-branch` created Neon branch `pr-18` and Hyperdrive config `managemind-pr-18`, and the preview moved to them (`/health/deep` 19 ms). Merging deleted the branch, the config and both Workers; I checked each through the Neon and Cloudflare APIs. #19 and #20 cleaned up the same way |
| The isolation test harness exists and runs in CI | **Met.** The isolation suite and the catalog test run in `ci.yml` on every PR. A temporary commit on #16 added a store table without RLS, and [CI run 38028396386](https://github.com/aradbin/managemind/actions/runs/38028396386) failed 6 tests on it (FORCE RLS, `tenant_isolation` policy, `tenant_id` column, grant and fixture, own-rows visibility, cross-tenant insert). The revert was green |
| Spike ADRs record the measured CPU time, latency and bundle sizes | **Met** for ADRs 0002–0006, each with the method, raw numbers and date (§3). ADR 0007 (cache invalidation) waits for the domain |

The plan's own checks (phase-0-plan §10):

| Layer | Status |
| --- | --- |
| Unit | Money, UUIDv7, state machines, problem mapping, i18n catalog parity, config schemas |
| Integration | Clean migrations on an empty Postgres 18; `withTenant`; idempotency replay, conflict and in-progress; outbox claim through `mm_system`; append-only audit log |
| Isolation | Generated from the catalog for every `store` table |
| API | `/health`, `/openapi.json`, problem+json, request IDs, store context |
| E2E smoke | Both demo stores with their locales, unknown store 404, admin placeholder, `/health` and `/health/deep`. Runs on every preview |

## 3. What the spikes measured

| Question | Result | ADR |
| --- | --- | --- |
| Database path | node-postgres and Drizzle over Hyperdrive to Neon Singapore. A tenant transaction takes **33–50 ms** with the API placed next to Neon, against 1.2–1.5 s from a US location. From Bangladesh (Grameenphone enters at CGP, Link3 at DAC) it is **about 90–125 ms placed** against 275–360 ms unplaced | 0002 |
| Tenant leak through pooling | Session-level `set_config` survives on Hyperdrive's pooled connections (10,500–16,000 leaked rows in the test). The guarded `app.current_tenant_id()`, valid only in the transaction that set it, brought this to 0, even on a poisoned pool | 0002 |
| CPU per request (p50) | Product page **3 ms**, anonymous store API call **6 ms**, signed-in admin request **13 ms**. A 30-minute sustained load at about 60 times the pilot's signed-in rate had **0 terminations**, with 64% of admin requests over 10 ms | 0003 |
| Bundle size (gzip) | Spikes: API 645 KiB (21% of 3 MiB), storefront 175 KiB. Today's real Workers: API **241 KiB (8%)**, storefront **178 KiB (6%)**. CI warns at 2.5 MiB and fails at 3 MiB | 0004 |
| Auth | Two Better Auth instances keep same-email shoppers in two stores fully apart (19 checks). Password hashing costs **89 ms** (scrypt) or **36.5 ms** (PBKDF2 at 100k, the Workers maximum) per sign-in, so staff use email codes until Workers Paid. The cookie cache allowed cross-store replay, so it stays off | 0005 |
| Edge state | The rate-limiting binding **never limited** (70 of 70 allowed at limit 5). A Durable Object counter was exact. Queues, delayed messages up to 30 minutes, the DLQ and the cron all work on the free plan | 0006 |

## 4. Free-tier usage (Oct 1–10, from the Cloudflare and Neon APIs)

| Resource | Free limit | Measured | Note |
| --- | --- | --- | --- |
| Worker requests | 100,000/day | Peak 2,942 on Oct 9 (the 30-minute load test), otherwise under 800 a day | Includes `managemind-communication`, about 330 a day |
| Hyperdrive queries | 100,000/day | Peak 19,776 on Oct 9 (load test), 35 on Oct 10 | The load test's share (20%) is about what the pilot estimate allows |
| Queue operations | 10,000/day | 20 (6 writes, 8 reads, 6 deletes) | Spike and outbox tests |
| KV writes | 1,000/day | A handful (spikes) | |
| Neon compute | 100 CU-hours/month | **0.25 CU-hours** so far (895 CU-seconds, about 1 hour awake) | Fixed 0.25 CU on every branch, suspend after 5 minutes idle |
| Neon storage | 0.5 GB | About 32 MB per branch (`production`, `preview`, `spike`) | Almost all of it is Postgres's own catalog; one database's rows are a few KB |
| Neon branches | 10 | 3 (`production`, `preview`, `spike`), plus one per labeled PR | `spike` is deleted after Phase 1 (Q7) |
| Hyperdrive configs | 10 (free plan) | 3 (`managemind-production`, `managemind-preview`, `managemind-spike-db`), plus one per labeled PR | |
| Cron Triggers | 5 per account | 1 (`managemind-api`) | Preview Workers have none |
| Worker scripts | 100 | 9, plus 2 per open PR | Spikes are deleted after Phase 1 |
| CPU terminations (`exceededCpu`) | — | **0**, on every Worker | The trigger for Workers Paid (ADR 0013) |
| GitHub Actions (private repository) | 2,000 minutes/month | About 5 billed minutes per PR push (check 2, build 1, preview 2) and about 6 per merge (CI on master, deploy, preview teardown) | About 120 typical PRs a month |

**Against the pilot estimate (PLAN.md):** nothing measured so far moves it. Neon compute stays the resource to watch. Phase 0's own use is small: a preview smoke wakes a branch for about 5 minutes, and production wakes only for `/health/deep` and deploys.

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **Sentry (PR 15):** the organization slug and DSNs for the API, admin and storefront.
2. **Cache invalidation spike (ADR 0007):** the main domain on this Cloudflare account, and Zone: Read and Cache Purge: Purge for it on the session token.
3. **Uptime monitor:** an external check on `https://managemind-api.aradworkspace.workers.dev/health`, for example UptimeRobot's free plan at 5 minutes. `/health` never touches the database, so it doesn't keep Neon awake.
4. **Install the Renovate GitHub app.** `renovate.json` is in place but does nothing until then. It would also move `pnpm/action-setup` off Node 20, which Actions now flags as deprecated.
5. **Rotate `neondb_owner` on `production`.** The `spike` branch was created from `production` during the spikes, before ADR 0011's reset rule, so it may share production's owner password. Reset it in the Neon console, then update `DATABASE_URL_MIGRATIONS`.

### Not built yet

6. **The daily usage alarm** (ADR 0013, phase-0-plan §9) was missing when this report was written. It is now built (`monitor.yml`, after this report): it runs daily at 08:07 Dhaka time. On an alarm it fails and opens or comments on a `Usage alarm` issue assigned to the owner. It reads Workers Logs rather than Analytics, because Analytics reports Workers created since Oct 9 as `__unknown__`.
7. **Bot protection** waits for each domain, as planned (Phases 1 and 3). Webhook paths must be exempt from browser-signature checks (ADR 0002, consequences).
8. **The local mail catcher (Mailpit)** moved to Phase 1, together with the first real email.
9. **Order-size capacity estimate** (PLAN.md storage section): there are no orders yet, so this is measured when checkout lands (Phase 5A).

### Decisions that differ from the plan

| Plan | Now | Why |
| --- | --- | --- |
| Preview *versions* with aliases on two fixed Workers, plus `db-branch.yml` | A Worker pair per PR in one `preview.yml` | A service binding reaches only the deployed version; version URLs don't exist for Workers with Durable Objects and don't show in Workers Logs (ADR 0011) |
| Rate limits through the rate-limiting binding | A Durable Object per limited key | The binding never limited anything (ADR 0006). ADR 0005 decision 5 is updated to match |
| Tune requests under 10 ms CPU | Write plainly, alert on the first termination, move to Workers Paid then | 0 terminations under sustained overrun (ADR 0003, ADR 0013) |
| Staff passwords | Email codes, passkeys later | Hashing costs 4–9 times the CPU limit (ADR 0005) |
| Postgres in Docker locally | Native Postgres 18 from the session hook | The cloud session has no Docker daemon (ADR 0008); CI still uses `postgres:18` |
| Neon preview branch only when labeled | A shared `preview` branch for unlabeled PRs, as decided in Q1. Each new branch gets a fresh owner password | Neon branches inherit their parent's passwords (ADR 0011) |

### Lessons for later phases

- **Deploy smoke checks retry.** A just-created workers.dev Worker answered Cloudflare's own 404 on some requests for about a minute. The first production deploy succeeded but its smoke test failed for that reason; #20 retries every check and tells the storefront's 404 page apart from Cloudflare's.
- **Fresh databases catch what local ones hide.** The first CI runs found that the per-package test setups raced on `CREATE ROLE`, which never showed locally because the roles already existed.
- **Session tooling:** Node's `fetch` in the cloud session needs `NODE_USE_ENV_PROXY=1` to reach the credential proxy, and Python needs a browser-like `User-Agent` for the Cloudflare API (error 1010).

## 6. Ready for Phase 1

Phase 1 (platform core) can start once its prerequisites in PLAN.md are in hand: the main domain, and the email provider account (the Phase 1 plan will propose free options).

These Phase 0 items should land before or early in Phase 1:
- Sentry, once its DSNs arrive;
- the cache spike, once the domain is on Cloudflare.
