# Phase 8 report: Back office

- Date: 2026-10-26
- Plan: `docs/phases/phase-8-plan.md` (approved Oct 26 with every recommendation in §14)
- Branch: `claude/magical-babbage-5ykded`, one commit per plan step (§1)
- Pull request: #85, with the `db-branch`, `full-preview` and `narrow-preview` labels (§2). Merged on Oct 27 and deployed: migrations 0044–0047 applied, and the deploy's smoke, shop API and cache checks passed

## Summary

Phase 8 is built. A store can buy from suppliers and know what it owes them, count its stock while it keeps selling, record what it spends, and see what it actually made: sales, cost of goods, gross and net profit, what the stock is worth, supplier dues and the COD still out, all exportable to Excel and CSV.

- **Purchasing** (Inventory → Purchase orders, Receive stock, Suppliers):
  - suppliers with a khata-style ledger, balances, and dues aged oldest receipt first;
  - purchase orders placed, received in parts, closed or cancelled, with a print view to share;
  - receiving for a PO or without one (a market purchase), with transport and other costs spread over the lines by value, and a payment on the spot;
  - every receipt moves each variant's weighted average cost before the stock goes up, and every cost change is kept in its history.
- **Stock counts and adjustments** (Inventory → Counts, Adjustments):
  - blind counting by scan or by typing, while orders keep shipping: each line's difference is measured at the moment it was counted;
  - review largest value first, recounts, and an approval threshold above which only owners and managers apply;
  - counts over 500 lines are applied 500 at a time on the delayed-work queue;
  - every adjustment, by hand or by count, has a reason, a user and a value, and the list totals them.
- **Expenses** (a new item in the navigation): categories, entries by month with totals, receipt photos, and recurring entries (rent, salaries) that the daily batch posts once each.
- **Reports** (Reports gains tabs):
  - **Sales** by day, week or month, and by product with cost, profit and margin;
  - **Profit**: the statement for a period beside the period before;
  - **Stock**: its value today or at a past month's end, by location and category, and slow movers;
  - **Suppliers**: dues by age, purchases and payments;
  - **Expenses** by category and month;
  - **COD outstanding**, per courier and for the store's own riders, by age;
  - the order list's gross profit column and the dashboard's month so far, for cost holders.
- **Summary tables** filled each night and at the backfill by the same SQL that answers for today, so stored and live figures can't disagree. A store that turns the back office on gets its history filled by the Store jobs workflow; Platform can rebuild a store's after a fix.
- **Imports** of suppliers with opening balances and of past expenses, checked in the browser before anything is saved.

**What the owner should know:**

1. **The accountant's review of the report definitions is still open** (acceptance criterion 5). The plan's §3.8 writes each one down, and §5 of this report lists how the build read the ones the plan left open (partial shipments, refunds that aren't returns, per-order profit). It can be done on the demo store's reports.
2. **The imports were built without the pilot's sample data**, with the columns the plan describes. They should be tried on the pilot's real files before onboarding.
3. **Starter stores don't get the back office** (Q13): its routes answer `feature_not_in_plan`. Growth and Pilot get it, and their history is filled the first night.
4. **An order line's cost is now frozen at its first shipment**, not at placement (Q10), for every store.
5. **The security review found two small problems, both fixed** (§2.1). It also found that **the older order and customer CSV exports** can carry a shopper's text that Excel would run as a formula. That needed its own decision; the owner chose the fix, done on Oct 27 (§5).
6. **A flaky test was fixed on the way:** the search rate-limit test failed when its 31 requests crossed a minute (CI on `8b951f4`). It now holds the clock still.

## 1. What was built

| Plan step | Commit | What |
| --- | --- | --- |
| 0 | `f54cb23` | The plan, approved |
| 1 | `167402b` | `shared` + `db`: permissions, the `backOffice` feature, settings, reasons, the PO and count machines, 15 store tables, `unit_cost` on movements (migrations 0044–0045); ADR 0031 |
| 2 | `1227e5e` | `core/purchasing`: suppliers, POs, receipts with landed cost, the cost rule and its history, payments, balances and ageing; restock at the line's cost; the line's cost frozen at first shipment |
| 3 | `1c5a9b2` | `api` + `admin`: suppliers, POs, receiving, payments, the print view, the variant's cost history |
| — | `a65ad96` | PLAN.md, the README and the plan's build notes |
| 4 | `0695ff9` | Adjustment values and their list; stock counts with the counting and review screens and the queued apply |
| 5 | `51b24fa` | Expenses: categories, entries, receipt photos, recurring entries posted by the daily batch |
| 6 | `8514975` | Summary tables, their refresh and month-end values; the sales and profit reports; the order list's profit column; the dashboard's figures (migration 0046) |
| 7 | `ef58867` | The stock, supplier, expense and COD outstanding reports; Excel and CSV exports |
| 9 | `b19dc62` | The backfill job (migration 0047) and Platform's rebuild; demo data; the onboarding runbook |
| 10 | `324c146`, `2f26f98` | The E2E flow and the CPU step's routes |
| 11 | `f618413`, `8b951f4` | Fixes from the security review |
| — | `7e01c4b` | The search rate-limit test holds its clock (§2) |
| 8 | `33a0997` | Supplier and expense imports, after step 11 as the plan allows, since the pilot's data hasn't come |
| 12 | `9da1885` | This report; PLAN.md's, the plan's and the README's status |
| — | `4bb7e50` | The CPU step's receipts pay nothing (§2) |
| 12 | `84cc1c4` | The preview's results and measurements in this report |
| 12 | `c806304` | The exports opened in LibreOffice (§2) |
| — | `db3e524` | Merged |
| — | This commit | Deployed |

## 2. Acceptance criteria

| Criterion | Status |
| --- | --- |
| 1. A three-line PO received in two parts: stock, average cost and the supplier's balance as by hand; no drift | **Met in tests and the local E2E.** Integration test: three lines, two partial receipts with transport spread by value, the averages and the balance to the poisha, `inventoryDrift` empty. The E2E receives a PO in two parts with a bKash payment and checks the landed cost and the balance. **In the pilot:** one month against a store's khata |
| 2. A count while selling applies only the real differences; every adjustment has a reason, a user and a value, and the list totals them | **Met in tests and the local E2E:** the integration test counts three, with a sale before one line was counted and another after, and since Oct 27 also the plan's 50, with sales before and after counting (§5); the E2E counts two with an order shipped between them. Batching is a separate test of a 501-line count, stopped part-way and finished. **In the pilot:** one full count per store |
| 3. A monthly recurring expense posts once, also when the batch runs late or twice; edits and deletions audited | **Met in tests:** a doubled run posts nothing more, a run three days late posts each missed day once; the audit keeps the old values |
| 4. Reports match hand totals; summaries equal live; exports open in Excel with Bangla | **Met in tests and in LibreOffice;** Excel itself not yet. A hand-computed fixture over three Dhaka days (a line delivered in two parts, a sale without a cost, an 11:30 pm delivery, a failed delivery, a return, a refund that isn't a return, a loss, an expense) checks every daily figure, the profit statement, products, per-order profit (adding up to the statement) and the dashboard. The summaries equal the live SQL. Stock, slow movers, suppliers, expenses and COD outstanding each have a hand-computed test. The exports were opened as files: the `.xlsx` with openpyxl (numbers as numbers), the CSV with its byte-order mark and Bangla intact. LibreOffice Calc 24.2 opened both files, made by the admin's own export code with Bangla headers and names, money and a name starting with `=`: the Bangla intact (the CSV read as UTF-8 from its byte-order mark, with no options chosen), counts and money as numbers (`#,##0.00` kept in the `.xlsx`), dates in the CSV read as dates, and the `=` name as text in both. In the CSV the guard's apostrophe shows, as intended. **Excel itself is still to open one** |
| 5. The accountant accepts the definitions | **Open: waiting for the review** (§5) |

**On the preview** (#85, `4bb7e50`, narrowed, through Hyperdrive): the smoke tests and the back office flow pass at a phone and a desktop viewport, Lighthouse holds all nine storefront pages within their budgets, and the CPU step measured every new route (§3). The first full run (`9da1885`) showed a fault in the CPU step itself: its receipts asked to pay without a supplier, which the API rightly refuses, so the receipts and the count went unmeasured. `4bb7e50` fixed the step.

**Run locally** against `wrangler dev` with a seeded run, the back office flow passes at a phone and a desktop viewport, with axe and the CSP check on 17 screens, and left the rows it should in the database.

### 2.1 Security review

Reviewed against PLAN.md's baseline: every new admin and platform route, the receipt photos, the queue messages, the jobs, isolation, exports and logs.

| Finding | Severity | Fix |
| --- | --- | --- |
| A report's CSV wrote text as typed, so a supplier's name or an expense's note starting with `=`, `+`, `-` or `@` would run as a formula when the file opens in Excel (CSV injection) | Low: only staff type these | Such text gets a leading apostrophe; numbers and money stay numbers. Excel files already write text as text (`f618413`) |
| A stock count's queue message wasn't checked before use | Low: only the Worker sends them | A message without UUIDs is logged and dropped, not retried (`f618413`) |

**Accepted as they are:**

- **Receipt uploads are refused from `Content-Length` before reading and checked again after,** as media, import and return-photo uploads are; a body sent without a length is read before the second check. Only `expenses.write` staff can send one.
- **A report over two years without summaries is computed live** in Postgres, for the period and the one before. It costs database time, not Worker CPU, and the backfill makes it rare.
- **COD outstanding is shown to viewers,** as Phase 7's reconciliation is (`reports.read`): it holds no cost.
- **The order and customer CSV exports (Phases 4 and 5B) have the same formula risk,** with text shoppers type. Their courier formats must keep `+880` phones as they are, so the fix needed its own decision. The owner chose it: done on Oct 27 (§5).

**Checked, and found fine:**

- **Every route checks its permission, then again in core.**
  - Costs and profit need `catalog.cost`, dues and payments `purchasing.pay`, expenses `expenses.read` and `expenses.write`.
  - Staff receive an ordered PO's quantities only. A count above the store's threshold needs `catalog.cost` to apply. The rebuild needs a super admin.
  - Without a permission, fields are left out, not blanked. Each is a test with staff and viewer sessions.
- **The 15 new store tables have forced RLS** and a tenant policy, are in the isolation suite through the API and as raw SQL, and are in the export and purge. `cost_changes` is append-only for the app; the summaries can't be updated in place.
- **Receipt photos** are sniffed (JPEG, PNG or WebP only), at most 2 MB, stored under the store's own prefix with a server-made name, served `private, no-store` with `nosniff`, and go with the store's export and purge.
- **The Store jobs runner's backfill runs as `app_rw`,** so row-level security applies on the migration role.
- **SQL takes parameters throughout;** `sql.raw` holds only constant column lists.
- **Logs carry IDs and counts,** never names, phones or amounts.
- **No new dependencies.** `pnpm audit` reports the same 3 moderate and 3 low advisories as Phase 7, all in build tooling.

### Tests

| Package | Tests |
| --- | --- |
| `shared` | 397 (Phase 7: 369) |
| `db` | 1,095, 117 skipped (937, 95 skipped): the new tables' isolation |
| `core` | 331 (286): purchasing, counts, expenses, the two report suites and the imports |
| `providers` | 69 (69) |
| `api` | 213 (203): purchasing, counts, expenses, reports, the rebuild route, the isolation suite's new routes |
| `admin` | 25 (20): messages, the export helpers |
| `storefront` | 40 (40) |
| `scripts` | 31 (27): the backfill through the runner, the demo store's back office |

## 3. Measurements

Bundles from CI's build of `4bb7e50`; the rest from #85's preview run on it.

| Measure | Result | Budget |
| --- | --- | --- |
| API Worker | 1,059 KiB gzip (Phase 7: 1,014); startup 317–431 ms | 3 MiB (34%) |
| Storefront Worker | 333 KiB gzip (332) | 3 MiB (11%) |
| Admin, JavaScript before sign-in | 137 KiB (135) | 150 KiB (91%; CI warns above 85%, as since 5B) |

**Lighthouse:** all nine storefront pages within their budgets (LCP, CLS, TBT, accessibility, SEO).

**CPU** (the preview's CPU step through Hyperdrive, ms):

| Route | Requests | Stopped | p50 | p90 | Max |
| --- | --- | --- | --- | --- | --- |
| `POST /v1/admin/goods-receipts` (50 lines, at cost) | 5 | 0 | 73 | 88 | 88 |
| `PUT /v1/admin/stock-counts/{id}/lines/{variantId}` | 497 | 0 | 15 | 35 | 139 |
| `POST /v1/admin/stock-counts/{id}/apply` (500 lines) | 1 | 0 | 110 | 110 | 110 |
| `GET /v1/admin/reports/profit` (the month so far, with the period before) | 12 | 2 | 13 | 27 | 59 |
| `GET /v1/admin/reports/stock` (over 500 variants) | 10 | 0 | 32 | 42 | 47 |
| `GET /v1/admin/reports/sales` | 11 | 1 | 17 | 25 | 25 |
| `POST /v1/store/checkout/orders` (placeOrder, for comparison) | 15 | 0 | 47 | 83 | 90 |

- **A 500-line count applies in one request in 110 ms,** and a 50-line receipt in under 90. Both are one batch of movements, as planned (plan §9).
- **The three stopped report requests came last,** right after the 500 count requests, when the Worker had spent a lot of CPU in a few minutes: the pattern of phase-7-report §3.1. The step sends a stopped request once more, and each was answered then. In the first full run, without the count before them, no report request was stopped (profit p50 19, max 36; stock 10 and 23; sales 12 and 24).
- **The stock report is the heaviest new read,** at 32 ms for a store of over 500 variants; it reads levels and labels in two queries and doesn't depend on the summaries.
- **The older routes are close to Phase 7's numbers,** placeOrder lower (p50 47 against 78); none was stopped.

## 4. Free-tier impact

As planned (plan §9):

- **The daily batch** refreshes 7 days of summaries per store with the back office: a few `insert … select` statements in each store's transaction, in the batch that already wakes the database. On the 1st it also writes month-end values.
- **Large counts** use the existing delayed-work queue, one message per 500 lines.
- **The backfill runs in Actions** (Store jobs), once per store, a few minutes at most.
- **Receipt photos** count in the store's R2 storage, at most 2 MB each.
- **No new Cron Triggers, queues or KV writes.** Exports are built in the browser.

## 5. Known gaps and follow-ups

### Waiting on the owner

1. **An accountant's review of §3.8** (criterion 5). Beyond the plan's table, these were the build's own reading:
   - a line delivered in parts shares its discount and VAT cumulatively, so the parts add up to the line;
   - a refund that isn't a return (today, only after an edit left an order overpaid) counts with returns on its processed date, once the order was delivered;
   - gross profit per order is delivered net sales less returns and such refunds, less the cost of the units that stayed sold;
   - stock losses include count differences at their value, gains reducing the loss;
   - month ends before this phase are valued at the cost then where the history has it, else at today's cost.
2. **The pilot's sample supplier, purchase and expense files,** to try the imports on before onboarding.
3. **Workers Paid** remains the way back to running the whole E2E suite on a preview (phase-7-report §3.1).

### Not built yet, or smaller than planned

- **Opening an export in Excel,** as criterion 4 asks once; LibreOffice has (§2).

### Done after the phase (Oct 27)

- **The older CSV exports' formula risk** (orders, customers), as the owner chose: the order and customer CSVs guard the text people type (names, addresses, notes, tags, items) as the reports do. The phone the server checked and the money stay as they are, the Steadfast and Pathao files keep their text exactly as typed, and the Excel files already wrote text as text.
- **Criterion 2 at the plan's 50 variants:** the integration test counts 50, ten each of a sale before counting, a sale after, one missing, two found and untouched, and checks every line, the stock, the drift and the adjustments' values.
- **The Overview tab exports** each table to Excel and CSV like the other reports, counts, money and percentages as numbers; the returns flow saves the refunds table as CSV.
- **The PO editor's variant picker is in the E2E:** the flow writes the purchase order in the editor, picking both products, then places it.
- **The duplicate banner's Merge and Cancel** now show their message, and Merge opens the order kept. Refreshing the order removed the banner before its handlers ran, so staff stayed on the cancelled order. The recovery flow failed on it when run locally.

### Decisions that differ from the plan

The build notes in the plan's §15 list each one with its reason. The ones that change what a store sees:

- **A count has a fifth state, `applying`,** while the queue applies a large count; a batch that keeps failing sends it back to review with the error.
- **A count's uncounted lines are left alone;** counting zero is how staff say none is left.
- **A receipt is never edited.** A wrong one is corrected with an adjustment and a cost correction.
- **The supplier's opening balance is the oldest debt** in the ageing, whatever the dates.
- **A new recurring entry posts from the day it is made,** never for days already past.
- **The nightly refresh also redoes older days whose shipments or refunds changed,** for courier fees that arrive late, and queues the backfill itself for a store that just turned the back office on.
- **The summary tables are written by the app role** in each store's transaction, not by `mm_system`.
- **The imports post rows straight to the API,** 200 a request, rather than through the catalog's staged import job, and skip what the store already has.

### Lessons for later phases

- **Run the new E2E locally before the preview, again.** It passed first time here because every screen's labels were read from its code, not guessed.
- **A fixed-window rate limit makes a timing-sensitive test.** Hold the clock when a test counts requests against a window.
- **A migration role usually bypasses row-level security.** A job that calls the core with it must switch to `app_rw` first, as the reset and now the backfill do.
- **Check a formula guard against every CSV a feature writes,** not only the new ones.
