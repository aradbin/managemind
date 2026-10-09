# Spike: auth (ADR 0005)

Throwaway Worker with two Better Auth instances on Workers: staff (`platform` schema, email + password, organization plugin) and shoppers (`store` schema, email codes, `tenant_id` + FORCE RLS, every request inside one tenant transaction). Not production code; deleted after Phase 1.

## Setup used

- The Neon branch `spike` from ADR 0002, plus `schema.sql` (applied as the owner role).
- The Hyperdrive config from ADR 0002, bound as `HYPERDRIVE`.
- Secrets: `AUTH_SECRET`, `SPIKE_TOKEN`.

```sh
pnpm --filter @managemind/spike-auth deploy
```

## Endpoints (all need `?k=<SPIKE_TOKEN>`)

| Path | Purpose |
| --- | --- |
| `/staff/api/auth/*` | Staff instance. Header `x-spike-hash: pbkdf2` switches to PBKDF2 hashing |
| `/store/<A\|B>/api/auth/*` | Shopper instance for store A or B, inside a tenant transaction. Header `x-spike-cc: 1` turns on the cookie cache (to show cross-store replay) |
| `?cache=1` on either | Reuse one instance per isolate with a per-request database proxy |
| `/probe/hash?algo=<scrypt\|pbkdf2>&iter=<n>` | Hash one password, nothing else |
| `/probe/init` | Build both instances, no database |

The spike logs that a sign-in code was sent but never the code; the test harness read codes from `store.shopper_verifications` as the owner role.
