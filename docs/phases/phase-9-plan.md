# Phase 9 plan: Meta and messaging

- Status: **Draft, for the owner's review.** It answers the owner's request of Oct 29: research how far the platform can integrate with Meta (Facebook, Messenger, WhatsApp, Instagram), then plan the work step by step, from the least to the most. Nothing is built until the owner picks the levels (§14)
- Date: 2026-10-29
- Scope: PLAN.md "Phase 9 — Meta and messaging": new orders from chat, a product feed for Commerce Manager, server-side Conversions API events, and WhatsApp order notifications. This plan widens the question to everything Meta allows, sorts it into six levels (§3), and proposes which levels make Phase 9 (§4). It builds on Phase 3's pixel, consent banner and chat buttons (phase-3-plan §3.10), Phase 4's manual order screen and purchase event (phase-4-plan §3.16), Phase 5A's credentials vault, notifications and payment links (ADR 0024, ADR 0025), and Phase 6's confirmation queue (phase-6-plan §3.7)

## Goal

Most Bangladeshi SME sales start in a chat. A shopper sees a post or an ad, then writes on Messenger, Instagram or WhatsApp. Staff answer on their phones, copy the name, phone and address into an order by hand, and send the payment details as text. Afterwards, the store's ads can't tell which of those chats turned into a delivered sale.

Phase 9 connects the platform to those chats and to Meta's ads, in steps that each pay for themselves:

- **Orders from chat.** Staff start an order from a conversation, with what the chat already knows filled in, and send the summary and a payment link back into the same chat.
- **The catalog everywhere.** Every store's products appear in Meta's Commerce Manager on their own, for catalog ads, the Facebook and Instagram shop where Meta allows it, and the WhatsApp catalog.
- **Ads that see the sale.** The store tells Meta about each purchase from the server, so ad results survive ad blockers and iOS, and optionally only counts orders that were actually delivered.
- **Updates on WhatsApp.** Shoppers get order, shipping and delivery updates on WhatsApp, which they read, with SMS as the fallback.
- **One inbox.** Messenger, Instagram and WhatsApp messages arrive in the admin beside the orders they belong to.

**Proposed acceptance criteria** (Q1), for the levels proposed in §4:

1. **Chat orders.** From an order or a customer, staff open WhatsApp or Messenger with the order's summary and payment link already written. An order started from chat is marked with its channel, and the report counts orders by channel.
2. **Feed.** A store's feed URL loads in Commerce Manager with no errors for a catalog of 2,000 variants. A product's price, stock or picture change appears in the feed within an hour.
3. **Conversions API.** A web purchase arrives in Events Manager once, from the browser and from the server, de-duplicated. A purchase from a shopper who said no to cookies is never sent. Event match quality is "Good" or better on the demo store.
4. **WhatsApp updates** (if Level 4 is chosen). A connected store's "order placed" and "shipped" reach the shopper as approved WhatsApp templates, at most once each. A number not on WhatsApp falls back to SMS. The Confirm and Cancel buttons move a pending COD order as Phase 6's SMS link does.
5. **Inbox** (if Level 3 or 4 is chosen). A Messenger, Instagram or WhatsApp message reaches the admin's inbox within 10 seconds. Staff reply within the 24-hour window, and a reply that the window forbids is refused with the reason. A forged webhook changes nothing.

**Estimate.** Levels 0 and 1 take about 2 weeks. Each further level is 2 to 3 weeks of building, but Levels 2 to 5 mostly wait on Meta's reviews, which take weeks and can't be hurried (§1). PLAN.md's estimate is about 4 weeks.

## 1. Prerequisites status

PLAN.md: "Never start a phase until its prerequisites have been provided." Phase 9's are a verified Meta Business account, a Meta app with WhatsApp Cloud API access, Tech Provider approval, the pilots' WhatsApp Business numbers and approved templates. **None has been provided yet.** The levels exist so that work can start before Meta's approvals arrive: **Levels 0 and 1 need none of them.**

| Item | Needed from | Status |
| --- | --- | --- |
| Nothing at all | Level 0 | Ready |
| Each pilot store's own Meta Business portfolio, Pixel and catalog, and a Conversions API token the store creates in Events Manager | Level 1 | **Open, per store, minutes each.** Stores that run ads already have the first three. The token is generated under Events Manager → Settings → Conversions API, with no app and no review |
| **The platform's Meta Business portfolio, verified** (trade license, address, a phone and a domain that match) | Level 2 onward | **Open, start now: this can take weeks.** It also needs the company trade license and bank account already listed under "Start these now" in PLAN.md |
| **A Meta app** for the platform, with a privacy policy URL, a data deletion callback and terms on `managemind.site` | Level 2 onward | **Open.** Creating it takes minutes. Its review needs the legal documents of Phase 5B |
| **App Review for Advanced Access**, with a screencast of each permission in use | Level 2 onward | **Open, weeks.** Each permission is reviewed separately (§3, Level 2). Advanced Access is what lets the app serve businesses the platform doesn't own, and it is reviewed again from time to time |
| **Tech Provider status and Access Verification** | Level 4 | **Open, weeks.** Until then the app may onboard 10 businesses per rolling 7 days. With Business Verification, App Review and Access Verification, the limit is 200 |
| Each pilot store's WhatsApp Business number, on WhatsApp Business app 2.24.17 or later | Level 4 | **Open.** With coexistence the store keeps using the app on its phone (§3, Level 4) |
| Each store's payment method in its own Meta billing | Level 4 | **Open.** As a Tech Provider, the platform never pays for stores' messages: each store adds a card in its WhatsApp Manager |
| Approved Bangla and English wording for the WhatsApp templates | Level 4 | **Open.** Phase 5A's approved SMS wording is the starting point. Meta approves each template per store's WhatsApp account, usually within minutes for utility templates |
| Legal review | Levels 1, 3, 4 | **Open, joins Phase 5B's.** The store privacy template gains: Meta receives hashed contact details with each purchase (Level 1), and Meta carries the store's chats (Levels 3 and 4). The platform's data processing agreement names Meta as a processor the store chooses |
| `CREDENTIALS_KEY` in production | Levels 1 to 5 | **Carried from Phase 5A, blocking for production use.** Meta tokens go in the same vault (ADR 0024) |
| Workers Paid | Levels 3 and 5 | **Already triggered** by the production CPU stops of Oct 26 (issue #46, ADR 0013). An inbox adds a Worker request and a few database queries per message, on an account whose Hyperdrive queries already passed the free limit once (Oct 18). Levels 0 to 2 fit the Free plan; Level 3 should not go live without Paid (§9) |
| Hosts to allow in the cloud environment's network list | Development | **For the owner, before Level 1 is tested:** `graph.facebook.com`, `www.facebook.com`, `connect.facebook.net`. Workers in production reach any host |

## 2. Research: what Meta allows, surface by surface

Sources are listed at the end. Where a detail came only from a vendor's blog, it says so. Each one is to be checked against Meta's own documentation when its level is built.

### 2.1 What has changed recently, and matters here

- **Shops checkout ended.** Since September 2025 Facebook and Instagram Shops send shoppers to the store's own website to buy. Commerce Manager no longer takes orders, payouts or chargebacks. Shops, catalogs and catalog ads remain. So a store's Meta catalog is a showcase and an ad source. It never becomes a second order system, and our checkout stays the only one.
- **Shops in Bangladesh are uncertain.** No official source confirms whether Bangladesh is a supported Shops country, and vendor sources disagree. **Catalogs and catalog ads don't depend on Shops,** so the feed (Level 1) is useful either way.
- **WhatsApp is priced per message** (since July 2025). From **October 1, 2026**, Meta's rate card puts Bangladesh at about **$0.0037 for a utility or authentication template** (down from $0.0113) and **$0.0732 for a marketing template**. **Service replies** inside the 24-hour window are free for the first **1,000 a month per number**, then charged at the utility rate. Utility templates sent inside an open window are now charged too. Messages the shopper sends are free. Rates come from vendor summaries of Meta's October card; Meta's own page confirms the model and the dates.
- **Click-to-WhatsApp ads** open a free window: every reply, templates included, is free for up to **7 days** after the shopper writes from the ad (it was 72 hours). A Facebook Page's WhatsApp button opens 72 hours.
- **WhatsApp coexistence** lets one number work in the WhatsApp Business app on the owner's phone and through the Cloud API at once. Chats of the last 6 months sync, and messages sent from the app stay free. **It suits Bangladeshi SMEs, who will not give up the app.** Limits: 20 messages a second, no groups or broadcast lists, and the app's catalog and order tools aren't available through the API.
- **Embedded Signup v2 and v3 retired on October 15, 2026.** Anything built now uses v4 or later.
- **Messenger's message tags narrowed.** Vendor sources report that `CONFIRMED_EVENT_UPDATE`, `ACCOUNT_UPDATE` and `POST_PURCHASE_UPDATE` stopped working on April 27, 2026, and recurring notifications ended on February 10, 2026 outside a few regions. **`HUMAN_AGENT`** remains: a person may reply up to 7 days after the shopper's last message on Messenger. **So Messenger can't carry order updates outside the 24-hour window,** and WhatsApp or SMS must.
- **The Graph API** is at v25.0 (February 2026), and Meta retires each version about two years after release. One unconfirmed source mentions a v26.0. The platform pins one version in one constant and moves it on yearly.

### 2.2 The surfaces

| Surface | What a platform can do | What it needs | What it costs the store |
| --- | --- | --- | --- |
| **Chat links** (`wa.me`, `m.me`, `ig.me`) | Open a chat with a written message: a product, a cart, an order summary, a payment link | Nothing | Nothing |
| **Meta Pixel** (browser) | Page, product, cart, checkout and purchase events for ads | The store's Pixel ID. **Built in Phase 3 and 4** | Nothing |
| **Conversions API** (server) | The same events from our server, de-duplicated with the pixel's by event ID. Also events the browser can't see, such as **delivered** | The store's Pixel ID and a token it makes in Events Manager. No app or review | Nothing |
| **Catalog feed** | A URL Meta fetches on a schedule, at most hourly. Feeds catalog ads, Shops where allowed, and the WhatsApp catalog | A public CSV or XML URL. No app or review | Nothing |
| **Catalog Batch API** | Changes sent as they happen, up to 5,000 items a call | An app with `catalog_management`, reviewed | Nothing |
| **Facebook Login for Business** | The store connects its Page, Instagram account, Pixel, catalog and WhatsApp number in one dialog, instead of pasting IDs and tokens | An app, Business Verification, App Review per permission | Nothing |
| **Messenger Platform** | Receive Page messages by webhook; reply within 24 hours (7 days by a person, with `HUMAN_AGENT`); buttons, quick replies, attachments; **private replies** to Page comments (one per comment, within 7 days) | `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `business_management`, all with Advanced Access | Nothing |
| **Instagram Messaging** | Receive DMs, story replies and mentions; reply within 24 hours (`HUMAN_AGENT` for people); private replies to post and reel comments | `instagram_manage_messages` (or `instagram_business_manage_messages`), comments permissions, Advanced Access; a professional account linked to a Page | Nothing |
| **WhatsApp Cloud API** | Templates at any time; free-form replies in the 24-hour window; buttons, lists, product messages; delivery and read receipts; **the shopper's phone number** with every message | Tech Provider, `whatsapp_business_messaging` and `whatsapp_business_management` with Advanced Access, Embedded Signup | Per message, above. Meta bills the store directly |
| **WhatsApp catalog and cart** | Single and multi-product messages (up to 30 products); the shopper sends a cart, which arrives by webhook | A Meta catalog linked to the store's WhatsApp account. Not available with coexistence | Per message |
| **WhatsApp Flows** | A form inside WhatsApp: an address, a delivery area, a confirmation | Cloud API; an endpoint for live data | Per message |
| **Click-to-WhatsApp and Click-to-Messenger ads** | The webhook says which ad started the chat, so an order from that chat can be credited to it | Cloud API or the Messenger Platform | The ad. Replies in the free window are free |
| **Marketing messages** | Promotions to shoppers who opted in | A template per campaign, opt-in records | About $0.073 each, roughly 20 utility templates |
| **Meta Business Agent** | Meta's AI answers chats on the store's behalf | Cloud API | Per token (about 4–5 cents a message, Meta's estimate) |
| **Marketing API** | Create and run ads, upload customer lists as audiences | `ads_management`, a much stricter review | The ads |
| **Facebook Login for shoppers** | Shopper sign-in with Facebook | A Facebook app with Login reviewed | Nothing. **Planned separately** under PLAN.md "Later features" |

### 2.3 What is borrowed from other platforms

| From | What |
| --- | --- |
| Shopify's Facebook & Instagram channel | The catalog stays in sync automatically, one item per **variant** with the product as its group; the pixel and Conversions API are set up together; orders are tagged with the channel they came from. We borrow all three. Shopify's in-app checkout went away with Meta's, so there is nothing more to copy |
| Shopify Inbox, and Bangladeshi f-commerce tools | One inbox for all chats, beside the shopper's orders; buttons to send a product, a cart or a payment link into the chat. We borrow the inbox at Level 3, kept small: no bots, no assignment rules |
| WooCommerce's Meta plugin | A feed URL the merchant pastes, before any app or login. That is our Level 1 |
| Medusa, Saleor, Vendure | No messaging of their own: chats come through plugins or outside tools. Their **notification provider** pattern is the one ADR 0025 already follows, so WhatsApp becomes another channel there |
| Our own ADR 0025 and couriers (ADR 0030) | A webhook is a hint until verified. Meta signs its webhooks (`X-Hub-Signature-256`), so the signature is the check |

## 3. The levels, from the least to the most

Each level is useful alone. Each later level uses the earlier ones, and asks more of Meta's approvals, the store and the free plan.

| Level | Name | Meta approval | Platform work | What the store gets |
| --- | --- | --- | --- | --- |
| **0** | Chat shortcuts | None | ~3 days | Send an order, a cart or a payment link into WhatsApp or Messenger in one tap; orders marked by channel |
| **1** | Catalog and Conversions API | None (each store pastes an ID and a token) | ~1.5 weeks | Its products in Meta, catalog ads, ad results that count real sales |
| **2** | Connect with Facebook | Business Verification, App Review | ~1 week, then the review | One button instead of pasted IDs; catalog updates as they happen |
| **3** | Messenger and Instagram inbox | Advanced Access for messaging | ~2.5 weeks | Page and Instagram chats in the admin, orders started from a chat, comment replies |
| **4** | WhatsApp Business Platform | Tech Provider | ~3 weeks | WhatsApp updates instead of SMS, Confirm and Cancel buttons, WhatsApp chats in the inbox |
| **5** | Conversational commerce | As Level 4, plus catalog checks | ~3 weeks | Product messages and carts in WhatsApp, address forms, ad-to-order credit, opt-in campaigns |

### Level 0 — Chat shortcuts (no Meta account)

What exists today: the storefront's WhatsApp and Messenger buttons (`chat` settings), the Pixel with event IDs, the consent banner, payment links (Phase 5A), and the manual order screen, whose sources are `facebook`, `phone`, `walk_in` and `other`.

- **Order sources by channel.** `ORDER_SOURCES` gains `messenger`, `whatsapp` and `instagram`. `facebook` stays for Page comments and posts. The order list filters by source, and the sales report gains orders and delivered sales by source (Q3).
- **"Send in chat"** on the order page, the payment link dialog and the confirmation queue: a menu of **WhatsApp** and **Messenger**, which opens `wa.me/<phone>?text=…` (or the Messenger app, where the message is copied first, since `m.me` can't address a shopper). The text is the order's summary in the shopper's language: items, total, delivery charge, the advance asked for, and the payment link when one is due. Templates follow ADR 0025: code defaults, per-store overrides, a fixed variable list.
- **"New order from chat"**: the manual order screen takes a pasted phone number or a `wa.me` link and finds the customer, their score (Phase 6) and their last address, then asks for the source. A **paste box** reads a shopper's typed address and phone from a chat message and suggests the division, district and area (it suggests; staff confirm). No Meta call.
- **Share buttons** on the storefront's product page (WhatsApp, Messenger, copy link), using the Open Graph tags Phase 3 already writes. The cart page gains "Order on WhatsApp": the cart's lines and total as a message to the store's number, for shoppers who'd rather order by chat.
- **A pixel fix found while planning:** `ViewContent` sends the product's ID, while `AddToCart` and `Purchase` send variant IDs. With a catalog (Level 1) the IDs must match the feed. `ViewContent` becomes `content_type: 'product_group'` with the product's ID, which Meta matches to the feed's `item_group_id`.

### Level 1 — Catalog feed and Conversions API (each store's own token)

**The product feed.**

- **One item per variant**, as Meta and Shopify do: `id` the variant's ID (what the pixel sends), `item_group_id` the product's ID, `title`, `description`, `availability`, `condition`, `price` and `sale_price` with `BDT`, `link` to the variant on the store's own domain, `image_link` and `additional_image_link` at a Meta-friendly size from our image resizing, `brand` (the store's name unless set), and the product's attributes as `color`, `size`, `material` and `pattern` where Phase 2's attributes map to them (ADR 0017). A **Bangla feed** goes beside the English one, for Meta's language override (`override` column), when the store sells in both (Q4).
- **Served from R2** at `https://<store host>/feeds/meta.csv` (and `meta-bn.csv`), written by the daily batch and after a catalog change, at most once an hour per store: the first change queues a rebuild an hour later on the delayed-work queue, and later changes in that hour ride along. Meta fetches it on its schedule (hourly at most), so nothing faster is useful without the Batch API (Level 2). The URL holds an unguessable key so that only the store's Meta account reads it, and it can be changed (Q5).
- Only **published, priced** variants with a picture. Sold-out ones stay as `out of stock`, so ads stop and come back by themselves. Hidden products and draft prices never leave.
- **Admin:** Settings → Marketing → Meta shows the feed URL to paste into Commerce Manager, the item count, and the items left out and why.

**The Conversions API.**

- **The store saves its Pixel ID (already in settings) and a Conversions API token** in the vault (ADR 0024, a new kind `meta_capi`). The token is checked by sending a test event before it is saved, as couriers and gateways are.
- **Events** go through the outbox, never in the shopper's request:
  - `Purchase` on `order.placed` for website orders, with `event_id` = the order ID (what the browser sent since Phase 4), so Meta counts it once;
  - `InitiateCheckout` and `AddToCart` stay browser-only: they're many, cheap, and add nothing the pixel lacks (Q6);
  - **`Delivered`** (a custom event, or `Purchase` itself, Q7) on the shipment's delivered state, with the delivered value. For COD stores, where many placed orders are cancelled or refused at the door (Phase 6's scores measure how many), this lets an ad optimize for sales that were paid for.
- **What is sent:** the shopper's phone (as `+880…`), email, name, city and district, **SHA-256 hashed** after Meta's normalization; the client IP and user agent; the `_fbp` and `_fbc` cookies; and the store's customer ID as `external_id`, hashed. The checkout request already carries the cookies and IP, and the order keeps them in a new `ad_context` column for the delivered event days later. Nothing is sent for orders placed by staff, since the shopper never saw an ad on our site (Q8).
- **Consent decides.** The checkout reads `mm_consent`. Without `granted`, the order records `ad_context = null` and **no server event is ever sent**, as no browser event was. The privacy template says so (§1).
- **Retries:** a failed call is retried by the queue; a 4xx from Meta (a revoked token) marks the token failed in settings and stops, with an alert to the owner.
- **Test mode:** a `test_event_code` field in settings, so the owner sees events in Events Manager's Test Events tab while setting up.

### Level 2 — Connect with Facebook (the platform's Meta app)

- **Facebook Login for Business** in Settings → Marketing → Meta: the store's owner signs in, picks the Business portfolio, Page, Instagram account, Pixel and catalog (or creates a catalog), and the platform receives a **business token** scoped to what was picked. It replaces pasting at Level 1, which stays as the fallback.
- With the token, the platform **creates the catalog and its scheduled feed** for the store, **creates the Conversions API token**, and reads the Page's and Instagram account's IDs and names for Level 3.
- **The Catalog Batch API** replaces hourly feeds for stores connected this way: a price, stock or visibility change is sent within minutes through the outbox, batched per store. The nightly feed stays as the full reconciliation.
- **Permissions to review:** `business_management`, `catalog_management`, `pages_show_list`, `pages_read_engagement`, `ads_read` (to read the pixel). Each needs a screencast of the feature using it.
- The admin loads Meta's JavaScript SDK **only on this screen**, after the owner presses Connect. The admin's CSP gains `connect.facebook.net` and `www.facebook.com` for that route alone, and the admin's bundle before sign-in is unchanged (phase-1-plan §7.3).
- A **data deletion callback** and a **deauthorize callback** on `api.managemind.site`: when a store removes the app in Facebook, its tokens are deleted and its Meta features turn off.

### Level 3 — Messenger and Instagram inbox

- **Webhooks:** one endpoint, `POST /v1/webhooks/meta`, for the whole app, with Meta's `GET` handshake. Each delivery's `X-Hub-Signature-256` is checked against the app secret before anything is read. A platform table maps each **Page ID, Instagram account ID** (and at Level 4, **phone number ID**) to its store, so a delivery finds its tenant without trusting anything in the body.
- **The inbox** (a new admin item, `Inbox`): conversations by channel, newest first, unread counts, the shopper's name and picture from Meta, and beside each conversation **the customer it is linked to, their score and their open orders**. Staff link a conversation to a customer by phone; Messenger and Instagram never give a phone number.
- **Replying:** text, pictures, a product card, an order summary and a payment link. In the 24-hour window, any of these. **After it, only a person's reply, within 7 days** (Messenger's `HUMAN_AGENT`; Instagram's own rules, to confirm). Outside both, the reply box says why it's closed and offers WhatsApp or SMS if the customer has a phone.
- **"New order from chat"** from a conversation: the manual order screen opens with the customer, the source set to the channel, and a link back. The placed order's summary can be sent into the conversation.
- **Comments:** a Page post's or an Instagram post's comment arrives in the inbox with its post. **"Reply privately"** sends one private message (Meta's limit: one, within 7 days), which opens a conversation if the shopper answers. No automatic replies at this level (Q10).
- **What is kept:** messages and their senders' Meta IDs, for **90 days** like ADR 0025's log (Q11). Attachments are not copied: Meta's URLs expire, so a picture is fetched through the API when staff open it, within its life.
- **Notifications:** a new conversation or a message after a quiet hour pushes to staff who chose it (ADR 0025), never every message.
- **Permissions to review:** `pages_messaging`, `pages_manage_metadata`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_messages`, `instagram_manage_comments`, `pages_manage_engagement` (comment replies). Meta's review asks whether the app is a custom inbox, an automated experience or both; this one is an inbox.

### Level 4 — WhatsApp Business Platform

- **Becoming a Tech Provider** (§1): the platform's app gets `whatsapp_business_management` and `whatsapp_business_messaging` with Advanced Access, and Access Verification. The platform never resells messages: **each store's WhatsApp account bills the store's own card** (Q12).
- **Connecting:** Embedded Signup (v4 or later) from Settings → WhatsApp. The store picks **"use my existing WhatsApp Business app number"** (coexistence) or a new number. The platform exchanges the code for a business token, subscribes to the account's webhooks, registers the number (new numbers only), and **creates the store's templates** in its account from the approved wording (§1).
- **WhatsApp as a notification channel** (ADR 0025): `whatsapp` joins `email`, `sms` and `push`.
  - Templates per event: order placed, confirmed, shipped (with the tracking link), out for delivery, delivered, failed delivery, return received, refund made, and the payment link. **All utility** templates, at about $0.0037 each in Bangladesh.
  - The planner picks **WhatsApp first** when the store has it and the shopper's phone is on WhatsApp, and **SMS otherwise**. A template the API refuses (not on WhatsApp, or undeliverable) falls back to SMS for that message, once. The delivery log keeps both (Q13).
  - **Inside the 24-hour window**, a free-form message replaces the template when the free 1,000 service messages a month remain, since a utility template sent inside the window is now charged.
  - **Delivery and read receipts** update the log, so staff see "read" on the order.
- **Order confirmation by WhatsApp** (Phase 6): the "order placed" template for a pending COD order carries **Confirm** and **Cancel** quick-reply buttons. A tap arrives by webhook and moves the order exactly as Phase 6's SMS link does, with the same checks (pending only, a risky phone still gets a call).
- **The OTP before COD** (Phase 5A) can go by WhatsApp as an **authentication** template with a copy-code button, cheaper than most SMS, falling back to SMS.
- **The inbox** gains WhatsApp: every conversation comes **with the shopper's phone number**, so it links itself to the customer, their score and their orders without staff typing anything. "New order from chat" fills the phone and the last address.
- **Coexistence's limits** are shown in settings: no groups or broadcast lists on that number any more; the app's own catalog and order tools stay in the app; 20 messages a second.

### Level 5 — Conversational commerce

Each item is optional and can be chosen alone (Q14).

- **Products in WhatsApp:** from the inbox, send one product or up to 30 (a multi-product message) from the store's Meta catalog (Level 1 or 2). The shopper's **cart arrives by webhook** and becomes a **draft order** on the manual order screen, priced by our server (never by the cart's prices), for staff to finish. Needs a number **not** on coexistence, since the API can't use the app's catalog tools there.
- **WhatsApp Flows** for the delivery address: division, district and area pickers inside WhatsApp, filled from our reference data, answered by an endpoint on the API. The result fills the draft order.
- **Ad credit:** a chat started from a Click-to-WhatsApp or Click-to-Messenger ad carries the ad's ID in its first webhook. The conversation keeps it, an order started from the conversation inherits it, and the server sends that order's `Purchase` and `Delivered` to the Conversions API with `action_source: 'business_messaging'`, so ads that start chats are credited with the sales they lead to. The 7-day free window is shown on the conversation.
- **Opt-in campaigns:** shoppers tick "send me offers on WhatsApp" at checkout or in their account (off by default); staff send a marketing template to a segment of opted-in customers. About ৳9 each at $0.0732 and about ৳122 to the dollar, shown before sending, with a monthly cap per store. Opting out by replying STOP is honored at once.
- **Automatic replies:** a Page comment containing a keyword (for example "price") gets a private reply with the product's link, and an Instagram DM asking about a product gets its card. Small rules per post; no AI at this level.
- **Not proposed:** Meta Business Agent (an AI agent billed per token, whose answers about price and stock we can't vouch for); the Marketing API (ads from the admin, customer list audiences), whose review is strict and whose screens belong to Ads Manager; and checkout inside Meta's apps, which Meta itself removed.

## 4. What Phase 9 proposes

**Recommended (Q2): build Levels 0 and 1 now, apply for Meta's approvals at once, and build Levels 3 and 4 as the approvals arrive.** Level 2 comes with Level 3, since both use the same app and the same review. Level 5 waits for the pilot's demand.

| When | What | Why |
| --- | --- | --- |
| Now | **Owner:** start Business Verification, create the Meta app, write the privacy, deletion and terms pages. **Agent:** Levels 0 and 1 | Nothing in Levels 0 and 1 waits on Meta. The reviews take weeks, so they start the same day |
| When the app is verified | Level 2, then submit Level 3's permissions for review with screencasts recorded on a preview | One review can cover both levels' permissions |
| When Advanced Access is granted | Level 3 | Pilot stores live in Messenger first |
| When Tech Provider status is granted | Level 4 | The biggest value: WhatsApp updates, Confirm buttons, and phone-linked chats |
| On demand | Level 5's items, one by one | Each has its own cost and its own users |

This keeps PLAN.md's four Phase 9 items: the chat shortcuts (Levels 0 and 3), the feed (Level 1), the Conversions API (Level 1) and WhatsApp notifications (Level 4).

## 5. Data model

Only the tables of the recommended levels. Every store table is under forced RLS with the tenant policy, in the isolation suite, the export and the purge.

| Table | Level | Key columns | Notes |
| --- | --- | --- | --- |
| `store.orders` (changed) | 0, 1 | `source` gains `messenger`, `whatsapp`, `instagram`; new `ad_context jsonb null` (`fbp`, `fbc`, `ip`, `user_agent`, `consented_at`) | `ad_context` is null without consent; kept until the order's delivered event is sent or 30 days, then cleared by the daily cleanup |
| `store.provider_credentials` (changed) | 1, 2, 4 | new kinds `meta_capi`, `meta` (the business token), `whatsapp` | ADR 0024 as it is |
| `store.meta_settings` | 1 | `tenant_id`, `feed_key`, `feed_locales`, `capi_enabled`, `capi_delivered_event`, `test_event_code`, `last_feed_at`, `last_feed_items`, `last_feed_skipped jsonb` | One row per store |
| `store.chat_message_templates` | 0 | as ADR 0025's overrides, keyed by event and locale | Or a new channel `chat` in the existing overrides table, decided at the build |
| `platform.meta_assets` | 2–4 | `kind` (`page`, `instagram`, `waba`, `phone_number`), `meta_id` unique, `tenant_id` | The webhook's tenant lookup; platform schema, readable by the webhook role only |
| `store.conversations` | 3, 4 | `channel`, `meta_thread_id`, `customer_id null`, `last_message_at`, `window_ends_at`, `human_window_ends_at`, `unread`, `ad_id null` | Unique per store and thread |
| `store.chat_messages` | 3, 4 | `conversation_id`, `direction`, `meta_message_id` unique, `kind`, `body`, `attachment jsonb`, `status`, `sent_by null` | Kept 90 days (Q11); `meta_message_id` makes a redelivered webhook a no-op |

## 6. API

- **Storefront:** `GET /feeds/meta.csv?key=…` (served from R2 by the storefront Worker, `private`-cacheable for an hour). The checkout's place-order request reads the consent and `_fbp`/`_fbc` cookies it already receives.
- **Admin:** `GET/PUT /v1/admin/settings/meta`, `POST /v1/admin/settings/meta/test-event`, `POST /v1/admin/orders/{id}/chat-message` (renders the summary and the link for a channel); at Level 2 `POST /v1/admin/meta/connect` (the code exchange) and `DELETE /v1/admin/meta/connection`; at Level 3 `GET /v1/admin/conversations`, `GET /v1/admin/conversations/{id}/messages`, `POST /v1/admin/conversations/{id}/messages`, `POST /v1/admin/conversations/{id}/link-customer`, `POST /v1/admin/comments/{id}/private-reply`; at Level 4 `POST /v1/admin/whatsapp/connect`.
- **Webhooks:** `GET` and `POST /v1/webhooks/meta`; `POST /v1/webhooks/meta/deauthorize`; `POST /v1/webhooks/meta/data-deletion`.
- The SDK in `packages/sdk` is regenerated with each route, as CI checks.

## 7. Background work and Cloudflare configuration

- **Outbox events:** `order.placed` → Conversions API `Purchase`; `shipment.delivered` → `Delivered`; catalog changes → the feed's rebuild flag (Level 1) or a Batch API call (Level 2); notification events → WhatsApp (Level 4).
- **The feed** is rebuilt in the daily batch for every store with Meta on, and an hour after a catalog change by one message on the existing delayed-work queue per store and hour. No new Cron Trigger: today's are the daily batch and the two courier polls.
- **Webhooks** are acknowledged at once (Meta retries slow answers) and processed on the existing outbox queue, never in the request.
- **Subrequests:** each Conversions API event is one call; a store's feed is one R2 write. Both fit the Free plan's 50 per invocation.
- **New hosts** called by the API Worker: `graph.facebook.com` only.

## 8. Security and privacy

- **Tokens** live only in the vault, are decrypted only by the code calling Meta, and are never logged or returned (ADR 0024).
- **Webhooks** are refused without a valid `X-Hub-Signature-256`, compared in constant time, and the tenant comes from `platform.meta_assets`, never the body.
- **Hashing:** contact details leave only SHA-256 hashed, after Meta's normalization (lowercase, trimmed, phone in E.164 without `+`). IP and user agent go unhashed, as Meta requires, and only with consent.
- **Consent** gates every Conversions API event (§3, Level 1). Orders placed by staff send nothing.
- **The feed** contains only what the storefront already shows, behind a changeable key.
- **The inbox** holds personal messages: `inbox.read` and `inbox.write` permissions (Owner, Manager and Staff by default, never Viewer), 90-day retention, export and purge with the store.
- **Data deletion:** Meta's deletion callback deletes the conversations of the Meta user it names, and answers with a status URL as Meta requires.
- **Logs** carry IDs and counts, never message text, names or phones.

## 9. Performance and free-tier impact

| Level | Workers requests | Database | Other |
| --- | --- | --- | --- |
| 0 | None new | None new | — |
| 1 | One queue message per web order and per delivery; the feed fetch is one storefront request per hour per store | A few queries per event | R2: one feed object per store and language, about 1 KB per 3 variants. Class A writes: at most 24 a day per store |
| 2 | One per catalog change batch | A few per batch | — |
| 3 | **One per incoming message and per delivery receipt,** plus the inbox's reads | **3–5 queries per message** | At 20 stores × 200 messages a day, about 4,000 requests and 20,000 queries a day: **too much beside today's Hyperdrive load on the Free plan** |
| 4 | As Level 3, plus receipts for every WhatsApp update | As Level 3 | Each store pays Meta per message |

**Workers Paid before Level 3 goes live** (Q15). The production CPU stops of Oct 26 have already met ADR 0013's trigger, and Hyperdrive passed its daily limit on Oct 18. Levels 0 to 2 add little and fit the Free plan.

**Bundles:** no new dependencies. The Graph API is plain `fetch`. The admin's inbox is its own lazy route, and Meta's JavaScript SDK loads only on the connect screens, so the JavaScript before sign-in doesn't grow.

## 10. Tests

- **Level 0:** the chat text for each order state and locale; the `wa.me` encoding of Bangla; the address paste parser on 50 real-looking messages (Bangla, English, mixed); the new sources in reports.
- **Level 1:** the feed for a fixture catalog: variants as items, groups, prices and sale prices, out-of-stock items kept, drafts and hidden products left out, Bangla override; a 2,000-variant feed's build time. Conversions API: the payload against Meta's schema, hashing against Meta's published examples, consent off sends nothing, the event ID equal to the order ID, a 4xx stopping the token, staff orders sending nothing. The pixel's `ViewContent` with `product_group`.
- **Level 3 and 4:** webhook signatures (valid, forged, missing); tenant lookup; redelivery idempotency; the window rules for each channel; the WhatsApp planner's choice and fallback to SMS; Confirm and Cancel matching Phase 6's link tests; isolation of the new tables.
- **E2E:** Level 0's send-in-chat menu and the new sources; Level 1's settings screen with a fake Graph API. Real Meta calls are tested by hand on the demo store with Events Manager's test code, never from CI.

## 11. What changes for existing stores

- **Nothing turns on by itself.** The new order sources appear in the manual order screen; the share buttons and "Order on WhatsApp" follow the existing `chat` settings and can be hidden.
- **The pixel's `ViewContent`** changes its `content_type` to `product_group` for every store with a Pixel. Meta treats this as the same event; a store's audiences are unaffected.
- **The order and customer CSV exports** gain the new sources' names.

## 12. Pull requests

Levels 0 and 1, the recommended start:

1. The plan, approved.
2. `shared` + `db`: the new order sources, `ad_context`, `meta_settings`, the credential kind; migration.
3. Level 0: chat summaries, "Send in chat", the paste box, share and "Order on WhatsApp" buttons, the sources in the order list and the sales report.
4. The pixel's `product_group` fix.
5. `core/meta` + `providers/meta`: the feed builder, R2 writing, the storefront's feed route.
6. The Conversions API: consent and cookies at checkout, the outbox events, the token check, settings and test mode.
7. Admin: Settings → Marketing → Meta.
8. E2E, the security review, the report.

Levels 2 to 5 get their own pull requests when their approvals arrive, each planned in a short addendum to this plan.

## 13. Acceptance criteria and how they're verified

| Criterion | Verified by |
| --- | --- |
| 1. Chat orders | Unit tests of the text; the E2E opens the menu and checks the link; the sales report test counts by source |
| 2. Feed | A fixture catalog's feed checked against Meta's field rules; the demo store's feed loaded into a real Commerce Manager catalog by hand, with its diagnostics showing no errors |
| 3. Conversions API | Integration tests of payloads and consent; on the demo store, one purchase seen once in Events Manager with "Browser and server" and its match quality |
| 4. WhatsApp updates | Planner and fallback tests; a pilot store's number on coexistence, by hand |
| 5. Inbox | Webhook tests with recorded payloads; a pilot Page and Instagram account, by hand |

## 14. Questions for the owner

1. **Acceptance criteria:** accept the five proposed in the goal? *Recommended: yes.*
2. **Levels:** start with Levels 0 and 1 while Meta reviews the app, then Level 2 and 3 together, then Level 4; Level 5 on demand? *Recommended: yes.*
3. **Order sources:** add `messenger`, `whatsapp` and `instagram`, keeping `facebook` for Page posts and comments? *Recommended: yes.*
4. **Bangla in the feed:** a Bangla override feed when the store's catalog has Bangla titles? *Recommended: yes; English stays the main feed, since Meta's ads tools work best with it.*
5. **Feed URL:** on the store's domain with a secret key, changeable in settings? *Recommended: yes.*
6. **Server events:** `Purchase` and the delivered event only, leaving add-to-cart and checkout to the browser? *Recommended: yes.*
7. **Delivered event:** send delivery as a custom `Delivered` event (ads can optimize for it as a custom conversion), or send `Purchase` only at delivery and not at placement? *Recommended: a custom `Delivered`, keeping `Purchase` at placement so today's ads and reports don't change.*
8. **Staff orders:** send nothing to Meta for orders staff enter, until Level 5's ad credit can say which ad they came from? *Recommended: yes.*
9. **Who sets it up:** the store's owner pastes the Pixel ID and token at Level 1, with a Bangla help article (Phase 5B's help guide)? *Recommended: yes.*
10. **Comments:** private replies by hand at Level 3, automatic keyword replies only at Level 5? *Recommended: yes.*
11. **Retention:** keep chat messages 90 days, like the notification log? *Recommended: yes.*
12. **WhatsApp billing:** each store pays Meta directly with its own card, never through our invoices? *Recommended: yes; reselling messages needs Solution Partner status and a credit line.*
13. **WhatsApp or SMS:** WhatsApp first when connected, SMS as the fallback per message? Or let each store choose per event? *Recommended: WhatsApp first, with a per-store switch to keep SMS for "order placed" while shoppers get used to it.*
14. **Level 5:** which items, if any, do the pilots ask for? *Recommended: decide after a month of Level 4.*
15. **Workers Paid:** upgrade before Level 3 goes live, as ADR 0013 already calls for? *Recommended: yes, now, for issue #46's CPU stops.*
16. **Meta approvals:** will the owner start Business Verification and create the app this week? Everything after Level 1 waits on it.

## Sources

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
