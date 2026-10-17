# ADR 0019: Custom domains with Cloudflare for SaaS

- Status: Accepted. Production needs two things from the owner: Cloudflare for SaaS turned on for `managemind.store`, and the `CF_STORE_TOKEN` secret.
- Date: 2026-10-16
- Plan: phase-3-plan §3.9, Q8, Q9, Q10. Code: `packages/core/src/tenancy/domains.ts`, `packages/providers/src/hostnames/`, `apps/api/src/domains.ts`, `apps/api/src/admin/domains.ts`
- Builds on: ADR 0015 (host resolution and the KV map), ADR 0018 (purges)

## Context

A store can move from `{slug}.managemind.store` to its own domain, such as `www.shop.com.bd`. The certificate and the routing have to work on the Free plan. Nothing may poll the database on a short timer (PLAN.md).

## Decision

1. **Custom hostnames on the store zone.** Each domain is a Cloudflare for SaaS custom hostname on `managemind.store` with HTTP certificate validation. The client adds one record, `CNAME www → stores.managemind.store`, and Cloudflare validates and issues the certificate itself. When the client's DNS is also on Cloudflare, Cloudflare asks for a TXT ownership record too; the admin shows it. 100 hostnames are free, then $0.10 each a month. Above 100, the owner is asked before paying (PLAN.md).

2. **Routing.**
   - `stores.<store domain>` is a proxied placeholder record and Cloudflare for SaaS's fallback origin.
   - The storefront's Worker route is `*/*` on the store zone. It catches every store subdomain and every custom hostname.
   - `scripts/production/zones.ts` creates the record and sets the fallback origin. Setting the fallback origin only warns until SaaS is on and the deploy token has SSL and Certificates: Edit.

3. **`www` only** (Q9). Cloudflare's Free plan can't proxy a bare domain. The API refuses one (`shop.com.bd`, `example.com`, with `.com.bd`-style suffixes known) and says to forward it to `www` at the registrar. It also refuses our own domains and their subdomains, a hostname another store has, and a third domain for one store.

4. **The lifecycle is a state machine** (`domainLifecycle`), with a history row in `platform.tenant_domain_history` for every change:
   - `pending → active` when the hostname and its certificate are live.
   - `pending → failed` after 7 days, with Cloudflare's reason.
   - `failed → pending` when someone presses "Check now" (a new 7-day round).
   - `failed → active`.
   - `pending | active | failed → removed`.

   An active domain that breaks later (its CNAME removed, or the certificate failed to renew) stays active but is flagged with the reason, and the store's owners are emailed once.

5. **Checks without a timer.**
   - A new domain gets four delayed messages on `managemind-domains`, after 1, 5, 15 and 60 minutes. A message for a domain that is no longer pending does nothing.
   - The daily job lists the zone's hostnames in one call per 50 and checks every pending and active domain against the list.
   - "Check now" checks at once, 20 times an hour per store at most.

6. **Removal deletes the custom hostname at Cloudflare first**, then marks the row `removed`, so a hostname can't stay attached after a store lets it go. A removed row frees its hostname (a partial unique index).

7. **Primary.** The owner chooses which active domain is primary (at most one). Making it primary, activation and removal emit `tenant_domain.*`. The outbox consumer then rewrites the store's KV host keys (ADR 0015) and purges the store's pages (ADR 0018). The storefront then redirects the subdomain to the primary with a 301, and canonical URLs and sitemaps use the primary.

8. **Behind an interface.** `CustomHostnameProvider` has three adapters:
   - `cloudflareHostnames`, used when `CF_STORE_TOKEN` and `STORE_ZONE_ID` are set;
   - `fakeHostnames`, for tests;
   - `pendingHostnames`, for previews and local development, where every domain stays pending.

   Production without the token answers `feature_unavailable` (503).

9. **Permissions:** `settings.write` for Owners and Managers, `settings.read` for the list (Q10).

## Consequences

- The client's only step is one CNAME, plus a TXT record when their DNS is on Cloudflare. Bangla and English instructions in the admin cover the registrars Bangladeshi clients use most.
- `*/*` sends the bare `managemind.store` and `stores.managemind.store` to the storefront as well. The storefront answers them without a store (a redirect to the platform, or "store not found").
- Domain checks cost about 4 queue messages per new domain and one list call a day.
- Still to verify in production (plan PR 19, on the owner's test hostname, Q8): that purging the store zone by tag reaches pages cached on a custom hostname (ADR 0007 decision 8). If it doesn't, those hosts fall back to purge by URL prefix.
