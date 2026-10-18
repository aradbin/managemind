# Phase 5A plan — Online payments, notifications and returns

- Status: Approved (Oct 18). The owner accepted every recommendation in §14. What's still needed from the owner is listed at the end of §14
- Date: 2026-10-18
- Scope: PLAN.md "Phase 5A — Online payments, notifications and returns", plus what Phase 4 moved here: OTP before a COD order and phone-code sign-in for shoppers (phase-4-plan Q3, Q11), enforcing the advance delivery charge, refunding what an order edit leaves overpaid (`refundDue`), notifications for shopper cancellations, and Turnstile on return requests

## Goal

A store can take money online and talk to its shoppers and staff:

- **Online payment.** A shopper pays with SSLCommerz (cards and mobile banking such as bKash and Nagad, through the gateway). The store can also require an online advance of the delivery charge from every shopper or from risky ones, with the rest paid as cash on delivery.
- **Notifications.**
  - The shopper hears about every step of the order by email, and by SMS when the store has its own SMS gateway.
  - Staff get an instant push on the installed admin when an order comes in.
- **Returns and refunds.** Shoppers ask for returns from the tracking page. Staff approve them, receive the goods and inspect them, then refund, exchange or give store credit. Stock and money stay exact through all of it.

Three acceptance criteria, from PLAN.md:

1. SSLCommerz sandbox: a payment settles only after validation, and tests reject forged, replayed and amount-tampered callbacks.
2. A partial return of a discounted order refunds exactly the amount allocated to the returned units, and stock reflects the inspection result.
3. A store without its own SMS gateway runs fully on email and in-app alerts, with no errors.

**Estimate: about 5 weeks** (Q1). PLAN.md says 3–4 weeks. The extra week is the work Phase 4 moved here: OTP before COD, phone sign-in, the advance charge, and refunding an edit. The order inside the phase (§12):

1. the credentials vault and the notification pipeline, which everything else uses;
2. payments;
3. returns and refunds, which need payments;
4. SMS-dependent features last, so they can wait for a gateway account without blocking the rest.

## 1. Prerequisites status

| Item | Status |
| --- | --- |
| Phase 4 | Done (report: `docs/phases/phase-4-report.md`). Its closing PR #58 merges after the Hyperdrive reset |
| SSLCommerz sandbox credentials | **Open.** Sandbox stores are self-service and free at `developer.sslcommerz.com/registration`. The owner registers one and adds its store ID and password as the repository secrets `SSLCOMMERZ_SANDBOX_STORE_ID` and `SSLCOMMERZ_SANDBOX_STORE_PASSWORD` for the preview's demo store. **Needed before PR 7** |
| SSLCommerz refunds from Workers | **Open, for the owner to ask SSLCommerz** (Q2). The live refund API accepts calls only from a server IP registered with SSLCommerz, and Workers have no fixed outgoing IP. The plan works either way (§3.5). **Not blocking** |
| The one or two SMS gateways to support first, with a test account and API credentials | **Open** (Q7). The recommendation is sms.net.bd (Alpha SMS) and BulkSMSBD, plus a generic HTTP adapter for the rest. A test account with a little credit is enough. **Needed before PR 12.** Nothing before it needs SMS |
| Pilot clients' return policies and refund methods | **Open.** There is no pilot client yet. The plan uses common Bangladeshi defaults (§3.10, Q9), which are per-store settings. **Not blocking** |
| Approved Bangla and English wording for order, return and refund messages | **Open.** The default templates are drafted in PR 5. The owner approves or corrects the wording there; afterwards it's data. **Not blocking** |
| New: the credentials key | **Open.** `CREDENTIALS_KEY` (32 random bytes) encrypts each store's gateway and SMS credentials (§3.1). PR 3 has a script that prints one. The owner adds it as a repository secret and **keeps a copy offline** (a password manager): losing it makes every stored credential unreadable (PLAN.md Phase 5B). It must never change by accident, so the deploy doesn't generate it. **Needed before PR 3** |
| New: VAPID keys for web push | **Open, small.** One key pair for the platform. PR 6 has a script that makes it. The owner adds the private key as the `VAPID_PRIVATE_KEY` repository secret. **Needed before PR 6** |
| New: shopper email capacity | **Open** (Q6). Shopper and staff email share Resend's free 100 a day while the Brevo key is missing (ADR 0022 amendment). Order updates multiply that. **Not blocking**, because a quota guard is built in (§3.8) |

## 2. Research: what is borrowed

| From | What |
| --- | --- |
| SSLCommerz v4 | A session API returns a `GatewayPageURL` for a `tran_id` we choose. The gateway POSTs an IPN to our server and redirects the shopper to success, fail or cancel pages. The order validation API confirms a `val_id` (`VALID`, `VALIDATED` when already validated, `INVALID_TRANSACTION`). The transaction query API looks up by `tran_id` or `sessionkey`. The refund API takes `bank_tran_id`, a unique `refund_trans_id` (required since Feb 2025), the amount and remarks, and refund status is queried by `refund_ref_id`. `risk_level` 1 marks a risky card. Amounts are 10–500,000 BDT. Sandbox test cards and OTPs are published |
| Shopify | Refunds are their own records against an order, with lines and a "restock" choice per line. A return is separate from the refund it leads to. An order's financial status gains `partially_refunded` and `refunded`. Notification templates are per store and per event, with a fixed variable list and a preview |
| Medusa | A return has lines and a "received" step that restocks. Claims (damaged, wrong item) and exchanges are separate kinds of the same flow. An exchange is a new order linked to the return, and the price difference is settled on the original |
| Saleor | Webhook payloads are checked against the gateway's own API before anything changes. Payment events are idempotent on the gateway's transaction ID |
| Stripe | Webhooks are at-least-once and out of order, so handlers are idempotent and re-read the truth from the API. A sweep catches what a webhook never delivered |
| Bangladeshi stores | COD dominates. A common anti-fraud step is asking for the delivery charge in advance (bKash or online), especially from numbers that refused a delivery before. SMS is the channel shoppers read; email is often missing. Bangla SMS is Unicode, 70 characters per part instead of 160, so a Bangla message costs about twice as much |
| Web Push (RFC 8030, 8291, 8292) | Push services (Google, Mozilla, Apple) are free. A message is encrypted for the subscription (ECDH P-256, HKDF, AES-128-GCM) and signed with a VAPID key, all of which Web Crypto can do. iOS delivers push only to installed web apps (16.4 and later) |
| What we simplify | One online gateway (SSLCommerz). No EMI. No partial capture. One return can cover several lines but belongs to one order. Exchanges are new orders, not edits of the old one. Store credit is a code, not a wallet (§3.13). No marketing messages: everything is transactional |

## 3. Design decisions to approve

### 3.1 Credentials vault

- **Table:** `store.provider_credentials` holds each store's gateway and SMS credentials (and its own email key, §3.8).
  - One row per `kind` (`sslcommerz`, `sms`, `email`), with `mode` (`sandbox` or `live`, for SSLCommerz) and `provider` (for example `sms_net_bd`).
  - The secret fields are encrypted together as one JSON blob with **AES-256-GCM**, using `CREDENTIALS_KEY` and a fresh 12-byte IV per write.
  - The additional data is `tenant_id:kind:version`, so a blob copied to another store or kind fails to decrypt.
  - `key_version` allows rotation: new writes use the newest key, and the daily job re-encrypts old rows.
- **Never sent back.** The admin sees the provider, the mode, a hint (the last 4 characters of the store ID or key), who changed it and when, and the last check's result.
  - Saving runs a check against the provider: SSLCommerz creates a ৳10 sandbox or live session and drops it; SMS asks for the balance. A failed check saves nothing.
- **Who:** a new permission `settings.credentials`, for owners and managers. Staff and viewers never see the settings.
- **Decryption** happens only in the code paths that call the provider, never in logs. The isolation suite covers the table like every other, and a test checks that no API response contains a decrypted field.

### 3.2 Payment records for online payment

- `payments.provider` adds `sslcommerz`.
- `payments.method` adds `online`. The card type and issuer go in `metadata`, for example `bKash-bKash` or `VISA-Dutch Bangla`.
- New columns: `gateway_tran_id` (our `tran_id`, which is the payment's ID), `gateway_val_id`, `gateway_bank_tran_id` and `risk_level`.
  - A unique index on (`tenant_id`, `provider`, `gateway_val_id`) makes a replayed validation a no-op.
- **Statuses:** a payment stays `pending → paid | failed | voided`. The new `expired` is for a session that ran out. Refunds are new rows in a `refunds` table (§3.12), never changes to the payment, as Phase 4's machine comment promised.
- **Order payment status** adds `partially_refunded` and `refunded`. It's derived from paid minus refunded against the total, so an order paid ৳1,000 with ৳300 refunded is `partially_refunded`.
- **Promotions** can target `online` as a payment method (for example "৳50 off when you pay online"). The condition and quote already take a payment method.

### 3.3 Checkout with SSLCommerz

1. **The shopper chooses.** The checkout offers what the store allows: cash on delivery, pay online, and, when the advance applies (§3.4), "pay the delivery charge online, the rest on delivery". Online needs SSLCommerz credentials in the store's current mode.
2. **`placeOrder` runs as today** (reservations, idempotency, snapshots) and inserts a `pending` `sslcommerz` payment for the online amount, plus a `pending` COD row for any rest.
   - The order is `pending` and `unpaid`, and stock is reserved, as for COD.
   - Online amounts below ৳10 (SSLCommerz's minimum) aren't offered.
3. **Then, outside the transaction, the API creates the session.** It sends the store's credentials, `tran_id` = the payment's ID, the amount in taka with two decimals, `BDT`, the customer and shipping fields from the order, `product_profile=physical-goods`, `value_a` = the tenant ID, and these URLs:
   - `success_url`, `fail_url` and `cancel_url` point at the store host's `/orders/pay/return?…`;
   - `ipn_url` points at `https://api.<platform domain>/v1/webhooks/sslcommerz/<tenant id>`.

   It returns `GatewayPageURL`, and the storefront redirects there. If the session can't be created, the order stays and the confirmation page offers "try again" (a new session for the same payment) or "pay on delivery instead" (where COD is allowed).
4. **The IPN** (§3.5) settles the payment.
5. **The return pages only display.** SSLCommerz POSTs `val_id` to the success URL.
   - The storefront hands it to the API, which runs the same validation as the IPN (§3.5) and never trusts the POSTed fields, then shows the order.
   - A shopper who comes back before the IPN therefore still sees "paid", and one who closes the browser is settled by the IPN.
6. **Pending online payments get two delayed checks.** The session's creation sends a delayed queue message (the existing `DOMAINS` delayed queue).
   - **At 30 minutes:** the API asks SSLCommerz's transaction query for the `tran_id`. `VALID` settles the payment; anything else waits.
   - **At 60 minutes:** a payment that is still pending becomes `expired`. An order paid fully online is cancelled, which releases its stock. An order with an online advance is cancelled too, because the advance was the condition for accepting it.

   The shopper gets the "payment not received, order cancelled" message. A late IPN for an expired payment is handled in §3.5.
7. **Staff orders** can send the shopper a payment link: the same session, created on demand from the order page, for any unpaid amount.

### 3.4 The advance delivery charge

- **The setting.** Phase 4 saved `cod.advance` (`never`, `always` or `flagged`). This phase enforces it on the storefront.
  - `always` makes "pay the delivery charge online" the only COD choice.
  - `flagged` does the same for flagged phones (§3.11) and leaves others on plain COD.
- **Validation:** `always` or `flagged` can only be saved when SSLCommerz is set up and checked. If the credentials later fail, the storefront falls back to plain COD and staff get a warning, so a broken gateway never stops sales.
- **The advance is the delivery fee after delivery discounts.** When that's below ৳10 (free delivery, for example), there's no advance.

### 3.5 The IPN and validation (acceptance criterion 1)

`settleGatewayPayment(tenantId, valId, source)` is one function for the IPN, the return page and the delayed check:

1. **Finds the store** from the path's tenant ID and loads its credentials. An unknown tenant, or one without SSLCommerz, answers 404 and changes nothing.
2. **Calls the validation API** with the `val_id` and the store's credentials. The callback's own fields are never trusted, so a forged IPN with an invented `val_id` gets `INVALID_TRANSACTION`.
3. **Checks the answer** before anything is written:
   - the status is `VALID` or `VALIDATED`;
   - `tran_id` is a pending or expired `sslcommerz` payment of this tenant;
   - `amount`, parsed exactly to poisha, equals the payment's amount;
   - `currency` is `BDT`;
   - `value_a` is this tenant.

   Any mismatch is refused. It's logged with the payment ID and reported to Sentry as a possible tampering attempt, and the payment stays pending. An amount-tampered session (the shopper changed the amount at the gateway) fails here.
4. **Settles** in one transaction, with the payment row locked: `pending → paid`, the `val_id` and `bank_tran_id` stored, `refreshOrder`, and the `payment.settled` event.
   - The unique index on `gateway_val_id` and the locked state make a replay (the IPN twice, the IPN and the return page, or the delayed check) a no-op that answers 200.
5. **Risky cards** (`risk_level` 1) are settled, because the money did arrive. The order gets a `payment_risk` flag shown in the admin, and staff decide before confirming (Q5).
6. **A late payment** (`VALID` for an `expired` payment, after its order was cancelled) is recorded as `paid` on the cancelled order, and staff are alerted to refund it. Stock isn't taken back automatically, because it may already have been sold to someone else.

**The IPN endpoint:**
- It's on the API host, not the store host, since the store host's `/api/*` is same-origin only.
- It's exempt from bot-protection checks (ADR 0002's note on error 1010).
- It answers 200 once processed or already processed, and 500 when the validation API couldn't be reached, so SSLCommerz retries.
- It does no Turnstile check and no session check: the validation call is the authentication.

**Refunds through SSLCommerz** (Q2):
- The refund API takes `bank_tran_id`, a unique `refund_trans_id` (our refund's ID), the amount and `refund_remarks`, and returns `refund_ref_id` and `success`, `processing` or `failed`. The daily job queries `processing` refunds until they finish.
- In live mode the call must come from an IP registered with SSLCommerz. If the store's refund comes back `INVALID_SOURCE` (or the owner learns from SSLCommerz that Workers can't be registered), the refund falls back to "refund in the SSLCommerz panel".
  - The admin shows the `bank_tran_id` and the amount to refund there.
  - Staff then record the panel's reference, and the refund is `succeeded` with method `gateway_manual`.
  - Either way the order's money is exact. Only who presses the button differs.

### 3.6 Notification pipeline

- **One consumer.** The outbox queue consumer (`jobs.ts`) gains a notifications step. It runs for `order.*`, `payment.settled`, `shipment.shipped`, `shipment.delivered`, `shipment.failed`, and the new `return.*` and `refund.*` events. A shopper's own cancellation is `order.cancelled` with `by: shopper`, which the event already carries.
- **What it sends.** For each event it works out the messages: the shopper by email or SMS, and staff by push, email or SMS (§3.9). It writes each one to `store.messages`, the delivery log, with an idempotency key of the event ID, channel and recipient. Then it sends them.
  - A queue retry finds what was already sent and skips it, so at-least-once delivery never sends twice.
- **No message, no error.** A store without SMS logs SMS messages as `skipped` (reason `no_gateway`), a shopper without email as `skipped` (`no_address`). Neither throws, which is acceptance criterion 3.
- **Retries.** Provider errors marked retryable are retried by the queue, at most 5 times, as now. Others fail the message at once with the provider's reason. The admin's message log shows status, reason and attempts, and staff can resend a failed message.
- **Secrets never go through the outbox.** Sign-in codes and OTPs are sent directly after the response, as Phase 1's staff codes are.
- **Retention:** messages are deleted after 90 days (PLAN.md's retention table) by the daily cleanup.

### 3.7 Templates

- **Defaults in code, overrides per store.** Every event has a default template per locale (bn, en) and channel, written in PR 5 for the owner to approve.
  - A store can override any of them (`store.message_templates`, keyed by event, channel and locale). "Reset" deletes the override.
- **Variables.**
  - Each event has a fixed list, for example `{store_name}`, `{order_number}`, `{customer_name}`, `{total}`, `{amount_due}`, `{tracking_url}`, `{carrier}`, `{tracking_number}`, `{refund_amount}` and `{return_number}`.
  - Saving rejects unknown variables. Values are escaped for HTML in email and are plain text in SMS.
  - Money is formatted in the message's locale, with Bangla digits in bn.
- **The editor** shows a live preview against a sample order, and for SMS the character count and the number of parts (70 Unicode or 160 GSM characters per part).
- **Email layout:** the existing inline-styled layout, with the store's name and logo. No custom HTML in this phase.

### 3.8 Email per store, and the shared quota

- **Two senders.**
  - The platform sender, as now: the store's name, reply-to the store's address.
  - The store's own key, for Resend or Brevo, stored in the vault. A store with its own key sends from its own verified domain and doesn't use the platform's quota. If its provider fails, that message falls back to the platform sender.
- **The platform quota is guarded.** The email quota counter (`email-quota.ts`) already counts every platform send. When the day passes 70%, shopper order-update emails other than "order placed" are skipped (`quota`), and the daily monitor gets an email line that alerts.
  - Sign-in codes, staff alerts and "order placed" keep the rest of the quota.
  - The quota is per platform sender: Resend's 100 a day now, Brevo's 300 once its key exists (Q6).
- **SMS is the shopper's main channel** where the store has a gateway. Email goes to shoppers only when they gave an address (`checkout.email` is optional by default).

### 3.9 Staff alerts and web push

- **Each staff member chooses,** per event and per channel (push, email, SMS), in their profile.
  - Events: new order, online payment received, order cancelled by the shopper, return requested, late or risky payment.
  - Default: push on for all of them, email and SMS off. An owner can turn email on for new orders.
- **Web push:**
  - The admin's service worker moves to VitePWA's `injectManifest` so it can handle `push` and `notificationclick` (which opens the order).
  - Subscriptions are stored per staff user and device (`store.push_subscriptions`). A `404` or `410` from the push service deletes the subscription.
  - **The sender** is our own small implementation of RFC 8291 and 8292 in `packages/providers/push`: ECDH P-256, HKDF and AES-128-GCM through Web Crypto, plus a VAPID JWT signed with ES256. It's tested against the RFC's test vectors (Q14).
  - Payloads hold only the order number, the total and a link, never customer details.
- **The admin explains iOS:** push works there only after "Add to Home Screen" (iOS 16.4+). The settings page tests a push on the current device.

### 3.10 Return policy

`returns` settings per store, with defaults (Q9):

- **Window:** shoppers can ask within 7 days of delivery; staff can create returns any time.
- **Shopper requests:** on.
- **Excluded categories:** none, for example innerwear or food; excluded products show "not returnable".
- **Who pays the return delivery:** the shopper for "changed mind" and "wrong size"; the store for "damaged", "wrong item" and "not as described".
- **Refund methods offered:** original online payment (when there is one), bKash, Nagad, bank transfer, cash, store credit.
- **Delivery fee refund:** only when the whole order comes back for a reason the store pays for (Q10).

### 3.11 Failed deliveries and flagged phones

Phase 4 built `fail` and `return` on shipments, with restocking. This phase adds:

- **The lost cost.** A shipment that comes back records `return_cost` (default: the order's delivery fee; staff can change it). Reports total it by delivery zone.
- **The count.** The customer gets `failed_deliveries` +1.
- **Flagging.** A phone is **flagged** when its customer has at least `fraud.flagAfterFailed` failed deliveries in this store (default 1, Q12), or when staff flag the customer by hand.
  - The blocklist still refuses orders outright. A flag only asks for the advance or the OTP.
  - The admin shows the flag on the customer and the order. Staff can clear it, which resets the count.

### 3.12 Returns

- **Tables:**
  - `store.returns`: a number per store (`R1001`), the order, the status, the requester (staff or shopper), the reason, the notes, and who pays the return delivery.
  - `store.return_lines`: the order line, the quantity, the line's reason, and after inspection the quantities `restocked` and `written_off`.
  - `store.return_photos`: up to 3 per return, in R2.
- **State machine** (`returnMachine` in `shared`):
  - `requested → approved | rejected`;
  - `approved → in_transit → received`, or `approved → received` for a walk-in;
  - `received → inspected → resolved`.

  The resolution is `refunded`, `exchanged`, `store_credit` or `rejected_after_inspection`. Every move goes into the order's history under a new `return` machine.
- **The order's `return_status`** is derived, like delivery status: `none`, `requested`, `partially_returned` or `returned`. A line can only be returned up to what was delivered minus what earlier returns already cover. `core` checks the sum with the order locked, as stock moves are checked.
- **Shopper requests** start from the tracking page. It's signed in with the existing track token (number + phone) or a shopper account.
  - The shopper picks lines, quantities and reasons, and can add photos.
  - Turnstile and the `return:phone` rate limit apply.
  - Photos go through the Worker as in ADR 0016: 2 MB, sniffed for JPEG, PNG or WebP, resized and stripped of EXIF in the browser.
  - They're stored under `returns/` and served only to staff through the admin API, never cached publicly. They're deleted 90 days after the return is resolved.
- **Inspection restocks by condition** (criterion 2). Each unit received is `sellable` or `damaged`.
  - Sellable units get a `return` movement (on hand +1), with reason `return_inspected`.
  - Damaged units get the same `return` movement and then an `adjustment` −1 with reason `damaged`. The write-off is then visible in the stock history and the reports, and `inventoryDrift` stays zero.
  - The movements' idempotency keys are `return:<id>:<line>:…`, so a double click restocks once.

### 3.13 Refunds and store credit

- **Table:** `store.refunds` holds the order, the return (when it comes from one), the payment refunded (for gateway refunds), the method, the amount, the status, the reference, the gateway's `refund_ref_id`, and who did it. Its lines are `store.refund_lines`.
  - Methods: `gateway`, `gateway_manual`, `bkash`, `nagad`, `rocket`, `bank`, `cash` and `store_credit`.
  - Statuses: `pending`, `processing`, `succeeded` and `failed`.
- **The amount is computed, then confirmed.**
  - Each returned unit refunds its share of the line's `line_total`, which already carries its allocated discounts and VAT.
  - Shares are cumulative, so returns add up exactly: returning `k` more units of a line of `n` refunds `round(line_total × (r + k) / n) − round(line_total × r / n)`, where `r` units were already refunded. Returning all units refunds exactly `line_total`.
  - The delivery fee is added only under the policy (§3.10).
  - Staff can lower the amount with a reason, never raise it above what was paid and not yet refunded.
  - **Acceptance criterion 2** is the integration test of exactly this: an order discounted by a coupon and an order-level promotion, and a partial return of one unit.
- **Where the money comes from.** A refund can't exceed `paid_total − refunded`.
  - A COD order that was never delivered has nothing to refund. Its return is a cancellation of what wasn't shipped, which Phase 4 handles.
  - A gateway refund can't exceed its payment.
  - Edits that leave an order overpaid (`refundDue`) show a "refund" action using the same flow, without a return.
- **Store credit is a single-use code** (Q11).
  - It's an amount-off promotion code limited to the customer's phone. It applies up to the cart's subtotal, through the promotion engine, at checkout or on a manual order.
  - An unused remainder is issued as a new code when the order is placed, and the shopper is told the new code by SMS or email.
  - No wallet or balance ledger is needed.
- **Exchanges** are a new order with source `exchange`, linked to the return.
  - Staff pick the replacement lines. Stock is reserved at once, and prices are today's.
  - The difference is settled. When the replacement costs more, the rest is COD on the new order, or a payment link. When it costs less, the difference is refunded through the flow above.
  - The replacement's delivery fee follows the policy: free when the store pays the return, the zone's fee otherwise.

### 3.14 OTP before COD, and phone sign-in

Both need the store's SMS gateway. A store without one never shows either.

- **OTP before COD.** The setting `cod.otp` is `off` (default), `always`, `flagged` or `first_order` (Q13).
  - When it applies, the checkout's "place order" first sends a 6-digit code by SMS: Turnstile, then the `otp-send:phone` limit (3 an hour), valid 10 minutes, 5 tries.
  - The verified code gives a one-time token that `placeOrder` requires. Codes are stored hashed in a Durable Object, never in the database.
- **Phone-code sign-in for shopper accounts.** This is Better Auth's phone OTP on the shopper instance (ADR 0020), with the same rate limits as email codes, offered when the store has SMS.
  - Accounts stay unique per store.
  - An email account and a phone account for the same person stay separate in this phase.

### 3.15 Reports

A **Reports** screen (`reports.read`) with a date range, computed in SQL when asked, with no stored aggregates:

- return rate by product and by reason;
- refund totals by method;
- failed-delivery rate and cost by delivery zone;
- online versus COD share of orders and of revenue.

### 3.16 Who can do what

| Action | Permission | Roles |
| --- | --- | --- |
| Create and move returns, inspect, exchange | `orders.write` | owner, manager, staff |
| Refund (any method), issue store credit | `payments.refund` (declared in Phase 1) | owner, manager |
| Send a payment link, view payment details | `payments.read` | owner, manager, staff |
| Gateway, SMS and email credentials | `settings.credentials` (new) | owner, manager |
| Templates, return policy, OTP and advance settings | `settings.write` | owner, manager |
| Own alert preferences and push devices | (any signed-in staff) | all |
| Message log | `orders.read` | all except viewer |
| Reports | `reports.read` | owner, manager, viewer |

### 3.17 New dependencies

**None.** SSLCommerz and the SMS gateways are plain HTTPS APIs. Web push uses Web Crypto (§3.9). AES-GCM is Web Crypto. Better Auth already includes phone OTP. The admin's service worker uses `workbox` modules VitePWA already brings in.

## 4. Data model

| Change | Notes |
| --- | --- |
| `store.provider_credentials` (new) | `tenant_id`, `kind`, `provider`, `mode`, `ciphertext`, `iv`, `key_version`, `hint`, `checked_at`, `check_error`, `updated_by`. Unique (`tenant_id`, `kind`) |
| `store.payments` | `provider` adds `sslcommerz`; `method` adds `online`; `status` adds `expired`; new `gateway_val_id`, `gateway_bank_tran_id`, `risk_level`. Unique (`tenant_id`, `provider`, `gateway_val_id`) |
| `store.orders` | `payment_status` adds `partially_refunded` and `refunded`; `return_status` adds `requested`, `partially_returned` and `returned`; new `refunded_total` and `flags` (text array: `payment_risk`, `late_payment`, `flagged_phone`) |
| `store.order_history` | `machine` adds `return` and `refund` |
| `store.shipments` | new `return_cost` |
| `store.customers` | new `failed_deliveries` |
| `store.returns`, `store.return_lines`, `store.return_photos` (new) | §3.12; the counter table gains the `return` sequence |
| `store.refunds`, `store.refund_lines` (new) | §3.13; refund lines hold the order line, the quantity and the amount |
| `store.messages` (new) | `event_id`, `channel` (`email`, `sms`, `push`), `recipient_type` (`shopper`, `staff`), `recipient` (masked in lists), `template`, `status` (`queued`, `sent`, `failed`, `skipped`), `reason`, `attempts`, `provider_message_id`, `sent_at`. Unique (`tenant_id`, `idempotency_key`). Deleted after 90 days |
| `store.message_templates` (new) | `event`, `channel`, `locale`, `subject`, `body`, `updated_by`. Unique per store and key |
| `store.push_subscriptions` (new) | `user_id`, `endpoint`, `p256dh`, `auth`, `user_agent`, `last_used_at`. Unique `endpoint` |
| `store.staff_alert_preferences` (new) | `user_id`, `event`, `channel`, `enabled` |
| Settings | `returns` (§3.10); `cod.otp` (§3.14); `fraud.flagAfterFailed` (§3.11); `notifications` (which shopper events go by SMS, §3.6 and Q8) |
| `ADJUSTMENT_REASONS` and movement reasons | `return_inspected`; `damaged` is already there |

Every new table has `tenant_id`, RLS and the guarded policy (ADR 0002), and joins the isolation suite automatically.

## 5. Services (`packages/core`)

| Module | Does |
| --- | --- |
| `credentials` | Encrypt, decrypt, save with a provider check, the hint, rotation |
| `payments/gateway` | Create a session, `settleGatewayPayment`, the delayed check, expiring, payment links |
| `payments/refunds` | Compute refundable amounts, create a refund (gateway, panel or manual), poll `processing` refunds, store credit codes |
| `returns` | Request (staff or shopper), the machine's moves, inspection with movements, exchange orders |
| `notifications` | Events to messages, template rendering and validation, the delivery log, resending, staff preferences |
| `fraud` | The flag rule, failed-delivery counts, OTP requirement at checkout |
| `reports` | §3.15's queries |

Adapters in `packages/providers`:
- `payments/sslcommerz`: session, validation, transaction query, refund and refund query, with a fake for tests;
- `sms/sms-net-bd`, `sms/bulksmsbd` and `sms/http` (generic), behind an `SmsProvider` interface like `EmailProvider`, plus a `capture` adapter that saves to `platform.dev_messages` for previews;
- `push`: §3.9.

## 6. API

### 6.1 Storefront (`/v1/store/*`)

- `POST /checkout/orders`: takes `payment: { kind: 'cod' | 'online' | 'cod_with_advance' }` and an optional `otpToken`. For online kinds the response adds `payUrl`.
- `POST /checkout/otp` and `POST /checkout/otp/verify`: §3.14.
- `POST /payments/{id}/retry`: a new session for a pending payment of an order the caller can see (view or track token).
- `POST /payments/return`: the return page hands over `val_id` (§3.3); it answers with the order's view.
- `GET /orders/returnable` and `POST /returns`: return requests with the track token. Photos go to `PUT /returns/photos/{sha256}.{ext}`, then are attached by hash.
- Shopper phone sign-in joins the existing account routes.

### 6.2 Webhooks (API host)

- `POST /v1/webhooks/sslcommerz/{tenantId}`: §3.5.

### 6.3 Admin (`/v1/admin/*`)

- `credentials`: list, save with a check, delete.
- `payments/{id}/link`; `orders/{id}/refunds` (preview and create); `refunds/{id}` (record a panel reference).
- `returns`: list with filters, create, detail, each move, inspection, exchange; `returns/{id}/photos/{photo}`.
- `messages` (the log, with resend); `templates` (list, preview, save, reset).
- `me/alerts` (preferences); `me/push-subscriptions` (add, remove, test).
- `reports/*`.
- Settings sections: `returns`, `notifications`, and `cod.otp` and `fraud` in the existing ones.

The SDK gains all of these, as in earlier phases.

## 7. Admin screens

- **Settings → Payments:** SSLCommerz credentials, sandbox or live, the check's result, and online payment and advance options. The advance options are greyed out until the check passes.
- **Settings → Notifications:** shopper events per channel, the SMS gateway and its balance, the store's own email key, templates with the preview and part counter, and the message log.
- **Settings → Returns:** the policy (§3.10).
- **Order detail:**
  - payments with gateway details and flags (`payment_risk`, `late_payment`);
  - "send payment link";
  - "return" and "refund" actions;
  - the return and refund history in the timeline;
  - the flagged-phone badge.
- **Returns:** a list with filters (status, reason, date) and a return detail screen.
  - The detail has a step bar (approve, receive, inspect per unit as sellable or damaged, resolve), photos, and the refund preview with each line's share.
  - "Exchange" opens manual order entry with the return's lines.
- **Profile → Alerts:** per-event channels and this device's push, with a test button.
- **Reports** (§3.15).
- **Dashboard:** returns waiting for action, refunds processing, and today's online payments.

Mobile first, as before, with the sign-in bundle untouched: every new screen loads on demand.

## 8. Storefront pages and scripts

- **Checkout:** the payment choice (COD, online, advance), the OTP step when required, and the redirect to the gateway.
- **`/orders/pay/return`:** a shell page that hands the `val_id` to the API and shows paid, failed or cancelled, with "try again" and "pay on delivery instead" where allowed.
- **Tracking page:** payment status, "pay now" for a pending online payment, "request a return" for delivered orders within the window, and the return's status.
- **Return request form:** lines, quantities, reasons and photos. The browser resizes photos like the admin does. Turnstile is on submit.
- **Account:** sign in with phone when the store has SMS; the orders list shows returns.

Every page stays within the JavaScript budget: the gateway redirect is a link, and the photo resize code loads only on the return form.

## 9. Performance and CPU

- **Shopper requests:**
  - The gateway session is an HTTP call outside the transaction: I/O, not CPU.
  - The IPN and the return page each run one validation call and one short transaction, about the size of the admin's order calls (16–24 ms at p50 in Phase 4). That's over the Free plan's 10 ms, like every database request.
  - **A stopped IPN loses nothing:** SSLCommerz retries it, the return page validates on its own, and the 30-minute check catches anything left. That makes payments the flow most tolerant of the CPU limit.
- **Queue work:**
  - The notification consumer renders small templates and makes one provider call per message, so it's cheap.
  - Web push encryption is one ECDH and one AES-GCM per device, about 1–2 ms.
- **The CPU step** (only on `full-preview` runs now) adds the IPN, the return page, the return request and a refund preview.
- **Lighthouse** adds the tracking page with a return form and the payment return page.

## 10. Tests

| Layer | Tests |
| --- | --- |
| Unit | Amounts in taka strings to poisha and back, exactly; cumulative refund shares add up to `line_total`; the delivery-fee refund rule; the return machine's moves and refusals; derived `return_status` and payment status with refunds; template validation and rendering (escaping, Bangla digits, SMS parts); the flag rule; AES-GCM round trip and wrong-tenant failure; RFC 8291 test vectors and the VAPID JWT |
| Integration (Postgres with RLS, fake SSLCommerz) | **Criterion 1:** a forged IPN (`INVALID_TRANSACTION`), a replayed IPN and an IPN plus return page (one settlement), an amount-tampered session (validation amount ≠ payment), a wrong currency, another tenant's `tran_id` or `value_a`, a validation API outage (500, nothing changes), a risky card (paid and flagged), a late payment after expiry (paid on a cancelled order and flagged), the 30- and 60-minute checks. **Criterion 2:** a partial return of a discounted order refunds exactly its share; inspection writes the right movements and `inventoryDrift` is zero; refunds never exceed what was paid; exchanges reserve stock and settle the difference; store credit codes and their remainders. The vault's encryption and the isolation of every new table |
| Concurrency | Two IPNs for the same `val_id` at once: one settlement. Two refunds for the same return at once: one succeeds, the other gets `conflict` |
| Notifications | Each event produces the right messages for the store's settings. **Criterion 3:** a store without SMS produces `skipped` SMS rows and no errors. The quota guard skips the right emails at 70%. A retried queue message doesn't resend |
| Isolation | The new endpoints join the suite: store A can't see, refund, return or settle anything of store B, including through the webhook path with B's tenant ID and A's `val_id` |
| E2E (preview, `full-preview`) | A shopper on demo-grocery pays online in the SSLCommerz sandbox with the published test card and sees "paid". This needs the sandbox secrets; without them the test is skipped and says so. A shopper on demo-fashion asks for a return of one unit with a photo; staff approve, receive, inspect one unit as damaged, refund by bKash with a reference; the shopper sees the refund on the tracking page. Staff turn on push on the device and get a test push (Chromium supports it in Playwright). Axe on every new page and screen |

## 11. Free-tier impact

| Resource | Free limit | Phase 5A | Note |
| --- | --- | --- | --- |
| Worker requests | 100,000/day | The IPN, the return page and return requests | Small next to cart and checkout |
| Hyperdrive queries | 100,000/day | About 5 per notification (log write, template, update), about 10 per settlement, about 20 per return step | **Watched after Oct 18.** At pilot traffic (about 20 orders a day, 5 messages each) it's under 1,000 a day. Previews' full runs stay opt-in |
| Queue operations | 10,000/day | The delayed payment checks (2 per online order) and the notification step, which reuses the existing event messages | About 100 a day for the pilot |
| Email | Resend 100/day (Brevo 300/day with its key) | Order updates for shoppers who gave an email; staff alerts if they turn email on | §3.8's guard keeps sign-in codes working. Q6 |
| SMS | Paid by each store | Order placed and shipped by default, OTPs | Shown per store in the message log; the gateway's balance on the settings page |
| Web push | Free | Staff alerts | |
| R2 | 10 GB, 1M writes/month | Return photos, 3 × about 300 KB per return, deleted 90 days after resolution | Negligible |
| Durable Objects | 100,000 requests/day | OTP codes and the new rate limits | |

## 12. Pull requests

| # | Scope |
| --- | --- |
| 0 | This plan and the PLAN.md status |
| 1 | `shared`: payment and return machines, the new statuses, settings schemas (`returns`, `notifications`, `cod.otp`, `fraud`), template variables per event, refund share rules |
| 2 | `db`: credentials, payments' gateway columns, orders' refunded total and flags, returns, refunds, messages, templates, push subscriptions, alert preferences |
| 3 | `core` + `api`: the credentials vault with checks; `CREDENTIALS_KEY` in deploy and previews. **Needs the key** |
| 4 | `core` + `api`: the notification pipeline and delivery log, the email per store and quota guard; staff alert preferences |
| 5 | Default templates in bn and en for every event; the template editor's API. **The owner approves the wording here** |
| 6 | Web push: the sender, subscriptions, the admin's service worker and profile screen. **Needs `VAPID_PRIVATE_KEY`** |
| 7 | `providers` + `core`: the SSLCommerz adapter, sessions, `settleGatewayPayment`, the IPN route, delayed checks; the criterion 1 tests. **Needs the sandbox credentials** |
| 8 | `storefront`: the payment choice, the gateway redirect and return page, "pay now" on tracking; the advance delivery charge |
| 9 | `admin`: payments settings, payment details and links, flags; dashboard additions |
| 10 | `core` + `api`: returns, inspection with movements, refunds (gateway, panel and manual), store credit, exchanges; the criterion 2 tests |
| 11 | `storefront` + `admin`: the return request form with photos and Turnstile; the returns screens; refunds on the order page; refunding an edit |
| 12 | SMS: adapters (sms.net.bd, BulkSMSBD, generic HTTP), the settings screen and balance check. **Needs the gateway test account** |
| 13 | OTP before COD and phone sign-in for shoppers |
| 14 | Failed-delivery cost and counts, flagged phones, the reports screen |
| 15 | CI: E2E flows, the CPU step's new routes, Lighthouse pages, production checks |
| 16 | Phase 5A report |

As before, these can be one pull request with a commit per step and its own preview database (`db-branch`). Given Oct 18, separate PRs that each get one `full-preview` run before merging use fewer queries than one PR pushed many times.

## 13. Acceptance criteria and how they're verified

| Criterion | Verification |
| --- | --- |
| SSLCommerz sandbox: payments settle only after validation; forged, replayed and amount-tampered callbacks are rejected | The integration tests (§10) against a fake SSLCommerz on every PR. On the preview, the E2E pays through the real sandbox with the test card and checks the payment's `val_id` and `bank_tran_id`. A script then replays that IPN, posts one with an invented `val_id`, and one for another amount: one settlement, two refusals, all logged |
| A partial return of a discounted order refunds exactly the allocated amount, and stock reflects the inspection result | The integration test with a coupon and an order promotion: returning 1 of 3 units refunds `round(line_total × 1/3)`, returning the other 2 later refunds the rest, and the sum is `line_total`. One unit inspected as damaged leaves on hand unchanged with a `damaged` adjustment; a sellable one adds one. `inventoryDrift` is zero. The preview E2E repeats it through the screens |
| A store without its own SMS gateway runs fully on email and in-app alerts with no errors | The E2E runs demo-fashion, which has no gateway, through order, payment, shipment, return and refund. The message log shows email and push `sent` and SMS `skipped: no_gateway`; Sentry gets nothing. The notifications test checks the same for every event |

## 14. Questions for the owner

| # | Question | Answer (Oct 18: the owner accepted every recommendation) |
| --- | --- | --- |
| Q1 | Estimate and order | **About 5 weeks, in §12's order:** the pipeline, then payments, then returns, then SMS features, which can wait for the gateway account |
| Q2 | SSLCommerz refunds from Workers | **Build the refund API and fall back to "refund in the SSLCommerz panel, record the reference"** when the live API refuses our IP. Please ask SSLCommerz (merchant support) whether the refund API can be used without a fixed IP, or with Cloudflare's published IP ranges |
| Q3 | Online payment at checkout | **Full online payment and an online advance of the delivery charge; no EMI.** Online orders below ৳10 aren't possible at the gateway |
| Q4 | Unpaid online orders | **Checked at 30 minutes, cancelled at 60 minutes**, releasing the stock (PLAN.md) |
| Q5 | Risky cards (`risk_level` 1) | **Settle the payment, flag the order, and let staff decide before confirming.** Refusing would leave money with no order |
| Q6 | Shopper email capacity | **Retry Brevo** (300 a day from `managemind.store`): its account verification failed on the owner's phone. Brevo support can verify by email instead. Until then the quota guard (§3.8) keeps sign-in codes safe. Stores that send a lot can add their own Resend or Brevo key |
| Q7 | SMS gateways first | **sms.net.bd (Alpha SMS) and BulkSMSBD, plus a generic HTTP adapter.** Please confirm, or name the ones pilot clients use, and open a test account with one of them. BulkSMSBD must have its IP whitelist off, since Workers have no fixed IP |
| Q8 | Default shopper messages | **SMS: order placed (with the tracking link) and shipped (with the courier and tracking number); email: every step.** Each SMS costs the store money, so the other steps are opt-in |
| Q9 | Default return policy | **7 days after delivery; shopper requests on; the shopper pays return delivery for changed mind and wrong size, the store for damaged, wrong item and not as described; refunds by the original online payment, bKash, Nagad, bank, cash or store credit** |
| Q10 | Refunding the delivery fee | **Only when the whole order comes back for a reason the store pays for.** Staff can always lower a refund with a reason |
| Q11 | Store credit | **A single-use code limited to the customer's phone, with any remainder issued as a new code**, instead of a wallet |
| Q12 | When a phone is flagged | **After 1 failed delivery in the same store,** or when staff flag it. Flags ask for the advance or the OTP; only the blocklist refuses orders |
| Q13 | OTP before COD | **Off by default; a store can choose always, flagged phones only, or first orders only** |
| Q14 | Web push | **Our own small RFC 8291 implementation** with the RFC's test vectors, instead of a library, since it's about 150 lines on Web Crypto and the API bundle is at 863 KiB of 3 MiB |
| Q15 | The credentials key | **The owner adds `CREDENTIALS_KEY` (from PR 3's script) as a repository secret and stores a copy in a password manager** before any store saves credentials. A deploy without it leaves online payment and SMS off, as a missing Turnstile key leaves Turnstile off |

**Still needed from the owner:**

- the answers above, especially Q2, Q6 and Q7;
- the SSLCommerz sandbox store (before PR 7);
- the SMS gateway test account (before PR 12);
- `VAPID_PRIVATE_KEY` (before PR 6), and the offline copy of `CREDENTIALS_KEY` (before PR 3);
- the wording of the default messages (in PR 5).
