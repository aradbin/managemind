# Runbook: a provider is down

The stores keep selling through most outages. Find the provider in the table, then tell the affected clients what to expect.

| Provider | What stops | What still works | What to do |
| --- | --- | --- | --- |
| **SSLCommerz** (a store's gateway) | Online payment at checkout | COD; payments already made settle when its IPN or the delayed check gets through | Nothing in code. A store can turn online payment off in its payment settings until it's back |
| **SSLCommerz** (ours) | Paying our invoices online | Bank, bKash and Nagad, recorded by hand | Nothing; tell the client to pay another way |
| **SMS gateway** (a store's) | Order texts and phone sign-in codes | Email, the tracking page, COD without the phone code if the store turns that off | The delivery log shows the failures (Settings → Messages); queued texts retry with the event |
| **Resend** | Staff sign-in codes and staff email; shopper email through Resend | Staff already signed in keep working | Check status.resend.com. If it lasts, sign-in for new sessions waits; nothing to switch to on the free plan |
| **Brevo** | Shopper email from the store domain | Everything else | As Resend |
| **Neon** | Everything that reads the database: admin, checkout, uncached store pages | Cached store pages | Check neonstatus.com. Nothing to do but wait; check `/health/deep` after |
| **Cloudflare** | Everything | — | Check cloudflarestatus.com |
| **Couriers** | (Phase 7) | — | — |

## Afterwards

- Look at the dead letters in the morning's usage alarm (`free-tier-limit.md`): events that failed during the outage go there after their retries.
- Sentry groups the errors by provider; resolve them once the provider is back.
