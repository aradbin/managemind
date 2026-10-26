# Phase 8 plan: Back office

- Status: **Approved (Oct 26), being built.** The owner accepted every recommendation in §14 and asked to start the build (Q1: build now). Steps 0–5 are done (§15). Still needed from the owner: sample supplier, purchase and expense data from a pilot client (before step 8), and an accountant's review of the profit and stock valuation definitions (§1, §3.8; acceptance criterion 5)
- Date: 2026-10-26
- Scope: PLAN.md "Phase 8 — Back office". Suppliers, purchase orders and goods receipts that update stock and a weighted average cost; stock adjustments with reasons and stock-count sessions; expenses with categories and recurring entries; reports for sales, gross and net profit, stock valuation, supplier dues and COD outstanding, read from summary tables refreshed by cron, with CSV and Excel export. It builds on Phase 2's stock ledger and cost prices (phase-2-plan §3.8, Q5), Phase 4's cost snapshot on order lines (phase-4-plan §3.6), Phase 5A's returns and reports (phase-5a-plan §3.12, §3.15), and Phase 7's courier fees and payouts (phase-7-plan §3.7)

## Goal

Today a store's stock goes up only by hand: staff type a new on-hand number or a delta with the reason "received", and the cost price is whatever someone typed into the product once. What the store owes its suppliers lives in a notebook (the *khata*) or an app beside ours. Expenses aren't recorded anywhere, so nobody can say what a month earned. This phase gives the store its back office:

- **Buying.** Suppliers, purchase orders, and goods received in one go or in parts. Receiving adds the stock and updates each variant's weighted average cost. What the store owes each supplier follows from what it received and what it paid.
- **Keeping stock true.** Every adjustment has a reason and a value. A stock count compares what's on the shelf with what the system expected, while sales keep running, and applies the differences in one step.
- **Expenses.** Rent, salaries, ad spend, packaging and the rest, by category, with recurring entries that post themselves.
- **Knowing the numbers.** Sales by day and product, gross profit per order and product, net profit after expenses, what the stock is worth, what's owed to suppliers and what couriers still hold, all exportable to CSV and Excel.

PLAN.md gives this phase no acceptance criteria. Proposed (Q2):

1. **Purchasing.** A purchase order of three lines is received in two partial receipts. Stock rises by exactly what was received, each variant's cost is the weighted average a hand calculation gives, and the supplier's balance is what was received less what was paid. `inventoryDrift` stays empty.
2. **Stock.** A count session over 50 variants, with orders shipping while it runs, applies only the real differences: no sale is counted twice or lost. Every adjustment has a reason, a user and a value, and the adjustments list totals them.
3. **Expenses.** A monthly recurring expense posts once on its day, never twice, including when the daily batch runs late or twice. Editing or deleting an expense is audited.
4. **Reports.** On seeded data, sales, cost of goods sold, gross profit, net profit, stock valuation, supplier dues and COD outstanding match hand-computed totals to the poisha. The summary tables equal a live recomputation (a test computes both). The CSV and Excel exports open in Excel with Bangla text intact.
5. **Review.** The accountant accepts the definitions in §3.8 (or the changes they ask for are made).

**Estimate: about 5 weeks** (PLAN.md: about 4–6). The order inside the phase (§12):

1. the data, the permissions and the cost rules, which everything else uses;
2. suppliers, purchase orders and receiving, then supplier payments and balances;
3. adjustments and stock counts;
4. expenses;
5. the summary tables, the reports and their exports;
6. imports, CI, the security review and the report.

## 1. Prerequisites status

PLAN.md: "Never start a phase until its prerequisites have been provided." Phase 8's are a pilot client's data and an accountant's review. **Neither has been provided yet, and the pilot hasn't started.** PLAN.md also says Phases 6–10 start "only when pilot clients need it" (Q1).

| Item | Status |
| --- | --- |
| Sample supplier, purchase and expense data from a pilot client | **Open, not blocking the design.** It shapes the import columns (§3.10), the default expense categories (§3.6) and the demo data. **Needed before step 8** (§12). Without it the build uses the categories and columns below, which follow what Bangladeshi SME bookkeeping apps ask for |
| An accountant's review of the profit and stock valuation reports | **Open, blocking acceptance criterion 5.** §3.8 writes every definition down (when a sale counts, what is in cost of goods sold, how delivery and courier fees are treated, VAT, valuation). **The review can happen on this plan, before any code.** That is the cheapest time to change a definition (Q3) |
| Which pilot stores buy on credit, and from how many suppliers | **Open** (Q1). It decides whether supplier dues matter on day one or can wait |
| Carried from Phases 5A–7 | **Nothing here needs `CREDENTIALS_KEY`, the VAPID keys or a provider account.** Phase 8 works in production as soon as it is deployed. The backup keys matter more after this phase, since the store's books now live here (ADR 0028) |
| Workers Paid | **The owner's decision, at the first pilot client** (phase-5b-plan Q2). Nothing here needs it. The E2E suite already outgrows a preview's CPU allowance (phase-7-report §3.1), so this phase's PR uses `narrow-preview` too, unless Paid comes first |
| Legal review | **Small addition.** Suppliers' names and phones are personal data the store keeps about its own business contacts. The data processing agreement already covers store data in general; the store privacy template needs nothing, since shoppers aren't affected |

## 2. Research: what is borrowed

| From | What |
| --- | --- |
| Shopify | **Purchase orders** in the admin (Stocky before them): a supplier, a destination location, lines with a cost per item, then shipping, duties and other costs, and an adjustment. Receiving is per line, in parts, with "accept" and "reject" counts. The cost per item of what's received updates the inventory item's cost. **Inventory adjustments** carry a reason ("correction", "count", "received", "damaged", "theft or loss", "promotion or donation") and every change shows in the adjustment history. We copy the shape of the PO and its receiving, and Phase 2 already has the reasons |
| Odoo, ERPNext | Not on PLAN.md's list, but they are where purchasing is designed in full. **Moving average cost** (Odoo's AVCO, ERPNext's "Moving Average"): each receipt revalues the average; sales and adjustments go out at the current average, so the stock's total value is always the sum of what came in less what went out at average. **Landed costs** spread a PO's transport and other costs over its lines by value. **Stock counts** (Odoo's inventory adjustment, ERPNext's Stock Reconciliation) record a counted quantity per line and apply the difference as one adjustment. **Supplier ledger:** the balance is received value less payments, with ageing. We take all four and leave out the rest (vendor bills, three-way matching, a chart of accounts) |
| Medusa | An inventory module with levels and reservations per location, and **no purchasing**: it is left to an ERP. Its reservation model is already ours (phase-2-plan §3.8) |
| Vendure | Stock movements of fixed types (allocation, sale, cancellation, return, release, adjustment) and **no purchasing**. Ours are the same types (Phase 2), so a receipt is simply a `receive` movement with a reference |
| Saleor | Warehouses and stock per warehouse, and **no purchasing or costing**. Product cost shows in its "margin" only as a field on the variant, as ours does today |
| Bangladeshi SMEs | Most buy from wholesale markets (Chawkbazar, Islampur, Gausia and the like) or through import agents, often **on credit settled in parts** (*baki*), and keep the balance per supplier in a *khata*. Bookkeeping apps built for them (TallyKhata, Hishabee) centre on exactly that: dues per contact, a payment entry, a reminder. The biggest expenses of an online store are **Facebook and Instagram ad spend**, salaries, rent, packaging and courier charges. Payments go by cash, bank, bKash and Nagad |
| What we simplify | **One cost per variant**, not per location. **No vendor bills:** the receipt is the bill; a supplier invoice number is a field on it. **No chart of accounts or double entry:** the reports are management reports, which the accountant reviews (§3.8). **No supplier returns** in this phase (Q9). **No partial payment allocation to POs:** payments reduce the supplier's balance, and ageing is computed oldest receipt first. **No purchase VAT** (input VAT): a receipt's cost is what the store paid, VAT included, until Mushak invoices are built (PLAN.md, later features) |

## 3. Design decisions to approve

### 3.1 Suppliers

- **A supplier** has a name, a contact person, phones (normalized as shoppers' are), an email, an address, a note, an opening balance (what the store already owed on the day it started here), and whether it is archived.
- **Their products** aren't declared by hand. Each variant's last supplier comes from its receipts, which is what "reorder from this supplier" needs (§3.2).
- **Archiving** hides a supplier from new POs. A supplier with POs, receipts or payments is never deleted.
- **The supplier page** shows open POs, receipts, payments and the running balance, as a *khata* page does.

### 3.2 Purchase orders

| From | Event | To | Effects |
| --- | --- | --- | --- |
| `draft` | `place` | `ordered` | None: the PO is sent to the supplier. It can be printed, or shared as a PDF or a WhatsApp message |
| `draft` | (delete) | — | A draft can be deleted |
| `ordered` | `receive` (some lines left) | `partially_received` | A goods receipt (§3.3) |
| `ordered`, `partially_received` | `receive` (nothing left) | `received` | A goods receipt |
| `partially_received` | `close` | `closed` | None: what's left won't come. The lines' remaining quantities are kept for the record |
| `draft`, `ordered` | `cancel` | `cancelled` | None (nothing was received) |

- **A PO** has a supplier, a location to receive into (the default one unless the store has several), an expected date, the supplier's reference, a note, its lines, and **other costs**: transport, labour, an agent's fee, each with a label and an amount.
- **A line** has a variant, a quantity ordered, a unit cost (prefilled from the variant's current cost), and the quantity received so far.
- **Totals** are integer poisha, computed on the server as orders' are (PLAN.md: never trust the client).
- **Reorder low stock:** a new PO for a supplier can start from that supplier's variants (their last supplier, §3.1) at or below their low-stock threshold. Each line is prefilled to bring the variant back to twice its threshold, which staff change.
- **A PO number** per store, `PO-0001` and on, as order numbers are.
- **Editing:** a draft is edited freely. An ordered PO can gain lines, and its quantities and costs can change for what isn't received yet; each change is in its history.

### 3.3 Goods receipts and the weighted average cost

**Receiving** records what arrived: for each line, the quantity received (which can be more than ordered, with a warning) and its unit cost (prefilled from the PO).

- **One transaction:** the receipt and its lines, a `receive` movement per line (reason `received`, reference `goods_receipt`, an idempotency key from the receipt), the PO's received quantities and state, the variants' new costs, and the cost history. A doubled tap writes nothing twice.
- **Other costs are spread by value** (landed cost): each receipt carries the share of the PO's other costs for the value it receives, so a PO received in parts spreads them as the goods arrive (Q4). A receipt can also add its own other costs (the transport for that delivery).
- **Receiving without a PO:** a store buying in the market has no PO. **Receive stock** takes a supplier (or none), the lines and their costs, and makes the receipt directly. Many pilot stores will only ever use this (Q5).
- **Staff can receive** an ordered PO without seeing costs (§3.11): they enter quantities only, and the PO's costs are used.

**The cost rule (moving weighted average, per variant across its locations):**

| What happens | New cost |
| --- | --- |
| A receipt of `q` units at landed unit cost `c`, with `Q` units on hand at cost `C` | `(Q × C + q × c) / (Q + q)`, rounded to the poisha |
| A receipt when `Q` is zero or below (sold ahead on backorder, or never counted) | `c` |
| The variant had no cost yet | `c` |
| A sale, a negative adjustment, a count | Unchanged: the units leave at `C` |
| A return restocked (Phase 5A, Phase 7's courier returns) | Treated as a receipt at the order line's cost (§3.8) |
| Staff edit the cost by hand (`catalog.cost`), or the catalog import sets it | Set as typed, recorded as a **correction** |

- **Every change is kept** in `store.cost_changes`: the variant, the old and new cost, the on-hand quantity then, the source (`receipt`, `return`, `manual`, `import`), the reference and the actor. The variant page shows it, and an accountant can follow any cost back to its receipts.
- **Stores that never use purchasing** lose nothing: the cost they type stays the cost, recorded as corrections.
- **Rounding** to the poisha per unit loses less than one poisha per unit per receipt, which the valuation report states once rather than tracking.

### 3.4 Stock adjustments

Phase 2's adjustments stay as they are (a delta or a new on-hand number, with a reason). This phase adds:

- **Reasons:** `expired` and `sample` (gifts, samples, the store's own use) join `received`, `count`, `damaged`, `lost`, `returned`, `correction`, `import` and `other`. `other` needs a note.
- **A value:** each adjustment is valued at the variant's cost at that moment, kept on a new column of the movement (`unit_cost`). Losses (damaged, lost, expired, sample) appear in net profit (§3.8).
- **Inventory → Adjustments:** the history, filtered by reason, location, user and date, with units and value totals, and exportable.
- **"Received" by hand** is still allowed. With purchasing on, the adjust dialog points to **Receive stock** instead, so the cost is captured.

### 3.5 Stock counts

A count compares the shelf with the system for a set of variants at one location, then applies the differences.

| From | Event | To | Effects |
| --- | --- | --- | --- |
| `counting` | `submit` | `review` | None |
| `review` | `reopen` | `counting` | None |
| `review` | `apply` | `applied` | One `adjustment` per line with a difference, reason `count`, reference `stock_count` |
| `counting`, `review` | `cancel` | `cancelled` | None |

- **What's counted:** the whole location, a category, products with a tag, or a hand-picked list. The lines are created when the count starts.
- **Counting while selling.** Stores can't close to count. Each line records the counted quantity and **when it was counted**. At apply, the difference is the counted quantity less what the ledger says was on hand at that moment (on hand now, less the movements after it). A sale shipped after a line was counted is therefore neither undone nor counted twice. This is exact because the ledger is append-only (Phase 2).
- **Several people count at once,** each on a phone, by scanning or typing a barcode or SKU, or by tapping through the list. A Bluetooth or USB scanner types into the field. A phone camera scans where the browser offers `BarcodeDetector` (Chrome on Android), with no new dependency (Q6).
- **Blind counts:** counters don't see the expected quantity, so they count rather than confirm. Reviewers see expected, counted, the difference and its value (Q6).
- **Review** lists the differences largest value first. A line can be recounted. Apply needs `inventory.write` and, when the total value of the differences is above the store's threshold, `catalog.cost` (an owner or manager) (Q7).
- **Size:** up to 2,000 lines a count. Applying runs in batches of 500 lines on the delayed-work queue when a count is larger than 500, to stay inside the Free plan's CPU per request (§9).

### 3.6 Expenses

- **Categories**, per store, editable, in Bangla and English. Seeded with: rent; salaries and wages; Facebook and online ads; packaging; delivery and courier (what isn't booked through Phase 7); utilities; internet and phone; bank and mobile-banking charges; equipment; other. The pilot's data may change these (§1).
- **An expense:** a date (Dhaka), a category, an amount, how it was paid (cash, bank, bKash, Nagad, card, other), a payee, a note, an optional receipt photo, and who recorded it.
- **Receipt photos** go through the Worker to R2 as return photos do (ADR 0016), one per expense, at most 2 MB after the browser shrinks it, counted in the store's storage limit (Q8).
- **Recurring entries:** a category, an amount, a payee, monthly on a day (1–28, or the last day) or weekly on a weekday, from a start date to an optional end. The daily batch posts each one on its day. An expense is unique per recurring entry and date, so a batch run twice or late posts each one once. A late run posts the missed days. Changing a recurring entry changes only future posts.
- **Ad spend in dollars:** stores pay Meta by card in USD. The expense is entered in taka as charged on the card statement. There is no currency field (PLAN.md: no multi-currency).
- **Editing and deleting** an expense is audited, with the old values.

### 3.7 Supplier payments and dues

- **A payment to a supplier:** the supplier, a date, an amount, how it was paid (as for expenses), a reference (a bKash transaction ID, a cheque number) and a note. It isn't allocated to a PO (§2).
- **The balance** of a supplier is its opening balance, plus the value of every receipt (landed), less every payment. It can go below zero (an advance to the supplier), shown as "advance".
- **Ageing** (for the dues report): payments are applied to the oldest receipts first, and what's left is bucketed by the receipt's age: 0–30, 31–60, 61–90 and over 90 days.
- **Receive and pay at once:** the receipt screen can record a payment for all or part of it in the same step, as market purchases are usually paid on the spot.

### 3.8 Reports and their definitions (for the accountant)

**The definitions**, written for the accountant's review (Q3):

| Term | Definition |
| --- | --- |
| When a sale counts | **When its goods are delivered:** the shipment's `delivered_at`, in Dhaka time. An order placed, confirmed or shipped isn't a sale yet, and a failed delivery never becomes one. This matches cash on delivery, where the money arrives at delivery. Phase 5A's reports, which count by placement, stay as they are and say so |
| Gross sales | Delivered units × the line's unit price, before discounts |
| Net sales | Gross sales less the line's share of discounts, **without VAT** (VAT is collected for the government, not earned). Delivery fees charged to shoppers are a separate line, **delivery income** |
| Returns | Units returned and accepted (Phase 5A), on the date they were received back, at their net sale value. Refunds that aren't returns (a goodwill refund) count on their processed date |
| Cost of goods sold (COGS) | Delivered units × the order line's cost, less returned units × the same cost |
| The order line's cost | **Frozen when its first unit ships**, from the variant's weighted average then. Today it is frozen at placement (Phase 4); a purchase between placement and shipping would otherwise leave the old cost on the line (Q10) |
| Gross profit | Net sales − returns − COGS. Per order and per product too |
| Delivery result | Delivery income − courier fees (Phase 7, where known) − the cost of failed deliveries (Phase 5A's `return_cost`) |
| Stock losses | Adjustments with reasons damaged, lost, expired and sample, and count differences, at their value (§3.4). Gains from counts reduce the loss |
| Net profit | Gross profit + delivery result − stock losses − expenses (by the expense's date) |
| Payment fees | Not recorded today: the payments table keeps no gateway fee. The store enters SSLCommerz's and bKash's charges as an expense (category: bank and mobile-banking charges) |
| Stock valuation | On-hand units (above zero) × the variant's weighted average cost, per variant, location and category. Negative on-hand is listed apart, never netted |
| Supplier dues | §3.7's balances, with ageing |
| COD outstanding | Phase 7's reconciliation: delivered COD not yet paid out by the courier, per courier and age. For shipments without a courier, the store's own riders: COD delivered but not marked paid |
| Missing costs | Lines sold with no cost are counted and shown on every profit report: "N units had no cost; profit is overstated". They are never treated as zero silently |

**The reports** (Reports gains tabs; the Phase 5A screen becomes **Overview**, and Phase 7's COD reconciliation keeps its page):

- **Sales:** by day (or week, or month) for a range: orders delivered, units, gross and net sales, discounts, returns, delivery income. By product and variant: units, net sales, COGS, gross profit and margin, sortable.
- **Profit:** the statement for a period, in the order of the table above, with the previous period beside it; gross profit per order (the order list gains a profit column for `catalog.cost` holders).
- **Stock:** valuation today, and at the end of each past month (§3.9), by category and location; slow movers (on hand, no sale in 60 days).
- **Suppliers:** balances and ageing; purchases by supplier and period.
- **Expenses:** by category and month.
- **COD outstanding:** the Phase 7 figures in one place, linked to the reconciliation.

**Exports:** every report and list in this phase, and Phase 7's COD reconciliation (phase-7-report §5), export to CSV and Excel. The browser builds the file from the API's JSON with `write-excel-file`, which the admin already uses, as the catalog and order exports do. No Worker CPU is spent on files. CSV is UTF-8 with a byte-order mark, so Excel reads Bangla correctly.

### 3.9 Summary tables, refreshed by cron

PLAN.md: "Reports read from summary tables refreshed by cron to keep queries light."

- **`store.daily_sales`:** per store and Dhaka day: orders delivered, units, gross and net sales, discounts, VAT, delivery income, courier fees, failed-delivery costs, returns, COGS and returned COGS, and units with a missing cost.
- **`store.daily_product_sales`:** per store, day and variant: units, net sales, COGS, returned units and their value.
- **`store.monthly_stock_values`:** per store, month end and variant: on hand, cost and value. The valuation report reads today live and past months from here.
- **Every fact is booked on its own day** (§3.8): a sale on its delivery day, a return on its return day. A past day therefore doesn't change when a later return arrives, since the return is booked on its own day. A delivered order's lines can't be edited (Phase 4).
- **The refresh:** the daily batch (23:47 UTC, 05:47 in Dhaka) recomputes **yesterday and the 6 days before it** for each store, replacing those rows. That catches late courier updates and corrections. It costs a few `insert … select` statements per store, inside the batch that already wakes the database. On the 1st of a month it also writes the month-end stock values.
- **Today** is computed live from the source tables when a range includes it, so the numbers are never a day behind.
- **A test computes every report both ways** (from the summary tables and live) on the same seeded data, and requires them to be equal (criterion 4).
- **A store that turns Phase 8 on** gets its history filled by the Store jobs workflow (ADR 0027) for every day since its first order, in Actions, not in a Worker. The same job rebuilds a store's summaries on request, from Platform → Store, after a fix.

### 3.10 Imports

Read in the browser, as the customer import is (phase-5b-plan): the file's columns are matched, a preview shows what will be created and what's wrong, and nothing is saved until staff confirm.

- **Suppliers,** with their opening balances.
- **Expenses,** for the months before the store moved here, so a year's report is complete.
- **Opening stock costs** already import through the catalog import's cost column (Phase 2), recorded as corrections (§3.3).
- **Past purchases are not imported** (Q11): they don't change today's stock or cost, and their effect on the supplier is the opening balance.

### 3.11 Who can do what

| Action | Permission | Roles |
| --- | --- | --- |
| See suppliers, POs and receipts, without costs | **New: `purchasing.read`** | Owner, manager, staff, viewer |
| Create and edit suppliers and POs; receive with costs; receive without a PO | **New: `purchasing.write`** | Owner, manager |
| Receive an ordered PO, quantities only | `inventory.write` | Owner, manager, staff |
| Record supplier payments; see balances and dues | **New: `purchasing.pay`** | Owner, manager |
| Adjust stock; start, count and submit a count | `inventory.write` | Owner, manager, staff |
| Apply a count above the store's value threshold | `inventory.write` and `catalog.cost` | Owner, manager |
| See and record expenses | **New: `expenses.read`, `expenses.write`** | Read: owner, manager, viewer. Write: owner, manager (Q12) |
| Sales reports without costs | `reports.read` | Owner, manager, viewer |
| Anything with cost, profit, valuation or dues | `reports.read` and `catalog.cost` | Owner, manager |

- **Costs stay with `catalog.cost`** wherever they appear (phase-2-plan Q5): PO and receipt costs, the adjustments' value, the cost history, profit and valuation. Without it the fields are left out of the response, not blanked.
- **The plan feature:** a new feature, `backOffice`, gates purchasing, counts, expenses and the new reports. Proposed on Growth and Pilot, off on Starter, which keeps Phase 5A's reports and Phase 2's adjustments (Q13). Stores from before plans have every feature, as now.

### 3.12 Admin screens

Mobile first, each new screen loaded on demand, on Phase 5C's patterns ([ADR 0029](../adr/0029-admin-redesign.md)):

- **Inventory** gains tabs: **Stock** (today's screen), **Purchase orders**, **Receive stock**, **Counts** and **Adjustments**.
- **Suppliers** under Inventory: the list with balances, and the supplier page (§3.1).
- **A purchase order:** the editor with a variant picker (the order screen's), other costs, totals, **Place**, **Receive**, **Close**, and a print view (`print.purchase-order`) to share as a PDF.
- **Receiving:** one screen for both a PO and a direct receipt: the lines, received quantities, costs (for `purchasing.write`), other costs, and **Pay now**.
- **A count:** the counting screen (scan or search, then a number) and the review.
- **Expenses**, a new item in the nav for `expenses.read`: the list by month with category totals, the expense form with the receipt photo, and recurring entries.
- **Reports:** the tabs in §3.8, each with a range, the comparison and **Export**.
- **The dashboard,** for `catalog.cost` holders: this month's gross profit, expenses and net profit so far, from the same summary.
- **The variant panel:** its cost history (§3.3) and last supplier.

### 3.13 New dependencies

None. Spreadsheets use the admin's `read-excel-file` and `write-excel-file`; barcodes use the browser's `BarcodeDetector` where it exists.

## 4. Data model

| Change | Notes |
| --- | --- |
| `store.suppliers` (new) | `tenant_id`, `id`, `name`, `contact_name`, `phones` (text[]), `email`, `address` (jsonb), `note`, `opening_balance` (money), `archived_at`, `created_at`, `updated_at`. Trigram index on name, as customers have |
| `store.purchase_orders` (new) | `id`, `number` (unique per store), `supplier_id`, `location_id`, `status`, `expected_on`, `supplier_ref`, `note`, `other_costs` (jsonb: `[{ label, amount }]`), `subtotal`, `other_cost_total`, `total`, `placed_at`, `closed_at`, `created_by`, `created_at`, `updated_at`. Index (`tenant_id`, `status`, `created_at desc`) and (`tenant_id`, `supplier_id`) |
| `store.purchase_order_lines` (new) | `purchase_order_id`, `id`, `variant_id`, `quantity`, `unit_cost`, `received_quantity`, `position`. Unique (`purchase_order_id`, `variant_id`) |
| `store.goods_receipts` (new) | `id`, `number` (`GR-0001`), `supplier_id` (nullable), `purchase_order_id` (nullable), `location_id`, `received_on`, `supplier_invoice`, `other_costs` (jsonb), `total` (landed), `note`, `received_by`, `idempotency_key` (unique per store), `created_at` |
| `store.goods_receipt_lines` (new) | `goods_receipt_id`, `purchase_order_line_id` (nullable), `variant_id`, `quantity`, `unit_cost` (as entered), `landed_unit_cost` |
| `store.supplier_payments` (new) | `id`, `supplier_id`, `paid_on`, `amount`, `method`, `reference`, `note`, `goods_receipt_id` (when paid on receipt), `recorded_by`, `created_at`, `updated_at` |
| `store.cost_changes` (new, append-only for the app role) | `id`, `variant_id`, `old_cost`, `new_cost`, `on_hand`, `source`, `reference_type`, `reference_id`, `actor_type`, `actor_id`, `created_at`. Index (`tenant_id`, `variant_id`, `created_at desc`) |
| `store.stock_counts` (new) | `id`, `number`, `location_id`, `status`, `scope` (jsonb), `note`, `started_by`, `submitted_at`, `applied_at`, `applied_by`, `created_at`, `updated_at` |
| `store.stock_count_lines` (new) | `stock_count_id`, `variant_id`, `counted` (nullable until counted), `counted_at`, `counted_by`, `expected_at_count` and `difference` (written at apply), `unit_cost` (at apply). Unique (`stock_count_id`, `variant_id`) |
| `store.expense_categories` (new) | `id`, `name` (jsonb, `bn` and `en`), `position`, `archived_at`. Seeded per store when the feature is first opened |
| `store.expenses` (new) | `id`, `spent_on`, `category_id`, `amount`, `method`, `payee`, `note`, `receipt_media` (jsonb: file name, size), `recurring_expense_id`, `recorded_by`, `created_at`, `updated_at`. Unique (`tenant_id`, `recurring_expense_id`, `spent_on`) where recurring. Index (`tenant_id`, `spent_on desc`) |
| `store.recurring_expenses` (new) | `id`, `category_id`, `amount`, `method`, `payee`, `note`, `cadence` (`monthly`, `weekly`), `day`, `starts_on`, `ends_on`, `next_on`, `active`, `created_at`, `updated_at` |
| `store.daily_sales`, `store.daily_product_sales`, `store.monthly_stock_values` (new) | §3.9. Primary keys (`tenant_id`, `day`) and (`tenant_id`, `day`, `variant_id`), (`tenant_id`, `month`, `variant_id`). Written only by the refresh, as `mm_system`; read by the app role |
| `store.stock_movements` | New nullable `unit_cost` (money): the cost the movement was valued at. Filled for receipts, adjustments, counts and returns from this phase on |
| `ADJUSTMENT_REASONS` | Gains `expired` and `sample` |
| `PERMISSIONS`, `FEATURES` | §3.11 |
| Settings (`backOffice` in the store's settings JSON) | `countApprovalThreshold` (money, default ৳5,000), `reorderMultiple` (default 2) |
| `app.recurring_expenses_due()`, `app.report_refresh(tenant, from, to)` | Security definer, for the daily batch, as earlier phases' are |
| Events | `purchase_order.placed`, `goods_receipt.created`, `stock_count.applied`. No notifications read them yet; they are there for the audit trail and later integrations |
| `STORE_TABLES` | Every new store table, in purge order. The export includes them, and the receipts' photos with the store's files |

Two migrations (0044–0045): the schema, then grants and functions, as in earlier phases. **ADR 0031** records the costing and reporting design: moving average per variant, sales at delivery, facts booked on their own day, summary tables refreshed for the last 7 days.

## 5. Services

| Module | Does |
| --- | --- |
| `core/purchasing` (new) | Suppliers; POs and their machine; receipts with landed cost; the cost rule and `cost_changes`; supplier payments, balances and ageing; reorder suggestions |
| `core/inventory` | Movements gain `unit_cost`; stock counts and their apply; the adjustments list with values; returns restock through the cost rule |
| `core/expenses` (new) | Categories, expenses, recurring entries and their posting |
| `core/reports` | The summary refresh, the new reports, and each report's live form for today and for the equality test |
| `core/orders` | The line cost frozen at first shipment (Q10); the order's profit for `catalog.cost` holders |
| `apps/api` | The routes; the daily batch's refresh, month-end values and recurring expenses; `stock_count_apply` on the delayed-work queue |
| `scripts/jobs` | The Store jobs workflow gains `reports:backfill --tenant` (§3.9) |

## 6. API

All under `/v1/admin/*`; the SDK gains every route, as before.

- **Suppliers:** `GET /suppliers?q=&archived=`, `POST /suppliers`, `GET|PATCH /suppliers/{id}`, `GET /suppliers/{id}/ledger?from=&to=`.
- **POs:** `GET /purchase-orders?status=&supplierId=`, `POST /purchase-orders`, `GET|PATCH|DELETE /purchase-orders/{id}`, `POST /purchase-orders/{id}/place|close|cancel`, `GET /purchase-orders/reorder?supplierId=`.
- **Receipts:** `POST /goods-receipts` (`{ purchaseOrderId?, supplierId?, lines[], otherCosts?, payment? }`, with an `Idempotency-Key`), `GET /goods-receipts?…`, `GET /goods-receipts/{id}`.
- **Payments:** `GET|POST /supplier-payments`, `PATCH|DELETE /supplier-payments/{id}`.
- **Stock:** `GET /inventory/adjustments?reason=&from=&to=`, `GET /variants/{id}/cost-history`.
- **Counts:** `POST /stock-counts`, `GET /stock-counts?status=`, `GET /stock-counts/{id}`, `PUT /stock-counts/{id}/lines/{variantId}` (`{ counted }`), `POST /stock-counts/{id}/submit|reopen|apply|cancel`.
- **Expenses:** `GET|POST /expenses`, `PATCH|DELETE /expenses/{id}`, `POST /expenses/{id}/receipt` (the photo), `GET|POST /expense-categories`, `PATCH /expense-categories/{id}`, `GET|POST /recurring-expenses`, `PATCH|DELETE /recurring-expenses/{id}`.
- **Reports:** `GET /reports/sales?from=&to=&by=day|week|month`, `GET /reports/products?…`, `GET /reports/profit?from=&to=`, `GET /reports/stock?at=`, `GET /reports/suppliers`, `GET /reports/expenses?…`, `GET /reports/cod-outstanding`.
- **Platform:** `POST /v1/platform/tenants/{id}/reports/rebuild` starts the backfill job.

## 7. Background work and Cloudflare configuration

| Change | Notes |
| --- | --- |
| Cron Triggers | **None new** (3 of the account's 5 stay in use). The daily batch gains the summary refresh, month-end values and recurring expenses |
| `managemind-domains` (delayed work) | Gains the kind `stock_count_apply`: 500 lines a message. A message that keeps failing leaves the count in review, marked for staff, and Sentry hears of it |
| Store jobs workflow | Gains the `reports_backfill` job kind (ADR 0027) |
| R2 | Expense receipt photos under the store's prefix, removed with the expense and by the purge |

## 8. Security and privacy

- **Isolation:** every new store table has forced RLS and joins the isolation suite through the API and as raw SQL with the app role. A store A user gets 404 for B's suppliers, POs, receipts, counts, expenses and reports. The summary tables are written by `mm_system` per store inside `withTenant`, never across stores in one statement.
- **Costs and profit** are left out of every response without `catalog.cost`, including the PO, the receipt, the order list's profit column and the exports. Tests check each route with a staff and a viewer session.
- **Money:** integer poisha throughout; totals, landed costs and the average computed on the server; the client's numbers are never trusted. Receipts and count applies are transactions with idempotency keys.
- **Audit:** supplier payments, expense edits and deletes, hand cost corrections, count applies and PO cancellations go to the store's audit log with old and new values.
- **Uploads:** receipt photos are checked for type and size and stored as return photos are (ADR 0016).
- **Exports** are built in the browser from routes that already check permissions; nothing new is public.

## 9. Performance and free-tier impact

At pilot volume (about 20 orders a day in all, a few POs and expenses a day per store):

| Resource | Free limit | Phase 8 | Note |
| --- | --- | --- | --- |
| Worker requests | 100,000/day | Staff screens only | Small |
| Worker CPU | 10 ms (Free) | A receipt of 50 lines is one batch of movements, as an import chunk is. Reports read summary rows. A count apply runs 500 lines a message | The CPU step measures a receipt, a count apply, the profit report and the stock report |
| Hyperdrive queries | 100,000/day | A few per staff request; the daily refresh runs on the batch's direct connection | Small |
| Queue operations | 10,000/day | Only large count applies | Small |
| Neon compute | 100 CU-hours/month | The refresh inside the daily batch, which already wakes the database (ADR 0013): about 6 statements per store | Watched by the usage alarm |
| Neon storage | 0.5 GB | Per active store a year: about 365 `daily_sales` rows, 10,000 `daily_product_sales` rows (30 variants sold a day) and 24,000 month-end rows (2,000 variants), about 5 MB; POs, receipts and expenses are small | About 50 MB a year at 10 stores |
| R2 | 10 GB | Receipt photos, at most 2 MB each, inside the store's storage limit | Small |
| Actions minutes | Free while public | A backfill takes a few minutes per store, once | Small |
| KV | 1,000 writes/day | None | |

## 10. Tests

| Layer | Tests |
| --- | --- |
| Unit | The cost rule (every row of §3.3, rounding, zero and negative on hand); landed cost spread by value with rounding that sums exactly; PO totals; the PO and count machines; ageing oldest-first; recurring dates (the 31st, the last day, February, a start mid-month, an end date); the report definitions on small hand-written cases |
| Integration (Postgres with RLS) | A PO received in two parts: stock, cost, cost history, PO state, supplier balance, with `inventoryDrift` empty. A doubled receipt writes once. Staff receive without costs. A count with a sale shipped after a line was counted applies the right difference. A count over 500 lines applies through the queue. Recurring expenses posted once when the batch runs twice and when it's 3 days late. The summary refresh equals the live reports on seeded data (criterion 4). A return restocks at the line's cost and moves the average. The line's cost frozen at first shipment |
| Isolation | Every new table and route, through the API and as raw SQL |
| Permissions | Each cost-bearing route and export with owner, manager, staff and viewer sessions: costs present or left out, writes refused |
| Export and purge | The export has the new tables and photos; the purge test seeds them and leaves zero rows |
| E2E (preview, `narrow-preview`) | Create a supplier; place a PO; receive it in two parts with a payment; see stock, cost and the supplier's balance. Count three variants, with an order shipped during the count, and apply. Record an expense with a photo and a monthly one. Open the profit report and export it to Excel. Axe on every new screen, at a phone and a desktop viewport |
| CPU step | A 50-line receipt, a 500-line count apply, the profit report, the stock report |

## 11. What changes for existing stores

- **Nothing until a store uses it.** Costs typed on products stay their costs. Phase 2's adjustments and Phase 5A's reports work as before.
- **Two small changes for everyone:** an order line's cost is frozen at its first shipment instead of at placement (Q10), and the adjust dialog has two more reasons.
- **Starter stores** don't get the back office unless the plans change (Q13).
- **The demo stores** get two suppliers, a received PO, a count, three months of expenses and their reports, from the weekly reset, so sales meetings can show the phase.

## 12. Pull requests

As in Phases 5B to 7: **one pull request with one commit per step**, its own preview database (`db-branch`), and one `full-preview` run with `narrow-preview` near the end.

| # | Scope |
| --- | --- |
| 0 | This plan and PLAN.md's status |
| 1 | `shared` + `db`: permissions, the `backOffice` feature, settings, reasons, the PO and count machines, every new table, `unit_cost` on movements, `STORE_TABLES` (migrations 0044–0045); ADR 0031 |
| 2 | `core/purchasing`: suppliers, POs, receipts with landed cost, the cost rule and history, supplier payments, balances and ageing; the returns restock through the cost rule; the line cost at first shipment |
| 3 | `api` + `admin`: suppliers, POs, receiving, payments, the print view, the variant's cost history |
| 4 | Adjustments' values and list; stock counts with the counting and review screens and the queued apply |
| 5 | Expenses: categories, entries, receipt photos, recurring entries and their posting in the daily batch |
| 6 | The summary tables, their refresh and month-end values; the sales and profit reports; the order list's profit column; the dashboard figures |
| 7 | The stock, supplier, expense and COD outstanding reports; CSV and Excel exports, including Phase 7's COD reconciliation |
| 8 | Imports: suppliers with opening balances, and past expenses, against the pilot's sample data |
| 9 | The backfill job; demo data; README, runbooks (onboarding gains "opening balances and costs") |
| 10 | CI: the E2E flow and the CPU step's routes |
| 11 | The security review against PLAN.md's checklist, with fixes |
| 12 | Phase 8 report |

Step 8 waits for the pilot's sample data. If it hasn't arrived by its turn, the step moves to the end and uses the columns in §3.10, and the report says so.

## 13. Acceptance criteria and how they're verified

| Criterion | Verification |
| --- | --- |
| 1. Purchasing: stock, average cost and supplier balance right after partial receipts | Integration tests against hand-computed figures, with `inventoryDrift`; the E2E. **In the pilot:** one month of a store's purchases, compared with its *khata* |
| 2. Counts apply only real differences while selling; every adjustment has a reason and a value | The integration test with a sale during the count; the E2E. **In the pilot:** one full count per store |
| 3. Recurring expenses post exactly once | Integration tests for a doubled and a late batch |
| 4. Reports match hand totals; summaries equal live; exports open in Excel with Bangla | The equality test on seeded data; a hand-computed fixture for each report; the E2E's export, opened in Excel and LibreOffice by hand once |
| 5. The accountant accepts the definitions | §3.8 reviewed before the build, and the reports on the demo store's data after step 7 |

## 14. Questions for the owner

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | **When to build.** PLAN.md starts Phase 8 when pilot clients need it, after their data and an accountant's review | **Approve the design now and send §3.8 to an accountant; build when the first pilot store needs it, or now if you'd rather have it ready.** Unlike Phases 5A–7, nothing here waits for a key or a provider, so it can be built and deployed in full. If the pilot stores don't buy on credit, steps 2–3's supplier dues could follow later, but they are a small part of the work |
| Q2 | The acceptance criteria | **The five in the Goal**, since PLAN.md has none for this phase |
| Q3 | The accountant's review | **Before the build, on §3.8.** The definitions most worth their eye: sales counted at delivery, COGS at the moving average with the line's cost frozen at shipment, VAT left out of sales, delivery income and courier fees shown apart, and stock losses in net profit |
| Q4 | Spreading a PO's other costs (transport, agent's fee) into the goods' cost | **Yes, by value,** so the profit per product reflects what the goods really cost. The alternative, recording them as expenses, understates COGS and overstates the margin on imported goods |
| Q5 | Receiving without a PO | **Yes, as a first-class flow.** Market purchases are paid and carried home the same day; asking for a PO first would mean nobody uses purchasing |
| Q6 | Blind counts and camera scanning | **Blind for counters, open for reviewers; camera scanning where the browser has it,** with typing and hardware scanners everywhere. No dependency for older phones' cameras |
| Q7 | Who applies a count | **Anyone with `inventory.write` below ৳5,000 of differences; an owner or manager above,** with the threshold a store setting. A count is where stock quietly disappears, so large differences need a second pair of eyes |
| Q8 | Receipt photos on expenses | **Yes, optional, one per expense,** inside the store's storage limit. Accountants ask for them, and it reuses the return photos' upload |
| Q9 | Returning goods to a supplier | **Not in this phase.** Meanwhile staff adjust the stock out with the reason `other` and a note, and record the supplier's credit as a payment with the method `other`. A proper supplier return (goods out and a credit in one step) can follow pilot demand |
| Q10 | Freezing an order line's cost at its first shipment instead of at placement | **Yes.** Stock leaves at shipment, and the average then is what those units cost. It changes one line of Phase 4's ship effect and nothing for stores without purchasing, whose cost doesn't move |
| Q11 | Importing past purchases | **No.** They don't change today's stock or cost; a supplier's opening balance carries what the store owes |
| Q12 | Viewers and expenses | **Viewers read expenses, as they read every other report,** but not costs or profit, which need `catalog.cost`. An outside accountant would be a Manager, or a custom role later |
| Q13 | Which plans get the back office | **Growth and Pilot; not Starter.** It's the clearest reason to move up a plan. Plans are data, so you can change this from Platform → Billing at any time |

## 15. Build notes

What the build has done so far, and where it differs from the sections above. The phase report replaces this section at step 12.

| Step | Status |
| --- | --- |
| 0 | Done: the plan approved |
| 1 | Done: permissions, the `backOffice` feature (Starter off, Growth and Pilot on), `backOffice` settings, the reasons `expired` and `sample`, the PO and count machines, every table in §4, `unit_cost` on movements, migrations 0044–0045, ADR 0031 |
| 2 | Done: `core/purchasing` with suppliers, POs, receipts, the cost rule and its history, supplier payments, balances and ageing; returns and failed deliveries restocked at the line's cost; the line's cost frozen at first shipment. Acceptance criterion 1 is an integration test |
| 3 | Done: the routes in §6 for suppliers, POs, receipts, payments, dues and cost history; the admin's Inventory tabs, supplier pages, PO editor, receiving and the PO's print view |
| 4 | Done: adjustments valued at their cost and listed with totals; stock counts with blind counting, scanning (a scanner, or the camera where `BarcodeDetector` exists), review largest value first, recounts, the approval threshold, and the apply in batches of 500 on the delayed-work queue (in the request on previews, which have no queue). Acceptance criterion 2 is an integration test |
| 5 | Done: expense categories (seeded the first time a store opens them, renamed, added and archived), expenses by month with category totals, receipt photos (shrunk in the browser, at most 2 MB, under the store's private R2 prefix, counted in its storage), and recurring entries posted by the daily batch. Acceptance criterion 3 is an integration test |
| 6–12 | To do |

**Differences from the plan:**

- **Migration 0045 writes `backOffice` into every stored plan and store entitlement.** Entitlements are validated strictly, so a stored set without the new feature would read as invalid. Each store's value follows its plan and override; a store with a set but no subscription gets it on, as stores from before plans have every feature.
- **The summary tables are written by the app role, inside each store's own transaction** (`withTenant`), as the usage rollup is. They are ordinary store tables with forced RLS; the app may select, insert and delete their rows, never update them. `app.report_refresh` as `mm_system` (§4) would have needed read policies on every source table. The daily batch loops over stores itself, so `app.recurring_expenses_due()` isn't needed either (ADR 0031).
- **A count has a fifth state, `applying`,** while the queue applies a count over 500 lines. A batch that keeps failing sends it back to `review` with the error, instead of a flag on a `review` count (§3.5, §7).
- **A receipt is never edited.** A wrong receipt is corrected with an adjustment and a cost correction, as the stock ledger is (ADR 0031).
- **The supplier's opening balance comes first in the ageing,** before any receipt, whatever the dates: it is what was owed before the store started here (§3.7).
- **Adjustments are valued at the variant's cost at that moment** by the inventory service itself, so every adjustment written from this phase on has a `unit_cost`, including those of Phase 2's dialog and the catalog import (§3.4).
- **A count's uncounted lines are left alone** when it is applied: only counted lines get an adjustment. Counting a line as zero is how staff record that none is left (§3.5).
- **Scanning an item again adds one** to its count, and a number can be typed instead. A camera reading the same code without a pause counts it once (§3.5, Q6).
- **A new recurring entry posts from the day it is made,** never for days already past, even when its start date is earlier: months before the store started here come through the expense import (§3.6, §3.10).
- **The daily batch posts recurring expenses store by store,** in each store's own transaction, as the usage rollup does, so `app.recurring_expenses_due()` (§4) isn't needed. A store that fails posts its missed days the next morning.
- **Deleting a recurring entry keeps what it posted,** as ordinary expenses.
