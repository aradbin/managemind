# ADR 0006: Edge state on the Workers Free plan

- Status: Accepted
- Date: 2026-10-09
- Spike code: `spikes/edge/` (deleted after Phase 1)

## Context

The plan needs per-key counters (login, sign-in code and checkout rate limits), background work (outbox events, delayed payment checks, dead-letter handling), one daily scheduled batch, and a small amount of rarely-changing edge data (domain-to-store map, cache versions). The Workers Free plan allows only 1,000 KV writes a day, so KV cannot hold counters. The plan proposed the rate-limiting binding, with a Durable Object as the fallback.

## Method

`managemind-spike-edge` on the free plan, with:

- the rate-limiting binding (`limit: 5`, `period: 60`);
- a SQLite-backed Durable Object implementing a fixed-window counter (limit 5 per 60 s);
- a queue with a consumer (`max_retries: 2`, retry after 5 s) and a dead-letter queue with its own consumer;
- a Cron Trigger.

All requests came from one client in one Cloudflare location (EWR).

## Results (2026-10-09)

| Check | Result |
| --- | --- |
| Free plan accepts all bindings (rate limit, SQLite Durable Object, two queues with a dead-letter queue, cron) | Yes, deployed without changes |
| Rate-limiting binding, limit 5 per 60 s | **Never limited.** 10 calls back to back, then 30 calls 0.3 s apart, then 30 calls 1 s apart: 70 of 70 allowed |
| Durable Object counter, limit 5 per 60 s | **Exact.** Calls 1–5 allowed, calls 6–10 refused |
| Queue, no delay | Delivered after 2 s |
| Queue, `delaySeconds: 30` | Delivered after 37 s |
| Queue, `delaySeconds: 120` | Delivered after 127 s |
| Queue, `delaySeconds: 1800` (the plan's 30-minute payment re-check) | Delivered after 1,801 s |
| Message that always fails | Delivered 3 times (first attempt plus 2 retries, about 6 s apart), then moved to the dead-letter queue, whose consumer received it after 18 s |
| Cron Trigger (`17 * * * *`) | Ran once on schedule (handler started at 18:17:53 UTC, within a minute of the scheduled time). The account has 5 cron triggers and no other Worker uses any |

The binding's documentation calls it "permissive, eventually consistent" and "intentionally designed to not be used as an accurate accounting system". Others report the same heavy overshoot. On this setup it did not enforce at all.

Durable Object limits on the free plan (Cloudflare pricing page, 2026-10-09):
- 100,000 requests a day;
- 13,000 GB-s of duration a day;
- 5 million SQLite rows read a day;
- 100,000 SQLite rows written a day;
- 5 GB stored.

The free plan supports only SQLite-backed Durable Objects.

## Decision

1. **Rate limits use a Durable Object, not the rate-limiting binding.**
   - **Scope:** one Durable Object per limited key (for example `login:<email>`, `otp:<phone>`, `checkout:<ip>`).
   - **Storage:** counters are kept in memory with a fixed window, so they write no SQLite rows. If an object is evicted, its count restarts. That fails open for at most one window, which is acceptable for throttling.
   - **Which endpoints:** only sensitive ones, namely sign-in, code requests, checkout, return requests and the contact form. Never every request, so usage stays far below 100,000 requests a day.
   - **On Workers Paid:** the same design applies, with a larger allowance.
2. **Queues as planned.**
   - One queue for outbox events with a dead-letter queue, `max_retries` set per queue.
   - Consumers are idempotent by event ID.
   - Delayed messages handle work due later (payment re-check).
   - The dead-letter consumer records the message and raises an alert.
3. **One Cron Trigger per deployable Worker**, running the daily batch (two of the account's five).
4. **KV only for the domain-to-store map and cache versions**, written only when a store or domain changes.
5. **Astro sessions off and the Astro image service set to passthrough**, as confirmed by the storefront spike (ADR 0004).

## Consequences

- Each rate-limited request costs one extra Durable Object call (a few milliseconds of latency, no database query).
- Queue operations count against the free plan's 10,000 a day: writing, reading and deleting a message each count. That is about 3,000 events a day, enough for the pilot. The Phase 5B platform dashboard tracks this.
- The binding is not used anywhere. If Cloudflare makes it reliable later, it could replace the Durable Object for coarse limits, but that needs a new measurement first.
