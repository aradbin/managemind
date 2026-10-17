# Phase 4 plan — Cart, checkout, orders, promotions and cash on delivery

- Status: Draft for the owner's review. The blocking questions (Q1, Q2, Q5, Q13) were answered on 2026-10-17; the rest are in §14. Approved when this PR merges (PLAN.md: no code before approval)
- Date: 2026-10-17
- Scope: PLAN.md "Phase 4 — Cart, checkout, orders, promotions and cash on delivery", plus what earlier phases moved here: the storefront's cart, checkout, order confirmation, order tracking and shopper account (phase-3-plan Q1), and the division, district and area dataset (phase-2-plan §1)

## Goal

The first version a store can sell with. A shopper adds products to a cart, checks out by phone as a guest, and pays cash on delivery. The store confirms the order, ships it and marks it delivered, with stock, payment and history correct at every step. Staff also enter orders that come from Facebook, phone calls and walk-ins, run discounts, coupons and free-delivery offers, and print invoices and packing slips. This is PLAN.md's MVP line.

Three acceptance criteria, from PLAN.md:

1. When two shoppers order the last unit at the same moment, exactly one succeeds (concurrency test).
2. Retrying `placeOrder` with the same idempotency key returns the same order and never creates two.
3. A full COD order can go from placed to delivered in the admin, with stock and history correct at every step.

**Estimate: about 7 weeks** (Q1). PLAN.md says 5–6. The extra week covers work that earlier phases moved here:

- the storefront's cart, checkout, confirmation, tracking and account pages (phase-3-plan Q1);
- the Bangladesh geography dataset (phase-2-plan §1);
- shopper sign-in on many store hosts, which ADR 0005 left to this phase.

The promotion engine is the largest single piece. None of the acceptance criteria depends on it, so it comes after the order flow works end to end (§12).

**Moved out of this phase** (Q11): the "OTP before a COD order" toggle moves to Phase 5A, which adds the stores' SMS gateways. Without SMS there is nothing to send the code with.

## 1. Prerequisites status

| Item | Status |
| --- | --- |
| Phase 3 | Done (report: `docs/phases/phase-3-report.md`) |
| Pilot clients' delivery zones and fees, COD rules, usual promotions, and what invoices and packing slips must show | **Open.** There is no pilot client yet (Oct 17). The plan uses common Bangladeshi defaults (§3.3, Q6), which are editable settings. The owner can confirm or adjust them from what they know of the market. **Not blocking**: the defaults are data, not code |
| Email provider verified for the store domain (shopper sign-in codes) | **Decided: Brevo's free plan** for `managemind.store` (Q2), since Resend's free plan allows one domain and that is `managemind.site` (ADR 0014). **Open:** the owner creates the Brevo account, verifies `managemind.store`, and sends an API key limited to sending. **Needed before PR 10** |
| SPF, DKIM and DMARC for `managemind.store` | **Open.** Phase 3 left them for "the first shopper email", which is this phase. Brevo's domain setup gives the DKIM and SPF records; DMARC starts at `p=none`, as for the main domain. The provisioning step can add them through the Cloudflare API once Brevo shows them |
| The division, district and area dataset | **Levels decided** (Q5): upazilas, with the metropolitan thanas of Dhaka and Chattogram. **Open:** the owner approves the final list in PR 1 |
| New: Turnstile | **Open.** Cloudflare Turnstile is free. It needs one widget for the platform's hosts, and a token permission (Account → Turnstile: Edit) so that a store's custom domain can be added to the widget when it connects (§3.15). **Decided** (Q13): the owner adds the permission to `CF_STORE_TOKEN` and creates the widget. **Needed before PR 15** |
| New: sample bulk-upload files from the Steadfast and Pathao merchant panels | **Open, not blocking.** They give the exact columns of the courier export (§3.17). Public templates are the fallback. **Needed before PR 19** |
| An accountant's confirmation of the VAT defaults | **Open since Phase 2** (phase-2-plan Q4). This phase calculates VAT per order line. Its rules are data (§3.1), so they change without code. VAT is off by default, and an accountant must answer Q8 before any store turns it on |

## 2. Research: what is borrowed

| From | What |
| --- | --- |
| Shopify | An order has separate statuses for its own state, payment ("financial status") and delivery ("fulfillment status"). An order can have several fulfillments, each covering some lines. Order editing records what changed and keeps the original lines. Order numbers come from a per-store counter with a prefix (`#1001`). Discounts combine through explicit "combinations" (product, order and shipping discounts) |
| Medusa | Carts are separate from orders: disposable, recalculated on every change, and turned into an order once. Promotions are rules plus an "application method" (`each` or `across`, with a target of items or shipping). Discounts are stored per line, so a return refunds exactly what was paid |
| Vendure | Order states as a finite state machine (`AddingItems → ArrangingPayment → PaymentAuthorized → …`). Promotions are configurable conditions and actions: new ones are code plus settings, not schema changes. Fulfillments carry their own lines and state machine |
| Saleor | Checkout validates everything again at completion and creates the order in one step. Vouchers (codes) and promotions (automatic) are kept apart. Per-customer voucher limits are checked by the customer's identifier |
| Stripe | `Idempotency-Key`: the first result is stored and replayed (Phase 1's `runIdempotent`) |
| Bangladeshi stores and couriers (Steadfast, Pathao, RedX) | Delivery is priced by three zones: inside Dhaka, Dhaka's suburbs and outside Dhaka, with an extra charge per kilogram over the first. COD is the default payment. Many orders come from Facebook and phone calls, so manual order entry matters as much as the storefront. Stores send couriers bulk CSV uploads until they connect APIs |
| What we simplify | One coupon code per cart, alongside any automatic promotions. One action per promotion. No order "drafts" or quotes. No partial cancellation (an edit removes lines instead). No multi-location fulfilment: one stock location, as in Phase 2. Invoices are printable pages, not generated PDFs. Shopper accounts sign in by email code only until Phase 5A adds SMS |

## 3. Design decisions to approve

### 3.1 Money on orders

The rules every total follows. They are pure functions in `shared`, with unit tests for each rule.

- **A line:** unit price × quantity. The unit price is the variant's price at that moment, the sale price inside a sale window (§3.14).
- **Discounts are allocated to lines** in whole poisha:
  - an item discount goes to the lines it targets;
  - an order discount goes to every line, in proportion to what each line costs after its item discounts;
  - shares are rounded by the largest-remainder method, so they always add up to the discount;
  - a delivery discount goes to the delivery fee, not to lines.

  Each line's allocation is stored per promotion, so Phase 5A's partial returns refund exactly what was paid (PLAN.md).
- **Whole taka** (Q7): each promotion's discount is rounded to a whole taka, in the shopper's favour. Most stores price in whole taka, so totals stay in whole taka, and couriers collect whole taka.
- **VAT,** when the store has it on (Phase 2's settings):
  - it is calculated per line on the line's amount after discounts, at the line's VAT category rate;
  - it is rounded once per line (half away from zero) and stored on the line;
  - with prices including VAT, the total doesn't change and VAT is shown as "of which VAT";
  - with prices excluding VAT, VAT is added, and the total is rounded to a whole taka once, with the difference stored as a rounding amount on the order;
  - VAT on the delivery fee follows Q8 (none by default).
- **The order total:** lines after discounts, plus delivery after its discount, plus any VAT added, plus rounding. It is never below zero.
- **The client never sends a price.** Checkout sends the total it showed the shopper only so the server can compare. If they differ (a price changed), the order is not placed: the response says so and carries the new totals, so the shopper never meets a surprise at the door.

### 3.2 Bangladesh geography

PLAN.md wants addresses and delivery zones built from global reference data.

- **Three levels:**
  - 8 divisions;
  - 64 districts;
  - about 500 **areas**: the upazilas, with the metropolitan thanas of Dhaka and Chattogram in place of their city upazilas. In Dhaka, shoppers and couriers think in thanas (Dhanmondi, Mirpur, Uttara).
- **Names in Bangla and English.** Each row has a stable code, so Phase 7 can map our areas to each courier's own area IDs.
- **The source** is an openly licensed dataset of administrative units (candidates: the `bangladesh-geocode` dataset, cross-checked with the Bangladesh Bureau of Statistics geocodes). PR 1 checks the licence, adds the Dhaka and Chattogram thanas, and shows the owner the list for approval (Q5).
- **Storage:** a new read-only schema, `ref`, outside tenancy (PLAN.md: global reference data in non-tenant tables). It is loaded by a migration, so every environment has the same data.
- **Shoppers' browsers get it as a static file,** `/geo/bd-<hash>.json`: about 15 KB gzip with both languages, cached for a year, at no cost. The checkout's three dropdowns read it, with no API call.
- **The address** is division, district, area and a free-text line (house, road, landmark). An area that isn't in the list can't be typed in. "Other" is not offered, because couriers need the area. The street line takes everything else.

### 3.3 Delivery zones and fees

- **A store has delivery zones.** Each has:
  - a name in both languages;
  - a flat fee;
  - an optional weight rule: free up to N grams, then a fee per extra kilogram or part of one;
  - an optional estimate shown to shoppers ("1–2 days").
- **Zones cover districts or areas.** An area belongs to the zone that lists it. Otherwise it belongs to the zone that lists its district. Otherwise it belongs to the store's fallback zone ("everywhere else"). An area or district can be in only one zone.
- **The default template** (Q6), created for every new store and editable:

  | Zone | Covers | Fee |
  | --- | --- | --- |
  | Inside Dhaka | Dhaka's metropolitan thanas | ৳70 |
  | Dhaka suburbs | Savar, Keraniganj, Gazipur Sadar, Narayanganj Sadar, Tongi | ৳100 |
  | Outside Dhaka | Fallback | ৳130 |

  Each zone also has ৳20 for every kilogram over the first. The demo stores use these numbers.
- **Weight** comes from the variant (Phase 2's `weight_grams`). A variant without one counts as 0 g.
- **Free delivery** is a promotion action (§3.13), as PLAN.md says, not a zone setting.

### 3.4 Cart

- **Created on the first "add to cart",** not on page view, so browsing makes no database rows.
- **Identified by an opaque token** in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie, `mm_cart`, with **`Path=/api`**:
  - the browser sends it only to `/api/*`, never with a page request, so cached pages are untouched (phase-3-plan §3.1);
  - the database stores only the token's SHA-256 hash, so a database leak doesn't hand out carts;
  - it is kept 30 days.
- **The header's cart count** comes from a second cookie, `mm_cart_n`, which holds only the number of items and can be read by script. The cached page shows the count without an API call.
- **Lines reference variants by ID, with a quantity.** Nothing else is stored: every read and change recalculates the totals from current prices, promotions and the delivery zone (PLAN.md).
- **Validation on every change:**
  - the variant is active and its product is published;
  - there is stock available, unless the variant allows backorders or isn't tracked;
  - quantity is at most the store's limit per line (default 10) and at most 50 lines a cart.

  A cart whose line became unavailable still loads. The line is marked, and checkout refuses until the shopper removes or reduces it.
- **The cart response** carries the lines with their current titles, images and prices, applied promotions, the free-delivery progress ("৳220 more for free delivery"), and the totals for the chosen area (or "from ৳70" before one is chosen).
- **Signing in merges a guest cart** into the shopper's own cart: quantities add up, capped at the limit.
- **Cleanup:** the daily job deletes carts untouched for 30 days and converted carts after 7 days (PLAN.md's cleanup table).
- **Stock is not reserved in the cart.** Reserving there would let a few open tabs lock a small store's stock. Stock is reserved when the order is placed (§3.5).

### 3.5 Checkout and `placeOrder`

**The form,** phone first:

- name;
- phone: a Bangladeshi mobile number, normalized to E.164 by Phase 1's helper;
- email: optional by default; the store can require or hide it;
- address: division, district, area and the street line;
- an optional note for the store;
- payment: cash on delivery, the only method until Phase 5A;
- "save my details" for signed-in shoppers.

Totals update when the area changes. A Turnstile check runs invisibly (§3.15).

**`placeOrder`** is one command, used by both the storefront and manual orders. It runs in **one transaction**:

1. **Idempotency:** `runIdempotent` with scope `place_order` and the client's key. A retry of a finished order returns the same response. A retry while the first attempt is still running gets `409 in_progress`, and the client retries after a moment. A different body under the same key is refused.
2. **The cart:** lock the cart row (`FOR UPDATE`) and refuse one that is already converted.
3. **Revalidate:** variants active, products published, current prices, quantity limits, and the store's checkout rules:
   - COD enabled and under its maximum order value;
   - not inside holiday mode's window (manual orders are allowed, Q14);
   - the phone not on the store's blocklist.
4. **Price it:** the promotion engine and the delivery zone (§3.1, §3.13), then compare with the total the shopper saw.
5. **Reserve stock** through the inventory service: one batched call, with conditional checks under row locks (Phase 2's `applyMovements`), and an idempotency key per line. If the last unit was already reserved, this is where the second shopper's order stops, with `insufficient_stock` naming the line.
6. **Count promotion usage** with conditional updates (§3.13).
7. **Find or create the customer** by phone (§3.10).
8. **Take the order number** from the store's counter (§3.6). This happens late in the transaction, so the counter's row lock is held for milliseconds.
9. **Write the order:**
   - the order, its lines and snapshots, and its adjustments and line allocations;
   - the COD payment (`pending`);
   - the first history row;
   - `order.placed` in the outbox.
10. **Mark the cart converted,** linked to the order.

- **The idempotency key** is made by the checkout page once per attempt and kept in `sessionStorage`, so a double tap, a lost response or a reload sends the same key.
- **Rate limits** (§3.15) run before the transaction, in the API, against the Durable Object limiter.
- **The response:** the order number, its totals, and a **view token**, a signed value valid for 24 hours. The confirmation page is `/orders/thanks#<token>`. The token is in the fragment, which never reaches a server or a log (README: no secrets in URLs).

### 3.6 Orders and their four statuses

As in Shopify, an order has its own status, plus separate statuses for payment, delivery and returns (PLAN.md). Each is a state machine built with the shared helper (`shared/state-machine.ts`). Every change writes a history row with the machine, from, to, actor and reason.

| Machine | States | Driven by |
| --- | --- | --- |
| **Order** | `pending → confirmed → processing → completed`; `cancelled` from `pending`, `confirmed` or `processing` while nothing is shipped | Staff confirm. The first shipment, or "Start processing", moves it to `processing`. It becomes `completed` on its own when delivery is `delivered` and payment is `paid` |
| **Payment** (derived) | `unpaid`, `partially_paid`, `paid` (Phase 5A adds `partially_refunded` and `refunded`) | The sum of settled payments against the total |
| **Delivery** (derived) | `not_shipped`, `partially_shipped`, `shipped`, `delivered`, `failed` | The shipments (§3.7) |
| **Returns** | `none` (Phase 5A adds `requested`, `partially_returned` and `returned`) | Phase 5A |

- **Derived statuses are stored columns,** recalculated in the same transaction as the change. Lists can then filter on them with an index.
- **Order numbers:** a per-store counter row with `UPDATE … RETURNING`. The format is a per-store prefix and a number (Q4); the default is `#` with numbers from 1001. Numbers never repeat. A cancelled order keeps its number.
- **Snapshots** on each line, frozen at placement (PLAN.md):
  - the product title in both languages, the variant's option labels, SKU and image;
  - the unit price, the compare-at price and the cost price (for Phase 8's profit reports, shown only with `catalog.cost`);
  - the weight and the VAT category and rate.

  The order also keeps the contact details, the address with its names in both languages, the delivery zone's name and fee, the locale and the source. Later product edits never change a past order.
- **The source** is one of website, Facebook, phone, walk-in or other (PLAN.md), for reports.
- **Notes and tags:** internal notes (author and time, never shown to the shopper), the shopper's note, and free tags for filtering.

### 3.7 Shipments and stock

- **A shipment** covers chosen lines and quantities, so a store can send part of an order now and the rest later. It has a carrier name (free text in this phase), a tracking number and URL, and its own states: `pending → shipped → delivered | failed`, then `failed → returned` (PLAN.md). Phase 7 adds `booked`, `picked_up` and `in_transit`, driven by courier APIs, on the same rows.
- **Stock follows the goods** (Q9):

  | When | Stock |
  | --- | --- |
  | The order is placed | Reserved |
  | The order is cancelled, or an edit removes or reduces a line | Released |
  | A shipment is marked shipped | Sold from the reservation: a `release` and a `sale` together (Phase 2's `sell(fromReservation)`) |
  | A failed shipment is marked returned | Back in stock with a `return` movement. Phase 5A adds inspection by condition, and the failed-delivery record (lost delivery cost, flagged phone) |

- **Unconfirmed orders keep their reservation.** They are not cancelled automatically in this phase (Q9). The dashboard shows how many are waiting. Phase 6's confirmation workflow handles fake orders.
- **Availability purges** come for free: the inventory service already emits `inventory.availability.changed` when a variant goes in or out of stock (ADR 0018), so a sold-out product's page updates within a minute.

### 3.8 Payments: cash on delivery and manual payments

- **Providers behind one interface** (PLAN.md), in `packages/providers/payments`. This phase has two:
  - **`cod`:** a `pending` payment is created at placement for the amount to collect. Marking the order delivered offers "cash collected", checked by default, which settles it as `paid`. Phase 7's courier sync will do this on its own. Cancelling an order voids its pending payment.
  - **`manual`:** a payment staff record as already received: bKash, Nagad, Rocket, bank transfer, cash or other, with a reference number. It is settled as soon as it is recorded. This covers Facebook orders paid in advance.
- **Several payments per order** (PLAN.md): an order can have a manual advance and a COD payment for the rest. When an advance is recorded, the COD payment's amount is reduced in the same transaction. The order is `paid` when settled payments cover the total.
- **COD settings per store:**
  - enabled;
  - a maximum order value: above it, COD isn't offered, and the checkout suggests contacting the store through the chat buttons;
  - an advance delivery charge, either never, always, or only for phones flagged after failed deliveries. **The storefront enforces the advance only once online payment exists (Phase 5A).** Until then the setting can be saved, the admin explains that, and staff record advances on manual orders.
- **Payments never change after settlement.** Phase 5A's refunds are new rows that point back at them.

### 3.9 Editing and cancelling orders

- **Editing before anything ships** (PLAN.md): staff change quantities, add products, remove lines, change the address or delivery zone, or override the delivery fee with a reason.
  - The admin shows a preview of the new totals before saving.
  - Promotions applied at placement are re-checked against the new lines. One that no longer qualifies (a minimum spend no longer met) drops off, and the preview says so.
  - Reservations are adjusted in the same transaction.
  - The history row records the lines before and after.
  - If settled payments now exceed the total, the order shows the difference as "refund due" for Phase 5A.
- **Staff cancel** an order with a reason while nothing is shipped. Its reservations are released and its pending payment is voided. The promotion usage it counted is given back, so a cancelled order doesn't use up a coupon.
- **Shoppers cancel their own order** from the tracking page until the store confirms it (PLAN.md). The shopper's cancellation shows in the order list with its own filter and on the dashboard. **Email and push notices to staff come with Phase 5A's notifications.**

### 3.10 Customers

- **One customer per phone number per store.** `placeOrder`, manual orders and imports find a customer by the normalized phone, or create one. Name and email are taken from the first order. A later order with a different name keeps the customer's name, and the order keeps what was typed (Q15).
- **Addresses** belong to the customer. Each order's address is also kept as a snapshot.
- **Kept totals:** order count, total spent (delivered orders only), first and last order dates. They are updated in the same transaction as order changes, for the list and for Phase 6's delivery score.
- **Groups are tags** on the customer ("wholesale", "vip"). Promotions can target them (PLAN.md: "customer phone or group").
- **Customers are soft-deleted** (PLAN.md naming conventions). Phase 5B's anonymization replaces the personal fields.
- **Import from CSV or Excel** through Phase 2's import pipeline (uploaded to R2, processed in queue chunks):
  - columns: name, phone, email, address fields, tags and notes, matched by phone;
  - WooCommerce's customer export headers are recognized;
  - districts and areas are matched by name in either language. A row whose area doesn't match keeps its address as text and gets a warning;
  - each chunk writes with batched statements from the start, the lesson from Phase 2's slow product imports (phase-2-report §3).

### 3.11 Shopper accounts

Accounts are optional for shoppers, and guests track orders by number and phone (PLAN.md).

- **On the Better Auth shopper instance,** as ADR 0005 designed and tested:
  - tables `store.shopper_users`, `shopper_sessions`, `shopper_accounts` and `shopper_verifications`, unique per store, with RLS;
  - the cookie cache is off, as for staff;
  - sessions are signed with a per-store secret, derived from the auth secret and the tenant ID with HKDF.
- **One instance per request,** built for the store's host: `baseURL` and `trustedOrigins` are the host, which settles ADR 0005's open question for many hosts. ADR 0020 records it.
- **The session cookie, `mm_session`, also has `Path=/api`,** so a signed-in shopper still gets cached pages. The account pages are cached shells whose scripts call `/api/account/*`. The storefront's cache already skips any request that carries `mm_session` (`apps/storefront/src/lib/cache.ts`). That stays as a second guard.
- **Sign-in by email code only, until Phase 5A adds phone codes for stores with SMS.** Accounts are off by default, switched on per store (Q3), and every code request is rate-limited and behind Turnstile.
- **What an account shows:** orders placed while signed in, saved addresses and the shopper's name and phone. **It doesn't link earlier guest orders by phone,** because nobody has verified that the signed-in shopper owns that phone. Anyone could otherwise type a stranger's number and read their order history. Phase 5A's phone codes can link them safely.

### 3.12 Manual orders

For Facebook, phone and walk-in orders (PLAN.md), built on the same `placeOrder`:

- search for the customer by phone or name, or create one; their saved addresses are offered;
- add products by search, title or SKU, with live available stock shown;
- the delivery zone follows from the area, or staff choose another one, or "no delivery" for walk-ins;
- automatic promotions apply as on the storefront, staff can enter a code, and they can add a **manual discount** (an amount or a percentage, with a reason);
- payment: COD, or a manual payment already received (§3.8);
- the source;
- "Save" places it as `pending`, "Save and confirm" also confirms it.

A manual order makes a reservation like any other order. A walk-in sale that leaves the shop at once is saved, shipped with no carrier and marked delivered in one action.

### 3.13 Promotions

**One engine for every discount** (PLAN.md). It is a pure function in `core` with no database access: it gets the cart's lines, the customer's facts (first order, tags), the zone and the payment method, and returns the adjustments and their allocations. Checkout, the cart, manual orders, edits and the admin's preview all call it.

- **A promotion** has:
  - a title in both languages, shown to shoppers;
  - automatic or code;
  - a status (draft, active, paused, ended) and a date range;
  - a priority;
  - stacking: exclusive or combinable;
  - an optional maximum discount;
  - total and per-customer usage limits.
- **Conditions,** all of which must match. They are typed JSON validated by zod (PLAN.md: new options without migrations):
  - minimum subtotal;
  - minimum quantity;
  - specific products, variants, categories or collections;
  - delivery zones;
  - first order (no earlier order from this phone that wasn't cancelled);
  - customer phones or tags;
  - payment method.
- **One action per promotion:**
  - a percentage off the order or off the targeted items;
  - a fixed amount off the order, or off each targeted item;
  - buy X get Y: buy N from one set, get M from another (or the same) set at a percentage off; the cheapest qualifying items are discounted, with an optional limit on uses per order;
  - free or discounted delivery, with the same conditions, which covers PLAN.md's spend thresholds, zones, products and campaign periods.
- **Order of application:** item discounts, then order discounts on what remains, then delivery discounts.
- **Stacking** (Q10):
  - combinable promotions apply together, in priority order;
  - an exclusive promotion applies alone;
  - the engine compares the best exclusive promotion with all the combinable ones together and gives the shopper whichever is worth more;
  - **one code per cart,** alongside any automatic promotions.
- **Codes:**
  - one shared code ("EID500"), or a batch of unique codes (up to 5,000 per batch, exported as CSV);
  - codes are matched without regard to case.
- **Limits hold under concurrent checkouts** (PLAN.md):
  - **total uses:** `UPDATE promotions SET usage_count = usage_count + 1 WHERE id = $1 AND (usage_limit IS NULL OR usage_count < usage_limit)`; no row updated means the limit was reached, and the order is refused with a clear message;
  - **per-customer uses:** the same conditional update on a row per promotion and phone;
  - **codes:** the same on the code row.

  Cancelling an order gives its uses back.
- **The storefront shows offers:**
  - sale badges from compare-at and sale prices;
  - applied promotions in the cart and checkout, by title;
  - a progress bar towards the nearest free-delivery threshold.

  Automatic promotions aren't printed on product pages. The pages stay cacheable and need no purge when a campaign starts. The announcement bar (Phase 3) is where a store advertises a campaign.
- **The admin's builder** shows a plain-language summary ("15% off orders over ৳2,000 inside Dhaka, until 30 Oct") and a **test cart**: pick products, quantities, an area and a payment method, and see which promotions apply and why the others don't. This is the "preview of which carts qualify" PLAN.md asks for.
- **The campaign list** shows each promotion's uses, orders, total discount given, and sales from those orders.

### 3.14 Sale prices

- **The variant's compare-at price** (Phase 2) stays as it is: a manual strikethrough.
- **New: a scheduled sale per variant,** with a sale price, a start and an end (Q12). Inside the window the shopper pays the sale price, and the regular price is the strikethrough. Staff set it for many variants at once in Phase 2's bulk editor.
- **Cached pages change at the window's edges without a staff action.** So when a sale is saved, the catalog service sends a **delayed queue message** for each edge. Queue delays are at most 12 hours, so a message more than 12 hours early sends itself on again. When the message arrives, it recalculates the products' `price_min` and `price_max` and emits `catalog.product.updated` with `prices`, which purges their pages (ADR 0018). The daily job catches any edge a lost message missed.
- **Carts and checkout never rely on the page:** they read the effective price at request time.

### 3.15 Fraud basics and Turnstile

- **Rate limits,** checked in the API before `placeOrder` with Phase 1's Durable Object limiter:
  - per store and phone: 3 orders an hour and 10 a day;
  - per store and IP: 10 orders an hour.

  Each store can change these numbers. A refused shopper sees "Too many orders from this number; please contact the store", with the chat buttons.
- **A per-store blocklist** of phone numbers, each with a reason. A blocked phone gets the same generic refusal, so a fraudster learns nothing. Staff can still enter a manual order for a blocked phone, after a warning.
- **The order keeps the IP and user agent,** for the blocklist and for Phase 6. They are deleted after 90 days, as delivery logs are (PLAN.md cleanup table).
- **Turnstile** (free, usually invisible):
  - **where it runs:** placing an order, shopper sign-in code requests and staff sign-in code requests (phase-1-plan left staff sign-in to join "with checkout"); Phase 5A adds return requests;
  - **verification:** the API checks the token with Cloudflare's `siteverify`, and the token's hostname must match the request's host;
  - **previews and tests** use Cloudflare's published test keys.
- **Turnstile on custom domains** (Q13): a widget lists the hostnames it may run on. The domain lifecycle (ADR 0019) adds a store's hostname to the widget when it becomes active, and removes it when the domain is removed. That needs the token permission in §1. PR 15 checks how many hostnames a free widget allows. If a domain can't be added, that host falls back to rate limits only, and the admin's platform view shows it.

### 3.16 Storefront

New pages. **All are cached shells with no personal data.** Their small scripts call `/api/*`. They are `noindex`, and `robots.txt` disallows them.

| Page | Contents |
| --- | --- |
| Product (changed) | "Add to cart" with the variant picker; a sold-out variant disables it. A short "Added" message offers "View cart". The chat buttons stay as a second call to action |
| `/cart` | Lines with quantity steppers, the coupon field, applied offers, the free-delivery progress bar and totals. With an empty cart: links to the home page and collections |
| `/checkout` | The form (§3.5), totals that follow the area, and "Place order" |
| `/orders/thanks` | The order number, what was ordered, the totals and the COD amount, and what happens next |
| `/track` | Order number and phone. It shows the status, lines, shipments with their tracking links, and "Cancel order" while the order is pending |
| `/account` | Sign in by email code; then orders, addresses and details |

- **The header** shows the cart icon with its count (§3.4) and, when accounts are on, an account link. Phase 3 left room for both.
- **Holiday mode** (Phase 3's window): the cart works, and checkout shows the store's message and refuses orders, on the server too.
- **Tracking events,** with Phase 3's consent-gated helper and an event ID each:
  - `AddToCart` / `add_to_cart`;
  - `InitiateCheckout` / `begin_checkout`;
  - `Purchase` / `purchase`, whose event ID is the order ID, ready for Phase 9's server-side de-duplication.
- **JavaScript budgets:**
  - the product page stays under 50 KB with "add to cart";
  - the cart and checkout pages get the same 50 KB budget for our scripts; Turnstile's own script is excluded, like the Pixel's.

  The scripts stay plain TypeScript, as in Phase 3.
- **Messages:** each page carries the strings its scripts need, in its language, so no message file is downloaded.

### 3.17 Admin: dashboard, invoices, export

- **The home dashboard** replaces Phase 1's placeholder (PLAN.md):
  - today's and this month's orders and sales (Asia/Dhaka days, cancelled orders excluded);
  - orders waiting for confirmation;
  - orders to ship;
  - orders cancelled by shoppers;
  - low-stock variants;
  - a 7-day sales line.

  A handful of summary queries on indexed columns, cached for 60 seconds in the browser (`private, max-age=60`). Sales figures need `reports.read`; counts need `orders.read`.
- **Invoices and packing slips** (Q13) are printable pages in the admin, printed or saved as PDF by the browser. There is no server-side PDF and no CPU cost.
  - **Invoices:** A4, with the store's business details (Phase 3), the order, its lines with discounts, delivery, VAT when on, and payments.
  - **Packing slips:** half-page, with the address large, the COD amount to collect, the lines without prices, and a QR code of the order number (the admin already has a QR component).
  - Either document prints in Bangla or English.
  - Selected orders print together, one per page.
- **Export** (PLAN.md), with `orders.export`:
  - the browser pages through the orders API and writes CSV or Excel with Phase 2's lazily loaded spreadsheet code;
  - formats: a full export (one row per line) and the **Steadfast and Pathao bulk-upload formats**, with the area names each courier expects, from the templates in §1;
  - customers export the same way, with `customers.export`.

### 3.18 Who can do what

Phase 1 declared these permissions; this phase uses them.

| Permission | Covers | Roles (Phase 1) |
| --- | --- | --- |
| `orders.read` | Order list and detail, printing. **Without `customers.read`, the phone, email and address are masked**, because Viewers have `orders.read` but not shoppers' personal data | All |
| `orders.write` | Confirm, edit, cancel, shipments, delivered and collected, manual payments, notes, tags, manual orders | Owner, Manager, Staff |
| `orders.export` | Order export | Owner, Manager |
| `customers.read` / `customers.write` / `customers.export` | Customers, their addresses, import, export | Owner and Manager (all); Staff (read, write) |
| `promotions.read` / `promotions.write` | Promotions and codes | All read; Owner and Manager write |
| `payments.read` | Payment details and references | All |
| `reports.read` | The dashboard's sales figures, campaign sales | All but Staff |
| `settings.write` | Delivery zones, checkout and COD settings, rate limits, blocklist, shopper accounts | Owner, Manager |

Every staff action on orders, payments, customers, promotions and these settings is written to `audit_log` (PLAN.md).

### 3.19 New dependencies

No dependency is added to either Worker. Brevo is a `fetch` to its HTTP API, as Resend is (ADR 0014): a new `brevo` adapter behind the existing `EmailProvider` interface, used for shopper email from the store domain, while staff email stays on Resend. Turnstile is a `fetch` to `siteverify`. The storefront loads Turnstile's script from Cloudflare only on checkout and sign-in. The geography file is data. The admin's printing and export use what Phase 2 added.

## 4. Data model

**New schema `ref`** (global, read-only to `app_rw`; the catalog test allow-lists it as non-tenant):

| Table | Key columns |
| --- | --- |
| `divisions` | `id` smallint, `code`, `name_bn`, `name_en` |
| `districts` | `id` smallint, `division_id`, `code`, `name_bn`, `name_en` |
| `areas` | `id` int, `district_id`, `code`, `kind` (upazila, thana), `name_bn`, `name_en`, `active` |

**Store schema** (every table starts with `tenant_id`, FORCE RLS, joins `STORE_TABLES`):

| Table | Key columns | Notes |
| --- | --- | --- |
| `delivery_zones` | `id`, `name` jsonb (bn, en), `fee`, `free_weight_grams`, `fee_per_extra_kg`, `estimate` jsonb, `is_fallback`, `position`, `active` | At most one fallback; at most 20 zones |
| `delivery_zone_areas` | `zone_id`, `district_id` or `area_id` (one of them) | Unique per (`tenant_id`, `district_id`) and per (`tenant_id`, `area_id`) |
| `carts` | `id`, `token_hash` (unique), `shopper_user_id`, `status` (active, converted), `order_id`, `locale`, `area_id`, `code`, `updated_at`, `expires_at` | Index (`tenant_id`, `updated_at`) for cleanup |
| `cart_lines` | (`cart_id`, `variant_id`), `quantity`, `added_at` | |
| `customers` | `id`, `phone` (E.164), `name`, `email`, `tags` text[], `note`, `order_count`, `total_spent`, `first_order_at`, `last_order_at`, `deleted_at` | Unique (`tenant_id`, `phone`) where not deleted; trigram index on name |
| `customer_addresses` | `id`, `customer_id`, `name`, `phone`, `division_id`, `district_id`, `area_id`, `line`, `label`, `is_default` | At most 10 per customer |
| `shopper_users`, `shopper_sessions`, `shopper_accounts`, `shopper_verifications` | As ADR 0005 | `unique (tenant_id, email)` on users |
| `counters` | (`tenant_id`, `name`), `value` | `order_number` now; return numbers in Phase 5A |
| `orders` | `id`, `number`, `status`, `payment_status`, `delivery_status`, `return_status`, `source`, `customer_id`, `shopper_user_id`, `contact` jsonb, `address` jsonb, `zone_id`, `zone_name` jsonb, `currency`, `subtotal`, `discount_total`, `delivery_fee`, `delivery_discount`, `vat_total`, `rounding`, `total`, `paid_total`, `locale`, `customer_note`, `tags` text[], `metadata` jsonb, `ip`, `user_agent`, `placed_at`, `confirmed_at`, `completed_at`, `cancelled_at`, `cancel_reason`, `cancelled_by` | Unique (`tenant_id`, `number`); indexes (`tenant_id`, `placed_at` desc), (`tenant_id`, `status`, `placed_at`), (`tenant_id`, `delivery_status`, `placed_at`), (`tenant_id`, `customer_id`); the contact phone is indexed for lookup |
| `order_lines` | `id`, `order_id`, `variant_id`, `product_id`, the snapshots (§3.6), `quantity`, `unit_price`, `line_subtotal`, `discount_total`, `vat_rate_bp`, `vat_amount`, `line_total`, `shipped_quantity`, `position` | `variant_id` references variants with `restrict`, so an ordered variant can't be deleted (Phase 2 archives it instead) |
| `order_adjustments` | `id`, `order_id`, `kind` (promotion, manual), `target` (items, order, delivery), `promotion_id`, `code`, `title` jsonb, `amount`, `reason` | |
| `order_line_adjustments` | (`order_line_id`, `adjustment_id`), `amount` | The allocation (§3.1) |
| `order_history` | `id`, `order_id`, `machine` (order, payment, delivery, shipment, edit), `from`, `to`, `event`, `actor_type`, `actor_id`, `reason`, `data` jsonb, `created_at` | Append-only, like `audit_log` |
| `order_notes` | `id`, `order_id`, `author_id`, `body`, `created_at` | Internal only |
| `shipments` | `id`, `order_id`, `status`, `carrier`, `tracking_number`, `tracking_url`, `shipped_at`, `delivered_at`, `failed_reason`, `metadata` jsonb | `metadata` holds Phase 7's courier fields |
| `shipment_lines` | (`shipment_id`, `order_line_id`), `quantity` | |
| `payments` | `id`, `order_id`, `provider` (cod, manual), `method`, `status` (pending, paid, voided, failed), `amount`, `reference`, `recorded_by`, `settled_at`, `metadata` jsonb | Phase 5A adds the gateway's transaction ID with a unique index |
| `promotions` | `id`, `title` jsonb, `kind` (automatic, code), `status`, `starts_at`, `ends_at`, `priority`, `exclusive`, `max_discount`, `usage_limit`, `usage_count`, `per_customer_limit`, `conditions` jsonb, `action` jsonb | Index (`tenant_id`, `status`, `starts_at`) |
| `promotion_codes` | `id`, `promotion_id`, `code`, `usage_limit`, `usage_count` | Unique (`tenant_id`, `upper(code)`) |
| `promotion_customer_usage` | (`promotion_id`, `phone`), `count` | |
| `blocked_phones` | (`tenant_id`, `phone`), `reason`, `created_by`, `created_at` | |
| `variants` (changed) | **New:** `sale_price`, `sale_starts_at`, `sale_ends_at` | Check: the sale price is below the price, and the window ends after it starts |
| `import_jobs` (changed) | `kind` gains `customers` | |

- **Actors:** `ACTOR_TYPES` gains `shopper` (history, stock movements and audit checks are updated).
- **Money columns** are bigint poisha (Phase 2's `money()`).
- **No soft delete** on orders, payments or shipments (PLAN.md).

**Settings (typed JSON, no migration):**

- `checkout`:
  - whether email is optional, required or hidden;
  - the quantity limit per line;
  - the order number prefix;
  - rate limits;
  - shopper accounts on or off;
  - the terms checkbox (on, with a link to the terms page, once one is published).
- `cod`: enabled, the maximum order value, the advance rule (§3.8).

**Events** (new):

- `order.placed`, `order.confirmed`, `order.processing`, `order.completed`, `order.cancelled` (with who cancelled), `order.edited`;
- `payment.recorded`, `payment.settled`, `payment.voided`;
- `shipment.created`, `shipment.shipped`, `shipment.delivered`, `shipment.failed`, `shipment.returned`;
- `customer.created`, `customer.updated`;
- `promotion.changed`.

No consumer acts on them in this phase except the existing purge (through inventory's availability event). Phase 5A's notifications consume them.

## 5. Services (`packages/core`)

- **`geo`** (new, read-only): zone lookup for an area, address validation.
- **`pricing`** (new, pure): the money rules (§3.1) and the promotion engine (§3.13). No database access, so it is fully unit-tested and the admin's test cart uses it unchanged.
- **`cart`** (new): create, add, change, remove, apply code, choose area, merge on sign-in, totals. It reads the catalog only through the catalog module's published reads (Phase 3).
- **`orders`** (new): `placeOrder`, the state machines, confirm, cancel, edit with preview, notes, tags, shipments, delivery, number counter, history, lists and search, dashboard queries.
- **`payments`** (new): the provider interface, `cod` and `manual`, settlement and the derived payment status.
- **`customers`** (new): find or create by phone, addresses, tags, kept totals, import.
- **`promotions`** (new): CRUD, codes, usage counting and giving back, campaign figures.
- **`inventory`** (changed): reservations, releases and sales referenced to orders and shipments (`reference_type`, `reference_id`); nothing new in its rules.
- **`catalog`** (changed): sale windows, effective prices, the edge messages (§3.14).

## 6. API

### 6.1 Storefront (`/v1/store/*`, through the store host's `/api/*`; never cached)

| Area | Endpoints |
| --- | --- |
| Cart | `GET /cart`, `POST /cart/lines`, `PATCH /cart/lines/{variantId}`, `DELETE /cart/lines/{variantId}`, `PUT /cart/code`, `DELETE /cart/code`, `PUT /cart/area` |
| Checkout | `GET /checkout` (the cart, the zones' rules, COD availability, the holiday state, the Turnstile site key), `POST /checkout/orders` (`Idempotency-Key` and a Turnstile token required) |
| Orders | `POST /orders/view` (a view token, from the confirmation page), `POST /orders/track` (number and phone), `POST /orders/cancel` (the token `track` returns) |
| Account | `/auth/*` (Better Auth: request and verify a code, sign out), `GET /account`, `PATCH /account`, `GET /account/orders`, `GET`, `POST`, `PATCH` and `DELETE /account/addresses[/{id}]` |

- **Tracking is rate-limited** per IP, and per order number with a lockout after 5 wrong phones (Phase 1's limiter lockout), so order numbers can't be walked to find addresses.
- **The tenant comes only from the forwarded host,** as in Phase 3.
- **Tokens and codes travel in bodies, never in URLs** (Workers Logs record URLs).

### 6.2 Admin (`/v1/admin/*`)

| Area | Endpoints |
| --- | --- |
| Orders | `GET /orders` (cursor pages; filters by status, payment, delivery, zone, source, tags, dates; search by number, phone or name), `GET /orders/{id}`, `POST /orders` (manual), `POST /orders/{id}/confirm`, `/process`, `/cancel`, `POST /orders/{id}/edit/preview`, `POST /orders/{id}/edit`, `POST /orders/{id}/notes`, `PATCH /orders/{id}` (tags), `GET /orders/print?ids=` |
| Shipments | `POST /orders/{id}/shipments`, `POST /shipments/{id}/ship`, `/deliver` (with "cash collected"), `/fail`, `/return`, `DELETE /shipments/{id}` (pending only) |
| Payments | `POST /orders/{id}/payments` (manual) |
| Customers | `GET /customers`, `POST /customers`, `GET /customers/{id}` (with orders), `PATCH /customers/{id}`, `DELETE /customers/{id}`, addresses, `POST /customers/imports` |
| Delivery | `GET /geo/version`, `GET`, `POST`, `PATCH` and `DELETE /delivery-zones[/{id}]`, `POST /delivery-zones/quote` (fee for an area and weight) |
| Promotions | `GET`, `POST` and `PATCH /promotions[/{id}]`, `POST /promotions/{id}/codes` (generate a batch), `GET /promotions/{id}/codes`, `POST /promotions/test` (the test cart) |
| Settings | `PATCH /store` gains `checkout` and `cod`; `GET`, `POST` and `DELETE /blocked-phones[/{phone}]` |
| Dashboard | `GET /dashboard` |

- **Every command that changes an order or a payment accepts `Idempotency-Key`** (PLAN.md), and the admin sends one.
- **Errors are problem details with stable codes** (PLAN.md):
  - `insufficient_stock` (naming the lines);
  - `price_changed` (with the new totals);
  - `promotion_unavailable`, `cod_unavailable`, `checkout_paused` (holiday), `rate_limited`, `illegal_transition`.

## 7. Admin screens

- **Home:** the dashboard (§3.17).
- **Orders:**
  - **the list:** filters, saved in the URL; bulk confirm; bulk print of invoices or packing slips; export;
  - **the detail:** status chips for the four statuses; lines with their discounts; totals; the customer, with the address masked without `customers.read`; payments; shipments; the timeline (history and notes together); actions as the state machines allow ("Confirm", "Create shipment", "Mark shipped", "Mark delivered", "Cancel", "Edit");
  - **edit:** the lines with a preview of the new totals before saving;
  - **new order:** manual entry (§3.12), usable on a phone.
- **Customers:**
  - the list, with search by phone or name and tag filters;
  - the detail: orders, addresses, totals, tags and notes;
  - import, through Phase 2's import screen with a "Customers" type;
  - export.
- **Promotions:**
  - the campaign list, with uses and sales;
  - the builder: conditions and the action as a guided form, with the summary sentence and the test cart;
  - codes: generate a batch, export, see each code's use.
- **Settings → Delivery:** zones with their fees, weight rule and coverage, picked from the division, district and area lists, and a fee calculator.
- **Settings → Checkout:** the email field, the quantity limit, the order number prefix, COD, rate limits, the blocklist and shopper accounts.

**The sign-in bundle is at 143 of 150 KiB** (phase-3-report). PR 0b first loads each language's messages on demand, which Phase 2 estimated at about 10 KiB back. The new screens' messages load with their screens, as Phase 3's did.

Every new screen gets axe checks at both viewports in the E2E suite.

## 8. Storefront pages and scripts

§3.16 lists the pages. Their scripts are:

- **add to cart**, on product pages: it extends Phase 3's variant picker;
- **cart:** quantity, code and totals;
- **checkout:** the form, the area dropdowns from the geography file, totals, Turnstile and the idempotency key;
- **order view and tracking;**
- **account:** sign-in and lists.

Each page's script loads only on that page.

## 9. Performance and CPU

- **Cache:** catalog pages stay cached for every shopper, signed in or not (§3.4, §3.11). Only `/api/*` calls reach the API.
- **CPU:**
  - cart calls are anonymous store API requests, which ADR 0003 measured at about 6 ms at p50;
  - `placeOrder` is the heaviest shopper request: about 15 round trips in one transaction, with batched statements as in the inventory service. It will be over the Free plan's 10 ms, as staff requests already are (ADR 0013).
- **A stopped checkout loses nothing:** its transaction never commits, and the page retries with the same idempotency key. But a shopper who sees an error may leave. The owner chose to stay on the Free plan (Q2), so checkout runs under ADR 0013's alarm: the first stopped request, or the first serious client, is still the trigger for Workers Paid. The CPU step reports `placeOrder` on its own so the trend is visible before a real store sells.
- **The CPU step** adds the cart calls, `placeOrder` and the admin's order list and detail, reported per route as in Phase 3.
- **Budgets:**
  - Lighthouse runs on the cart and checkout pages as well (LCP 2.5 s, CLS 0.1, TBT 200 ms, accessibility 95);
  - the JavaScript budget check covers the new pages;
  - the API Worker stays under its bundle budget; it was at 782 KiB.

## 10. Tests

| Layer | Tests |
| --- | --- |
| Unit (`shared`, `core/pricing`) | Allocation adds up exactly and handles one-poisha remainders; whole-taka rounding favours the shopper; VAT included and excluded, per line, with rounding; zone lookup (area over district over fallback) and the weight rule; every promotion condition and action; stacking picks the larger of exclusive and combined; buy X get Y discounts the cheapest items; caps; the four state machines' allowed and refused transitions; order number formatting; phone normalization at checkout |
| Integration (`core`, Postgres with RLS) | `placeOrder` from cart to order with every snapshot; idempotent replay, a concurrent duplicate (`in_progress`) and a reused key with another body; `price_changed`; holiday, COD maximum and blocklist refusals; reservations, release on cancel, sale on shipping, restock on return, with `inventoryDrift` zero after each; editing adjusts reservations and re-checks promotions; derived payment and delivery statuses; cancellation gives promotion uses back; customer find-or-create by phone; the customer import in batched chunks; cleanup of old carts; a sale window's edge message updates `price_min` and purges |
| **Concurrency** | **The last unit:** 10 `placeOrder` calls for the last unit on 10 separate connections at once; exactly one order exists, the other nine get `insufficient_stock`, reserved is 1 and the ledger matches. **Usage limits:** a code limited to 1 use, 10 checkouts at once, one succeeds. **Order numbers:** 20 concurrent orders get 20 different numbers |
| Isolation | Every new table joins the suite automatically. New endpoints join it too: store A's host can never read, track, cancel or check out store B's cart, order, customer, promotion code or shopper session, including when both stores use the same phone, code or order number. The `ref` schema is readable and not writable |
| Storefront (Vitest) | The `Path=/api` cookies never reach a page; pages stay cacheable with a cart and with a session; the count cookie holds only a number; the view token travels in the fragment |
| Shopper auth | ADR 0005's checks on many hosts: a session made on store A's host is not valid on store B's; the per-store secret; the cookie cache stays off (the existing config test) |
| E2E (preview) | A shopper on demo-grocery (Bangla) adds two products, applies a code, chooses an area, sees free-delivery progress, places a COD order and sees the confirmation; tracks it by number and phone and cancels it. Staff on demo-fashion enter a manual order, confirm it, ship part of it, then the rest, mark it delivered with cash collected, and see it completed; print an invoice and a packing slip; export the Steadfast format. Promotions: create one, check it with the test cart, see it in a shopper's cart. Axe on every new page and screen at both viewports |
| CPU and Lighthouse | §9, on every preview |

## 11. Free-tier impact

| Resource | Free limit | Phase 4 | Note |
| --- | --- | --- | --- |
| Worker requests | 100,000/day | Every cart, checkout, tracking and account call is a storefront request plus an API request | The pilot estimate (about 20 orders and perhaps 100 carts a day) adds about 2,000 a day |
| Worker CPU | 10 ms | Cart calls about 6 ms; `placeOrder` and staff order screens over 10 ms | §9 and Q2 |
| Hyperdrive queries | 100,000/day | A few per cart call; about 15 per order | A few thousand a day for the pilot |
| Neon compute | 100 CU-hours/month | **Carts wake the database,** where browsing doesn't | The largest change in this phase. The monitor's Neon line shows it. At pilot traffic it stays within PLAN.md's 45–75 CU-hour estimate, which already assumed orders |
| Neon storage | 0.5 GB | A few KB per order (PLAN.md); carts are deleted after 30 days | |
| Queue operations | 10,000/day | About 5 events per order over its life, 3 operations each; sale edges | About 300 a day for the pilot |
| Durable Object requests | 100,000/day | Rate-limit checks on checkout, tracking and code requests | |
| Email | Brevo: 300/day for the store domain; Resend: 100/day for staff | Shopper sign-in codes only; order emails come in Phase 5A | Tens a day at most. The daily monitor adds Brevo's count, alerting at 70% |
| Turnstile | Free | Checkout and sign-in | |

## 12. Pull requests

| # | Scope |
| --- | --- |
| 0 | This plan and the PLAN.md status |
| 0b | `admin`: each language's messages loaded on demand, to make room in the sign-in bundle |
| 1 | `db`: the `ref` schema with divisions, districts and areas (the owner approves the list, Q5); the geography file built from it |
| 2 | `shared`: the money rules for orders, the four state machines, checkout and COD settings, the order number format, the promotion condition and action schemas |
| 3 | `db`: delivery zones, carts, customers and addresses, counters, `ACTOR_TYPES` with `shopper` |
| 4 | `db`: orders, lines, adjustments and allocations, history, notes, shipments, payments; the variants' sale columns; promotions, codes, usage; blocked phones |
| 5 | `core`: geo and zones; `pricing` (money rules, without promotions yet); `cart` |
| 6 | `core`: `placeOrder` with idempotency, reservations, the counter and snapshots; the concurrency tests (acceptance criteria 1 and 2) |
| 7 | `core`: the order machines, shipments, stock on shipping and return, `cod` and `manual` payments, cancellation, editing |
| 8 | `core`: customers (find or create, addresses, totals) and the customer import with batched writes |
| 9 | `api`: storefront cart, checkout, view and tracking endpoints; rate limits; isolation fixtures; SDK |
| 10 | `api`: shopper accounts on many hosts (Better Auth instance per host, per-store secret, `Path=/api` cookies); ADR 0020; the `brevo` email adapter and ADR 0022 (shopper email from the store domain). **Needs the Brevo API key** |
| 11 | `api`: admin orders, shipments, payments, customers, delivery zones, settings, blocklist, dashboard, print data; SDK |
| 12 | `storefront`: add to cart, the cart page and the header count |
| 13 | `storefront`: checkout, confirmation, tracking with cancellation; the new tracking events |
| 14 | `storefront`: the account pages |
| 15 | Turnstile on checkout and both sign-ins; custom domains added to the widget by the domain lifecycle. **Needs the Turnstile widget and permission** |
| 16 | `admin`: orders list and detail, the timeline, shipments, delivered and collected, cancellation, editing |
| 17 | `admin`: manual order entry; customers, with import and export |
| 18 | `admin`: dashboard, settings (delivery zones, checkout, COD, blocklist) |
| 19 | `admin`: invoices and packing slips, bulk printing, order export with the Steadfast and Pathao formats |
| 20 | `core`, `api`, `admin`, `storefront`: the promotion engine, codes and usage limits, the builder with the test cart, the campaign list, offers in the cart; ADR 0021 (promotions) |
| 21 | Scheduled sale prices with their edge messages and the bulk editor |
| 22 | CI: E2E flows with axe, Lighthouse and the JavaScript budget on the new pages, the CPU step's new routes; production checks |
| 23 | Phase 4 report |

As in Phases 2 and 3, these can ship as one pull request with one commit per step, with its own preview database (`db-branch`), if the owner prefers.

## 13. Acceptance criteria and how they're verified

| Criterion | Verification |
| --- | --- |
| Two shoppers ordering the last unit at the same moment: exactly one succeeds | The concurrency test (§10) on every PR, against real Postgres with RLS and separate connections. On the preview, a script sends two `placeOrder` calls at once for a demo variant with stock 1, through the real storefront host: one order, one `insufficient_stock`, and the variant's ledger and level agree |
| Retrying `placeOrder` with the same idempotency key returns the same order and never creates two | Integration tests: a sequential retry, a retry while the first call is still running, and a retry after the first call's response was lost (the transaction committed, the client never heard). Each finds one order, one set of reservations and one use of the code. On the preview, the E2E repeats the checkout request with the same key and gets the same order number |
| A full COD order can go from placed to delivered in the admin, with stock and history correct at every step | The E2E on the preview and, after deploy, in production on a demo store: placed (reserved +1), confirmed, shipped (reserved −1, on hand −1), delivered with cash collected (payment `paid`), completed. The timeline shows each step with its actor, and `inventoryDrift` is zero |

## 14. Questions for the owner

| # | Question | Recommendation, or the owner's answer |
| --- | --- | --- |
| Q1 | Estimate and order | **Answered (Oct 17): one phase of about 7 weeks,** with the order flow first (PRs 1–19) and promotions after it (PRs 20–21) |
| Q2 | Workers Paid and the shopper email sender | **Answered (Oct 17): stay at $0.** Shopper email goes through Brevo's free plan (300 a day) from `managemind.store`, with a new `brevo` adapter; staff email stays on Resend. Checkout stays on the Free plan under ADR 0013's alarm (§9). The recommendation was Workers Paid with Cloudflare Email Service when the first real store sells; that remains the path if the alarm fires |
| Q3 | Shopper accounts | **Built, off by default per store, email code only until Phase 5A adds phone codes.** An account shows only orders placed while signed in (§3.11). Most Bangladeshi shoppers check out as guests by phone |
| Q4 | Order numbers | **A per-store prefix, `#` by default, with numbers from 1001** (`#1001`). PLAN.md's example was `ORD-10234`. A store can set its own prefix (for example `AR-`) |
| Q5 | Geography | **Answered (Oct 17): division, district and area, where area is the upazila, or the metropolitan thana in Dhaka and Chattogram** (about 500 areas). The owner approves the final list in PR 1 |
| Q6 | Default delivery zones | **Inside Dhaka ৳70, Dhaka suburbs ৳100, outside Dhaka ৳130, plus ৳20 per kilogram over the first,** as a template every store can change. Please correct the numbers or the suburbs list if the market differs |
| Q7 | Whole taka | **Discounts rounded to whole taka in the shopper's favour,** so totals stay in whole taka for couriers |
| Q8 | VAT on the delivery fee | **None by default,** until an accountant confirms how delivery should be treated. VAT is off by default for every store anyway |
| Q9 | Stock | **Reserved at placement, sold when shipped, and no automatic cancellation of unconfirmed orders in this phase.** Phase 6's confirmation workflow deals with fake orders |
| Q10 | Promotion stacking | **One code per cart, alongside automatic promotions. The shopper gets the larger of the best exclusive promotion and all the combinable ones together** |
| Q11 | OTP before COD | **Moved to Phase 5A,** where stores connect their SMS gateways |
| Q12 | Scheduled sale prices | **Per variant, with a start and end, set in bulk,** and purges sent at the window's edges by delayed messages (§3.14) |
| Q13 | Turnstile on custom domains, and invoices | **Turnstile answered (Oct 17): add the `Account → Turnstile: Edit` permission to `CF_STORE_TOKEN`,** so connecting a domain also adds it to the widget. **Still open: invoices and packing slips as printable pages,** saved as PDF by the browser |
| Q14 | Holiday mode and manual orders | **The storefront refuses orders during the window; staff can still enter manual orders,** for example pre-orders taken by phone |
| Q15 | A repeat customer with a different name | **The customer keeps their first name and the order keeps what was typed.** Staff can update the customer's name from the order |

**Still needed from the owner:**

- the remaining answers above (Q3, Q4, Q6–Q12, Q13's invoices, Q14, Q15);
- the Brevo account with `managemind.store` verified, and a sending-only API key (before PR 10);
- approval of the geography list (PR 1);
- the Turnstile widget and the token permission (before PR 15);
- the Steadfast and Pathao sample bulk-upload files, if available (before PR 19);
- the market defaults (zones and fees, COD maximum, usual promotions, invoice contents), if they differ from the plan's.
