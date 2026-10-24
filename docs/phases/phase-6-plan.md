# Phase 6 plan — Sales recovery

- Status: Approved (Oct 24). The owner accepted every recommendation in §14, and chose to build now with the pull request opened once Actions minutes allow (Q1, Q12). What's still needed from the owner: the legal review's wording for the checkout notice (Q5), and the pilot stores' call scripts and threshold data (Q3, Q4)
- Date: 2026-10-24
- Scope: PLAN.md "Phase 6 — Sales recovery": incomplete orders, the fake-order check, the order confirmation workflow and duplicate order detection. It builds on Phase 4's checkout, blocklist and rate limits, and on Phase 5A's flagged phones, the advance delivery charge and the code by SMS before cash on delivery (phase-5a-plan §3.4, §3.11, §3.14)

## Goal

Cash on delivery is most of what Bangladeshi stores sell, and two things cost them the most: shoppers who leave checkout, and orders that are never received. A COD order that comes back costs the store two trips' delivery fees and ties up stock for days. This phase gives staff the tools Bangladeshi stores now use spreadsheets and phone calls for:

- **Incomplete orders.** A shopper who typed a phone number at checkout and left is saved, with their cart, for staff to call and turn into an order with one click.
- **A delivery success score per phone.** It comes from the store's own history and shows on every order. Store rules can ask a low-scoring phone for the delivery charge in advance or for a code by SMS.
- **Order confirmation.** A queue of new COD orders to call, with click-to-call, a call script, the outcome of each call, retries, and an optional SMS link with which shoppers confirm or cancel themselves. Confirmation rates show on the dashboard.
- **Duplicate orders.** Orders from the same phone with the same items, placed minutes apart, are flagged. Staff merge one into the other or cancel it in one click.

PLAN.md gives this phase no acceptance criteria. Proposed (Q2):

1. A shopper who enters a valid phone at checkout and leaves appears under Incomplete orders after the delay the store set. Staff create an order from it in one click, and the record shows it was converted. A shopper who comes back and finishes closes the record by themselves.
2. Every order, the manual order screen and the confirmation queue show the phone's score and the counts behind it. A phone below the store's threshold gets the store's rule (an advance or a code) at checkout, and a test proves it.
3. A COD order can go from placed to confirmed or cancelled through the queue: one outcome per call, retries at the store's interval, and two staff never call the same order at once. With the SMS link on, a shopper confirms or cancels from their phone. The dashboard shows the confirmation rate.
4. Two orders from one phone with the same items within the store's window are flagged. Merging them leaves one order with the lines of both, and stock and history right (`inventoryDrift` stays empty).

**Estimate: about 3 weeks** (PLAN.md: 2–3). The order inside the phase (§12):

1. the data, settings and the score, which everything else reads;
2. duplicates and the confirmation queue, which the pilot's stores feel first;
3. the SMS link;
4. incomplete orders;
5. reports, CI, the security review and the report.

## 1. Prerequisites status

PLAN.md: "Never start a phase until its prerequisites have been provided." Phase 6's are about the pilot, and **the pilot hasn't started.**

| Item | Status |
| --- | --- |
| Pilot feedback on fake orders and confirmation calls | **Open.** The pilot starts after Phase 5B's keys and the first signed client (phase-5b-report §5). The design below follows what Bangladeshi COD stores commonly do, so the feedback should change defaults and wording, not the data model (Q1) |
| The store's confirmation call script | **Open.** The build ships a default script in Bangla and English that each store edits (§3.6). **Needed before the pilot stores turn the queue on** |
| The score thresholds that should trigger an advance delivery charge | **Open.** The build ships with the score shown and **no threshold set** (Q4), and records each order's score when it is placed (§3.3). After a few weeks of pilot orders, the report in §3.9 shows which threshold would have caught which orders. **Not blocking** |
| Carried from Phase 5B | **Open:** `CREDENTIALS_KEY` and the VAPID keys in production, the backup keys, our invoice details and the real plans, Workers Paid when the first pilot client signs. **Without `CREDENTIALS_KEY` no store has SMS**, so the SMS link (§3.7) and the code by SMS stay off in production. Everything else in this phase works without SMS |
| GitHub Actions minutes | **Ran out on Oct 24.** CI, previews and deploys wait for the monthly reset. **Building waits for the reset**, unless the owner sets an Actions budget (Q12) |
| Legal review | **Open.** Saving a shopper's phone before they order needs a notice at checkout (§3.2). The store privacy template from Phase 5B gains a paragraph about it. Both go to the same local legal review as Phase 5B's templates (Q5) |

## 2. Research: what is borrowed

| From | What |
| --- | --- |
| Shopify | **Abandoned checkouts:** a checkout is saved once the shopper has given contact details. Staff see the list with the cart and contact, and a checkout that is finished later is marked recovered. **Order risk analysis:** each order shows a risk level (low, medium, high) with the indicators behind it and a recommendation, without blocking the order. Staff decide |
| Saleor, Medusa | A checkout (Saleor) or cart (Medusa) collects the email and addresses step by step before it becomes an order, so a half-finished one already holds the contact. Neither lists abandoned ones for staff. We keep Phase 4's split (carts are disposable) and add a small record beside the cart, not contact fields on it |
| Stripe Radar | A risk score per payment, and rules written against it ("review if score > 65", "request 3D Secure if …"). We copy the shape: one score per phone, and per-store rules that pick an action. Our actions are the ones Phases 4 and 5A built: the blocklist, the advance delivery charge and the code by SMS, plus a call |
| Bangladeshi couriers and COD tools | Steadfast and other couriers, and the "fraud checker" tools stores use, show a phone's delivered and cancelled parcels as a **success ratio**, often across merchants. Stores call every COD order before booking a courier, and many send an SMS asking the shopper to confirm. Phase 6 uses the store's own history only. Courier data can be added in Phase 7 behind the same score (§3.3) |
| Vendure | Order states with guards: confirmation stays the order machine's `confirm` move, not a new state. A call's outcome is history on the order, like every other change |
| What we simplify | No automatic "complete your order" SMS or email to shoppers who left (Q7). No score shared across stores (Q6). No machine-learned score: a ratio with counts that staff can read and explain to a shopper. Duplicates are matched on phone and items only, not on address or name |

## 3. Design decisions to approve

### 3.1 Settings

All in the store's settings JSON, validated by zod in `shared`, as Phase 4's `checkout`, `cod` and `fraud` are. No migration for a new option.

| Group | Setting | Default |
| --- | --- | --- |
| `recovery` | `incomplete`: save incomplete checkouts | on (Q5) |
| | `showAfterMinutes`: how long after the shopper's last change a checkout counts as incomplete | 30 |
| | `keepDays`: how long a record is kept (1–30) | 30 (PLAN.md's retention table) |
| `confirmation` | `queue`: new COD orders wait in the confirmation queue | on |
| | `includePaid`: orders paid in full online wait in the queue too | off |
| | `maxAttempts`: unanswered calls before an order is marked unreachable | 3 |
| | `retryAfterMinutes`: when an unanswered order is due again | 60 |
| | `cancelUnreachable`: cancel an order at `maxAttempts` | off (Q8) |
| | `smsLink`: text new COD orders a link to confirm or cancel (needs SMS) | off (Q9) |
| | `callRisky`: a risky phone's order stays in the queue after the shopper confirms by link (§3.7) | on (Q9) |
| | `autoConfirm`: confirm at placement `never`, or for `trusted` phones (§3.3) | `never` (Q10) |
| | `script`: the call script, Bangla and English | §3.6's default |
| `fraud` | `flagAfterFailed` (Phase 5A) | 1, as now |
| | `minScore`: phones under this score are risky (0–100, or none) | none (Q4) |
| | `minDecided`: decided orders a phone needs before its score counts | 2 |
| | `duplicateMinutes`: the window for duplicates (0 turns the check off) | 30 (Q11) |

`cod.advance: 'flagged'` and `cod.otp: 'flagged'` keep their meaning and read "risky" from §3.3, which includes today's flagged phones. The admin labels them "risky phones".

### 3.2 Incomplete orders

**When a checkout is saved:**

- The checkout page saves its contact and address once the phone field holds a valid Bangladeshi mobile number, and again when the name, area or street change. Saves are debounced (2 seconds) and send only what changed.
- The cart must have lines, and the store must have `recovery.incomplete` on.
- **Each save replaces the cart's one record** (`store.incomplete_orders`, unique by cart). It keeps the contact, the address fields typed so far, and a copy of the cart's lines with the prices shown, so the record outlives a cart that is cleaned up.
- **A notice under the phone field** says, in both languages: "{store} saves your number and cart, so they can help if you don't finish. Don't save." **Don't save** deletes the record and marks the cart, so nothing more is saved from it. Wording goes to the legal review (Q5).
- **Nothing is ever sent to the shopper** because of the record (Q7). Staff call, which is what stores do now.

**Its life:**

| Status | When |
| --- | --- |
| `open` | Saved, and the shopper hasn't ordered. Shown to staff only after `showAfterMinutes` without a change, so nobody calls a shopper still typing |
| `contacted` | Staff recorded a call or a note. Still open for an order |
| `converted` | Staff made an order from it (below) |
| `recovered` | The shopper finished the same cart, or any order from that phone was placed after the record was saved. A recovered record that was `contacted` first counts as recovered after a call in the report |
| `dismissed` | Staff closed it: a test, a wrong number, "not interested" |

- **Making an order from it** opens the manual order screen filled in: the customer by phone, the lines, the area and street, and the cart's code. Staff check the delivery charge and stock and save. That is the same `placeOrder` as every manual order, with the source `website`, so prices, promotions and stock are checked again at that moment. The record becomes `converted` in the same transaction, and the order keeps its id (`metadata.incompleteOrderId`).
- **Expiry:** the daily cleanup deletes records `keepDays` after their last change, whatever their status.
- **Personal data:** shopper anonymization (phase-5b-plan §3.13) deletes the phone's records; the export includes them; the purge and the store reset delete them (the registry test fails if the table is missing from `STORE_TABLES`).
- **Abuse:** the save route is rate-limited per IP (30 an hour) and per cart, and accepts only the cart cookie's own cart. A bot filling the table costs it a cart and a valid number per record, and the table empties itself after `keepDays`.

### 3.3 The delivery success score

**What it counts.** For one phone in one store, from the store's own orders:

| Counted | Orders |
| --- | --- |
| **Delivered** | Delivered to the shopper. A later return still counts as delivered: the shopper took the parcel |
| **Not received** | A shipment came back undelivered (Phase 5A's return to origin), or the order was cancelled as `fake`, `wrong_number` or `no_answer` (§3.5's cancel codes) |
| Shown, not counted | Cancelled at the shopper's request, as a duplicate, for stock, or for an unpaid online payment; orders still open |

**The score** is `round(100 × delivered ÷ (delivered + not received))`. It is shown with its counts, for example "80% · 8 of 10 delivered · 1 returned at the door · 1 fake". A phone with no decided order is **new**, not risky.

**Risky** (the word the admin uses; Phase 5A's "flagged" is part of it) is any of:

- flagged by staff (Phase 5A);
- `failedDeliveries` at or above `fraud.flagAfterFailed` (Phase 5A);
- a score under `fraud.minScore`, with at least `fraud.minDecided` decided orders.

**Trusted**, used only by `confirmation.autoConfirm`: a score of 90 or more over at least 3 delivered orders, and not risky.

**Where it shows:** on the order list (a badge), the order detail (a panel with the counts, the phone's other open orders, and a link to the customer), the manual order screen as soon as the phone is typed, the confirmation queue, incomplete orders, and the customer page.

**How it's computed:**

- **At read time, from `store.orders` by phone**, in one grouped query. The `(tenant_id, phone)` index exists. A list page computes every phone on the page in the same query. No counters are kept, so there is nothing to drift, nothing to backfill, and an anonymized customer's orders drop out by themselves.
- **At placement, `placeOrder` stores the score it saw** (`orders.phone_score`, null for new). It replaces Phase 5A's `phoneFlagged` query, so checkout runs one risk query, as now. The stored score is what the report in §3.9 needs to show which threshold would have caught which orders.
- **One function, `phoneRisk`**, in `core/fraud`, returns the counts, the score, risky or trusted, and why. Phase 7 can add a courier's data through it without touching its callers.

**Not across stores** (Q6). PLAN.md allows it only if the platform terms and the client's consent permit it, and Phase 6 doesn't build it. If it is wanted later, the platform would keep counts per hashed phone from consenting stores only, and show them as a separate line.

### 3.4 Duplicate orders

- **At placement,** `placeOrder` looks for an order from the same phone placed within `fraud.duplicateMinutes`, not cancelled, with **the same set of variants** (quantities may differ). The newer order gets the flag `possible_duplicate` and `duplicate_of` pointing at the older one. One query on the phone index.
- **Every channel is checked.** The manual order screen also warns before saving, so a Facebook order entered by staff for a shopper who also ordered on the website is caught first.
- **Staff act on the newer order**, from its detail page or the order list:

| Action | What happens |
| --- | --- |
| **Merge into #1001** | Allowed when both orders are pending or confirmed, nothing has shipped, and the newer one has no settled or pending online payment. The older order gets the newer one's lines (quantities added) through the existing order edit (phase-4-plan §3.9), so totals, promotions, the COD amount and reservations follow. One delivery charge stays, the older order's. The newer order is cancelled with the code `duplicate`. Both histories link to each other. One transaction |
| **Cancel as duplicate** | The newer order is cancelled with the code `duplicate`, and its stock is released |
| **Not a duplicate** | The flag is cleared, with history |

- **Shoppers get no message** for an order cancelled as a duplicate: they keep the other order and its messages. A merged order sends no "order edited" message either, as now.

### 3.5 The confirmation queue

**Which orders:** every `pending` order with an amount to collect on delivery, from any source. With `includePaid`, also orders paid in full online. An order still waiting for its online advance joins once the advance is paid; one whose payment expires is cancelled by Phase 5A's 60-minute check, as now. Manual orders saved with **Save and confirm** never join.

**Its state** is one row per order in `store.order_confirmations`, made at the first call, claim or SMS: the attempts, the last outcome, when it's due again, who claimed it, the SMS link, and how the order was confirmed (`call`, `link`, `staff`, `auto`). Each call is a history row on the order (`machine: 'confirmation'`), so the order's timeline shows every call with its note.

**Outcomes:**

| Outcome | What happens |
| --- | --- |
| **Confirmed** | The order machine's `confirm`, as the Confirm button does now. The shopper gets the "order confirmed" message, as now |
| **No answer** | Attempts + 1; due again after `retryAfterMinutes`. At `maxAttempts` the order is flagged `unreachable`, and with `cancelUnreachable` it is cancelled with the code `no_answer` |
| **Call back later** | Due again at the time chosen (in 1 hour, 3 hours, this evening at 8, tomorrow at 10). Not an attempt. A note is required |
| **Wrong number** | Cancelled with the code `wrong_number`. A checkbox also adds the phone to the blocklist |
| **Cancelled** | The shopper said no. Staff pick why: `shopper_request` (changed their mind), `fake` (says they never ordered), or `other` with a note |

Staff can still change the order before confirming it (the address, a size): the call panel links to the order edit.

**Two staff never call the same order.** Opening an order's call panel claims it for 5 minutes, with a conditional update, so the second person sees "Rina is calling" and the next order. Recording an outcome ends the claim.

**The queue's tabs:** **To call** (due now: never called, or due again), **Later** (not due yet), **Unreachable**, and **Risky first** (To call sorted by risk). Oldest first within a tab.

**Cancel codes** (`orders.cancel_code`) apply to every cancellation, not only the queue's: `shopper_request`, `no_answer`, `wrong_number`, `fake`, `duplicate`, `out_of_stock`, `payment_expired` (set by Phase 5A's check) and `other`. Cancelling from the order page asks for one too. The free-text reason stays. Older orders have none, and count as "other".

**Auto-confirm** (`confirmation.autoConfirm: 'trusted'`): an order from a trusted phone (§3.3) is confirmed at placement by the system, records `auto`, and never joins the queue. Off by default (Q10).

**Nothing runs on a timer.** "Due again" is a time the queue compares with now when staff open it. `cancelUnreachable` happens on the call that reaches `maxAttempts`.

### 3.6 The call script

- A store edits its script in Bangla and English under Settings → Order confirmation. Placeholders are filled in for each order: `{name}`, `{order_number}`, `{items}`, `{total}`, `{cod_amount}`, `{area}`, `{delivery_estimate}` (the zone's), `{store_name}`. They render as text only, through Phase 5A's template renderer.
- The script shows in the call panel, folded on a phone, in the order's language.
- **The default** (to be replaced by the pilot's, Q3), in English: "Hello, is this {name}? I'm calling from {store_name} about your order {order_number}: {items}, {total} to pay on delivery to {area}. Shall we send it? … Thank you, it will reach you in {delivery_estimate}." The Bangla default is written for spoken Bangla, not translated word for word.

### 3.7 The SMS link

- **With `confirmation.smsLink` on and the store's SMS gateway working,** a new order that joins the queue gets one SMS: "{store_name}: confirm your order {order_number} ({cod_amount} on delivery): https://{store host}/c/{code}". It is a new shopper message (`confirm_request`), planned from the existing `order.placed` event, so no new outbox event and no new queue operation. It goes in the delivery log like every message, and each store can edit its wording.
- **The code is short,** so the SMS stays one or two parts: 10 random base-62 characters (about 59 bits), stored as a SHA-256 hash on the confirmation row. Phase 4's order tokens are about 90 characters, too long for an SMS.
- **The page** (`/c/{code}`) is on the store's own host, in the order's language, not cached and not indexed. It shows the order number, the items and quantities, the total, the amount to pay on delivery and the area, never the street. **Confirm** and **Cancel** are buttons, so a link preview fetching the page can't confirm anything.
- **A link works while the order is pending,** for at most 48 hours. Confirming records `link`. Cancelling is Phase 4's shopper cancel, with the code `shopper_request` and the existing staff alert.
- **Rate limits:** 20 an hour per IP, and 5 wrong codes per IP lock it out for an hour. A wrong code and an expired one get the same "this link no longer works" page.
- **A shopper who confirms by link leaves the queue,** except a risky phone's order when `confirmation.callRisky` is on (the default, Q9). Its link records the shopper's answer but leaves the order pending in the queue, marked "confirmed by SMS, call first": the phone is reachable, and staff still call before confirming it. A cancel by link cancels it either way.
- **The code by SMS before COD** (Phase 5A, `cod.otp`) stays as it is: it checks the phone before the order exists, and the link confirms the order after.

### 3.8 Admin screens

Mobile first, as before. Each new screen loads on demand, so the sign-in bundle stays under 150 KiB.

The screens follow Phase 5C's patterns ([ADR 0029](../adr/0029-admin-redesign.md)):
- "Confirm" and "Incomplete" join the order list's status tabs, with their counts.
- Each screen gets a breadcrumb, cards, phone cards, and its main action pinned above the tab bar on phones.
- The customer page's delivery record, which 5C added, becomes the score's panel.

- **Orders → Confirm:** the queue in §3.5. Each order is a card: the name, the phone with a large **Call** button (`tel:`), the score badge, the items, the total and COD amount, the area, the attempts and the last note. Tapping **Call** claims the order and opens the call panel with the script and the outcome buttons. After an outcome, the next order opens.
- **Orders → Incomplete:** the list in §3.2: when, the name, the phone with **Call**, the area, the items and their total, the score, the status. The detail has the lines with today's price and stock, the notes, and **Create order**, **Mark contacted** and **Dismiss**.
- **Order list:** the score badge, and filters for "needs confirmation", "possible duplicate", "unreachable" and "risky".
- **Order detail:** the risk panel (§3.3), the duplicate banner with its three actions (§3.4), the confirmation state with every call, and the cancel code on Cancel.
- **Manual order:** the score and any possible duplicate as soon as the phone is typed, next to the blocklist warning that exists.
- **Customer page:** the score and its counts.
- **Settings → Order confirmation:** §3.1's `confirmation`, `recovery` and `fraud` settings, and the script editor with a preview. The existing advance and code settings link here.
- **Dashboard:** "To call" (due now), the confirmation rate for the last 7 days, incomplete orders today and how many were recovered, and possible duplicates. These join the existing "waiting for confirmation" figures, in the same summary query.

### 3.9 Reports

Reports → **Sales recovery**, for a date range, computed when asked with no stored totals, as Phase 5A's reports are:

- **Incomplete orders:** saved, contacted, converted by staff, recovered by the shopper, and the value of each.
- **Confirmation:** COD orders placed; confirmed by call, link, staff or auto; cancelled by code; unreachable; the median time from placement to confirmation; the confirmation rate.
- **Delivery by score:** delivered and not received for orders placed with a score of 0–49, 50–79, 80–100 and new (from `orders.phone_score`). This shows what a threshold would have caught, which is what Q4 needs.
- **Duplicates:** flagged, merged, cancelled and dismissed.

Incomplete orders are kept for `keepDays` at most (30), so their part of the report covers that long at most.

### 3.10 Who can do what

| Action | Permission | Roles |
| --- | --- | --- |
| See the score | `orders.read` | Every role, Viewer included: counts only, no personal data |
| Work the queue: claim, record outcomes, send the link again | `orders.write` | Owner, manager, staff |
| See incomplete orders | `orders.read` + `customers.read` | Owner, manager, staff |
| Contact, dismiss, create an order from one | `orders.write` + `customers.read` | Owner, manager, staff |
| Merge, cancel as duplicate, dismiss a duplicate | `orders.write` | Owner, manager, staff |
| Change the settings and the script | `settings.write` | Owner, manager |
| The Sales recovery report | `reports.read` | Owner, manager |

No new permission. The checks are in the core services, as before.

### 3.11 New dependencies

None.

## 4. Data model

| Change | Notes |
| --- | --- |
| `store.incomplete_orders` (new) | `tenant_id`, `id`, `cart_id` (unique while set; set null when the cart is cleaned up), `phone`, `name`, `email`, `address` (jsonb: the fields typed so far), `lines` (jsonb: variant, quantity, title and price shown, at most 50), `subtotal`, `locale`, `status` (`open`, `contacted`, `converted`, `recovered`, `dismissed`), `note`, `contacted_by`, `contacted_at`, `order_id`, `created_at`, `updated_at`. Indexes: (`tenant_id`, `status`, `updated_at desc`), (`tenant_id`, `phone`). RLS as every store table |
| `store.order_confirmations` (new) | `tenant_id`, `order_id` (primary key with the tenant), `attempts`, `last_outcome`, `due_at`, `claimed_by`, `claimed_until`, `link_hash` (unique per store), `link_sent_at`, `link_expires_at`, `link_answered_at`, `confirmed_via`, `created_at`, `updated_at`. Index (`tenant_id`, `due_at`) |
| `store.orders` | `cancel_code` (checked list, §3.5); `phone_score` (smallint, null for new); `duplicate_of` (same store's order); `flags` gains `possible_duplicate` and `unreachable`; the phone index gains `placed_at desc` for the duplicate check |
| `store.order_history` | `machine` gains `confirmation` |
| `store.carts` | `recovery_opt_out` (boolean): the shopper chose **Don't save** |
| `store.messages`, `store.message_templates` | The shopper message event `confirm_request` (SMS only) joins their checked lists. Its default wording is in code, and a store can override it, as for every message (ADR 0025) |
| `app.cleanup_expired()` | Deletes incomplete orders `keepDays` after their last change. Each store's `keepDays` is in its settings, so the function reads it per store, with 30 days as the ceiling |
| `STORE_TABLES` | Both new tables, in purge order. The export's deny list check covers them (phase-5b-report §2.1), and `link_hash` is on it |
| Events | No new event. `order.confirmed` gains `via` (`call`, `link`, `staff`, `auto`); `order.cancelled` gains `code`. The message plan reads both: a duplicate's cancellation sends nothing, and an order confirmed by link sends no "order confirmed" SMS, since the shopper just confirmed it |

Two migrations: the schema, then grants and the cleanup function, as in earlier phases.

## 5. Services

| Module | Does |
| --- | --- |
| `core/fraud` | `phoneRisk` and `phoneRisks` (a list of phones in one query), the risky and trusted rules, the duplicate check |
| `core/recovery` (new) | Incomplete orders: save, opt out, list, contact, dismiss, the manual order prefill, and closing records when an order is placed |
| `core/orders` | `placeOrder`: the risk snapshot, the duplicate flag, auto-confirm, closing incomplete orders. The confirmation queue: claim, outcomes, retries, the link; cancel codes; merge and duplicate actions |
| `core/notifications` | `confirm_request`; the plan reads `via` and `code` |
| `core/reports` | Sales recovery |

## 6. API

### 6.1 Store (`/v1/store/*`, through the store host's `/api`)

- `PUT /checkout/draft`: the contact and address typed so far, for the cookie's cart. `204`. `DELETE /checkout/draft`: **Don't save**.
- `GET /confirm/{code}`: the order's summary for the link page. `POST /confirm/{code}`: `{ action: 'confirm' | 'cancel' }`.

### 6.2 Admin (`/v1/admin/*`)

- `GET /confirmations?tab=…`: the queue. `POST /orders/{id}/confirmation/claim`; `POST /orders/{id}/confirmation/outcomes`: `{ outcome, note?, code?, dueAt?, block? }`; `POST /orders/{id}/confirmation/link`: send the SMS link again (at most twice an order).
- `GET /incomplete-orders`, `GET /incomplete-orders/{id}`, `POST /incomplete-orders/{id}/contacted`, `POST /incomplete-orders/{id}/dismiss`, `GET /incomplete-orders/{id}/prefill`. `POST /orders` (manual) gains `incompleteOrderId`.
- `POST /orders/{id}/duplicate/merge`, `POST /orders/{id}/duplicate/dismiss`. Cancel as duplicate is `POST /orders/{id}/cancel` with the code `duplicate`.
- `GET /phones/{phone}/risk`: the score for the manual order screen. The order list and detail, the queue, incomplete orders and the customer page include it.
- `POST /orders/{id}/cancel` gains `code`. `GET /dashboard` gains §3.8's figures. `GET /reports/recovery`.

The SDK gains all of these, as in earlier phases.

## 7. Storefront

- **Checkout:** the save calls and the notice with **Don't save** (§3.2). About 1 KiB more JavaScript on the checkout page only; product pages don't change.
- **The link page** `/c/{code}`: §3.7, both languages, `noindex`, never cached, WCAG 2.1 AA.
- **The store privacy template** (Phase 5B) gains a paragraph on saved checkouts and how long they're kept, filled from `recovery.keepDays`, for the legal review.

## 8. Security and privacy

- **Saved checkouts are personal data collected before an order.** They are kept 30 days at most, deleted on anonymization, purged with the store, exported to the client, never sent anything, and the shopper can opt out at the field (§3.2).
- **The link code** is random, stored only as a hash, valid for 48 hours and only while the order is pending. A wrong code and an expired one look the same. The page shows no street, and only buttons change anything.
- **The score never reaches shoppers.** A risky shopper sees the rule's effect (pay the delivery charge first, or enter a code) and the same wording any shopper does, as in Phase 5A. Blocked phones keep Phase 4's rate-limit refusal.
- **The save route takes only its own cart** (the cookie's) and refuses a cart that has opted out. Every write is validated with zod.
- **Isolation:** both new tables join the isolation suite through the API and as raw SQL with the app role.

## 9. Performance and free-tier impact

| Resource | Free limit | Phase 6 | Note |
| --- | --- | --- | --- |
| Worker requests | 100,000/day | 1–3 saves per checkout started; the link page and its two calls per link SMS | At pilot volume (about 20 orders a day in all), a few hundred a day |
| Hyperdrive queries | 100,000/day | About 3 per save; `placeOrder` +1 (the duplicate check; the risk query replaces Phase 5A's); list pages +1 | Small |
| Worker CPU | 10 ms (Free), Paid once the pilot signs | The score is one grouped SQL query; no computation in the Worker beyond a division. The CPU step adds the save route, the queue, an outcome and the link page | `placeOrder`'s p99 is 137 ms today |
| Queue operations | 10,000/day | None new: the link SMS rides `order.placed` | |
| KV | 1,000 writes/day | None | |
| Neon storage | 0.5 GB | Incomplete orders (a few KB each, 30 days at most) and one confirmation row per COD order | Small |
| SMS | The store's own gateway | One more SMS per COD order where `smsLink` is on | The store pays its gateway; off by default |

Nothing runs on a timer (§3.5). The daily cleanup gains one delete.

## 10. Tests

| Layer | Tests |
| --- | --- |
| Unit | The score: counts, rounding, new phones, what counts as not received. Risky and trusted rules with each setting. The duplicate match (same variants, other quantities, outside the window, cancelled). The queue's outcomes, retries and `maxAttempts`. The link code and its hash. Script rendering in both languages. The incomplete order's statuses |
| Integration (Postgres with RLS) | A save upserts one record per cart; **Don't save** deletes it and refuses later saves. Finishing the cart marks it `recovered`; an order from the same phone elsewhere does too; creating one from the screen marks it `converted` in the same transaction. The cleanup deletes after `keepDays`. Anonymization deletes the phone's records. `placeOrder` stores the score; a risky phone gets the advance or the code; a trusted one is auto-confirmed when set. A duplicate is flagged; merging moves the lines, keeps one delivery charge, cancels the newer order, and `inventoryDrift` stays empty. Two claims at once: one wins. `cancelUnreachable` cancels at `maxAttempts`. A link confirms once; a second use, an expired link and a confirmed order's link all fail the same way |
| Isolation | Both new tables and every new endpoint: store A gets 404 for B's incomplete orders, confirmations and link codes; a store A link code on store B's host finds nothing. Viewer sees scores but not incomplete orders |
| Export and purge | The export has both tables and no `link_hash`; the purge test seeds both and leaves zero rows |
| E2E (preview, `full-preview`) | A shopper types a phone at checkout and leaves; staff see the incomplete order (with `showAfterMinutes` at 0 on the test store), call, and create the order. A COD order goes through the queue: no answer, then confirmed, and a second order is cancelled as fake, lowering the phone's score. The same items ordered twice are merged. The link page confirms an order (the preview's SMS is the dev outbox, as in Phase 5A). Axe on every new screen, at a phone and a desktop viewport |
| CPU step | The save route, the queue, an outcome, the link page and its confirm |
| Lighthouse | Checkout's budgets unchanged with the notice; the link page added |

## 11. What changes for existing stores

- **Nothing turns on by itself except what is harmless:** the score shows, duplicates are flagged, the queue lists pending COD orders (which the dashboard's "waiting for confirmation" counts now), and incomplete orders are saved with the notice (Q5).
- **No threshold, no auto-confirm, no auto-cancel and no SMS link** until a store chooses them.
- **The demo stores** get sample incomplete orders, scores and a short queue from the weekly reset's sample orders, so sales meetings can show the phase.

## 12. Pull requests

As in Phase 5B: **one pull request with one commit per step**, its own preview database (`db-branch`), and one `full-preview` run near the end, to spend as few Actions minutes as possible (Q12).

| # | Scope |
| --- | --- |
| 0 | This plan and PLAN.md's status |
| 1 | `shared` + `db`: settings, cancel codes, flags, both tables, history's machine, `confirm_request`, the cleanup, `STORE_TABLES` and the export deny list (migrations 0040–0041) |
| 2 | `core/fraud`: `phoneRisk`, the snapshot in `placeOrder`, risky and trusted in the advance and the code; the score in the order, customer and manual order APIs |
| 3 | `admin`: the score badge and risk panel; Settings → Order confirmation (fraud part) |
| 4 | Duplicates: the check at placement and in the manual order preview; merge, cancel and dismiss; the banner and list filter |
| 5 | The confirmation queue: claims, outcomes, retries, unreachable, cancel codes everywhere, auto-confirm |
| 6 | `admin`: Orders → Confirm with the call panel and script; the dashboard's figures |
| 7 | The SMS link: the code, the message, the storefront page and its routes |
| 8 | Incomplete orders: the checkout's saves and notice, the routes, closing records in `placeOrder` |
| 9 | `admin`: Orders → Incomplete, and creating an order from one |
| 10 | Reports → Sales recovery; the demo stores' sample data; the privacy template's paragraph |
| 11 | CI: the E2E flows, the CPU step's routes, Lighthouse on the link page |
| 12 | The security review against PLAN.md's checklist, with fixes |
| 13 | Phase 6 report |

## 13. Acceptance criteria and how they're verified

| Criterion | Verification |
| --- | --- |
| 1. Incomplete orders are saved, shown after the delay, converted in one click, and closed when the shopper finishes | Integration tests (§10) on every PR; the E2E on the preview. **In the pilot:** how many were saved, called and converted, from the Sales recovery report |
| 2. The score shows everywhere it should, and a phone below the threshold gets the store's rule | Unit and integration tests; the E2E sees the score drop after a fake order. **In the pilot:** the report's delivery-by-score table sets the default threshold (Q4) |
| 3. A COD order moves through the queue; two staff never call the same order; the SMS link confirms or cancels; the dashboard shows the rate | Integration tests (the claim race, the link's single use); the E2E with the dev SMS outbox. **In the pilot:** the confirmation rate and median time to confirm, before and after the queue |
| 4. Duplicates are flagged, and merging leaves stock and history right | Integration test with `inventoryDrift`; the E2E's merge |

## 14. Questions for the owner

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | **When to build.** PLAN.md puts Phase 6 after the pilot, and its prerequisites are the pilot's feedback | **Approve the design now and build once the Actions minutes reset,** while the pilot runs. Everything ships off or harmless (§11), and the pilot's feedback then sets the script, the threshold and the defaults before the stores turn things on. Waiting for the end of the pilot delays the phase about 6 weeks, and Bangladeshi COD stores call orders from day one |
| Q2 | The acceptance criteria | **The four in the Goal**, since PLAN.md has none for this phase |
| Q3 | The call script | **The default in §3.6 until the pilot stores give theirs.** Each store can edit it |
| Q4 | The score threshold for the advance or the code | **No threshold until the pilot's data** (§3.9). Then a suggested default, probably around 50% over at least 2 decided orders |
| Q5 | Saving incomplete checkouts: on by default, the notice and **Don't save** | **On, with the notice, from the legal review's wording.** Kept 30 days at most. If the legal review wants consent before saving, it becomes a checkbox and stays off by default |
| Q6 | Sharing scores across stores | **Not built.** It needs the platform terms and each client's consent. Courier data can come in Phase 7 |
| Q7 | Texting or emailing shoppers who left checkout | **No.** It is marketing without consent, and costs the store SMS. Staff call. It can be added later as a store option with its own consent |
| Q8 | Cancel unreachable orders automatically at `maxAttempts` | **Off by default,** with 3 attempts an hour apart. Staff decide; the order shows "unreachable" |
| Q9 | The SMS link | **Off by default; 48 hours; and a risky phone is still called first** (`callRisky`). It needs the store's own SMS gateway, so it waits for `CREDENTIALS_KEY` in production |
| Q10 | Auto-confirming trusted phones (90% or more over at least 3 delivered) | **Off by default,** as a store option |
| Q11 | Duplicates: 30 minutes, same set of variants, merge keeps the older order's delivery charge | **Yes,** each store can change the window or turn the check off |
| Q12 | GitHub Actions minutes for the build | **One pull request with one `full-preview` run** (about 37 minutes), after the reset. A small Actions budget would let the build start before the reset |
