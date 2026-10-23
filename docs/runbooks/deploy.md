# Runbook: a production deploy

Every merge to `master` deploys production through **Actions → Deploy**. You don't start it; you read it.

## What it does, in order

1. **Provision and migrate:** queues, KV, R2 buckets with their lifecycle rules, the `mm_app` role and Hyperdrive; then the database migrations. Migrations are forward only (see `rollback.md`).
2. **DNS and zone settings:** the route placeholders, Cloudflare for SaaS's fallback origin, the WAF rules.
3. **Worker configs**, then the **API** (with its secrets) and the **storefront**.
4. **Smoke test:** `/health` and `/health/deep` on the API, the admin and a demo store, the shop API (cart and checkout answer with `no-store`) and a storefront cache hit.

The run's summary lists the admin, API and storefront addresses and the commit deployed.

## Reading its warnings

A yellow warning is a feature that stays off, not a failure:

| Warning | Means | To turn it on |
| --- | --- | --- |
| `CF_STORE_TOKEN` | Pages aren't purged, so the storefront doesn't cache them; custom domains are off | Add the secret (README) |
| `Turnstile` | Checkout and sign-in rely on rate limits alone | `TURNSTILE_SITE_KEY` variable and `TURNSTILE_SECRET_KEY` secret |
| `CREDENTIALS_KEY` | Stores can't save SSLCommerz, SMS or email credentials | `pnpm --filter @managemind/scripts keys`; keep a copy offline |
| `Web push` | Staff alerts come by email only | The VAPID pair from the same command |
| `Shopper email` (notice) | Shopper codes come from the platform domain through Resend | `BREVO_API_KEY` |
| `Invoice payment` (notice) | The pay-online button on our invoices is off | `PLATFORM_SSLCOMMERZ_STORE_ID` and `_PASSWORD` |
| `Store jobs` (notice) | Exports and purges start at the daily run, not at once | `GITHUB_DISPATCH_TOKEN` |

A red step stops the deploy. Nothing after it ran: production keeps the previous Workers, but migrations up to that point did apply (they must be backward compatible).

## After a deploy

1. Open the admin and a demo store. Place nothing; just look.
2. Check Sentry for new errors in the next 15 minutes.
3. If the smoke test failed, or errors started: `rollback.md`.
