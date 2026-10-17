# Phase 3 report — Storefront, themes and domains

- Date: 2026-10-17
- Plan: `docs/phases/phase-3-plan.md`
- Pull requests: #51, all of Phase 3 in one pull request with one commit per plan step (as in Phase 2), with its own preview database (`db-branch`); #52, a deploy fix found while connecting the test domain. Both merged and deployed on Oct 17.

## Summary

Phase 3 is built, tested and in production: every store gets a server-rendered storefront with a theme chosen by settings, in Bangla and English, with search, filters, static pages, SEO, a consent-gated Meta Pixel and GA4 loader, chat buttons and holiday mode. Owners and managers edit the theme with a live preview, write pages, choose storefront settings and connect their own domain. Cart, checkout, order tracking and shopper accounts move to Phase 4 (Q1).

- **Pages** are cached at the edge by URL and purged by tag when outbox events say something changed (ADR 0018). A hit is answered before Sentry, Astro, the KV host map or the API.
- **The theme** is one template set (`classic`) with tokens, seven homepage sections and three presets (fashion, grocery, general). Drafts autosave; colour changes reach the preview at once; nothing shows on the store until Publish.
- **Search** finds Bangla spelling variants (`সিলেটী` finds `সিলেটি`) and SKUs, through `app.search_text()` and trigram indexes.
- **Custom domains** go through Cloudflare for SaaS: the admin shows the CNAME, the platform checks it after 1, 5, 15 and 60 minutes and daily (ADR 0019).

**Four things the owner should know:**

1. **The owner's setup is done (Oct 17):** `CF_STORE_TOKEN` is added, Cloudflare for SaaS is on, `shop-test.asrexpress.com` points at `stores.managemind.store`, Search Console is confirmed, and the test tracking IDs and chat links are in. The owner left the reference stores to judgement (§5).
2. **Without `CF_STORE_TOKEN`, production doesn't cache pages.** Purges need the token, and without purges an owner's change would wait up to a day. So the storefront renders every page fresh until the token is added; the deploy warns while it's missing. Images are cached either way.
3. **Both acceptance criteria are met in production** (§2): demo-fashion is served on `shop-test.asrexpress.com` and demo-grocery on `demo-grocery.managemind.store`, from one deployment, with different themes and languages; a cached product page reached the API once in six requests, on the first miss, as Workers Logs show.
4. **The admin's sign-in bundle is at 143 of 150 KiB.** The online store's messages load only when its screens open; only the navigation labels joined the sign-in bundle.

## 1. What was built

| Plan PR | Commit | What |
| --- | --- | --- |
| 1 | `62dbdda` | `db`: `C.UTF-8` databases and the deploy's locale check (ADR 0008 amendment), the Bangla trigram test, `app.search_text()`, trigram indexes on titles, tags and SKUs (migrations 0015–0016) |
| 2 | `5f1b60b` | `shared`: theme schema, tokens, sections and presets, the contrast check, storefront settings, business details, URLs per locale, listing parameters, cache keys and tags |
| 3 | `d7d7aa4` | `db`: static pages, the theme media table, `price_min`/`price_max` with a backfill, custom domain columns and history (0017–0018) |
| 4 | `d66a4ae` | `core`: published-only reads, listings with filters, facets and sort, search, price upkeep, the availability event |
| 5 | `c035bf2` | `core`: the storefront page queries, static pages with suggested headings, the theme service (draft, presets, publish, preview tokens) |
| 6 | `26d128c` | `api`: `/v1/store/pages/*`, sitemaps and preview with ETags and tags; admin theme and page routes; isolation fixtures; SDK |
| 7 | `77971c2` | `api`: the purge consumer, its Durable Object counter and delayed retries; ADR 0018 |
| 8 | `d691c92` | `providers`, `core`, `api`: Cloudflare for SaaS hostnames, the domain lifecycle, checks and the daily re-check, provisioning; ADR 0019 |
| 9–14 | `9b302d7` | `storefront`: the page cache, routing and redirects, the `classic` theme, product, listing, search and static pages, SEO, consent and chat; the demo catalog |
| 15–17 | `f9af55b` | `admin`: the theme editor, pages, storefront settings, domains, business details, "View store" |
| 18 | `3a77c0f` | CI: storefront and online-store E2E with axe, the JavaScript budget, Lighthouse, CPU per page type; the page cache waits for the purge token |
| 19 | `ed1bc6f` (#52) | Production checks (§2); the fallback origin is set with `CF_STORE_TOKEN` |
| 20 | this commit | This report |

## 2. Acceptance criteria

| Criterion | Status |
| --- | --- |
| Two stores with different themes and languages served from the same deployment, each on its own domain | **Met in production (Oct 17).** `https://shop-test.asrexpress.com` serves demo-fashion (fashion preset, primary colour `#8b1e3f`, `lang="en"`), with a valid certificate from Cloudflare for SaaS, and its canonical URL, hreflang links and sitemap all on that host. `https://demo-grocery.managemind.store` serves demo-grocery (grocery preset, `#1b6e3a`, `lang="bn"`). `demo-fashion.managemind.store/products/red-jamdani-saree` answers 301 to the same path on the custom domain. The owner connected the domain in the admin (Settings → Domains, through support access): Connected, then Primary |
| A cached product page is served without any database query (verified in logs) | **Met in production (Oct 17).** Six requests to `shop-test.asrexpress.com/products/blue-cotton-saree`: the first `x-cache: miss`, the rest `hit`. Workers Logs for that window show the storefront Worker invoked for them (CPU median 1 ms) and the API's `GET /v1/store/pages/products/blue-cotton-saree` invoked **once** (69 ms of CPU, the miss). The API is the only path to the database, so the hits made no query. The deploy's own check saw the same on demo-fashion's home page: 0.84 s for the miss, 0.07 s for the hits |

PLAN.md items without their own criterion:

- **Isolation:** every new store endpoint is in the isolation suite: store A's host never returns store B's product, category, collection, page or sitemap entry, including slugs both stores use. Admin theme, page and domain routes join through their fixtures.
- **WCAG 2.1 AA:** axe runs on every storefront page type and every new admin screen at two viewports, with no serious or critical violations. The theme editor refuses to save colours below AA contrast.
- **Bangla and English:** every storefront and admin message exists in both; the parity tests cover them.

### Tests

| Package | Tests |
| --- | --- |
| `shared` | 279 (Phase 2: 231) |
| `db` | 475, 41 skipped (437) |
| `core` | 105 (74) |
| `providers` | 25 |
| `api` | 114 (95) |
| `admin` | 15 (14) |
| `storefront` | 24 |
| `scripts` | 5 |
| E2E, local | Smoke 7 of 7; storefront flows and online-store flows at a phone and a desktop viewport, 6 of 6. The Phase 1 and catalog flows were not re-run locally |

The E2E found a real bug before it shipped: the variant picker didn't update the SKU.

## 3. Measurements

Local numbers, the preview (#51) and production. On the preview, Lighthouse CI passed its budgets on all four pages (LCP 2.5 s, CLS 0.1, TBT 200 ms, accessibility 95, SEO basics) and the CPU step ran; its numbers are in the run's summary.

| Measure | Result | Budget |
| --- | --- | --- |
| Lighthouse, demo-fashion home, phone, simulated 4G (local) | LCP 0.75 s, CLS 0, TBT 0, accessibility 100 | 2.5 s, 0.1, 200 ms, 95 |
| Lighthouse, product page (local) | LCP 0.79 s, CLS 0, TBT 0, accessibility 100 | Same |
| Our JavaScript on a product page | 0.7 KB gzip | 50 KB |
| Product page HTML | 5.8 KB gzip, CSS inlined | — |
| Storefront Worker | 350 KiB gzip | 3 MiB (11%) |
| API Worker | 782 KiB gzip (Phase 2: 748) | 3 MiB (25%) |
| Admin, JavaScript before sign-in | 143 KiB (142) | 150 KiB (95%) |
| Production, cached page (custom domain, from a US runner) | 0.07–0.3 s, storefront CPU about 1 ms | Hits well under 10 ms CPU |
| Production, page miss | 0.8 s; the API's page endpoint 69 ms of CPU | — |

Lighthouse's SEO score is 58 locally because stores are `noindex` until indexing is on (Q7) and the demo stores have no meta description. CI asserts the SEO audits that matter (title, `lang`, viewport, status, alt text, link text, crawlable links, hreflang, canonical) instead of the score.

**CPU.** The plan's PR 9 asked why production's storefront p90 is 41 ms against 3 ms in ADR 0003's spike. The page cache now runs before the Sentry wrapper and the middleware, so a hit skips both: in production a hit costs about 1 ms of CPU. A miss's API call took 69 ms, over the Free plan's 10 ms; misses are rare once pages are cached, and nothing has been stopped, but the daily monitor will show whether they need work. The preview's CPU step now sends 20 misses of each page type and reports the storefront render and the API page endpoint separately; if a row shows 0 requests, Workers Logs names that trigger differently.

## 4. Free-tier impact

As planned (plan §10). `CF_STORE_TOKEN` is set, so pages are cached and purged. Without it every page view would be a miss (a KV read, an API call and a few Hyperdrive queries), which the code allows for a store domain without the token.

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **`CF_STORE_TOKEN`: added (Oct 17)** and in use: purges, the page cache, custom domains and the fallback origin.
2. **Cloudflare for SaaS: on (Oct 17).** The fallback origin is `stores.managemind.store`, set by the deploy (#52).
3. **The test hostname: `shop-test.asrexpress.com`, connected and primary for demo-fashion (Oct 17).** Its DNS is at Namecheap, so Cloudflare validated it over HTTP.
4. **Reference stores: left to judgement (Oct 17).** The presets follow well-known Bangladeshi stores: fashion like Aarong, Yellow and Sailor (a full-width banner first, collections, portrait 3:4 photos, square corners); grocery like Chaldal and Shwapno (categories first, then offers, square photos with the brand); general in between. They're settings, so they change without code.
5. **Test tracking IDs and chat links: given (Oct 17)** and live on demo-fashion. The owner can confirm in Meta's Events Manager and GA4's realtime view that page and product views arrive after accepting cookies on `shop-test.asrexpress.com`.
6. **Search Console: confirmed (Oct 17)**, both properties verified with alerts on.
7. **Legal review** of the footer's business details. Every field is optional until then.

### Not built yet, or smaller than planned

- **A purge on the custom hostname** (ADR 0007 decision 8) isn't observed yet: it needs a real edit in demo-fashion's admin (a price, say) and the page re-checked within a minute. The purge consumer runs, and purges by tag cover custom hostnames on the same zone.
- **The maintenance page isn't themed**: it uses the platform's plain page, so it works even when a store's settings can't load.
- **Shopper email sender records** (SPF, DKIM, DMARC for the store domain) wait for Phase 4, which sends the first shopper email.
- **Holiday mode** shows its banner; pausing orders comes with orders in Phase 4.
- **Cloudflare Web Analytics** is off until the owner decides (plan §8).
- **Theme fonts in the live preview:** switching to Hind Siliguri shows after the draft saves and the preview reloads, not instantly like colours.

### Decisions that differ from the plan

- **The deploy sets the custom hostnames fallback origin with `CF_STORE_TOKEN`** (#52). The deploy token lacked SSL and Certificates rights, so the first deploy only warned, and connecting the test domain showed "zone does not have a fallback origin set".
- **The production deploy creates the demo stores** (with their catalog, a published preset and, for demo-fashion, the test tracking IDs and chat links) the first time, and writes their store hosts to KV. Until now they existed only locally and on previews. They have no owner; the platform owner manages them through support access.

- **The demo stores' languages are the other way round from plan §12:** `demo-fashion` is English and `demo-grocery` Bangla, as they have been since Phase 0. Swapping them would only rename which store tests which language.
- **Without the purge token, pages aren't cached** (above); the plan expected them to expire within a day. ADR 0018 is amended.
- **Theme images have their own table** (`theme_media`) so the weekly media cleanup never deletes a logo or banner a theme still uses.
- **The preview endpoint takes the page path as a query parameter** (`/v1/store/preview?path=&token=`) instead of a path suffix, so one route serves every page type.
- **A page change purges navigation only when it affects menus** (a flag on the event), not every page of the store.
- **A Bangla slug reached through the fallback language redirects** to the requested language's own slug, so each language has one URL per page.
- **The JavaScript budget is checked on rendered pages in the E2E**, not in the build: Astro inlines the theme's scripts into each page, so the build has no script files to measure.
- **`@lhci/cli` runs from the registry at a pinned version** in the preview job, so ordinary installs don't pull in Lighthouse and its Chrome tooling.

### Lessons for later phases

- **The E2E keeps finding bugs that unit tests miss**: this time the SKU on variant change.
- **Seeds must be all-or-nothing.** A preview cancelled mid-seed left half a demo catalog behind, and every later run failed; each store's seed is now one transaction. The same would have hit a production deploy stopped partway.
- **A deploy step that only warns can hide a blocker.** The fallback origin's warning looked harmless until a domain needed it.
- **Local runs need `C.UTF-8` databases**; the deploy now refuses a `C` or `POSIX` locale, so Bangla search can't silently break.
- **Keep an eye on the sign-in bundle**: at 143 of 150 KiB, the next phase should load each language's messages on demand.

## 6. Ready for Phase 4

Phase 4 (orders, cart and checkout) can build on:

- the storefront's page cache and tags, which leave cart and checkout as small uncached islands;
- the theme's layout, header and footer, which a cart page slots into;
- the event helper with event IDs, ready for add-to-cart, checkout and purchase (and Phase 9's server-side events);
- holiday mode's date window, which checkout can read to pause orders;
- the chat buttons, the call to action until checkout exists.
