# Phase 5A report: Online payments, notifications and returns

- Date: 2026-10-19 (draft: the preview's results are still to come)
- Plan: `docs/phases/phase-5a-plan.md` (approved; the owner accepted every recommendation in §14)
- Pull request: #60, all of Phase 5A with one commit per plan step and its own preview database (`db-branch`)

> **Draft.** The sections marked _to fill_ wait for one `full-preview` run of #60:
> - the sandbox payment;
> - the CPU step;
> - Lighthouse.
>
> That run needs the secrets listed in §5. Everything else here is from the code, the test suites and a local E2E run.

## Summary

Phase 5A is built. A store can take money online and keep its shoppers and staff informed. Returns and refunds now work end to end.

- **Online payment through SSLCommerz** (cards, bKash, Nagad and the rest through the gateway):
  - **Settlement uses only SSLCommerz's own validation.** It is fetched with the store's own credentials, never from the callback's fields. It then checks:
    - the store, against `value_a`;
    - the currency, BDT;
    - the exact amount in poisha;
    - that `val_id` was never seen before.
  - **Unpaid online orders** are checked at 30 minutes and cancelled at 60 (Q4).
  - **The advance delivery charge** can be required from every shopper or only from flagged phones. The rest is paid cash on delivery.
  - **Staff can send a payment link** for any order. The link carries its own 3-day token, which can view and pay the order but not cancel it.
- **Notifications:**
  - every order, payment, return and refund event goes from the outbox to the shopper by email, and by SMS when the store has its own gateway;
  - staff get web push on the installed admin;
  - each store edits its message wording in Bangla and English, and sees every message in the delivery log;
  - a store without an SMS gateway runs on email and push alone, with the SMS rows logged as `skipped` (criterion 3).
- **Returns:**
  - shoppers ask from the tracking page, with up to 3 photos and Turnstile;
  - staff approve, receive and inspect, putting each unit back in stock or writing it off;
  - then they refund, exchange, or give store credit as a single-use code for the shopper's phone (Q11).
- **Refunds** go back:
  - through SSLCommerz's refund API;
  - through its panel, with the reference recorded (Q2);
  - by bKash, Nagad, Rocket, bank or cash.

  Each refund is the returned units' exact share of what was paid (criterion 2). An order edit that leaves the order overpaid can be refunded too.
- **SMS features:**
  - each store's own gateway: sms.net.bd, BulkSMSBD, or any HTTPS gateway (Q7);
  - a code by SMS before cash on delivery: always, for flagged phones, or for first orders (Q13);
  - shopper sign-in by a code to the phone.
- **Fraud and reports:**
  - a failed delivery records what the trip cost and flags the phone (Q12);
  - the reports screen shows, for any date range:
    - the return rate by product;
    - returns by reason;
    - refunds by method;
    - failed deliveries and their cost by zone;
    - how orders were paid.

**What the owner should know:**

1. **Production is on Phase 4 until #60 merges.** Phase 5A needs three secrets and one variable in the repository before it deploys with online payment, SMS and push on (§5). Without them the deploy still works: online payment and SMS stay off and push isn't offered, as a missing Turnstile key leaves Turnstile off.
2. **A security review of the phase found two serious bugs and two smaller ones, and all four are fixed** (§2.1):
   - a shopper's name could put a link into store emails;
   - cancelling an order that used part of a store credit code minted credit;
   - a refund after an exchange ignored the credit already used;
   - an SSLCommerz timeout on a refund could have allowed a second payout.
3. **The local E2E found one more bug:** the reports page picked "today" in UTC while the API read it as a Dhaka date. From midnight to 6 am in Dhaka, the default report left out the day's orders.
4. **The acceptance criteria are met in tests** (§2). On the preview, criterion 1 waits for the SSLCommerz sandbox credentials. Criteria 2 and 3 wait for one `full-preview` run.
5. **The free Hyperdrive queries ran out again on Oct 18**, after the budget from ADR 0011 went in. Previews failed until the 00:00 UTC reset, and production's database answered again on Oct 19 at 00:20. _To fill: the day's counts by config._ One fix would stop previews from counting against production's Hyperdrive quota: connect them straight to their Neon branch, without Hyperdrive (§5).

## 1. What was built

| Plan PR | Commit | What |
| --- | --- | --- |
| 1 | `512e9f1` | `shared`: the payment, return and refund machines, the new statuses, the `returns`, `notifications`, `cod.otp` and `fraud` settings, template variables per event, refund shares |
| 2 | `6f343b8` | `db`: credentials, payments' gateway columns, orders' refunded total and flags, returns, refunds, messages, templates, push subscriptions, alert choices (migrations 0027–0028) |
| 3 | `e1c65f0` | `core`: the credentials vault, AES-256-GCM bound to the store and kind (ADR 0024) |
| 4–5 | `7a7380c`, `eba5bdb` | Notifications from the outbox, email per store with the quota guard, the delivery log, default templates in Bangla and English, the template editor's API, staff alert choices (ADR 0025) |
| 6 | `47cea2d` | Web push: RFC 8291 on Web Crypto, tested with the RFC's vectors (Q14); subscriptions; the admin's service worker and profile screen |
| 7 | `1420272` | SSLCommerz: sessions, `settleGatewayPayment`, the IPN route and the return page, the 30- and 60-minute checks, criterion 1's tests |
| 8 | `ae8dab3` | `storefront`: the payment choice, the gateway redirect and return page, "pay now" on tracking, the advance delivery charge |
| 9 | `36b76b3`, `4345bb5`, `e55d3e7` | `admin`: payment, notification, return and fraud settings; message wording and the delivery log; payment details and payment links on the order page |
| 10 | `eb542f3`, `f440cfa` | `core`, `api`: returns, inspection with stock movements, refunds (gateway, panel and manual), store credit with remainders, exchanges, criterion 2's tests (migration 0029) |
| 11 | `c7b9920`, `5ea7bc6` | `admin`: the returns list and screens, refunds on the order page, refunding an edit. `storefront`: the return form with photos and Turnstile, loaded only when it opens |
| 12 | `8137868` | SMS: the sms.net.bd, BulkSMSBD and generic HTTPS adapters; the settings screen with the balance check |
| 13 | `715fd03`, `9292992` | A code by SMS before COD; shopper sign-in by a code to the phone (migration 0030) |
| 14 | `8c3eac6` | Failed-delivery cost and counts, flagged phones, the reports screen |
| — | `5132886` | Return photos deleted 90 days after their return closes (migration 0031) |
| — | `7c01ea3`, `4186889` | Fixes from the security review (migrations 0032–0033), and the reports date fix |
| 15 | _this PR_ | CI: the returns and refunds E2E at both viewports with axe |
| 16 | _this PR_ | This report |

## 2. Acceptance criteria

| Criterion | Status |
| --- | --- |
| SSLCommerz sandbox: payments settle only after validation; forged, replayed and amount-tampered callbacks are rejected | **Met in tests.** `api`, against a fake SSLCommerz: an IPN settles only after validation. An invented `val_id`, a replayed one, another amount, another currency and another store's `value_a` are each refused and logged, with nothing settled. The payment row is locked, and a second `val_id` on a paid payment is refused and reported. **On the preview:** _to fill_; this waits for `SSLCOMMERZ_SANDBOX_STORE_ID` and `SSLCOMMERZ_SANDBOX_PASSWORD` |
| A partial return of a discounted order refunds exactly the allocated amount, and stock reflects the inspection result | **Met in tests.** `core`, with a coupon and an order promotion: returning 1 of 3 units refunds `round(line_total × 1/3)`. Returning the other 2 later refunds the rest, and the sum is `line_total`. A unit inspected as damaged leaves on hand unchanged and adds a `damaged` adjustment; a sellable one adds one. `inventoryDrift` is empty. Refunds never exceed what was paid, and the same units are never refunded twice. **Met in the local E2E** at both viewports:<br>1. A shopper's COD order is delivered with the cash.<br>2. They ask for a return of the damaged item with a photo.<br>3. Staff approve it, receive it and inspect it back into stock (on hand 5, as before the sale).<br>4. Staff refund the item and the delivery charge by bKash with its transaction ID.<br>5. The shopper gets the refund email, and the reports count the return and the refund.<br>**On the preview:** _to fill_ |
| A store without its own SMS gateway runs fully on email and in-app alerts with no errors | **Met in tests.** `api`'s notifications test covers every event for a store without a gateway: email and push are `sent`, SMS is `skipped: no_gateway`, and nothing reaches Sentry. The local E2E's store has no gateway and runs through order, delivery, return and refund. **On the preview:** _to fill_ |

### 2.1 Security review

The phase's changes were reviewed for security: settlement, tokens, refunds, credit codes, OTPs, phone sign-in, return photos, the SMS gateway URL, error details and the template editor. What it found:

| Finding | Severity | Fix |
| --- | --- | --- |
| A shopper's name went into store emails' HTML unescaped. The template text was escaped value by value, and the name is a value filled in as plain text. With a victim's email address, an order could mail them a link under the store's name | High | Store emails escape their whole text (`7c01ea3`) |
| Cancelling an order that used part of a credit code gave the code its use back, but left the remainder code active. Each cancel minted the remainder again, including an unpaid online order cancelled at 60 minutes | High | Promotions record the order and the credit each one came from (migration 0032). On a cancel, or an edit that drops the code: an unused remainder is ended in the same statement that would let a checkout use it, and the original gets its use back. A remainder already spent keeps the original used, and what the order took comes back as a new code |
| A refund after an exchange offered the returned units' full value, ignoring the credit the replacement order used | Medium | The credit used is stored on the return (migration 0033). A refund is capped at the rest, with no delivery fee, unless the replacement was cancelled |
| SSLCommerz not answering a refund (a timeout, a 5xx) marked it failed. Failed refunds stop counting, so staff could pay again by another method | Medium | It stays processing and counted. The check sends the same refund ID again and settles it from the answer. A duplicate refusal stays processing, for staff to check the panel |
| The vault's additional data covers the store and kind, but not the plaintext `config` (an SMS gateway's URL and header name) | Low | **Not changed.** Changing it needs write access to the database, and with that an attacker can already change orders and payments directly. Binding `config` would mean re-sealing a credential on every config change |

Tests cover each fix. The review found nothing else. It checked:

- order tokens: an HMAC over purpose, store, order and expiry, compared in constant time;
- OTPs: 6 digits, 5 tries, 3 sends an hour, a hashed 15-minute token;
- phone sign-in: it can't reach an email account;
- return photos: sniffed by content, tied to their hash, at most 2 MB, under the store's own prefix, served with `nosniff`;
- the SMS gateway URL: HTTPS only, and blind.

### Tests

| Package | Tests |
| --- | --- |
| `shared` | 335 (Phase 4: 317) |
| `db` | 864, 90 skipped (757, 75 skipped) |
| `core` | 199 (156) |
| `providers` | 45 (30) |
| `api` | 162 (139) |
| `admin` | 18 (18) |
| `storefront` | 27 (24) |
| `scripts` | 9 (5) |
| E2E, local | All 10 flows at a phone and a desktop viewport: the Phase 1 flows, catalog, online store, orders, and the new returns and refunds flow |
| E2E, preview | _to fill_ |

## 3. Measurements

The sizes are from a local build of this branch. The rest waits for the `full-preview` run.

| Measure | Result | Budget |
| --- | --- | --- |
| Lighthouse, tracking page with the return form | _to fill_ | LCP 2.5 s, CLS 0.1, TBT 200 ms, accessibility 95 |
| Our JavaScript on the tracking page, return form open | _to fill_ (the form is a 3.6 KB lazy chunk) | 50 KB |
| Storefront Worker | 365 KiB gzip (Phase 4: 361) | 3 MiB (12%) |
| API Worker | 918 KiB gzip (863) | 3 MiB (30%) |
| Admin, JavaScript before sign-in | 129 KiB (128) | 150 KiB (86%) |

**CPU.** _To fill:_ the IPN and settlement, a return request, and a refund.

## 4. Free-tier impact

As planned (plan §11). At pilot traffic (about 20 orders a day, 5 messages each), notifications add under 1,000 Hyperdrive queries a day. The delayed payment checks add about 100 queue operations a day.

- **Shopper email** shares Resend's 100 a day with staff email until the Brevo key exists. The quota guard keeps sign-in codes working. A store that sends a lot can add its own Resend or Brevo key.
- **Return photos** are deleted 90 days after their return closes, so R2 stays far below 10 GB.
- **SMS** is paid by each store, and each store's gateway balance shows on its settings page.

_To fill: the preview's Hyperdrive queries on Oct 18–19._

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **Secrets for the deploy** (`pnpm --filter @managemind/scripts keys` prints the keys):
   - `CREDENTIALS_KEY` as a repository secret, with a copy in a password manager (Q15);
   - `VAPID_PRIVATE_KEY` as a secret and `VAPID_PUBLIC_KEY` as a variable.
2. **The SSLCommerz sandbox**: `SSLCOMMERZ_SANDBOX_STORE_ID` and `SSLCOMMERZ_SANDBOX_PASSWORD` as secrets, for the preview's payment E2E. Please also ask SSLCommerz whether the refund API works without a fixed IP (Q2). Until then, staff refund in the panel and record the reference.
3. **An SMS gateway test account** with sms.net.bd or BulkSMSBD (Q7). The adapters follow the gateways' published APIs, and are tested against fakes.
4. **The `full-preview` label** on the repository, for the one full run that fills this report.
5. **The default message wording** in Settings → Templates (plan PR 5).

### Not built yet, or smaller than planned

- **The preview's sandbox payment script** (criterion 1 on the preview) waits for the sandbox credentials.
- **The CPU step's new routes** (IPN, return request, refund) and the tracking page's Lighthouse run come with the `full-preview` run.

### Decisions that differ from the plan

- **Store credit remainders are tied to the order that made them**, so a cancel can take them back (the security review).
- **A refund SSLCommerz never answered stays processing.** It is never marked failed, until a resend of the same refund ID tells.
- **Payment links need `orders.write` as well as `payments.read`**, so viewers can't send them.
- **Settings gate only a change.** Asking for the advance without SSLCommerz, or for the OTP without an SMS gateway, is refused when the rule changes (`needs_gateway`, `needs_sms`). A rule saved before Phase 5A doesn't block other saves.

### A preview database without Hyperdrive

Previews and production share the account's 100,000 free Hyperdrive queries a day, and that took production down on Oct 18 and again overnight. Previews could connect straight to their Neon branch with the Neon serverless driver and leave Hyperdrive to production. The cost is slower preview queries, with no connection pooling. Proposed as a follow-up for the owner to decide.

### Lessons for later phases

- **Review security by flow, not by file.** The credit and exchange bugs each needed two features to meet: credit and cancel, exchange and refund.
- **A date picked in the browser is a time zone choice.** The reports' default used UTC while the API used Dhaka. Every date sent to the API should be the store's date.
- **"No answer" is not "no".** Any payment provider call whose outcome is unknown must leave the money counted until the provider says otherwise.

## 6. Ready for Phase 5B

_To fill once the plan for the next phase exists._
