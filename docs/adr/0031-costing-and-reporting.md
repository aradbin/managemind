# ADR 0031: Back office: moving average per variant, sales at delivery, facts on their own day, summaries refreshed for 7 days

- Status: Accepted
- Date: 2026-10-26
- Plan: phase-8-plan §3.3, §3.5, §3.8, §3.9, Q4, Q7, Q10. Code: `packages/shared/src/back-office/`, `packages/db/src/schema/back-office.ts`, `packages/core/src/purchasing/`, `packages/core/src/reports/`
- Builds on: ADR 0002 (row-level security), ADR 0013 (free plan), ADR 0027 (jobs in Actions)

## Context

Phase 8 gives a store purchasing, stock counts, expenses and profit reports. The reports have to agree with an accountant's hand calculation to the poisha, and they have to stay cheap on the Free plan:

- 10 ms of Worker CPU per request;
- Neon's 100 CU-hours a month, which a query that wakes the database costs;
- 0.5 GB of storage.

So the cost of each unit sold, when a sale counts and how the numbers are summed are decided once, here.

## Decision

1. **One moving weighted average cost per variant,** across its locations (Odoo's AVCO).
   - A receipt of `q` units at landed cost `c`, onto `Q` units at `C`, gives `(Q × C + q × c) / (Q + q)`, rounded to the poisha. When `Q` is zero or below, or there was no cost, it gives `c`.
   - Sales, negative adjustments and counts leave the cost as it is. A restocked return comes back in as a receipt at its order line's cost.
   - A cost typed by hand, or set by the import, is a correction.
   - Every change is a row in `store.cost_changes`, which the app may only append to.
2. **Other costs are landed by value.** A PO's transport, labour and agent's fees are spread over its lines in proportion to their value, as each receipt arrives (Q4). The rounding remainder goes to the largest line, so the shares sum exactly.
3. **An order line's cost is frozen when its first unit ships,** from the average then (Q10). Stock leaves at shipment, so the average then is what those units cost. Placement no longer sets it.
4. **A sale counts when its goods are delivered:** the shipment's `delivered_at`, in Dhaka time. Every other fact is also booked on its own day:
   - a return on the day it was received back;
   - a refund that isn't a return on the day it was processed;
   - an expense on the day it was spent.
   A past day therefore changes only when something is corrected, never because a later event arrives.
5. **Summary tables, refreshed nightly for the last 7 days.**
   - `store.daily_sales`, `store.daily_product_sales` and `store.monthly_stock_values` are deleted and rewritten by the daily batch for yesterday and the 6 days before it, per store.
   - Today is computed live, so a report is never a day behind.
   - A test computes every report both ways and requires them to be equal.
   - The refresh runs inside each store's own transaction (`withTenant`), as the app role, like the usage rollup. The tables are ordinary store tables with forced row-level security. The app may select, insert and delete their rows, never update them. The plan's `mm_system` writer would have needed read policies on every source table, so no cross-store function writes them.
6. **A count's difference is measured at the moment each line was counted:** on hand now, less the movements after `counted_at`. Sales during the count are therefore neither undone nor counted twice, which the append-only ledger makes exact.
   - A count of more than 500 lines is applied 500 lines a message on the delayed-work queue. It waits in the state `applying`, and goes back to `review`, marked, if a batch keeps failing.
   - Differences worth more than the store's threshold need `catalog.cost` to apply (Q7).
7. **Receipts are never edited.** A wrong receipt is corrected with an adjustment and a cost correction, as a stock ledger is. Supplier balances and dues are derived from receipts and payments every time they are read, with no stored running balance to drift.

## Consequences

- **Profit per product reflects landed cost,** which matters most for imported goods.
- **A cost changes only by a receipt, a return or a correction,** each with its reference, so an accountant can follow any cost back to where it came from.
- **A correction older than 7 days** reaches the summaries only through a rebuild (Platform → Store, or the Store jobs workflow's `reports_backfill`).
- **Stores that never use purchasing** keep their typed costs, recorded as corrections. The average never moves for them.
- **Rounding to the poisha per unit** loses less than a poisha per unit per receipt. The valuation report says so once, rather than tracking it.
