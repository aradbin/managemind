# Phase 9 report: Meta and messaging, stages 1 and 2

- Date: 2026-10-31
- Plan: `docs/phases/phase-9-plan.md` (approved Oct 31: all five stages, stages 1 and 2 to build now against a fake Meta, every recommendation in §14)
- Branch: `ccr-d8bda438-v5sek0`, one commit per step (§1)
- Pull request: #91, open. CI was running when this report was written; it probably needs the `narrow-preview` label, as Phases 7 and 8 did
- **The phase is not finished.** Stages 3–5 wait on Meta's approvals (§5). This report covers what is built and is extended as each later stage lands, as the plan's §12 says

## Summary

Stages 1 and 2 are built. Neither needs anything from Meta beyond what each store creates for itself. Everything that talks to Meta was tested against a fake Meta; real calls wait for the owner's test credentials (§5).

- **Orders from chats** (stage 1):
  - **Paste a chat** on the new order screen: the phone, the customer with their delivery score, links to the store's products with their variant and quantity, and order numbers the chat mentions are filled in. Names and addresses stay for staff to copy.
  - **Share to the admin** on Android: the installed admin is a share target, so a WhatsApp or Messenger message opens a new order with its text.
  - **Send by chat** on the order page: the summary, the payment link or the tracking link, in the order's language, opened in WhatsApp with the text written in, or copied for Messenger and Instagram.
  - **Share links** on product pages, and **Order on WhatsApp** in the cart, whose message Paste a chat reads back.
  - Order sources gain WhatsApp, Messenger and Instagram, in the order list's filter and the reports.
- **The Meta product feed** (stage 1): one row per variant, with the same ID the pixel sends, grouped by product; regular and sale prices, availability, pictures, brand, and colour, size and material from options. It is rebuilt 15 minutes after a catalog or stock change and served at `/feeds/meta.csv?key=…` on any of the store's hosts, in the store's language or either one. **Settings → Facebook and Instagram** shows the addresses, the last build, what was left out and why, **Rebuild now** and **Change the address**.
- **Meta Shops checkout** (stage 1): `/checkout/meta` takes a Facebook or Instagram shop's cart, with its coupon, into the store's own cart and checkout.
- **Purchases reported from the server** (stage 1): only for shoppers who accepted the cookie banner. Each purchase is sent once, with hashed contact details and the order ID as its event ID, so Meta keeps one of the browser's and the server's.
  - The store chooses when a purchase counts: **when placed**, as the pixel does, or **when confirmed**, so ads learn from real cash-on-delivery orders, not fake ones. The pixel then sends no purchase.
  - A **Delivered** event with the delivered value is optional.
  - Staff orders send nothing yet (stage 5 credits them to the ad that started the chat).
- **WhatsApp order updates** (stage 2), with the store's own Meta app and number:
  - Connecting reads the number with the token before saving anything, seals the token and app secret, and submits 16 utility templates (8 updates, Bangla and English) for Meta's review.
  - **WhatsApp first, SMS only when needed:** the SMS for the same update waits and goes only if WhatsApp can't reach the shopper or Meta confirms nothing within 10 minutes.
  - Inside the shopper's 24-hour window, while the month's 1,000 free service messages last, a free plain message replaces the template, which Meta charges for since October 2026.
  - Customers can **confirm or cancel** a COD order with buttons in WhatsApp, with the same code and checks as the SMS link.
  - A shopper who replies STOP gets no more WhatsApp messages; their updates go by SMS.
  - The message log shows WhatsApp's sent, delivered and read.

## 1. What was built

| Plan step | Commit | What |
| --- | --- | --- |
| 0 | `0ebee23`, `9bedb11` | The plan; merged with #89's "six levels" plan, which master already had, keeping the five approved stages and #89's newer findings (§2.1) |
| 1 | `6ca58ec` | `shared` + `db`: chat order sources, `orders.attribution`, `store.feeds`, `store.meta_events`, the `meta` settings, credential kinds `meta_capi` and `whatsapp` (migrations 0048–0049); ADR 0032 |
| 2 | `f8627db`, `1077cc7` | Chat shortcuts: Paste a chat, the share target, Send by chat, share links, Order on WhatsApp |
| 3 | `03fe0ea` | The product feed, its build on the delayed-work queue, the storefront route, Settings → Facebook and Instagram, product views as `product_group` |
| 4 | `32c0091` | `/checkout/meta`; consent-only attribution; `providers/meta` with the Conversions API and its fake; purchases at placement or confirmation, the Delivered event, the token's connection and the latest events in settings |
| 5–7 | `78a6d43`, `8316793` | WhatsApp: the delivery log's `whatsapp` channel, `waiting` status and receipts; `store.whatsapp_templates`, `store.whatsapp_contacts` (migrations 0050–0051); the Cloud API client, signature check and fake account; planning, sending, the 10-minute fallback, the per-store webhook, the connection and templates in settings |
| 12 | This commit | This report; PLAN.md, the plan, the README and the runbooks |

## 2. Acceptance criteria

The plan proposed one group of criteria per stage; the owner accepted them (Q2).

| Criterion | Status |
| --- | --- |
| 1. **Link**: chat orders filled in; summary and payment link sent in one tap; the feed passes Commerce Manager's checks and follows a price change within 30 minutes; the checkout URL opens our checkout with the cart and coupon; a purchase appears once in Events Manager, and none without consent | **Met in tests, not yet against Meta.** API tests place a WhatsApp order, read a pasted chat (Bangla digits, a variant link with its quantity, an unknown product, an order number) and write its summary and payment link. The feed tests build it on turning it on, rebuild once after two changes 15 minutes later into a new folder, change its key and remove it when turned off. The checkout URL's cart is unit-tested. The Conversions API tests check the payload, hashes, event ID, dedup on redelivery, nothing without consent or for staff orders, confirmation timing and the Delivered event. **Still to do with real credentials:** the demo feed in Commerce Manager's diagnostics, and one purchase in Events Manager's test tab |
| 2. **Notify**: updates by WhatsApp in the shopper's language with receipts; SMS instead, never both; a Confirm tap moves the order within a minute; a forged webhook changes nothing | **Met in tests, not yet against Meta.** `test/whatsapp.test.ts` connects with the fake account and submits the 16 templates, answers Meta's handshake, sends WhatsApp first with the SMS waiting, skips the SMS on a delivered receipt, texts a shopper not on WhatsApp at once, releases the SMS after ten minutes of silence, sends a plain message inside the window, honours STOP, confirms an order from its button once (a replayed tap is refused, in the store's language), and refuses a wrongly signed webhook. **Still to do:** one real template from a test number |
| 3–5 | Not started: they wait on Meta's approvals (§5) |

### 2.1 Security

Checked while building, against PLAN.md's checklist; the full security review comes with the phase's last stage.

- **Consent decides** what reaches Meta: attribution is saved only with it, and an order without it records `no_consent` and sends nothing. Attribution is cleared after 30 days and at anonymization, and IP and browser after 90 as before. The daily cleanup does both in an order that keeps `mm_system`'s row policy satisfied.
- **Tokens are sealed** in the credentials vault (ADR 0024), never returned. The token travels in the `Authorization` header, never a URL. The fake account and fake pixel connect only outside production, with the token `fake`.
- **A WhatsApp webhook is believed only after its signature** (HMAC-SHA-256 with the store's app secret, compared in constant time over the raw body, before parsing). A payload for another number is ignored. A Confirm or Cancel tap changes an order only through the SMS link's own code, with its checks (pending only, once, 48 hours).
- **The feed's key is the server's:** made when the feed is first turned on, never taken from a settings patch, compared in constant time, and kept out of the audit log.
- **Isolation:** the four new store tables have forced RLS and a tenant policy, are in the isolation suite, the export and the purge. The new admin route with an ID, `POST /orders/{id}/chat-message`, is in the cross-store route test.
- **Rate limits** on the WhatsApp webhook (3,600 an hour per address); the body is capped at 256 KB.
- **No new dependencies.**

### Tests

| Package | Tests |
| --- | --- |
| `shared` | 415 (Phase 8: 397): chat text and parsing, the feed CSV, Meta settings, WhatsApp template rules |
| `db` | 1,140, 121 skipped (1,095, 117 skipped): the new tables' isolation, attribution's retention |
| `core` | 333 (331): the feed key |
| `providers` | 69 (69): **none for the Meta client yet** (§5) |
| `api` | 230 (213): chat orders, the feed, the Conversions API, WhatsApp, the isolation suite's new route |
| `admin` | 26 (25) |
| `storefront` | 46 (40): the Meta Shops cart |
| `scripts` | 31 (31) |

## 3. Measurements

Built locally on the stage 2 head; the preview's CPU step is still to run.

| Measure | Result | Budget |
| --- | --- | --- |
| API Worker | 1,083 KiB gzip (Phase 8: 1,059) | 3 MiB (35%) |
| Storefront Worker | 333 KiB gzip (333) | 3 MiB (11%) |
| Admin, JavaScript before sign-in | 137 KiB (137) | 150 KiB (91%; CI warns above 85%, as since 5B) |

## 4. Free-tier impact

As planned (plan §9), for stages 1 and 2:

- **The feed** is built on the existing delayed-work queue, one message per 250 variants and language, at most once per 15 minutes per store. Its files are a few hundred KB of R2 per store; the storefront streams them without a database call.
- **Conversions API events** ride the outbox consumer: one Graph call and a few queries per reported order.
- **WhatsApp** adds one Graph call per message, one delayed `notify_fallback` message per event that sent WhatsApp, and one webhook request per receipt or shopper message, each a few queries. Connecting makes about 17 Graph calls, inside the Free plan's 50 per invocation.
- **No new Cron Triggers, queues or KV writes.**
- **Meta bills each store's own WhatsApp account;** the platform pays nothing.

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **The default WhatsApp wording,** in both languages (`packages/shared/src/notifications/whatsapp.ts`), before any store submits templates for real. The default Bangla wording was rewritten so no template starts with a variable, which Meta refuses; a test now checks every default against Meta's rules.
2. **Test credentials:** a pixel's Conversions API token for the demo store, and a WhatsApp test number with a system-user token and its app secret, to try every real call once (plan §1).
3. **For stages 3–5:** Meta business verification, then Tech Provider enrolment and app review. Each takes weeks; nothing in stage 3 can go live before them.
4. **Workers Paid** before stage 4, as already triggered by issue #46.

### Not built yet, or smaller than planned

- **Per-store chat wording.** Send by chat uses fixed Bangla and English text; per-store wording can follow ADR 0025's overrides if the pilots ask.
- **Meta's language override feed.** Instead, whole feeds are served in each language; Meta's Bangla language code is to confirm first.
- **Editing a WhatsApp template from the admin.** The store's templates are the defaults; the table already has a version for edits, which need a new name per submission.
- **Unit tests for `providers/meta`'s request shapes** (the Conversions API body, template sends, template creation). The API tests cover the flows through the fake account; the real request bodies are checked only when the owner's credentials arrive.
- **The E2E flows** for stages 1 and 2 (plan §10), and the CPU step's new routes.

### Decisions that differ from the plan

- **Conversions API sends have their own log,** `store.meta_events` (one row per order and event name), rather than a channel of the message log.
- **The Meta settings save through `PATCH /store`,** and the token through the existing `/credentials/meta_capi`, with the pixel ID and test code in its plain config.
- **A WhatsApp confirmation is recorded as the link's** (`link_confirmed`, `link_cancelled`), since the code is the same.
- **A shopper's WhatsApp opt-out lives in `store.whatsapp_contacts`,** keyed by phone, so it holds before any order.
- **The confirmation request goes by WhatsApp** when the store has the confirmation link on (`confirmation.smsLink`), as the SMS link does.

### Lessons for later phases

- **Check master before building on a plan.** Another session merged a second Phase 9 plan (#89) while this one was being approved; merging them first kept one plan.
- **Test every default template against the provider's rules.** The check found seven Bangla wordings Meta would have refused.
- **Commit a checkpoint at each part of a long step.** The build session restarted mid-step; nothing was lost because each finished piece was on disk, and the checkpoint commit made it safe to pick up again.
