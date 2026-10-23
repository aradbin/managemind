# ADR 0025: Notifications from the outbox, with a delivery log

- Status: Accepted
- Date: 2026-10-18
- Plan: phase-5a-plan §3.6–§3.9, Q6, Q8. Code: `packages/core/src/notifications/`, `packages/shared/src/notifications/`, `apps/api/src/notifications.ts`
- Builds on: ADR 0010 (outbox), ADR 0014 and ADR 0022 (email senders), ADR 0024 (credentials)

## Context

Order, payment, shipment, return and refund events must reach the shopper (email, SMS) and staff (push, email). Queue delivery is at least once, and providers fail now and then. A shopper must never get the same "order placed" SMS twice, which the store pays for, and a store without SMS must run with no errors. Every environment shares the platform's free email allowance.

## Decision

1. **Planning reads the outbox event and today's data.** The outbox consumer turns an event into messages: one per recipient and channel, as the store's settings and each staff member's choices say. The plan is a function of the event and the database, so a redelivered event plans the same messages.
2. **The delivery log (`store.messages`) is the idempotency.** Each message's key is the event ID, message event, channel and recipient, unique per store.
   - Only `queued` rows are sent. A sent, skipped or permanently failed message is never sent again.
   - A retryable failure stays `queued`, and the queue's retry of the event sends just that one.
3. **What can't go out is skipped with a reason, not failed:**
   - `no_gateway`: the store has no SMS gateway (acceptance criterion 3);
   - `no_address`: the shopper gave no email;
   - `no_device`: a staff member has no push device;
   - `quota`: the shared email allowance is past 70%.
4. **Sending happens outside the transaction.** One transaction plans, records and renders; the sends follow; a second transaction records the outcomes.
5. **Templates are code defaults with per-store overrides.**
   - Overrides are keyed by event, channel and locale.
   - Each event has a fixed variable list. Saving refuses unknown variables, and values are escaped for HTML email.
   - The defaults' wording is the owner's to approve (phase-5a-plan PR 5).
6. **Email senders:**
   - a store's own Resend or Brevo key, sealed in the vault, sends from the store's domain and falls back to the platform sender if it fails;
   - otherwise the platform sender (ADR 0022), which counts against the shared daily quota.

   Past 70% of the quota, shopper updates other than "order placed" are skipped, so sign-in codes and staff alerts keep the rest (Q6).
7. **Secrets never go through the outbox.** Sign-in codes and OTPs are sent directly after the response, as staff codes are (ADR 0014).

## Consequences

- **Database cost:** a message costs a few queries (the log row, the template lookup, the outcome), within the Free plan at pilot volume (phase-5a-plan §11).
- **The log is kept 90 days** (PLAN.md's retention table), then deleted by the daily cleanup.
- **Staff SMS isn't offered:** staff users have no phone number in their profile. Push and email cover staff, and SMS stays a shopper channel.
- **SMS and push plug into one place,** the API's `send`, as their adapters arrive (plan PRs 6 and 12). Until then a store can't save an SMS gateway, so no SMS is ever queued.
