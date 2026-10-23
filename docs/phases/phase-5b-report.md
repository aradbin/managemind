# Phase 5B report: Launch readiness and pilot

- Date: 2026-10-23
- Plan: `docs/phases/phase-5b-plan.md` (approved with the owner's answers in §14)
- Pull request: #66, all of Phase 5B with one commit per plan step and its own preview database (`db-branch`). **Not merged or deployed yet.**

> This report covers the build (plan PR 20). The results below are from tests and the local E2E; #66's `full-preview` run and the load test's run on its preview are added when they finish, and the pilot's results at its end.

## Summary

Phase 5B is built. A super admin can now onboard, bill, close and purge a store from the admin, and the platform has what a pilot needs to run safely.

- **Onboarding.** Platform → New store takes the store's name, address, owner, plan, kind (client, demo or test) and a catalog preset. It sends the owner a welcome email. The owner's dashboard shows a setup checklist; the super admin sees the same checklist and the store's health.
- **Plans and limits.** Plans are data a super admin edits. Products, staff, orders a month, custom domains, SSLCommerz and SMS are checked in the core services, and the admin shows an upgrade message at a limit. The owner sees usage meters. The plans are placeholders until the owner's real ones (Q5).
- **Our billing.** Invoices are drafted monthly from the plan and the order overage, and issued automatically after 2 days. Super admins can also make manual invoices. Payments are recorded by hand (bKash, bank, cash), or online through our own SSLCommerz account once it exists (off until then). Reminders go out at −3, 0, +3 and +10 days, and a store is suspended at +14 (Q9). Owners see their invoices and print them.
- **Terms.** Platform terms have versions. Owners accept the current one; until one of them does, the admin is read-only for owners, while staff and shoppers are never blocked (Q7).
- **Closing, export and purge.**
  - Closing a store needs a fresh two-factor code and the typed address. Its storefront answers 410, and its owners get a full export: every store table as JSON lines, CSVs of the main lists, its files, and its platform records.
  - Owners can also ask for an export from Settings once a day (Q13). The link is signed and lasts 7 days.
  - After the 30-day grace (Q11), a super admin starts the purge. The purge's dry run counts what will go; the super admin approves it with the typed address and a fresh two-factor code. The delete resumes where it stopped, and verifies the store has zero rows, files and keys left.
  - A closed store can be reopened until its purge starts.
  - Exports, purges and resets run in GitHub Actions (ADR 0027), so they cost no Worker CPU and no Hyperdrive queries.
- **Demo and test stores** can be reset. The demo stores start again every Friday with their catalog and a month of sample orders.
- **Shopper deletion requests.** Staff with `customers.delete` anonymize a customer: name, phone, email, addresses, messages and return photos go, and orders keep their totals.
- **Legal pages.** New stores get terms, privacy, returns and delivery pages filled from their own settings. They follow their template until the store edits them. A help menu in the admin shows our support contacts, which a super admin enters under Platform → Terms. **The templates need a local legal review before the pilot.**
- **Backups.** A nightly `pg_dump`, encrypted with `age`, goes to R2: 7 daily and 4 weekly copies. Once a month, a workflow restores the latest copy into a new Neon branch, checks it, and deletes the branch (ADR 0028).
- **Runbooks** for deploying, rolling back, restoring a backup, rotating a secret, a provider outage, a free-tier limit, onboarding and offboarding.
- **Previews connect to Neon directly.** Only the CPU step uses Hyperdrive (Q3), so previews no longer use production's daily Hyperdrive queries. CI's minutes are trimmed (Q10).

**What the owner should know:**

1. **Nothing is deployed yet.** #66 has 23 commits and migrations 0034–0038, and its `full-preview` run fills §2 and §3 with preview results.
2. **The security review found one serious bug, three medium ones and two small ones, all fixed** (§2.1):
   - a store reopened and closed again could be purged at once, on its first closure's approval;
   - exports included shoppers' password hashes and sign-in tokens;
   - support staff could download any store's export without a support grant;
   - the admin sent no security headers (no CSP, HSTS or frame protection).
3. **The review also found two things that would have failed quietly:** CI's dependency audit was about to fail on a new zod advisory, and the Worker started the jobs workflow on a branch named `main`, which doesn't exist, so exports and purges would only ever have started at the daily run.
4. **Acceptance criterion 3 is met in tests** (§2). Criterion 1 runs in the E2E, but it needs a person who has never used the admin, timed with the runbook. Criterion 2 is the pilot itself.
5. **The Flows E2E had been broken since PR 5**, which replaced the dialog it used to make a store. It now uses the New store screen and passes.

## 1. What was built

| Plan PR | Commit | What |
| --- | --- | --- |
| 0 | `d1bd835` | The plan with the owner's answers |
| 1 | `00edf07` | Previews connect to Neon directly; only the CPU step uses Hyperdrive; CI trimmed (ADR 0011 amended) |
| 2 | `88bbaf7` | The CPU step and Lighthouse cover Phase 5A's shopper flows. The sandbox payment script waits for the SSLCommerz sandbox credentials |
| 3 | `a6533a9` | `shared` + `db`: store kinds, the lifecycle's new moves, plans, subscriptions, usage, health, invoices, payments, terms, jobs, purges (migrations 0034–0035) |
| 4 | `8dfc1d2` | Onboarding with plan and preset, the checklist, close and reopen, the CLI's options; a closed store's storefront answers 410 |
| 5 | `d0c3a22` | `admin`: Platform → New store and Store; the owner's setup card |
| 6 | `f95935a`, `c0c20e2` | The daily usage rollup, store health and the platform dashboard; the monitor writes `latest.json` |
| 7 | `e5b487c` | Terms versions, owners' acceptance and the read-only rule |
| 8 | `7badc54` | Plan limits and features in the core services; upgrade messages; usage meters |
| 9–10 | `9f5856b`, `3e19aa9` | Invoices, payments, the SSLCommerz link (off), dunning; Platform → Billing; Settings → Plan and billing (ADR 0026) |
| 11 | `901188d` | `tenant-jobs.yml`, the export, the download route (ADR 0027) |
| 12 | `d959766` | The purge: dry run, approval, resumable delete, verification; criterion 3's test |
| 13 | `5390b66` | Store reset; the demo stores' weekly reset with sample orders; preview store cleanup |
| 14 | `e34d3d8` | Shopper anonymization (migration 0036) |
| 15 | `f641411` | Legal page templates; the help menu (migration 0037) |
| 16 | `2188ce2`, `cc495ea` | Nightly encrypted backups and the monthly restore test (ADR 0028) |
| 17 | `288ed5e` | Runbooks |
| 18 | `9dcb5d5` | CI: the onboarding, billing and closing E2E; the load test script |
| 19 | _next commit_ | Fixes from the security review (migration 0038) |
| 20 | _this commit_ | This report |

## 2. Acceptance criteria

| Criterion | Status |
| --- | --- |
| A non-developer onboards a new store through the super-admin screen in under an hour, excluding the client's own gateway approvals | **Automated in the E2E** (`launch.spec.ts`, at a phone and a desktop viewport, with axe on every screen). A super admin sets up two-factor login and our invoice details, then makes a Starter test store from Platform → New store. Its owner gets the welcome email, signs in, sees the checklist, and meets the custom domain limit. The whole flow takes about 35 seconds locally. **Still needed:** someone who has never used the admin onboards a real pilot client with `docs/runbooks/onboarding.md`, timed from "New store" to the first test order |
| Pilot clients take real orders for four weeks with no cross-tenant incident and no lost orders, still on $0 infrastructure | **The pilot.** Measured as plan §13 says, and added to this report at its end. "$0" is now "$5 a month" (Q2) |
| Purging a seeded test store leaves zero store rows and files for it, leaves the other tenants untouched, and keeps its platform record and billing history | **Met in tests.** `scripts/jobs/purge.test.ts` seeds three stores with a row in every store table and files in R2, then closes and purges one through the dry run and an approval. Its rows, files and KV keys are gone and the other two are untouched. Its tenant record, billing history, audit log and purge record stay. A run stopped halfway resumes to the same result. **The E2E** closes a test store (its storefront answers 410) and queues the dry run; previews have no jobs runner, so the purge itself stops there. **Once in production:** a `test` store is closed and purged, and its purge record goes here |

### 2.1 Security review

The phase was reviewed against PLAN.md's security baseline: authorization on every new platform and store route, tokens and links, webhooks, the jobs and their workflows, exports, logs, emails, headers and dependencies. What it found:

| Finding | Severity | Fix |
| --- | --- | --- |
| Reopening a store left its pending purge job. Closed again, the store matched the job's checks (`closed`, approved), so the next run purged it at once: no new grace period, dry run or approval | High | Reopening cancels a pending purge (migration 0038 lets the API mark the job). The runner also refuses an approval older than the store's last closure, or a grace period that isn't over, whatever the job row says |
| Exports included `shopper_accounts`: shoppers' password hashes and sign-in tokens | Medium | Left out, like sessions and credentials. A test fails if any exported table has a password, token or sealed-secret column |
| The platform's jobs list gave support staff a finished export's download link. Support staff otherwise see a store's data only through a granted, audited support session | Medium | Only super admins and the store's owners get the link |
| The admin's pages had no security headers. Static assets don't run the Worker, so the API's `secureHeaders` never reached them | Medium | `apps/admin/public/_headers`: a CSP (our scripts and Turnstile only, no `eval`, nothing may frame the admin), HSTS, `nosniff`, a referrer policy and a permissions policy. The E2E fails on any CSP violation on every screen it checks |
| Neither SSLCommerz IPN route had a rate limit, and each IPN costs a validation call to SSLCommerz | Low | 600 an hour per IP, far above what SSLCommerz sends at pilot volume. A refused order IPN is still settled by the return page or the 30-minute check; a refused invoice IPN would be recorded by hand from the SSLCommerz panel |
| Astro 7.3.8 pins zod 4.6.5, which a high advisory covers (GHSA-mrhx-c7xc-m3w5); CI's audit would have failed | Low | Astro's zod is overridden to the workspace's 4.6.7 until Astro's update is in |

Not security bugs, found on the way:

- **The Worker started the jobs workflow on `main`.** The repository's branch is `master`, so GitHub would have refused every dispatch, and jobs would only have started at the daily run.
- **One returns E2E step was flaky:** it took the next email, which could be the "return received" one still arriving. It now waits for the email about the refund.

**Accepted as they are:**

- The export link's token is in its query string, so it appears in Cloudflare's request logs and the owner's browser history. It is an HMAC with a 7-day expiry, and rotating `AUTH_SECRET` invalidates every link.
- Outbox events aren't validated with zod when consumed, as in earlier phases. Only our own code produces them: the Worker, and the jobs through our Cloudflare token.
- `pnpm audit` reports one moderate advisory, in esbuild under `drizzle-kit`. That is development tooling and never reaches a Worker.

**Checked, and found fine:**

- Every new platform route needs a platform role and two-factor login. The core services check the role again: `support` reads, `super_admin` changes.
- Closing a store and approving a purge each need a fresh two-factor code and the typed address.
- Owners' invoice and payment routes check `billing.read` and the active store; another store's invoice is a 404.
- The platform IPN settles only on SSLCommerz's validation of our own account: BDT, the exact amount due, the invoice in `value_a`, and a `val_id` never seen.
- The export link is an HMAC over the job and its expiry, compared in constant time; the access log records only the route, never the query.
- Workflow inputs reach scripts through `env`, never interpolated into a shell.
- The jobs, backup and restore logs carry ids and counts, never names, phones or emails.
- The new emails go through the template renderer, which escapes every value.
- The legal templates fill store settings in as text nodes only.
- The terms page fetched for its hash must be on the platform's domain, with redirects not followed.

### Tests

| Package | Tests |
| --- | --- |
| `shared` | 354 (Phase 5A: 335) |
| `db` | 883, 88 skipped (864, 90 skipped) |
| `core` | 236 (199) |
| `providers` | 50 (45) |
| `api` | 185 (162) |
| `admin` | 18 (18) |
| `storefront` | 27 (27) |
| `scripts` | 23 (9): exports, the purge (criterion 3), resets, backups and the restore check |

**E2E, local:** all 27 pass at a phone and a desktop viewport, including the new onboarding, billing and closing flow, with axe and the CSP check on every new screen.

## 3. Measurements

From a local build of this branch.

| Measure | Result | Budget |
| --- | --- | --- |
| API Worker | 966 KiB gzip (Phase 5A: 918) | 3 MiB (31%) |
| Storefront Worker | 331 KiB gzip (365) | 3 MiB (11%) |
| Admin, JavaScript before sign-in | 133 KiB (129) | 150 KiB (89%, CI warns above 85%) |

**The load test** (`pnpm --filter @managemind/scripts load`) sends about 3,000 shopper-shaped requests (catalog pages, carts and a few COD checkouts) and reports status codes, latency percentiles and, given the Workers' names, their CPU time from Workers Logs. A local run against `wrangler dev` checked the script: 52 pages, 21 cart calls and 2 checkouts, with no errors (p50 118 ms). **Its one run on a preview hasn't happened yet** (§5).

## 4. Free-tier impact

As planned (plan §11). Exports, purges, resets, backups and the restore test run in GitHub Actions, about 150 minutes a month, and use no Worker CPU or Hyperdrive queries. The daily rollup and health add a few hundred Hyperdrive queries a day. Previews no longer use production's Hyperdrive queries, except in the CPU step.

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **The real plans and prices** (Q5) and **our invoice details** (Q8): legal name, address, trade license, BIN and VAT rate, bank account and bKash number. Both are needed before the first invoice.
2. **The support email, WhatsApp number and abuse address**, entered under Platform → Terms after the deploy.
3. **The backup keys** (Q15): make the pair once with `age-keygen -o backup.key` (ADR 0028). The public key (`age1…`) goes in the `BACKUP_AGE_RECIPIENT` variable, the whole key file in the `BACKUP_AGE_KEY` secret, and a copy offline. Until then, the nightly backup and the restore test skip with a warning, and Neon's own history is the only backup.
4. **Optionally, `GITHUB_DISPATCH_TOKEN`** (Q10), so jobs start at once rather than at the daily run.
5. **Phase 5A's keys in production:** `CREDENTIALS_KEY` (with an offline copy), `VAPID_PRIVATE_KEY` and `VAPID_PUBLIC_KEY`.
6. **Our SSLCommerz account** (`PLATFORM_SSLCOMMERZ_*`), for invoices paid online. Until then, payments are recorded by hand.
7. **Workers Paid** when the first pilot client signs (Q2).
8. **A local legal review** of the four legal page templates, and the signed platform terms.
9. **A person who has never used the admin**, to onboard the first pilot client for criterion 1.
10. **The load test's one run on a preview.** It sends about 3,000 requests to a deployed preview, so it waits for your go-ahead.

### Not built yet, or smaller than planned

- **The purge E2E stops at the dry run.** Previews have no jobs runner; the integration test covers the purge.
- **The preview's SSLCommerz sandbox payment script** and the IPN's CPU step still wait for the sandbox credentials (Phase 5A, §5).
- **`usage_daily` keeps every day.** The plan's 13-month retention is a follow-up; the table grows by one row per store a day.
- **`CREDENTIALS_KEY` can't be rotated** without re-entering every store's credentials. The runbook says so.
- **CI runs `pg_dump` and `pg_restore` 18 from the `postgres:18` image** for the backup tests. This couldn't be run locally (no Docker daemon), so the first CI run checks it.

### Decisions that differ from the plan

- **Support staff see no export links** (the security review).
- **Reopening a store cancels a pending purge**, and the runner checks the approval against the store's last closure.
- **The admin's security headers live in its `_headers` file**, since its pages are static assets.

### Lessons for later phases

- **Check a destructive job's conditions when it runs, not only when it's asked for.** The purge's approval outlived the closure it approved.
- **Every export needs a deny list that a test checks against the schema.** A new table with a secret column fails the test instead of leaving in a zip.
- **Static assets skip the Worker.** Headers set in middleware never reach them.
