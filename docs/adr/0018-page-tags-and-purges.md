# ADR 0018: Page cache tags and purge rules

- Status: Accepted
- Date: 2026-10-16
- Plan: phase-3-plan §3.1, §3.2. Code: `packages/shared/src/storefront/cache.ts`, `apps/api/src/purge/`
- Builds on: ADR 0007 (per-store purge by tag on the Free plan)

## Context

ADR 0007 settled how storefront pages are cached and purged: the Cache API, tags per store, a debounced consumer, at most 100 tags a call, and an account-wide bucket of 25 purge calls that refills at 5 a minute. It left two choices to Phase 3: which tags each page carries, and which events purge them.

## Decision

1. **Tags are short.** `s:<tenant>` for the whole store, `s:<tenant>:p:<product>`, `s:<tenant>:lists`, `s:<tenant>:page:<page>`. Only `packages/shared/src/storefront/cache.ts` builds them.

2. **What each page carries:**

   | Page | Tags |
   | --- | --- |
   | Product | store, the product, the related products shown |
   | Home, category, collection, search | store, `lists`, every product on the page |
   | Static page | store, the page |
   | Sitemap, robots, not found | store, `lists` |

   A page whose `Cache-Tag` header would pass Cloudflare's 16 KB limit drops its product tags; it keeps `lists`, which every product change purges anyway.

3. **What each event purges** (`purgeTagsFor`):

   | Event | Purges |
   | --- | --- |
   | `catalog.product.created`, `.archived`, `.deleted`; `.updated` unless only `settings` changed | the product and `lists` |
   | `inventory.availability.changed` (a variant's available stock crossed zero) | its products and `lists` |
   | `inventory.level.changed` | nothing |
   | `catalog.category.changed`, `catalog.collection.changed`, `catalog.attribute.changed`, `theme.published`, `tenant.status_changed`, `tenant_domain.updated`, `tenant_domain.removed` | the store |
   | `tenant.updated` with `name`, `defaultLocale`, `profile`, `storefront` or `display` | the store |
   | `catalog.page.changed` | the page; the store when the footer changed (`navigation`: title, slug or publication) |

   Purging the whole store costs one call, the same as one product: the bucket counts calls, not tags.

4. **The pipeline.**
   - The outbox consumer maps each batch's events to tags and sends one message per store to `managemind-purge`.
   - The purge consumer takes batches of up to 100 messages or 10 seconds. That window is the debounce.
   - It merges each store's tags. The store tag alone replaces them when it is among them or there are more than 100.
   - It packs stores into calls of at most 100 tags, never splitting a store.
   - Each call first takes a token from `PurgeBudget`, a Durable Object named `account`. Its bucket holds 23 tokens, 2 below Cloudflare's 25, so purges made by hand still work.

5. **Nothing is dropped.**
   - An empty bucket puts the call's stores back on the queue with a delay of at least 12 seconds, or the bucket's own wait.
   - A 429 does the same, and empties our bucket so the count catches up.
   - Any other failure retries the original messages with a growing delay. After 5 tries they go to `managemind-purge-dlq`.

6. **Cache lifetime: one day** (Q4). `s-maxage=86400`, `max-age=60` for browsers. A lost purge is fixed within a day.

7. **Without `CF_STORE_TOKEN`**, which needs Cache Purge on the store zone, the consumer logs and acknowledges, and **the storefront doesn't cache pages** (images, named by their content, still are): the deploy sets `PAGE_CACHE=on` on the storefront only when the secret is there, and warns while it's missing. An owner's change would otherwise wait up to a day; rendering every page costs more CPU and Neon time, which the launch's traffic can afford. Previews have no outbox consumer, so they never purge (ADR 0007 decision 7).

## Consequences

- A store editing products all afternoon costs about one purge call per 10-second window in which it saved something. With 23 tokens and 5 a minute, many stores' edits fit. During a burst, a purge can wait a few minutes; the admin says "Changes can take a minute to appear".
- Stock movements purge only when availability flips. Phase 4's orders don't empty product pages on every sale.
- Every new event that changes what shoppers see must join `purgeTagsFor`, and its test in `packages/shared/src/storefront/urls.test.ts`.
- Phase 3's last step (PR 19) checks that purging the `managemind.store` zone by tag reaches pages cached on custom hostnames (ADR 0007 decision 8). If it doesn't, those hosts fall back to purge by URL prefix, which has a much larger limit.
