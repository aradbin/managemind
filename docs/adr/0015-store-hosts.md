# ADR 0015: Store addresses, host resolution and the KV host map

- Status: Accepted
- Date: 2026-10-14
- Plan: phase-1-plan §3.1, §3.2, §4.3 and §4.4. Code: `packages/core/src/tenancy/hosts.ts`, `apps/api/src/kv-sync.ts`

## Context

Every storefront request has to find its store from the hostname, and the storefront Worker runs on the Free plan's 10 ms of CPU. Stores have a default address under the store domain and, from Phase 3, custom domains. PLAN.md also expects the store domain to be replaceable ("change `STORE_DOMAIN` and deploy; default store addresses move"), and previews share one database while each has its own `STORE_DOMAIN` (ADR 0011).

## Decision

1. **The default address is derived, never stored.** A store's default address is `{slug}.<STORE_DOMAIN>`. The slug can't change after creation (a database trigger), so the address is stable within an environment, and changing `STORE_DOMAIN` moves every store with no data change.
2. **Custom domains are rows** in `platform.tenant_domains` (Phase 3), each `pending`, `active`, `failed` or `removed`, with at most one active primary. The primary is the store's canonical host; without one, the default address is.
3. **Resolution order** (`resolveHost`): an active custom domain, then the slug in a default address. Hosts are lowercased and lose any port and trailing dot. Active and suspended stores resolve (a suspended store shows a maintenance page); closed and purged stores don't.
4. **The KV map** `host:<hostname>` → `{ tenantId, slug, name, defaultLocale, status, primaryHost }` is what the storefront reads first. Host keys are the one KV shape without a tenant prefix, because the tenant is what the lookup finds; every other key is `t:<tenant_id>:…`. Both come only from `hostKey` and `tenantKey` in `packages/shared`.
5. **Only the outbox consumer writes the map**, on `tenant.created`, `tenant.updated`, `tenant.status_changed` and `tenant_domain.*`. It recomputes a store's entries from the database (`hostEntries`) and writes only keys whose value differs, so redeliveries and duplicate events cost no writes. Several events for one store in a batch become one sync. A failed sync retries that store's messages.
6. **A KV miss falls back to `GET /v1/store/context`**, which reads the database and never writes KV, so requests for random hosts can't spend the 1,000 daily writes.
7. **Previews have no KV binding and no consumer**, so they always use the fallback. Production binds the `managemind-edge` namespace created by provisioning.

## Consequences

- One or two KV writes per store change; typical days stay far below the Free plan's 1,000.
- KV is eventually consistent (up to about a minute between locations). A store's name or status change can take that long to reach every storefront; suspension isn't instant at the edge. Phase 3's page cache keys by URL and will need its own purge on these events.
- A store-domain change needs the old keys removed and the new ones written: the `kv:sync` CLI command (PR 11) recomputes every store. The old keys can also simply be left to be deleted, since nothing points at the old domain.
- Purge (Phase 5B) deletes a store's host keys through `hostEntries`, which returns every key the store ever had while it is closed.
