# Phase 5B plan — Launch readiness and pilot

- Status: Draft (Oct 23), waiting for the owner's answers in §14
- Date: 2026-10-23
- Scope: PLAN.md "Phase 5B — Launch readiness and pilot", plus what Phase 5A left open: the preview's SSLCommerz sandbox payment script, the CPU step's new routes (IPN, return request, refund), a Lighthouse run of the tracking page, the decision on previews without Hyperdrive, and the Workers Paid switch before the first client (phase-5a-report §5, ADR 0013)

## Goal

Everything needed to run real clients as a business, then the pilot:

- **Onboarding without a developer.** A super admin creates a store, invites its owner, picks a plan, address and theme preset, and follows a checklist of what's missing. A health view shows each store's payment, email, SMS and domain status.
- **Our own billing.** Plans with limits and features, daily usage metering, invoices for setup fees, monthly plans and overage, payments by bank transfer, bKash or an SSLCommerz link, reminders, and suspension and reactivation by the existing store lifecycle.
- **Clean exits.** Close a store, give the client an export of everything that is theirs, and purge it after the grace period, with proof that nothing is left. Anonymize one shopper on request. Reset demo and test stores.
- **A safe pilot.** Nightly encrypted backups outside Neon with a monthly restore test, legal page templates, a security review, a load test, and runbooks.

Three acceptance criteria, from PLAN.md:

1. A non-developer onboards a new store through the super-admin screen in under an hour, excluding the client's own gateway approvals.
2. Pilot clients take real orders for four weeks with no cross-tenant incident and no lost orders, still on $0 infrastructure.
3. Purging a seeded test store leaves zero store rows and files for it, leaves the other tenants untouched, and keeps its platform record and billing history.

Criterion 2's "$0 infrastructure" meets ADR 0013's trigger, "the first serious client". Q2 asks the owner to choose between the two before the pilot starts.

**Estimate: about 4 weeks of build, then the 4–6 week pilot** (Q1). PLAN.md says 2–3 weeks. The extra week is export and purge, which must run outside the Worker (§3.9), and Phase 5A's follow-ups. The order inside the phase (§12):

1. the platform data and lifecycle changes that everything else uses;
2. onboarding, health and the dashboard, which a non-developer needs first;
3. plans, entitlements and usage, then invoices and payments;
4. export, purge, anonymization and reset;
5. backups, legal templates, runbooks, the load test and the security review last, right before the pilot.

## 1. Prerequisites status

| Item | Status |
| --- | --- |
| Phase 5A | Merged and deployed (#60, Oct 23). **Production has none of its keys yet:** without `CREDENTIALS_KEY`, `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, online payment and SMS stay off and push isn't offered (phase-5a-report §5). **Needed before the pilot, not before building** |
| Final plans, prices and limits | **Open** (Q5). Plans are data that a super admin edits (§3.5), so the build uses placeholder plans. **Needed before the first invoice** |
| Our invoice details: company name, address, VAT registration if any | **Open** (Q8). **Needed before the first invoice** |
| Our SSLCommerz merchant account, and bKash or bank details for subscription payments | **Open.** The merchant account needs the trade license and can take weeks. Bank and bKash details go on the invoice. Invoices work without the merchant account: payments are recorded by hand, and the payment link stays off (§3.7). **Not blocking** |
| Signed legal documents: platform terms, privacy policy, data processing agreement | **Open.** The build adds terms versions and acceptance (§3.4), and drafts the store legal page templates (§3.13) for the legal review. **Needed before the pilot** |
| Support email, support WhatsApp number and abuse address | **Open.** They go in the admin's help menu, the platform terms and the store legal templates. **Needed before PR 15** |
| A backup encryption key stored safely offline | **Open, small.** PR 16 has a script that makes an `age` key pair (§3.14). The owner adds the public key as a repository variable and the private key as a secret, **and keeps a copy offline**. **Needed before PR 16** |
| Two or three signed pilot clients with their live SSLCommerz accounts | **Open.** Their SSLCommerz approval takes weeks, so they should apply now. A pilot client without one starts on cash on delivery. **Needed for the pilot** |
| A Bangla help guide for clients | **Open.** The owner's content: short articles or videos on using the admin. The admin's help menu links to it (§7). **Needed for the pilot** |
| Carried from Phase 5A | **Open:** the SSLCommerz sandbox credentials (for the preview's payment script, PR 2), an SMS gateway test account, the Brevo key, and SSLCommerz's answer on refunds without a fixed IP. **Not blocking this phase** |
| New: a token to start GitHub workflows | **Open** (Q10). A fine-grained token with only Actions: write on this repository, as the Worker secret `GITHUB_DISPATCH_TOKEN`, lets the platform screen start an export or purge at once. Without it, the jobs start at the next daily run. **Not blocking** |

## 2. Research: what is borrowed

| From | What |
| --- | --- |
| Shopify | A store's plan decides its features, and a downgrade never breaks the storefront: features the plan no longer has stay on until a staff member changes them. Charges show on the store's own billing page with invoices to download. Closing a store keeps its data for a period before it is removed, and the shopper redact request (`customers/redact`) removes one customer's personal data while keeping order totals for the store's accounts |
| Stripe Billing | A subscription has a plan, a billing anchor day and statuses (`active`, `past_due`, `canceled`). Invoices are drafts, then finalized with a number that never changes, then paid or void. Usage is reported as records and summed at invoice time. Dunning is a schedule of reminders and a final action |
| Chargebee and Lago (open-source billing) | Entitlements are a typed list of limits and feature flags attached to a plan, with per-customer overrides. Metering is a daily rollup of usage events, not a query at invoice time |
| Medusa, Vendure, Saleor | None of them bill their merchants, so nothing is borrowed for billing. Saleor's data export is a background job that writes a file and emails a link, which is the model for §3.10 |
| Neon, PlanetScale and Supabase docs | A logical dump (`pg_dump -Fc`) from outside the provider is the standard independent backup. A backup that was never restored is not a backup, so restores are tested on a schedule |
| `age` (file encryption) | Encrypting to a public key lets the nightly job encrypt without being able to decrypt. Only the restore test and the owner hold the private key |
| Bangladesh | Small businesses pay by bank transfer and bKash more than by card. Our invoices are in BDT. A VAT-registered company issues Mushak 6.3 for its own sales; whether our company must is for the accountant (Q8) |
| What we simplify | No proration: a plan change takes effect on the next invoice. No automatic card charges: every invoice is paid by the client. No self-service sign-up. Exports are a zip of JSON and CSV; importing one into a dedicated database is not built yet. One currency (BDT) |

## 3. Design decisions to approve

### 3.1 Store kinds and the lifecycle

- **`platform.tenants.kind`:** `client` (default), `demo` or `test`. Demo and test stores never get invoices and can be reset (§3.12). The two demo stores become `demo`. E2E and preview stores are `test`.
- **The machine** (`tenantLifecycle`) gains what Phase 1 declared:
  - `active → suspended` and `suspended → active`, as now. A suspension records its reason: `overdue` (set by billing, §3.8), `abuse`, `client_request` or `other`. Paying an overdue invoice reactivates only an `overdue` suspension.
  - `active | suspended → closed`: super admin, typed slug, reason. It sets `closed_at` and `purge_after` (30 days later, Q11) and starts the export (§3.10).
  - `closed → active`: **reopen**, super admin, before the purge. Mistakes happen, and the data is still there (Q11).
  - `closed → purged`: only through the purge job (§3.11), only after `purge_after`, except for `test` and `demo` stores.
- **While closed:**
  - the storefront answers `410` with a "this store has closed" page in both languages;
  - staff can't open the store in the admin;
  - the owner keeps the export link that was emailed to them;
  - the store's custom domains are removed from Cloudflare for SaaS at once, so the client can point them elsewhere.
- **While suspended, as now:** the storefront shows the maintenance page (503) and admin writes answer `423 tenant_suspended`.
- **Every move** writes `tenant.status_changed` and a platform audit entry, as now.

### 3.2 Onboarding

The super admin's **New store** screen replaces the CLI for everyday onboarding. The CLI stays for automation and gains the same options.

1. **Store:** name, address (`<slug>.managemind.store`, checked live for `slug_taken` and `slug_reserved`), default language, kind.
2. **Owner:** email and name, as `tenant:create` takes them today. New: the owner gets a welcome email with the admin's address and the store's address, and signs in with an emailed code as now.
3. **Plan:** a plan (§3.5), an optional negotiated price, the billing day, the setup fee, and an optional free trial end date (Q6).
4. **Look:** a theme preset (fashion, grocery or general). The store starts with the preset's colors and homepage sections.
5. **Defaults filled in one transaction**, as `createTenant` does now, plus:
   - one delivery zone set for inside Dhaka, Dhaka suburbs and outside Dhaka, with placeholder fees for the owner to change;
   - the store legal pages as drafts, from the templates (§3.13);
   - the Phase 5A return policy defaults.

**The setup checklist** is on the store's platform page and on the owner's admin dashboard. Each item is computed from the store's own data, so it is never out of date:

| Item | Done when |
| --- | --- |
| Store profile | Business name, address and contact phone are set |
| Logo and colors | A logo is uploaded |
| Products | At least one active product with stock |
| Delivery zones | Every zone has a fee, and the placeholders were changed |
| Payments | Cash on delivery is on, or SSLCommerz is saved and checked |
| Legal pages | Terms, privacy, returns and delivery are published |
| Email | Shopper email works: the platform sender, or the store's own key checked |
| SMS | Optional: a gateway saved and checked |
| Domain | Optional: a custom domain active, or the subdomain chosen as final |
| Terms | The owner accepted the current platform terms (§3.4) |

A store can open with optional items missing. The super admin sees every store's checklist progress in the store list.

### 3.3 Store health and the platform dashboard

- **The rule from Phase 1 stays: platform routes read platform tables, never the store schema.** The daily job writes what the platform screens need into platform tables (§3.6), so a super admin's screen is a few queries, whatever the number of stores.
- **Health per store** (`platform.store_health`, one row per store, written by the daily job and by the events below):
  - payments: SSLCommerz mode and last check result, payments pending too long;
  - email: the sender in use, failed messages in the last 24 hours, the share of the platform quota used;
  - SMS: the gateway, the last balance seen, failed messages;
  - domain: each custom domain's status and certificate;
  - activity: the last order, the last staff sign-in.

  Saving credentials (`credentials.checked`) and domain changes (`domain.status_changed`) update their part at once. A **Refresh** button on one store runs the same checks for that store only.
- **The platform dashboard** (`/platform`):
  - active, suspended and closed stores; stores in setup (checklist incomplete);
  - orders and sales across stores: yesterday, this month, and a 30-day trend, from the daily rollups (§3.6);
  - resource use per store: products, orders this month, emails this month, storage, custom domains;
  - **free-tier use against each limit**, with a warning at 70%: the daily usage alarm (`scripts/monitor/usage.ts`) already reads every number. It writes its results to R2 as `platform/usage/latest.json`, which the dashboard reads. That costs no database query and keeps the alarm the single source (Q12);
  - money: invoices overdue, due this week, and paid this month.
- **Dead letters:** the dashboard shows the import and outbox dead-letter counts from the same file. Retrying stays the existing commands.

### 3.4 Terms acceptance

- **`platform.terms_versions`:** a version label, the date it takes effect, the URL of the published text on `managemind.site`, and a SHA-256 of that text, so a change to the text is a new version.
- **`platform.terms_acceptances`:** store, user, version, time, IP address and user agent. Append only.
- **When an owner opens the admin** and their store's owners haven't accepted the current version, they see the terms with **Accept**. Until one owner accepts, the owners' admin is read-only. Managers, staff and shoppers are never blocked (Q7).
- **A new version** gets a notice period: the super admin sets its effective date, and owners are asked from the day it is published. The block starts on the effective date.
- **Onboarding** counts acceptance as a checklist item (§3.2).

### 3.5 Plans and entitlements

- **`platform.plans`:** a code, the name in Bangla and English, the monthly price, the setup fee, whether it is offered, and its **entitlements**: typed JSON validated by a zod schema in `shared`, like store settings.
  - **Limits:** products, staff accounts, orders a month, emails a month, storage in MB, custom domains.
  - **Features:** SSLCommerz, SMS, shopper accounts, each promotion type (coupons, automatic, buy X get Y, free delivery), reports, custom email key.
- **A store's subscription** (`platform.subscriptions`): the plan, an optional price override, an optional entitlement override (for example "10 more staff for this client"), the billing day (1–28), the trial end, and a status (`trialing`, `active`, `past_due`, `cancelled`).
- **Effective entitlements** (plan + override) are written to `platform.tenants.entitlements` whenever the subscription changes. Admin and store requests already read the tenant row to check its status, so checking a limit adds a column, not a query.
- **Where they are checked:** in the core services, next to the permission checks. The route layer shows the result.

| Kind | Rule | Example |
| --- | --- | --- |
| Hard limit, for staff | Refused with `plan_limit` (402) and an upgrade message in the admin | Creating product 501 on a 500-product plan; inviting staff 6 of 5; adding a second custom domain |
| Soft limit, for shoppers | **Never refused.** Counted, warned at 80% and 100% on the owner's dashboard, and billed as overage when the plan has an overage price | Orders a month, emails a month, storage |
| Feature | A setting that needs the feature can't be turned on. A setting already on stays on after a downgrade, and the admin shows "not in your plan" until it is changed | SSLCommerz on a plan without it; buy X get Y promotions |

Shoppers never see a plan limit (PLAN.md). Storage is checked when an upload starts, against the last daily rollup plus that day's uploads.

### 3.6 Usage metering

- **The daily job** (the existing 23:47 UTC batch) rolls up yesterday per store into `platform.usage_daily` (store, day, metric, value):
  - orders placed, and their total;
  - emails and SMS sent, from the delivery log;
  - storage: the sum of media and return photo sizes in the database, not an R2 listing;
  - products, staff accounts and active custom domains, as counts at the end of the day.
- **It also writes** `store_health` (§3.3) in the same pass. One store's rollup is about 10 queries, so 10 stores add about 100 Hyperdrive queries a day.
- **Monthly totals** for invoices and the owner's usage meters are sums of the daily rows. A day that failed is filled in the next night, since every row is keyed by store, day and metric.
- **Retention:** daily rows are kept for 13 months, then summed into a monthly row. Billing history stays in the invoices.

### 3.7 Invoices and payments

- **`platform.invoices`:** a number (`INV-2026-0001`, one platform sequence, never reused), the store, the period, the status, the issue and due dates, the totals, and a snapshot of our invoice details and the client's billing details.
  - **Statuses:** `draft → issued → paid | void`. `issued` shows as overdue after the due date (derived, like delivery status).
  - **Lines** (`platform.invoice_lines`): `setup`, `plan`, `overage` or `adjustment`, with the quantity, unit price and amount in poisha.
  - **VAT** is a line on the invoice when our company is VAT-registered (Q8). The rate and registration number are platform settings, snapshotted on each invoice.
- **Generation:** on each store's billing day, the daily job drafts the invoice: the coming month's plan, last month's overage, and the setup fee on the first one. Drafts are issued automatically after 2 days, so a super admin can correct one first (Q9). Demo and test stores are skipped.
- **Payments** (`platform.billing_payments`): the amount, method (`bank`, `bkash`, `nagad`, `cash`, `sslcommerz`), reference, date and who recorded it. One payment can pay one invoice in full or in part; an invoice is `paid` when payments cover it.
- **The SSLCommerz link** uses our own merchant account, from the platform secrets `PLATFORM_SSLCOMMERZ_STORE_ID` and `PLATFORM_SSLCOMMERZ_PASSWORD`. It reuses Phase 5A's session and `settleGatewayPayment` validation with the IPN at `/v1/webhooks/sslcommerz/platform`. It stays off until the merchant account exists.
- **The client sees** Settings → Plan and billing: the plan, usage meters, invoices to view and print, how to pay (bank and bKash details, or the payment link), and the payments recorded.
- **Invoices are emailed** to the owners from `managemind.site`. That is a few emails a month on Resend's 100 a day.

### 3.8 Reminders, grace and suspension

The daily job sends the reminders and takes the steps, with a platform audit entry for each (Q9):

| Day | Step |
| --- | --- |
| Due − 3 | Reminder email to the owners, and a banner in the admin |
| Due date | Reminder |
| Due + 3 | Reminder; the subscription becomes `past_due` |
| Due + 10 | Final notice: "your store will be suspended on …" |
| Due + 14 | **Suspended**, reason `overdue`: the storefront shows the maintenance page and the admin is read-only, except Settings → Plan and billing |

- **Recording a payment** that leaves no overdue invoice reactivates an `overdue` suspension at once, and the subscription goes back to `active`.
- **A super admin can hold the steps** for one store (for example "paying next week, agreed by phone"), with a reason and an end date.
- **Closing for non-payment** is never automatic. It's a super admin's decision through §3.1.

### 3.9 Where export and purge run

- **Export and purge run in GitHub Actions, not in the Worker** (Q10).
  - A big store's export reads every row and zips files. On the Workers Free plan that would be stopped at 10 ms CPU over and over (phase-2-report §3: a 500-product import took about 50 minutes).
  - In Actions, a Node script connects straight to Neon with the migration role, as the Platform workflow does today. That costs no Hyperdrive queries and has no CPU limit.
  - Production credentials still never leave GitHub (README, Platform CLI).
- **How a job starts:**
  1. The platform screen writes a job row (`platform.tenant_jobs`: kind `export`, `purge` or `reset`, status, who asked, progress).
  2. The Worker starts the `tenant-jobs.yml` workflow through GitHub's API with `GITHUB_DISPATCH_TOKEN`.
  3. Without the token, or when GitHub doesn't answer, the workflow's daily schedule picks up pending jobs.
- **The job writes its progress** to its row, which the platform screen shows. A job that stops (a runner lost, a timeout) is resumed by the next run from its last finished step.
- **Actions minutes:** a private repository has 2,000 free minutes a month. A store's export or purge takes a few minutes, and the daily schedule exits within a minute when nothing is pending.

### 3.10 Export

- **What's in it:**
  - `manifest.json`: the store, the export's time, the schema version (the last migration), each table's row count and each file's SHA-256;
  - `tables/<table>.jsonl` for every table in `STORE_TABLES` (`packages/db/src/registry.ts`), plus the store's platform rows (tenant record, domains, memberships, without staff sign-in data);
  - `csv/<table>.csv` for the tables a person opens: products, variants, customers, orders, order lines, payments, refunds and returns;
  - `files/`: every object under `tenants/<id>/` in R2.
- **The format is the one a later dedicated-database move reads** (PLAN.md). Rows are written in reverse purge order, so they can be inserted in that order. The import tool itself is not built in this phase.
- **Where it goes:** `exports/<tenant>/<job>.zip` in R2. The existing lifecycle rule deletes it after 7 days.
- **The link:** `GET https://api.managemind.site/v1/exports/<job>?token=…`. The token is an HMAC over the job and its expiry (7 days), checked in constant time. The Worker streams the file from R2, which costs little CPU. The owner gets the link by email.
- **When:** on close (§3.1), and on request by an owner from Settings at any time, at most once a day (Q13).
- **Personal data:** shoppers' names, phones and addresses are in the export, because they are the client's records. The email says so, and the data processing agreement covers it.

### 3.11 Purge

The super admin's **Purge** action on a closed store, after `purge_after`:

1. **Dry run.** The job counts the store's rows in every `store` table, its R2 objects, its KV keys, its custom hostnames and Turnstile hostnames, its memberships, and the staff accounts that belong to no other store and have no platform role. The report is saved on the purge record (`platform.tenant_purges`).
2. **Approval.** The super admin reads the report, types the store's slug, and confirms with two-factor login. That is recorded with the report.
3. **Delete, resumable:**
   - `store` rows in `STORE_TABLES` order, at most 1,000 rows per transaction, with progress saved after each batch;
   - the R2 prefix `tenants/<id>/`, and its exports once the export link has expired;
   - KV keys with the store's prefix, custom hostnames at Cloudflare for SaaS, and Turnstile hostnames;
   - stored credentials, which are `store` rows (Phase 5A's vault);
   - platform rows as `PLATFORM_TENANT_ROWS` says: memberships, invitations and domains deleted, sessions cleared, support grants and the audit log kept;
   - staff accounts that belonged only to this store, with their sessions and two-factor secrets.
4. **Queue messages:** Cloudflare Queues can't delete one store's messages. Instead, every consumer (outbox, notifications, imports, purges, domains, payment checks) gains a check of the store's status before it acts: a message for a closed or purged store is acknowledged and dropped, with a log line.
5. **Verification:** zero rows for the store in every `store` table, zero objects under its R2 prefix, and zero KV keys. The result is saved on the purge record, and the store becomes `purged`.

**What stays** (PLAN.md): the tenant record marked `purged`, the subscription, invoices and payments, usage rows, terms acceptances, the platform audit log, and the purge record with who approved it, when, and the counts.

### 3.12 Store reset

- **For `demo` and `test` stores only.** The same job as a purge, with two differences: the tenant record, its memberships and its settings stay, and nothing waits for a grace period.
- **Then reseed:** the defaults from `createTenant`, and for demo stores the sample catalog (`scripts/demo/catalog.ts`) plus about 30 sample orders across the last month in every status.
- **The weekly job** resets `demo-fashion` and `demo-grocery` every Friday morning in Dhaka, through the same workflow. A super admin can also reset one by hand.
- **Preview E2E stores** (`test`) are reset or purged by the preview teardown instead of piling up on the shared preview branch.

### 3.13 Shopper deletion requests

- **Who:** an owner or manager (`customers.delete`, a new permission), from the customer's page, after the shopper asked the store. There is no self-service request in this phase. The store's privacy page says how to ask.
- **What changes**, in one transaction:
  - the customer: name `Deleted customer`, phone and email replaced with a fixed placeholder that can never be a real number (a migration widens the phone check for it), `deleted_at` set;
  - the customer's addresses deleted;
  - the customer's orders: the name, phone, email and street in the snapshot replaced, keeping the district, zone and totals for the store's reports;
  - their shopper account, sessions and sign-in records deleted;
  - their delivery log rows deleted, and their return photos deleted from R2;
  - promotion codes limited to their phone (store credit) ended.
- **What stays:** order totals, lines, payments, refunds and the stock ledger, for the client's sales and tax records. The blocklist keeps a blocked phone's entry, since fraud prevention is a legitimate interest; the legal review confirms (Q14).
- **Audit:** a `customer.anonymized` entry without the old values.

### 3.14 Backups

- **Nightly** (`backup.yml`, 21:17 UTC, 03:17 in Dhaka, when stores are quiet):
  1. `pg_dump -Fc` of the Neon main branch, connecting directly (not through Hyperdrive), with Postgres 18's client;
  2. encrypt the dump with `age` to the public key in the `BACKUP_AGE_RECIPIENT` variable;
  3. upload it to R2 as `backups/daily/<date>.dump.age`, and on Sundays also to `backups/weekly/`. The existing lifecycle rules keep 7 daily and 4 weekly copies;
  4. write the size and a SHA-256 to the run's summary. A failure fails the run, which emails the repository owner.
- **Monthly restore test** (`restore-test.yml`, first Sunday):
  1. download the latest dump and decrypt it with the `BACKUP_AGE_KEY` secret;
  2. create a Neon branch `restore-test`, and restore into an empty database on it;
  3. check: every table exists, row counts are within a day's growth of production's, and the newest order is less than 48 hours old;
  4. delete the branch, and record the result in the run's summary.
- **Keys:** the nightly job holds only the public key, so a leaked runner can't read old backups. The private key is a secret for the restore test **and is kept offline by the owner**, with the copy of `CREDENTIALS_KEY` (Q15).
- **Size:** production's database is about 100 MiB on all branches, and a compressed dump of it is a small part of that. Eleven copies stay far below R2's free 10 GB.

### 3.15 Legal page templates

- **Per store:** terms of sale, privacy, returns, and delivery, in Bangla and English. They're filled from the store profile (business name, address, trade license, contact) and from the store's settings (the Phase 5A return policy, delivery zones and fees, payment methods).
- **Placeholders in the text** (`{store_name}`, `{return_days}` …) are filled when the page is rendered, so a settings change updates the page. The owner can edit the text; an edited page stops following the template, and the admin says so.
- **They're drafts until the owner publishes them,** and the legal review approves the templates' wording first. They follow Bangladesh's Digital Commerce Operation Guidelines on delivery times, refunds and what a store must display.
- **The platform's own documents** (terms, privacy, data processing agreement) are pages on `managemind.site`, linked from the terms acceptance (§3.4) and the admin's footer.

### 3.16 Runbooks

In `docs/runbooks/`, each a short page of steps with the commands:

| Runbook | Covers |
| --- | --- |
| `deploy.md` | What a deploy does, how to read its warnings, and what to check after |
| `rollback.md` | Exists; updated for migrations added since Phase 1 |
| `restore-backup.md` | Restoring a nightly dump to a Neon branch, checking it, and promoting it; or restoring one store's rows from it |
| `rotate-secret.md` | Every secret: what it protects, how to rotate it, and what breaks meanwhile. `CREDENTIALS_KEY` uses the vault's `key_version` |
| `provider-outage.md` | SSLCommerz, email or an SMS gateway down; couriers in Phase 7 |
| `free-tier-limit.md` | What happens when each limit runs out (the Oct 18 Hyperdrive outage), and the upgrade steps |
| `onboarding.md` | Onboarding a client, from the signed contract to the first order, for a non-developer |
| `offboarding.md` | Closing a store, the export, the grace period and the purge |

### 3.17 Who can do what

| Action | Permission | Roles |
| --- | --- | --- |
| Create stores, change plans and subscriptions, close, reopen, purge, reset | `super_admin` | Super admin |
| View the platform dashboard, store health and checklists | `support` | Super admin, support |
| Create, issue and void invoices; record payments; hold reminders | `super_admin` | Super admin |
| See their own plan, usage and invoices | `billing.read` (new) | Owner, manager |
| Accept the platform terms | (owner) | Owner |
| Request an export of their store | `settings.write` + owner | Owner |
| Anonymize a customer | `customers.delete` (new) | Owner, manager |

Purge and close also ask for a fresh two-factor code on the request itself, not only at sign-in.

### 3.18 New dependencies

- **None in the Workers.** Export and purge use Node's own `zlib` and a small zip writer in `scripts`, or the runner's `zip` command.
- **In GitHub Actions only:** the Postgres 18 client (`pg_dump`, `pg_restore`) from the PGDG apt repository, and `age` from Ubuntu's packages. Neither is an npm dependency.

## 4. Data model

| Change | Notes |
| --- | --- |
| `platform.tenants` | New `kind` (`client`, `demo`, `test`), `entitlements` (jsonb), `status_reason`, `closed_at`, `purge_after`, `purged_at`; the `plan` label is replaced by the subscription |
| `platform.plans` (new) | `code`, `name` (bn, en), `monthly_price`, `setup_fee`, `overage_prices` (jsonb), `entitlements` (jsonb), `offered` |
| `platform.subscriptions` (new) | `tenant_id` (unique), `plan_id`, `price_override`, `entitlement_override`, `billing_day`, `trial_ends_at`, `status`, `hold_until`, `hold_reason` |
| `platform.usage_daily` (new) | `tenant_id`, `day`, `metric`, `value`. Primary key (`tenant_id`, `day`, `metric`) |
| `platform.store_health` (new) | `tenant_id` (primary key), `checked_at`, `payments`, `email`, `sms`, `domains`, `activity` (jsonb each) |
| `platform.invoices`, `platform.invoice_lines` (new) | §3.7; the number from a platform sequence; `issuer` and `billed_to` snapshots |
| `platform.billing_payments` (new) | §3.7; `gateway_val_id` unique when the method is `sslcommerz` |
| `platform.reminders` (new) | `invoice_id`, `step`, `sent_at`. Unique (`invoice_id`, `step`), so a rerun never sends twice |
| `platform.terms_versions`, `platform.terms_acceptances` (new) | §3.4 |
| `platform.tenant_jobs` (new) | `tenant_id`, `kind` (`export`, `purge`, `reset`), `status` (`pending`, `running`, `succeeded`, `failed`), `requested_by`, `progress` (jsonb), `result` (jsonb), `file_key`, `started_at`, `finished_at` |
| `platform.tenant_purges` (new) | `tenant_id`, `job_id`, `dry_run` (jsonb counts), `approved_by`, `approved_at`, `deleted` (jsonb counts), `verification` (jsonb), `finished_at` |
| `PLATFORM_TENANT_ROWS` | The new platform tables are all `keep`, except `store_health` (`delete`) |
| `store.customers`, `store.orders` | The phone checks allow the anonymized placeholder (§3.13); `customers.anonymized_at` |
| Permissions | `billing.read`, `customers.delete` |
| Events | `tenant.closed`, `tenant.reopened`, `tenant.purged`, `subscription.changed`, `invoice.issued`, `invoice.paid`, `customer.anonymized` |

Platform tables have no RLS, as now: access is by grants, and every read of one store's rows filters by store in code (ADR 0009). `registry.test.ts` keeps failing CI when a store table is missing from `STORE_TABLES`, which the purge and the export both read.

## 5. Services

| Module | Does |
| --- | --- |
| `core/tenancy` | The lifecycle's close, reopen and purge moves; onboarding with plan and preset; the checklist |
| `core/billing` (new) | Plans, subscriptions, effective entitlements, `checkEntitlement`, invoice drafting and issuing, payments, the reminder schedule, holds |
| `core/usage` (new) | The daily rollup and health per store |
| `core/terms` (new) | Versions, acceptance, the owner's read-only rule |
| `core/customers` | `anonymizeCustomer` |
| `core/content` | Legal templates and rendering |
| `scripts/tenant-jobs` (new) | Export, purge, reset and verification, run by `tenant-jobs.yml` |
| `scripts/backup` (new) | The nightly dump and the restore test's checks |

## 6. API

### 6.1 Platform (`/v1/platform/*`)

- `POST /tenants`: gains the plan, subscription, preset and kind. `GET /tenants` gains checklist progress, health and billing status.
- `GET /tenants/{id}/checklist`, `GET /tenants/{id}/health`, `POST /tenants/{id}/health/refresh`.
- `POST /tenants/{id}/close`, `/reopen`, `/reset`; `POST /tenants/{id}/purges` (dry run), `POST /purges/{id}/approve`; `GET /jobs/{id}`.
- `GET /dashboard`.
- `plans` (list, create, update); `PUT /tenants/{id}/subscription`; `POST /tenants/{id}/subscription/hold`.
- `invoices` (list with filters, detail, create a manual one, issue, void); `POST /invoices/{id}/payments`.
- `terms` (list versions, publish one).

### 6.2 Admin (`/v1/admin/*`)

- `GET /billing` (plan, usage, invoices); `GET /billing/invoices/{id}`; `POST /billing/invoices/{id}/pay` (the SSLCommerz link).
- `GET /terms/pending`, `POST /terms/accept`.
- `POST /customers/{id}/anonymize`.
- `POST /exports` (the owner's request); `GET /exports`.
- `GET /setup` (the checklist for the dashboard).

### 6.3 Public

- `GET https://api.<platform domain>/v1/exports/{job}?token=…`: the download (§3.10).
- `POST /v1/webhooks/sslcommerz/platform`: invoice payments (§3.7).

The SDK gains all of these, as in earlier phases.

## 7. Admin screens

- **Platform → Dashboard:** §3.3.
- **Platform → New store:** the steps in §3.2, on one page on desktop and as steps on a phone.
- **Platform → Store:** the checklist, health with Refresh, subscription and invoices, lifecycle actions (suspend, reactivate, close, reopen, reset, purge), jobs with their progress, and the purge's dry-run report and approval.
- **Platform → Plans** and **Platform → Billing:** plans with their entitlements; invoices with filters (overdue, due this week, draft), recording a payment, holds.
- **Platform → Terms:** versions and how many owners accepted each.
- **Owner's dashboard:** the setup checklist until it's done; usage warnings at 80% and 100%.
- **Settings → Plan and billing:** §3.7.
- **Upgrade messages:** a `plan_limit` or missing feature shows what the plan allows and how to upgrade (contact us, with the support WhatsApp link).
- **The terms prompt** for owners (§3.4), and the read-only banner.
- **Customer page:** **Delete personal data**, with what it changes and what it keeps.
- **Settings → Store data:** request an export and see past ones.
- **Help menu:** the Bangla help guide, support email and WhatsApp.

Mobile first and loaded on demand, as before. The sign-in bundle stays under its 150 KiB budget.

## 8. Storefront

- **The closed store page:** `410`, both languages, no store content.
- **Legal pages** render the templates' placeholders (§3.15).
- **Nothing else changes for shoppers**, by design: no plan limit ever reaches a shopper (§3.5).

## 9. Performance and CPU

- **Entitlement checks** read the tenant row the request already loads, so they cost no query and almost no CPU.
- **The daily rollup** runs per store in the cron batch: about 10 small queries per store, the kind Phase 4's cron already runs.
- **Export, purge and backups** run in GitHub Actions against Neon directly, with no Worker CPU and no Hyperdrive queries.
- **The export download** streams from R2 through the Worker: I/O, not CPU.
- **The CPU step** adds Phase 5A's missing routes (the IPN, a return request, a refund) and the new admin billing page. **Lighthouse** adds the tracking page with the return form open, and the payment return page.

## 10. Tests

| Layer | Tests |
| --- | --- |
| Unit | Entitlement merging and checks (hard, soft, feature, downgrade); invoice drafting: plan, overage, setup fee, VAT line, rounding; the reminder schedule's days and the hold; the lifecycle's new moves and refusals; the checklist's rules; the export token; legal template rendering in both languages |
| Integration (Postgres with RLS) | Onboarding is all-or-nothing with plan, preset and defaults. Hard limits refuse with `plan_limit`, soft limits never refuse a checkout. The daily rollup is idempotent and fills a missed day. An invoice's reminders are sent once each, suspension happens at day 14, and a payment reactivates only an `overdue` suspension. Anonymization changes exactly the listed fields and keeps order totals, and `inventoryDrift` stays empty |
| Purge (criterion 3) | Seed three stores with every kind of row and file. Purge one. Zero rows for it in every `store` table and zero R2 objects under its prefix; the other two stores' row counts and files are unchanged; its tenant record, subscription, invoices, terms acceptances, audit entries and purge record remain. Stop the job halfway and rerun it: it resumes and the result is the same. A staff account in two stores keeps its other membership |
| Export | A seeded store's export has every `STORE_TABLES` table, row counts matching the manifest, valid CSVs and every R2 file with its hash |
| Isolation | The new admin endpoints join the suite. Store A can't see B's invoices, usage, exports or customers to anonymize. Support can read platform screens but can't change billing or lifecycle |
| Backup | The restore test itself, monthly in production. In CI: a dump of the test database, encrypted, decrypted and restored into another database, passes the same checks |
| E2E (preview, `full-preview`) | A super admin onboards a store through the screen, and its owner signs in, accepts the terms, sees the checklist and finishes it far enough to take a COD order. A plan limit shows its upgrade message. An owner sees an issued invoice, and a super admin records a payment. A test store is closed, its storefront answers 410, and it is purged with the dry run and the slug. Axe on every new screen |
| Load (once, before the pilot) | §11's budget: cached catalog pages, cart and checkout from a script in `scripts/load`, measuring stopped requests, p50 and p99 CPU, and errors |

## 11. Free-tier impact

| Resource | Free limit | Phase 5B | Note |
| --- | --- | --- | --- |
| Worker requests | 100,000/day | Platform screens and the owner's billing page | Negligible |
| Hyperdrive queries | 100,000/day | The daily rollup (about 10 per store), entitlement checks (none), platform screens | Export, purge and backups go to Neon directly. **The load test is budgeted**: about 3,000 requests in one run, mostly cached pages, on a day with room, and on a preview without Hyperdrive if Q3 is accepted |
| Neon compute | 100 CU-hours/month | The nightly dump and the monthly restore wake the database for a few minutes | About 2 CU-hours a month |
| Neon storage | 0.5 GB | The restore-test branch for a few minutes a month; new platform tables | Small |
| R2 | 10 GB | 7 daily and 4 weekly dumps; exports for 7 days | Far below the limit |
| Email | Resend 100/day | Invoices and reminders, a few a month | |
| GitHub Actions | 2,000 minutes/month (private repository) | Backups (about 3 minutes a night), the monthly restore test, export and purge jobs, the daily job check | About 150 minutes a month |

## 12. Pull requests

| # | Scope |
| --- | --- |
| 0 | This plan and the PLAN.md status |
| 1 | Previews without Hyperdrive, if Q3 is accepted: each preview connects to its Neon branch with the Neon serverless driver. ADR 0011 amended |
| 2 | Phase 5A's follow-ups: the preview's SSLCommerz sandbox payment script (**needs the sandbox credentials**), the CPU step's new routes, Lighthouse on the tracking page |
| 3 | `shared` + `db`: store kinds, the lifecycle's new moves, plans, subscriptions, entitlements schema, usage, health, invoices, payments, reminders, terms, jobs and purges (migrations) |
| 4 | `core` + `api`: onboarding with plan and preset, the checklist; the CLI's new options |
| 5 | `admin`: Platform → New store and Store, the owner's checklist |
| 6 | The daily rollup and health; the monitor writes `latest.json`; the platform dashboard |
| 7 | Terms versions and acceptance, the owner's prompt and read-only rule |
| 8 | Entitlement checks in the core services; upgrade messages; the owner's usage meters |
| 9 | Invoices, payments and the SSLCommerz link; Platform → Billing; Settings → Plan and billing. ADR on billing |
| 10 | Reminders, holds, suspension and reactivation for overdue invoices |
| 11 | `tenant-jobs.yml` and the export; close and reopen; the download route. ADR on jobs in GitHub Actions |
| 12 | Purge with the dry run, approval, resume and verification; criterion 3's test |
| 13 | Store reset, the demo stores' weekly reset with sample orders, preview store cleanup |
| 14 | Shopper anonymization |
| 15 | Legal page templates; the help menu. **Needs the support contacts** |
| 16 | Backups and the restore test. **Needs the `age` keys.** ADR on backups |
| 17 | Runbooks |
| 18 | CI: the onboarding, billing and purge E2E; the load test script and its one run |
| 19 | The security review against PLAN.md's checklist, with fixes |
| 20 | Phase 5B report (build); the pilot's results are added at its end |

As in Phase 5A, separate PRs that each get one `full-preview` run use fewer queries than one PR pushed many times.

## 13. Acceptance criteria and how they're verified

| Criterion | Verification |
| --- | --- |
| A non-developer onboards a new store through the super-admin screen in under an hour, excluding the client's own gateway approvals | The E2E runs the onboarding on every `full-preview` run. **Then the owner, or someone they choose who has never seen the code, onboards a real pilot client** with `docs/runbooks/onboarding.md` and the screen, timed from "New store" to the client's first test order. The time and anything that confused them go in the report |
| Pilot clients take real orders for four weeks with no cross-tenant incident and no lost orders, still on $0 infrastructure | **Measured during the pilot:** the isolation suite on every PR; the daily usage alarm; a weekly check that every order's stock, payments and outbox events are complete (`inventoryDrift`, outbox lag, dead letters); Sentry for any `tenant` mismatch. "$0" depends on Q2. The pilot's results are added to the report at its end |
| Purging a seeded test store leaves zero store rows and files for it, leaves the other tenants untouched, and keeps its platform record and billing history | The purge integration test (§10) on every PR. On the preview, the E2E purges a test store and reads the purge record's verification. Once in production: a `test` store created with the CLI is closed and purged, and the report records its purge record |

## 14. Questions for the owner

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Estimate and order | **About 4 weeks in §12's order, then the pilot.** Onboarding comes first so a non-developer can rehearse while billing is built |
| Q2 | Workers Paid for the pilot | **Switch to Workers Paid ($5 a month) when the first pilot client signs**, as ADR 0013 says for "the first serious client". Phase 5A's preview already had requests stopped at the 10 ms CPU limit, and a stopped checkout is a lost order. That changes criterion 2 to "$5 a month". The alternative is to stay free and watch the alarm, accepting that some requests fail |
| Q3 | Previews without Hyperdrive | **Yes:** previews connect to their Neon branch directly, so they can never use up production's 100,000 Hyperdrive queries again (phase-5a-report §5). Previews get a little slower. Not needed if Q2 moves the account to Workers Paid, where Hyperdrive has no daily limit, but cheap insurance until then |
| Q4 | Who onboards in the acceptance test | **The owner names one person who has not used the admin**, for criterion 1 |
| Q5 | Plans and prices | **Placeholders until the owner decides:** a Starter plan (300 products, 3 staff, 500 orders a month, 1 custom domain, no SSLCommerz), a Growth plan (2,000 products, 10 staff, 3,000 orders, 3 domains, SSLCommerz and SMS), and a Pilot plan with everything at no charge for the pilot. Overage only on orders. Please send the real names, prices, setup fees and limits |
| Q6 | Pilot pricing | **Pilot clients on the Pilot plan with a trial end date at the pilot's end**, then moved to a paid plan with a normal invoice |
| Q7 | Terms acceptance | **Owners only, with the admin read-only for owners until one of them accepts; staff and shoppers never blocked.** A new version is asked 14 days before it takes effect |
| Q8 | Our invoice details and VAT | **Please send:** the company's legal name, address, trade license number, BIN and VAT rate if registered, bank account and bKash merchant number. Ask the accountant whether our invoices must be Mushak 6.3 |
| Q9 | Dunning | **Reminders at −3, 0, +3 and +10 days; suspension at +14; drafts issued automatically after 2 days.** A softer alternative is admin read-only at +14 with the storefront still open, and full suspension at +30 |
| Q10 | Export and purge in GitHub Actions, and the dispatch token | **Yes to Actions** (§3.9). **Create the fine-grained token** (this repository only, Actions: write, 1 year) as `GITHUB_DISPATCH_TOKEN`. Without it, jobs start at the next daily run |
| Q11 | Grace before purge, and reopening | **30 days, as PLAN.md says, and a closed store can be reopened until it is purged.** The contract should say the same |
| Q12 | Free-tier numbers on the dashboard | **From the daily alarm's file in R2**, so they are as of that morning, at no query cost. A live view would need the Cloudflare and Neon APIs called from the Worker with their tokens |
| Q13 | Exports for active stores | **Yes, an owner can request one at most once a day.** It's the client's own record (PLAN.md), and it costs us a few Actions minutes |
| Q14 | Anonymization and the blocklist | **Keep a blocked phone on the blocklist after anonymizing its customer**, unless the legal review says otherwise |
| Q15 | Backup keys | **Generate an `age` key pair with PR 16's script:** the public key as the `BACKUP_AGE_RECIPIENT` variable, the private key as the `BACKUP_AGE_KEY` secret and in a password manager, next to `CREDENTIALS_KEY` |

**Still needed from the owner:**

- the answers above, especially Q2, Q3, Q5, Q8 and Q9;
- Phase 5A's keys in production: `CREDENTIALS_KEY` (with an offline copy), `VAPID_PRIVATE_KEY` and `VAPID_PUBLIC_KEY`;
- the support email, WhatsApp number and abuse address (before PR 15);
- the `age` keys (before PR 16);
- the signed legal documents and the help guide (before the pilot);
- the pilot clients, applying for their SSLCommerz accounts now.
