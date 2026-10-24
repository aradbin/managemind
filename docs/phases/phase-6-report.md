# Phase 6 report: Sales recovery

- Date: 2026-10-24
- Plan: `docs/phases/phase-6-plan.md` (approved with the owner's answers in §14)
- Branch: `ccr-36d50e25-3oyrge`, one commit per plan step (§1). **No pull request yet:** the owner chose to open it once Actions minutes allow (Q12). The repository is public for now, so they are free (PLAN.md, 5B's row)

> This report covers the build. Everything here was checked locally: the unit and integration tests, the new E2E flow at a phone and a desktop viewport, and the Phase 4 and 5A flows before it. The preview's results go here after the pull request's `full-preview` run: the E2E on the preview, Lighthouse and the CPU step.

## Summary

Phase 6 is built. Staff now have tools for the two things that cost COD stores the most: shoppers who leave checkout, and orders that are never received.

- **The delivery success score.** Every phone gets a score from the store's own orders: delivered, against returned, fake, wrong number and no answer. It shows on every order, in the orders list, on the customer, on the manual order screen as a phone is typed, and in the call queue, with the counts behind it. The order keeps the score it had when placed.
  - **Risky and trusted phones.** A phone is risky when staff flagged it, when it reached the store's failed-delivery limit, or when it is under the store's minimum score. Risky phones get Phase 5A's advance delivery charge or code by SMS, where the store asks for them. There is no minimum score until the pilot's data sets one (Q4).
- **Duplicate orders.** Two orders from one phone with the same items within 30 minutes are flagged. On the newer one, staff merge it into the older (one order with both orders' lines and one delivery charge), cancel it as a duplicate, or dismiss the flag. The manual order screen warns before it saves one.
- **The call queue** (Orders → Call queue).
  - New COD orders wait there to be called. Staff tap Call, the order is theirs for 5 minutes, and the panel shows the call script in the order's language.
  - Staff record one outcome per call: confirmed, no answer (due again in an hour, unreachable after 3), call back at a chosen time, wrong number (optionally blocked), or cancelled with a reason.
  - Every cancel now has a reason code, which the score counts. The dashboard shows the confirmation rate.
  - Two staff never call the same order at once.
  - Off by default: auto-confirming trusted phones (Q10) and cancelling unreachable orders (Q8).
- **The SMS link** (off by default, Q9). With the store's own SMS gateway, a new COD order can text the shopper a link. The link page shows the order (never the street), with Confirm and Cancel. A risky phone's confirmation is noted and the store still calls. Links last 48 hours, only while the order is pending, and staff can send one again twice.
- **Incomplete orders** (Orders → Incomplete orders). Once a shopper types a valid phone at checkout, the checkout is saved as they type, with a notice and **Don't save** next to the field (Q5).
  - Staff see the record after the store's delay (30 minutes by default), call, note it, dismiss it, or tap Create order. The manual order screen then starts with the shopper's cart, contact and address, and the order counts as a website order.
  - A shopper who comes back and orders closes the record themselves.
  - Records are kept 30 days at most, deleted when a customer is anonymized, exported and purged with the store, and never used to send anything (Q7).
- **Reports → Sales recovery:** incomplete orders saved, called and converted; the confirmation rate and time to confirm; cancels by reason; delivery by score band, which will set the threshold (Q4); and duplicates.
- **Settings → Order confirmation** holds all of it: risky phones, duplicates, the queue, the script with a preview, the SMS link and incomplete orders.
- **The demo stores** get repeat customers with different scores, cancels with reasons, a short queue and three incomplete orders.
- **The privacy template** gains a paragraph on saved checkouts, in both languages.

**What the owner should know:**

1. **Nothing turns on by itself except what is harmless** (plan §11). The score shows, duplicates are flagged, pending COD orders wait in the queue, and incomplete checkouts are saved with the notice. There is no threshold, no auto-confirm, no auto-cancel and no SMS link until a store chooses them.
2. **Running the new E2E flow locally found a real bug before any preview:** the storefront's checkout saves and the link page called the store's `/api` with a `/v1/store` prefix, so they reached a 404. The API's integration tests had passed, because they call the API directly. It is fixed, and a test now fails if a store script's route has the prefix (§2.1).
3. **The security review found one medium problem and one small one, both fixed** (§2.1). Any role that reads orders, a viewer included, could look up whether some other phone number had ordered from the store. The lookup now needs `customers.read`.
4. **The E2E can't open a real SMS link on a preview.** The plan expected the dev SMS outbox, and previews don't have one. The flow opens the link page with an unknown code; the API's tests answer links; and a link was confirmed through the storefront by hand locally (§2).
5. **Waiting on the owner** (§5): the legal review's wording for the checkout notice and the privacy paragraph (Q5); the pilot stores' call scripts (Q3); and, for the SMS link in production, `CREDENTIALS_KEY` and a store's SMS gateway (Q9).

## 1. What was built

| Plan step | Commit | What |
| --- | --- | --- |
| 0 | `0fd4e16` | The plan with the owner's answers |
| 1 | `1d3afba` | `shared` + `db`: the settings, cancel codes, flags, `incomplete_orders` and `order_confirmations`, history's `confirmation` machine, `confirm_request`, the cleanup, `STORE_TABLES` and the export's deny list (migrations 0040–0041) |
| 2 | `def5951` | `core/fraud`: the score in one grouped query, risky and trusted, the snapshot in `placeOrder`; the score in the order, customer and manual order APIs |
| 3 | `c2f697b` | `admin`: the score badge and risk panel; Settings → Order confirmation (risky phones) |
| 4 | `7402838` | Duplicates: the check at placement and in the manual order preview; merge, cancel and dismiss; the banner and the list filter |
| 5 | `9a417fc` | The queue: claims, outcomes, retries, unreachable, cancel codes everywhere, auto-confirm |
| 6 | `d99bfc4`, `dd62cb1` | `admin`: Orders → Call queue with the call panel and script; the dashboard's figures |
| 7 | `2da8852` | The SMS link: the code, the message, the link page and its routes |
| 8 | `9147e97` | Incomplete orders: checkout's saves and notice, the routes, closing records in `placeOrder` |
| 9 | `be79c58` | `admin`: Orders → Incomplete orders, and creating an order from one |
| 10 | `2fabf42` | Reports → Sales recovery; the demo stores' sample data; the privacy template's paragraph |
| 11 | `55e21a1` | CI: the E2E flow, the CPU step's routes, Lighthouse on the link page; the storefront scripts' route fix |
| 12 | `46ca4d9` | Fixes from the security review |
| 13 | This commit | This report; PLAN.md's and the README's status |

## 2. Acceptance criteria

The owner accepted the four the plan proposed (Q2).

| Criterion | Status |
| --- | --- |
| 1. A shopper who enters a valid phone at checkout and leaves appears under Incomplete orders after the store's delay. Staff create an order from it in one click, and the record shows it was converted. A shopper who comes back and finishes closes the record | **Met in tests and in the local E2E.** The integration tests: one record per cart, **Don't save** deletes it and refuses later saves, the delay, `converted` in the order's own transaction, `recovered` when the shopper finishes or orders from the same phone, the 30-day cleanup and anonymization. The E2E (`recovery.spec.ts`): a shopper fills in checkout, sees the notice and leaves; staff find the record, tap Create order, see the cart and contact filled in, save it, and the record moves to "Made into orders". **In the pilot:** the Sales recovery report's figures |
| 2. Every order, the manual order screen and the queue show the phone's score and the counts behind it. A phone below the store's threshold gets the store's rule at checkout, and a test proves it | **Met in tests.** The score's unit tests (counts, rounding, new phones, what counts as not received), and integration tests for the advance and the code on a risky phone, for each of the three reasons. The E2E sees the score go from new to 0% after a fake cancel. **In the pilot:** the delivery-by-score table sets the threshold (Q4) |
| 3. A COD order goes through the queue: one outcome per call, retries at the store's interval, and two staff never call the same order. With the SMS link on, a shopper confirms or cancels from their phone. The dashboard shows the confirmation rate | **Met in tests, and the link checked by hand.** The integration tests: two claims at once (one wins), each outcome, retries, unreachable at `maxAttempts`, `cancelUnreachable`, the link's single use, and an expired link, a used one and another store's all failing the same way. The E2E calls an order (no answer, then confirmed from Later) and cancels a second one as fake. **The link:** the E2E opens the link page with an unknown code; a code written into a local store's database opened the order through the storefront, and Confirm confirmed it (`confirmed_via = link`). **In the pilot:** the confirmation rate and time to confirm, before and after the queue |
| 4. Two orders from one phone with the same items within the store's window are flagged. Merging leaves one order with both orders' lines, and stock and history right | **Met in tests and in the local E2E.** The integration test merges and checks `inventoryDrift` stays empty, one delivery charge, the history on both orders, and the blockers (shipped, not open, paid). The E2E merges two identical orders from the order's banner and sees one order with quantity 2 and the other cancelled as a duplicate |

### 2.1 Security review

The phase was reviewed against PLAN.md's security baseline: authorization on every new admin and store route, the link code, the saved checkout, rate limits, validation, the export and purge, logs and third-party tags. What it found:

| Finding | Severity | Fix |
| --- | --- | --- |
| `GET /v1/admin/phones/{phone}/risk` needed only `orders.read`. A viewer, who has no `customers.read`, could type any number and learn whether it had ordered from the store and how those orders went | Medium | The lookup needs `customers.read` too (`46ca4d9`). Viewers still see the score on the orders they can read. The manual order screen and the customer page, which use the lookup, already needed it |
| A malformed cursor on the incomplete orders list was a database error, a 500 | Low | It is the first page now (`46ca4d9`) |

Found on the way, not a security bug:

- **The storefront's checkout saves and link page reached a 404** (`55e21a1`). The store's `/api/*` is the API's `/v1/store/*`, and the scripts repeated the prefix. The link page's "this link has expired" was what a 404 shows, so it looked right. A test now reads every store script's routes.

**Accepted as they are:**

- **Anyone can type someone else's phone at checkout,** and the store may call that number. That is the same as today's phone orders. The record holds only what was typed, and the notice says what is saved.
- **The saved checkout's email isn't checked as an email,** since it is saved while still being typed. It is shown as text, and the manual order checks it when the order is saved.
- **Auto-confirm trusts the phone, not the address** (Q10, off by default). Someone who knows a trusted customer's number could have an order confirmed without a call. The courier still collects the cash, so the store's loss is a return, and the score then counts it.
- **Many shoppers can share one IP address on mobile networks.** The link page's lockout (5 wrong codes an hour) and the save limit (30 an hour) are per IP, so one person could lock others out for an hour. A shopper who can't use the link still gets the call, and saves that are refused never stop the checkout.

**Checked, and found fine:**

- Every new admin route checks its permission in the route and again in the service: the queue and outcomes need `orders.write`, blocking a phone `settings.write`, and incomplete orders `customers.read`. The call panel and the queue show the phone only to roles with `customers.read`.
- Both new tables have forced RLS and are in the isolation suite through the API and as raw SQL. Another store's incomplete order, confirmation or link code finds nothing.
- The link code: 10 base62 characters (about 59 bits) from an HMAC keyed by `AUTH_SECRET` under its own label, stored only as a SHA-256 hash, 48 hours, while the order is pending. It travels in the page's fragment and the POST body, so neither request logs nor `Referer` carry it. The page clears the fragment before the store's tags load (after `load`, and only with consent). Answering locks the row, so two answers at once use it once. Message logs keep no SMS text.
- The save route takes only the cookie's own cart, validates with zod, refuses a cart that opted out, and saves the cart's lines from the server, never the browser's.
- Shoppers can't pass `incompleteOrderId`: only the manual order input takes it.
- The export omits `link_hash`; the purge test seeds both tables and leaves zero rows.
- The score never reaches shoppers; a risky one sees the same wording as any shopper who must pay first or enter a code.
- No new dependencies. `pnpm audit` reports 3 moderate and 3 low advisories, all in build tooling (`drizzle-kit`'s esbuild, and `vite-plugin-pwa`'s workbox), none at CI's `high` level.

### Tests

| Package | Tests |
| --- | --- |
| `shared` | 367 (Phase 5B: 354) |
| `db` | 905, 91 skipped (883, 88 skipped) |
| `core` | 273 (236), 36 of them in `recovery.test.ts` |
| `providers` | 50 (50) |
| `api` | 195 (185) |
| `admin` | 20 (18) |
| `storefront` | 40 (27), with the scripts' routes check |
| `scripts` | 23 (23), the export and purge with both new tables |

**E2E, locally** against `wrangler dev` with a seeded run: the new sales recovery flow passes at a phone and a desktop viewport, with axe and the CSP check on its 11 new screens. The orders and returns flows pass before it, and smoke passes. Locally, the storefront flow's English demo store has no catalog, so its first step fails there for that reason. **On the preview:** after the pull request's `full-preview` run.

## 3. Measurements

From a local build of this branch. Lighthouse and the CPU step run on the preview.

| Measure | Result | Budget |
| --- | --- | --- |
| API Worker | 986 KiB gzip (Phase 5B: 966) | 3 MiB (32%) |
| Storefront Worker | 332 KiB gzip (331) | 3 MiB (11%) |
| Admin, JavaScript before sign-in | 134 KiB (Phase 5C: 134) | 150 KiB (90%; CI warns above 85%, as since 5B) |
| Store JavaScript on checkout and the link page | Under 50 KB gzip (the E2E's check) | 50 KB |

**On the preview,** filled in after the run:

- **Lighthouse** adds the link page (`/c`). Checkout's budgets are expected unchanged with the notice.
- **The CPU step** adds the checkout save, the queue, a claim and an outcome, and the incomplete orders list. The link page isn't in it, for the same reason as the E2E (§2).

## 4. Free-tier impact

As planned (plan §9). The new requests are 1–3 saves for each checkout started, and the link page's two calls for each link sent. `placeOrder` gains one query, the duplicate check (the score's query replaces Phase 5A's), and the list pages one each. Nothing runs on a timer; the daily cleanup gains one delete. The SMS link uses the store's own gateway and is off by default.

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **The legal review's wording** for the checkout notice ("{store} saves your number and cart, so they can help if you don't finish", and its Bangla) and the privacy template's paragraph on saved checkouts (Q5). If the review wants consent before saving, it becomes a checkbox, off by default.
2. **The pilot stores' call scripts** (Q3). Until then each store has the default script in both languages, and can edit it.
3. **The score threshold,** from the pilot's delivery-by-score table (Q4).
4. **For the SMS link in production:** `CREDENTIALS_KEY` (Phase 5A), and a pilot store's SMS gateway.
5. **Opening the pull request.** The owner chose to wait for the Actions reset, but with the repository public the minutes are free now. Its first `full-preview` run fills in §2's and §3's preview results. It needs the `db-branch` label for migrations 0040–0041.

### Not built yet, or smaller than planned

- **The E2E can't answer a real link on a preview,** since previews have no dev SMS outbox. The API's integration tests answer links, and one was confirmed by hand locally. A dev SMS outbox like the dev mailbox would close the gap.
- **The CPU step doesn't measure the link page,** for the same reason.

### Decisions that differ from the plan

- **The link is `/c#code`.** The code is the fragment, so it never reaches a server's logs, and the page posts it in a body: `POST /v1/store/confirm/view` and `POST /v1/store/confirm`.
- **Checkout sends the whole draft on each save,** only when something changed, rather than just the changed fields.
- **`robots.txt` doesn't disallow `/c`.** `Disallow: /c` would also block `/categories` and `/collections`, and the page has nothing to index without a code.
- **The screen is "Call queue"** under Orders, where the plan said Orders → Confirm.
- **The E2E confirms the earlier flows' pending orders** before it starts, so the queue holds only its own. It also stops the browser following `tel:` links, which open the browser's prompt for an app on a machine without a phone.
- **The phone lookup needs `customers.read`** (the security review). The plan said viewers see scores, which they still do on orders.

### Lessons for later phases

- **Run the new E2E locally before the preview.** Integration tests that call the API directly can't see a client calling the wrong path, and an error page can look like the right answer.
- **A screenshot script that swallows errors hides broken clicks.** The earlier screenshots used `.catch(() => {})` on clicks; the E2E found the `tel:` prompt instead.
- **A lookup by an identifier the caller types is a customer lookup,** however little it returns.
