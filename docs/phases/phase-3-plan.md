# Phase 3 plan — Storefront, themes and domains

- Status: Questions answered by the owner on 2026-10-16 (§13); approved when this PR merges (PLAN.md: no code before approval)
- Date: 2026-10-16
- Scope: PLAN.md "Phase 3 — Storefront, themes and domains"

## Goal

Every store gets a fast, branded storefront from one Astro codebase, in Bangla and English. The look comes from theme settings, not code. Shoppers browse, search and filter the catalog Phase 2 built. Most page views come from Cloudflare's cache and never reach the API or the database. A store can move to its own domain.

Two acceptance criteria, from PLAN.md:

1. Two stores with different themes and languages are served from the same deployment, each on its own domain.
2. A cached product page is served without any database query (verified in logs).

**Estimate: about 4 weeks.** PLAN.md says 3. The extra week covers three things:

- Custom domains need Cloudflare for SaaS, a verification flow and re-checks without a timer that touches the database (§3.9).
- Bangla search doesn't work on the local database today, and spelling variants need normalization (§3.7).
- The theme editor's live preview (§3.4).

**Cart, checkout, order confirmation, order tracking and the shopper account move to Phase 4** (Q1). They need the cart, order and shopper APIs, which Phase 4 builds. This phase leaves room for them in the layout (a cart icon and an account link appear when Phase 4 turns them on), and the product page has the variant picker that Phase 4's "add to cart" will use.

## 1. Prerequisites status

| Item | Status |
| --- | --- |
| Phase 2 | Done (report: `docs/phases/phase-2-report.md`) |
| Store domain registered, with nameservers on Cloudflare | Done: `managemind.store` is an active zone; `*.managemind.store` already serves stores (Phase 1) |
| Google Search Console for the store domain | Its verification record is on both zones (checked Oct 16). **The owner confirms** that both properties are verified and alerts are on |
| Cloudflare for SaaS enabled on `managemind.store` | **Unknown.** This session's token can't read custom hostnames ("Authentication error"). The owner turns it on in the dashboard (SSL/TLS → Custom Hostnames); Cloudflare may ask for a payment method even for the 100 free hostnames. **Needed before PR 8** |
| New: a Cloudflare API token for the API Worker | **Open.** Zone `managemind.store`: Cache Purge, and SSL and Certificates: Edit. It becomes the Worker secret `CF_STORE_TOKEN`. **Needed before PR 7** |
| Platform logo and brand colors | **Open, not blocking.** Used on the store-not-found page and the admin's icons. Placeholders until then |
| Two or three reference stores per theme preset (fashion, grocery, general) | **Open.** They shape the homepage presets (§3.4, Q6). **Needed before PR 10**, about week 2 |
| A pilot client's logo, colors and banners | **Open, not blocking.** There is no pilot client yet. The demo stores use placeholder branding |
| A test Meta Pixel ID, a GA4 property, a WhatsApp number and a Messenger page link | **Open.** **Needed before PR 14**, about week 3 |
| Cookie consent wording | **Done:** the wording in §3.10 is approved as the default, editable per store (Q11) |
| New: a test domain that isn't ours, for acceptance criterion 1 | **Open:** a subdomain of a domain the owner has elsewhere (Q8). **Needed before PR 19** |
| Legal review: which business details the footer must show | **Open, not blocking.** Every field is optional until then (§3.11) |

## 2. Research: what is borrowed

| From | What |
| --- | --- |
| Shopify (Online Store 2.0) | A theme is fixed templates plus typed settings (`settings_schema`). The homepage is a JSON list of sections, each with its own typed settings, that the merchant adds, removes and reorders. Presets are starting configurations of the same theme. Alternate languages live under a path prefix (`/en/…`). Merchant domains: `www` as primary, and the store's own subdomain redirects there |
| Shopify, Saleor, Vendure storefronts | Product URLs by slug with redirects for renamed slugs; facet filters from attributes; price and availability in schema.org `Product`/`Offer` |
| Cloudflare for SaaS | Custom hostnames with HTTP certificate validation, a fallback origin on our zone, and a Worker route that catches every hostname |
| Google Consent Mode | No analytics or ad tags before the shopper agrees; "Accept" and "Reject" equally easy |
| What we simplify | One theme with presets, not a theme store; homepage sections only (other pages have fixed templates with a few settings); no menu builder (the header shows the category tree, the footer the store's pages); no apex domains (Cloudflare Free has no apex proxying) |

## 3. Design decisions to approve

### 3.1 Request flow and the page cache

The storefront Worker handles every shopper request on a store host. ADR 0007 already decided how pages are cached and purged. This is how a request flows through it:

1. **The cache comes first.** The Worker builds the cache key from the URL: the host, the path, and only the query parameters the page uses, sorted. It looks the key up with the Cache API **before** anything else. A hit is returned as is. It costs no KV read, no API call and no database query, about 1–2 ms of CPU.
2. **On a miss**, the Worker resolves the store from the KV host map (ADR 0015). It then makes **one** call to a page-shaped API endpoint over the service binding (§6.1). That response carries everything the page shows, plus the page's cache tags. The Worker renders the page and stores it with `cache.put`, `Cache-Tag` and `s-maxage`.
3. **What is cached:** catalog pages (home, category, collection, product), static pages, search results, the sitemap, robots and images. **Never cached:** `/api/*`, the theme preview, and anything with a session cookie (from Phase 4).
4. **Pages never vary by cookie.** Personal things (consent, and from Phase 4 the cart count) are read by small scripts in the browser, so one cached copy serves every shopper.
5. **How long a page lives:** `s-maxage` of **one day** (Q4). Purges keep pages fresh, so a long lifetime only means fewer misses, fewer Neon wake-ups and less CPU. A lost purge still ends within a day. Browsers get `max-age=60`.
6. **Previews and local development don't cache** (ADR 0007 decision 7). The cache layer is a small module that gets a fake cache in unit tests. Production's deploy smoke checks the cache for real (§11).
7. **Images** (`/media/*`) are read from R2 through a new R2 binding on the storefront Worker. They are cached for a year, since file names are content hashes (Phase 2).

**CPU:** a cache hit must stay well under 10 ms. Production's storefront p90 is already 41 ms for the Phase 1 placeholder page, against 3 ms in ADR 0003's spike. PR 9 finds out why (likely the Sentry wrapper or the middleware's work on every request) before pages get heavier, and the CPU step measures hits and misses separately.

### 3.2 Invalidation: from events to tags

ADR 0007 settled how purges are sent: debounced per store, at most 100 tags per call, an account-wide counter in a Durable Object, and delayed retries when the bucket is empty. This phase decides **which tags each page carries and which events purge them**. Tags are short, so a listing page's header stays small: `s:<tenant>` for the whole store, plus `s:<tenant>:p:<product>`, `s:<tenant>:lists`, `s:<tenant>:page:<page>`.

| Page | Tags |
| --- | --- |
| Product | store, the product |
| Home, category, collection, search | store, `lists`, and every product on the page |
| Static page | store, the page |
| Sitemap, robots | store, `lists` |

| Event | Purges |
| --- | --- |
| A product created, archived, deleted, or changed in a field shoppers see (text, prices, media, options, categories) | the product and `lists` |
| **New: `inventory.availability.changed`**, only when a variant goes in or out of stock | the product and `lists` |
| A category, collection or attribute changed; the theme published; store settings or profile changed; status changed; a domain becomes active or primary | the whole store (`s:<tenant>`), because the header, footer or host shows on every page |
| A static page changed | the page, and the whole store when its title or slug changes (the footer lists it) |

- **Stock purges only when availability changes.** `inventory.level.changed` fires on every movement. From Phase 4 that means every order. Product pages only show "in stock" or "out of stock", so the inventory service also emits `inventory.availability.changed`, in the same transaction, when a variant's available stock crosses zero. That event purges; the other doesn't.
- **Changes that affect every page cost one purge call.** The rate limit is per call, not per tag, so purging the whole store costs no more than purging one product. The pages just have to render again.
- Staff see "Changes can take a minute to appear on your store" after saving (ADR 0007).

### 3.3 URLs and languages

- **The store's default language is at the root, the other under a prefix:** `/products/লাল-শাড়ি` and `/en/products/red-saree` (Q3). Each language has its own URL, which hreflang needs. Phase 0's `?lang=` switch goes away.
- **Paths:** `/` (home), `/products/{slug}`, `/categories/{slug}`, `/collections/{slug}`, `/search?q=`, `/pages/{slug}`, `/sitemap.xml`, `/robots.txt`, `/media/{file}`, `/api/*` (Phase 0's proxy).
- **Old slugs** answer with a 301 to the current one, from Phase 2's redirect table. The redirect is cached like a page.
- **A store with an active primary custom domain** gets a 301 from its `{slug}.managemind.store` address to the same path on the custom domain, for every GET (PLAN.md). `/api/*` and `/media/*` keep working on both hosts.
- **Filters, sort and page** are query parameters (`?brand=…&size=m&sort=price&page=2`). The cache key keeps only these known parameters, normalized and sorted, so `?utm_source=` and random parameters don't fill the cache. Filtered pages are `noindex, follow`, with the unfiltered page as canonical.

### 3.4 Themes

**A theme is a folder of Astro templates plus a typed settings schema.** Adding a theme later means adding a folder; nothing in the core changes (PLAN.md). This phase builds one theme, `classic`, mobile first.

- **Design tokens** (zod-validated):
  - colours: primary, on-primary, background, surface, text, accent, sale badge;
  - font: the phone's own font by default (Q5). Android ships Noto Sans Bengali, so the default costs no download. Two optional self-hosted web fonts (Hind Siliguri, and a Latin pairing), subset and `font-display: swap`, loaded only when chosen;
  - corner radius (none, small, large), logo, favicon, product card style (image ratio 1:1 or 3:4; show compare-at price; show brand).
- **Contrast is checked when saving.** Colour pairs below WCAG AA (4.5:1 for text) are refused with a message, so a store can't break its own accessibility.
- **The homepage is a list of sections**, at most 12, each with its own settings and text in both languages:
  - hero banner (1–3 slides, image, heading, button to a category, collection, product or page);
  - category grid; collection carousel; product grid from a collection;
  - image with text; rich text; trust badges (cash on delivery, delivery time, returns), with the store's own text;
  - announcement bar (shown on every page; holiday mode uses it, §3.8).
- **Presets** are starting section lists and tokens: **fashion** (large hero, collections first), **grocery** (category grid first, deals collection, compact cards), **general**. The reference stores (§1) decide their details (Q6). Choosing a preset replaces the draft; staff can then change anything.
- **Other pages have fixed templates** with a few settings (show related products; show specifications as a table or a list).
- **Banner images** go through Phase 2's upload pipeline, resized to 800, 1200 and 1600 px (product images stay at 400, 800 and 1200), so a full-width hero is sharp on desktop.
- **Storage:** `theme` (published) and `themeDraft` in the store's settings JSON. Publishing copies the draft and purges the store. The schema has a version, so later changes migrate in code.
- **Live preview:** the theme editor shows the storefront in an iframe at `{store host}/__preview?token=…`.
  - The token is short-lived (15 minutes) and signed by the API. The storefront passes it to the API, which returns the draft.
  - Preview responses are `no-store` and `noindex`, and may be framed only by the admin host (`frame-ancestors`).
  - Colour and font changes reach the iframe instantly through `postMessage` (CSS variables). Section changes save the draft, debounced, and reload the iframe.

### 3.5 Pages

| Page | Contents |
| --- | --- |
| Home | The theme's sections |
| Category | Name, description (Phase 2's renderer), child categories, products with filters, sort and pages |
| Collection | The same, for manual and rule-based collections (rules are evaluated by SQL when read, then cached) |
| Product | Image gallery, title, brand, price with compare-at, variant picker, availability, description, specifications (visible attributes), related products from the same category, breadcrumbs. The "add to cart" button arrives in Phase 4; until then the chat buttons (§3.10) are the call to action |
| Search | Results with the same filters (§3.7) |
| Static pages | About, contact, privacy, returns, delivery, terms, and custom pages: rich text, written by the store in both languages (Q12) |
| Not found, store not found, maintenance | Phase 1's pages, restyled in the store's theme where there is a store |

- **Listings** show 24 products a page, with "next" and "previous" links, so they work without JavaScript and crawlers can follow them.
- **Sort:** featured (the collection's order, or newest), newest, price low to high, price high to low.
- **The JavaScript islands are small:** the variant picker (it updates price, availability and image from data already in the page, with no API call), the image gallery, the mobile menu, the consent banner and the tag loader. Everything else is HTML and CSS.
- **Display settings:** Bangla or Western digits for prices and dates (Phase 1's `display.numerals`). Image alt text comes from Phase 2's alt fields, or from the product name when blank.

### 3.6 SEO

- **Per store:** `robots.txt` (with the sitemap, disallowing `/api/`, `/search` and `/__preview`) and a sitemap index with product, category, collection and page sitemaps. Each URL lists its other language through `xhtml:link`.
- **On every page:** a canonical URL on the store's primary host; `hreflang` for `bn`, `en` and `x-default`; Open Graph and Twitter tags with the product image.
- **Structured data (JSON-LD):** `Product` with `Offer` (price in BDT, availability, brand, SKU) on product pages; `BreadcrumbList`; `Organization` and `WebSite` with a `SearchAction` on the home page.
- **Indexing is off until the store goes live** (Q7). A new setting, `storefront.indexing`, is off by default: every page is `noindex` and `robots.txt` disallows everything. The owner turns it on when the store is ready, which in practice means once Phase 4's checkout exists. Previews are always `noindex`.

### 3.7 Search and filters

- **Search uses `pg_trgm`** (PLAN.md) on product titles, tags and SKUs, in the shopper's language and the store's default language. Results are ranked by similarity. There are at most 48 results; anything more means the shopper should refine the search.
- **A problem found while planning:** the local database is created with the `C` locale, where `pg_trgm` makes **no trigrams at all from Bangla text**. `show_trgm('লাল শাড়ি')` returns `{}`, so every Bangla search finds nothing. Under `C.UTF-8` the same text works (`similarity('শাড়ি', 'শাড়ী')` = 0.5). CI's `postgres:18` image uses `en_US.utf8`, which works. Neon's default is `C.UTF-8` for projects created since November 2024 (Neon's compatibility docs), but this hasn't been checked on our branches. PR 1:
  - creates the local databases with `C.UTF-8` (an ADR 0008 amendment);
  - adds a test that fails if Bangla makes no trigrams;
  - makes the deploy's migration step check `datctype` on production and preview. Phase 2's admin product search is affected the same way, and this fixes it too.
- **Bangla spelling variants.** Shoppers type the same word several ways. Search compares a normalized form, built by an immutable SQL function `app.search_text()` with an expression index:
  - NFC, lowercase, and zero-width joiners removed;
  - long and short vowel signs folded: ী→ি, ূ→ু;
  - ড় and ঢ় folded with their decomposed forms; য় with its decomposed form.

  So "শাড়ী" finds "শাড়ি". Search by Latin spelling of Bangla words ("saree" for "শাড়ি") isn't attempted; English titles and tags cover it.
- **New indexes:** trigram on the normalized title and tag, and on lowercased SKUs (only titles and tags have one today).
- **Filters** on search, category and collection pages:
  - price range;
  - in stock only;
  - category (on search);
  - brand and other filterable attributes (Phase 2);
  - option values across products, using Phase 2's normalized option keys ("Colour: Red").

  Each filter shows its values with counts, from one grouped query per page miss.
- **Price sorting and filters** need a product's lowest and highest variant price. Products gain `price_min` and `price_max`, which the catalog service keeps in the same transaction as any variant price change, with an index for sorting.
- **Rate limit:** search misses are limited per IP (30 a minute) by Phase 1's Durable Object limiter. Cached results cost nothing. A query is at most 100 characters.

### 3.8 Holiday mode

- **Settings:** `storefront.holiday` holds a start and end time (Asia/Dhaka, stored in UTC) and a message in each language.
- **The banner** uses the announcement-bar slot. The page includes the dates, and a few lines of inline script show the banner during the window. So a cached page shows it at the right moment without a purge at midnight; the daily cron runs at 08:07 Dhaka, too late for that.
- **Phase 4's checkout refuses orders** during the window, on the server. This phase stores the setting and shows the banner.

### 3.9 Custom domains

The flow, using Cloudflare for SaaS custom hostnames on `managemind.store` (100 free, then $0.10 each per month):

1. **Staff add a domain** in Settings → Domains, for example `www.shop.com.bd`.
   - The API refuses our own domains, the store domain and hostnames another store has.
   - It warns about a bare domain and recommends `www` (Q9). Cloudflare's Free plan can't serve a bare domain ("apex proxying" is Enterprise only), so the bare domain should forward to `www` at the client's registrar.
   - A store can have at most 2 domains.
2. **The API creates the custom hostname** through Cloudflare's API, with HTTP certificate validation. It stores Cloudflare's ID in `tenant_domains.provider_ref`, with status `pending`.
3. **The admin shows the DNS record to add:** `CNAME www → stores.managemind.store`. When the client's DNS is itself on Cloudflare, it also shows the TXT ownership record Cloudflare returns. The instructions are in Bangla and English, with short steps for the registrars Bangladeshi clients use most.
4. **Checking without a timer** (PLAN.md: nothing polls the database on a short timer). Re-checks are delayed queue messages: after 1, 5, 15 and 60 minutes, then once a day from the daily cron for 7 days. A "Check now" button checks at once (rate-limited). When Cloudflare reports the hostname and its certificate active, the domain becomes `active`. After 7 days it becomes `failed` with Cloudflare's reason, and can be retried.
5. **Make primary:** the owner chooses which active domain is primary.
   - The KV host map is updated (ADR 0015's `tenant_domain.*` events, already handled).
   - The store's pages are purged.
   - The subdomain starts redirecting (§3.3). Canonical URLs, the sitemap and later feeds use the primary.
6. **Removing a domain** deletes the custom hostname at Cloudflare first, then marks the row `removed`, so a hostname can't stay attached after a store lets it go.
7. **The daily cron re-checks active domains** against Cloudflare: one list call for the whole zone. A hostname whose CNAME was removed, or whose certificate failed to renew, is flagged in the admin, and the owner is emailed.

**Infrastructure (provisioning, idempotent):** the fallback origin `stores.managemind.store` (a proxied placeholder record, like Phase 1's wildcard), and a Worker route `*/*` on the `managemind.store` zone to the storefront, which catches custom hostnames. The bare `managemind.store` then reaches the storefront too, which redirects it to the main site. A new ADR (0019) records this.

**Purge on custom hostnames:** ADR 0007 decision 8 left one question open: does purging the `managemind.store` zone by tag reach pages cached on custom hostnames? PR 19 tests it on the owner's test hostname (Q8) before the acceptance run. If it doesn't, those pages fall back to purge by URL prefix per host, which has its own, much larger rate limit (ADR 0007).

### 3.10 Tracking, consent and chat

- **Tracking settings:** `storefront.tracking` holds a Meta Pixel ID and a GA4 measurement ID, each validated by format.
- **No tag loads before consent.** A banner offers "Accept" and "Reject", equally prominent. The choice is a first-party cookie that only the browser reads, kept 6 months, and the footer has a link to change it. The default wording (Q11: approved), which each store can change in its storefront settings (`storefront.consent`, both languages, at most 300 characters):
  - **bn:** "আমরা আপনার অভিজ্ঞতা উন্নত করতে এবং বিজ্ঞাপন মাপতে কুকি ব্যবহার করি। আপনি কি সম্মত?" · **গ্রহণ করুন** · **প্রত্যাখ্যান করুন**
  - **en:** "We use cookies to improve your visit and measure our ads. Do you agree?" · **Accept** · **Reject**
  - Stores without a Pixel or GA4 ID show no banner, because they set no such cookies.
- **Events:** this phase sends page view (`PageView`, `page_view`) and product view (`ViewContent`, `view_item`). A small event helper with an event ID per event is ready for Phase 4's add to cart, checkout started and purchase, and for Phase 9's server-side Conversions API, which de-duplicates by that ID.
- **Bundle budget:** our JavaScript stays under 50 KB compressed on product pages. Meta's and Google's scripts (about 100 KB together) load only after consent and after the page has loaded, so they don't count against the LCP target. Lighthouse runs without consent.
- **Chat buttons:** `storefront.chat` holds a WhatsApp number (E.164), a Messenger page username, a greeting in each language and where to show them (every page, product pages only, or nowhere).
  - On a product page the WhatsApp greeting includes the product's name and URL: `wa.me/8801…?text=…`.
  - They are plain links and CSS, with no script. Since there's no cart until Phase 4, they are also how a shopper orders from a pilot store before checkout exists.

### 3.11 Business details

- **The store profile gains business details:** registered business name, trade license number, DBID (the Digital Business ID from the Digital Commerce Operation Guidelines), and BIN (the VAT registration number, when VAT is on). The address and contact details are already there.
- **Where they appear:** in the storefront footer, and on invoices in Phase 4. Every field is optional until the legal review says which are required.

### 3.12 Who can change what

| Permission | What it covers |
| --- | --- |
| `settings.read` / `settings.write` | Theme, homepage, static pages, storefront settings (tracking, chat, consent text, holiday, indexing, display), business details, and custom domains (Q10). Owner and Manager write; Staff and Viewer read (Phase 1's roles) |

### 3.13 New dependencies

| Package | Version | Where | For |
| --- | --- | --- | --- |
| `@lhci/cli` (Lighthouse CI) | latest published before 2026-09-30 | CI only | Performance budgets on the preview (§8) |
| Hind Siliguri, subset `woff2` files | — | Storefront static assets | The optional web font (§3.4); served from our own host, so there are no third-party requests |

No dependency is added to a Worker. The storefront's islands use plain TypeScript, not a framework, to stay inside the 50 KB budget.

## 4. Data model

**Store schema** (every table starts with `tenant_id`, FORCE RLS, joins `STORE_TABLES`):

| Table | Key columns | Notes |
| --- | --- | --- |
| `pages` | `id`, `kind` (about, contact, privacy, returns, delivery, terms, custom), `published`, `position`, timestamps | At most one row per kind except `custom`; at most 30 pages |
| `page_translations` | (`page_id`, `locale`), `title`, `slug`, `body` jsonb (Phase 2's rich-text schema), `seo_title`, `seo_description` | Unique (`tenant_id`, `locale`, `slug`); renamed slugs use Phase 2's `slug_redirects` with a new entity type `page` |
| `products` (changed) | **New:** `price_min`, `price_max` (poisha) | Kept by the catalog service; index (`tenant_id`, `status`, `price_min`) |
| Search indexes | Trigram on `app.search_text(title)`, `app.search_text(tag)` and `lower(sku)` | Replace Phase 2's plain title and tag trigram indexes |

**Platform schema:**

| Table | Change |
| --- | --- |
| `tenant_domains` | **New:** `ssl_status`, `ownership_record` jsonb (the TXT record Cloudflare returns, when needed), `last_checked_at`, `check_attempts`, `failure_reason`. The status flow `pending → active | failed`, `active | failed → removed` becomes a state machine in code with a history row per change |

**Settings (typed JSON, no migration):**

- `theme`, `themeDraft` (§3.4);
- `storefront`: `indexing`, `tracking`, `consent`, `chat`, `holiday` (§3.6–3.10);
- `profile` gains the business details (§3.11).

**Events:**

- new: `inventory.availability.changed` (`productIds`), `catalog.page.changed`, `theme.published`;
- `tenant.updated` gains the fields `storefront` and `theme`;
- `tenant_domain.removed`.

## 5. Services (`packages/core`)

- **`storefront`** (new, read-only): the page-shaped queries.
  - It reads the catalog through the catalog module's queries, never its tables directly (PLAN.md conventions). The catalog module gains published-only read functions for this.
  - Each query returns its data plus the cache tags it touched.
  - Each page miss costs one transaction with few round trips, and no N+1 queries.
- **`catalog`** (changed): `price_min` and `price_max` upkeep; published-only reads by slug with redirect resolution; listing with filters, facets, sort and pages; search with normalization; static pages.
- **`inventory`** (changed): emits `inventory.availability.changed` when a variant's available stock crosses zero.
- **`theme`:** draft, publish, presets, contrast check, preview tokens.
- **`tenancy` (domains):** the custom-domain state machine, behind a `CustomHostnameProvider` interface with one Cloudflare adapter in `packages/providers` (PLAN.md: providers behind interfaces). Tests use a fake provider.

## 6. API

### 6.1 Storefront (`/v1/store/*`, public, reached only through the storefront's service binding with the store's host)

| Endpoint | Returns |
| --- | --- |
| `GET /v1/store/pages/home` | Layout (theme tokens, header categories, footer pages, settings the page needs) and the homepage sections' data |
| `GET /v1/store/pages/products/{slug}` | Layout, product, variants, media, specifications, related products; or `{ redirect }` for an old slug |
| `GET /v1/store/pages/categories/{slug}`, `…/collections/{slug}` | Layout, the category or collection, a page of products, facets |
| `GET /v1/store/pages/search?q=` | Layout, results, facets |
| `GET /v1/store/pages/pages/{slug}` | Layout and the static page |
| `GET /v1/store/pages/layout` | The layout alone, for not-found pages |
| `GET /v1/store/sitemap/{part}` | One sitemap's URLs with their alternates |
| `GET /v1/store/preview/{route}?token=` | The same as the page endpoints, with the draft theme; never cached |

- **Every response carries the locale and an `x-cache-tags` header**, which the storefront moves into `Cache-Tag`.
- **Responses are designed for caching** (PLAN.md): stable URLs, an `ETag` (`If-None-Match` answers 304), and `Cache-Control: public, max-age=60`.
- **The tenant comes only from the forwarded host**, which the storefront sets from the request's real host. A client can't choose another store (PLAN.md: never trust the client for tenant identity).

### 6.2 Admin (`/v1/admin/*`)

| Area | Endpoints |
| --- | --- |
| Theme | `GET /theme` (draft and published), `PUT /theme/draft`, `POST /theme/presets/{name}` (replaces the draft), `POST /theme/publish`, `POST /theme/preview-token` |
| Pages | `GET /pages`, `POST /pages`, `GET /pages/{id}`, `PATCH /pages/{id}`, `DELETE /pages/{id}` |
| Domains | `GET /domains`, `POST /domains`, `POST /domains/{id}/check`, `POST /domains/{id}/primary`, `DELETE /domains/{id}` (`settings.write`, except the list) |
| Settings | `PATCH /store` gains `storefront` and the business details |

## 7. Admin screens

- **Online store → Theme:**
  - the preset picker;
  - tokens (colours with the contrast check, font, radius, logo, favicon, card style);
  - the homepage section list (add, remove, reorder by buttons and keyboard, edit each section's settings in both languages);
  - the live preview, which sits beside the editor on desktop and is a "Preview" tab on phones;
  - "Publish".
- **Online store → Pages:** a list and the rich-text editor from Phase 2, with Bangla and English tabs.
- **Online store → Settings:** tracking IDs, the consent banner's text, chat buttons, holiday mode, search-engine indexing, digits.
- **Settings → Domains:**
  - the store's default address;
  - each custom domain with its status, the DNS record to add (with a copy button), "Check now", "Make primary" and "Remove".
- **Settings → Store profile** gains the business details.
- **A "View store" link** in the navigation opens the store on its primary host.

Every new screen gets axe checks at both viewports in the E2E suite, as in Phases 1 and 2.

## 8. Performance budgets

PLAN.md's targets on a mid-range Android phone over 4G: LCP under 2.5 s, INP under 200 ms, CLS under 0.1, and product-page JavaScript under about 50 KB compressed.

- **Lighthouse CI** runs on every preview against the demo stores' home, category and product pages, with mobile emulation and 4G throttling. It fails when LCP is over 2.5 s, CLS over 0.1, or Total Blocking Time over 200 ms (INP needs real users; TBT is its lab stand-in). It also checks accessibility (score at least 95) and SEO basics.
- **A JavaScript budget check** in the build fails when any page's islands pass 50 KB compressed.
- **How the pages stay fast:**
  - images use `srcset` with the three widths, explicit width and height (no layout shift), `fetchpriority="high"` on the first image and lazy loading below the fold;
  - CSS is inlined per page (no extra request);
  - with the default font there is no font download;
  - there is no framework runtime.
- **Real-user numbers:** Cloudflare Web Analytics is free and needs no cookie. It's optional per store, off until the owner decides (it would also need a mention in the privacy page).

## 9. Tests

| Layer | Tests |
| --- | --- |
| Unit (`shared`) | Theme schema and presets parse; the contrast check; the cache key normalization (parameter whitelist and order, Bangla paths); URL building per locale and host; event-to-tag mapping; the holiday window in Asia/Dhaka; the wa.me link builder |
| Integration (`core`, Postgres) | Published-only reads (drafts and archived products never appear, by slug or listing); slug redirects for products, categories, collections and pages; filters and facet counts; sort by price uses `price_min`, which stays correct after variant edits and imports; search finds Bangla spelling variants and SKUs; **a test that Bangla makes trigrams**, so a `C`-locale database fails loudly; the availability event fires only when stock crosses zero; the domain state machine with a fake provider |
| Isolation | Every new store endpoint joins the suite: store A's host never returns store B's product, category, collection, page or sitemap entries by slug, including slugs both stores use. Admin endpoints join through their fixtures |
| Storefront (Vitest) | The cache layer with a fake cache: a hit makes no KV read and no API call, a miss stores the page with its tags, `/api/*` and preview are never stored; the subdomain-to-primary redirect; `noindex` when indexing is off; consent gating (no tag script in the HTML before consent) |
| Purge consumer | Events become the right tags; debouncing per store; more than 100 tags becomes a store purge; an empty bucket or a 429 retries through a delayed message; nothing is dropped |
| E2E (preview) | Browse home, a category with filters, a product with the variant picker, search in Bangla and English, a static page, the language switch and hreflang, the consent banner; staff change the theme with the live preview, publish, and the store shows it; add a custom domain and see its pending instructions (against a fake provider on previews). Axe at both viewports on every page and screen |
| Lighthouse | §8, on every preview |
| CPU | The preview step adds a page miss for each page type. Production's deploy smoke adds a cache hit |

## 10. Free-tier impact

| Resource | Free limit | Phase 3 | Note |
| --- | --- | --- | --- |
| Worker requests | 100,000/day | Every page view, image and asset request on a store host is a storefront request, hit or miss | Cache hits are cheap on CPU but still count. About 300 visitors × 3 stores × ~10 requests is ~10,000 a day, as PLAN.md estimates |
| Worker CPU | 10 ms | Hits about 1–2 ms (to verify, §3.1); misses render a page | The 41 ms p90 baseline is investigated in PR 9 |
| KV reads | 100,000/day | Only on misses (hits are answered before the host lookup) | |
| Hyperdrive queries | 100,000/day | A few per page miss | Misses are a small share once pages are warm in Dhaka |
| Neon compute | 100 CU-hours/month | Wakes only on misses, admin use and the daily cron | The one-day cache lifetime keeps misses rare (Q4) |
| Cache purges | 25 calls, refilling 5 a minute, per account | A handful a day per active store | Counted by the Durable Object (ADR 0007) |
| Queue operations | 10,000/day | Purge events, plus a few delayed messages per domain check | |
| Durable Object requests | 100,000/day | Purge counter calls, plus search misses (rate limit) | |
| R2 reads | 10 million/month | Image misses only | Images are cached for a year |
| Custom hostnames | 100 free, then $0.10 each per month | At most 2 per store | Above 100 hostnames, ask before paying (PLAN.md) |

## 11. Pull requests

| # | Scope |
| --- | --- |
| 0 | This plan, the PLAN.md status update and README fixes |
| 1 | `db`: `C.UTF-8` for local databases, the Bangla trigram test, the deploy's locale check (ADR 0008 amendment); `app.search_text()` and the new trigram indexes |
| 2 | `shared`: theme schema, tokens, sections and presets; storefront settings (indexing, tracking, consent text, chat, holiday); business details; contrast check; URL and cache-key helpers; cache tag builders |
| 3 | `db`: pages and their translations, `price_min`/`price_max` with a backfill, `tenant_domains` columns, the `page` redirect type |
| 4 | `core`: published-only catalog reads, listing with filters, facets and sort, search, price upkeep, the availability event |
| 5 | `core`: the storefront page queries; static pages; theme draft, publish and preview tokens |
| 6 | `api`: `/v1/store/pages/*`, sitemap and preview endpoints with ETags and tags; admin theme and pages routes; isolation fixtures; SDK |
| 7 | `api`: the purge consumer (event-to-tag mapping, debounce, Durable Object counter, delayed retries) and `CF_STORE_TOKEN`; ADR 0018 (page tags and purge rules). **Needs the token** |
| 8 | `providers` and `api`: Cloudflare for SaaS custom hostnames (create, check through delayed messages, daily re-check, remove), domain routes; provisioning of the fallback origin and the `*/*` route; ADR 0019 (custom domains). **Needs Cloudflare for SaaS on** |
| 9 | `storefront`: routing (locale prefix, primary-host redirect, old slugs), the page cache layer, `/media/*` from R2, the CPU baseline investigation |
| 10 | `storefront`: the `classic` theme (tokens to CSS variables, header, category menu, footer, announcement bar) and the homepage sections with three presets. **Needs the reference stores** |
| 11 | `storefront`: product page (gallery, variant picker, specifications, related), category and collection listings with filters, sort and pages |
| 12 | `storefront`: search, static pages, not-found and maintenance pages in the theme, holiday banner, digits, alt text |
| 13 | `storefront`: robots, sitemaps, canonical, hreflang, Open Graph, JSON-LD, the indexing switch |
| 14 | `storefront`: consent banner, Pixel and GA4 loader with the event helper, chat buttons. **Needs the test IDs** |
| 15 | `admin`: theme editor with presets, sections and live preview |
| 16 | `admin`: pages, storefront settings, business details, "View store" |
| 17 | `admin`: domains screen |
| 18 | CI: Lighthouse budgets, the JavaScript budget check; E2E storefront and admin flows with axe; CPU steps for page misses |
| 19 | Production checks: purge on a custom hostname (ADR 0007 decision 8), cache hit without a database query in Workers Logs, two stores on two domains. **Needs the test domain** |
| 20 | Phase 3 report |

As in Phase 2, these can ship as one pull request with one commit per step if the owner prefers (Phase 2's choice); each step stays reviewable on its own.

## 12. Acceptance criteria and how they're verified

| Criterion | Verification |
| --- | --- |
| Two stores with different themes and languages served from the same deployment, each on its own domain | In production: `demo-fashion` (fashion preset, Bangla default) on the owner's test hostname (Q8), and `demo-grocery` (grocery preset, English default) on `demo-grocery.managemind.store`. A Playwright check against production loads both: each page has its own theme tokens and `lang`, canonical URLs on its own host, and `demo-fashion.managemind.store` 301s to the custom domain. Previews run the same flows with the dev store selector |
| A cached product page is served without any database query (verified in logs) | Production's deploy smoke requests a product page twice. The second response has `x-cache: hit`, and Workers Logs show that request ID only on the storefront Worker: no KV read, no API invocation, so no Hyperdrive query. The storefront's unit test pins the same behaviour on every PR |

## 13. The owner's answers (2026-10-16)

| # | Question | Answer |
| --- | --- | --- |
| Q1 | Scope | **Cart, checkout, order confirmation, order tracking and the shopper account move to Phase 4.** The chat buttons are the call to action until then |
| Q2 | Estimate | **About 4 weeks** |
| Q3 | Language URLs | **The default language at the root, the other under a prefix** (`/en/…` or `/bn/…`) |
| Q4 | Cache lifetime | **One day,** with purges keeping pages fresh |
| Q5 | Fonts | **The phone's own font by default,** Hind Siliguri as an optional self-hosted web font |
| Q6 | Presets | **Fashion, grocery and general,** shaped by the owner's reference stores before PR 10 |
| Q7 | Search engines | **Stores are `noindex` until the owner turns indexing on** per store |
| Q8 | Test custom domain | **A subdomain of a domain the owner has elsewhere** (for example `shop-test.<their domain>`), with a CNAME to `stores.managemind.store`. It behaves like a client's `www`; if that domain is on Cloudflare, the TXT ownership record is tested too. The hostname is due before PR 19 |
| Q9 | Bare domains | **`www` only;** the admin explains how to forward the bare domain at the registrar |
| Q10 | Who manages domains and the theme | **Owner and Manager for both** (`settings.write`). No new permission |
| Q11 | Consent banner | **The wording in §3.10, as the default, editable per store** |
| Q12 | Policy pages | **Empty, with suggested headings,** until the legal review provides templates |

**Still needed from the owner:**

- Cloudflare for SaaS turned on (before PR 8) and the `CF_STORE_TOKEN` token (before PR 7);
- the reference stores (before PR 10);
- the test tracking IDs and chat links (before PR 14);
- the test hostname (before PR 19);
- confirmation that Search Console is verified with alerts on for both domains.
