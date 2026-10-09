# Spike: CPU budget and bundle size, storefront (ADRs 0003 and 0004)

Throwaway Astro 7 storefront on Workers (`@astrojs/cloudflare` 14, `session: false`, `imageService: 'passthrough'`). `GET /products/{id}?k=<SPIKE_TOKEN>[&lang=en]` server-renders a product page with about 20 fields and 8 related products, in Bangla by default, with data fetched from `managemind-spike-cpu-api` over the `API` service binding. Deleted after Phase 1.

```sh
pnpm --filter @managemind/spike-cpu-store deploy   # astro build && wrangler deploy
```

Secret: `SPIKE_TOKEN`. The Worker is not placed; the API it calls is.
