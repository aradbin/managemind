# Spike: database path (ADR 0002)

Throwaway Workers that measure the database path from Cloudflare to Neon. Not production code; deleted after Phase 1.

## Setup used

- Neon branch `spike` with schemas `app` and `store`, roles `app_rw` (NOLOGIN) and `mm_app` (LOGIN, in `app_rw`), and tables `store.notes` and `store.notes_guarded` (FORCE RLS, 500 rows each for two tenants). The SQL is in ADR 0002.
- A Hyperdrive config for the branch as `mm_app` with caching disabled, bound as `HYPERDRIVE`.
- Secrets on both Workers: `NEON_URL` (direct connection string for `mm_app`) and `SPIKE_TOKEN`.

## Deploy

```sh
pnpm --filter @managemind/spike-db deploy          # default placement
pnpm --filter @managemind/spike-db deploy:placed   # placement.region = aws:ap-southeast-1
```

## Endpoints (all need `?k=<SPIKE_TOKEN>`)

| Path | Purpose |
| --- | --- |
| `/run?driver=<pg\|pg-packed\|drizzle-pg\|postgresjs\|neon-http\|neon-ws\|pg-connect>&tenant=<A\|B>` | One "set tenant + 3 queries" transaction with step timings; `trace=0` skips the colo lookup |
| `/leak?n=40&poison=<0\|1>&guarded=<0\|1>` | Concurrent transactions for both tenants; reports any rows or settings that leak |
| `/` | Page for measuring from real networks; runs every driver on both Workers three times |

CPU time per request comes from Workers Logs (`$workers.cpuTimeMs`), not from the Worker itself.
