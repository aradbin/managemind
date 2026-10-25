# ADR 0030: Couriers: book outside transactions, believe only the courier's answer, map areas once

- Status: Accepted
- Date: 2026-10-25
- Plan: phase-7-plan §3, Q5–Q9, Q14. Code: `packages/shared/src/orders/couriers.ts`, `packages/providers/src/couriers/`, `packages/core/src/couriers/`, `apps/api/src/couriers.ts`, `scripts/couriers/`
- Builds on: ADR 0010 (outbox), ADR 0013 (free plan), ADR 0024 (credentials vault), ADR 0027 (jobs in Actions)

## Context

Stores send most orders through Steadfast, Pathao or RedX. Each courier has its own API: Steadfast takes a free-text address, while Pathao and RedX need their own area IDs. Each pushes status updates to a webhook, and each pays the store its collected cash in batches. Booking a parcel and settling COD move money and stock, so the design has to survive the following:

- retries and double taps;
- forged or lost webhooks;
- couriers skipping steps;
- the Workers Free plan's limits: 10 ms of CPU, and 50 subrequests per invocation;
- Neon's compute budget.

## Decision

1. **Two new shipment states, `booked` and `in_transit`.** `shipped` stays the pickup, where stock is sold, so every existing report, the score and the delivery status keep their meaning. The courier's finer statuses are events in `store.shipment_events`, not states.
2. **A sync walks the machine** (`shipmentPath`) by the shortest legal path to the courier's state, applying each step's effects. A parcel reported delivered while still `booked` here is shipped (stock sold), then delivered (COD settled).
3. **Booking never holds a transaction over a network call.**
   - A conditional update claims the shipment (`booking_state = 'booking'`).
   - The courier is called outside any transaction.
   - A second transaction records the answer.
   - When no answer comes, the shipment is `unsure`. The next try asks the courier for our invoice first where the API allows it, and otherwise asks staff to check the courier's panel. It never books blindly (Q7).
4. **Webhooks are hints.** A token or signature is checked where the courier has one. Then the handler asks the courier about the named parcel with the store's own credentials, and applies only that answer, as the SSLCommerz IPN does. No secret is ever in the URL.
5. **Polling is by Cron, twice a day,** for open shipments quiet for 6 hours. The runs fall in business hours, when Neon is usually awake anyway. Per-parcel delayed messages would wake it at any hour and cost three queue operations each (Q14). Shipments open 30 days stop being polled.
6. **Bookings and polls run as batches** on the delayed-work queue (`managemind-domains`, by `kind`), 10 bookings or 20 polls to a message, under the Free plan's 50 subrequests per invocation.
7. **Courier areas are platform data** (`ref.courier_areas`, `ref.courier_area_map`): the same for every merchant, matched once.
   - A weekly GitHub Actions job fetches the lists with the platform's own tokens. Pathao's take hundreds of requests, beyond what one Worker invocation may make.
   - The job matches our areas by name within a district, and a super admin reviews the rest.
   - Staff pick an area at booking when there's no match. That pick is used for the one shipment and shown to the review; it never changes the mapping by itself.
8. **COD is settled for what the courier collected.** A different amount, or a partial delivery, flags the order rather than hiding the difference. A parcel the courier returned is restocked only when staff confirm it arrived, unless the store turns on `autoReceive` (Q9).
9. **Courier credentials are vault kinds of their own** (`steadfast`, `pathao`, `redx`, and `fake` outside production). A store can therefore connect several couriers. The webhook secret and Pathao's tokens are sealed in the same blob, so the ciphertext limit rises to 8 KiB.

## Consequences

- **A lost webhook is caught within the day,** not within minutes. Staff can ask at once with **Sync now**.
- **The adapters rest on the couriers' merchant SDKs,** since none publishes complete docs. Each adapter's status map is checked against its sandbox before its courier is offered to stores, and the plan's report says which were.
- **Area matches are shared,** so one super admin fixes them for every store. A wrong match is wrong for every store until fixed, and the booking sheet shows the courier's area name so staff catch it.
- **Polling adds two Cron Triggers.** The account has 5 on the Free plan; this uses 3.
