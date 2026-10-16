# Phase 2 report — Catalog, media and inventory

- Date: 2026-10-16
- Plan: `docs/phases/phase-2-plan.md`
- Branch: `ccr-ea035c9a-cuhggi`, 18 commits ahead of `master`. **Not yet in a pull request**, so there is no preview and nothing in production. The CPU and free-tier rows marked *pending* come from the first preview.

## Summary

Phase 2 is built and tested locally: the catalog, product images, the stock ledger, the spreadsheet import and export, and every admin screen for them, in Bangla and English.

- **Products** have up to 3 options and 100 variants, Bangla and English text, a formatted description, images resized on the phone, categories (3 levels, each with a specification template), collections (by hand or by rules), specifications, a brand, tags, SEO fields and Bangla slugs with redirects.
- **Stock** is a ledger. Every change is a movement with a reason, and on hand always equals the sum of the movements. A property test runs 1,500 random operations, some at the same time, and checks this after each one.
- **Import** reads .xlsx or .csv in the browser, shows a dry run with errors per row, then queues chunks of whole products. The 500-product fixture (1,500 variants) imports through the admin in the local E2E run and exports back with every variant.

**Four things the owner should know:**

1. **Nothing has been measured on Cloudflare yet.** CPU per route and per import chunk comes from the first preview (§3). The plan's Q1 answer stands: stay on Free and measure.
2. **Two items still need the owner** (§5): the pilot client's spreadsheet, and the Bangla typing test of the description editor on the owner's phone (Q6).
3. **The admin's sign-in bundle is at 142 of 150 KiB.** Most of the growth is Phase 2's Bangla and English messages. The next phase should load only the active language's messages (§5).
4. **Previews now clean up after themselves.** Each E2E run adds about 6.5 MB to the shared preview database. Older runs' catalog data is deleted before each new run, so the 0.5 GB limit isn't reached (§4).

## 1. What was built

| Plan PR | Commit | What |
| --- | --- | --- |
| 1 | `f763c22` | `shared`: catalog schemas, prices (Bangla digits, `৳`), slugs, the rich-text whitelist and renderer, import columns, VAT settings, `catalog.cost` |
| 2, 2a | `3ec0200` | `db`: catalog, attribute and tag tables, RLS and grants, `pg_trgm`, the brand attribute for every store (migrations 0007–0009); ADR 0017 |
| 3 | `ddf1aa7` | `db`: media, stock locations, levels, the append-only ledger, import tables, the default location (0010–0011) |
| 4, 4a | `0173998` | `core`: products, options and variants, translations, slugs and redirects, categories, collections, attributes, templates, tags, rule collections |
| 5 | `1ab6ed1` | `core`: the inventory service, `setOnHand`, the invariant property test, the drift check (0012) |
| 6 | `35d5c5e` | `api`: catalog and inventory routes with isolation fixtures; SDK |
| 7 | `93d2f30` | `api`: images through the Worker, `/media/fetch`, the weekly cleanup (0013); ADR 0016 |
| 8 | `aebde8f` | `api`: import jobs, the `managemind-imports` queue and its dead-letter queue, the 500-product fixture (0014) |
| 9–11, 13, 13a, 14 | `bf4a120`, `20cbee8`, `4b54bf2` | `admin`: product list and bulk price edit, the product editor, images, categories, collections, attributes, inventory, VAT and location settings, import and export |
| 12 | `1b12d39` | `admin`: the TipTap description editor, with a plain-text switch |
| 15 | `75f58c9`, `376e742`, `3e3fa28` | E2E catalog flows at two viewports with axe; CPU steps for the catalog routes |
| — | `726b4dd` | Import fixes found by the E2E (§5) |
| — | `dbabf86` | Preview database cleanup (§4) |
| 16 | this commit | This report |

## 2. Acceptance criteria

| Criterion | Status |
| --- | --- |
| 500 products with variants imported from a spreadsheet in one go, correct in both languages | **Met locally; the preview run and the pilot spreadsheet are pending.** The API test runs the fixture (500 products, 1,500 variants, Bangla and English, 3 options, brand, tags, attributes of every type) through the real consumer, chunk by chunk, and checks counts, both languages, row errors and re-import by SKU. The local E2E imports the same fixture through the admin, creates its missing attributes in the wizard, reads it in English and exports it back with all 1,500 variants. At the phone viewport an exported .xlsx imports back as updates. The pilot client's spreadsheet hasn't arrived (§5) |
| Every stock change is traceable; on hand equals the sum of movements for every variant | **Met.** The property test (1,500 random operations, some concurrent) checks the invariant after each one. `app.inventory_drift()` runs in the daily job. A grant test pins the ledger as append-only for the app role, and a repeated idempotency key writes nothing |

PLAN.md items without their own criterion:

- **Isolation:** every new route has a fixture in the generated suite, so a store A user gets 404 on store B's products, variants, attributes, media and imports.
- **WCAG:** axe runs on 20 more screens and dialogs at each of two viewports and fails on serious or critical violations. It found two unlabeled file inputs, both fixed.
- **Bangla and English:** the admin's message parity test covers the 370 new messages.

### Tests

| Package | Tests |
| --- | --- |
| `shared` | 231 |
| `db` | 437 (38 skipped, as before) |
| `core` | 74 |
| `api` | 95 |
| `admin` | 14 |
| `scripts` | 5 |
| E2E, local | Phase 1 flows and the catalog flow, at a phone and a desktop viewport: 4 of 4 |

## 3. Measurements

### CPU per route

**Pending: the first preview.** The preview's CPU step now also sends bursts of the product list, product read, product save (with a description) and bulk price edit of 6 variants, and lists queue invocations, which are the import chunks, in their own rows.

Locally, a 10-product chunk takes about 300 ms of wall time, nearly all of it database round trips. Wall time isn't CPU time, so this doesn't predict the Workers number. If chunks come out over what ADR 0003 tolerates, the chunk size goes down (it is one constant).

### Bundles

| | Size (gzip) | Budget |
| --- | --- | --- |
| API Worker | 748 KiB | 3 MiB (24%) |
| Admin, JavaScript before the sign-in screen | 142 KiB | 150 KiB (95%; the warning starts at 130) |
| Description editor (TipTap), loaded only where a description is edited | 127 KiB | — |
| Excel reading and writing, loaded only when an .xlsx is read or written | 33 KiB | — |
| CSV (papaparse), loaded only on the import screen | 7 KiB | — |

The sign-in bundle grew by 12 KiB. The admin's messages grew 6 KiB, and two KiB come from the route tree. zod briefly got into the sign-in bundle through the list screens' URL filters, which pushed it to 167 KiB. The filters are now parsed by hand.

## 4. Free-tier impact

| Resource | Free limit | Phase 2 | Note |
| --- | --- | --- | --- |
| R2 storage | 10 GB | About 150 KB per image (3 widths) | Deduplicated by content hash |
| Queue operations | 10,000/day, per account | About 3 per import chunk: about 150 for 500 products | Each preview run imports 500 products once (desktop) and two small files (phone): about 160 operations |
| Neon storage (preview branch) | 0.5 GB | About 6.5 MB per E2E run | The database step now deletes the store data of E2E stores older than a day, keeping the stores and people |
| Worker CPU | 10 ms per invocation | *Pending* | Q1: stay on Free; move to Workers Paid the day a request is stopped |
| Hyperdrive queries | 100,000/day | A few per save and per chunk | |

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **The pilot client's product spreadsheet** (plan §1). It joins the fixture in the import tests. It is especially useful now: its headers and grouping will show whether real sheets need more than what the fixes below added.
2. **Q6: the Bangla typing test.** On the first preview, open a product and type a description with your usual Android keyboard (Gboard Bangla, Ridmik). If anything goes wrong (lost letters, a jumping cursor, doubled conjuncts), tap **সাধারণ লেখা (Plain text)** above the field. That switch is remembered on the phone, and the stored format doesn't change. Please tell me what happened either way.
3. **How to open the pull requests** for this phase. This decides when CI and the preview first run. The migrations need the `db-branch` label.

### Not built yet, or smaller than planned

- **Collections:** products are reordered with up and down buttons, which work by keyboard and touch. Drag reordering wasn't built.
- **CPU and free-tier numbers** wait for the first preview (§3, §4).
- **Abandoned uploads leave files.** A photo uploaded but never saved leaves its 3 files in R2 without a media row. The weekly cleanup only finds files that have a row. This is small, about 150 KB per abandoned photo, and an R2 listing sweep can come later.
- **The admin's messages** should load per language, which would win back about 10 KiB of the sign-in bundle.

### Decisions that differ from the plan

- **Imports without a handle column.** The plan grouped variant rows only by handle, as in Shopify's format. Sheets made by hand rarely have one, so every variant became its own product. Now a row with option values continues the product above it when its title is blank or the same. With a handle column, nothing changes.
- **Option headers** match with or without a space: "Option 1 name", as well as Shopify's "Option1 Name".
- **The plain-text description** is a switch anyone can use, not a fallback only for a failed typing test. It costs nothing and protects against a keyboard the test doesn't cover.
- **Imports create only the variants listed.** A product imported with 2 of 6 combinations has 2 variants. Saving its options in the editor then creates the missing combinations, as the editor always does; the editor shows the new variant count before saving.
- **`GET /products/export`** pages through full product details for the browser's export. The plan only said the browser pages through the API.
- **Category and collection descriptions** use the same editor as products.

### Lessons for later phases

- **The E2E found three real problems that unit tests didn't:** imports without a handle, option headers with a space, and unlabeled file inputs. It also found a test race of its own: a dialog step that moved on before its save finished.
- **The bundle check pays off again.** A route file's top-level import (zod) silently added 25 KiB to the sign-in bundle.
- **Watch the preview database's size** whenever the E2E adds data.

## 6. Ready for Phase 3

Phase 3 (the storefront) can build on:

- the server-side rich-text renderer, so no editor code reaches shoppers;
- the image widths (400, 800, 1200) with content-hash file names, which can be cached forever;
- filterable attributes and normalized option keys, so filters work across products;
- the available-to-sell stock (on hand minus reserved);
- Bangla slugs with redirects.
