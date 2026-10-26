# Phase 7 report: Couriers and fulfillment

- Date: 2026-10-25
- Plan: `docs/phases/phase-7-plan.md` (approved with every recommendation in §14)
- Branch: `claude/bold-shannon-s6t57c`, one commit per plan step (§1), and #75's preview fixes
- Pull request: #75, with the `db-branch`, `full-preview` and `narrow-preview` labels (§2). Merged on Oct 25 and deployed: migrations 0042–0043 applied, the two courier polls' Cron Triggers added, and the deploy's smoke, shop API and cache checks passed

## Summary

Phase 7 is built. Stores can connect Steadfast, Pathao and RedX, book parcels from an order or a selection of orders, and follow them by themselves. Delivery settles the COD for what the courier collected. Parcels that come back wait for staff to receive them. The courier's payouts are reconciled against what it collected.

- **Connecting a courier** (Settings → Couriers): keys checked with the courier before they're saved in the vault (ADR 0024), the pickup store for Pathao and RedX, and the webhook URL and secret to paste into the courier's panel.
- **Booking.**
  - From the order page, through a sheet that shows what the courier will get: the address, items, the COD amount, the courier's area, the weight and a note.
  - From the order list, for a selection, in the background.
  - A retry never makes two parcels: a booking with no answer is *unsure*, and the next try looks for it by invoice first, or asks staff to check the courier's panel (Q7).
- **Status by itself.**
  - The courier's webhook names a parcel, and the courier is asked about it with the store's keys.
  - The shipment walks to the courier's state (booked → picked up → in transit → delivered), with stock sold at pickup and COD settled at delivery for the amount collected.
  - A different amount, or a partial delivery, flags the order.
  - Parcels quiet for 6 hours are polled at 13:17 and 19:17 in Dhaka (Q14).
- **Returns.** A courier's failed delivery marks the shipment failed, which the score counts. A parcel the courier returned waits under Orders → Courier returns until staff tap Received, which restocks it (Q9).
- **Areas.** A weekly workflow fetches Pathao's and RedX's area lists with the platform's own accounts and matches our areas by name within each district. Super admins match the rest under Platform → Courier areas. Steadfast reads the address and needs none.
- **Reconciliation** (Reports → COD reconciliation): for a courier and delivery dates, what was collected, charged, due, paid out and outstanding, and every difference.
  - Payouts come from the courier's own "paid" status, an imported statement, or a record by hand.
  - Importing or recording one needs the new `payments.reconcile` permission, for owners and managers (Q13).
- **The tracking page** shows the courier's updates in the shopper's language. **The dashboard** counts parcels waiting for pickup, on their way, coming back and back.
- **A test courier** stands in for real ones on previews and locally, never in production. Its parcels move from the order page.

**What the owner should know:**

1. **None of the three adapters has met its courier.** They are built from the couriers' own SDKs and community packages, with tests on recorded responses (§2). Until each runs against a sandbox or a real account, its status words, field names and webhook headers are best guesses. **Don't offer a courier to a pilot store until its check has passed** (§5).
2. **In production, couriers wait for `CREDENTIALS_KEY`** (ADR 0024), like online payment and SMS.
3. **Nothing changes for a store until it connects a courier.** Manual shipments, Mark shipped and the Steadfast and Pathao export files work as before. Auto-booking and auto-restock are off (Q8, Q9).
4. **Running the new E2E flow locally found two accessibility faults, fixed before any preview** (§2): a button inside a definition list, and selects whose wrapping labels gave them their options' text as their name.
5. **The security review found two small problems, both fixed** (§2.1).
6. **The whole E2E suite no longer fits the Free plan's CPU allowance on a preview** (§3.1). Through Hyperdrive and one flow at a time, Cloudflare started stopping requests about 12½ minutes into the E2E. #75 passed with the new `narrow-preview` label: the smoke tests and the courier flow at both viewports, Lighthouse and the CPU step. The older flows last passed on Phase 6's preview. **Workers Paid would let the whole suite run again** (§5).

## 1. What was built

| Plan step | Commit | What |
| --- | --- | --- |
| 0 | `b8509a5` | The plan, approved |
| 1 | `150ebb0` | `shared` + `db`: `booked` and `in_transit` states and `shipmentPath`; courier settings and credential kinds; flags and the staff-only return reason; the shipment columns, `shipment_events`, payouts, `ref` area tables and `app.courier_poll_due` (migrations 0042–0043); ADR 0030 |
| 2 | `8b200b7` | `providers/couriers` (the interface, the test courier, Steadfast); `core/couriers`: connecting, two-transaction booking, area resolution, `applyCourierUpdate`, COD for the amount collected; the order and tracking views |
| 3 | `f025214` | `api`: the webhook route, bulk bookings and polls on the delayed-work queue, two Cron Triggers, the admin routes, the test courier's dev route |
| 4–5 | `6b56d69` | Steadfast (with step 2); the admin's Settings → Couriers, the booking sheet and courier panel, Orders → Courier returns; the tracking page; dashboard counts in the API |
| 6–8 | `d63bf20` | The Courier areas workflow and name matching, Platform → Courier areas; the Pathao and RedX adapters |
| 9–10 | `0f06674` | Bulk booking from the order list; auto-booking on confirm; payouts, the statement import and Reports → COD reconciliation; `payments.reconcile` |
| 11 | `e8f2290` | Demo parcels, the provider-outage runbook, the README |
| 12 | `0f64b0d` | The E2E flow, the CPU step's routes; two accessibility fixes |
| 13 | `8a4b6d4` | Fixes from the security review |
| — | `70b9aaf` | Courier rows on the dashboard |
| 14 | `1e2275f` | This report; PLAN.md's and the README's status |
| — | `196207d` | Preview: a full run goes through Hyperdrive again (ADR 0011, amended Oct 25) |
| — | `d144535` | E2E: the returns flow sends a stopped state change again |
| — | `f9905a3`, `60e42f3` | E2E: one flow at a time on a preview |
| — | `6ea9411` | Preview: the `narrow-preview` label |
| — | `409981c` | E2E: the courier flow renews the kept dashboard before reading it |
| — | `26f5e59` | The preview's results in this report |
| — | This commit | Merged and deployed |

## 2. Acceptance criteria

The owner accepted the five the plan proposed (Q2).

| Criterion | Status |
| --- | --- |
| 1. One-tap and bulk booking; a retry never makes two parcels | **Met in tests and the local E2E.** Integration tests: the claim (a second tap finds it taken), a refusal freeing the shipment, an unsure booking keeping its invoice and refusing another courier, a new invoice after letting one go. The E2E books one order from its sheet and two in a bulk booking through the queue. **Against real couriers: waiting for credentials** (§5) |
| 2. Webhooks move shipments; forged ones change nothing; quiet ones are polled; delivery settles COD for the amount collected | **Met in tests and the local E2E.** A webhook without the secret, with a wrong one, or naming another store's parcel changes nothing (API tests). Every update kind, repeated and out-of-order updates, and the poll's list across stores (core tests). Delivered settles COD; less collected flags `cod_difference` and leaves the order partly paid. The E2E moves a parcel to delivered through the test courier's webhook and sees the order delivered and paid |
| 3. Failed and returned parcels flow into Phase 5A's flows; partial deliveries are flagged | **Met in tests and the local E2E.** Returning fails the shipment with the courier's message; returned waits; Received restocks with `inventoryDrift` empty. The E2E receives a returned parcel under Courier returns |
| 4. Reconciliation matches the courier's statement | **Met in tests, on test data.** Core tests: a statement's preview (matched, not ours, already paid), recording it once, the report's outstanding equal to due less paid out, deleting a payout, and a courier's paid status. The E2E records a payout and sees it in the report. **With a real statement: waiting for samples** (§5) |
| 5. Every area matched or under review; an unmatched area asks staff | **Met in tests.** The sync stores, retires and matches by name within the district (taking only a single candidate, never overwriting a manual match, never retiring on an empty answer), and the review lists the rest with suggestions. Booking an unmatched area refuses until staff pick the courier's area. **With the couriers' real lists: waiting for the platform's accounts** (§5) |

**On the preview** (#75, `409981c`, narrowed): the smoke tests and the courier flow pass at a phone and a desktop viewport through Hyperdrive, 11 tests in 1.8 minutes. Its first narrowed run found one fault in the test itself: the dashboard step read the copy the browser had kept since sign-in, under a minute before (phase-4-plan §3.17 lets it keep the dashboard 60 seconds), and saw no booked parcels. The step now renews that copy first, as the dashboard's own refetch does.

**Run locally** against `wrangler dev` with a seeded run, the courier flow passes at a phone and a desktop viewport, with axe and the CSP check on its 10 screens. On the way it found two accessibility faults, fixed in `0f64b0d`:

- **The webhook's definition list held a button.** Axe's `definition-list` rule refused it.
- **Selects wrapped in their labels.** The courier selects on the reconciliation page, the payout dialog, the bulk booking and the area review had their options' text in their accessible name. They are now labelled by `id`.

### 2.1 Security review

Reviewed against PLAN.md's security baseline: the webhook, every new admin and platform route, the credentials, the queue messages, isolation, logs and the dev route.

| Finding | Severity | Fix |
| --- | --- | --- |
| The webhook read the whole body before checking its size, so a large post cost memory before the 413 | Low | Refused from `Content-Length` before reading, and checked again after (`8a4b6d4`) |
| A Pathao token that couldn't be sealed back (too long for the vault, say) would fail the booking it was renewed for | Low | Logged and asked for again next time (`8a4b6d4`) |

**Accepted as they are:**

- **RedX's webhooks aren't signed.** Anyone who knows a store's ID can make the API ask RedX about a parcel. Each request costs one call, is rate-limited per IP (1,200 an hour), and changes nothing the courier doesn't confirm.
- **A webhook to a store without that courier answers 404, and with it 401 or 200.** Someone who knows a store's ID could tell whether it connected a courier. The store's ID isn't public, and that's all it tells.
- **Steadfast's answers carry no amounts**, so after its Bearer check the webhook's own COD amount is used, as planned (§3.5). A wrong amount is flagged as a difference, never hidden.
- **Couriers get the shopper's name, phone and address**, which the store privacy template already says (Phase 5B).

**Checked, and found fine:**

- **Every route checks its permission, then again in core.**
  - `orders.write` to book, cancel and sync; `settings.credentials` for keys and the webhook secret; `payments.reconcile` for payouts.
  - Platform matches need super admin, and the review support.
  - Another store's order, shipment or payout is a 404 (the isolation suite, extended).
- **The three new store tables have forced RLS**, and are in the isolation suite through the API and as raw SQL. The poll's function reads only IDs, as `mm_system`.
- **No secret in a URL.** The webhook secret travels in a header, is sealed with the store's keys, and is shown only to `settings.credentials`. Rotating it is audited.
- **The test courier can't reach production.** Its kind is refused by the routes, its connection isn't opened, and its dev route answers 404.
- **Couriers' hosts are fixed in code** (sandbox or live only), so nothing a store types becomes a URL.
- **Bulk and auto-bookings rebuild the staff member's permissions when they run.** A removed member's booking does nothing. Auto-booking acts as the system with `orders.write` only.
- **Logs keep consignment IDs, never names, phones or addresses.**
- **No new dependencies.** `pnpm audit` reports the same 3 moderate and 3 low advisories as Phase 6, all in build tooling.

### Tests

| Package | Tests |
| --- | --- |
| `shared` | 369 (Phase 6: 367) |
| `db` | 937, 95 skipped (905, 91 skipped) |
| `core` | 286 (273), 13 of them in `couriers.test.ts` |
| `providers` | 69 (50), 19 in `couriers.test.ts` |
| `api` | 203 (195), 8 in `couriers.test.ts`, and the isolation suite's new routes |
| `admin` | 20 (20) |
| `storefront` | 40 (40) |
| `scripts` | 27 (23), the area sync |

## 3. Measurements

Bundles from CI's build of `409981c`; the rest from #75's preview run on it.

| Measure | Result | Budget |
| --- | --- | --- |
| API Worker | 1,014 KiB gzip (Phase 6: 986); startup 153–234 ms | 3 MiB (33%) |
| Storefront Worker | 332 KiB gzip (332) | 3 MiB (11%) |
| Admin, JavaScript before sign-in | 135 KiB (134) | 150 KiB (90%; CI warns above 85%, as since 5B) |

**Lighthouse:** all nine storefront pages within their budgets (LCP, CLS, TBT, accessibility, SEO).

**CPU** (the preview's CPU step through Hyperdrive, ms, no request stopped):

| Route | Requests | p50 | p90 | Max |
| --- | --- | --- | --- | --- |
| `POST /v1/admin/orders/{id}/booking/preview` | 5 | 23 | 50 | 50 |
| `POST /v1/admin/orders/{id}/booking` (test courier) | 5 | 64 | 144 | 144 |
| `POST /v1/webhooks/couriers/{courier}/{store}` | 5 | 22 | 59 | 59 |
| `GET /v1/admin/reports/cod` | 10 | 14 | 22 | 30 |
| `GET /v1/admin/orders/{id}` (now with courier events) | 39 | 20 | 69 | 79 |
| `POST /v1/store/checkout/orders` (placeOrder) | 15 | 78 | 106 | 124 |

Booking is the heaviest new route, with two transactions around the courier's call; a real courier's call adds wall time, not CPU. The other routes are close to Phase 6's numbers.

### 3.1 The Free plan's CPU allowance on previews

Four full runs of #75 failed before the narrowed one passed. Workers Observability recorded each failure's empty 503 as `outcome: exceededCpu`, not as a lost connection. So the "empty 503s" of phase-5b-report §3 were most likely the same thing.

| Run | Connection | Workers | Passed | First request stopped |
| --- | --- | --- | --- | --- |
| `1e2275f` | direct | 2 | 22 / 31 | about 11 min into the E2E |
| `196207d` | Hyperdrive | 2 | 25 / 31 | about 8 min |
| `d144535` | Hyperdrive | 2 | 26 / 31 | about 8 min |
| `60e42f3` | Hyperdrive | 1 | 27 / 31 | about 12½ min |

- **Requests go well over 10 ms without being stopped**, on previews and in production (per-route medians up to 42 ms, maxima near 200 ms), until a Worker has spent a lot of CPU. Then Cloudflare stops requests at exactly 10 ms, in bursts.
- **Halving the rate delayed the bursts; it didn't stop them.** That fits an allowance per Worker over a window of time, which the whole suite uses up.
- **The same requests, sent at the same time** to this preview and to a master preview (#61), used about the same CPU. Only this one, after its runs, was stopped. So the code didn't get heavier; the suite got longer.
- **Production stopped no request in the 7 days measured**, at its traffic.

## 4. Free-tier impact

As planned (plan §9):

- **Webhooks:** about 6 per parcel. Each one is a courier lookup and one transaction.
- **Bookings and polls:** batches on the existing delayed-work queue (no new queue).
- **Two more Cron Triggers** (3 of the account's 5).
- **The weekly area sync** costs about 3 Actions minutes.
- **No KV writes.**

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **Courier credentials, to check each adapter** before any store is offered it:
   - Steadfast: a merchant account, with test parcels cancelled before pickup (Q3).
   - Pathao: sandbox keys.
   - RedX: a sandbox token.

   Each check confirms the status words, the field names, and the webhook's headers. That includes Pathao's signature and whether its panel asks for a reply value; the settings page has a field for it.
2. **The platform's own Pathao and RedX accounts**, as the GitHub secrets in the README, for the weekly Courier areas workflow. Until then, bookings with them ask staff to pick the courier's area.
3. **A sample payout statement from each courier**, to check the import against it. Staff choose the columns, so it works with any layout meanwhile.
4. **`CREDENTIALS_KEY` in production** (Phase 5A).
5. **Workers Paid** ($5 a month): it raises the CPU limit to 30 s and removes Hyperdrive's daily query limit (§3.1). Previews could then run the whole E2E suite again, and production would have the headroom too. Until then, a phase PR uses `narrow-preview`, and a change to an older flow can't be checked on a preview.
6. **Hosts to allow** in the cloud environment for the checks: `portal.packzy.com`, `api-hermes.pathao.com`, `courier-api-sandbox.pathao.com`, `openapi.redx.com.bd`, `sandbox.redx.com.bd`.

### Not built yet, or smaller than planned

- **The reconciliation report has no CSV or Excel export** yet (plan §3.7). Its tables can be copied meanwhile.
- **Platform → Courier areas shows no usage counts or staff picks.** Both are other stores' data; the review shows the closest names in the district instead.
- **`courier-sandbox.yml`**, the manual workflow to book, read and cancel one parcel on each sandbox (plan §10), waits for the credentials it needs.
- **Steadfast's parcel found by invoice has no consignment ID** until Steadfast's webhook gives it, since its status call doesn't say it. Its status is asked by invoice meanwhile.

### Decisions that differ from the plan

- **The webhook URL uses the admin host**, as SSLCommerz's IPN does (`ADMIN_HOST`), rather than a separate API host.
- **Couriers are in every plan.** No plan feature gates them, unlike the store's own gateway and SMS.
- **The demo stores' sent orders become Steadfast parcels** with made-up consignments and no tracking link, rather than test-courier parcels.
- **Pathao's webhook reply value is a store setting**, copied from Pathao when it asks, rather than a value in code.

### Lessons for later phases

- **Run the new E2E locally before the preview, again.** It found two accessibility faults that every other test passed.
- **A label wrapping a select names it with its options too.** Label selects by `id`.
- **A toast from the step before can satisfy the next step's check.** Wait for the state itself (`expect.poll`), not for a message.
- **An empty 503 from a Worker: ask Workers Observability for its `outcome` first.** `exceededCpu` and a lost connection look the same from the browser. This report's first comment on #75 blamed the connection.
- **A page the API lets the browser keep can show a test old data.** Renew it the way the app does before checking it.
