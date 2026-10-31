# Phase 9 plan: Meta and messaging

- Status: **Approved (Oct 31).** The owner approved all five stages and every recommendation in §14, and asked to build stages 1 and 2 now against a fake Meta (Q1). Stages 3–5 wait for Meta's approvals. The owner asked for the highest integration Meta allows, built step by step from minimal to robust. This plan splits the phase into five stages. Each stage ships on its own and leaves the stores better off, so the build can pause after any of them
- Date: 2026-10-27, approved 2026-10-31. It merges the "six levels" research of #89 (Oct 29) into the five stages: §2.1 maps the levels to stages and carries #89's newer findings on Meta's prices and rules
- Still needed from the owner: Meta business verification and the platform's Meta app (stage 3), a test pixel's Conversions API token and a WhatsApp test number with a system-user token (to switch stages 1 and 2 from the fake Meta to the real one), the owner-approved WhatsApp template wording (stage 2)
- Scope: PLAN.md "Phase 9 — Meta and messaging", widened at the owner's request. PLAN.md asks for four things: chat-to-order shortcuts, a Meta product feed, server-side purchase events, and WhatsApp order notifications. This plan adds what full integration needs on top: a one-click connection through our own Meta app, Messenger, Instagram and WhatsApp conversations inside the admin, orders taken straight from a WhatsApp cart, attribution for click-to-message ads, and self-service order status in chat.
- Builds on:
  - Phase 3's pixel, consent banner and chat buttons (phase-3-plan §3.10);
  - Phase 4's manual orders and the pixel's `Purchase` event, whose event ID is the order ID (phase-4-plan §3.12, §3.16);
  - Phase 5A's notifications, delivery log, credentials vault and payment links (ADR 0024, ADR 0025);
  - Phase 6's incomplete orders, phone score and confirmation queue (phase-6-plan §3.2–§3.7).

## Goal

Most of the pilot's orders already start on Facebook and in Messenger (phase-0-report). Today staff copy the customer's phone and address from a chat into the manual order screen by hand. They paste a payment link back by hand. Meta only learns about a purchase if the browser pixel loaded. And every order update costs the store an SMS. This phase connects the store to Meta in both directions, one stage at a time:

| Stage | Name | What the store gets | Direction | What Meta must approve first |
| --- | --- | --- | --- | --- |
| 1 | **Link** | Chat-to-order shortcuts without any Meta API. A product feed for Facebook and Instagram shops and ads. A checkout URL for Meta Shops. Server-side purchase events | Mostly out (catalog and events to Meta); the checkout URL brings shoppers in | Nothing: the store pastes its own pixel token |
| 2 | **Notify** | Order updates on WhatsApp, cheaper than SMS, with SMS as the fallback. Shoppers confirm or cancel COD orders with a WhatsApp button. Delivery and read receipts | Out, plus button replies and receipts coming in | Nothing from us. Each store needs a WhatsApp Cloud API number and its own system-user token |
| 3 | **Connect** | One-click connection of WhatsApp, the Facebook Page, Instagram, the pixel and the catalog. Catalog price and stock changes reach Meta within minutes | Both: setup, catalog sync and one shared webhook | Business verification, Tech Provider, app review |
| 4 | **Converse** | A Chats screen: WhatsApp, Messenger and Instagram conversations with the customer's score and orders beside each one. Replies, product cards and payment links from the admin. A WhatsApp cart becomes an order in one tap | In: messages, carts, ad referrals. Out: replies | Stage 3's app review, including messaging permissions |
| 5 | **Automate** | Purchases from click-to-WhatsApp and click-to-Messenger ads reported back to Meta. Order status answered automatically in WhatsApp. Opt-in reminders for incomplete orders. Optionally, comment-to-DM replies on posts | Both | Stage 3's app review, plus the engagement permissions for comment replies |

**What stays out at every stage**, and why:

- **Checkout inside Facebook or Instagram.** Meta moved every Shop to checkout on the seller's own website during 2025. Our part is the checkout URL (§3.1.5).
- **Buying or managing ads from our admin** (the Marketing API). It's a product of its own. Stores keep using Ads Manager, which gets better data from stages 1 and 5.
- **WhatsApp Pay.** It isn't offered in Bangladesh, as far as public sources show. Payment links do the job.
- **Group chats and broadcast lists.** They're not part of the business APIs.

**Proposed acceptance criteria** (PLAN.md gives none; Q2), one group per stage:

1. **Link.**
   - Staff start an order from a pasted chat or a phone shared from WhatsApp on Android. The phone, the products and the source are filled in.
   - Staff send an order summary with its payment link to WhatsApp in one tap.
   - The store's feed passes Commerce Manager's checks with no errors on the demo catalog, and reflects a price change within 30 minutes.
   - A Meta Shops checkout URL opens our checkout with the right cart and coupon.
   - A website purchase appears once in Events Manager, as "deduplicated" browser and server events. Without consent, no server event is sent.
2. **Notify.**
   - A store with WhatsApp connected sends order updates by WhatsApp in the shopper's language. The message log shows sent, delivered and read.
   - A shopper without WhatsApp gets the SMS instead, and never both.
   - A **Confirm** button reply moves the order out of the confirmation queue within a minute.
   - A forged webhook changes nothing.
3. **Connect.**
   - An owner connects WhatsApp, a Page, Instagram, a pixel and a catalog through Meta's own popups, without copying a token.
   - A price change reaches the Meta catalog within 15 minutes.
   - Disconnecting in Meta removes the store's tokens within a minute.
4. **Converse.**
   - A message to the store on WhatsApp, Messenger or Instagram shows in Chats within 10 seconds, with the matching customer, their score and their orders.
   - Staff reply inside the 24-hour window, and send a template after it on WhatsApp.
   - A cart the shopper sends from the WhatsApp catalog becomes a prefilled order in one tap.
5. **Automate.**
   - An order from a click-to-WhatsApp ad is reported to Meta as a purchase with that click's ID.
   - A shopper who sends "status", or taps it, gets their latest order's status by WhatsApp, and only for their own phone.

**Estimate.** About 7 weeks of building, against PLAN.md's 4, because stages 3–5 go beyond PLAN.md's list. Stages 1 and 2 fit the original 4 weeks. Meta's reviews run in parallel, and stage 3 can't finish until they pass:

| Stage | Build | Waits on |
| --- | --- | --- |
| 1 | About 1½ weeks | A test pixel and catalog (we have the Phase 3 test pixel) |
| 2 | About 1½ weeks | A WhatsApp Cloud API test number (Meta gives one free with any app) |
| 3 | About 1 week | Business verification, Tech Provider, app review: **weeks, so start now** |
| 4 | About 2 weeks | Stage 3's review, with the messaging permissions |
| 5 | About 1 week | Stage 4 |

## 1. Prerequisites status

PLAN.md: "Never start a phase until its prerequisites have been provided." Phase 9's list is a verified Meta Business account, a Meta app with WhatsApp Cloud API access, Tech Provider approval, the pilot clients' WhatsApp Business numbers, and approved message templates. **None has been provided yet.** The stages exist partly so the build doesn't wait for all of them.

| Item | Needed for | Status |
| --- | --- | --- |
| A test Meta Pixel (dataset) with a Conversions API token, and a test catalog in Commerce Manager | Stage 1 | **Partly there.** Phase 3 has a test pixel ID. The owner generates a Conversions API token for it in Events Manager (Settings → Conversions API → Generate access token) and adds it as a GitHub secret for the sandbox workflow. The catalog is created in Commerce Manager in a minute |
| A Meta developer app with the WhatsApp product, its free test number, and a system user with a permanent token | Stage 2 | **Open, not slow.** Any Meta account can make one. The test number sends to up to 5 verified recipients, enough for development and the E2E's recorded responses |
| The pilot store's WhatsApp number | Stage 2 in production | **Open.** Stage 2 can use the store's own number on the Cloud API. Moving a number from the WhatsApp Business app to the Cloud API in stage 2 takes it off the phone app, unless it is onboarded with coexistence, which needs stage 3's Embedded Signup (Q6). For the pilot, **stage 2 can start on a second number** and move to coexistence in stage 3 |
| **Meta business verification** for our company | Stage 3 | **Open, slow (weeks).** Needs the trade license and company documents (PLAN.md "Start these now") |
| **Tech Provider** enrolment, and **app review** for our app | Stage 3 | **Open, slow (weeks), after verification.** The permissions to request are in §3.3.1. App review needs a screencast of each permission in use, so it's requested once stage 3's screens work on a preview with the test assets |
| Privacy policy URL, terms URL, and a data deletion callback on our main domain | Stage 3 (app review) | **Built in stage 3** (§3.3.5). The privacy policy needs the legal review's sentence on Meta data (below) |
| Approved WhatsApp templates | Stage 2 | **We draft them; Meta approves them.** The owner approves the Bangla and English wording first, as with Phase 5A's messages (§3.2.3). Meta reviews each store's copy when it's submitted, usually within minutes to a day |
| Hosts to allow in the cloud environment's network list | Stages 1–5 | **For the owner:** `graph.facebook.com` and `www.facebook.com` (Graph API and the Embedded Signup popup). In production, Workers reach any host |
| Legal review | Stages 1, 4, 5 | **Joins Phase 5B's.** The store privacy template gains three things: purchase events go to Meta when the shopper consents; chats with the store are kept in the admin for a set time; WhatsApp messages are sent through Meta. The platform's data processing agreement names Meta as a processor the store chooses |
| Workers Paid, Neon paid | Stage 4 | **Workers Paid is already triggered** (issue #46's CPU stops, ADR 0013) and comes before stage 4 goes live. **Neon paid is the owner's decision at stage 4:** it keeps the database awake whenever shoppers write, including at night, which likely passes Neon's free compute (§9). Stages 1–3 fit the Free plans |
| Carried from Phase 5A | All | **`CREDENTIALS_KEY` in production is blocking for production use.** Every Meta token goes in the same vault |

## 2. Research: what is borrowed

| From | What |
| --- | --- |
| Shopify's "Facebook & Instagram" channel | The connection is one Meta popup (Facebook Login for Business) that picks a Business, a Page, an Instagram account, a pixel and a catalog together. The catalog is synced through the API, not a feed URL. Pixel and Conversions API share event IDs. Since 2025 Shops send shoppers to the store's own checkout through a **checkout URL**. Our stage 3 copies the connection, stage 1 the checkout URL |
| Shopify Inbox, and Meta's own WhatsApp Business app | The conversation sits beside the customer's orders, with one tap to send a product or a cart link. Staff are assigned to conversations. The app's away and greeting messages stay where they are, with coexistence (§3.3.2) |
| WooCommerce "Facebook for WooCommerce" | A product's ID in the feed is the same ID the pixel sends as `content_ids`, or dynamic ads can't match views to products. Variants are separate items sharing an `item_group_id`. We use the variant ID as `id` and the product ID as `item_group_id`. The pixel already sends variant IDs for add to cart and purchase, and product view becomes a `product_group` event (§3.1.4) |
| Medusa, Saleor, Vendure | None ships a Meta integration in core. Each has notification providers behind one interface, which ours already is (ADR 0025): WhatsApp becomes a fourth channel, not a new system |
| Meta's own model | **A webhook is signed** (`X-Hub-Signature-256`, HMAC-SHA-256 of the raw body with the app secret), unlike most couriers'. We still treat a webhook as data from Meta about Meta's objects, never about our orders. A button reply is checked against a signed token we put in the button (§3.2.5). WhatsApp has a **24-hour customer service window**: free-form messages only within 24 hours of the shopper's last message, templates outside it. Messenger and Instagram have the same window and no templates |
| What we simplify | One WhatsApp number, one Page and one Instagram account per store. Text, images, locations, products and carts in chats, not voice notes (shown as a link to listen). No chatbot builder: the only automatic reply is order status (§3.5.2). No ad management |

### 2.1 Merged from #89's research

#89 (merged Oct 29) researched the same question as six levels. The levels map onto this plan's stages; nothing in either is dropped:

| #89 level | This plan |
| --- | --- |
| 0 — Chat shortcuts | Stage 1 (§3.1.1–§3.1.3), with #89's share buttons and "Order on WhatsApp" from the cart (§3.1.3) |
| 1 — Catalog and Conversions API | Stage 1 (§3.1.4–§3.1.6), with #89's feed key and delivered event |
| 2 — Connect with Facebook | Stage 3 |
| 3 — Messenger and Instagram inbox | Stage 4 |
| 4 — WhatsApp Business Platform | Stage 2 (notifications with the store's own token) and stage 3 (Embedded Signup, coexistence) |
| 5 — Conversational commerce | Stages 4 and 5 |

**#89's findings that change this plan:**

- **WhatsApp prices from October 1, 2026** (Meta's rate card, as vendors summarize it): in Bangladesh about **$0.0037 for a utility or authentication template** and **$0.0732 for a marketing template**. **Service replies** inside the 24-hour window are free for the first **1,000 a month per number**, then charged at the utility rate. **A utility template sent inside an open window is now charged too.** So §3.2.2 sends a free-form message instead of a template when the window is open and the month's free service messages remain. A chat from a click-to-WhatsApp ad opens a free window of 7 days.
- **Messenger's message tags are gone** except `HUMAN_AGENT` (a person's reply up to 7 days later): `POST_PURCHASE_UPDATE` and the others stopped on April 27, 2026. Messenger can't carry order updates; WhatsApp and SMS do (Q11).
- **Embedded Signup v2 and v3 retired on October 15, 2026.** Stage 3 uses v4 or later. Coexistence needs the WhatsApp Business app 2.24.17 or later, syncs 6 months of chats, and allows 20 messages a second.
- **With coexistence, the API can't use the app's catalog and cart tools.** Stage 4's "WhatsApp cart to an order" needs a number that is **not** on coexistence. Every other stage 4 feature works with it.
- **Tech Provider limits:** until Access Verification, the app onboards 10 businesses per rolling 7 days; after it, 200.
- **Graph API v25.0** (February 2026) is pinned in one constant, moved on yearly.
- **Workers Paid is already triggered** by the production CPU stops of Oct 26 (issue #46, ADR 0013). Stage 4 should not go live without it (§9).
- **Whether Facebook and Instagram Shops are offered in Bangladesh is unconfirmed.** Catalogs and catalog ads don't depend on Shops, so the feed is useful either way; the checkout URL (§3.1.5) matters only where Shops are.

#89's sources are listed at the end, beside this plan's.

## 3. Design decisions to approve

### 3.1 Stage 1 — Link (no Meta app needed)

#### 3.1.1 Chat sources

`ORDER_SOURCES` and `MANUAL_ORDER_SOURCES` gain `whatsapp`, `messenger` and `instagram`. `facebook` stays, for orders from post comments and the Page. Sales and profit reports already group by source (Phase 8), so chat sales show by channel from the first day.

#### 3.1.2 New order from chat, without any API

- **The order list's "New order" becomes a menu:** "From WhatsApp", "From Messenger", "From Instagram", "Other". Each opens the manual order screen with its source chosen.
- **A paste box** at the top of the screen takes a chat's text. It finds and fills, without guessing the rest:
  - a Bangladeshi phone (`01…`, `+880…`, Bangla digits, through `normalizePhone`), which looks up the customer as typing a phone already does (score, blocklist, past address);
  - links to the store's own products (`/p/<slug>`, `?variant=`), as lines;
  - an order number, which opens "Exchange or reorder" for that order.

  Anything else stays in the box, for staff to copy into the address or the note.
- **A share target.** The admin is already an installable app (vite-plugin-pwa). Its manifest gains a `share_target`. On Android, staff long-press a message in WhatsApp or Messenger, tap **Share**, pick the store, and the same screen opens with that text in the paste box.
- **Prefill by link.** The screen also reads `?source=&phone=&name=&text=` as it reads `?incomplete=` today (phase-6-plan §3.2). Stage 4 uses this.

#### 3.1.3 Sending back by chat

The order page already copies a payment link and opens it in `wa.me`. It becomes **Send by chat**, with a choice of message:

- the order summary: lines, delivery fee, total, the COD amount, and the tracking link;
- the payment link, as now;
- the tracking link alone.

Each is written in the order's language, in fixed Bangla and English wording (`shared/channels/chat.ts`); per-store wording can follow if the pilots ask, through ADR 0025's overrides. WhatsApp opens with the text filled in (`wa.me/<phone>?text=`). For Messenger and Instagram the text is copied, since `m.me` links can't carry text, and the Page's inbox opens.

Two shopper-side shortcuts, following the store's existing `chat` settings (from #89's Level 0):

- **Share buttons** on the product page: WhatsApp, Messenger, and copy link, using the Open Graph tags Phase 3 already writes.
- **"Order on WhatsApp"** on the cart page, when the store has a WhatsApp number: the cart's lines, with their links, and the total, as a message to the store's number. Staff then paste it into the new order screen (§3.1.2), which reads those links back as lines.

#### 3.1.4 Product feed

- **One feed per store**, CSV in Meta's format, at `https://<store host>/feeds/meta.csv`, served from R2:
  - one row per active variant of every published product;
  - `id` is the variant ID, `item_group_id` the product's;
  - also `title`, `description` (plain text, cut to Meta's limit), `availability` (from stock: `in stock`, `out of stock`, or `preorder` where back-orders are allowed), `condition`, `price` and `sale_price` with `BDT`, `link` to the variant's page, `image_link` and `additional_image_link` (the media's public URLs), `brand` (the built-in attribute, else the store's name), `size`, `color` and `material` from options with those meanings, and `quantity_to_sell_on_facebook`;
  - the store's main language in the main feed. A second **language feed** at `/feeds/meta-<lang>.csv` carries the other language's titles and descriptions, as Meta's localized catalogs take it (the language code to confirm against Meta's list).
- **Built on change, not on fetch.** A product, variant, price, promotion or stock event marks the feed dirty. A delayed message on `managemind-domains` (`feed_build`, 15 minutes after the first change, so a busy hour builds once) rebuilds it.
  - The build writes chunks of 250 variants as separate R2 objects. The GET streams the header and the chunks in order, so no invocation renders the whole catalog.
  - On the Free plan's 10 ms of CPU a chunk is the unit. The CPU step measures it (§10).
  - The feed URL carries an unguessable key, `/feeds/meta.csv?key=…`, which the store can change in settings (from #89). The feed only holds what the storefront shows, but the key stops others from scraping a whole catalog in one request. It returns `304` to Meta's conditional fetches.
  - Only published, priced variants with a picture. Sold-out ones stay as `out of stock`, so ads stop and start by themselves. The settings page lists items left out and why.
- **Settings → Sales channels → Meta** shows the feed URL with the steps to add it in Commerce Manager as a scheduled feed (hourly), and when it was last built.
- **The pixel's product view** sends `content_type: product_group` with the product ID, which Meta matches to the variants' `item_group_id`. Add to cart and purchase already send variant IDs.

#### 3.1.5 The checkout URL for Meta Shops

Meta sends a shopper who taps "Checkout" in a Shop to the URL the store registers, with the cart in the query: `products=<id>:<qty>,<id>:<qty>`, an optional `coupon=`, and `cart_origin=facebook|instagram|meta_shops`.

- **`https://<store host>/checkout/meta`** reads those fields, adds the variants to a new cart through the cart API (prices and stock from the server as always), and applies the coupon if it's valid. It then sends the shopper to checkout, or to the cart with a notice when something is sold out or unknown.
- The order's attribution (§3.1.6) records `cart_origin`.

#### 3.1.6 Attribution and the Conversions API

**Captured at checkout, with consent only.**

- The storefront already asks for consent before the pixel loads. When consent is given, a small script keeps:
  - `fbclid` from the landing URL, as Meta's `_fbc` cookie (`fb.1.<time>.<fbclid>`), when the pixel hasn't set one;
  - the `_fbp` cookie;
  - the first landing's `utm_*` fields.
- Checkout sends them with the order. **`store.orders` gains `attribution`** (jsonb: `fbp`, `fbc`, `utm`, `cart_origin`, `consent`) and the shopper's IP and user agent at checkout. Both are kept 30 days, then cleared by the daily cleanup.

**The server event.**

- The store pastes its Conversions API token from Events Manager. It's sealed in the vault as kind `meta_capi`, with the pixel ID beside it. On save it's checked by sending a test event with the store's test code.
- On `order.placed` for a website order with consent, the outbox sends one `Purchase` to `graph.facebook.com/<version>/<pixel>/events` with:
  - `event_id` = the order ID, the same as the browser's, so Meta keeps one;
  - `event_time`, `action_source: website`, `event_source_url`;
  - `value` and `currency: BDT`, and `contents` with variant IDs and quantities;
  - `user_data`: the phone in E.164 digits and the email, SHA-256 hashed after normalizing; `external_id`, the customer ID, hashed; `country: bd`, hashed; the IP and user agent unhashed, as Meta requires; `fbp` and `fbc`.
- **No consent, no server event** (Q4). A shopper who declined cookies never had the browser event either, so nothing is lost to de-duplication.
- **One log.** Each send has a row in `store.meta_events`, unique per order and event name, so a redelivered outbox event never sends twice, and the settings page shows each event's outcome.
- **When to report a purchase (Q5).** `meta.purchaseAt` is `placed` (the default, as the pixel does now) or `confirmed`.
  - `confirmed` stops the browser's `Purchase` and sends the server's when staff or the shopper confirm a COD order. Meta's ads then learn from real orders, not fake ones, which matters for COD stores.
  - A cancelled order isn't retracted: Meta has no retraction. That is the reason for `confirmed`.
  - Meta accepts events up to 7 days old, so a confirmation days later still counts.
- **Delivered, optionally** (from #89). A store can also send a custom `Delivered` event when a shipment is delivered, with the delivered value, so ads can optimize for sales that were paid for. The order's `attribution` is kept until then, or 30 days. Off by default.
- **Staff orders send nothing in stage 1.** The shopper never saw an ad on our site. Stage 5 reports chat orders, with the ad that started the chat.
- **A refused token stops.** A 4xx from Meta (a revoked token) marks the connection failed in settings and alerts the owner, instead of retrying.
- **Test mode.** The store can set Meta's test event code, so events show in Events Manager's test tab, and turn it off again.

### 3.2 Stage 2 — Notify (WhatsApp Cloud API with the store's own token)

#### 3.2.1 Connecting

Until stage 3 a store connects WhatsApp with values from its own Meta app. We onboard clients ourselves (PLAN.md), so staff or our team do this once per store, with a checklist in the onboarding runbook:

| Kept | How |
| --- | --- |
| Phone number ID, WhatsApp Business account (WABA) ID | Plain, in the credentials row |
| System-user token (permanent, with `whatsapp_business_messaging` and `whatsapp_business_management`), app secret | Sealed (ADR 0024), kind `whatsapp` |
| Webhook verify token | Generated by us, sealed, shown once with the callback URL |

- **Checked on save:** the token reads the number. The settings page shows the number's display name, its quality rating and its messaging limit (how many shoppers a day it may start conversations with). A token that can't read it is never stored.
- **The webhook:** `https://api.<platform domain>/v1/webhooks/whatsapp/<store id>`, pasted into the store's app with the verify token. It's per store in this stage because each store's app has its own secret. Stage 3 replaces it with one platform URL.

#### 3.2.2 WhatsApp as a channel

- **`CHANNELS` gains `whatsapp`.** `notificationSettings` gains `whatsapp: ShopperEvent[]`, by default `order_placed`, `order_confirmed`, `order_shipped`, `order_delivered`, `order_cancelled`, `payment_received` and `refund_issued`.
- **The planner adds a WhatsApp message** for a shopper event when:
  - the store has WhatsApp connected;
  - the event is in the store's list;
  - that event's template is approved in the shopper's language;
  - the shopper hasn't opted out.
- **The delivery log stays the idempotency** (ADR 0025): one row per event, channel and recipient. Skips get the existing reasons, plus `no_template` and `opted_out`.
- **SMS becomes a fallback, not a twin** (Q7). `notifications.whatsappFirst` is on by default when WhatsApp is connected. For each event in both lists, the SMS row is planned as `waiting`, not `queued`:
  - if WhatsApp fails at once (for example "not a WhatsApp user"), or its status webhook later says `failed`, the waiting SMS is queued and sent;
  - if WhatsApp reports `sent`, the SMS is skipped with `sent_by_whatsapp`;
  - a waiting SMS still undecided after 10 minutes is sent. A delayed `notify_fallback` message checks it.

  So the shopper hears once, and the store pays for an SMS only when WhatsApp can't deliver.
- **Inside an open window, free-form is cheaper.** Since October 2026 a utility template sent inside the shopper's 24-hour window is charged, while the first 1,000 service messages a month per number are free (§2.1). When the shopper wrote within 24 hours and the store's count for the month is under 1,000, the update goes as a plain message with the same text. The count is kept per store and month.
- **Staff alerts don't use WhatsApp.** Staff have push and email (ADR 0025), and a store's number messaging its own staff would cost a template each time.

#### 3.2.3 Templates

WhatsApp only allows approved templates outside the 24-hour window, which covers every order update. Templates differ from SMS and email ones in four ways:

- **They're submitted to Meta per store.** On connect, the store's WABA gets our default set through the API (`/<waba>/message_templates`): one per event and language (`bn`, `en`), category `utility`, with numbered variables mapped from the event's variable list (`{{1}}` = customer name, and so on), and a URL button to the order's tracking page where the event has one.
- **Their status is tracked** in `store.whatsapp_templates`: `pending`, `approved`, `rejected` with Meta's reason, `paused`. It's read on connect and from the `message_template_status_update` webhook.
- **Editing a template resubmits it.** The template editor shows WhatsApp's wording with its status. A change goes to Meta again and is used once approved. Meanwhile the previous approved version keeps sending.
- **Our default wording is the owner's to approve** before the first submission, in both languages.

Meta can re-categorize a template it judges marketing. The editor warns against promotional words in utility templates, and the status shows any change.

#### 3.2.4 Receipts and opt-out

- **The webhook** checks `X-Hub-Signature-256` against the store's app secret in constant time, and answers Meta's GET verification with the verify token. It then handles:
  - `statuses`: `sent`, `delivered`, `read`, `failed`, with the error, matched to `store.messages` by Meta's message ID. The message log shows them as ticks, and a failure triggers the fallback (§3.2.2);
  - `messages` of type `button` or `interactive` (§3.2.5);
  - text messages: in this stage only "STOP", "বন্ধ" and the like, which record an opt-out on the customer, and the time of the shopper's last message, which tells us the 24-hour window is open (for stage 4, and for Meta's free replies inside the window);
  - `message_template_status_update` (§3.2.3).
- **Anything else is acknowledged and dropped** in this stage. A webhook gets `200` once handled or ignored, and `5xx` only when our database couldn't be reached, so Meta retries.

#### 3.2.5 COD confirmation by WhatsApp

Phase 6 confirms COD orders by staff calls, and optionally by an SMS link (phase-6-plan §3.7). WhatsApp does it in the chat:

- **A `confirm_request` template** with two quick-reply buttons, **Confirm order** and **Cancel**. It's sent when the confirmation queue would send the SMS link, by WhatsApp first (§3.2.2).
- **Each button's payload** is the order's signed `confirm` token, the same one the SMS link carries. The webhook checks the token and applies the same command as the link does: the shopper confirms, or cancels with the reason "cancelled by shopper". The confirmation queue records the outcome with the channel `whatsapp`.
- **A payload that fails its check changes nothing.** A replayed button on an order that's already confirmed or cancelled is answered with the order's state, never a second change.
- **The shopper gets a reply** in the window that the button opened (free inside it): "Thanks, your order #1042 is confirmed" or "Your order is cancelled".

### 3.3 Stage 3 — Connect (our own Meta app, as a Tech Provider)

#### 3.3.1 The platform's Meta app

- **One app**, owned by our verified business, enrolled as a **Tech Provider**. It's configured with WhatsApp Embedded Signup and Facebook Login for Business.
- **Permissions requested in app review:**
  - `whatsapp_business_management`, `whatsapp_business_messaging`: WhatsApp;
  - `business_management`: read the store's pixels and catalogs;
  - `catalog_management`: create a catalog and send item updates;
  - `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`: Messenger;
  - `instagram_basic`, `instagram_manage_messages`: Instagram DMs through the Page;
  - `pages_manage_engagement`, only if stage 5's comment replies are approved (Q12).
- **Secrets:** `META_APP_ID` (a variable), `META_APP_SECRET` and `META_CONFIG_IDS` (the Login and Embedded Signup configurations), as GitHub secrets copied to Worker secrets, like the others.
- **Stage 2's paste-in connection stays** for previews, for local development with the test number, and for a store that prefers its own app.

#### 3.3.2 Connecting in one click

**Settings → Sales channels → Meta** gets two buttons, each opening Meta's own popup through Meta's JavaScript SDK, loaded only on that page:

1. **Connect WhatsApp (Embedded Signup).**
   - The owner signs in to Facebook, picks or creates the business and the WABA, and enters the number.
   - If the number is on the **WhatsApp Business app**, Embedded Signup offers **coexistence**: the number keeps working in the app on staff's phone, and the API sends and receives beside it. Chats from the last six months sync, as Meta describes it. Coexistence is a recent Meta feature and its availability varies by country, so this is **to confirm for Bangladesh** before the pilot is promised it (Q6).
   - The popup returns a code. The API exchanges it server-side for a business token and reads the WABA and phone number IDs. It subscribes our app to the WABA's webhooks, registers the number if it's new, and submits the templates (§3.2.3). Stage 2's credentials, if any, are replaced.
   - **Billing:** as a Tech Provider's client, the store adds its own payment method to its WABA in Meta's WhatsApp Manager, and Meta bills the store directly. The settings page links there and shows whether a payment method is set (Q8).
2. **Connect Facebook and Instagram (Facebook Login for Business).**
   - The owner picks a Page, its linked Instagram account, a pixel and a catalog in Meta's dialog, or creates a catalog.
   - The API stores a long-lived Page token for Messenger and Instagram, subscribes the Page to our app's webhooks, and stores a system-user token for the pixel and the catalog.
   - The pixel ID goes into `storefront.tracking` and the Conversions API token is no longer pasted.

The page then shows each asset with its state (connected, token expiring, needs a payment method, template rejected) and **Disconnect**.

#### 3.3.3 One webhook for every store

- **`GET` and `POST /v1/webhooks/meta`**, on the API host.
  - The GET answers Meta's verification with the platform's verify token.
  - The POST checks the signature with `META_APP_SECRET` before reading anything. It then routes each entry by its object: WABA ID for WhatsApp, Page ID for Messenger, Instagram account ID for Instagram.
- **The routing map is in KV:** `meta:<asset id> → <store id>`, written on connect and removed on disconnect, as the domain map is (ADR 0006). An event for an unknown asset is acknowledged and dropped with no database query, so other apps' noise costs nothing.
- **The work runs after the response.** The route answers `200` at once and queues the entry for the store (`meta_event` on `managemind-outbox`'s consumer, or `waitUntil` for small ones; measured in §10). Meta expects a fast answer and retries slow ones.
- Stage 2's per-store URL keeps working for stores still on their own app.

#### 3.3.4 Catalog sync through the API

- With a connected catalog, the feed (§3.1.4) is registered as the catalog's scheduled data source automatically, daily, as the full truth.
- **Changes go faster through Meta's batch API** (`/<catalog>/items_batch`). The same dirty marks that rebuild the feed collect the changed variants. At most every 5 minutes, a `catalog_push` message sends their price, sale price, availability and quantity, up to 5,000 items a request (to confirm).
- The settings page shows the last push and Meta's per-item errors (a missing image, a policy rejection), linked to the product.

#### 3.3.5 Tokens, deauthorization and data deletion

- **Every token is sealed** (ADR 0024). The daily batch checks each store's tokens with Meta's `debug_token` and flags any that are expiring or revoked. The owner gets an email, and the settings page shows **Reconnect**.
- **Deauthorize callback** (`/v1/webhooks/meta/deauthorize`, signed request checked with the app secret): Meta calls it when the business removes our app. The store's Meta tokens are deleted, the KV routes removed, and the owner told.
- **Data deletion callback** (`/v1/webhooks/meta/data-deletion`), which app review requires: for a Facebook user who asks Meta to delete their data, we delete their conversations and Meta IDs (§3.4) in the store that holds them. We return a confirmation code and a status URL on the main domain.

### 3.4 Stage 4 — Converse (conversations in the admin)

#### 3.4.1 What comes in

The stage 3 webhook gains the conversation events:

| Channel | Events | What we keep |
| --- | --- | --- |
| WhatsApp | `messages`: text, image, document, location, contacts, `order` (a cart from the catalog), `referral` (the ad the shopper clicked); `statuses`; `smb_message_echoes` (what staff send from the WhatsApp Business app under coexistence; to confirm) | The shopper's WhatsApp ID, which **is their phone number**, and their profile name |
| Messenger | `messages`, `messaging_postbacks`, `messaging_referrals`, `message_echoes` (what staff send from Meta Business Suite) | The Page-scoped ID and the name from Meta's profile API. **No phone:** Messenger never gives one |
| Instagram | `messages`, `messaging_referral`, echoes | The Instagram-scoped ID and the username. No phone |

#### 3.4.2 Conversations and customers

- **One conversation per shopper and channel** in `store.conversations`, with its last messages in `store.conversation_messages` (§4).
- **A WhatsApp conversation matches a customer by phone** at once: the same normalized phone that orders use.
- **A Messenger or Instagram one matches** when staff link it: typing the phone in the conversation's side panel, or placing an order from it. The link is kept, so the next message from that person shows their orders.
- **The side panel shows what Phases 4–8 know:**
  - the customer's name, phone and addresses;
  - the Phase 6 **success score** and any blocklist entry, so a risky buyer is seen before an order is taken;
  - open and recent orders with their states and tracking;
  - incomplete checkouts.

#### 3.4.3 The Chats screen

Mobile first, loaded on demand, on Phase 5C's patterns (ADR 0029):

- **The list:**
  - each conversation's channel, name, last message, unread count, whether the 24-hour window is open (and for how long), the assigned staff member, and the ad it came from;
  - filters for unread, mine, unassigned and done.
- **The thread:**
  - messages with images (fetched from Meta through our API and cached in R2 for the conversation's lifetime; §8), locations as a map link, and carts as their lines;
  - staff replies show who sent them, including those sent from the phone app or Business Suite (the echoes).
- **The composer:**
  - text and images;
  - **a product card** picked from the catalog (WhatsApp single- and multi-product messages, which need the catalog linked to the WABA; on Messenger and Instagram a card with the image, price and link);
  - **order summary**, **payment link** and **tracking link** (§3.1.3), now sent directly;
  - **quick replies**: saved answers per store, in both languages.
- **Outside the 24-hour window:**
  - on WhatsApp, the composer offers the store's approved templates only;
  - on Messenger and Instagram, it explains that the shopper must write first. Meta's human-agent tag, which allows replies up to 7 days, is used if the app is approved for it (Q11).
- **Assign** to a staff member, and **Done**. A new message reopens a done conversation.
- **Staff hear** by push (Phase 5A) on a new conversation, or a message in one assigned to them; this is a new staff alert, `chat_message`, on by default. While Chats is open it refreshes every 10 seconds, and only fetches what changed.

#### 3.4.4 Orders from conversations

- **New order from this chat** opens the manual order screen through §3.1.2's prefill:
  - the source set to the channel;
  - the customer matched, or the phone (WhatsApp) and name filled in;
  - the conversation linked: `store.orders` gains `conversation_id`.
- **A WhatsApp cart becomes an order in one tap.**
  - When a shopper sends a cart from the store's WhatsApp catalog, the message lists `product_retailer_id`s. They are our variant IDs, because the feed uses them (§3.1.4).
  - The thread shows the cart with **Create order**, which opens the manual order screen with those lines. Prices come from our server, never from the message.
- **The order page** links back to its conversation, and the conversation shows the orders placed from it.

#### 3.4.5 Who can do what

| Action | Permission | Roles |
| --- | --- | --- |
| Read conversations | **New: `chats.read`** | Owner, manager, staff |
| Reply, assign, mark done, send cards and links | **New: `chats.write`** | Owner, manager, staff |
| Connect Meta, templates' submission, quick replies' defaults | `settings.credentials`, `settings.write` | Owner, manager |
| Feed and Conversions API settings | `settings.write` | Owner, manager |

Viewers don't see chats (Q10): conversations are personal data with no reporting use.

### 3.5 Stage 5 — Automate and attribute

#### 3.5.1 Purchases from click-to-message ads

Most Bangladeshi f-commerce ads are click-to-Messenger and click-to-WhatsApp. Meta can only optimize them if it hears which chats bought.

- **The referral is kept on the conversation:** WhatsApp's `ctwa_clid` and the ad's ID and headline from the first message after an ad click. Messenger's referral comes with the Page-scoped ID.
- **An order linked to such a conversation** (§3.4.4) sends `Purchase` to the store's dataset through the Conversions API, with:
  - `action_source: business_messaging`;
  - `messaging_channel` set to `whatsapp` or `messenger`;
  - `ctwa_clid`, or the Page ID and Page-scoped ID, in `user_data`;
  - the hashed phone;
  - the value.

  It's sent when `meta.purchaseAt` says (§3.1.6). The field placement and how long Meta accepts a `ctwa_clid` are **to confirm in Meta's sandbox**, since public descriptions differ.
- **Other manual orders, optionally** (Q9): a phone order as `action_source: phone_call`, a walk-in sale as `physical_store`, matched by the hashed phone. Meta can then count sales its ads caused that ended in a call.
- **The dashboard** shows orders and sales by channel and by ad (from the referral's headline), for the store's own view.

#### 3.5.2 Order status in chat

- On WhatsApp, a shopper who sends "status", "order", "অর্ডার" or an order number, or taps **Track my order** in the store's WhatsApp menu, gets their latest orders' states and tracking links automatically.
- **Only for orders placed with that WhatsApp number's phone.** The phone is the shopper's identity, the same one tracking by phone uses (phase-4-plan). An order number from another phone gets "We couldn't find that order for this number".
- On Messenger and Instagram there's no phone, so the reply asks them to use the tracking page.
- The reply is free inside the window the shopper's message opened. The conversation shows it as sent by the store's assistant, and staff can turn it off.

#### 3.5.3 Opt-in reminders

Marketing templates are charged on every send and need the shopper's opt-in (Meta's policy):

- **Checkout gains an unticked box,** "Send me offers and reminders on WhatsApp", per store. It's kept on the customer with when and where it was given.
- **Incomplete checkouts** (Phase 6) can get one WhatsApp reminder an hour later, for opted-in shoppers only, with a link that restores the cart. It's a store option, off by default.
- **Back-in-stock alerts** (PLAN.md's later features) will use the same channel when built.

#### 3.5.4 Comment replies (optional, Q12)

- A shopper commenting "price?" on a Page post or Instagram post gets a private message from the store with the product's card and link. The product is chosen by the post's tagged product or a keyword list the store sets.
- Meta allows one private reply per comment, within 7 days.
- It needs `pages_manage_engagement` and the comment webhooks, so it's included only if app review approves them.

## 4. Data model

| Change | Stage | Notes |
| --- | --- | --- |
| `ORDER_SOURCES`, `MANUAL_ORDER_SOURCES` | 1 | Gain `whatsapp`, `messenger`, `instagram` |
| `store.orders` | 1, 4 | `attribution` (jsonb, cleared after 30 days), `conversation_id` (stage 4). The shopper's IP and browser are the existing `ip` and `user_agent`, kept 90 days |
| `store.feeds` (new) | 1 | `tenant_id`, `kind` (`meta`, `meta_<lang>`), `dirty_since`, `built_at`, `chunks`, `rows`, `etag`, `last_error`. One row per store and kind |
| `store.provider_credentials` | 1–3 | Kinds `meta_capi`, `whatsapp`, `meta_page`, `meta_business` (a checked list) |
| `store.meta_events` (new) | 1 | `tenant_id`, `id`, `order_id`, `name` (`Purchase`, `Delivered`), `status`, `reason`, `attempts`, `sent_at`. Unique on (`tenant_id`, `order_id`, `name`): the Conversions API's log, so an event is sent once |
| Settings `meta` | 1 | In the store's settings JSON: `feed` (`enabled`, `key`, the key made by the server), `purchaseAt`, `deliveredEvent`. The pixel ID stays in `storefront.tracking` |
| `store.messages` | 2 | Channel `whatsapp`; `external_id` (Meta's message ID, unique per store) with its status and time; state `waiting` for the SMS fallback |
| `store.whatsapp_templates` (new) | 2 | `tenant_id`, `event`, `locale`, `name`, Meta's `template_id`, `status`, `category`, `reason`, `body`, `submitted_at`, `updated_at`. Unique on (`tenant_id`, `event`, `locale`) |
| `store.customers` | 2, 5 | `whatsapp_opt_out_at`, `whatsapp_marketing_opt_in_at`, with its source |
| `store.conversations` (new) | 4 | `tenant_id`, `id`, `channel`, `external_id` (unique per store and channel), `customer_id`, `name`, `phone` (WhatsApp only), `last_inbound_at`, `last_message_at`, `unread`, `assigned_to`, `state` (`open`, `done`), `referral` (jsonb: ad ID, headline, `ctwa_clid`, when), `created_at`, `updated_at`. Index (`tenant_id`, `state`, `last_message_at`) |
| `store.conversation_messages` (new) | 4 | `tenant_id`, `id`, `conversation_id`, `direction`, `kind`, `body` (jsonb: text, cart lines, location, product), `media_key` (R2), `external_id` (unique per store, so a repeated webhook adds nothing), `status`, `sent_by` (staff, `assistant`, or `echo`), `created_at`. **Kept 90 days** (Q3), then deleted by the daily cleanup |
| `store.quick_replies` (new) | 4 | `tenant_id`, `id`, `title`, `body` (`bn`, `en`), `position` |
| Events | 1–5 | `feed.dirty` from catalog and stock changes; `conversation.message_received`; `order.confirmed` carries the channel that confirmed it |
| `STORE_TABLES` | 1–4 | The new store tables, in purge order. The export includes conversations; sealed tokens stay out, as now |
| KV | 3 | `meta:<asset id> → <store id>` |

Migrations from 0048, two per stage that changes the schema (the schema, then grants), as in earlier phases.

**ADRs:**

- **ADR 0032** records the Meta design: a webhook is checked by signature and believed only about Meta's own objects; routing by KV; consent before the Conversions API; purchases at placement or confirmation; WhatsApp first with SMS as fallback.
- **ADR 0033** records where conversations live, and the cost question in §9.

## 5. Services

| Module | Stage | Does |
| --- | --- | --- |
| `providers/meta` (new) | 1–5 | A small Graph API client (`fetch`, versioned): Conversions API, WhatsApp send and templates, catalog batch, Page and Instagram send, token debug, the code exchange, media download. Signature checks. A fake Meta for previews, as the fake courier is |
| `core/channels` (new) | 1, 3 | Meta connections and their states; the feed's rows and chunks; the checkout URL's cart; catalog pushes |
| `core/notifications` | 2 | The `whatsapp` channel, templates and their status, the SMS fallback, opt-outs, receipts |
| `core/recovery` | 2, 5 | Confirmation by button; the status reply; incomplete-order reminders |
| `core/conversations` (new) | 4, 5 | Conversations, messages, matching, assignment, sending, the window, ad referrals, purchase attribution |
| `core/orders` | 1, 4 | New sources, attribution, the conversation link |
| `apps/api` | 1–5 | The webhooks, the feed route on the storefront host, the queue kinds (§7), the fake Meta's dev routes |
| `apps/storefront` | 1, 5 | Click-ID capture with consent, `product_group` views, `/checkout/meta`, the WhatsApp opt-in box |
| `apps/admin` | 1–5 | Chat sources and the paste box, the share target, **Send by chat**, Settings → Sales channels → Meta, the template editor's WhatsApp tab, Chats |

## 6. API

### 6.1 Admin (`/v1/admin/*`)

- **Stage 1:**
  - `POST /orders/{id}/chat-message`: `{ kind: summary | payment | tracking }`, which returns the text and the `wa.me` link;
  - `POST /orders/parse-chat`: `{ text }`, which returns the phone, the customer, the lines and the order number found;
  - `GET`, `PUT /channels/meta` (feed state, `purchaseAt`, test code), `PUT`, `DELETE /channels/meta/capi`, `POST /channels/meta/feed/rebuild`.
- **Stage 2:**
  - `PUT`, `DELETE /channels/whatsapp` (paste-in connection, checked);
  - `GET /channels/whatsapp/templates`, `POST /channels/whatsapp/templates/{event}/{locale}/submit`.
- **Stage 3:** `POST /channels/meta/connect/whatsapp` and `/connect/facebook` (`{ code }` from the popup); `DELETE /channels/meta/{asset}`.
- **Stage 4:**
  - `GET /conversations` (cursor, filters), `GET /conversations/{id}/messages` (cursor);
  - `POST /conversations/{id}/messages` (text, image, product, template, order link);
  - `POST /conversations/{id}/assign`, `/done`, `/link-customer`;
  - `GET /conversations/{id}/media/{messageId}`;
  - `GET`, `PUT /quick-replies`.

The SDK gains all of these, as before.

### 6.2 Storefront and public

- `GET /feeds/meta.csv`, `GET /feeds/meta-{lang}.csv` (stage 1), on the store's host.
- `GET /checkout/meta` (stage 1).
- Checkout's body gains `attribution` (stage 1) and `whatsappOptIn` (stage 5).

### 6.3 Webhooks and dev

- `GET`, `POST /v1/webhooks/whatsapp/{tenantId}` (stage 2: per store, each store's app secret).
- `GET`, `POST /v1/webhooks/meta`; `POST /v1/webhooks/meta/deauthorize`; `POST /v1/webhooks/meta/data-deletion`; `GET /meta/deletion/{code}` on the main domain (stage 3).
- Outside production only: `POST /v1/dev/fake-meta/{tenantId}`: `{ event }`, which sends a signed webhook as Meta would (an inbound message, a cart, a button reply, a status). The E2E drives every stage with it.

## 7. Background work and Cloudflare configuration

| Change | Stage | Notes |
| --- | --- | --- |
| `managemind-domains` (delayed work) | 1–3 | Gains `feed_build` (15 minutes after the first change), `notify_fallback` (10 minutes), `catalog_push` (5 minutes). No new queue |
| `managemind-outbox` | 1–4 | The Conversions API sends and WhatsApp sends ride the notification consumer. Stage 3–4 webhook entries are queued here as `meta_event` and handled by store |
| Cron Triggers | — | None new. The daily batch gains token checks, attribution clearing and message retention |
| R2 | 1, 4 | `tenants/<id>/feeds/` (chunks), `tenants/<id>/chat/` (media, deleted with its message) |
| KV | 3 | The asset routes; written only on connect and disconnect |
| Secrets | 3 | `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_CONFIG_IDS`; variable `META_APP_ID`. Without them, stage 3's buttons are hidden and stage 2's paste-in stays |

## 8. Security and privacy

- **Every Meta webhook is signed and checked first:**
  - in stage 2 with the store's app secret, from stage 3 with the platform's;
  - constant-time comparison over the raw body, before parsing;
  - the body is size-capped and validated with zod;
  - an unknown asset is dropped.
- **A webhook is believed only about Meta's own objects**: a message arrived, a message was delivered. **Anything that changes an order**, a confirmation button for example, carries our own signed token, checked as the SMS link's is. A cart message never sets a price; it lists variant IDs for staff to turn into an order through the normal quote.
- **No secret in a URL** (ADR 0013). The stage 2 URL carries only the store ID. Tokens travel in headers and signatures.
- **Tokens** are sealed (ADR 0024), never returned, checked daily (§3.3.5), and deleted on deauthorization.
- **Personal data to Meta:**
  - the Conversions API sends hashed phone, email and customer ID, plus IP and user agent, **only with consent**;
  - WhatsApp messages carry what the shopper's own order update says;
  - the store's privacy template says all of this (§1).
- **Conversations are personal data:** visible to `chats.read` only, kept 90 days, exported with the store, purged with it, and deleted on a Meta data deletion request. Media goes through our API with the staff session, never by a public R2 URL.
- **The assistant's status reply** answers only for the phone the message came from (§3.5.2), so a stranger can't read another shopper's orders by guessing numbers.
- **Isolation:** the new store tables join the isolation suite through the API and as raw SQL with the app role. Store A's WABA or Page ID can't reach store B, because routing happens before the tenant context and the tenant context decides every query after it.

## 9. Performance and free-tier impact

At pilot volume (about 20 orders a day in all), plus the chats in stage 4:

| Resource | Free limit | Stages 1–3 | Stage 4 | Note |
| --- | --- | --- | --- | --- |
| Worker requests | 100,000/day | About 100: feed fetches, events, webhooks | Plus about 1,000 for 500 messages a day, plus Chats refreshing while open | Small |
| Worker CPU | 10 ms (Free) | A feed chunk, a signature check, the checkout URL | A webhook entry, the thread | Measured in the CPU step; feed chunks sized to fit |
| Subrequests | 50 per invocation | One Graph call per send; catalog pushes batched | One per media download | Fine |
| Hyperdrive queries | 100,000/day | Small | About 4 per inbound message | Fine |
| KV | 1,000 writes/day | A few on connect | None | Reads only per webhook |
| Queue operations | 10,000/day | Small | About 3 per inbound message: 1,500 | Fine |
| R2 | 10 GB, 1M writes/month | Feed chunks: a few MB per store | Chat images, kept 90 days: about 1–2 GB per busy store | **The first R2 limit this platform could reach.** Watched by the usage alarm |
| **Neon compute** | 100 CU-hours/month | Unchanged: events ride existing traffic | **Every inbound message wakes the database.** Shoppers write until late at night, so it stays awake about 18 hours a day instead of during staff hours. That's roughly 120–140 CU-hours a month at 0.25 CU, **past the free allowance** | Q13 |
| Neon storage | 0.5 GB | Small | About 300 bytes a message, 90 days: about 15 MB per busy store | Fine |
| Meta's charges | — | None | None for replies inside the window | **WhatsApp templates are billed per message by Meta to the store's own WABA** (§3.3.2), by category and country. Utility templates inside an open window have been free since July 2025; one source reports in-window charges from October 2026, **to confirm** (Q8) |

**The stage 4 decision (Q13).** Either:

- **(a)** upgrade Neon when stage 4 goes live, keeping conversations in Postgres. This is the simple design, and the upgrade trigger already exists in PLAN.md's Phase 10 table;
- **(b)** keep each store's recent conversations in a SQLite Durable Object, within Cloudflare's free allowance (100,000 rows written a day; ADR 0006), and write to Postgres only when an order is made from one. Postgres then sleeps at night, but the admin reads two stores, and exports and purges grow a step.

**Recommended: (a)**, measured on the pilot for a month first. A store busy enough on chat to cost compute is a store worth the upgrade.

## 10. Tests

| Layer | Tests |
| --- | --- |
| Unit | The paste parser (phones in every form, product links, order numbers, Bangla text). Feed rows (availability, sale prices, missing brand, Bangla escaping, chunk boundaries). The checkout URL's parsing (bad IDs, quantities, coupon). Hashing and normalizing for the Conversions API against Meta's published examples. Template variable mapping. The SMS fallback's decisions. The signature check (good, bad, missing, a body changed by one byte). Routing by asset. The 24-hour window. The status reply's phone check |
| Integration (Postgres with RLS) | A purchase with and without consent, placed and confirmed, sent once through the log. The feed dirtied, built and served. WhatsApp: planned, sent, delivered, failed then SMS, read; opt-out; a confirmation button applied once, replayed, and forged. Conversations: a message matched by phone, a repeated webhook adding nothing, a cart to an order, assignment, retention. Data deletion and deauthorization |
| Isolation | The new tables and routes: store A gets 404 for B's conversations, media and templates. A's Page ID can't reach B's data |
| Webhook security | Unsigned, wrongly signed and replayed webhooks change nothing. A button with another store's or another order's token changes nothing. A cart message's prices are ignored |
| Export and purge | The export has the new tables; the purge test seeds them and leaves zero rows, and deletes chat media from R2 |
| Sandbox (by hand, then a manual workflow) | `meta-sandbox.yml` sends a test event to the test pixel with its test code, a template message from the test number to a verified phone, and checks the feed with Meta's catalog diagnostics. Run by hand, not on every PR |
| E2E (preview, `narrow-preview` or `full-preview`) | With the fake Meta: paste a chat into a new order; send a summary by chat; a checkout URL to a placed order with attribution; connect WhatsApp (paste-in), see a message delivered, a failed one fall back to SMS, a **Confirm** button confirm an order; Chats with an inbound message, a cart to an order, a reply. Axe on every new screen at phone and desktop sizes |
| CPU step | The feed chunk build and the feed GET, the checkout URL, both webhook routes, the conversation list and thread |

## 11. What changes for existing stores

- **Nothing until a store connects something.** The pixel keeps working as it does. Without a Conversions API token or a WhatsApp connection, no new message is sent and no setting changes.
- **Right away, for every store:** the new chat sources, the paste box and share target, **Send by chat**, the feed URL (published only when the store turns it on in Settings), and the checkout URL.
- **The demo stores** get the fake Meta on previews. In production, sample conversations come with the weekly reset's sample orders, so sales meetings can show Chats without a real Page.

## 12. Pull requests

As in Phases 5B–8: **one pull request per stage, with one commit per step**, its own preview database (`db-branch`), and one preview run near the end. Each stage ends with its own short report section, so the build can stop after any stage with the phase report saying where.

| # | Stage | Scope |
| --- | --- | --- |
| 0 | — | This plan and PLAN.md's status |
| 1 | 1 | `shared` + `db`: sources, `attribution`, `feeds`, credential kinds, channels, migrations 0048–0049; ADR 0032 |
| 2 | 1 | `admin`: chat sources, the paste box and its parser, the share target, **Send by chat** with its templates |
| 3 | 1 | The feed: rows, chunks, the dirty mark, `feed_build`, the GET; `product_group` views; Settings → Sales channels → Meta |
| 4 | 1 | `/checkout/meta`; click-ID capture with consent; `providers/meta` (Conversions API) and the fake Meta; purchases at placement or confirmation |
| 5 | 2 | The `whatsapp` channel: paste-in connection, sending, the delivery log's external IDs, the per-store webhook, receipts and opt-out |
| 6 | 2 | Templates: defaults in both languages (owner-approved wording), submission, status, the editor's WhatsApp tab |
| 7 | 2 | The SMS fallback and `notify_fallback`; confirmation by button |
| 8 | 3 | The platform app: Embedded Signup and Facebook Login for Business, the code exchange, assets and their states, KV routing, the shared webhook |
| 9 | 3 | Catalog registration and `catalog_push`; token checks; deauthorization and data deletion; the screencasts for app review |
| 10 | 4 | `db`: conversations, messages, quick replies, `orders.conversation_id`, migrations; ADR 0033; `core/conversations` with matching and the window |
| 11 | 4 | Inbound for WhatsApp, Messenger and Instagram, echoes, media; the `chat_message` staff alert |
| 12 | 4 | `admin`: Chats (list, thread, composer, side panel, assignment), product cards, carts to orders |
| 13 | 5 | Business-messaging purchases, optional phone and walk-in events, sales by channel and ad |
| 14 | 5 | The status reply; the WhatsApp opt-in and incomplete-order reminders; comment replies if approved |
| 15 | — | CI: the E2E flows, the CPU step's routes, `meta-sandbox.yml` |
| 16 | — | The security review against PLAN.md's checklist, with fixes |
| 17 | — | Phase 9 report |

Steps 8–14 wait for Meta's approvals. If they haven't arrived when stage 2 ends, stages 3–5 are built against the fake Meta and the test assets, and their switch-on waits, as Phase 7's adapters waited for credentials.

## 13. Acceptance criteria and how they're verified

| Criterion | Verification |
| --- | --- |
| 1. Link | Unit tests of the parser and feed; the E2E's paste, send and checkout URL; Commerce Manager's diagnostics on the demo feed; Events Manager's test tab showing one deduplicated purchase. **In the pilot:** share of orders entered from chats, and Meta's event match quality |
| 2. Notify | Integration tests of every WhatsApp path; the E2E's delivered, fallback and confirmation; a real template from the test number. **In the pilot:** SMS sent before and after, confirmation rate by channel |
| 3. Connect | A full connection of the test business on a preview; a price change's time to Meta; a deauthorization from Meta's side. **App review approval itself** |
| 4. Converse | The E2E's inbound message, cart and reply; time from a real WhatsApp message to Chats on the pilot. **In the pilot:** orders created from Chats, time from first message to order |
| 5. Automate | A real click-to-WhatsApp test ad's purchase in Events Manager; the status reply's phone check in integration tests |

## 14. Questions for the owner

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | **When to build, and how far.** The owner asked for the highest integration, step by step | **Approve all five stages now, build stages 1–2 at once, and start Meta business verification and Tech Provider enrolment today.** Stages 3–5 follow the approvals. Each stage is useful alone if Meta's approvals are slow |
| Q2 | The acceptance criteria | **The five groups in the Goal**, since PLAN.md has none for this phase |
| Q3 | How long to keep chat messages | **90 days**, like the delivery log. Orders keep their own record; conversations are for the work in progress. PLAN.md's retention table gains the line |
| Q4 | Server-side purchase events without cookie consent | **Never.** Send only when the shopper accepted the banner. It costs some ad measurement, and keeps the store's privacy page true |
| Q5 | Report purchases when placed or when confirmed | **A store setting, default "placed",** as the pixel does now. Recommend "confirmed" to COD-heavy stores: Meta's ads then learn from real orders, not fake ones |
| Q6 | The pilot's WhatsApp number: Cloud API in stage 2, or wait for coexistence in stage 3 | **A second number for stage 2's notifications, then coexistence for the main number in stage 3**, once confirmed for Bangladesh. Moving the main number in stage 2 would take it off staff's WhatsApp Business app |
| Q7 | WhatsApp and SMS for the same event | **WhatsApp first, SMS only if WhatsApp fails or says nothing within 10 minutes.** Never both. Stores that want both can turn `whatsappFirst` off |
| Q8 | Who pays Meta for WhatsApp messages | **Each store, directly to Meta**, through its own WABA's payment method (the Tech Provider model). This keeps the platform at $0 and outside Meta's billing. The settings page shows Meta's rates for Bangladesh as of the build (about $0.0037 a utility template and $0.0732 a marketing one, from October 2026) and links to Meta's pricing page |
| Q9 | Report phone and walk-in orders to Meta | **Off by default, a store option.** Useful for stores that advertise and take calls; it needs the shopper's phone sent hashed, which the privacy template must say |
| Q10 | Who sees Chats | **Owner, manager, staff; not viewers.** Conversations are personal data, and viewers are for reports |
| Q11 | Replies after Messenger's 24-hour window | **Request the human-agent permission in app review** (up to 7 days, for a person's reply). Without it, the composer explains the window. Meta ended the other message tags on April 27, 2026 (§2.1), so order updates never go by Messenger |
| Q12 | Comment-to-DM replies | **Yes, as stage 5's last item, if app review grants `pages_manage_engagement`.** It's what Bangladeshi shoppers do on posts. Skippable without affecting the rest |
| Q13 | Stage 4's database cost | **Option (a), Neon's paid plan when stage 4 goes live,** after a month's measurement on the pilot (§9). Workers Paid, already triggered by issue #46, comes before stage 4 goes live and gives its webhooks CPU headroom |
| Q14 | New permissions `chats.read` and `chats.write` | **Yes,** for owners, managers and staff. Conversations need their own permission, separate from orders |

## Sources

From #89's research (Oct 29):

- [WhatsApp pricing (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing)
- [WhatsApp pricing change 2026 (respond.io)](https://respond.io/blog/whatsapp-pricing-change-2026)
- [WhatsApp API pricing update, October 1, 2026 (YCloud)](https://www.ycloud.com/blog/whatsapp-api-message-pricing-update-effective-october-1-2026)
- [Best WhatsApp API providers in Bangladesh (chatmitra)](https://chatmitra.com/blog/best-whatsapp-api-provider-bangladesh/)
- [Embedded Signup overview (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/overview/)
- [Onboard WhatsApp Business app users, coexistence (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/)
- [Embedded Signup v4 migration (360dialog)](https://360dialog.com/blog/embedded-signup-versions-migration/)
- [WhatsApp catalogs overview (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/catalogs-overview/)
- [Share products on WhatsApp (Meta)](https://developers.facebook.com/docs/whatsapp/cloud-api/guides/sell-products-and-services/share-products)
- [Click-to-WhatsApp and the free window (SleekFlow)](https://help.sleekflow.io/es_/understanding-click-to-whatsapp-ads-ctwa-and-the-72-hour-free-window)
- [Messenger Send API (Meta)](https://developers.facebook.com/docs/messenger-platform/reference/send-api/)
- [Messenger message tags deprecation (Manychat)](https://community.manychat.com/product-updates/meta-s-deprecation-of-the-message-tags-feature-on-messenger-9010)
- [Private replies (Meta)](https://developers.facebook.com/docs/messenger-platform/discovery/private-replies)
- [Instagram Messaging changelog (Meta)](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/changelog)
- [Instagram Messaging App Review for other businesses (Meta)](https://developers.facebook.com/documentation/business-messaging/instagram-messaging/app-review/apps-for-other-businesses)
- [Facebook Login for Business (Meta)](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/)
- [Messenger Platform overview (Meta)](https://developers.facebook.com/docs/messenger-platform/overview)
- [Catalog Feed API (Meta)](https://developers.facebook.com/documentation/ads-commerce/commerce-platform/catalog/feed)
- [Catalog Batch API (Meta)](https://developers.facebook.com/documentation/ads-commerce/commerce-platform/catalog/batch-api)
- [Conversions API: deduplicating pixel and server events (Meta)](https://developers.facebook.com/docs/marketing-api/conversions-api/deduplicate-pixel-and-server-events)
- [Conversions API best practices (Meta)](https://developers.facebook.com/documentation/ads-commerce/conversions-api/best-practices)
- [Meta phases out Shops checkout (PPC Land)](https://ppc.land/meta-phases-out-facebook-and-instagram-shops-checkout-by-august-2025/)
- [Updates to Meta Shops checkout (BigCommerce)](https://www.bigcommerce.com/blog/updates-to-meta-shops-checkout-for-bigcommerce/)
- [Instagram shopping availability by country (mbial)](https://mbial.com/instagram-shopping-availability-by-country/)
- [Introducing Graph API v25 (Meta)](https://developers.facebook.com/blog/post/2026/02/18/introducing-graph-api-v25-and-marketing-api-v25)

Added for this plan (Oct 27):

- [Embedded Signup, coexistence (Meta)](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/version-4-public-preview/)
- [Conversions API for Business Messaging (Meta)](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging)
- [Instagram API with Instagram Login (Meta)](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login)
- [Checkout methods for Facebook and Instagram (Shopify)](https://help.shopify.com/en/manual/online-sales-channels/facebook-instagram-by-meta/checkout-methods)
- [WhatsApp coexistence (Chatarmin)](https://chatarmin.com/en/blog/whatsapp-coexistence)
- [WhatsApp Conversions API (Stape)](https://stape.io/news/whatsapp-conversion-api)
