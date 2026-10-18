# Phase 4 report: Cart, checkout, orders, promotions and cash on delivery

- Date: 2026-10-18
- Plan: `docs/phases/phase-4-plan.md` (approved; the owner's questions settled on the plan's recommendations)
- Pull requests: #56, all of Phase 4 with one commit per plan step (as in Phases 2 and 3) and its own preview database (`db-branch`); #57, shopper sign-in codes through Resend while the Brevo key is pending. Both merged and deployed on Oct 18.

## Summary

Phase 4 is done and in production (Oct 18). A shopper can now:

- add products to a cart;
- check out by phone as a guest, or signed in with an emailed code;
- pay cash on delivery;
- track the order by number and phone, and cancel it while it is pending.

Staff can:

- confirm orders, edit and cancel them;
- ship an order in one or more parcels and mark it delivered, with the cash collected;
- enter orders from Facebook, phone calls and walk-ins;
- run automatic and coded promotions, and schedule sale prices;
- print invoices and packing slips;
- export orders for Steadfast and Pathao;
- import customers.

This is PLAN.md's MVP line.

- **One pricing engine** prices the cart, checkout, manual orders, edits and the promotion builder's test cart. Money rules:
  - discounts are allocated to each line;
  - discounts are whole taka, rounded in the shopper's favour (Q7);
  - VAT is calculated per line;
  - there is no VAT on delivery (Q8).
- **`placeOrder`** is one transaction behind an idempotency key. It:
  - reserves stock with conditional updates;
  - counts promotion uses with conditional updates;
  - freezes snapshots;
  - takes the next `#1001`-style number (Q4).

  Stock is reserved at placement and sold at shipping (Q9).
- **Shopper accounts** use one Better Auth instance per store host, with a per-store secret and a cookie on `/api` only (ADR 0020). The codes are sent by email through Brevo, or through Resend until the Brevo key exists (ADR 0022). Accounts are off by default (Q3).
- **Turnstile** guards checkout and both sign-ins. Each custom domain is added to the widget when it goes live (ADR 0023).

**Five things the owner should know:**

1. **Everything is live (Oct 18).** The production deploy runs with no warnings:
   - **Turnstile** is on, with the owner's widget;
   - **shopper sign-in codes go through Resend** from `managemind.site`, under the store's name. Brevo's SMS verification never reached the owner's number. Adding the Brevo key later moves them to `managemind.store` with no code change (ADR 0022 amendment).

   Shopper accounts stay off per store until the owner ticks them in Settings → Checkout.
2. **The acceptance criteria are met in tests, on the preview and in production** (§2):
   - the core suite checks them against real Postgres with RLS;
   - the preview's E2E checks them through the real store host;
   - the owner placed a COD order on demo-grocery in production and took it to delivered in the admin (Oct 18).
3. **The E2E found two real bugs before they shipped:**
   - prices in Bengali digits lost the zeros of whole taka (৳600 showed as `৬.০০৳`);
   - a CSS rule that overrode `hidden` put the checkout form on screen with an empty cart. Lighthouse caught that as a layout shift of 0.101, just over the budget.
4. **The admin's sign-in bundle went down, from 143 to 128 of 150 KiB.** Each language's messages now load on demand (PR 0b), which made room for the order screens and the staff Turnstile widget.
5. **The Free plan stays until the first client** (owner, Oct 18). A day of preview runs used up the account's free allowances: some preview API requests were stopped at the 10 ms CPU limit, and the Hyperdrive queries passed the daily free 100,000. From then until the 00:00 UTC reset, Hyperdrive refused every connection, so **production's storefronts and admin were down too** (§4). Previews now run the smoke tests only, unless a PR has the `full-preview` label and today's count leaves room (ADR 0011, amended).

## 1. What was built

| Plan PR | Commit | What |
| --- | --- | --- |
| 0b | `8450bb0` | `admin`: each language's messages loaded on demand |
| 1 | `8e4600e` | `db`: the `ref` schema: 8 divisions, 64 districts and 559 areas (upazilas plus the Dhaka and Chattogram metropolitan thanas, Q5); the static geography file (migrations 0019–0020) |
| 2 | `59748ab` | `shared`: order money rules, the order, payment, delivery and shipment machines, checkout and COD settings, the order number format, promotion schemas |
| 3–4 | `d83a548` | `db`: zones, carts, customers and addresses, counters, orders with lines, adjustments and allocations, history, notes, shipments, payments, promotions, codes and usage, blocked phones, shopper accounts, default zones (migrations 0021–0023) |
| 5–6 | `daaaa33` | `core`: geography and zones, the pricing engine with promotions, quotes, carts, customers, `placeOrder` and its concurrency tests |
| 7 | `520c8c6` | `core`: the order lifecycle, shipments (stock sold on shipping, back on return), COD and manual payments, cancellation, editing, order reads |
| 8 | `b1301f8`, `52feaf7` | `core`, `api`: the customer import through the import job; manual-order quotes before the customer is entered |
| 9, 11 | `2af501f` | `api`: storefront cart, checkout, view, tracking and cancellation; admin orders, shipments, payments, customers, zones, settings, blocklist, dashboard, print data; rate limits; isolation fixtures; SDK |
| 12–13 | `e95bc88` | `storefront`: add to cart, the cart and header count, checkout, confirmation, tracking with cancellation, the new tracking events |
| 16–19 | `0abe966` | `admin`: orders list and detail with the timeline, shipments, editing and cancellation; manual orders; customers with import and export; the dashboard; delivery and checkout settings; invoices and packing slips; order export with the Steadfast and Pathao formats |
| 20 | `a362ab8` | Promotions: the campaign list with uses, orders, discounts and sales; the builder with the test cart; code batches; ADR 0021 |
| 21 | `2cc99c7` | Scheduled sale prices: each window's edges become delayed messages, with a daily catch-up; the bulk editor sets sale prices (migration 0024) |
| 10, 14 | `7f88d05` | Shopper accounts on many hosts, the `brevo` adapter, the account page, checkout prefill and saved addresses; ADRs 0020 and 0022 (migration 0025) |
| 15 | `524c3b1` | Turnstile on checkout and both sign-ins; the widget's hostnames follow custom domains; previews use the test keys; ADR 0023 (migration 0026) |
| 22 | `5f6d2a7`, `c9bc432`, `a8b8d71` | CI: the orders, promotions and accounts E2E with axe; the JavaScript budget, Lighthouse and the CPU step on the new pages and routes; smoke and production shop checks; the usage-limit concurrency test; the two fixes above |
| 22, on the preview | `f2d5217` to `1e35d44` (#56) | Fixes from the preview runs: the CPU step's sign-in token and resilience; timeouts for heavy tests; a failed store lookup no longer shows "store not found"; page data retried once; store lookups remembered for a minute |
| 23 | `cad88ee` (#56) | This report, PLAN.md and README status |
| — | `bc22bc4`, `9ba656e` (#57) | Shopper codes through Resend until the Brevo key exists (ADR 0022 amendment); the preview job's time limit goes to 30 minutes |
| — | this commit | Phase 4 closed after the production check |

## 2. Acceptance criteria

| Criterion | Status |
| --- | --- |
| Two shoppers ordering the last unit at the same moment: exactly one succeeds | **Met in tests.** `core`: ten `placeOrder` calls on ten connections for one unit. One order exists, the other nine get `insufficient_stock`, reserved is 1 and `inventoryDrift` is empty. E2E, run locally: two shoppers check out a last unit at once through the store's `/api`. One gets the order. The other is refused with the line out of stock: `insufficient_stock` at the stock lock, or `cart_invalid` at the quote if the winner has already committed. Stock reads on hand 1, reserved 1. **Met on the preview** (#56): the same E2E passed through the deployed store host at both viewports, on every run |
| Retrying `placeOrder` with the same idempotency key returns the same order and never creates two | **Met in tests.** `core`: a sequential retry, a concurrent duplicate, and a reused key with another body. E2E, local and on the preview (#56): the winner's request repeated with the same key returns the same ID and number, and the stock is unchanged |
| A full COD order can go from placed to delivered in the admin, with stock and history correct at every step | **Met in the local E2E** at both viewports. A manual order is confirmed (reserved 2) and shipped in two parcels (on hand 19, then 18; reserved 1, then 0). It is marked delivered with the cash collected, which makes the payment `paid` and the order `completed`. The timeline shows each step. `core` checks `inventoryDrift` after every step. The preview (#56) passed the same E2E. **Met in production (Oct 18):** the owner placed a COD order on `demo-grocery.managemind.store`, then confirmed, shipped and delivered it with the cash collected in the admin. The order shows Completed and the product's stock went down by one |

PLAN.md items without their own criterion:

- **Concurrency:**
  - a code limited to one use goes to exactly one of ten concurrent checkouts;
  - 20 concurrent orders get 20 different numbers;
  - two first orders from one phone at once make one customer.
- **Isolation:**
  - every new table is in the isolation suite;
  - store A's host can never read, track, cancel or check out store B's cart, order, customer, promotion code or shopper session, even when both stores use the same phone, code or order number;
  - the `ref` schema is readable and not writable.
- **WCAG 2.1 AA:** axe runs on the cart, checkout, confirmation, tracking and account pages and on every new admin screen, at two viewports. It finds no serious or critical violations.
- **Bangla and English:** every new message exists in both, and the parity tests cover them.

### Tests

| Package | Tests |
| --- | --- |
| `shared` | 317 (Phase 3: 279) |
| `db` | 757, 75 skipped (475) |
| `core` | 156 (105) |
| `providers` | 30 (25) |
| `api` | 139 (114) |
| `admin` | 18 (15) |
| `storefront` | 24 (24) |
| `scripts` | 5 (5) |
| E2E, preview (#56, #57) | All 21: smoke, the Phase 1 flows, catalog, storefront, online store, and the new orders flows, at a phone and a desktop viewport, with Turnstile test keys |

## 3. Measurements

Lighthouse passed its budgets on the preview on all six pages, including the cart and checkout. The table's Lighthouse rows are local numbers.

| Measure | Result | Budget |
| --- | --- | --- |
| Lighthouse, cart page, phone, simulated 4G (local) | LCP 1.1 s, CLS 0, TBT 0, accessibility 100 | 2.5 s, 0.1, 200 ms, 95 |
| Lighthouse, checkout page (local) | LCP 0.8 s, CLS 0 (0.101 before the fix), TBT 0, accessibility 100 | Same |
| Lighthouse, account page (local) | LCP 1.3 s, CLS 0, TBT 0, accessibility 100 | Same |
| Our JavaScript on the cart and checkout pages | 1.9 KB and 3.3 KB gzip | 50 KB |
| Storefront Worker | 361 KiB gzip (350) | 3 MiB (12%) |
| API Worker | 863 KiB gzip (782) | 3 MiB (28%) |
| Admin, JavaScript before sign-in | 128 KiB (143) | 150 KiB (85%) |

**CPU.** The preview's CPU step now covers these routes, on the run's own store:

- cart adds;
- the area;
- cart reads;
- `placeOrder` on its own row;
- the admin's order list and order detail.

The step raises that store's checkout limits for the burst, and uses Turnstile's dummy token with the test keys. These are the preview's numbers (#56, run on `c80eebc`), CPU time in ms:

| Route | Requests | Stopped | p50 | p90 | p99 |
| --- | --- | --- | --- | --- | --- |
| `POST /v1/store/checkout/orders` (`placeOrder`) | 22 | 0 | 64 | 93 | 187 |
| `POST /v1/store/cart/lines` (add) | 22 | 0 | 27 | 36 | 43 |
| `PUT /v1/store/cart/area` | 21 | 0 | 24 | 40 | 57 |
| `GET /v1/store/cart` | 37 | 0 | 19 | 30 | 37 |
| `GET /v1/admin/orders` | 44 | 0 | 16 | 31 | 37 |
| `GET /v1/admin/orders/{id}` | 42 | 0 | 24 | 41 | 66 |

As the plan expected (§9), `placeOrder` and the staff order screens are over the Free plan's 10 ms. The cart calls are too, unlike the 6 ms the plan took from ADR 0003. They run under ADR 0013's alarm, and the first stopped request is the trigger for Workers Paid.

**Stopped requests on the preview.** Earlier runs of this pull request had some requests stopped at the CPU limit (`exceededCpu`), including `GET /v1/store/context` and page data. Neither changed in this phase, and production, still on Phase 3 code, runs the store lookup at an 18 ms median with nothing stopped. Two storefront fixes came out of it:

- a failed store lookup used to show the "store not found" page. Now only the API's 404 means no store; anything else is retried once, then fails the page with a 5xx;
- page data is retried once, and a store found through the API is remembered for a minute.

The CPU step now counts stopped requests per route instead of stopping on the first one.

## 4. Free-tier impact

The impact is as planned (plan §11). Carts are the new load: they wake the database, where browsing doesn't. The daily cleanup deletes:

- carts untouched for 30 days;
- converted carts after 7 days;
- order IP addresses and user agents after 90 days.

Shopper sign-in codes share Resend's 100 emails a day with staff email until the Brevo key exists. The daily alarm watches that quota.

**The usage alarm on Oct 18** reported 116,803 Hyperdrive queries in 24 hours, against the free 100,000.

**Production went down the same day.** The UTC day's count passed 100,000 between 08:00 and 09:00 and reached 125,140 by 10:00. Hyperdrive then dropped every connection within 3 ms ("Connection terminated unexpectedly"), so every request that needs the database answered 500 until the reset at 00:00 UTC. `/health` stayed green, because it doesn't touch the database.

| Hyperdrive config, Oct 18 00:00–10:00 UTC | Queries |
| --- | --- |
| `pr-56`'s own branch (`db-branch`, since deleted) | 83,501 |
| The shared preview branch | 37,434 |
| Production | 4,205 |

Previews made 97% of them. A full preview run (21 E2E flows, about 400 CPU-step requests and Lighthouse) costs about 25,000 queries, because each API request is 5–10 statements and Hyperdrive counts every one. Five runs in a day are enough. Even #58, which only changes docs, ran the full suite.

The fix is in `preview.yml` and `scripts/preview/scope.ts`:

- a PR that changes only docs gets no preview;
- by default a preview deploys and runs the smoke tests, a few hundred queries;
- the `full-preview` label adds the E2E flows, the CPU step and Lighthouse, but only while the day's count is at most 50,000;
- when the count can't be read, the run is smoke only.

Production keeps at least half the quota. Add the label once a PR's code is ready for review, not for every push.

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **Brevo: optional now.** Brevo's SMS verification didn't reach the owner's number (Oct 18), so shopper codes go through Resend (ADR 0022 amendment). To move them to `managemind.store` later:
   - verify `managemind.store` in Brevo. Brevo shows the DKIM and SPF records; add DMARC at `p=none`;
   - add `BREVO_API_KEY` as a repository secret and run the deploy.
2. **Turnstile: done (Oct 18).** The widget covers `managemind.store` and `managemind.site`. A free widget lists 10 hostnames, which leaves 8 for custom domains. A domain that doesn't fit falls back to rate limits, and the domains page says so (ADR 0023).
3. **The geography list:** 8 divisions, 64 districts and 559 areas, waiting for the owner's approval (Q5). Corrections are data.
4. **Steadfast and Pathao sample files** from their merchant panels. The export follows their public templates until then.
5. **Market defaults:**
   - delivery zones at ৳70, ৳100 and ৳130, plus ৳20 per extra kg;
   - checkout limits of 3 orders an hour and 10 a day per phone, and 10 an hour per IP.

   All of these are per-store settings.
6. **The accountant's answer on VAT** (Q8). VAT stays off by default, and a store shouldn't turn it on before the answer.

### Not built yet, or smaller than planned

- **OTP before COD** moved to Phase 5A with SMS (Q11).
- **Refunds and the returns machine** come with Phase 5A. Failed deliveries and returns to the shop are built.
- **The advance delivery charge** is saved and shown to staff. The storefront enforces it once online payment arrives (Phase 5A).
- **Shoppers cancelling an order** show on the dashboard and in the order list. Notifications come with Phase 5A.
- **Free-delivery progress** shows once the shopper chooses an area. Before that the delivery line reads "from ৳70", and nothing remains to make free.
- **Turnstile status** shows on the store's domains page. The plan also named the platform view, which has no domains list yet.

### Decisions that differ from the plan

- **Promotions are ended, never deleted.** Their uses and order snapshots refer to them, and the app role has no delete on that table.
- **A code used up before checkout** is not applied. The shopper sees the new total (`price_changed`) before placing. If the last use goes during a checkout, that checkout gets `promotion_unavailable`.
- **The staff Turnstile key reaches the admin at build time** (`VITE_TURNSTILE_SITE_KEY`). It comes from the same variable as the API's key, so the API never asks for a check that the page can't show.
- **Each sale window's edges are delayed queue messages** of at most 12 hours each. The daily job catches up any edge a message missed.
- **The checkout's stock refusal can come at the quote** (`cart_invalid` with the line marked `insufficient_stock`) as well as at the lock (`insufficient_stock`), depending on timing. Both refuse the order, and the page shows the same message.

### Lessons for later phases

- **The E2E keeps finding what unit tests miss:**
  - Bengali-digit prices;
  - the `hidden` override;
  - the sort button that the storefront E2E had been clicking although it should have been hidden.
- **A global `[hidden]` rule belongs in every theme.** Any class that sets `display` otherwise defeats the attribute.
- **Run the E2E against a locally seeded run before pushing.** A scratch seed plus `--no-deps` gave a 30-second loop for a flow that would otherwise wait for a preview.
- **Run the full build before pushing, not just the type check.** One fix broke the storefront's build-time prerender, which only `astro build` runs.
- **Previews share the free allowances with production, and a shared quota is an outage waiting to happen.** A day of repeated preview runs used up the daily Hyperdrive queries and took production down. Any test traffic on the account now has a budget that leaves production room, and the full preview run is opt-in.

## 6. Ready for Phase 5A

Phase 5A (online payments, notifications and returns) can build on:

- the payment records, which already allow several payments per order and a settled total;
- the order, payment, delivery and shipment machines, which leave room for refunds and returns;
- the outbox events for every order change, ready for shopper and seller notifications;
- the Brevo adapter and the shopper email templates;
- the COD advance setting;
- the Turnstile helper, for return requests.
