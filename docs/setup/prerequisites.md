# Setup guide: prerequisites for building in Claude Code cloud sessions

Everything the product owner sets up so the AI coding agent can develop, test and deploy this platform entirely from Claude Code cloud sessions, with no local dev machine. Follow the parts in order. Parts 1–5 are needed before Phase 0; Part 6 lists what later phases add.

**Rule for every step:** never paste a token, key, password or connection string into a chat. Put secrets only in the three places this guide names: GitHub Actions secrets, the cloud environment's network secrets, or your password manager.

## What the session can and cannot do

Checked in a session on Oct 9, 2026. Since then the session hook installs Postgres 18 from the PostgreSQL apt repository ([ADR 0008](../adr/0008-local-postgres.md)):

| Works today | Blocked until you change settings | Never works through the session proxy |
| --- | --- | --- |
| Node 22, pnpm 10, npm registry; Postgres 16 server binaries for local tests; Playwright with Chromium; Docker CLI; pushing branches, opening PRs and reading CI logs on GitHub | Cloudflare API, `*.workers.dev`, Neon API, Sentry, SSLCommerz sandbox, and documentation sites the plan says to study (Medusa, Vendure and others) | Raw TCP to Postgres (`psql` to Neon on port 5432), WebSockets (so `wrangler tail` and Neon's WebSocket driver), non-443 HTTPS ports |

Because of the last column, **production migrations and deploys always run in GitHub Actions**, which the plan requires anyway. The session reaches Neon only over HTTPS and reads Worker logs through the Cloudflare API instead of `wrangler tail`.

## Part 1 — Accounts (about 30 minutes)

Create these on free plans. Use one email you control long term (ideally a company address, not a personal one) and turn on two-factor login for every account.

1. **GitHub:** already done (`aradbin/managemind`). Private, so Actions minutes are limited to 2,000 a month (`docs/runbooks/free-tier-limit.md`). It was public from Oct 24 to Oct 27 (PLAN.md status, Phase 5B).
2. **Cloudflare:** sign up at dash.cloudflare.com (Free plan).
   - Open **Workers & Pages** once and choose your `workers.dev` subdomain (for example `managemind`). Preview URLs will be `<worker>.<subdomain>.workers.dev`.
   - Open **R2** and enable it. Cloudflare may ask for a payment card even for the free tier; nothing is charged inside the free limits.
   - Copy the **Account ID**, shown on the account home page and in the right sidebar of Workers & Pages. It is not a secret.
3. **Neon:** sign up at console.neon.tech (Free plan).
   - Create a project named `managemind`, Postgres version **18**, region **AWS Asia Pacific (Singapore)**, the closest to Bangladesh.
   - **Branches → production** (the default branch; older projects call it `main`) **→ Computes → Edit**: set a fixed size of **0.25 CU** (autoscaling off) and keep scale-to-zero on.
   - Copy the **Project ID** from project Settings. It is not a secret.
4. **Sentry:** sign up at sentry.io (Developer, free plan). Create one organization and three projects: `managemind-api` and `managemind-storefront` (Cloudflare Workers) and `managemind-admin` (React). Their DSNs and the organization slug go in `scripts/sentry.json`; DSNs are not secrets.
5. **Password manager** (Bitwarden, 1Password or similar): create a vault entry for every token below. Later it also holds the backup and credential encryption keys.

You do **not** need a domain, email provider, uptime monitor or SSLCommerz account for Phase 0 (see Part 6).

## Part 2 — Create the tokens (about 15 minutes)

Create **two Cloudflare tokens** and **two Neon keys**: one pair for GitHub Actions (deploys) and one pair for the cloud session. Either pair can then be revoked without breaking the other.

### Cloudflare API tokens

Cloudflare dashboard → profile icon → **My Profile → API Tokens → Create Token** → start from the **Edit Cloudflare Workers** template, then make sure these permissions are present:

| Scope | Permission | Access |
| --- | --- | --- |
| Account | Workers Scripts | Edit |
| Account | Workers KV Storage | Edit |
| Account | Workers R2 Storage | Edit |
| Account | Queues | Edit |
| Account | Hyperdrive | Edit |
| Account | Account Settings | Read |
| Account | Account Analytics | Read |
| Account | Workers Observability | Read (for logs; skip if not listed) |
| User | User Details | Read |
| User | Memberships | Read |

- **Account Resources:** include only your account.
- **Zone Resources:** "All zones from an account" (no zones exist yet; Phase 1 needs zone permissions, see Part 6).
- Create it twice, named `managemind-ci` and `managemind-claude-session`. Save both in the password manager.

### Neon API keys

Neon console → profile → **Account settings → API keys → Create new API key**. Create `managemind-ci` and `managemind-claude-session`, and save both in the password manager.

Optional shortcut for the CI key: Neon console → your project → **Integrations → GitHub** connects the repository and adds `NEON_API_KEY` and `NEON_PROJECT_ID` to its Actions secrets for you.

### Neon production connection string (for migrations)

Neon console → project → **Connect** → the default branch (`production`), role `neondb_owner`, **pooling off** (migrations need a direct connection) → copy the connection string into the password manager. It goes only into GitHub. The agent creates the restricted app role through a migration in Phase 0.

### Sentry auth token

Sentry → **Settings → Developer Settings → Organization Tokens → Create**, named `managemind-ci`. It is used only to upload source maps from CI.

## Part 3 — GitHub repository settings (about 10 minutes)

On github.com → `aradbin/managemind` → **Settings**:

1. **Secrets and variables → Actions → Secrets → New repository secret**:

   | Name | Value |
   | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | the `managemind-ci` Cloudflare token |
   | `NEON_API_KEY` | the `managemind-ci` Neon key (skip if the Neon integration added it) |
   | `DATABASE_URL_MIGRATIONS` | the Neon `neondb_owner` direct connection string |
   | `SENTRY_AUTH_TOKEN` | the Sentry organization token |

2. Same page → **Variables** tab → **New repository variable**:

   | Name | Value |
   | --- | --- |
   | `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare account ID |
   | `NEON_PROJECT_ID` | your Neon project ID |

3. **Actions → General:** keep "Allow all actions" (the workflows use only `actions/*` and `pnpm/action-setup`; Wrangler and the Neon API are called from the repository's own scripts). Under **Workflow permissions**, select **Read and write permissions** so CI can comment preview URLs on pull requests.
4. **Claude GitHub App:** the first push that adds `.github/workflows/*` files may need the app's **Workflows** permission. If GitHub asks you to approve updated permissions for the Claude app, accept them.

## Part 4 — Cloud environment settings (about 10 minutes)

At claude.ai/code, click the cloud icon with the environment name (in the row above the message box) → **Cloud** → hover over this session's environment → settings (gear) icon. Docs: https://code.claude.com/docs/en/cloud-environments.

### 4a. Network access

Set **Network access** to **Custom**, tick **Also include default list of common package managers**, and paste this into **Allowed domains**:

```
api.cloudflare.com
*.workers.dev
challenges.cloudflare.com
console.neon.tech
*.neon.tech
sentry.io
*.sentry.io
sandbox.sslcommerz.com
developers.cloudflare.com
neon.com
docs.medusajs.com
docs.vendure.io
docs.saleor.io
shopify.dev
docs.commercetools.com
docs.stripe.com
hono.dev
orm.drizzle.team
www.better-auth.com
better-auth.com
docs.astro.build
tanstack.com
ui.shadcn.com
biomejs.dev
vitest.dev
playwright.dev
docs.sslcommerz.com
developer.sslcommerz.com
```

What each group is for:
- **Cloudflare:** deploy checks, the Workers logs and analytics API (CPU time and bundle measurements for the Phase 0 spikes), hitting preview URLs, and the Turnstile script in browser tests.
- **Neon:** creating and deleting test branches, and running queries over HTTPS on a development branch.
- **Sentry:** confirming errors arrive.
- **SSLCommerz sandbox:** Phase 5A (harmless to add now).
- **Documentation sites:** the plan requires studying how Medusa, Vendure, Saleor and Shopify model each domain, and reading the current docs of every library used. Without these sites, that research is not possible from the session.

When the domains are bought (Part 6), add them too: `yourplatform.com`, `*.yourplatform.com`, `yourstores.com`, `*.yourstores.com`.

**Simpler alternative:** set Network access to **Full**. It removes the need to keep this list updated, at the cost of a session that can reach any site. The Custom list is recommended because this session will hold deploy credentials.

### 4b. Network secrets (Pro and Max plans)

In the same dialog → **Network secrets → Add secret** (credential type **Bearer**), then **Connect**:

| Name | Allowed websites | Header |
| --- | --- | --- |
| Cloudflare API | `api.cloudflare.com` | `Authorization`, prefix `Bearer`, value = the `managemind-claude-session` Cloudflare token |
| Neon API | `console.neon.tech` | `Authorization`, prefix `Bearer`, value = the `managemind-claude-session` Neon key |

The proxy adds the key to requests for those hosts, so the key never enters the session, and the agent can't print or leak it. If the **Network secrets** section is missing (it isn't available on Team or Enterprise plans), put the session tokens under **Environment variables** as `CLOUDFLARE_API_TOKEN` and `NEON_API_KEY` instead. Anyone who uses the environment can read those, so only do this in a personal environment.

### 4c. Environment variables

These values are not secret. Add them under **Environment variables**:

```
CLOUDFLARE_ACCOUNT_ID=<your account id>
NEON_PROJECT_ID=<your project id>
WRANGLER_SEND_METRICS=false
BASH_DEFAULT_TIMEOUT_MS=600000
```

`WRANGLER_SEND_METRICS=false` stops Wrangler calling a telemetry host the allowlist doesn't include. The timeout gives long installs and test runs 10 minutes.

### 4d. Setup script

Leave it empty. The agent commits a SessionStart hook to the repository (`.claude/settings.json`) that installs dependencies and starts the local Postgres each time a session starts or resumes, which works with environment caching.

**Save changes**, then start a **new** session. Running sessions only pick up network and variable changes after a restart.

## Part 5 — Decisions and answers (before Phase 0)

Reply in the session with:

1. **Platform name**, and whether you have picked the main domain and store domain names (they don't need to be bought yet).
2. **Pilot clients:** who they are, what they sell, and how they take orders today (Facebook, phone, WooCommerce, spreadsheet).
3. **Providers the pilots use:** SMS gateway, email provider (if any) and courier.
4. **Who onboards and supports clients:** you alone, or a non-technical teammate.
5. **Merge rights:** may the agent merge its own pull requests once every check is green, or do you review and merge each one? (The plan forbids pushing to `master` directly either way.)

## Part 6 — Later phases (start the slow ones now)

Parts 1–5 cover Phase 0 only. The full, current list of repository secrets and variables, with what each one turns on and what happens without it, is the table under **Production** in the [README](../../README.md#production).

| When | You provide | Where it goes |
| --- | --- | --- |
| Start now (slow) | Trade license, bank account, our SSLCommerz merchant application, legal review, `.com.bd` domain if chosen, Meta business verification | Business tasks, outside the session |
| Recommended now | Buy the **main domain** at a registrar, add it to Cloudflare as a Free site and switch the registrar's nameservers to Cloudflare's | Add `yourplatform.com` and `*.yourplatform.com` to Allowed domains |
| Phase 0 end | Free uptime monitor (UptimeRobot or Better Stack) checking the `/health` URL the agent gives you | Outside the session |
| Phase 1 | Edit both Cloudflare tokens to add **Zone → Workers Routes: Edit, DNS: Edit, Zone: Read, Cache Purge: Purge**, limited to your zones; Google Search Console for the main domain; transactional email provider account (the Phase 1 plan will propose free options) with its API key | API key: GitHub secret + network secret for the provider's API host |
| Phase 1 | First super-admin email addresses; confirmation of the Owner, Manager, Staff and Viewer roles | Reply in the session |
| Phase 1 / 5B | Encryption keys (auth secret, credential encryption key, backup key), which you generate and store in the password manager **and** GitHub secrets; CI copies them into Worker secrets | GitHub secrets |
| Phase 2 | A real product spreadsheet from a pilot client (remove anything personal) | Commit under `docs/fixtures/` or attach in the session |
| Phase 3 | Buy the **store domain**, add it to Cloudflare, enable **SSL/TLS → Custom Hostnames** (Cloudflare for SaaS) on it, and add **Zone → SSL and Certificates: Edit** to both tokens; logo, colors, banners; test Meta Pixel and GA4 IDs | Add `yourstores.com` and `*.yourstores.com` to Allowed domains |
| Phase 5A | SSLCommerz sandbox store ID and password; SMS gateway test credentials | GitHub secrets for CI; the agent stores them per tenant (encrypted) through the admin, never in the repository |
| Phase 7 | Courier sandbox credentials (Steadfast, Pathao, RedX) | The agent lists their exact API hosts in the Phase 7 plan for you to allow |
| Phase 9 | For testing stages 1 and 2: a pixel's Conversions API token and a WhatsApp test number with a system-user token and app secret. For stage 3: our Meta business verification, Tech Provider enrolment, and our app's ID, secret and configuration IDs | Store credentials go through each store's settings, sealed in the vault, never in GitHub. Allow `graph.facebook.com`, `www.facebook.com` and `connect.facebook.net` for sessions and CI. Stage 3's `META_APP_ID`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_CONFIG_IDS` as GitHub secrets copied to the Worker (phase-9-plan §7) |

As built, page purges and custom domains use a separate token with Cache Purge, and SSL and Certificates, on the store zone: the `CF_STORE_TOKEN` secret ([ADR 0018](../adr/0018-page-tags-and-purges.md), [ADR 0019](../adr/0019-custom-domains.md)). The keys and credentials Phases 4–7 added are in the README's table.

## Checklist

- [ ] Cloudflare account, `workers.dev` subdomain chosen, R2 enabled, account ID copied
- [ ] Neon project (Singapore, Postgres 18, 0.25 CU fixed), project ID copied
- [ ] Sentry organization created
- [ ] Two Cloudflare tokens, two Neon keys, Neon owner connection string, Sentry token, all in the password manager
- [ ] GitHub Actions: 4 secrets and 2 variables added (Phase 0; later phases add the rest of the README's table); workflow permissions set to read and write
- [ ] Cloud environment: Custom network list, 2 network secrets, 4 environment variables, saved
- [ ] New session started
- [ ] Part 5 answers sent
