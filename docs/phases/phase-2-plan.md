# Phase 2 plan — Catalog, media and inventory

- Status: Draft, waiting for the owner's approval (PLAN.md: no code before approval)
- Date: 2026-10-15
- Scope: PLAN.md "Phase 2 — Catalog, media and inventory"

## Goal

Clients build their full catalog in Bangla and English, with options and variants, prices, images and stock. They can type it in or import it from a spreadsheet, and every stock change is traceable.

Two acceptance criteria, from PLAN.md:

1. A client imports 500 products with variants from a spreadsheet in one go, and the catalog appears correctly in both languages.
2. Every stock change is in the ledger, and on hand equals the sum of movements for every variant (a test enforces this).

**Estimate: 4 weeks.** PLAN.md says 3. The extra week covers two things:

- The import has to fit the Free plan's CPU limit, so it is a chunked job, not one request (§3.6).
- The rich-text editor needs a real-phone check for Bangla input (§3.4).

**Storefront pages are Phase 3.** This phase designs slugs, translations and events so Phase 3 can render and cache products without schema changes.

## 1. Prerequisites status

| Item | Status |
| --- | --- |
| Phase 1 | Done (report: `docs/phases/phase-1-report.md`) |
| Owner: first super admins (Phase 1 Q3) | **Open.** Phase 2 can be built and tested on previews without them, but production use needs them |
| R2 buckets `managemind-files` and `-preview` with lifecycle rules | Exist (Phase 0). The API Worker gets an R2 binding in this phase |
| CPU | Staff requests already take about 23 ms at p50 on warm isolates (Phase 1 report §3). This phase adds heavier writes, so §3.6 and Q1 matter |

## 2. Research: what is borrowed

| From | What |
| --- | --- |
| Shopify | Up to 3 options per product, variants as option combinations, a variant limit; handles with URL redirects when they change; manual and automated ("smart") collections |
| Saleor | Per-locale translation tables next to the base row, with the store's default locale as fallback; categories as a tree and collections for merchandising |
| Medusa (inventory module) | Levels per item and location with `reserved` kept apart from `on hand`; every change goes through one service |
| Accounting practice | An append-only stock ledger; the level is a cache of the ledger's sum, checked, never edited directly |

## 3. Design decisions to approve

### 3.1 Products, options and variants

- A product has 0–3 options (for example size and colour), each with values. Its variants are the combinations: a product without options has one variant.
- **At most 100 variants per product.** This keeps the editor's grid usable on a phone and each save small.
- Editing options regenerates the combinations, keeping every existing variant whose combination still exists, with its SKU, price, stock and history. Variants whose combination disappears are archived, not deleted, so stock history and future orders still resolve.
- **Prices are integers in poisha,** using the shared money helpers. Each variant has a price, an optional compare-at price and an optional cost price. Input accepts Bangla digits, `৳` and thousands separators.
- **SKUs are optional, but unique per store when set.** The import matches on SKU.
- **Products are archived, never deleted,** except a draft that has never been ordered. Orders arrive in Phase 4 and must always resolve.

### 3.2 Translations

- Every customer-facing text has one row per locale in a translation table: product title, slug, description and SEO fields; option names and value labels; category and collection names, slugs and descriptions; image alt text.
- The store's default locale is required, and the other is optional. A missing translation falls back to the default locale, at read time.
- **Slugs are unique per store, per locale and per kind** (product, category, collection). Changing one writes a redirect row, so old links keep working (Phase 3 serves the 301).
- Slugs are generated from the title. Bangla titles are kept in Bangla in URLs (percent-encoded on the wire, readable in the address bar), and the owner can edit them. Q11 covers transliteration.

### 3.3 Categories and collections

- **Categories** form a tree for navigation, at most 3 levels deep. A product can be in several categories.
- **Collections** are for merchandising, and come in two kinds:
  - **manual:** a chosen, ordered list of products;
  - **rule-based:** up to 5 conditions, all of which must match (Q7). A condition can be: in a category, price between two values, title contains a word, or created in the last N days.
- Rule-based collections are evaluated by SQL when read, not stored as membership, so they never go stale. Phase 3 caches the pages.

### 3.4 Descriptions: sanitized structured content

- The admin uses the TipTap editor, loaded only on the description editor (about 123 KB gzipped, a separate chunk). It is limited to paragraphs, headings (levels 2–3), bold, italic, bullet and numbered lists, and links.
- The stored format is ProseMirror JSON. The API validates it against the same whitelist with zod: unknown nodes or marks are refused, and links may only be `http(s)` or `mailto`.
- A small server renderer of about 60 lines turns it into escaped HTML. Phase 3's storefront uses that renderer, so no editor code reaches shoppers.
- **Risk:** ProseMirror's handling of Android keyboards is good but not perfect. PR 12 is tested on real Android phones with Gboard Bangla and Ridmik before merge (Q6).
  - **Fallback if typing is unreliable:** a plain text area with a small Markdown subset, converted to the same JSON on the server. The stored format doesn't change.

### 3.5 Images

1. **The admin resizes photos in the browser** to fixed widths of 400, 800 and 1200 px (Q3). It keeps the original's orientation and drops EXIF, so phone GPS data never leaves the device.
   - **Android** encodes WebP natively.
   - **iPhones can't encode WebP** in the browser: Safari silently returns PNG, and Apple won't fix it. The admin detects this and uses JPEG at quality 0.82 instead.
   - Q2 offers the alternative: a 125 KB WebP encoder loaded only on iPhones.
2. **Uploads go through the API Worker into R2** with the binding, one request per width. The Worker:
   - checks the size (at most 2 MB per resized file);
   - checks the type from the file's first bytes, not its name;
   - checks that the SHA-256 the browser computed matches the body;
   - stores the file at `objectKey('file', tenant, 'media/<sha256>-<width>.<ext>')`, deduplicated by content.
   - This needs no S3 keys and no CORS rules, and the server enforces every limit. Presigned URLs can't enforce a size limit on R2.
3. **Rows:** `media` holds one row per image (hash, type, dimensions, alt text per locale). `product_media` orders a product's images, and a variant can point at one of them.
4. **Cleanup:** a weekly pass in the daily job removes images no product or variant has used for 7 days, plus their files.
5. **Limits:** at most 10 images per product (Q3). Original photos up to 15 MB are accepted, but only on the phone; they never upload.

### 3.6 Import and export

PLAN.md asks for a queued job with a dry run and row-level errors. The Free plan's CPU limit (10 ms per request and per queue invocation) shapes how.

1. **The browser parses the file and maps the columns.** It reads .xlsx with `read-excel-file` and .csv with `papaparse`, each loaded only on the import screen.
   - Columns match the export's headers in either language. Unknown columns can be mapped by hand or ignored.
2. **Dry run, in the browser:** the shared zod schemas check every row (prices, Bangla digits, options, SKU duplicates within the file, image URLs). The screen shows the errors per row before anything reaches the server.
3. **Staging:** the browser uploads the normalized rows as JSON to R2 (`tmp-uploads/…`, deleted by the lifecycle rule after a day) and creates an `import_jobs` row.
4. **Processing:** one queue message per chunk of products.
   - A chunk starts at 10 products and is tuned by measurement.
   - The consumer writes each chunk in a few set-based statements (`insert … select from unnest(…) on conflict …`).
   - It records progress and any row errors the database finds (an existing SKU in another product, a taken slug), then queues the next chunk.
   - Closing the browser doesn't stop the import.
   - 500 products is about 50 messages, roughly 150 of the Free plan's 10,000 queue operations a day.
5. **Matching:**
   - A row with a known SKU updates that variant.
   - A row without one creates a product, grouped by the "product handle" column, as in Shopify's format.
   - Images by URL are fetched in a later, separate step, not in the chunk, because each fetch is a subrequest (50 per invocation).
6. **Export:** the browser pages through the API and writes .xlsx (`write-excel-file`) or .csv (with a BOM, so Excel shows Bangla). No Worker CPU is spent building files.

**CPU:** a chunk will likely take tens of milliseconds, like other staff writes, which ADR 0003 tolerates as long as nothing is stopped. The preview CPU step gains the import chunk and the product save. The chunk size is set from those numbers (Q1).

### 3.7 Inventory

- **Stock locations:** each store gets one default location at creation, and existing stores get one in the migration. The model allows more (PLAN.md).
- **Levels:** `inventory_levels` holds one row per variant and location, with `on_hand` and `reserved`. `available = on_hand - reserved` is computed, never stored.
- **The ledger:** `stock_movements` is append-only; the app role may insert and read only, as with the audit log. Each movement has a type (receive, sale, reservation, release, adjustment, return), a signed quantity, a reason, a reference (order, import, purchase) and the actor.
- **One path:** the inventory service is the only code that writes levels or movements. It writes both in one transaction and locks the level row, so concurrent changes can't lose an update.
- **The invariant:** for every variant and location, `on_hand` equals the sum of the on-hand movements and `reserved` the sum of reservation and release movements. It is enforced three ways:
  - **a property test** that runs thousands of random operation sequences, including concurrent ones, and checks the invariant after each;
  - **a database check query** run by the integration tests;
  - **a daily check** that alerts (Sentry) if it ever drifts.
- **Thresholds:** low-stock threshold and allow-backorder are per variant. Without backorder, a sale or reservation that would make available stock negative is refused. Phase 4 uses reservations at checkout.

### 3.8 VAT settings

- **Tenant settings gain a `tax` section:** VAT on or off, the standard rate in basis points, and whether prices include VAT.
  - The default is off, because many small merchants aren't VAT-registered. When turned on, the rate defaults to 15%, Bangladesh's standard rate; the owner or their accountant should confirm (Q4).
- **Products can set a VAT category,** for example a reduced rate or exempt, from a list in the same settings.
- Phase 4 calculates VAT per order line and stores it with the line. This phase only stores the settings and shows prices with and without VAT in the editor when VAT is on.

### 3.9 Who sees what

| Permission | What it covers |
| --- | --- |
| `catalog.read` / `catalog.write` | Products, categories, collections, media, import and export (all defined in Phase 1) |
| `inventory.read` / `inventory.write` | Levels, movements, adjustments, stock columns in imports |
| **New: `catalog.cost`** | Cost prices, in the editor, the export and the API. Owner and Manager by default (Q5); everyone else gets the fields left out, not blanked |

### 3.10 New dependencies (ADR 0012 rows in the PR that adds each)

All were published before 2026-09-30, and all load only on the admin screens that use them.

| Package | Version | Size (gzip) | For |
| --- | --- | --- | --- |
| `@tiptap/react` and extensions | 3.31 | About 123 KB (one chunk, the description editor only) | Rich text (§3.4) |
| `read-excel-file` | 9.3 | 17 KB | .xlsx import |
| `write-excel-file` | 4.1 | 20 KB | .xlsx export |
| `papaparse` | 5.7 | 7 KB | .csv import and export |

The npm `xlsx` package (SheetJS) is not used: it is stale on npm at 0.18.5 with two published advisories, and the fixed versions are only on SheetJS's own CDN. `exceljs` is unmaintained. No dependency is added to a Worker.

## 4. Data model (store schema; every table starts with `tenant_id`, FORCE RLS)

| Table | Key columns | Notes |
| --- | --- | --- |
| `products` | `id`, `status` (draft, active, archived), `vat_category`, `metadata` jsonb (≤ 50 keys), timestamps | |
| `product_translations` | (`product_id`, `locale`), `title`, `slug`, `description` jsonb, `seo_title`, `seo_description` | Unique (`tenant_id`, `locale`, `slug`); trigram index on `title` for search (`pg_trgm`) |
| `product_options` | `id`, `product_id`, `position` (0–2) | |
| `product_option_translations` | (`option_id`, `locale`), `name` | |
| `product_option_values` | `id`, `option_id`, `position` | |
| `product_option_value_translations` | (`value_id`, `locale`), `label` | |
| `variants` | `id`, `product_id`, `options_key` (sorted value IDs), `sku`, `barcode`, `price`, `compare_at_price`, `cost_price`, `weight_grams`, `track_inventory`, `allow_backorder`, `low_stock_threshold`, `image_media_id`, `position`, `archived_at` | Unique (`tenant_id`, `sku`) where set; unique (`tenant_id`, `product_id`, `options_key`) where not archived |
| `variant_option_values` | (`variant_id`, `value_id`) | |
| `categories` | `id`, `parent_id`, `depth` (≤ 2), `position` | |
| `category_translations` | (`category_id`, `locale`), `name`, `slug`, `description` | Unique slug per store and locale |
| `product_categories` | (`product_id`, `category_id`), `position` | |
| `collections` | `id`, `kind` (manual, rule), `rules` jsonb (zod-validated), `sort`, `published` | |
| `collection_translations` | (`collection_id`, `locale`), `name`, `slug`, `description` | |
| `collection_products` | (`collection_id`, `product_id`), `position` | Manual collections only |
| `slug_redirects` | `id`, `entity_type`, `locale`, `from_slug`, `entity_id`, `created_at` | Unique (`tenant_id`, `entity_type`, `locale`, `from_slug`) |
| `media` | `id`, `sha256`, `mime`, `width`, `height`, `bytes`, `widths` (int[]), `unused_since` | Unique (`tenant_id`, `sha256`) |
| `media_translations` | (`media_id`, `locale`), `alt` | |
| `product_media` | (`product_id`, `media_id`), `position` | |
| `stock_locations` | `id`, `name`, `is_default`, `address` jsonb | One default per store (partial unique index) |
| `inventory_levels` | (`variant_id`, `location_id`), `on_hand`, `reserved`, `updated_at` | |
| `stock_movements` | `id`, `variant_id`, `location_id`, `type`, `quantity`, `reason`, `reference_type`, `reference_id`, `actor_type`, `actor_id`, `created_at` | Insert and select only for `app_rw` |
| `import_jobs` | `id`, `kind`, `status`, `file_name`, `staged_key`, `total`, `processed`, `created`, `updated`, `failed`, `next_offset`, `created_by`, timestamps | |
| `import_errors` | `id`, `job_id`, `row`, `field`, `code`, `message` | At most 1,000 per job; the rest are counted |

Every table joins `STORE_TABLES` in purge order, and the registry test and the isolation suite pick them up automatically. Migrations are generated by drizzle-kit; FORCE RLS, grants and `pg_trgm` are hand-written (ADR 0009).

## 5. Services (`packages/core`)

- **`catalog`:** products with translations and slugs (with redirects); options and variant regeneration; categories (tree moves, depth check); collections and rule evaluation; publishing rules (a product needs a title and slug in the default locale, and a price, to be active).
- **`inventory`:** the only writer of levels and movements: `receive`, `adjust`, `reserve`, `release`, `sell`, `return`, each in one transaction with a row lock, plus the invariant check.
- **`media`:** registers uploads, attaches images to products and variants, marks unused images.
- **`imports`:** job lifecycle, chunk processing and errors.
- **Events (outbox):** `catalog.product.created|updated|archived`, `catalog.category.changed`, `catalog.collection.changed`, `inventory.level.changed`. Phase 3 consumes them for cache purges (ADR 0007); until then the consumer acknowledges them.

## 6. API (`/v1/admin/*`, OpenAPI, SDK regenerated)

| Area | Endpoints |
| --- | --- |
| Products | `GET /products` (search, status, category, collection, low stock, cursor), `POST /products`, `GET /products/{id}` (with translations, options, variants, media), `PATCH /products/{id}`, `PUT /products/{id}/options` (regenerates variants), `POST /products/{id}/archive`, `DELETE /products/{id}` (drafts never ordered) |
| Variants | `PATCH /variants/{id}`, `PATCH /variants` (bulk price, compare-at and threshold edits, at most 200 per request) |
| Categories | `GET /categories` (tree), `POST`, `PATCH /{id}`, `POST /{id}/move`, `DELETE /{id}` (only when empty) |
| Collections | `GET /collections`, `POST`, `PATCH /{id}`, `PUT /{id}/products` (manual order), `GET /{id}/preview` (rule matches) |
| Media | `POST /media` (one resized file; headers carry SHA-256, width, dimensions), `PUT /products/{id}/media` (order, variant images, alt) |
| Inventory | `GET /inventory` (levels, low-stock filter), `POST /inventory/adjustments` (batch, with reason), `GET /variants/{id}/movements` |
| Import | `POST /imports` (staged rows, uploaded to R2 through the Worker), `GET /imports/{id}` (progress), `GET /imports/{id}/errors`, `POST /imports/{id}/cancel` |
| Settings | `PATCH /store` gains `tax` (VAT) |

Every write that can be retried accepts `Idempotency-Key`: product create, import create, inventory adjustments.

## 7. Admin screens

- **Products:**
  - a list (cards on phones, a table from `md`) with search, status, category and low-stock filters, and selection for bulk price edit;
  - the editor, with Bangla and English tabs, description, images (resize, upload, reorder, alt text), options and variants (a grid on desktop, a list per variant on phones), stock per variant, categories and collections, SEO and publish.
- **Categories:** a tree with add, rename, move and reorder.
- **Collections:** a list and an editor (a manual order with drag and keyboard reordering, or rules with a live preview).
- **Inventory:**
  - levels with low-stock filter;
  - an adjust dialog (receive, count, damage, with a reason);
  - movement history per variant.
- **Import:** upload, map columns, dry run with errors per row, start, progress (resumable), done with a downloadable error report. **Export** is a button on the product list.
- **Settings:** VAT section, and the default stock location's name and address.

Every screen gets axe checks at both viewports in the E2E suite, as in Phase 1.

## 8. Tests

| Layer | Tests |
| --- | --- |
| Unit (`shared`) | Price parsing (Bangla digits, `৳`, separators), slug generation, the rich-text whitelist and renderer (XSS cases: `javascript:` links, unknown nodes, attributes), import row schemas, collection rule schemas |
| Integration (`core`, Postgres) | Variant regeneration keeps existing variants; SKU and slug uniqueness; redirects on slug change; category depth and cycles refused; rule collections match the right products; publish rules |
| **Inventory invariant** | Property test: thousands of random sequences of receive, adjust, reserve, release, sell and return, some concurrent, with the invariant checked after each; refused oversells without backorder; the ledger is append-only for the app role |
| API | Every new route joins the isolation suite through its fixture (a store A user gets 404 on store B's products, variants, media, imports); `catalog.cost` hides cost fields; media upload rejects wrong types, sizes and mismatched hashes |
| Import | The 500-product fixture (.xlsx and .csv, Bangla and English, 3 options, about 1,500 variants) runs through the real queue path in tests: counts, both locales, errors for bad rows, re-import updates by SKU |
| E2E (preview) | Create a product with options in both languages, upload an image, adjust stock, import the 500-product file and see it in both languages, export it again, with axe on every screen |
| CPU | The preview step adds the product save, the bulk edit and the import chunk |

## 9. Free-tier impact

| Resource | Added by Phase 2 | Note |
| --- | --- | --- |
| R2 storage (10 GB free) | About 3 files per image, about 150 KB together; 1,000 products × 5 images ≈ 750 MB | Deduplicated by content |
| R2 writes (1 M/month) / reads (10 M/month) | Uploads and cleanup; reads start with Phase 3's storefront | |
| Queue operations (10,000/day) | About 3 per import chunk: about 150 for 500 products | Shared with the outbox |
| Hyperdrive queries (100,000/day) | A few per chunk and per editor save | |
| Worker requests | Admin only | |
| Worker CPU | Heavier staff writes (product save, import chunks) | Q1 |

## 10. Pull requests

| # | Scope |
| --- | --- |
| 0 | This plan |
| 1 | `shared`: catalog schemas, price parsing, slugs, rich-text whitelist and renderer, import column definitions, VAT settings, `catalog.cost` |
| 2 | `db`: catalog tables, translations, redirects, RLS and grants, `pg_trgm`, registry |
| 3 | `db`: media, stock locations, levels, movements (append-only), import tables; default location for existing stores |
| 4 | `core`: catalog service (products, options and variants, translations, slugs, categories, collections) |
| 5 | `core`: inventory service and the invariant property test |
| 6 | `api`: catalog and inventory routes with isolation fixtures; SDK |
| 7 | `api`: media upload (R2 binding, type, size and hash checks) and the weekly cleanup |
| 8 | `api`: import jobs (staging, queued chunks, errors) with the 500-product fixture test |
| 9 | `admin`: product list, filters, bulk edit |
| 10 | `admin`: product editor (translations, options and variants, stock, categories and collections, SEO) |
| 11 | `admin`: images (browser resize, upload, reorder, alt) |
| 12 | `admin`: rich-text editor, tested on real Android phones (§3.4) |
| 13 | `admin`: categories, collections, inventory screens, VAT and location settings |
| 14 | `admin`: import wizard and export |
| 15 | E2E flows with axe; CPU steps for the new routes |
| 16 | Phase 2 report |

## 11. Acceptance criteria and how they're verified

| Criterion | Verification |
| --- | --- |
| 500 products with variants imported from a spreadsheet in one go, correct in both languages | The fixture file (.xlsx and .csv) is imported in the API test through the real queue path, and in the preview E2E through the admin. Both check product, variant and translation counts and spot-check fields in Bangla and English. The E2E also exports the catalog and compares it with the input |
| Every stock change is traceable; on hand equals the sum of movements for every variant | The inventory property test, the database check query in integration tests, and the daily drift check. The ledger is append-only for the app role, and a grant test pins it |

## 12. Open questions for the owner

1. **Q1 — CPU and the Free plan.** Product saves and import chunks will often use more than 10 ms of CPU, like today's staff requests (about 23 ms). They are staff-only and bursty.
   - **Recommended:** stay on Free, keep requests and chunks small, measure every preview, and move to Workers Paid ($5 a month) the day Cloudflare stops a request.
   - **Alternative:** move to Paid at the start of Phase 2, which removes the risk and lets the import use bigger chunks.
2. **Q2 — Images on iPhones.**
   - **Recommended:** iPhones upload JPEG and Android uploads WebP. The difference is about 25% in file size on iPhone uploads, invisible to shoppers.
   - **Alternative:** WebP everywhere, by loading a 125 KB encoder on iPhones only.
3. **Q3 — Limits:** 3 options and 100 variants per product, 10 images per product, image widths of 400, 800 and 1200 px. Do these fit your clients?
4. **Q4 — VAT defaults:** off by default; when turned on, 15% with prices including VAT. Please confirm with your accountant, and say which reduced rates or exemptions clients need.
5. **Q5 — Cost prices:** visible to Owner and Manager only (new `catalog.cost`). Should Staff see them?
6. **Q6 — Bangla typing test.** Could you (or a client) try the description editor on a preview from your Android phone with your usual Bangla keyboard when PR 12 is up? If it misbehaves, we use the plain-text fallback (§3.4).
7. **Q7 — Collection rules:** category, price range, title contains, or newer than N days, with all conditions required. Is that enough, or do clients need "any of"?
8. **Q8 — Import formats:** both .xlsx and .csv (recommended, since Excel is common). Should the import also fetch product images from URLs in the sheet (a separate step after the rows, §3.6)?
9. **Q9 — Archive instead of delete:** products and variants are archived; only drafts that were never ordered can be deleted. Agree?
10. **Q10 — Estimate:** 4 weeks instead of PLAN.md's 3, for the chunked import and the editor check.
11. **Q11 — Bangla slugs:** product URLs keep Bangla titles in Bangla (`/products/লাল-শাড়ি`), editable by hand. Or should Bangla titles be transliterated to Latin letters (`/products/lal-shari`) by default?
