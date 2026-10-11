# ADR 0007: Per-store cache invalidation on the Free plan

- Status: Accepted
- Date: 2026-10-11
- Spike code: `spikes/cache/` (deleted after Phase 1)

## Context

Storefront pages should be served from Cloudflare's cache, so most shopper requests cost no rendering and no database query. When a store changes something (a product, a price, its theme, a bulk import), only that store's pages may be invalidated, and quickly. The plan proposed purging by cache tag, with a per-store catalog version in the cache key as the fallback (PLAN.md, Phase 0 spikes).

A Worker's own responses are not cached by the CDN in front of it, so the storefront caches pages itself with the Cache API. The Cache API only works for Workers on a custom domain, and purging works per zone, so this spike waited for the main domain (phase-0-plan §3.6, Q2).

## Method

`managemind-spike-cache` on the Free plan, on two throwaway custom domains in the `managemind.site` zone (`spike-cache.managemind.site` and `spike-cache-b.managemind.site`, standing in for two stores' hostnames), and on workers.dev.

- `/t/<store>/p/<product>` renders a page and stores it with `cache.put`, keyed by its URL, with `Cache-Tag: tenant:<store>,tenant:<store>:product:<product>` and `s-maxage=86400`. The response says whether it was a hit.
- `/v/<store>/p/<product>` is the fallback: it reads the store's catalog version from KV and puts it in the cache key. `POST /bump/<store>` writes a new version.
- `spikes/cache/run.mjs` warms pages, calls the zone purge API, and polls each page until it misses, checking that the other pages stay cached.

All requests came from one client in one Cloudflare location (IAD).

## Results (2026-10-11)

| Check | Result |
| --- | --- |
| Cache API on a custom domain | Works: a miss, then hits |
| Cache API on workers.dev | Also hits, although the documentation says it does nothing there. There is no zone to purge, so nothing may rely on it |
| Purge by product tag `tenant:a:product:1` | That page missed on the first poll, 62 ms after the purge call returned. The store's other product and the other store stayed cached |
| Purge by store tag `tenant:a` | The store's page missed after 371 ms (second poll); the other store stayed cached |
| Purge by hostname `spike-cache-b.managemind.site` | That host's page missed after 368 ms; the other host stayed cached |
| Purge by prefix `spike-cache.managemind.site/t/store-a/` | Missed on the first poll (60 ms); the other store stayed cached |
| Purge by URL (the Cache API key) | Missed on the first poll (63 ms); the rest stayed cached |
| Purge API call time | 180–250 ms, 719 ms for the first call |
| Tags in one purge call | 100 accepted; 101 refused (error 1101, "maximum amount of 100 tags") |
| Rate limit, 30 tag purges back to back | Calls 1–25 accepted, 26–30 refused with HTTP 429 (no `Retry-After` header) |
| Rate limit, then one purge every 12 s | 6 of 6 accepted |
| Fallback: bump the catalog version | The new version was used 744 ms after the bump (KV `cacheTtl` 60 s) and 982 ms after it (`cacheTtl` 30 s), in the location that wrote it. The other store's page stayed cached |
| CPU | 3 ms for a miss that renders and stores the page |

The rate limit matches Cloudflare's documentation (purge cache page, 2026-10-11): on the Free plan, purges by tag, hostname and prefix, and purge everything, share a bucket of **25 requests that refills at 5 a minute, per account**. Every Free zone in the account shares it, so both domains and every store draw from the same bucket. Purges by URL have a separate, much larger limit (800 URLs a second).

Not measured:
- **Other locations.** Purges are documented as global ("Instant Purge"), but the spike only polled IAD.
- **KV in other locations.** They may serve the old version until their cached copy expires, up to `cacheTtl` (KV documentation).
- **Cloudflare for SaaS.** Custom hostnames on `managemind.store` arrive in Phase 3.

## Decision

1. **Pages are cached with the Cache API, tagged by store.**
   - **Key:** the page's normalized URL, meaning the hostname, the path and only the query parameters the page uses.
   - **Tags:** every page carries `tenant:<tenant_id>`, plus a tag per resource it shows, for example `tenant:<tenant_id>:product:<product_id>`. Tags are lowercase (Cloudflare ignores case).
2. **One path for invalidation.** Catalog, theme and settings changes write outbox events (ADR 0010).
   - The consumer collects the affected tags per store, debounced over a few seconds.
   - It sends them in purge calls of up to 100 tags each.
   - When a store has more pending tags than one call holds, for example after a bulk import, it purges `tenant:<tenant_id>` instead.
3. **Purges respect the account-wide bucket.** One Durable Object (ADR 0006) counts purge calls for the whole account. When the bucket is empty, or a call returns 429, the purge is retried through a delayed queue message, 12 s or more later. A purge is never dropped.
4. **A ceiling on staleness.**
   - Cached pages also expire on their own: `s-maxage` starts at one hour and is tuned in Phase 3, so a lost purge cannot leave a page stale for long.
   - Checkout and the cart always read prices and stock from the database, so a stale page can never change what a shopper is charged.
5. **No "purge everything".** It empties every store's cache in the zone.
6. **The catalog version in the cache key is not used.**
   - It costs a KV read on every page view, against the Free plan's 100,000 reads a day.
   - Other locations see a bump only after up to `cacheTtl` (60 s by default).
   - Each bump is a KV write, against 1,000 a day.
   - It stays the documented plan B if purge limits ever become the bottleneck.
7. **Previews and local development do not cache pages.** workers.dev has no zone to purge, so a cached preview page could never be invalidated.
8. **Phase 3 re-checks on Cloudflare for SaaS.** Store custom domains are custom hostnames of the `managemind.store` zone. Purging that zone by tag must reach them, which this spike could not test.

## Consequences

- The Free plan allows about 7,200 tag purges a day, each covering up to 100 tags. With debouncing, a store's busy hour of edits costs a handful of calls, so this holds for hundreds of active stores. The Phase 5B platform dashboard counts purge calls and 429s.
- After a change, a page is fresh again within about a second at the location that served it (in this spike), but a purge waiting for the bucket can take minutes during a burst. Store staff should see "updates may take a minute to appear" in the admin.
- The Cache API keeps a copy per Cloudflare location. A store with little traffic gets fewer hits than a busy one, because each location renders its own first copy. Cache API entries are never copied between locations (Cache API documentation).
- **Upgrade path:** if purges ever back up, move the store zone to the Pro plan. Pro allows 5 purges a second instead of 5 a minute, with the same bucket of 25. Each plan's limit is shared only by the account's zones on that plan. Workers Paid does not change purge limits.
