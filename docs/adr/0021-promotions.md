# ADR 0021: One promotion engine, typed conditions and actions

- Status: Accepted
- Date: 2026-10-17
- Plan: phase-4-plan §3.13, Q7, Q10. Code: `packages/core/src/pricing/engine.ts`, `packages/core/src/pricing/quote.ts`, `packages/core/src/promotions/service.ts`, `packages/shared/src/orders/promotions.ts`

## Context

PLAN.md asks for one engine for every discount: automatic offers, codes, free delivery, buy-x-get-y, campaign periods. The cart, checkout, manual orders, order edits and the admin's test cart must all price the same way, and new kinds of condition shouldn't need migrations.

## Decision

1. **A pure engine** (`priceCart`) with no database access: it takes the lines, the customer's facts (first order, tags), the zone, the payment method, the delivery fee and the rules, and returns the totals, the applied promotions with their per-line allocations, and why each other one didn't apply. `quote()` loads what the engine needs; every caller goes through it.
2. **Conditions and the action are typed JSON** validated by zod in `shared` (after Vendure): all conditions must match; one action per promotion. A new option is code and a schema change, never a migration.
3. **Order of application:** item discounts, then order discounts on what remains, then delivery. Each discount is rounded to whole taka in the shopper's favour (Q7) and spread over the lines by the largest remainder, so VAT and refunds work per line.
4. **Stacking** (Q10): combinable promotions apply together in priority order; the best exclusive one is compared with all the combinable ones together, and the shopper gets whichever is worth more (a tie keeps the combinable ones). One code per cart, beside the automatic promotions.
5. **Limits hold under concurrent checkouts** through conditional updates on the promotion, the per-phone usage row and the code row; no row updated means the limit was reached. Cancelling gives the uses back. A code already used up is simply not applied, and the cart says why.
6. **Promotions are never deleted:** orders point at them. Staff end them.
7. **The test cart** prices a cart against the live promotions plus the one being built (tried as if live, under a fixed placeholder ID) and lists every promotion with its amount or the reason it didn't apply.
8. **Pages stay cacheable:** automatic promotions aren't printed on product pages, so a campaign starting needs no purge. The announcement bar advertises campaigns.

## Consequences

- At most 50 automatic promotions can be active at once, since each is checked on every cart change.
- A per-customer limit counts by the normalized phone, the one identity a guest checkout has.
