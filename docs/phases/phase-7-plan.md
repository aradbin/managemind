# Phase 7 plan: Couriers and fulfillment

- Status: **Proposed (Oct 25), waiting for the owner's approval.** §14 has the questions; nothing is built until they are answered
- Date: 2026-10-25
- Scope: PLAN.md "Phase 7 — Couriers and fulfillment". Courier states on Phase 4's shipments, a `CourierProvider` with Steadfast, Pathao and RedX adapters, one-click and bulk booking, status sync by webhook with a little polling, COD settled by the courier's delivery, COD reconciliation, courier-driven failed deliveries and returns, and area mapping. It builds on Phase 4's shipments and COD payment (phase-4-plan §3.7, §3.8), Phase 5A's credentials vault, failed deliveries and returns (ADR 0024; phase-5a-plan §3.11, §3.12), and Phase 6's score, which already counts failed deliveries (phase-6-plan §3.3)

## Goal

Today staff book every parcel by hand in each courier's panel, or upload the Steadfast and Pathao bulk files from Phase 4's order export. Then they copy each tracking number back, and mark each order delivered or failed when they think to check. The courier's money arrives days later as one payout for many parcels, and nobody checks it against what was collected. This phase connects the store to its couriers:

- **Booking.** Staff book a confirmed order with one tap, or book a selection from the order list. The parcel, its tracking number and its link come back on the order.
- **Status by itself.** The courier's updates move each shipment on: booked, picked up, in transit, delivered, failed, returned. Delivery settles the COD payment for the amount the courier collected, and a failed delivery opens Phase 5A's failed-delivery flow.
- **Reconciliation.** For each courier, the store sees what was collected, what the courier charged, what it paid out, and any difference.
- **Area mapping.** Our areas are matched to each courier's own city, zone and area IDs. The platform reviews whatever doesn't match.

PLAN.md gives this phase no acceptance criteria. Proposed (Q2):

1. **Booking.** A confirmed COD order is booked with a connected courier in one tap. Twenty selected orders are booked in one bulk action, and each order shows its result. A retried or doubled booking never makes two parcels.
2. **Sync.** A courier's webhook moves the shipment within a minute: booked → picked up → in transit → delivered. A forged webhook changes nothing. A shipment that hears nothing for 12 hours is polled. Delivery settles the COD payment for the amount collected, and a different amount is flagged.
3. **Returns.** A courier's failed delivery marks the shipment failed, which the score counts. A parcel the courier returns waits in a list for staff to confirm it arrived; confirming restocks it. A partial delivery flags the order with what was collected.
4. **Reconciliation.** For a courier and a period, the report shows the COD collected, the courier's fees, the payouts and the differences. On test data it matches the courier's payout statement to the taka.
5. **Areas.** Every active area has a Pathao and a RedX match, or is on the platform's review screen. Booking an unmatched area asks staff to pick the courier's area, and never fails silently.

**Estimate: about 3 weeks** (PLAN.md: about 3). The order inside the phase (§12):

1. the data, the shipment machine and the provider interface, which everything else uses;
2. Steadfast end to end: connecting, booking, webhooks, polling and COD. Steadfast needs no area mapping, so it proves the whole flow first;
3. area mapping, then Pathao, then RedX;
4. bulk booking, courier returns and reconciliation;
5. CI, the security review and the report.

## 1. Prerequisites status

PLAN.md: "Never start a phase until its prerequisites have been provided." Phase 7's are courier accounts and their webhook details. **None has been provided yet.**

| Item | Status |
| --- | --- |
| API credentials for Steadfast, Pathao and RedX (sandbox where offered) | **Open, blocking for each courier's adapter.** As far as public sources show: **Pathao** has a sandbox. **RedX** has one, with a token from RedX. **Steadfast** has none, so testing needs a real merchant account, with test parcels cancelled before pickup (Q3). The build can start with the provider interface, the machine and a fake courier. Each real adapter waits for its credentials |
| Each courier's webhook or polling details | **Partly known, to confirm with the credentials.** No courier publishes complete public API docs; what follows comes from their merchant SDKs and community packages. **Steadfast** posts to a callback URL with a Bearer token. **Pathao** signs its posts (`X-PATHAO-Signature`) and asks for a handshake reply. **RedX** posts without a signature. §3.5 trusts none of them: every webhook is checked by asking the courier |
| Which couriers the pilot stores use | **Open** (prerequisites Part 5, Q3). PLAN.md's order is Steadfast, Pathao, RedX. If a pilot store uses another courier (Paperfly, eCourier, Sundarban), it becomes an adapter of its own later (Q4) |
| Hosts to allow in the cloud environment's network list | **For the owner, once credentials arrive** (prerequisites Part 6). To confirm with the credentials: Steadfast `portal.packzy.com` (formerly `portal.steadfast.com.bd`); Pathao `api-hermes.pathao.com` and the sandbox `courier-api-sandbox.pathao.com`; RedX `openapi.redx.com.bd` and the sandbox `sandbox.redx.com.bd`. Workers in production reach any host, so this list is for the sessions and CI only |
| The platform's own courier accounts, for the area lists | **Open.** Pathao's and RedX's area lists need an API token, but the lists are the same for every merchant. One platform account per courier, kept as GitHub secrets, fills them weekly (§3.6). A pilot store's credentials can stand in until then |
| A sample payout statement from each courier's panel | **Open, not blocking.** It gives the columns for the statement import (§3.7). **Needed before PR 10** |
| Carried from Phase 5A | **`CREDENTIALS_KEY` in production is blocking for production use.** Courier credentials go in the same vault, so without the key no store can connect a courier in production. Previews and local development work without it (ADR 0024 decision 7) |
| Workers Paid | **The owner's decision (Q2 of 5B): at the first pilot client.** On the Free plan one invocation may make at most 50 subrequests. That limits a bulk booking to batches (§3.4), and is why the area lists sync in GitHub Actions (§3.6). Nothing here needs Paid |
| Legal review | **Open, and joins Phase 5B's.** The store privacy template gains a sentence: couriers receive the shopper's name, phone and address to deliver. The platform's data processing agreement names couriers as the store's own processors, chosen by the store |

## 2. Research: what is borrowed

| From | What |
| --- | --- |
| Shopify | A fulfillment has its own status, and separate **shipment events** from the carrier: `label_printed`, `confirmed`, `in_transit`, `out_for_delivery`, `attempted_delivery`, `delivered`, `failure`. Each event has a time and a message, and the order's timeline shows them all. The tracking company, number and URL sit on the fulfillment. We keep the same split: a few shipment states that change stock and money, and a log of the courier's own events (§3.1) |
| Medusa | A **fulfillment provider** is a module with `validateFulfillmentData`, `createFulfillment`, `cancelFulfillment` and `createReturnFulfillment`. It keeps provider-specific data as JSON on the fulfillment, and each provider's options are set per store. Our `CourierProvider` (§3.2) has the same shape, plus `status` and `parseWebhook`, since Bangladeshi couriers push statuses rather than labels |
| Vendure | A **`FulfillmentHandler`** creates the fulfillment and hooks into its transitions. Custom states can be inserted into the fulfillment process without forking it. We add `booked` and `in_transit` the same way, as states in the existing machine with guards and effects |
| Saleor, commercetools | Carriers are reached through apps (Saleor) or external services (commercetools), with tracking data on the delivery. Neither does COD reconciliation, which is ours to design |
| Bangladeshi couriers | **Steadfast:** a free-text address, so no area IDs. An invoice number that must be unique, a bulk endpoint, status by consignment ID, invoice or tracking code, and a balance call. **Pathao:** OAuth with the merchant's login, then city, zone and area IDs, and a pickup store ID. **RedX:** a static token in an `API-ACCESS-TOKEN` header, a delivery area ID, a pickup store, and bilingual tracking messages. All three collect COD, charge a delivery fee plus a COD charge, and pay merchants in batches |
| Our own SSLCommerz IPN (phase-5a-plan §3.5) | **A notification is only a hint.** The handler asks the gateway itself before anything changes. Courier webhooks follow the same rule (§3.5) |
| What we simplify | One courier and one parcel per shipment; a second parcel is a second shipment, as now. No rate shopping between couriers: the store picks one. No courier labels: couriers print their own at pickup, and our packing slip gains the consignment ID. No exchange or reverse-pickup parcels booked through the API: Phase 5A's exchanges ship as ordinary orders, and returns travel however the store arranges (Q11). No courier fraud data (Q10) |

## 3. Design decisions to approve

### 3.1 Shipment states

Phase 4's machine is `pending → shipped → delivered | failed`, then `failed → returned`. Phase 4 and the code already reserve `booked`, `picked_up` and `in_transit` (phase-4-plan §3.7). **Proposed:** two new states, with "picked up" kept as today's `shipped`, because that is where stock leaves the store (Q5).

| From | Event | To | Effects |
| --- | --- | --- | --- |
| `pending` | `book` | `booked` | None: the parcel is booked, the goods are still in the store |
| `booked` | `unbook` | `pending` | None: the booking was cancelled; the shipment can be booked again or deleted |
| `pending`, `booked` | `ship` | `shipped` (shown as **Picked up** for a courier shipment) | `sell_from_reservation`, as today |
| `shipped` | `transit` | `in_transit` | None |
| `shipped`, `in_transit` | `deliver` | `delivered` | `settle_cod` with the amount collected (§3.5) |
| `shipped`, `in_transit` | `fail` | `failed` | None, as today |
| `failed` | `return` | `returned` | `restock`, as today |

- **Manual shipments don't change.** Without a courier, staff use `pending → shipped → delivered` as now.
- **The order's delivery status** (`deliveryStatusOf`) counts `in_transit` as shipped and `booked` as not shipped yet. The order list shows "Booked" from the shipment, so staff see which orders wait for pickup.
- **A sync walks the machine.** Couriers skip steps, and webhooks are lost. When the courier says "delivered" about a parcel we still have as `booked`, the sync applies `ship`, then `deliver`, so stock and COD follow the same effects as if every update had arrived.
- **The courier's own events are kept** in `store.shipment_events`: the courier's status, its message (in Bangla and English where RedX gives both), the courier's time, and where we heard it (booking, webhook, poll). The order's timeline and the tracking page read them. States change stock and money; events are for people to read.
- **An open courier shipment stays polled for 30 days** (§3.5). After that it's flagged **stuck**, for staff to settle by hand.

### 3.2 The courier provider

`packages/providers/src/couriers/`, as `payments` and `sms` are:

```ts
interface CourierProvider {
  check(creds): Promise<CheckResult>;                  // on saving credentials: balance, token, or pickup stores
  book(parcel: Parcel): Promise<Booked>;               // consignment ID, tracking code, first status, fee if given
  bookMany?(parcels: Parcel[]): Promise<BookResult[]>; // Steadfast's bulk endpoint
  status(ref: ParcelRef): Promise<CourierUpdate>;      // by consignment ID, or by our invoice when unsure (§3.4)
  cancel?(ref: ParcelRef): Promise<void>;              // where the API offers it
  parseWebhook(req, secret): WebhookHint | 'refused';  // which parcel, never trusted beyond that
  areas?(): AsyncIterable<CourierArea>;                 // Pathao and RedX, for the sync job (§3.6)
  trackingUrl(code: string): string;
}
```

**A `CourierUpdate` is our own vocabulary:** `booked`, `picked_up`, `in_transit`, `on_hold`, `delivered`, `partial_delivered`, `returning`, `returned`, `cancelled`, `paid_out` or `unknown`. It comes with the COD collected and the fee when the courier gives them, the courier's time, and its message. Each adapter maps its courier's statuses; §3.1's sync maps ours to the machine. The mapping below comes from the couriers' SDKs and is **to be checked against each sandbox** (step 4, 8, 9):

| Ours | Steadfast | Pathao | RedX |
| --- | --- | --- | --- |
| `booked` | `in_review` | `Pending`, `Pickup_Requested`, `Assigned_for_Pickup` | `pickup-pending` |
| `picked_up` | (none: Steadfast's `pending` follows pickup) | `Picked` | (none) |
| `in_transit` | `pending` | `At_the_Sorting_HUB`, `In_Transit`, `Received_at_Last_Mile_HUB`, `Assigned_for_Delivery` | `ready-for-delivery`, `delivery-in-progress` |
| `on_hold` (an event, not a move) | `hold`, `*_approval_pending`, `unknown` | `On_Hold` | `agent-hold`, `agent-area-change` |
| `delivered` | `delivered` | `Delivered` | `delivered` |
| `partial_delivered` | `partial_delivered` | `Partial_Delivery` | (none) |
| `returning` | `cancelled` | `Delivery_Failed`, `Return` | `agent-returning` |
| `returned` | (from the courier's return list) | `Returned` | `returned` |
| `cancelled` (before pickup) | (the panel only) | `Pickup_Cancelled` | `cancelled` |
| `paid_out` | (the payout statement, §3.7) | `Paid`, `Paid_Return` | `paid` |

- **Steadfast's `*_approval_pending` statuses** mean a rider marked the parcel and Steadfast hasn't approved it yet. The sync acts on the final status only, so a rider's mistake never settles COD.
- **A fake courier** (`fake`) is connectable on previews and locally, never in production. A dev route moves its parcels through every status, as the dev mailbox does for email. This gives the E2E a courier, which Phase 6 lacked for SMS (phase-6-report §5).

### 3.3 Connecting a courier

- **Credentials go in the vault** (ADR 0024). `CREDENTIAL_KINDS` gains `steadfast`, `pathao` and `redx`, one row per store and courier, so a store can connect several couriers at once.

| Courier | Secret (sealed) | Plain settings |
| --- | --- | --- |
| Steadfast | API key, secret key | — |
| Pathao | Client ID, client secret, the merchant's login email and password; the access and refresh tokens Pathao issues (resealed when renewed) | The pickup store (chosen from Pathao's list on saving), delivery type (48-hour by default), item type (parcel) |
| RedX | API token | The pickup store (chosen from RedX's list) |

- **Checked before saving**, as every credential is: Steadfast's balance call, Pathao's token, RedX's pickup stores. A refused key is never stored.
- **The webhook.** The settings page shows each courier's callback URL, `https://api.<platform domain>/v1/webhooks/couriers/<courier>/<store id>`, and a secret we generate for the store, with the steps to paste both into the courier's panel. The secret is sealed with the credentials, and **Generate a new one** replaces it.
- **Pathao's password** is the merchant's own panel login, which its API requires. The page says so, and suggests a separate login for the API where Pathao allows one (Q6).

### 3.4 Booking

**One order:** the order page gets **Book with Steadfast** (or the store's default courier, with the others in a menu). It's offered on a confirmed or processing order with units not yet in a shipment. A sheet shows what will be sent before anything is booked:

| Sent | From |
| --- | --- |
| Name, phone (`01…`), address | The order: the street line, then the area and district in English |
| COD amount | What's still due on delivery, in whole taka, as Phase 4's export rounds it. To change it, staff edit the order, not the booking |
| Weight | The lines' weights, at least 0.5 kg; the store's default (500 g) where variants have none. Editable |
| Items and note | The titles and quantities (cut to the courier's length); the shopper's note and the store's own note. Editable |
| Invoice | `<order number>-<n>`, the shipment's own reference, unique per store and courier |
| Area (Pathao, RedX) | The mapping (§3.6). When the area has none, staff pick the courier's area in a search box, and the choice is kept on the shipment |
| Pickup store, delivery type (Pathao, RedX) | The courier's settings |

**How a booking runs, so a retry never makes two parcels:**

1. In one transaction: the shipment (all units not yet shipped, or the lines chosen, as now) is created, or claimed if it already exists, by moving it to `booking` with a conditional update. A second tap finds it claimed.
2. Outside any transaction, the API calls the courier. A database transaction is never held open over a network call.
3. In a second transaction: `book` with the consignment ID, the tracking code and link, and the first event.
   - **The courier refused** (a bad phone, an unknown area): the shipment goes back to `pending` with the courier's message on it, for staff to fix and retry.
   - **No answer** (a timeout or a 5xx): the shipment is marked **booking unsure**. The next try asks the courier for that invoice first: Steadfast can find a parcel by invoice. For Pathao and RedX, if their APIs can't (to confirm), staff are asked to check the panel before booking again (Q7).

**Bulk:** staff select orders on the list and choose **Book with…**. The server checks each order (confirmed, units left, an address, an area match where needed) and shows the checks; staff fix or deselect the problems, then confirm. Up to 100 orders a time.

- The bookings run in the background: one message per 10 shipments on the delayed-work queue (`managemind-domains`, which already carries payment checks and sale edges by `kind`). That stays under the Free plan's 50 subrequests per invocation. Steadfast's bulk endpoint takes the 10 in one call.
- The list shows each order's result as it lands: booked with its number, refused with the reason, or unsure.

**Afterwards:**

- **Pickup** (`ship`) sends Phase 5A's "shipped" message, as staff's **Mark shipped** does now. Its `{carrier}`, `{tracking_number}` and `{tracking_url}` are filled from the booking.
- **The packing slip and the invoice** show the courier and the consignment ID.
- **Cancel booking** is offered while the shipment is `booked`. It calls the courier where the API offers it (RedX; Pathao and Steadfast to confirm). Otherwise it asks staff to cancel in the courier's panel first, and records that they did.
- **An order with a booked parcel can't be edited** in its lines or totals ("Cancel the booking first"). The parcel's COD amount would otherwise be wrong.
- **Auto-booking:** `couriers.autoBook` can book an order with the default courier when it is confirmed. Off by default (Q8).

### 3.5 Status sync

**Webhooks first.** `POST /v1/webhooks/couriers/{courier}/{tenantId}`, on the API's host like SSLCommerz's IPN:

1. **A per-IP rate limit.** An unknown store, or one without that courier connected, gets 404.
2. **The courier's own check, where it has one:**
   - Steadfast's Bearer token is compared with the store's secret in constant time.
   - Pathao's signature is checked against the store's secret, and the handshake answered as Pathao asks (to confirm).
   - RedX has neither.
3. **The payload names a parcel; nothing else is trusted.** The handler asks the courier for that parcel's status with the store's credentials, then applies what the courier says. A forged webhook therefore costs one lookup and changes nothing. Amounts come from the courier's answer. Where only the webhook carries the COD amount (Steadfast), it's used only after the Bearer check, and otherwise the booked amount stands.
4. **Apply** (`applyCourierUpdate` in `core`): walk the machine (§3.1), write the event, and write history with the courier as the actor. The same status twice does nothing, and an update older than the shipment's last one is kept as an event but moves nothing.
5. **The reply:** 200 once handled, refused or ignored; 5xx only when the courier couldn't be asked, so it sends the webhook again.

**Polling, a few times a day, only for shipments that went quiet** (PLAN.md):

- Two more Cron Triggers, at about 13:00 and 19:00 in Dhaka, beside the daily batch. The Free plan allows 5 per account; this makes 3.
- Each run lists, through one security-definer function as the daily batch does, the courier shipments that are open and haven't been heard from for 6 hours. It sends them as `courier_poll` messages on the delayed-work queue, 20 shipments to a message.
- **Why Cron, not one delayed message per parcel:** the runs fall in business hours, when Neon is usually awake anyway. Two runs a day cost at most about 1.3 CU-hours a month. Delayed messages per parcel would wake the database at any hour, and cost three queue operations each (ADR 0013).
- **Sync now** on a shipment asks the courier at once, at most once a minute.

**What each update does:**

| Update | Effect |
| --- | --- |
| `picked_up`, `in_transit` | The moves in §3.1. Pickup sells the stock and sends "shipped" |
| `delivered` | `deliver`, and **COD is settled for the amount collected.** Equal to the pending COD payment: settled, as `settleCod` does today. Less: the pending payment shrinks to the amount collected and settles, and the order is flagged `cod_difference`, leaving it partially paid for staff to resolve. More: settled, and flagged the same way |
| `partial_delivered` | `deliver`, settled for the amount collected, and the order is flagged `partial_delivery`. The courier doesn't say which items came back, so staff open a return for them from the flag. The return is prefilled with the new reason `refused_at_door`, and it restocks at inspection as every return does (Phase 5A) |
| `returning` | `fail`, with the courier's message as the reason. The failed-delivery flow follows as today: the order shows failed, and the score counts it. Staff can turn on the new failed-delivery alert (below) |
| `returned` | The shipment stays `failed` and gets "returned by courier", with the time. It joins **Orders → Courier returns** until staff tap **Received**, which is today's `returnShipment`: it restocks and records the return cost (the courier's return charge when known, else the delivery fee). Stock is counted only once the parcel is in the store (Q9) |
| `cancelled` before pickup | `unbook`: the shipment goes back to `pending`, with the courier's message |
| `on_hold`, `unknown` | An event only |
| `paid_out` | The shipment is marked paid out (§3.7) |

**No new shopper messages.** "Shipped" and "delivered" already exist and now fire from the sync; an "out for delivery" SMS would cost the store one more text per parcel (Q12). A staff alert for a failed delivery joins the alert options, off by default.

### 3.6 Area mapping

Steadfast takes a free-text address, so it needs no mapping. Pathao needs a city, a zone and sometimes an area; RedX needs a delivery area. **Courier area lists are the same for every merchant, so the mapping is the platform's, not each store's.**

- **`ref.courier_areas`**: each courier's own areas, with their IDs and parents (for Pathao: city, zone, area), names, `active`, and when they were fetched. Areas the courier drops are retired, never deleted, since shipments point at them.
- **`ref.courier_area_map`**: our area to a courier area, with how the match was made (`name`, `manual`), and by whom.
- **The sync job** is a weekly GitHub Actions workflow (`courier-areas.yml`), using the platform's own courier tokens. Pathao's list takes one request per city and per zone, hundreds in all, which is far past the Free plan's 50 subrequests per invocation. ADR 0027's store jobs run in Actions for the same reason, and this costs about 3 minutes a week.
  - It updates the lists, then matches new or unmatched areas by name within the same district: our district to Pathao's city, our area (upazila or thana) to Pathao's zone and to RedX's areas in that district. English names are normalized for spelling ("Chattogram" and "Chittagong").
  - Anything it can't match goes to review. It never overwrites a manual match.
- **Platform → Courier areas** (super admins) lists our areas without a match for each courier, most used first (orders in the last 30 days), with the closest names by `pg_trgm` and the area staff picked at booking most often. A super admin saves a match in one tap, audited in the platform audit log.
- **At booking,** an unmatched area asks staff to pick, as in §3.4. The pick is used for that shipment and shown on the review screen. One store's choice never changes the mapping for every store until a super admin saves it.
- **RedX's areas are smaller than ours** (closer to post offices), so our area maps to one default RedX area, and staff can pick another at booking.

### 3.7 COD reconciliation

**Per shipment:**

- the COD asked;
- the COD collected (from the courier);
- the courier's fee: delivery plus the COD charge, when the courier gives it;
- the return charge;
- the payout it was paid in.

**Payouts:** `store.courier_payouts` holds one row per payment from a courier to the store: the courier, its reference, when it was paid, the amount, and the source. Its lines link to shipments, with each one's collected amount, fee and net. A payout comes from one of three sources:

1. **The courier's own status** (Pathao's `Paid`, RedX's `paid`), which marks the shipment paid out, with the amount where the courier gives it.
2. **A statement import.** Staff upload the payout statement from the courier's panel (CSV or Excel, read in the browser as the customer import does). Rows are matched by consignment ID, with a preview of what doesn't match before anything is saved. The columns come from each courier's sample statement (§1).
3. **Recorded by hand,** for a courier with neither.

**Reports → COD reconciliation:** a courier and a date range of deliveries, computed when asked, with no stored totals (as Phase 5A's reports are):

- delivered parcels, COD collected, courier fees, net due to the store, paid out, and outstanding;
- the outstanding parcels, oldest first, with how many days each has waited;
- **differences:** collected ≠ asked, and paid out ≠ collected − fee, each parcel listed;
- returns and their charges;
- an export to CSV and Excel.

Phase 8's "COD outstanding" report reads the same rows.

### 3.8 Settings

In the store's settings JSON, validated by zod in `shared`, as before. No migration for a new option.

| Setting | Default |
| --- | --- |
| `couriers.default`: the courier the order page offers first | The first connected |
| `couriers.defaultWeightGrams` | 500 |
| `couriers.note`: added to every parcel's note | Empty |
| `couriers.autoBook`: `never`, or `on_confirm` with the default courier | `never` (Q8) |
| `couriers.autoReceive`: treat "returned" from the courier as received, and restock | off (Q9) |

Each courier's own settings (the pickup store, the delivery type) are in its credentials row (§3.3), since they come from its API.

### 3.9 Admin screens

Mobile first, each new screen loaded on demand, on Phase 5C's patterns ([ADR 0029](../adr/0029-admin-redesign.md)):

- **The order page:** the shipment card gains the courier, the consignment ID, the tracking link, the courier's events as a timeline, and **Book**, **Cancel booking** and **Sync now**. Flags for a COD difference and a partial delivery link to what fixes them.
- **The order list:** **Book with…** on a selection (§3.4), the shipment's state on each row, and filters for "to book", "booked", "in transit", "returning" and "stuck". "To book" joins the status tabs with its count.
- **Orders → Courier returns:** parcels the courier says it returned, with **Received**.
- **Settings → Couriers:** connect each courier (credentials, the check, the webhook URL and secret with the steps), the defaults in §3.8, and a test booking on the fake courier where offered.
- **Reports → COD reconciliation**, with **Import a payout statement** and **Record a payout**.
- **Platform → Courier areas** (§3.6).
- **The dashboard:** to book, in transit, returning, and COD outstanding, in the same summary query.

### 3.10 The shopper's side

- **The tracking page** shows the shipment's state, the courier's events in the shopper's language where RedX gives both, and the courier's tracking link. It never shows fees, payouts or the courier's internal notes.
- **The "shipped" message** already has `{tracking_url}` (Phase 5A); a courier shipment fills it with the courier's tracking link.

### 3.11 Who can do what

| Action | Permission | Roles |
| --- | --- | --- |
| See shipments, courier events and tracking | `orders.read` | Every role |
| Book, cancel a booking, sync, mark a courier return received | `orders.write` | Owner, manager, staff |
| Connect a courier (credentials, webhook secret) | `settings.credentials` | Owner, manager |
| Courier settings | `settings.write` | Owner, manager |
| The reconciliation report | `reports.read` | Owner, manager, viewer |
| Import or record a payout | **New: `payments.reconcile`** (Q13) | Owner, manager |
| Courier areas | Platform: super admin (support can read) | — |

The checks are in the core services, as before.

### 3.12 New dependencies

None. The adapters use `fetch`; the statement import uses the admin's existing spreadsheet reader (`read-excel-file`).

## 4. Data model

| Change | Notes |
| --- | --- |
| `store.shipments` | `courier` (`steadfast`, `pathao`, `redx`, `fake`, or null for a manual shipment); `courier_ref` (our invoice; unique per store and courier); `consignment_id` (unique per store and courier); `tracking_code`; `courier_status`, `courier_status_at`, `courier_message`; `booking_state` (`booking`, `unsure`, or null), `booking_error`; `booked_at`, `in_transit_at`, `courier_returned_at`, `last_synced_at`; `cod_amount`, `cod_collected`, `courier_fee`, `return_charge` (money); `courier_area` (jsonb: the courier's IDs and names used); `payout_id`. `status` gains `booked` and `in_transit`. A partial index on open courier shipments by `last_synced_at`, for polling |
| `store.shipment_events` (new) | `tenant_id`, `id`, `shipment_id`, `courier_status`, `update` (our vocabulary), `message` (jsonb, `en` and `bn`), `courier_at`, `source` (`booking`, `webhook`, `poll`, `staff`), `created_at`. Unique on (`tenant_id`, `shipment_id`, `courier_status`, `courier_at`), so a repeated webhook adds nothing. Index (`tenant_id`, `shipment_id`, `courier_at`) |
| `store.courier_payouts` (new) | `tenant_id`, `id`, `courier`, `reference` (unique per store and courier), `paid_at`, `amount`, `fee_total`, `source` (`courier`, `import`, `manual`), `recorded_by`, `note`, `created_at`, `updated_at` |
| `store.courier_payout_lines` (new) | `tenant_id`, `payout_id`, `shipment_id` (unique: a parcel is paid once), `collected`, `fee`, `net` |
| `ref.courier_areas`, `ref.courier_area_map` (new) | §3.6. Not tenant data: readable by the app role, written only by the sync job and the platform screen (as `ref` is today) |
| `store.provider_credentials` | Kinds `steadfast`, `pathao`, `redx` (a checked list) |
| `store.orders` | `flags` gains `cod_difference` and `partial_delivery` |
| `store.returns`, `store.return_lines` | `RETURN_REASONS` gains `refused_at_door` |
| `app.courier_poll_due()` | Security definer: open courier shipments quiet for 6 hours, at most 30 days old, across stores, for the poll |
| Events | `shipment.booked`, `shipment.in_transit` and `shipment.booking_cancelled` are new; every shipment event's payload gains `courier`. The message plan reads `shipment.shipped` and `shipment.delivered` as now |
| `STORE_TABLES` | The three new store tables, in purge order. The export includes them; webhook secrets stay in the sealed credentials, which the export already leaves out |

Two migrations (0042–0043): the schema, then grants and the function, as in earlier phases. ADR 0030 records the courier design: verify by asking, the platform's area mapping, polling by Cron.

## 5. Services

| Module | Does |
| --- | --- |
| `providers/couriers` (new) | The interface, the Steadfast, Pathao, RedX and fake adapters, their status maps, and Pathao's token renewal |
| `core/couriers` (new) | Connecting and checking; the parcel built from an order; booking (one, many, unsure); cancelling; `applyCourierUpdate`; the poll's selection; area resolution; payouts, the statement import and the report |
| `core/orders` | The machine's new states and effects; `settleCod` with an amount; the edit guard on booked shipments; courier returns received |
| `core/notifications` | The tracking link in "shipped"; the optional staff alert for a failed delivery |
| `apps/api` | The webhook route; the `courier_book` and `courier_poll` messages on the delayed-work queue; the two Cron Triggers; the fake courier's dev route |
| `scripts/couriers` (new) | The area sync, run by `courier-areas.yml` |

## 6. API

### 6.1 Admin (`/v1/admin/*`)

- `POST /orders/{id}/shipments/book`: `{ courier, lines?, weightGrams?, note?, courierArea? }`, which returns the shipment. `GET /orders/{id}/shipments/book-preview?courier=`: what would be sent, and what's missing.
- `POST /shipments/book`: `{ courier, orderIds[] }` (bulk, at most 100), which returns the checks and then a batch ID. `GET /shipments/bookings/{batchId}`: each order's result.
- `POST /shipments/{id}/cancel-booking`: `{ cancelledInPanel? }`. `POST /shipments/{id}/sync`. `POST /shipments/{id}/received` (a courier return).
- `GET /couriers`: the connected couriers and their state. `PUT /couriers/{courier}` (credentials, checked), `DELETE /couriers/{courier}`, `POST /couriers/{courier}/webhook-secret`. `GET /couriers/{courier}/areas?q=`: the courier's areas, for the booking sheet's search.
- `GET /reports/cod`, `POST /courier-payouts/import` (the parsed rows, `preview: true` first), `POST /courier-payouts`.
- The order list and detail, the dashboard and the tracking page include the new fields.

### 6.2 Platform (`/v1/platform/*`)

- `GET /courier-areas?courier=&status=unmatched`, `PUT /courier-areas/{courier}/{areaId}`.

### 6.3 Webhooks and dev

- `POST /v1/webhooks/couriers/{courier}/{tenantId}` (§3.5).
- Outside production only: `POST /v1/dev/fake-courier/{consignmentId}`: `{ status, codCollected? }`, which sends the store's webhook as a courier would.

The SDK gains all of these, as before.

## 7. Background work and Cloudflare configuration

| Change | Notes |
| --- | --- |
| Cron Triggers | `["47 23 * * *", "17 7 * * *", "17 13 * * *"]`: the daily batch, and polls at 13:17 and 19:17 in Dhaka, off the hour as the daily one is. The handler tells them apart by `controller.cron` |
| `managemind-domains` (delayed work) | Gains the kinds `courier_book` and `courier_poll`. No new queue: previews already create theirs. A message that keeps failing retries 3 times, then its shipments are marked for staff (booking unsure, or not synced) and Sentry hears of it |
| `courier-areas.yml` | Weekly, Sunday 03:07 in Dhaka, plus by hand. Secrets `PATHAO_*` and `REDX_TOKEN` for the platform's accounts; without them it skips with a warning |
| Webhook host | `api.<platform domain>`, which already exists for SSLCommerz |

## 8. Security and privacy

- **No webhook is believed.** Every one is a hint to ask the courier with the store's own credentials (§3.5), as the SSLCommerz IPN asks the gateway. A token or signature, where the courier has one, is checked first in constant time. The route is rate-limited per IP, its body is size-capped and validated with zod, and an unknown store or courier gets 404.
- **No secret in a URL.** The callback URL carries only the courier and the store's ID; secrets travel in headers or signatures (ADR 0013: Workers Logs record URLs).
- **Courier credentials** are sealed (ADR 0024), checked before saving, never returned, and visible to `settings.credentials` only. Pathao's renewed tokens are resealed in the same row. The webhook secret is shown to the same roles, since staff paste it into the courier's panel.
- **Personal data to couriers:** name, phone and address only, the minimum a delivery needs, and only when staff book. The courier is the store's own processor, chosen by the store (§1, legal review). Our logs keep the consignment ID, never the parcel's contents.
- **Money:** COD is settled only from the courier's own answer, never from a webhook's body alone. A difference is flagged and never hidden. Payout imports show a preview and are audited.
- **Isolation:** the three new store tables join the isolation suite through the API and as raw SQL with the app role. Store A's webhook URL can't move store B's shipment: the shipment is found by consignment ID inside store A's tenant context only.

## 9. Performance and free-tier impact

At pilot volume (about 20 orders a day in all), with about 6 courier updates per parcel:

| Resource | Free limit | Phase 7 | Note |
| --- | --- | --- | --- |
| Worker requests | 100,000/day | About 120 webhooks a day, and the booking and sync calls | Small |
| Subrequests | 50 per invocation (Free) | One courier call per webhook; a booking batch of 10; a poll batch of 20 | Why bulk booking and polling are batched (§3.4, §3.5) |
| Hyperdrive queries | 100,000/day | About 5 per webhook (about 600 a day); the polls' selection | Small |
| Worker CPU | 10 ms (Free) | Each webhook is a fetch and one transaction, like the IPN. The CPU step adds the webhook, a booking and the booking preview | Measured on the preview |
| Queue operations | 10,000/day | One message per 10 bulk bookings and per 20 polled shipments; 3 operations each | Under 100 a day |
| Neon compute | 100 CU-hours/month | Webhooks during delivery hours, when staff are working anyway; 2 polls a day, at most about 1.3 CU-hours a month | Watched by the usage alarm |
| Neon storage | 0.5 GB | About 6 events per parcel (a few hundred bytes each), payout rows, and courier area lists (about 10,000 rows, about 2 MB) | Small |
| Actions minutes | Free while public; 2,000 a month if private again | The area sync, about 3 minutes a week | About 13 a month |
| KV | 1,000 writes/day | None | |

## 10. Tests

| Layer | Tests |
| --- | --- |
| Unit | The machine: each new move, its guards and effects, and walking several steps at once. Each adapter's status map, request building (phone, rounding, cut lengths, invoice) and response parsing, from recorded sandbox responses. Webhook checks (a good token, a bad one, none). Pathao's token renewal. Area name normalizing and matching. The reconciliation sums. The statement parser for each courier's sample |
| Integration (Postgres with RLS) | Booking: the claim, a refusal back to `pending`, an unsure booking found by invoice, and two taps making one parcel. Sync: every update in §3.5's table, an out-of-order update, a repeated webhook, delivery settling COD (equal, less, more), a partial delivery, `returning` counted by the score, "returned" then **Received** restocking, with `inventoryDrift` empty. The edit guard on a booked order. Cancel booking. The poll's selection (quiet, open, under 30 days, across stores). Payout import, matching and refusing a parcel paid twice. The report against hand-computed totals |
| Isolation | The new tables and routes: store A gets 404 for B's shipments' events and payouts; A's webhook URL can't find B's consignment ID |
| Webhook security | A forged webhook (no token, a bad signature, or a good token naming another store's parcel) changes nothing; with the courier's answer faked as "delivered", only that answer settles COD |
| Export and purge | The export has the three tables; the purge test seeds them and leaves zero rows |
| Sandbox (by hand, then a manual workflow) | `courier-sandbox.yml` books, reads and cancels one parcel on each courier's sandbox with its secrets, run by hand, not on every PR. Steadfast only books and cancels on the real test account, at Q3's say-so |
| E2E (preview, `full-preview`) | With the fake courier: connect it; book one order and a selection of three; move a parcel through picked up, in transit and delivered from the dev route, and see stock, the COD payment, the timeline and the tracking page; a returning parcel, then **Received**; import a sample statement and see the report balance. Axe on every new screen, at a phone and a desktop viewport |
| CPU step | The webhook, a booking, the booking preview, the reconciliation report |

## 11. What changes for existing stores

- **Nothing until a store connects a courier.** Manual shipments, **Mark shipped** and Phase 4's courier export files stay as they are, and a store can keep using them alongside the API.
- **No auto-booking, no automatic restock of courier returns,** and no new shopper messages until a store chooses them.
- **The demo stores** get the fake courier only on previews. In production they show sample shipments with courier events, from the weekly reset's sample orders, so sales meetings can show the phase without a courier account.

## 12. Pull requests

As in Phases 5B and 6: **one pull request with one commit per step**, its own preview database (`db-branch`), and one `full-preview` run near the end.

| # | Scope |
| --- | --- |
| 0 | This plan and PLAN.md's status |
| 1 | `shared` + `db`: the machine's new states, courier settings, credential kinds, flags, the return reason, the shipment columns, `shipment_events`, payouts, `ref` area tables, `app.courier_poll_due`, `STORE_TABLES` (migrations 0042–0043); ADR 0030 |
| 2 | `providers/couriers`: the interface and the fake courier; `core/couriers`: the parcel from an order, booking with the claim and unsure bookings, `applyCourierUpdate`, COD with an amount, the edit guard |
| 3 | `api`: the webhook route, `courier_book` and `courier_poll`, the Cron Triggers, the fake courier's dev route |
| 4 | The Steadfast adapter, against the test account |
| 5 | `admin`: Settings → Couriers; the order page's shipment card, booking sheet and timeline; the tracking page and "shipped" with the link |
| 6 | Area mapping: `courier-areas.yml` and its script, matching, Platform → Courier areas, the booking sheet's area search |
| 7 | The Pathao adapter (token renewal, signature, areas) against its sandbox |
| 8 | The RedX adapter (pickup stores, areas) against its sandbox |
| 9 | Bulk booking: the checks, the batches, the list's results |
| 10 | Courier returns and partial deliveries: Orders → Courier returns, the flags and the prefilled return; payouts, the statement import and Reports → COD reconciliation |
| 11 | The dashboard's figures, the demo stores' sample shipments, the privacy template's sentence, the provider-outage runbook's courier row |
| 12 | CI: the E2E flow, the CPU step's routes, `courier-sandbox.yml` |
| 13 | The security review against PLAN.md's checklist, with fixes |
| 14 | Phase 7 report |

Steps 4, 7 and 8 each wait for their courier's credentials. If one hasn't arrived by its turn, the step moves to the end, and the report says which adapter was checked against a real API and which only against recorded responses.

## 13. Acceptance criteria and how they're verified

| Criterion | Verification |
| --- | --- |
| 1. One-tap and bulk booking, never two parcels | Integration tests (the claim, two taps, an unsure booking); the E2E with the fake courier; one real booking per courier in its sandbox. **In the pilot:** bookings per day and refusals by reason |
| 2. Webhooks move shipments; forged ones change nothing; quiet ones are polled; delivery settles COD for the amount collected | The webhook security tests; integration tests for every update; the E2E's dev route; a real webhook from each sandbox to a preview. **In the pilot:** how long from the courier's update to ours, and how many shipments the poll had to catch |
| 3. Failed and returned parcels flow into Phase 5A's flows; partial deliveries are flagged | Integration tests with `inventoryDrift`; the E2E's returning parcel and **Received** |
| 4. Reconciliation matches the courier's statement | The report against hand-computed totals; the E2E's sample statement. **In the pilot:** one month's payouts from each pilot courier, reconciled with the store |
| 5. Every area matched or under review; an unmatched area asks staff | The sync's run against each courier's list, and the review screen's count; integration test for the booking sheet's pick |

## 14. Questions for the owner

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | **When to build.** PLAN.md starts Phase 7 when pilot clients need it, and its prerequisites are courier credentials | **Approve the design now, and build steps 1–3 with the fake courier at once.** Each real adapter follows its credentials. Bangladeshi stores book couriers from their first order, and Phase 4's export files carry them until then |
| Q2 | The acceptance criteria | **The five in the Goal**, since PLAN.md has none for this phase |
| Q3 | Testing Steadfast without a sandbox | **A real merchant account (ours or a pilot store's), with test parcels booked and cancelled before pickup,** after telling Steadfast. If Steadfast offers a sandbox on request, that instead |
| Q4 | Which couriers, in what order | **Steadfast, Pathao, RedX**, as PLAN.md says, unless the pilot stores use others. Any other courier is one more adapter later |
| Q5 | The states: `booked` and `in_transit` new, "picked up" kept as `shipped` | **Yes.** Stock leaves at pickup, as `ship` does today, and every report and the score keep working. The courier's finer statuses are events |
| Q6 | Pathao's API needs the merchant's panel login | **Store it sealed, as its API requires,** and suggest a separate Pathao user for the API where Pathao allows one |
| Q7 | A booking that got no answer, on couriers that can't be searched by our invoice | **Mark it "unsure" and ask staff to check the courier's panel before booking again.** Never retry blindly, which could make two parcels and two COD collections |
| Q8 | Auto-booking with the default courier when an order is confirmed | **Off by default,** as a store option. Most stores pack and book in one sitting |
| Q9 | Restocking when the courier says it returned a parcel | **Staff confirm with Received;** the store's `autoReceive` option is off by default. Couriers mark parcels returned before they reach the store, and stock should count what's on the shelf |
| Q10 | Couriers' fraud data (a phone's success ratio across merchants) in the score | **Not in this phase.** It is other merchants' data, which the platform terms don't yet cover (phase-6-plan Q6). The score's `phoneRisk` can show it later as a separate line |
| Q11 | Exchanges and return pickups booked through the courier | **Not in this phase.** Exchanges ship as their own orders, which can be booked like any order. Reverse pickups vary by courier and can follow pilot demand |
| Q12 | An "out for delivery" SMS to shoppers | **No.** It costs the store one more SMS per parcel, and the tracking link already shows it. It can be a store option later |
| Q13 | A new permission, `payments.reconcile`, for importing and recording courier payouts | **Yes, for owners and managers.** Payouts are the store's money records, and staff and viewers shouldn't change them. The alternative is reusing `payments.refund`, which means something else |
| Q14 | Polling twice a day by Cron (13:17 and 19:17 in Dhaka) for shipments quiet for 6 hours | **Yes.** It catches lost webhooks within the delivery day at about 1.3 CU-hours a month. Per-parcel delayed messages would wake the database at any hour |
