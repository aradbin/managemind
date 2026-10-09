# ADR 0013: Free plan first, Workers Paid later, and which workarounds we keep

- Status: Accepted
- Date: 2026-10-09
- Supersedes: ADR 0005 decision 4 (caching Better Auth instances per isolate); settles ADR 0002's open question about a second database driver

## Context

The spikes measured CPU time against the Workers Free plan's 10 ms per request:

- the database path costs about 9 ms (ADR 0002);
- a session check costs about 7–11 ms (ADR 0005);
- a password sign-in costs 37–89 ms.

A signed-in API request will therefore exceed 10 ms whatever we optimise. Cloudflare documents "some built-in flexibility" for Workers that *infrequently* run over the limit, and termination with error 1102 for Workers that exceed it consistently. In the spikes, a few hundred requests that nearly all ran over (15–200 ms) were never terminated.

Workers Paid ($5 a month for the account) raises the limit to 30 s of CPU per request. The owner decided on 2026-10-09: stay on the free plan for now, and move to Workers Paid when real traffic and serious clients arrive. Workarounds should be kept only where they are really needed, and this ADR says what happens to each one at the switch.

## Decision

### 1. Workarounds are not a safety net; an alarm is

Optimising further cannot get signed-in requests reliably under 10 ms, and every workaround adds code and its own risks. So:

- The code is written plainly and leanly. There are no free-plan tricks that make it harder to read or easier to get wrong.
- The browsing traffic that dominates usage is kept off the API entirely, through the edge cache the plan already requires. This is good design on any plan.
- **The alarm:** the API and storefront Workers are monitored for the `exceededCpu` outcome and for p99 CPU (Workers Analytics, read daily, with an alert). **The first CPU termination in production, or the first serious client, is the trigger to move to Workers Paid.**
- The CPU budget spike (ADR 0003) changes accordingly. Instead of tuning requests under 10 ms, it measures the real request and page, then runs a sustained load at pilot-like traffic to see whether the free plan terminates anything.

### 2. What each workaround becomes

**Keep on every plan.** These are good design, not workarounds:

| Item | Why it stays |
| --- | --- |
| API Worker placed next to Neon (`aws:ap-southeast-1`) | About 3× faster from Bangladesh (ADR 0002) |
| Guarded `app.current_tenant_id()` and transaction-local tenant setting | Security: blocks the pooled-connection leak (ADR 0002) |
| `BEGIN` and tenant setting in one round trip | Saves a round trip on every request; small and tested |
| Hyperdrive query cache off | Security: the cache does not know about RLS |
| Better Auth cookie cache off | Security: it allowed cross-store session replay (ADR 0005) |
| Catalog pages and public API responses cached at the edge | Speed for shoppers, fewer database wake-ups, lower Neon compute |
| Photos resized in the browser, Astro image service off, Astro KV sessions off | Cost and speed, and no paid image service |
| KV only for rarely changing data; rate limits on the rate-limiting binding | KV writes are limited on every plan (paid includes 1 million a month); counters do not belong in KV |
| No secrets in URLs | Workers Logs record every URL |

**Free plan only, changed at the switch:**

| Item | Now (free) | At the switch to Workers Paid |
| --- | --- | --- |
| Staff sign in with email codes; no passwords | Password hashing costs 37–89 ms. A login form would also let anyone burn CPU with repeated attempts. | Offer email and password as an extra method with Better Auth's default scrypt. The `accounts.password` column already exists. Email codes stay; passkeys are added on either plan. |
| Daily alert on `exceededCpu` | It is the trigger for the switch. | Becomes a normal performance alert on p99 CPU and duration. |

**Dropped now, not built:**

| Item | Why it is dropped |
| --- | --- |
| One Better Auth instance cached per isolate, with an `AsyncLocalStorage` database proxy (ADR 0005, decision 4) | It saves about 3.5 ms but does not bring signed-in requests under 10 ms. It also shares one instance across stores, which makes per-store settings (base URL, per-store secret) harder and shared state riskier. Instances are built per request. Revisit only if a measurement on the paid plan shows a real need. |
| A second database driver (Neon HTTP) for read-only requests | It saves CPU but doubles the data-access code paths and tests. One driver: node-postgres over Hyperdrive. |

**Kept because of Neon's free plan, not Workers.** These are reviewed when Neon moves to a paid plan, which is a separate trigger in PLAN.md:

| Item | Reason |
| --- | --- |
| No timer that touches the database; daily cron batch; delayed queue messages instead of polling | Every wake-up costs at least 5 minutes of Neon compute out of 100 CU-hours a month |
| Outbox relayed right after commit, with only a daily sweep for leftovers | An hourly sweep would cost about 15 CU-hours a month |

## Consequences

- The free plan carries a small, monitored risk that some signed-in requests get terminated if Cloudflare decides our overruns are "consistent". The alarm turns that risk into a clear, cheap decision ($5 a month) instead of an outage nobody understands.
- The code is not shaped around a limit we expect to leave, so the switch is a billing change plus enabling passwords. No refactor is needed.
- PLAN.md's growth table gains the new trigger, and a checklist for the switch lives in this ADR.

## Switch checklist (Workers Paid)

1. Upgrade the account in the Cloudflare dashboard (owner).
2. Change the `exceededCpu` alert into a p99 CPU and duration alert.
3. Offer email and password sign-in for staff (scrypt, rate-limited), as an option alongside email codes.
4. Re-check the free-tier budget table in PLAN.md: requests, Hyperdrive queries and Queues operations all get larger allowances on Workers Paid.
5. Record the switch date and the trigger that caused it in this ADR.
