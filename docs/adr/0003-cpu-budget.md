# ADR 0003: CPU budget on the Workers Free plan

- Status: Accepted. The daily check (decision 2) reads Workers Logs rather than Workers Analytics, and judges the percentiles only on days with at least 200 requests (`scripts/monitor/usage.ts`).
- Date: 2026-10-09
- Spike code: `spikes/cpu-api/`, `spikes/cpu-store/` (deleted after Phase 1)
- Related: ADR 0013 (free plan first; the first CPU termination triggers Workers Paid)

## Context

The free plan allows 10 ms of CPU per request. Cloudflare documents "some built-in flexibility" for Workers that *infrequently* run over the limit, and termination (error 1102, outcome `exceededCpu`) for Workers that exceed it consistently. ADR 0013 decided not to bend the code around 10 ms. Instead, this spike measures the real request types and checks whether a sustained load at pilot-like traffic gets terminated. The result sets the alarm thresholds.

## Method

- **API spike** (`managemind-spike-cpu-api`), built like the real API:
  - Hono with `@hono/zod-openapi`, Drizzle over Hyperdrive;
  - a Better Auth staff instance built per request, zod-validated output, Sentry SDK (disabled; no DSN yet);
  - placed in `aws:ap-southeast-1`.
- **Storefront spike** (`managemind-spike-cpu-store`): Astro 7 SSR on `@astrojs/cloudflare` 14, not placed. It renders a product page (about 20 fields, 8 related products, Bangla by default) from the API over a service binding.
- **Request types:**
  - **signed-in admin request:** `GET /v1/admin/products`, a session check, a tenant transaction, 4 queries and about 5 KB of zod-validated JSON;
  - **anonymous store API request:** `GET /v1/store/products/{id}`, a tenant transaction, 2 queries, called by the storefront;
  - **product page:** `GET /products/{id}`, Astro server rendering, one service-binding call.
- **Sustained load:** 30 minutes (17:42–18:12 UTC, 2026-10-09). Each loop sent one admin request and one product page, then paused 1 s: 1,784 client requests, about 60 a minute, half of them signed in. The pilot estimate is about 1–2 signed-in requests a minute in total, so this is roughly 30–60 times the pilot's signed-in rate. One redeploy at the start; the first 4 minutes are excluded from the steady-state figures.
- **Sources:** CPU per invocation from Workers Logs (`$workers.cpuTimeMs`); invocation status from Workers Analytics (GraphQL).

## Results

### CPU per request, steady state (ms)

| Request | n | p50 | p90 | p99 | max | Over 10 ms |
| --- | --- | --- | --- | --- | --- | --- |
| Signed-in admin request | 752 | **13** | 22 | 31 | 122 | 64% |
| Anonymous store API request (via service binding) | 753 | **6** | 10 | 16 | 59 | 7% |
| Product page, server-rendered | 749 | **3** | 6 | 16 | 27 | 2% |

### Terminations

- **None.** All 1,784 client requests returned 200.
- Workers Logs recorded 2,571 invocations across both Workers, every one with outcome `ok`.
- Workers Analytics shows every invocation on the account in the test window (1,873) as `success`, with 0 errors.
- This is consistent with the earlier spikes, where a few hundred requests at 15–200 ms were never terminated either.

### Placement through the service binding

When the storefront (running near the caller, EWR) called the API over its service binding, the API ran in SIN. Placement applies to service-binding calls, which settles the question left open in ADR 0002.

## Decision

1. **No CPU tuning now.** At about 60 times the pilot's signed-in rate, a Worker with two thirds of its requests over 10 ms was not terminated.
   - **Shopper requests fit already:** a product page takes 3 ms and an anonymous store API call 6 ms.
   - **Staff requests, the ones over the limit, are a small share of traffic** in a store platform.
2. **Alarm thresholds** (ADR 0013), checked daily from Workers Analytics, alerting the owner:
   - any invocation with status `exceededCpu` or `exceededResources` on the API or storefront Worker means **move to Workers Paid**;
   - API p99 CPU above 50 ms for a day: investigate (a regression, or a route that needs work);
   - storefront p90 CPU above 10 ms for a day: investigate, because shopper pages are expected to stay well inside the limit.
3. **Keep the shapes that made shopper traffic cheap:**
   - storefront pages are rendered from small, purpose-built store API responses;
   - catalog pages are edge-cached (Phase 3), so most shopper requests do not even reach the API.

## Consequences

- The free plan stays viable for the pilot with no free-plan-specific code. The remaining risk is that Cloudflare's tolerance changes or that real traffic differs, and the alarm covers that.
- Every later phase re-runs this measurement on the preview environment for its new routes (part of the definition of done for performance), so a slow route is found before it reaches production.
- Sentry was disabled in the spike. Its CPU cost is measured when the DSNs arrive (PR 15); if it adds more than 2 ms at p50, error-only mode (no tracing) is already the configuration.
