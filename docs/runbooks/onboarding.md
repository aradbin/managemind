# Runbook: onboarding a client

For a super admin who doesn't read code: from the signed contract to the store's first order, in under an hour of our time (acceptance criterion 1). Write down the time each step took and anything that confused you; it goes in the phase report.

## Before you start

- The client's signed agreement and the plan and price agreed.
- The store's name, the address it wants (`<name>.managemind.store`), the owner's name and email.
- Our invoice details are set (Platform → Billing → Our invoice details), so the first invoice can be issued.

## 1. Create the store (10 minutes)

1. Platform → Stores → **New store**.
2. **Store:** name, address (the screen says whether it's free), language, kind **Client**.
3. **Owner:** their email and name. If the email already has an account, it's reused.
4. **Plan:** the plan, a negotiated price or setup fee if agreed, the billing day, and "free until" for a trial.
5. **Look:** the starting design closest to their shop.
6. **Create store.** The owner gets an email with the admin's address.

## 2. With the owner on a call (30 minutes)

1. They sign in with their email: the admin sends a code. They accept the platform terms.
2. The dashboard shows the **setup checklist**. Go through it together:
   - store profile: business name, address, phone, trade license;
   - logo and colors (Online store → Theme);
   - their first products (or an import);
   - delivery zones and fees: the defaults are placeholders, set their real fees;
   - payments: COD works at once; SSLCommerz once their merchant account is approved (their own gateway approval doesn't count in the hour);
   - the legal pages: the four drafts are filled from their settings. They read them and publish them (Online store → Pages);
   - their own address (domain), or keep the `.managemind.store` one.
3. They place a test order on their store, COD, and take it to delivered in the admin.

## 3. Opening balances and costs (Growth and Pilot, 20 minutes)

The back office (phase-8-plan) needs a starting point: what each product cost, what the store owes, and how much is on the shelf. Without costs, profit reports say "N units had no cost; profit is overstated".

1. **Costs.** For a catalog they already have in a spreadsheet, the catalog import's cost column sets every variant's cost at once (Products → Import). Otherwise, the next delivery from a supplier sets them: Inventory → Purchase orders, or Inventory → Receive stock for a market purchase without a PO.
2. **Suppliers and what is owed to them.** Inventory → Suppliers → **New supplier**, with the opening balance: what the store owed that supplier on the day it started here. Past purchases are not entered; the opening balance stands for them.
3. **Starting stock.** If the stock in the admin isn't what is on the shelf, run a count: Inventory → Counts → **New count**, count everything, review the differences and apply. The differences are booked as count adjustments, valued at cost.
4. **Expenses.** Expenses → Recurring: the rent and salaries that repeat, so they post themselves each month. Past months' expenses are optional; with them, a year's profit report is complete.
5. **Check:** Reports → Profit for this month shows no missing-cost warning, and Reports → Stock shows a value close to what the owner expects.

A store that had orders before the back office was turned on gets its report history filled overnight, by itself (the Store jobs workflow). After a fix to the data, or if the history is missing, Platform → the store → **Rebuild reports** fills it again from the first day; it takes a few minutes and shows under Exports and jobs.

## 4. After

- Platform → the store page shows the checklist's progress and the store's health.
- The first invoice drafts itself on the billing day; check it before it issues (Platform → Billing → Drafts).
- Send them the help guide's link (the help menu in the admin, top right).
