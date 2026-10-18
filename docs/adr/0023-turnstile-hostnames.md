# ADR 0023: One Turnstile widget, with custom domains added as they go live

- Status: Accepted. Production needs the widget and the token permission from the owner (phase-4-plan §1, Q13); until then checkout and sign-in rely on rate limits alone.
- Date: 2026-10-18
- Plan: phase-4-plan §3.15, Q13. Code: `packages/providers/src/turnstile/index.ts`, `apps/api/src/turnstile-hosts.ts`, `apps/api/src/turnstile.ts`
- Builds on: ADR 0019 (custom domains)

## Context

Turnstile runs on placing an order, on shopper sign-in code requests and on staff sign-in code requests. A widget only runs on the hostnames it lists. A hostname covers its subdomains, so `managemind.store` covers every store's subdomain and the platform domain covers the admin, but each custom domain must be listed on its own. Wildcards aren't allowed. A free widget lists at most 10 hostnames, and an account has at most 20 widgets.

## Decision

1. **One widget** for the platform. The owner creates it with the store domain and the platform domain. Its site key is the repository variable `TURNSTILE_SITE_KEY`, its secret the repository secret `TURNSTILE_SECRET_KEY`. The deploy hands both to the API, and the site key to the admin's build. A deploy without either leaves Turnstile off everywhere, so staff sign-in can never ask for a check the page doesn't show.
2. **Custom domains follow the domain lifecycle.** On every `tenant_domain.*` event, the outbox consumer recomputes the store's domains against the widget's list. Active domains go on it, removed and failed ones come off it, and the platform's own hostnames are never touched. This needs `CF_ACCOUNT_ID` and the Turnstile: Edit permission on `CF_STORE_TOKEN`. Each domain row records whether it made it (`tenant_domains.turnstile`).
3. **A domain that doesn't fit** (the widget is full) is recorded as off the widget, and Sentry gets a warning. On that host, checkout and sign-in skip the check and rely on rate limits alone. The site key isn't sent there, and the token isn't asked for. The store's domains page says so.
4. **Verification** is `siteverify`, and the token's hostname must match the request's host. Previews use Cloudflare's always-pass test keys. Local development and the API tests run with no keys, and the check is skipped.

## Consequences

- Eight custom domains fit beside the two platform hostnames. Past that, the owner creates a second widget, and the sync learns to spread domains across widgets (a small change: a list of site keys, and the domain row records which one it is on).
- The browser widget is `interaction-only`. It is invisible unless Cloudflare wants an interaction. A submit waits up to five seconds for the token, and a token is used once. A retry, or a second try after an error, gets a fresh token.
