# managemind

Multi-tenant commerce platform for Bangladeshi SMEs on Cloudflare Workers and Neon Postgres.

- Plan: [`docs/PLAN.md`](docs/PLAN.md)
- Status: Phases 0–4 are done. Phases 5A and 5B are built and deployed; online payment, SMS, push, backups and online invoice payment wait for their keys. Phase 5C, the admin redesign, is built and deployed. Phase 6, sales recovery, is built and deployed. Phase 7, couriers, is built and deployed; its adapters wait for courier credentials, and production for `CREDENTIALS_KEY`. Phase 8, the back office, is approved and being built: purchasing and stock counts are done, expenses and the reports follow ([plans and reports](docs/phases/))
- Decisions: [`docs/adr/`](docs/adr/)

## Development

Requirements: Node 22.12+, pnpm 10, Postgres 18.

In a Claude Code cloud session, `.claude/hooks/session-start.sh` installs and starts Postgres 18, creates the databases, sets `DATABASE_URL` and `TEST_DATABASE_URL`, and installs dependencies (see [ADR 0008](docs/adr/0008-local-postgres.md)). Elsewhere, run Postgres 18 yourself and set those two variables.

```sh
pnpm install
pnpm lint        # Biome lint and format check
pnpm typecheck   # TypeScript in every package
pnpm test        # Vitest in every package
pnpm check       # all of the above

# Apply database migrations (uses DATABASE_URL_MIGRATIONS or DATABASE_URL)
pnpm --filter @managemind/db db:migrate
# Add the two demo stores (demo-fashion, demo-grocery); safe to rerun
pnpm --filter @managemind/db db:seed
# Local database for wrangler dev (migrate, seed, app login role with RLS on)
pnpm --filter @managemind/db db:dev-setup
# Run the API locally on :8787 (add --test-scheduled to trigger the cron at /__scheduled)
pnpm --filter @managemind/api dev
# Run the storefront on :4321, calling the local API (start the API first)
pnpm --filter @managemind/storefront dev
# After changing packages/db/src/schema: generate a migration, then review the SQL
pnpm --filter @managemind/db db:generate --name <change>
```

## Platform CLI

`pnpm platform <command>` runs against `DATABASE_URL` locally. In production, run the same commands through the **Platform** workflow (`.github/workflows/platform.yml`), so production credentials never leave GitHub:

| Command | Does |
| --- | --- |
| `tenant:create --slug acme --name "Acme" --owner-email a@b.c [--owner-name] [--locale bn\|en] [--setup plan=starter,billing-day=5,preset=grocery,kind=client,trial-ends=2026-12-31]` | Creates the store and its first Owner with the onboarding screen's options (phase-5b-plan §3.2), prints the admin and store URLs, and relays the events so the KV map fills at once |
| `plans:seed` | Adds the placeholder plans when there are none (provisioning runs it on every deploy) |
| `platform:grant-role --email a@b.c --role super_admin\|support\|none` | Creates the user if needed and sets or clears the platform role (audited; signs them out) |
| `kv:sync [--tenant <id>]` | Rewrites the KV host keys of every store, or one |

```sh
gh workflow run platform.yml -f command=platform:grant-role -f email=a@b.c -f role=super_admin
```

## CI

`.github/workflows/ci.yml` runs on every pull request and every push to `master`:

- **Lint, typecheck and test:** Biome, a check that every schema change has a migration, typecheck, all test suites (including the tenant isolation and catalog tests) against a `postgres:18` service container, and `pnpm audit --audit-level high`.
- **Build and bundle size:** builds the apps, then `node scripts/bundle-size.mjs apps/api apps/storefront` reads wrangler's dry-run gzip size: a warning at 2.5 MiB, a failure at 3 MiB ([ADR 0004](docs/adr/0004-bundle-size.md)).

A change to docs only skips the checks, and turbo's cache is kept for a week, so unchanged packages aren't tested again: the repository has 2,000 free Actions minutes a month for every workflow. A push to a pull request costs about 10 of them and a `full-preview` run about 37; `docs/runbooks/free-tier-limit.md` says what stops when they run out.

Dependency updates come from Renovate (`renovate.json`): one weekly group for minor and patch updates, held for 3 days after release.

## Previews

`.github/workflows/preview.yml` gives every pull request its own Workers, `managemind-api-pr-<n>` and `managemind-storefront-pr-<n>` on workers.dev. It runs the Playwright smoke test (`e2e/`) against them and posts the URLs in a PR comment. Open a demo store with `?store=demo-fashion` or `?store=demo-grocery`.

- **Database:** the shared Neon branch `preview`. Add the `db-branch` label for the PR's own branch `pr-<n>`, which you need when the PR changes migrations.
- **Queues:** each preview consumes its own outbox queue, `managemind-outbox-pr-<n>`, and import queue, `managemind-imports-pr-<n>` (with its dead-letter queue), so notifications and spreadsheet imports run on previews too.
- **Connection:** previews connect to their Neon branch directly, as the PR's own role, so the smoke tests and trying a preview by hand use none of the account's 100,000 Hyperdrive queries a day. A full run goes through Hyperdrive, then back ([ADR 0011](docs/adr/0011-previews.md), amended Oct 23 and Oct 25).
- **What runs:** a preview runs the smoke tests only, and a docs-only PR gets none. The `full-preview` label adds the E2E flows, Lighthouse and the CPU step, through Hyperdrive while today's count leaves room. Past that, the E2E flows and Lighthouse run on the direct connection, without the CPU step. Adding `narrow-preview` as well limits the E2E to the smoke tests and the specs the PR adds, for a phase whose whole suite outgrows the Free plan's CPU allowance.
- **Cleanup:** closing the PR deletes its Workers, its import queues and its own branch ([ADR 0011](docs/adr/0011-previews.md)).

Run the smoke test against local Workers (both `wrangler dev` servers running):

```sh
API_URL=http://localhost:8787 STOREFRONT_URL=http://localhost:4321 EXPECT_ENVIRONMENT=development \
  pnpm --filter @managemind/e2e e2e
```

## Production

`.github/workflows/deploy.yml` deploys `master` after CI passes on it.

1. It provisions and migrates: queues, KV, R2 buckets with lifecycle rules, then the migrations, then the `mm_app` role and its Hyperdrive config. This is idempotent (`scripts/production/provision.ts`).
2. It uploads source maps to Sentry, then deploys `managemind-api`, then `managemind-storefront`.
3. It smoke-tests `/health`, `/health/deep` and the storefront.

- **Without deploying:** `provision.yml` runs step 1 by hand, and can rotate the `mm_app` password.
- **Secrets and variables:** see the table below. A missing optional one never fails the deploy: it warns and leaves its feature off.
- **Domains:** the `PLATFORM_DOMAIN` and `STORE_DOMAIN` repository variables (`managemind.site` and `managemind.store`) put the admin on `admin.managemind.site`, webhooks and health checks on `api.managemind.site`, and every store on `<slug>.managemind.store`.
- **When a deploy goes wrong:** follow [docs/runbooks/rollback.md](docs/runbooks/rollback.md).

| Name | Kind | Needed for | Without it |
| --- | --- | --- | --- |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Secret, variable | Every deploy and workflow | Nothing deploys |
| `DATABASE_URL_MIGRATIONS` | Secret | Migrations, provisioning and the Platform CLI | Nothing deploys |
| `AUTH_SECRET` | Secret | Staff and shopper sessions; never regenerated, since a new one signs everyone out | The API deploy stops |
| `RESEND_API_KEY` | Secret | Staff email, and shopper email until Brevo's key exists ([ADR 0014](docs/adr/0014-email-provider.md), [ADR 0022](docs/adr/0022-shopper-email.md)) | The API deploy stops |
| `BREVO_API_KEY` | Secret | Shopper email from `managemind.store` | Shopper email goes through Resend from `managemind.site` |
| `CF_STORE_TOKEN` | Secret | Page cache purges and custom domains ([ADR 0018](docs/adr/0018-page-tags-and-purges.md), [ADR 0019](docs/adr/0019-custom-domains.md)) | Store pages aren't cached, and custom domains are off |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Variable, secret | Turnstile on checkout, sign-in and return requests ([ADR 0023](docs/adr/0023-turnstile-hostnames.md)) | Rate limits alone |
| `CREDENTIALS_KEY` | Secret, **with a copy kept offline** | Stores' SSLCommerz, SMS and email credentials ([ADR 0024](docs/adr/0024-credentials-vault.md)) | Online payment and SMS are off |
| `PLATFORM_SSLCOMMERZ_STORE_ID`, `PLATFORM_SSLCOMMERZ_PASSWORD` | Variable, secret | Stores paying our invoices online, on our own SSLCommerz merchant account (phase-5b-plan §3.7) | Stores pay by bank, bKash or Nagad, and a super admin records it |
| `GITHUB_DISPATCH_TOKEN` | Secret: a fine-grained token with Actions read and write on this repository only | Starting the Store jobs workflow when an export is asked for ([ADR 0027](docs/adr/0027-store-jobs-in-actions.md)) | Exports start with the workflow's daily run, at 02:37 in Dhaka |
| `BACKUP_AGE_RECIPIENT`, `BACKUP_AGE_KEY` | Variable, secret, **with a copy of the key kept offline** | The nightly encrypted backup and its monthly restore test ([ADR 0028](docs/adr/0028-backups.md)); make the pair with `age-keygen -o backup.key` | No backups beyond Neon's own history |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Variable, secret | Web push to the admin | Staff alerts by email only |
| `SENTRY_AUTH_TOKEN` | Secret | Source maps in Sentry | Source maps aren't uploaded |
| `NEON_API_KEY`, `NEON_PROJECT_ID` | Secret, variable | Previews' database branches and the usage alarm | No previews, no Neon numbers in the alarm |
| `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `PATHAO_USERNAME`, `PATHAO_PASSWORD`, `REDX_TOKEN` (and `PATHAO_MODE`, `REDX_MODE` variables, `sandbox` or `live`) | Secrets | The weekly **Courier areas** workflow: the platform's own Pathao and RedX accounts fetch their area lists ([ADR 0030](docs/adr/0030-couriers.md)) | That courier's areas aren't fetched, and its bookings ask staff to pick the area |

`pnpm --filter @managemind/scripts keys` prints a new `CREDENTIALS_KEY` and VAPID pair to copy. Make them once: a new `CREDENTIALS_KEY` makes every saved store credential unreadable. Previews use `CREDENTIALS_KEY_PREVIEW` and `AUTH_SECRET_PREVIEW` when they are set, and fresh keys for each deploy otherwise.

## Errors

Sentry receives errors from the API, the storefront and the admin, in production and previews. The organization and the three projects' DSNs are in `scripts/sentry.json` (DSNs are not secrets); the deploy workflows pass them to the Workers and the admin build. Local development and tests send nothing. Only errors are sent, with no personal data, headers, cookies, query strings or bodies, and no tracing.

## Usage alarm

`.github/workflows/monitor.yml` runs every day at 02:07 UTC (08:07 in Dhaka). `scripts/monitor/usage.ts` checks the last 24 hours:

- **CPU:**
  - any request stopped for CPU or memory on `managemind-api` or `managemind-storefront` (the trigger to move to Workers Paid, ADR 0013);
  - API p99 CPU above 250 ms, and storefront p90 above 100 ms, on requests only. These are judged only on days with at least 200 requests (ADR 0003, amended Oct 16).
  - Import chunks stopped for CPU are reported but don't raise the alarm; the queue retries them (phase-2-report §3).
- **Free-plan limits:** Worker requests, Hyperdrive queries, queue operations, KV writes, and Neon compute and storage, each above 70%.

On an alarm the run fails and opens (or comments on) a **Usage alarm** issue assigned to the repository owner. Close the issue once it's handled. To check the notification, run the workflow by hand with *test* checked.
