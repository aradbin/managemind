# ADR 0010: Outbox relay without polling

- Status: Accepted
- Date: 2026-10-09

## Context

Side effects (email, SMS, courier sync, cache refresh) must never run inside a request's transaction, and an order must never fail because a provider is down. PLAN.md uses a transactional outbox: the event is written in the same transaction as the change, and something else delivers it to Cloudflare Queues.

The usual "something else" is a poller that checks the outbox every few seconds. Here that is expensive. Each wake-up of Neon costs at least 5 minutes of compute: an hourly sweep alone is about 15 CU-hours a month, a sixth of the free plan's 100. PLAN.md also rules out database timers on a short interval.

## Options

1. **Poll the outbox on a short cron.** Simple and reliable, but it keeps Neon awake all day.
2. **Relay right after commit, plus a daily sweep for leftovers.** No timers; events normally leave within milliseconds of the commit.
3. **Logical replication / change data capture.** Not available to Workers, and too heavy for the platform's size.

## Decision

Option 2.

1. **Emit:** `emit(tx, type, input)` validates the payload against the event's zod schema (`packages/core/src/events.ts`), inserts the row into `store.outbox` inside the caller's `withTenant` transaction, and records the event on the transaction.
2. **Relay after commit:** `withTenant(..., { afterCommit })` calls the relay only after a successful commit, so a rolled-back command emits nothing. The API runs the relay with `ctx.waitUntil()`, which means the response does not wait for it.
   - **Order of operations:** `relayEvents` sends the batch to the queue, then calls `app.outbox_mark_dispatched(ids)`.
   - **Retries:** up to 3 attempts with exponential backoff (100 ms, 200 ms).
   - **On failure:** it records `attempts` and `last_error` through `app.outbox_mark_failed` and returns. It never throws.
3. **Daily sweep:** the daily Cron Trigger calls `app.outbox_claim(batch, min_age => 5 minutes)`, relays what it gets, and alerts through Sentry when anything was left over.
   - **Locking:** it uses `FOR UPDATE SKIP LOCKED`, so a sweep never takes an event still held by an open request transaction.
   - **Rows ignored:** events younger than `min_age`, which the request path may still be relaying.
   - **Cleanup:** the same daily batch deletes dispatched events older than 7 days (`app.cleanup_expired`).
4. **At-least-once delivery:** an event can be sent twice, for example when the queue accepts it but marking it fails. Consumers deduplicate on the event ID (the outbox row ID, a UUIDv7).
5. **Cross-tenant access:** the sweep and the mark functions work across tenants, so they are `SECURITY DEFINER` functions owned by `mm_system` (ADR 0009). The app role cannot read or update other tenants' events directly.
6. **The index exception:** `outbox_pending_idx` on `(created_at) WHERE dispatched_at IS NULL` deliberately does not start with `tenant_id`, because the sweep looks across tenants. It is the catalog test's only allow-listed index.

## Consequences

- No timer wakes the database. Events normally reach the queue moments after the commit.
- **The cost:** an event whose relay fails all three attempts waits until the next daily sweep. For order notifications that means a delay, not a loss, and the failure is visible through `last_error`, the Sentry alert and the outbox count on the platform dashboard (Phase 5B).
- **If Neon moves to a paid plan,** an hourly sweep can be added without code changes (ADR 0013).
- **Queues operations:** each event costs a write, a read and a delete. That is about 3,000 events a day on the free plan (ADR 0006).
