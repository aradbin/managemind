# ADR 0026: Billing stores: plans, invoices, payments and dunning

- Status: Accepted
- Date: 2026-10-23
- Plan: phase-5b-plan §3.6–§3.8, Q5, Q8, Q9. Code: `packages/shared/src/billing/`, `packages/core/src/billing/`, `apps/api/src/billing.ts`, `apps/api/src/platform/billing.ts`, `apps/api/src/admin/billing.ts`
- Builds on: ADR 0010 (outbox), ADR 0014 (staff email), ADR 0024 (credentials); the Phase 5A SSLCommerz settlement rules

## Context

Paying clients start in Phase 5B. We bill each store once a month for its plan, the use above the plan, and a setup fee once. Clients in Bangladesh pay by bank transfer, bKash or Nagad, and online once our own SSLCommerz merchant account exists. The amounts are small, the clients few, and every invoice must be explainable to a client and an accountant. Nothing may charge a store twice, lose a payment, or suspend a store that paid.

## Decision

1. **We bill; nothing charges a card.** A Stripe-like model, kept in our own tables:
   - a subscription has a plan, an optional negotiated price, setup fee and entitlements, a billing day (1–28), an optional free-until date, and a status (`trialing`, `active`, `past_due`, `cancelled`);
   - invoices go `draft → issued → paid | void`. "Overdue" is derived: issued and past its due date.
   - Only client stores are billed. Demo and test stores never are.
2. **The daily job drafts, then issues after a second look.**
   - On or after the billing day it drafts the period's invoice: the coming month's plan, last month's orders and emails above the plan (summed from `platform.usage_daily`), and the setup fee on the first invoice. Months that start before the free-until date carry no plan charge.
   - One invoice per store and period, held by a unique index. A voided period is not drafted again: a super admin bills it by hand.
   - A draft issues itself after 2 days (`DRAFT_REVIEW_DAYS`) unless a super admin issues or voids it first. Manual invoices (one-off charges, credits as negative adjustments) follow the same path, or issue at once.
3. **An issued invoice never changes.** Issuing takes the next number from one platform sequence (`INV-2026-0001`, never reused), sets the due date (7 days), recomputes VAT at today's registration, and snapshots our invoice details and the client's billing details. Database triggers refuse:
   - any change to an issued invoice's number, dates, totals or snapshots;
   - changes to the lines of anything but a draft;
   - payments against anything but an issued invoice.

   A mistake is voided (it keeps its number) and billed again.
4. **Our invoice details are a platform setting.** The legal name, address, trade license, BIN, VAT rate and how to pay (bank, bKash, Nagad) are set by a super admin on Platform → Billing (Q8). Until they exist, drafts wait: nothing can be issued.
5. **Payments.**
   - A super admin records bank, bKash, Nagad and cash payments with a reference. Part payments are allowed; more than is due is refused. Covering the total marks the invoice paid.
   - Online payment uses our own SSLCommerz account (`PLATFORM_SSLCOMMERZ_*`), off until it exists. As in Phase 5A, only SSLCommerz's validation counts:
     - the invoice in `value_a`, BDT, exactly the amount due;
     - a `val_id` never seen before (unique), so a replayed IPN changes nothing.
   - Each payment is audited, and `invoice.paid` goes to the outbox.
6. **Dunning (Q9)** runs in the same daily job. Each step happens once per invoice, held by a unique row in `platform.reminders`:
   - 3 days before the due date: a reminder;
   - on the due date: a reminder;
   - 3 days after: past due, and the subscription becomes `past_due`;
   - 10 days after: the final notice;
   - 14 days after: the store is suspended with the reason `overdue`.

   A super admin can hold reminders and suspension until a date, with a reason (a promise to pay). A payment that leaves nothing overdue reactivates an `overdue` suspension at once. A suspension for any other reason stays.
7. **Owners hear from us by email, in their language.** `invoice.issued` and `invoice.reminder` events go through the outbox, and the consumer emails each owner. An invoice paid or voided since is skipped.
8. **Stores see their own billing.** Owners and managers (`billing.read`) see Settings → Plan and billing: the plan, this period's use against its limits, the issued invoices to view, print and pay, and how to pay. Drafts are ours until issued. Paying works before the platform terms are accepted, and while the store is suspended.

## Consequences

- Billing needs no payment processor or recurring card storage, and the money in Bangladesh moves the way clients already pay.
- A super admin records most payments by hand, from the bank or bKash statement. That is a daily task while clients are few. The SSLCommerz link reduces it once our merchant account exists.
- The invoices are not Mushak 6.3 forms. If the accountant says they must be (Q8), the issuer snapshot and the lines already hold what the form needs, and the print layout changes.
- Overage is billed a month late, from the daily rollup. A store that leaves mid-month is billed its last overage by hand.
- The amounts and plans are placeholders until the owner sets the real ones (Q5).
