# Spike: per-store cache invalidation (ADR 0007)

Throwaway Worker checking, on the Free plan: the Cache API on custom domains, purging Cache API entries by tag, hostname, prefix and URL, the purge rate limit, and the fallback (a per-store catalog version from KV in the cache key). Deleted after Phase 1, with its two custom domains and its KV namespace (`managemind-spike-cache`).

```sh
wrangler kv namespace create managemind-spike-cache   # id goes in wrangler.jsonc
pnpm --filter @managemind/spike-cache deploy
wrangler secret put SPIKE_TOKEN
```

| Path | Purpose |
| --- | --- |
| `GET /t/<store>/p/<product>` | Page cached with `Cache-Tag: tenant:<store>,tenant:<store>:product:<product>` |
| `GET /v/<store>/p/<product>[?ttl=<s>]` | Page cached under the store's catalog version from KV |
| `POST /bump/<store>?k=<SPIKE_TOKEN>` | Writes a new catalog version |

Each response has `x-cache` (HIT or MISS) and `x-colo`.

`run.mjs <step>` runs the experiments: `purges`, `manyTags`, `rateLimit`, and `version [ttl]` (needs `SPIKE_TOKEN`). From a cloud session, run it with `NODE_USE_ENV_PROXY=1` so the proxy adds the Cloudflare token.
