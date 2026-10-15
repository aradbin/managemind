# Phase 1 report — Tenancy, identity and the admin

- Date: 2026-10-15
- Plan: `docs/phases/phase-1-plan.md`

## Summary

Phase 1 is built and running in production on its own domains.

- **Admin:** `admin.managemind.site`, a Bangla-first PWA.
- **Health checks and future webhooks:** `api.managemind.site`.
- **Stores:** every store answers at `<slug>.managemind.store`.

Staff sign in with an email code, with authenticator two-factor login (required for platform staff). Owners invite their team, set roles and edit the store profile. Platform staff create, suspend and support stores.

The isolation acceptance criteria are met and checked in CI. The CLI criterion is met on every preview by the E2E suite. In production it waits for the owner's first super-admin email address (Q3), because a real inbox has to receive the code.

**Three things the owner should know:**

1. **Staff requests use more CPU than Phase 0 measured.**
   - On warm isolates, `GET /v1/admin/me` takes a median 25 ms of CPU and `PATCH /v1/admin/store` 31 ms. The Free plan allows 10 ms per request, and ADR 0003's spike measured 13 ms.
   - Nothing has been stopped (0 of 560 API requests in the last daily check). ADR 0003 tolerates staff requests over 10 ms because they are a small share of traffic.
   - The daily alarm fired on the API's p99 (87 ms, against the 50 ms "investigate" line): issue #40.
   - §3 has the breakdown and what to do. In short, there is no single slow route; the cost is per-request framework overhead. Workers Paid ($5 a month) becomes the answer if Cloudflare ever stops a request.
2. **Production email works now.** Sign-in codes and invitations go out from `no-reply@managemind.site` through Resend, with DKIM and DMARC in place.
3. **Owner actions are listed in §5.** The first super admins (Q3) are the one that blocks real use.

## 1. What was built

| Plan PR | GitHub | What |
| --- | --- | --- |
| 1–5 | #26 | Permissions and roles, platform tables and grants, the tenant registry and purge order, the email providers (Resend, capture), the rate limiter and lockout |
| 6 | #27 | Better Auth staff sign-in: email codes, TOTP two-factor login on code sign-in (Plan A), sessions, cookies, CSRF |
| 7 | #28 | Stores: create, profile, lifecycle, host resolution, the KV sync consumer (ADR 0015) |
| 8 | #29 | Memberships, invitations, support grants, platform roles, `authorize` |
| 9 | #30 | `/v1/admin/*` and the generated isolation suite; migration 0006 |
| 10 | #31, #32 | `/v1/platform/*` and the dev mailbox; storefront KV lookup and maintenance page |
| 11 | #33 | Platform CLI and `platform.yml` |
| 12 | #34 | `packages/sdk`, the typed API client, with a CI drift check |
| 13 | #35 | Admin foundation: router, query, Tailwind, i18n, shell, PWA; admin moved to `/` |
| 14 | #36 | Sign-in, two-factor challenge and setup, accepting invitations, account page |
| 15 | #37 | Shared components, store switcher, store profile, staff management |
| 16 | #38 | Platform area (stores, support access, platform staff, audit log) and the dev mailbox page |
| 17 | #39 | Production on `admin.`, `api.` and `*.managemind.store`; `zones.ts` |
| 18 | #41 | E2E flows at two viewports with axe on every screen; CPU per route on every preview |
| 19 | this PR | Spikes deleted; this report |

### Production, as deployed Oct 15

| | |
| --- | --- |
| Admin | `https://admin.managemind.site`: static assets with an SPA fallback, and `/api/*` to the API Worker (custom domain) |
| API | `https://api.managemind.site/health` and `/v1/webhooks/*` only (Workers routes) |
| Stores | `https://<slug>.managemind.store` (wildcard route). An unknown store gets the storefront's own 404, a suspended one the maintenance page |
| Email | Resend from `no-reply@managemind.site`: sign-in codes, invitations, support-access notices to owners |
| `workers.dev` | Still on, until the uptime monitor moves (§5) |
| Stores in production | None yet: the first super admin creates them (Q3) |

## 2. Acceptance criteria

| Criterion | Status |
| --- | --- |
| Isolation suite: a store A user gets 404 on every store B resource by ID | **Met.** The suite is generated from `ADMIN_ROUTES` and runs in CI. A route without a fixture fails the suite, so new routes join automatically. Demonstrated on #30: commit `fcd9723` removed a guard and CI failed; `b77ba79` reverted it |
| Raw SQL as the app role with tenant A context returns no store B rows | **Met.** The Phase 0 suite, still generated from the catalog, runs on every PR |
| Creating a tenant with the CLI takes one command and produces a working admin login and subdomain | **Met on previews; production waits for Q3.** Every preview seeds stores with the CLI's own functions (`e2e-seed.ts`). The E2E then signs in with the code from the mailbox, works in the store and opens it on the storefront. In production, the hosts are verified (admin shell, API behind it, store subdomain). The one-command run needs an inbox the owner reads, so it happens with the first super admin |

PLAN.md items without their own criterion:

- **WCAG:** axe runs on 14 screens at each of two viewports and fails on serious or critical violations; none at merge.
- **Bangla and English:** catalog parity tests run for the shared and admin catalogs.
- **PWA:** manifest, precached shell and an update prompt are in place. The planned Lighthouse installability check was not added (§5).

## 3. Measurements

### CPU per route (Workers Logs, preview of #41, warm isolates, ms)

| Route | Requests | p50 | p90 | p99 | Max |
| --- | --- | --- | --- | --- | --- |
| `GET /v1/admin/me` | 92 | 25 | 54 | 160 | 160 |
| `PATCH /v1/admin/store` | 30 | 31 | 41 | 53 | 53 |
| `POST /api/auth/email-otp/send-verification-otp` | 7 | 56 | 149 | 149 | 149 |
| `POST /api/auth/sign-in/email-otp` | 7 | 73 | 124 | 124 | 124 |

For comparison:

- ADR 0003's spike measured a signed-in admin request at p50 13 ms, p99 31 ms.
- Production's sparse traffic (mostly cold isolates) shows `HEAD /health` at a median 7 ms and an unauthenticated `GET /v1/admin/me` at 46 ms.
- The daily check on Oct 15 found 0 of 560 API requests stopped and a p99 of 87 ms.

**Where the time goes.** A local profile of 1,500 `GET /me` requests in Node took about 8.8 ms of busy CPU per request; Workers runs about 2.5 times slower.

- Drizzle rebuilt its relational config on every `createDb` call (twice per request), though the relational query API is never used. The profile put this at about 15%.
- About 13% is building a Better Auth instance per request.
- The rest is spread across the Postgres driver, garbage collection, crypto, zod and Hono.
- `/me` sends 7 SQL statements, and one of them is redundant (the platform role is read again after the user row).

There is no slow query or slow route to fix.

**Follow-up, measured.** The PR after this report builds Drizzle without the relational config and passes the session's platform role to `actorFor`, dropping a query. Locally, `GET /me` went from a median of about 8.75 ms to about 8.0 ms of CPU (2 runs of 600 requests each, before and after); `PATCH /store` didn't change beyond noise. So the real gain is about 9%, smaller than the profile suggested. Reusing one Better Auth instance per isolate is the remaining larger item: its database handle is per request, so it needs a request-scoped adapter, and it is left for when the numbers call for it.

**Recommendation.**

1. Keep ADR 0003's policy. Staff requests are a small share of traffic, and none has been stopped.
2. The cheap fixes are done (above). Sharing the Better Auth instance waits until the warm p99 stays over 50 ms.
3. If Cloudflare ever stops a request (`exceededCpu`), move to Workers Paid ($5 a month, 30 s CPU), as ADR 0013 already decided.
4. Close #40 with this explanation, and keep the 50 ms line as a regression alarm for the warm numbers above.

The CPU step now runs on every preview, so a regression shows in the PR before it ships.

### Bundles

| | Size (gzip) | Budget |
| --- | --- | --- |
| API Worker | 696 KiB | 3 MiB (23%) |
| Storefront Worker | 274 KiB | 3 MiB (9%) |
| Admin, JavaScript before the sign-in screen | 130 KiB | 150 KiB (86%) |

The admin budget caught one regression before merge (162 KiB in #37): zod schemas at module level in route files. Screens with forms now live in `src/pages` so code splitting moves them out.

## 4. Free-tier usage (last 24 hours on Oct 15, from the daily check)

| Resource | Free limit | Used | Note |
| --- | --- | --- | --- |
| Worker requests | 100,000/day | 1,514 (2%) | Mostly previews and E2E |
| Hyperdrive queries | 100,000/day | 329 | |
| Queue operations | 10,000/day | 0 | No stores in production yet |
| KV writes | 1,000/day | 0 | Same |
| Neon compute | 100 CU-hours/month | 1.9 (on pace for 3.9) | |
| Neon storage | 0.5 GB | 94 MiB (18%) | E2E stores accumulate on the shared preview branch (example.test, nothing is sent) |
| Neon branches | 10 | 2 (`production`, `preview`) | `spike` deleted |
| Hyperdrive configs | 10 | 2 | `managemind-spike-db` deleted |
| Worker scripts | 100 | 2 in production, plus 2 per open PR | All 7 spike Workers deleted |
| Resend | 100/day, 3,000/month | Not yet used in production | |

**Deleted in this PR (Phase 0 Q7):**

- 7 spike Workers, with the two `spike-cache*.managemind.site` hostnames;
- the KV namespace `managemind-spike-cache`;
- the spike's two queues;
- the Hyperdrive config `managemind-spike-db`;
- the Neon branch `spike`;
- the `spikes/` directory, and two catalog entries only the spikes used.

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **Q3: first super admins.** Which email addresses get `super_admin`, and does anyone get `support`?
   - Then: `platform.yml` → `platform:grant-role`. That user signs in at `admin.managemind.site`, sets up an authenticator and creates the first store.
2. **Block AI bots and the WAF rule (§3.6).** Neither API token may change them, so `zones.ts` warns on every deploy.
   - Turn on Cloudflare dashboard → managemind.site → Security → Bots → **Block AI bots**.
   - Add **Zone WAF: Edit** to the deploy token, and the next deploy adds the rule.
3. **Uptime monitor.** Point UptimeRobot at `https://api.managemind.site/health`. Then production's `workers.dev` addresses can be turned off (`workers_dev` for both Workers in `scripts/lib/workers.ts`).
4. **Q8:** a support address for `Reply-To`, if there is one.
5. **Q11:** session lengths (7 days for staff, 12 hours for platform users) are in use as proposed; say if they should change.
6. **Search Console:** send the TXT value, if wanted.
7. **Rotate `neondb_owner` on `production`** (open since Phase 0). The `spike` branch that might have shared it is now deleted.

### Not built yet, or smaller than planned

- **Lighthouse PWA check.** The PWA is in place but its installability isn't checked in CI.
- **App icons** are placeholders until there is a logo.
- **The CPU follow-up** in §3.
- **E2E data on the preview branch** grows by two stores per preview run. A cleanup can come with purge (Phase 5B).

### Decisions that differ from the plan

- **Two-factor login on code sign-in:** Plan A worked, reusing the plugin's own after-hook (ADR 0005 amendment).
- **Migration 0006:** `platform.verifications.id` is text, because Better Auth writes non-UUID ids there when an unverified user first signs in.
- **Better Auth `freshAge` is 0.** Its freshness check only guarded `list-sessions`, which otherwise broke after a session's first day.
- **Admin at the root on previews too:** the PR's API Worker serves it. Invitation links point at `/invite`.
- **Store choice:** a new session picks this device's last store, or the first one, never a support-grant store. The store switcher changes it.
- **`/me` has `supportGrantId`,** so support can end access early from the banner.
- **Production domains** are defaults in the workflows; repository variables override them.
- **E2E seeding** runs in the preview's database step, using the CLI's functions instead of a separate CLI run.

### Lessons for later phases

- **Measure CPU on warm isolates, per route, on every PR.** Production's sparse traffic hides the per-request cost behind cold starts, and the opposite mistake is just as easy.
- **The admin bundle budget earns its keep.** Keep module-level work out of route files.
- **Browser runs find what unit tests don't:**
  - `unwrap()` refusing a 204;
  - new sessions without a store;
  - `queryClient.clear()` leaving mounted screens on old data.
- **Check the token's permissions before relying on them in a deploy.** DNS and routes were fine; bot and WAF settings were not.

## 6. Ready for Phase 2

The tenancy, identity and admin foundations are in place, with isolation enforced and tested on every PR. Phase 2 (catalog) builds on:

- the admin's shared components and form patterns;
- `PermissionGate` and the permission matrix, which already has `catalog.*`;
- the outbox and KV sync;
- the per-preview CPU and accessibility checks.

The first production stores can be created as soon as the first super admin exists.
