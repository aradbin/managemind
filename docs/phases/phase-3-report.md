# Phase 3 report — Storefront, themes and domains

- Date: 2026-10-17
- Plan: `docs/phases/phase-3-plan.md`
- Branch: `ccr-c26c10c2-wjbzye`, one commit per plan step, as in Phase 2. No pull request is open yet, so no preview has run this phase's E2E, Lighthouse or CPU steps on Cloudflare (§2).

## Summary

Phase 3 is built and tested locally: every store gets a server-rendered storefront with a theme chosen by settings, in Bangla and English, with search, filters, static pages, SEO, a consent-gated Meta Pixel and GA4 loader, chat buttons and holiday mode. Owners and managers edit the theme with a live preview, write pages, choose storefront settings and connect their own domain. Cart, checkout, order tracking and shopper accounts move to Phase 4 (Q1).

- **Pages** are cached at the edge by URL and purged by tag when outbox events say something changed (ADR 0018). A hit is answered before Sentry, Astro, the KV host map or the API.
- **The theme** is one template set (`classic`) with tokens, seven homepage sections and three presets (fashion, grocery, general). Drafts autosave; colour changes reach the preview at once; nothing shows on the store until Publish.
- **Search** finds Bangla spelling variants (`সিলেটী` finds `সিলেটি`) and SKUs, through `app.search_text()` and trigram indexes.
- **Custom domains** go through Cloudflare for SaaS: the admin shows the CNAME, the platform checks it after 1, 5, 15 and 60 minutes and daily (ADR 0019).

**Four things the owner should know:**

1. **The owner's setup (Oct 17):** `CF_STORE_TOKEN` is added, Cloudflare for SaaS is on, the test hostname's CNAME is in place and Search Console is confirmed. The reference stores and test tracking IDs are still open, and the code works around both (§5).
2. **Without `CF_STORE_TOKEN`, production doesn't cache pages.** Purges need the token, and without purges an owner's change would wait up to a day. So the storefront renders every page fresh until the token is added; the deploy warns while it's missing. Images are cached either way.
3. **Neither acceptance criterion can be verified yet** (§2). Both need production with the token, and the first needs the test hostname (plan PR 19).
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
| 19 | — | Production checks. **Needs the token and the test hostname** |
| 20 | this commit | This report |

## 2. Acceptance criteria

| Criterion | Status |
| --- | --- |
| Two stores with different themes and languages served from the same deployment, each on its own domain | **Built; not verified in production.** Locally and in the E2E, `demo-fashion` (fashion preset, English) and `demo-grocery` (grocery preset, Bangla) are served by the same Worker with their own tokens, `lang`, canonical URLs and hreflang. Custom domains need Cloudflare for SaaS, `CF_STORE_TOKEN` and the owner's test hostname (plan PR 19) |
| A cached product page is served without any database query (verified in logs) | **Built and unit-tested; not verified in production.** The storefront's cache test pins that a hit makes no KV read and no API call. The deploy now checks for `x-cache: hit` on a demo store's home page once the token is set. The Workers Logs check (one request ID, storefront only) is plan PR 19 |

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

Local numbers only; previews and production haven't run this phase yet.

| Measure | Result | Budget |
| --- | --- | --- |
| Lighthouse, demo-fashion home, phone, simulated 4G (local) | LCP 0.75 s, CLS 0, TBT 0, accessibility 100 | 2.5 s, 0.1, 200 ms, 95 |
| Lighthouse, product page (local) | LCP 0.79 s, CLS 0, TBT 0, accessibility 100 | Same |
| Our JavaScript on a product page | 0.7 KB gzip | 50 KB |
| Product page HTML | 5.8 KB gzip, CSS inlined | — |
| Storefront Worker | 350 KiB gzip | 3 MiB (11%) |
| API Worker | 782 KiB gzip (Phase 2: 748) | 3 MiB (25%) |
| Admin, JavaScript before sign-in | 143 KiB (142) | 150 KiB (95%) |

Lighthouse's SEO score is 58 locally because stores are `noindex` until indexing is on (Q7) and the demo stores have no meta description. CI asserts the SEO audits that matter (title, `lang`, viewport, status, alt text, link text, crawlable links, hreflang, canonical) instead of the score.

**CPU.** The plan's PR 9 asked why production's storefront p90 is 41 ms against 3 ms in ADR 0003's spike. The page cache now runs before the Sentry wrapper and the middleware, so a hit skips both; the hit's real cost will show in the deploy's cache check and the daily monitor once pages are cached. The preview's CPU step now sends 20 misses of each page type and reports the storefront render and the API page endpoint separately; if a row shows 0 requests, Workers Logs names that trigger differently.

## 4. Free-tier impact

As planned (plan §10), with one change: **until `CF_STORE_TOKEN` is set, every page view is a miss.** That means a KV read, an API call and a few Hyperdrive queries per page view, and Neon wakes for shoppers. At today's traffic (demo stores only) this is far inside the free limits; it matters once a client's store gets visitors.

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **`CF_STORE_TOKEN`: added (Oct 17).** It takes effect on the next production deploy, which turns on purges and the page cache and lets custom domains be added.
2. **Cloudflare for SaaS: on (Oct 17).** The next deploy sets the fallback origin to `stores.managemind.store`.
3. **The test hostname: CNAME added (Oct 17)** for PR 19 (Q8).
4. **Reference stores** for the presets (Q6). The three presets were built from general Bangladeshi fashion and grocery conventions; they're settings, so they change without code.
5. **A test Meta Pixel ID, a GA4 property, a WhatsApp number and a Messenger link.** The loader and the event IDs are tested with mocked tag hosts; real IDs show whether events arrive in Meta's and Google's test tools.
6. **Search Console: confirmed (Oct 17)**, both properties verified with alerts on.
7. **Legal review** of the footer's business details. Every field is optional until then.

### Not built yet, or smaller than planned

- **Production checks (PR 19)** wait on items 1–3.
- **The maintenance page isn't themed**: it uses the platform's plain page, so it works even when a store's settings can't load.
- **Shopper email sender records** (SPF, DKIM, DMARC for the store domain) wait for Phase 4, which sends the first shopper email.
- **Holiday mode** shows its banner; pausing orders comes with orders in Phase 4.
- **Cloudflare Web Analytics** is off until the owner decides (plan §8).
- **Theme fonts in the live preview:** switching to Hind Siliguri shows after the draft saves and the preview reloads, not instantly like colours.

### Decisions that differ from the plan

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
- **Local runs need `C.UTF-8` databases**; the deploy now refuses a `C` or `POSIX` locale, so Bangla search can't silently break.
- **Keep an eye on the sign-in bundle**: at 143 of 150 KiB, the next phase should load each language's messages on demand.

## 6. Ready for Phase 4

Phase 4 (orders, cart and checkout) can build on:

- the storefront's page cache and tags, which leave cart and checkout as small uncached islands;
- the theme's layout, header and footer, which a cart page slots into;
- the event helper with event IDs, ready for add-to-cart, checkout and purchase (and Phase 9's server-side events);
- holiday mode's date window, which checkout can read to pause orders;
- the chat buttons, the call to action until checkout exists.
