# Spike: CPU budget and bundle size, API (ADRs 0003 and 0004)

Throwaway Worker built like the real API: Hono with `@hono/zod-openapi`, Drizzle over Hyperdrive, one Better Auth staff instance per request, zod-validated output, `@sentry/cloudflare`. Placed in `aws:ap-southeast-1`. Uses the `spike` Neon branch and the staff tables from `spikes/auth/schema.sql`. Deleted after Phase 1.

| Route | Purpose |
| --- | --- |
| `GET /v1/admin/products` | The "typical API request": session check, tenant transaction, 4 queries, about 5 KB of JSON |
| `GET /v1/store/products`, `GET /v1/store/products/{id}` | Anonymous store routes, called by the storefront spike over its service binding |
| `POST /api/auth/*` | Better Auth, used once to create a staff session for the load test |
| `GET /openapi.json` | Generated OpenAPI document |

All routes need `?k=<SPIKE_TOKEN>` or the `x-spike-key` header. `?trace=1` adds an `x-exec-colo` header showing where the Worker ran.

```sh
pnpm --filter @managemind/spike-cpu-api deploy
pnpm --filter @managemind/spike-cpu-api bundle   # dry run into dist/ for size checks
```
