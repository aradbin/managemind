# Phase 1 plan — Platform core

Oct 11, 2026 · Status: **draft; Q1, Q4, Q6, Q7 and Q9 and the admin host (§3.5) decided Oct 11, Q10 done and the email sender on the main domain (§5.7) Oct 13, the rest awaiting the owner** · Source: `docs/PLAN.md` § Phase 1 · Follows: [`phase-0-report.md`](phase-0-report.md)

Phase 1 builds what every later module stands on, before any commerce data exists:

- tenants, their domains and their lifecycle;
- staff accounts that sign in with email codes and optional two-factor login;
- roles and permissions per store, plus separate platform roles;
- the admin shell, on its own host and installable on phones;
- the main domain connected, and staff email sent from it.

The proof is the isolation suite: a user of store A gets 404 on every store B resource, and raw SQL as the app role sees no store B rows. Estimate: **2–3 weeks**. PLAN.md says 2. The extra week covers two things the plan didn't foresee: 2FA for email-code sign-in (§3.4) and the switch from `/admin` to its own host (§7.1).

## 1. Prerequisites status

PLAN.md says no phase starts until its prerequisites are in. Checked Oct 11, 2026.

| Item (PLAN.md, Phase 1) | Status | Blocks |
| --- | --- | --- |
| Main domain registered, nameservers on Cloudflare | **Done.** `managemind.site`, active on this account (Free plan). Both tokens have Zone Read, DNS Edit, Workers Routes Edit and Cache Purge | — |
| Google Search Console for `managemind.site` | **Probably done.** A `google-site-verification` TXT record is on the apex (seen Oct 13); the owner confirms the property and turns on its email alerts | Only PR 17's "Search Console alerts on" |
| Transactional email provider, main domain verified (SPF, DKIM, DMARC) | **Done (Oct 13).** Resend, free plan (Q1). The owner verified `managemind.site` itself, not `notify.`, in the Tokyo region, and set the GitHub secret `RESEND_API_KEY` (sending access). DKIM is on `resend._domainkey`, the bounce records on `send.`; the agent added DMARC `p=none` (§5.7) | — |
| Confirmation of Owner, Manager, Staff and Viewer, and what each may do | **Missing.** A proposed matrix is in §5.2 (Q2) | PR 1 (the permission catalog) |
| First super-admin email addresses | **Missing** (Q3) | Production bootstrap (PR 11) |
| Staff auth secret | **Done (Oct 13).** The owner generated it, keeps a copy in a password manager, and set it as the GitHub secret `AUTH_SECRET` (Q10). A lost secret logs everyone out *and* makes TOTP secrets unreadable, so it cannot just be regenerated in CI like the `mm_app` password | — |
| Credential encryption key | Not needed until Phase 5A (SSLCommerz credentials). The Phase 0 report listed it early | — |

Also carried over from Phase 0:

- The `neondb_owner` password reset on `production` is still open, by the owner's choice (phase-0-report §5).
- Q7 of the Phase 0 plan: `spikes/` and the spike resources are deleted when Phase 1 ends (PR 19).

**Proposal:** after approval, PRs 1–5 and 7–13 can start right away, because they depend on none of the missing items (PR 1 starts from the proposed matrix and is adjusted if the owner changes it). The missing items are needed by PR 6, which deploys sign-in to production.

## 2. Research: what is borrowed

| Concern | How others do it | What we take | What we simplify, and why |
| --- | --- | --- | --- |
| Store as tenant | Vendure: a `Channel` scopes everything and has its own token, and roles are assigned per channel. Medusa v2: `Store` plus sales channels. Shopify: one shop per tenant; an organization groups shops | One `platform.tenants` row per store. Everything tenant-owned hangs off it (already true since Phase 0) | No sales channels. One store is one storefront, which is all the MVP sells |
| Domains | Shopify: a store has many domains, one primary, and the others redirect to it. Saleor: one domain per site | `tenant_domains` with a `status` and one primary per tenant | The default subdomain is derived from the slug, not stored (§3.1); custom domains arrive in Phase 3 |
| Permissions | Vendure: permissions as data (`CreateCatalog`, `ReadCatalog` … `SuperAdmin`); a role is a named set of them, scoped to channels. Saleor: permission groups such as `MANAGE_ORDERS` and `MANAGE_STAFF`, and a staff member may not grant permissions they lack | Vendure's `resource.action` permissions defined in code as data, with roles as named sets. Saleor's **no-escalation rule**: you can only give a role whose permissions you hold yourself | Four fixed roles for now. Custom roles per store are a later, additive change: a table of role → permissions, with the same checks |
| Store owner | Shopify: exactly one store owner, who can't be removed, only transferred | At least one Owner per store at all times, enforced in the service ("last owner" guard) | Several Owners are allowed (family businesses share it). Ownership transfer is just "promote, then step down" |
| Agency staff | Shopify: collaborator accounts, one login across many stores, with permissions granted per store. Shopify organizations: a user with roles in several stores | One staff user with a membership (and a role) in each store, and a store switcher | — |
| Support access | Shopify: collaborator access needs the owner's approval and can be revoked. Vendure and Saleor rely on a superadmin, which gives no time limit and no record | A **support grant** per store: a reason, a role, an expiry, and an audit entry in both the platform and the store log | The owner isn't asked first in the MVP, because we onboard every client ourselves. The store's owners get an email instead (Q5) |
| Invitations | Medusa v2: an `invite` with a token, an expiry and an `accepted` flag, plus resend. Better Auth organization plugin: `invitation` rows, 48-hour expiry | Medusa's model with a hashed token, a 7-day expiry, resend and revoke | — |
| Staff identity | Medusa v2: one auth identity per login method, linked to a user. Better Auth: `user` plus `account` rows per method | Better Auth's user plus accounts, as decided in ADR 0005 | We use Better Auth for identity only. Memberships are ours, not the organization plugin's (§3.3, Q4) |

## 3. Design decisions to approve

These change or refine earlier ADRs, so they are called out before the details. Each one becomes an ADR in the PR that builds it.

### 3.1 Default addresses come from the slug; custom domains are rows (ADR 0015)

*Changed Oct 11, while building PR 2.* The first draft stored `{slug}.<STORE_DOMAIN>` as a row per store. Two things argue against it:

- **Previews share one database** but each has its own `STORE_DOMAIN` (ADR 0011), so stored subdomain rows would match only one environment.
- **PLAN.md's domain rotation** ("change `STORE_DOMAIN` and deploy; default store addresses move") is a config change only if default addresses are derived, not stored.

So:

- the default address `{slug}.<STORE_DOMAIN>` is derived from the slug, as in Phase 0;
- `platform.tenant_domains` holds **custom domains** (Phase 3), each with a status and at most one primary. Without a primary custom domain, the default address is canonical;
- host resolution checks the KV map first (§4.3), then a custom domain row, then the slug.

### 3.2 Two kinds of KV keys

PLAN.md asks for every KV key to be prefixed with the tenant ID. A host lookup can't follow that, because the tenant isn't known until the lookup is done. So:

- `host:<hostname>` keys are a platform index. They are found and deleted through `tenant_domains` on purge.
- Every other tenant key is `t:<tenant_id>:…`.

Both shapes come from one helper, and a test fails on any other key shape.

### 3.3 Better Auth for identity, our own memberships (changes ADR 0005 decision 1; Q4)

ADR 0005 planned to use Better Auth's organization plugin for memberships and roles. I propose using **only its core and the `emailOTP` and `twoFactor` plugins**, and owning memberships, invitations and roles in `packages/core/identity`. The reasons:

1. **One write path.** The organization plugin exposes its own endpoints for invitations, role changes and removal. They would bypass our permission checks, the audit log, the read-only rule for suspended stores (§4.4) and the no-escalation rule. Disabling them one by one is fragile across upgrades.
2. **Support access.** Support grants (§5.4) let a non-member act in a store. The plugin's "set active organization" refuses non-members.
3. **No duplicated tenant record.** The plugin needs its own `organization` row per store, kept 1:1 with `platform.tenants`. Our memberships point straight at `tenants`.
4. **Little to write ourselves.** Invite, accept, change role, remove and switch store are about 300 lines in `core` plus tests. Better Auth still handles everything security-sensitive: codes, sessions, cookies and TOTP.

The cost: if we ever want Better Auth's organization features (teams, dynamic roles), we'd map them onto our tables rather than switch them on. ADR 0005 is amended, not replaced.

### 3.4 Two-factor login for email-code sign-in (spike inside PR 6)

Staff sign in with email codes (ADR 0005). Better Auth's `twoFactor` plugin enforces the second factor **only on password sign-in endpoints**, not on `/sign-in/email-otp`. Its `allowPasswordless: true` option lets users without a password enrol, but doesn't change which endpoints challenge.

- **Plan A:** a Better Auth `after` hook on `/sign-in/email-otp` that hands a user with `twoFactorEnabled` to the plugin's own challenge: the session cookie is dropped, a two-factor cookie is set, and `verifyTotp` or `verifyBackupCode` then creates the session. This keeps trusted devices and backup codes as the plugin implements them.
- **Plan B**, if A needs plugin internals: a session field `two_factor_pending`, set when the session is created for a user with 2FA. Our auth middleware rejects pending sessions everywhere except the verify route, which checks the TOTP with Better Auth's exported helpers.
- Nothing here needs an owner decision. The only effect on people: platform users must set up an authenticator app (§5.3).
- The PR records which one works and why, with tests for both directions: no session without the code, and the code is never asked twice on a trusted device. ADR 0005 is updated to match.
- **Result (PR 6, Oct 13): Plan A works.** The plugin's single after-hook is reused with a matcher that also covers `/sign-in/email-otp`, so trusted devices and backup codes stay the plugin's own. Recorded in the ADR 0005 amendment.

**2FA is required** for platform roles (§5.3) and optional for store staff. An owner can require it for their store's staff later (not in Phase 1).

### 3.5 The admin moves to its own host

- **Production:** `admin.<PLATFORM_DOMAIN>` serves the admin SPA at `/`, and `/api/*` maps to the API (PLAN.md, domains table):
  - `/api/auth/*` → the Better Auth staff handler;
  - `/api/admin/*` → `/v1/admin/*`;
  - `/api/platform/*` → `/v1/platform/*`.
- **Previews** on workers.dev: the PR's API Worker serves the same layout at its own root.
- **Assets:** static assets with `not_found_handling: "single-page-application"`, and `run_worker_first` for `/api/*`, `/v1/*`, `/health*` and `/openapi.json`. Navigation and asset requests never invoke the Worker, so they stay free and use no CPU.
- **Webhook host:** `api.<PLATFORM_DOMAIN>` gets **Workers routes only for `/health` and `/v1/webhooks/*`** (none exist yet), not a custom domain. Nothing else on that host reaches the Worker, so the admin SPA is never served there.

### 3.6 No Bot Fight Mode on the main domain (Q6)

Cloudflare says Bot Fight Mode "cannot be bypassed or skipped using WAF custom rules or Page Rules" and protects whole domains. Super Bot Fight Mode, which supports skip rules, needs Pro. The webhook host shares the zone with the admin host, and ADR 0002 found that non-browser clients get blocked. So on `managemind.site`:

- **Bot Fight Mode off.**
- **"Block AI bots" on.**
- **A WAF custom rule** (the Free plan allows 5) that blocks the admin host's `/api/*` for requests without a same-origin `Origin` header on writes. Our CSRF check does the same, but the rule stops them before they reach the Worker.
- **Rate limits** in the Worker (§5.5).

The store domain is decided in Phase 3. It has no webhooks, so Bot Fight Mode may fit there.

### 3.7 The store subdomain works from Phase 1 (Q7)

The acceptance criterion says `tenant:create` "produces a working admin login and subdomain". So Phase 1 adds the **wildcard route `*.managemind.store/*`** and a proxied wildcard DNS record, and the storefront placeholder shows the store there.

Phase 3 still owns the rest of the store domain: Cloudflare for SaaS, the fallback origin, the shopper email records and Search Console. The registrar's apex parking and email-forwarding records aren't touched.

### 3.8 One email capture instead of Mailpit (Q9)

Outside production, email goes to a **capture provider**. It writes each message to `platform.dev_emails`, which a dev-only endpoint and a small admin page read.

That serves local development, previews and Playwright the same way, with nothing to install. Mailpit, which moved here from Phase 0, is dropped. ADR 0012 gets a row.

## 4. Data model

All tables follow the Phase 0 conventions:

- `uuid` IDs defaulting to `uuidv7()`;
- `created_at` and `updated_at` (`timestamptz`);
- snake_case names;
- one hand-written custom migration per batch for FORCE RLS, grants and triggers (ADR 0009);
- the catalog test covers every new `store` table automatically.

### 4.1 Platform schema (our records; no RLS, access by grants)

**`platform.tenants`** (extended)

| Column | Change | Notes |
| --- | --- | --- |
| `slug` | Immutable after insert (trigger) | It is part of the default host. Changing it means changing a domain, which is a Phase 3 feature |
| `plan` | **New**, text, default `'pilot'` | Plans with entitlements arrive in Phase 5B; this is only the label |
| `settings` | Validated by `tenantSettings` (§6.1) | Typed JSON with a `version` field, so later options need no migration |
| `status` | Unchanged values; transitions through the state machine (§4.4) | |

Grants for `app_rw`:

- `SELECT`;
- `INSERT` (create a tenant from the platform API);
- `UPDATE (name, default_locale, settings, status, plan)` as column-level grants. Never `slug` or `id`.

**`platform.tenant_domains`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `tenant_id` | uuid not null FK → tenants, `ON DELETE RESTRICT` | |
| `hostname` | text, **unique**, lowercase, no port | CHECK on hostname format |
| `status` | text CHECK in (`pending`, `active`, `failed`, `removed`) | Custom domains only (§3.1) |
| `is_primary` | boolean | Partial unique index `(tenant_id) WHERE is_primary AND status = 'active'` |
| `verified_at` | timestamptz null | |
| `provider_ref` | text null | The Cloudflare for SaaS hostname ID, from Phase 3 |

Index: `(tenant_id, status)`. Grants for `app_rw`: `SELECT`, `INSERT`, `UPDATE (status, is_primary, verified_at, provider_ref)`.

**Staff identity (Better Auth core plus `twoFactor`).** The tables keep the shapes the auth spike proved:

| Table | Notes |
| --- | --- |
| `platform.users` | Better Auth's `user`, plus our columns: `platform_role` (text null, CHECK in `support`, `super_admin`) and `locale` (CHECK in `bn`, `en`). `email` is stored lowercase and unique. `two_factor_enabled` comes from the plugin |
| `platform.sessions` | Better Auth's `session` plus `active_tenant_id uuid null` (FK → tenants), and `two_factor_pending` if Plan B (§3.4) is used. Index `(user_id)` and a unique `token` |
| `platform.accounts` | One row per login method. `password` stays null on the Free plan (ADR 0013) |
| `platform.verifications` | Email codes. Cleaned up after 1 day (extends `app.cleanup_expired`) |
| `platform.two_factors` | TOTP secret (encrypted by Better Auth with the auth secret) and backup codes |

Better Auth's field names stay as Drizzle property keys, and the columns are snake_case (ADR 0005). Two settings are pinned by a config test: `platform_role` is `input: false`, so no Better Auth endpoint can set it, and sign-up is off.

**`platform.memberships`** (staff ↔ store)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `tenant_id` | uuid not null FK → tenants | |
| `user_id` | uuid not null FK → users, `ON DELETE CASCADE` | |
| `role` | text CHECK in (`owner`, `manager`, `staff`, `viewer`) | |
| `invited_by` | uuid null FK → users | |

Constraints and indexes: `unique (tenant_id, user_id)` and an index on `(user_id)` for "my stores".

**`platform.invitations`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `tenant_id` | uuid not null FK | |
| `email` | text, lowercase | |
| `role` | text CHECK as above | |
| `token_hash` | text unique | SHA-256 of a 32-byte random token. The token itself exists only in the email |
| `status` | text CHECK in (`pending`, `accepted`, `revoked`, `expired`) | |
| `invited_by` | uuid FK → users | |
| `accepted_by`, `accepted_at` | uuid null, timestamptz null | |
| `expires_at` | timestamptz | `now() + 7 days` |

Index: a partial unique index `(tenant_id, email) WHERE status = 'pending'`, so re-inviting replaces rather than duplicates.

**`platform.support_grants`**

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid PK | |
| `tenant_id` | uuid not null FK | |
| `user_id` | uuid not null FK → users | Must have a platform role |
| `role` | text CHECK in (`viewer`, `manager`) | The store role used while the grant lasts |
| `reason` | text, 10–500 chars | |
| `granted_by` | uuid FK → users | A super admin, or the support user themselves when the role is `viewer` (Q5) |
| `expires_at` | timestamptz | At most 4 hours after creation (CHECK) |
| `revoked_at` | timestamptz null | |

Index: `(tenant_id, user_id, expires_at)`.

**`platform.audit_log`.** Platform actions: tenant created, suspended or reactivated; support access granted or revoked; platform role changed. It has the same columns as `store.audit_log`, plus `tenant_id uuid null`. It is append-only for `app_rw` (`INSERT`, `SELECT`). Purges never touch it (PLAN.md).

**`platform.dev_emails`.** Used by the capture provider (§3.8): `to`, `subject`, `text`, `html`, `created_at`. Writes are refused when `ENVIRONMENT = production`, both in code and by a provisioning check that the table is empty there. It is cleaned up after 1 day.

The Better Auth tables are written by Better Auth running as `mm_app`, so `app_rw` gets the DML it needs on exactly those tables. A test pins the grant list, so a new grant must change the test.

### 4.2 Store schema

**No new store tables in Phase 1.** Staff actions on a store are recorded in `store.audit_log` with the tenant set. Shopper auth tables arrive in Phase 4. Settings stay in `tenants.settings`: they are small, read on every admin request, and read when hosts are resolved.

**Tenant table registry** (PLAN.md, data ownership): `packages/db/src/registry.ts` exports `STORE_TABLES` in **purge order**, so a table comes before every table it references. A CI test checks two things against the catalog:

- every table in `store` appears in the list exactly once;
- the order respects every foreign key between store tables.

Phase 5B's purge job reads this list and nothing else.

**Platform rows owned by a tenant:**

- `tenant_domains`, `memberships`, `invitations` and `support_grants` are listed separately in `PLATFORM_TENANT_ROWS`, with what purge does to each (delete, or keep for history).
- The same test fails if any platform table with a `tenant_id` column is missing from that list.

### 4.3 Edge state and files

**KV `managemind-edge`** (provisioned in Phase 0, bound now to both Workers):

- `host:<hostname>` → `{ tenantId, slug, name, defaultLocale, status, primaryHost }`.
- Keys exist for each store's default address under the current `STORE_DOMAIN` and for its active custom domains. Previews have no queue consumer, so they always use the fallback.
- It is written only by the outbox consumer, on `tenant.created`, `tenant.updated`, `tenant.status_changed` and `tenant_domain.*`, and by a `kv:sync` CLI command for backfill.
- Each change costs one or two KV writes, against 1,000 a day.

**Storefront resolution:**

- The storefront reads KV directly. On a miss it calls `/v1/store/context`, which reads the database and never writes KV. Random hosts therefore can't burn KV writes.
- This removes an API invocation from most storefront requests.
- Phase 3's page cache is keyed by URL, so cached pages skip this lookup entirely.

**R2 keys** come from one helper, `objectKey(kind, tenantId, path)`. The R2 lifecycle rules match prefixes from the bucket root, so the temporary folders come first:

- `tenants/<tenant_id>/…` for permanent files (product images, logos);
- `exports/tenants/<tenant_id>/…` (7-day rule);
- `tmp-uploads/tenants/<tenant_id>/…` (1-day rule).

Purge deletes all three prefixes. Nothing writes to R2 in Phase 1; the helper and its test exist so Phase 2 can't get it wrong.

### 4.4 Tenant lifecycle

The machine is defined with the shared `defineMachine` (`packages/core/tenancy/lifecycle.ts`):

| From | Event | To | Who | Phase |
| --- | --- | --- | --- | --- |
| `active` | `suspend` | `suspended` | Super admin, reason required | 1 |
| `suspended` | `reactivate` | `active` | Super admin | 1 |
| `active`, `suspended` | `close` | `closed` | Super admin | 5B (declared now, not exposed) |
| `closed` | `purge` | `purged` | Purge job | 5B |

**Every transition:**

- writes `platform.audit_log` (from, to, actor, reason);
- emits `tenant.status_changed`, so the KV map updates.

**While suspended:**

- the storefront shows a maintenance page (503, `Retry-After`) in both languages;
- every admin write returns `423 tenant_suspended`, and reads still work;
- shoppers aren't affected in Phase 1, because nothing exists for them yet.

## 5. Identity and access

### 5.1 Permissions

Permissions are defined once as data in `packages/shared/src/permissions.ts`. The API, the core services and the admin UI all use the same list.

| Resource | Permissions | Used from |
| --- | --- | --- |
| Store settings | `settings.read`, `settings.write` | Phase 1 |
| Staff | `staff.read`, `staff.write`, `staff.manage_owners` | Phase 1 |
| Catalog | `catalog.read`, `catalog.write` | Phase 2 |
| Inventory | `inventory.read`, `inventory.write` | Phase 2 |
| Orders | `orders.read`, `orders.write`, `orders.export` | Phase 4 |
| Customers | `customers.read`, `customers.write`, `customers.export` | Phase 4 |
| Promotions | `promotions.read`, `promotions.write` | Phase 4 |
| Payments | `payments.read`, `payments.refund` | Phase 4–5A |
| Reports | `reports.read` | Phase 4 |
| Billing | `billing.read` | Phase 5B |

The later permissions are declared now so the role matrix is reviewed once. A permission with no route yet does nothing.

### 5.2 Store roles (approved Oct 11; Q2)

| Role | Gets | Doesn't get |
| --- | --- | --- |
| **Owner** | Everything | — |
| **Manager** | Everything except `staff.manage_owners` and `billing.read` | Can't add, remove or change Owners or other Managers |
| **Staff** | `catalog.*`, `inventory.*`, `orders.read`, `orders.write`, `customers.read`, `customers.write`, `promotions.read`, `payments.read`, `settings.read` | Exports, refunds, promotions writes, reports, staff, settings writes, billing |
| **Viewer** | Every `*.read`, except `customers.read` (shoppers' personal data) and `billing.read` (Owners only, like for Managers) | Any write or export |

The rules, enforced in `core` and tested as a matrix:

- **No escalation** (after Saleor): you can invite, or change someone to, only a role whose permissions are a subset of yours. Only Owners can touch Owners.
- **Last owner:** removing or demoting the last Owner fails with `409 last_owner`.
- **Self:** you can leave a store yourself, unless you are its last Owner. You can't change your own role.

### 5.3 Platform roles

| Role | Can | 2FA |
| --- | --- | --- |
| `super_admin` | Every `/v1/platform/*` action: create, suspend and reactivate tenants, grant support access at any role, change platform roles | Required |
| `support` | List and read tenants (registry data only, no store data), and give itself `viewer` support access with a reason | Required |

- Platform roles are kept separately from store roles. Having one gives **no access to any store's data by itself**.
- The first super admins are set with the CLI (`platform:grant-role`). After that, super admins can change platform roles in the admin.
- Every platform request checks the role **and** a session that passed 2FA. A platform user who hasn't enrolled is sent to enrolment and can do nothing else.

### 5.4 Support access

- A platform user in a store acts with the grant's role, and only until `expires_at` (at most 4 hours).
- Audit entries record `actor_type = 'platform'`, so the store's own audit log shows "managemind support" with the reason.
- **On grant:**
  - a `platform.audit_log` entry;
  - a `store.audit_log` entry in the store;
  - an email to the store's Owners (Q5).
- Revoking takes effect on the next request: the middleware re-checks the grant every request (one indexed lookup, in the same round trip as the membership check).

### 5.5 Sessions, cookies, CSRF and rate limits

**Sessions:**

- 7 days, refreshed when used after 1 day (`updateAge`).
- Platform users: at most 12 hours, set in `databaseHooks.session.create.before`.
- Role changes, removal from a store and turning 2FA on or off revoke the user's other sessions.
- Sign-in creates a new session, which rotates the token.
- The account page lists your sessions and lets you revoke them.

**Cookies:**

- `__Secure-mm_staff.session_token`, host-only on the admin host, `HttpOnly`, `Secure`, `SameSite=Lax`.
- The cookie cache stays off, enforced by the existing config test (ADR 0005).

**CSRF:**

- Better Auth checks `Origin` against `trustedOrigins` for `/api/auth/*`.
- Our `/api/admin/*` and `/api/platform/*` writes check `Origin` (Hono's `csrf()`) and require `application/json`, which a cross-site form can't send without a preflight.

**Sign-in responses don't reveal accounts.**

- Sign-up is off (`disableSignUp`), so codes go only to existing users.
- Invited people get their user row when invited (§5.6).
- "Send code" always answers the same way. A test checks that the response and timing shape are identical for known and unknown emails.

**Rate limits** use the Durable Object counter from ADR 0006, one object per hashed key:

| Key | Limit |
| --- | --- |
| `otp-send:email:<sha256>` | 3 per 10 minutes, 10 per day |
| `otp-send:ip:<ip>` | 20 per hour |
| `otp-verify:email:<sha256>` | 10 per 15 minutes (Better Auth also allows only 3 tries per code) |
| `2fa-verify:user:<id>` | 5 per 15 minutes |
| `invite:tenant:<id>` | 30 per day |

**Lockout:** 10 failed verifications in an hour lock the email for 1 hour. The lock is kept in the Durable Object's SQLite storage, so it survives eviction. That is the only rate-limit state that writes rows, and it writes them rarely.

**Turnstile:** not in Phase 1. Sign-up is closed and the limits above cap email sends. PLAN.md adds Turnstile with checkout in Phase 4, and staff sign-in can join it then.

### 5.6 Invitations

1. **Invite.** A member with `staff.write` invites an email address with a role (no-escalation applies).
   - If no user has that email, one is created (`email_verified = false`).
   - The invitation row stores only the token's hash.
2. **Email.** The link is `https://admin.<PLATFORM_DOMAIN>/invite#t=<token>`. The token is in the **fragment**, so it never reaches a server log (ADR 0005: no secrets in URLs).
3. **Accept.** The invitee signs in with an email code, which proves they own the mailbox. The SPA then posts the token.
   - The server checks: the hash matches, the invitation is pending and not expired, and the signed-in email equals the invitation's.
   - It then creates the membership, marks the invitation accepted, and sets the store active.
4. **Resend and revoke.** Resend makes a new token, so old links stop working. Revoke marks it revoked. A daily job marks expired invitations `expired`.

### 5.7 Email

**`packages/providers` is created now**, with an `EmailProvider` interface (`send({ to, from, replyTo, subject, html, text, tags, idempotencyKey })` → `{ id }`) and two adapters:

- `resend` (HTTP API, production; Q1);
- `capture` (non-production, §3.8);
- a `cloudflare` adapter is written only at the Workers Paid switch: Cloudflare Email Service needs Workers Paid to send to arbitrary recipients (ADR 0014).

**Sender:** `PLATFORM_NAME <no-reply@managemind.site>` (Q8). *Changed Oct 13:* the plan proposed a `notify.` sending subdomain to keep the apex's reputation separate, but the owner verified the apex in Resend, which allows one domain on the free plan. At tens of staff emails a day the separation buys little, so the apex stays. No mailbox exists behind the address, and the apex has no MX record, so replies bounce. `Reply-To` is the support address once it exists (Phase 5B).

**Delivery:**

- Sign-in codes and invitations hold secrets, so they are **not** written to the outbox. They are sent with `ctx.waitUntil` after the response, with 2 quick retries.
- On failure the error goes to Sentry, with the recipient hashed and never in logs. The user can ask for a new code.
- This is a documented exception to "side effects via the outbox". The emails are time-critical, and an outbox row would keep a live code in the database for 7 days.

**Templates:** plain HTML and text built from the i18n catalogs, in the recipient's locale. Editable templates arrive in Phase 5A.

**Resend setup (owner, Q1). Done Oct 13:**

1. The Resend account is on the free plan.
2. The verified domain is **`managemind.site`** (Tokyo, `ap-northeast-1`). Resend's records: DKIM on `resend._domainkey.managemind.site`, and the bounce and tracking records on `send.` and `rsend.managemind.site`.
3. The agent added `_dmarc.managemind.site` = `v=DMARC1; p=none` (monitoring only) through the API. Reports to Cloudflare DMARC Management and the move to `quarantine` follow in PR 17 (§10).
4. The API key has **sending access** and is the GitHub Actions secret `RESEND_API_KEY`.

**Volume:** Resend's free plan allows 100 emails a day and 3,000 a month. A Durable Object counts sends per day and logs a warning at 70%. The Phase 5A delivery log and alert build on that count.

- **Phases 1–3:** staff emails only (sign-in codes, invitations, support notices), tens a day at most. The free plan is plenty.
- **From Phase 4:** shopper emails (order updates) share the same 100 a day and must come from the store domain, which may need a second domain. At the pilot estimate (about 20 orders a day, email optional for phone-first shoppers) that is roughly 40–80 a day, so it gets tight. The Phase 4 plan decides between Workers Paid with Cloudflare Email Service (3,000 a month included) and a paid Resend plan, using Phase 1–3's measured volume.

## 6. Packages and services

### 6.1 `packages/shared`

- **`permissions.ts`**: the catalog and role matrix (§5.1, §5.2), `can(role, permission)` and `isSubset(roleA, roleB)`.
- **`tenant-settings.ts`**: the zod schema `tenantSettings`, version 1:
  - `profile`: contact email, contact phone (E.164) and address lines;
  - `display`: the numeral style for Phase 3 (the default locale stays a column);
  - unknown keys rejected, defaults filled.
- **`slug.ts`**:
  - the slug pattern, shared with the database CHECK;
  - the reserved list from PLAN.md (`admin`, `api`, `www`, `media`, `status`, `mail`, `help`, `stores`, `app`, `cdn`, `auth`) plus `notify`, `support` and `abuse`;
  - a short list of brand-confusing names. The list is data, so adding names needs no migration.
- **`phone.ts`**: Bangladeshi phone normalization to E.164 (`01712345678`, `+8801712345678`, `8801712345678` and Bangla digits all become `+8801712345678`) and local display formatting. It is used by the store profile now and by checkout later.
- **New error codes:** `slug_taken` (409), `slug_reserved` (422), `tenant_suspended` (423), `two_factor_required` (403), `last_owner` (409), `role_not_allowed` (403), `invitation_invalid` (410).

### 6.2 `packages/core`

| Module | Commands and queries |
| --- | --- |
| `tenancy` | `createTenant(input)`: in **one transaction**, it inserts the tenant, creates or reuses the owner's user, adds the Owner membership, fills default settings, and writes `tenant.created` plus audit entries. `getStore`, `updateStoreProfile`, `transitionTenant` (suspend and reactivate), `resolveHost` |
| `identity` | `listMyStores`, `setActiveStore` (membership or live support grant), `listMembers`, `changeRole`, `removeMember`, `leaveStore`, `invite`, `resendInvitation`, `revokeInvitation`, `acceptInvitation`, `grantSupportAccess`, `revokeSupportAccess`, `setPlatformRole` |
| `access` | `Actor` (user, platform role, active tenant, store role or support grant, permission set) and `authorize(actor, permission)` |

Each service checks its own permissions, as well as the route (PLAN.md: checked twice). A test calls every exported command with an actor that lacks the permission and expects `forbidden`.

Platform-table access goes through a small `PlatformTx` type. It is not tenant-scoped, and is used only by the `tenancy` and `identity` services. Repositories for `store` tables still accept only a `TenantTx`.

Membership and invitation reads always filter by the actor's active tenant in the repository, which is the one place that can do it. That is a **code-only guard**, because these are platform tables without RLS (§3.3). The API isolation suite (§9) is what proves it.

**New events** (zod payloads in `events.ts`):

| Event | When |
| --- | --- |
| `tenant.created` | `createTenant` |
| `tenant.updated` | Name, locale or profile changed |
| `tenant.status_changed` | Suspend or reactivate |
| `tenant_domain.added`, `tenant_domain.updated` | Domain rows change (only the subdomain in Phase 1) |
| `staff.invited`, `staff.joined`, `staff.role_changed`, `staff.removed` | Membership changes. No consumer yet; they feed Phase 5A's notifications |

The queue consumer gains its first real handler, **KV host sync**:

- it is idempotent, because it re-reads the current rows and writes the resulting values, never applying deltas;
- it deduplicates by event ID.

### 6.3 `packages/sdk`

`packages/sdk` is created now, not in Phase 5A, because the admin needs a typed client:

- types are generated from `/openapi.json` by `openapi-typescript`;
- requests go through `openapi-fetch`, which is about 6 KB;
- CI fails if the generated file is out of date, like the migration drift check.

## 7. Workers and endpoints

### 7.1 API Worker

New bindings:

- `EDGE` (KV);
- `RATE_LIMITER` (Durable Object, SQLite, with a migration in `wrangler.jsonc`);
- secrets `AUTH_SECRET`, `RESEND_API_KEY` and, in previews only, `DEV_TOKEN`.

New config: `ADMIN_HOST`, `EMAIL_FROM` and `EMAIL_PROVIDER` (`resend`, `capture`).

**Auth** (Better Auth staff instance, built per request (ADR 0013), mounted at `/api/auth/*`):

- email OTP: send code, sign in, verify email;
- `get-session`, `sign-out`, `list-sessions`, `revoke-session`, `revoke-other-sessions`;
- two-factor: enable (returns the TOTP URI), verify TOTP, disable, generate backup codes, verify backup code.

Rate-limit middleware sits in front of the send and verify endpoints. Better Auth's own limiter stays off (ADR 0005).

**Admin** (`/v1/admin/*`, reached as `/api/admin/*`). Every route needs a session; store routes also need an active store and the permission listed.

| Method and path | Permission | Purpose |
| --- | --- | --- |
| `GET /me` | — | User, platform role, 2FA status, memberships (store, role), active store, effective permissions |
| `PATCH /me` | — | Name, locale |
| `PUT /me/active-store` | Membership or support grant | Switch store |
| `GET /store` | `settings.read` | Store profile, status, primary domain |
| `PATCH /store` | `settings.write` | Name, default locale, `settings.profile` (audited, emits `tenant.updated`) |
| `GET /members` | `staff.read` | Cursor-paginated list |
| `PATCH /members/{id}` | `staff.write` | Change role |
| `DELETE /members/{id}` | `staff.write` | Remove; `DELETE /members/me` leaves the store |
| `GET /invitations` | `staff.read` | Pending invitations |
| `POST /invitations` | `staff.write` | Invite (accepts `Idempotency-Key`) |
| `POST /invitations/{id}/resend` | `staff.write` | New token and email |
| `DELETE /invitations/{id}` | `staff.write` | Revoke |
| `POST /invitations/accept` | — | Body: `{ token }` |

**Platform** (`/v1/platform/*`, reached as `/api/platform/*`; platform role plus a 2FA-verified session):

| Method and path | Role | Purpose |
| --- | --- | --- |
| `GET /tenants` | support | Search by slug or name, filter by status, cursor-paginated |
| `POST /tenants` | super_admin | `createTenant` (accepts `Idempotency-Key`) |
| `GET /tenants/{id}` | support | Registry data, domains, owners' names and emails, member count |
| `POST /tenants/{id}/suspend`, `/reactivate` | super_admin | Body: `{ reason }` |
| `POST /tenants/{id}/support-access` | support (viewer) or super_admin | Body: `{ role, reason, minutes }` |
| `DELETE /support-access/{id}` | The grantee or a super_admin | Revoke |
| `GET /staff` | super_admin | Platform users |
| `PUT /staff/{userId}/role` | super_admin | Set or clear `platform_role` |
| `GET /audit-log` | super_admin | Platform audit, cursor-paginated |

**Store** (`/v1/store/*`): `GET /v1/store/context` resolves through KV, then custom domains in `tenant_domains`, then the slug. Its response gains `status`.

**Dev** (`/v1/_dev/*`): `GET /v1/_dev/mailbox?to=` reads captured emails. It exists only when `ENVIRONMENT !== 'production'`, requires the `DEV_TOKEN` header, and a production build test asserts that the route isn't registered.

**Every response** keeps the Phase 0 middleware. The access log gains `user_id` and `tenant_id` once auth has run.

**OpenAPI:** every new route is in the document, and auth routes are described by hand (Better Auth's routes aren't zod-openapi routes).

**Daily cron additions:**

- expire invitations;
- clean up expired sessions and verifications (1 day, PLAN.md retention table);
- delete expired `dev_emails`.

All of these go into the existing `app.cleanup_expired`.

### 7.2 Storefront Worker

- Binds `EDGE`. Resolves the host from KV, then falls back to the API (§4.3).
- Suspended store: a maintenance page (503) in both languages. Unknown host: the existing "Store not found" page.
- In production, `{slug}.managemind.store` works through the wildcard route (§3.7). The dev store selector still works only outside production.

### 7.3 Admin app

**Stack** (ADR 0012 rows):

- React 19 and Vite 8, with TanStack Router (file-based, type-safe search params) and TanStack Query;
- shadcn/ui on Radix primitives with Tailwind CSS 4;
- react-hook-form with the zod resolver, using the same zod schemas as the API;
- `vite-plugin-pwa` for the manifest and service worker;
- a small QR code renderer for TOTP enrolment, chosen by size in the PR.

**i18n:**

- Admin messages live in `apps/admin/src/i18n/{bn,en}.ts`, using the shared `t()` and the same parity test, so storefront bundles don't carry admin strings.
- Bangla uses a self-hosted Noto Sans Bengali subset.

**Mobile first:**

- On phones: a bottom navigation bar, full-screen sheets instead of dialogs, and lists as cards.
- From the `md` breakpoint: a sidebar and tables.
- Touch targets are at least 44 px.

**PWA:**

- installable, with a manifest, icons in both themes, `display: standalone`, and the theme colour;
- the service worker caches the app shell only, never API responses;
- an update prompt when a new version deploys;
- the push permission isn't requested yet: Phase 5A adds new-order alerts on top.

**Screens:**

| Area | Screens |
| --- | --- |
| Auth | Sign in (email, then code), two-factor challenge (TOTP or backup code, "trust this device"), accept invitation, "no store yet" |
| Shell | Store switcher (search when you have more than 5 stores), language switch, account menu, suspended-store banner, support-access banner ("You are viewing as support until 14:30") |
| Home | Placeholder dashboard (the real one is Phase 4) |
| Settings | Store profile; Staff (members, roles, invite, pending invitations, remove, leave) |
| Account | Name and language; two-factor enrol and disable, backup codes; active sessions with revoke |
| Platform (`/platform`) | Tenants (search, create, detail, suspend and reactivate), support access, platform staff, platform audit log |
| Dev (non-production) | Mailbox reader for captured emails |

**Shared components**, used by every later module:

- `DataList`: a responsive table or card list with cursor pagination, an empty state and an error state;
- `Form` fields: text, email, phone with E.164 normalization, select and switch, with labels and error messages;
- `Dialog` and `Sheet`;
- `ConfirmDialog`, which can require typing for destructive actions;
- `Toast`, `PageHeader` and `PermissionGate` (hides what the role can't do; the server still decides).

**Accessibility (WCAG 2.1 AA):**

- colour tokens checked for contrast in both themes;
- every input labelled;
- visible focus and full keyboard use;
- `lang` set per locale;
- `axe-core` checks in the Playwright suite fail CI on serious or critical violations.

**Budget:** the initial JavaScript for the sign-in route is at most 150 KB gzipped, enforced by the existing bundle-size script, which gains an admin entry. Admin assets don't count toward the Worker size limit, but phones on 4G do care.

## 8. Platform CLI and production bootstrap

`scripts/platform/cli.ts`, run as `pnpm platform <command>`:

| Command | Does |
| --- | --- |
| `tenant:create --slug --name --owner-email [--owner-name] [--locale bn\|en]` | Calls `createTenant` as the migration role, prints the admin URL and the store URL, then relays the outbox events through the Queues REST API so KV fills at once |
| `platform:grant-role --email --role super_admin\|support\|none` | Creates the user if needed; audited |
| `kv:sync [--tenant]` | Rebuilds the `host:` keys from the tenants and `tenant_domains` |

- **Locally** it uses `DATABASE_URL`.
- **For production**, `platform.yml` (`workflow_dispatch`, with the command and its inputs) runs the same CLI with `DATABASE_URL_MIGRATIONS`, so production credentials never enter a session (Phase 0 Q3).
  - One command from anywhere: `gh workflow run platform.yml -f command=tenant:create -f slug=acme -f name="Acme" -f owner_email=…`.
  - Emails are masked in the job log.
- **The super-admin API** (`POST /v1/platform/tenants`) calls the same `createTenant`, so the CLI and the onboarding screen (Phase 5B) can never drift apart.

## 9. Tests

| Layer | Tests |
| --- | --- |
| Unit | Permission matrix (every role × permission, against a reviewed snapshot), no-escalation and last-owner rules, tenant settings schema, slugs and the reserved list, phone normalization (including Bangla digits), tenant lifecycle machine, KV and R2 key helpers, email templates in both locales |
| Integration (Postgres 18, as the app role) | `createTenant` is all-or-nothing (a failure after the membership insert leaves no rows), a duplicate slug gives `slug_taken`, and a reserved slug is refused by both code and CHECK. Invitations: invite, accept, wrong email, expired, resend invalidates the old token, revoke. Support grants: expired grants and revoked grants are refused. Suspended stores refuse writes. Grants are pinned: `app_rw` can't update `tenants.slug` or write `platform_role` |
| Auth (API with the capture provider) | Sign-in by code; unknown and known emails answer alike; a code works once and only for its email; 3 wrong codes kill it; rate limits and the lockout; cookie flags and name; cookie cache off; 2FA required after enrolment (no session without TOTP), backup code used once, trusted device; platform routes refuse sessions without 2FA; session revocation after a role change |
| CSRF | Writes with a foreign `Origin`, no `Origin`, or a form content type are refused; `/api/auth/*` refuses untrusted origins |
| **Isolation suite (acceptance)** | Generated from the route table. Every `/v1/admin/*` route with a resource ID is called by a store A user with store B's resource IDs and must return **404** (not 403, so existence never leaks). A route without an isolation fixture fails the test, so new routes join automatically. The raw-SQL suite from Phase 0 still runs for every `store` table. New: a store A user can't switch to store B, and a support grant for A gives nothing in B |
| Registry | Every `store` table is in the purge order and the order respects foreign keys; every platform table with `tenant_id` is in `PLATFORM_TENANT_ROWS` |
| E2E (Playwright, preview) | Create a tenant with the CLI against the preview database, sign in with the code from the dev mailbox, see the store, invite a second user, accept as them, switch stores, change a role, suspend from `/platform` and see the banner and the 423, see the subdomain placeholder through `?store=`. Runs at a phone viewport and a desktop viewport, with `axe` on every screen |
| CPU | ADR 0003's measurement re-run on the preview for `GET /me`, `PATCH /store` and the code sign-in, recorded in the phase report against the alarm thresholds |

## 10. Domains and infrastructure (PR 17)

Everything is done through the Cloudflare API from `scripts/production/zones.ts`, which is idempotent and run by `provision.yml`. Nothing is clicked in the dashboard except what only the owner can do.

**`managemind.site`:**

- custom domain `admin.managemind.site` → `managemind-api`;
- Workers routes `api.managemind.site/health` and `api.managemind.site/v1/webhooks/*`, with a proxied placeholder record;
- the email provider's DKIM and bounce records on `managemind.site` (added by Resend, Oct 13); `zones.ts` checks them and doesn't manage them;
- DMARC: `p=none` (added Oct 13), then reports to Cloudflare's free DMARC Management, moving to `quarantine` after two clean weeks;
- "Block AI bots" on, and the WAF rule from §3.6;
- Search Console TXT record, if the owner sends it.

**`managemind.store`:** the proxied wildcard record `*` and the route `*.managemind.store/*` → `managemind-storefront` (§3.7).

**Production config:** `PLATFORM_DOMAIN=managemind.site`, `STORE_DOMAIN=managemind.store`, `ADMIN_HOST=admin.managemind.site`, `EMAIL_FROM` and `EMAIL_PROVIDER=resend`.

**Deploy smoke:**

- moves to the real hosts: `/health` on `api.`, the admin shell on `admin.`, and a demo-free 404 on a random store subdomain;
- keeps the Phase 0 retries.

**Uptime monitor:** the owner moves UptimeRobot to `https://api.managemind.site/health`. The production `workers.dev` URLs are turned off once the monitor and the smoke test have moved, so there is one public address per Worker.

## 11. Pull requests

Each PR is under about 400 changed lines, excluding generated files, migrations and the lockfile.

| # | PR | Notes |
| --- | --- | --- |
| 0 | This plan | |
| 1 | `packages/shared`: permissions and roles, tenant settings, slugs and reserved names, phone normalization, error codes | Uses the §5.2 matrix as proposed until Q2 is answered |
| 2 | `packages/db`: platform tables (§4.1), grants, slug trigger, cleanup additions | Updates the catalog and grant tests |
| 3 | `packages/db`: tenant table registry and the purge-order test; KV and R2 key helpers | |
| 4 | `packages/providers`: `EmailProvider`, `capture`, `resend`; templates; ADR 0012 rows; ADR 0014 (email provider) | Needs Q1 for the `resend` adapter; `capture` doesn't |
| 5 | `apps/api`: rate-limiter Durable Object, lockout, email quota counter | |
| 6 | `apps/api`: Better Auth staff instance (email OTP, sign-up off, TOTP with `allowPasswordless`), the 2FA-on-code spike (§3.4), sessions, cookies, CSRF, `/api/*` mapping; ADR 0005 amendment | `AUTH_SECRET` is set (Q10). Until PR 17, `ADMIN_HOST` is the API Worker's workers.dev host. Previews use `AUTH_SECRET_PREVIEW` if the owner adds it, otherwise a new secret per deploy |
| 7 | `packages/core/tenancy`: `createTenant`, profile, lifecycle, host resolution; events; KV sync consumer; ADR 0015 | |
| 8 | `packages/core/identity` and `access`: memberships, invitations, support grants, platform roles, `authorize` | |
| 9 | `apps/api`: `/v1/admin/*` routes and the generated API isolation suite | |
| 10 | `apps/api`: `/v1/platform/*` routes, dev mailbox; storefront KV resolution and maintenance page | |
| 11 | Platform CLI and `platform.yml`; Queues REST sink | Production bootstrap needs Q3 |
| 12 | `packages/sdk` with the CI drift check | |
| 13 | Admin foundation: Tailwind, shadcn/ui, Router, Query, admin i18n, fonts, responsive shell, PWA; admin moves to `/` (`run_worker_first`, SPA fallback) | ADR 0012 rows |
| 14 | Admin: sign-in, 2FA challenge and enrolment, accept invitation, account page | |
| 15 | Admin: shared components, store switcher, store profile, staff management | |
| 16 | Admin: platform area, dev mailbox page | |
| 17 | Domains and infrastructure (§10), production config, deploy smoke on the real hosts | Needs Q1's DNS values; Search Console needs the owner |
| 18 | E2E flows and axe checks; CPU measurement on the preview | |
| 19 | Delete `spikes/` and the spike resources (Workers, `spike-cache*` hostnames, KV namespace, Hyperdrive config `managemind-spike-db`, Neon branch `spike`); `phase-1-report.md` | Phase 0 Q7 |

## 12. Acceptance criteria (from PLAN.md) and how they're verified

| Criterion | Verification |
| --- | --- |
| Isolation suite: a user of store A gets 404 on every store B resource by ID | The generated API isolation suite (§9) runs in `ci.yml`. Like Phase 0, one deliberately unguarded route in a temporary commit makes CI fail, shown once in PR 9 and then reverted |
| Raw SQL as the app role with tenant A context returns zero store B rows | The Phase 0 isolation suite, still generated from the catalog |
| Creating a tenant with the CLI takes one command and produces a working admin login and subdomain | In production: one `gh workflow run platform.yml …` creates a test store. Its owner receives the code email from `no-reply@managemind.site`, signs in at `admin.managemind.site`, and the store's page answers at `<slug>.managemind.store`. The same flow runs in the preview E2E on every PR. The test store is then suspended, because purge arrives in Phase 5B |

The PLAN.md items without their own criterion are covered by §9: PWA installability (a Lighthouse PWA check in the E2E job), WCAG through axe, and the Bangla and English UI through the catalog parity test.

## 13. Free-tier impact

| Resource | Added by Phase 1 | Note |
| --- | --- | --- |
| Worker requests | Admin API calls only. Admin navigation and assets are static and free | |
| Durable Object requests (100,000/day) | One per sign-in step and invitation, a few hundred a day at most | Never per request |
| KV reads (100,000/day) | One per uncached storefront request | Phase 3's page cache removes most of them |
| KV writes (1,000/day) | One or two per store or domain change | |
| Email (Resend free: 100/day, 3,000/month) | Sign-in codes, invitations, support-access notices: tens a day for the pilot | Shared with shopper emails from Phase 4; reviewed then |
| Neon compute | Admin sessions wake the database while staff work, as expected | Unchanged estimate |
| Cron Triggers | None added (the daily batch grows) | |

## 14. Open questions for the owner

- **Q1 — Email provider. Decided (Oct 11), set up Oct 13:** Resend's free plan, with `managemind.site` as the verified domain (the plan proposed `notify.`; see §5.7); the store domain's sender is decided in Phase 4. Original question: Cloudflare Email Service can't send to arbitrary recipients on Workers Free. **Recommended: Resend's free plan**: 3,000 emails a month and 100 a day, with an HTTP API that fits Workers. It may allow only one domain on the free plan, so shopper email from the store domain (Phase 4) is decided in that phase's plan, possibly together with the Workers Paid switch, after which Cloudflare Email Service includes 3,000 emails a month. Alternative: Brevo's free plan (300 a day; free-plan API and domain limits need checking). Please create the account, send an API key limited to sending, and confirm the provider.
- **Q2 — Roles. Decided (Oct 11):** fixed roles as proposed; custom roles per store later if a client needs them (§2). Original question: is the matrix in §5.2 right? In particular: Viewer without customer data, Staff without refunds and exports, Manager unable to manage Owners or other Managers.
- **Q3 — First super admins.** Which email addresses get `super_admin`? Should anyone get `support` now?
- **Q4 — Memberships outside Better Auth's organization plugin** (§3.3). This changes ADR 0005 decision 1. **Decided (Oct 11):** the agent's call, as proposed.
- **Q5 — Support access.** Proposed: support users can give themselves read-only (Viewer) access for up to 4 hours with a written reason; Manager-level access needs a super admin; the store's Owners get an email each time. Is that right, or should Owners approve first? Approval would make the pilot's onboarding slower.
- **Q6 — Bot protection** (§3.6). No Bot Fight Mode on `managemind.site`, because it can't exempt webhooks on the Free plan. Instead: "Block AI bots", one WAF rule and the Worker's rate limits. **Decided (Oct 11):** as proposed.
- **Q7 — Store subdomains from Phase 1** (§3.7). The wildcard route on `managemind.store` moves up from Phase 3, so the acceptance criterion holds. **Decided (Oct 11):** as proposed.
- **Q8 — Sender address. Decided (Oct 13):** `no-reply@managemind.site` with the platform name as the sender, and DMARC reports to Cloudflare DMARC Management. Still open: is there a support address for `Reply-To` yet?
- **Q9 — Mailpit dropped** (§3.8) for the capture provider and dev mailbox. **Decided (Oct 11):** as proposed.
- **Q10 — `AUTH_SECRET`. Done (Oct 13):** the owner set the GitHub Actions secret and keeps a copy in a password manager; it is 44 or more random letters and digits from the password manager's generator, equivalent in strength to 32 random bytes. Original request: please generate 32 random bytes (for example `openssl rand -base64 32`), keep a copy in your password manager, and add it as a GitHub Actions secret. Previews use a separate `AUTH_SECRET_PREVIEW`, which the agent can create.
- **Q11 — Session length.** 7 days for store staff (refreshed while used) and 12 hours for platform users. Is that right for staff who mostly use phones?
