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
| **WhatsApp Cloud API** (a store's) | Order updates and confirmation buttons by WhatsApp | Each update's SMS goes instead: at once when Meta refuses, or 10 minutes later when Meta says nothing (phase-9-plan §3.2.2); email; the tracking page | Nothing in code. The message log shows the failures. A template Meta paused or disabled shows on Settings → Facebook and Instagram, and its updates go by SMS until it is approved again |
| **Meta Conversions API** (a store's pixel) | Purchases reported from the server | The browser pixel, for shoppers who accepted cookies | Nothing. A failure Meta may accept later is retried with the event; a refused token shows on Settings → Facebook and Instagram until the owner pastes a new one. Meta accepts events up to 7 days old |
| **Meta catalog** (Commerce Manager fetching the feed) | New prices and stock in Facebook and Instagram shops and ads | The feed itself keeps building; Meta catches up at its next fetch | Nothing. If a feed build fails, the error shows on the settings page; **Rebuild now** tries again |
| **A courier** (Steadfast, Pathao, RedX) | Booking with it, and its status updates | Bookings with another connected courier; manual shipments; parcels already booked are picked up as usual | Nothing in code. A booking that got no answer is marked *unsure* on the order: check the courier's panel before booking again. Updates that failed come back with the courier's retries, or the next poll (13:17 and 19:17 in Dhaka); **Ask now** on the order asks at once (phase-7-plan §3.5) |

## Afterwards

- Look at **Platform → Dashboard → Failed messages waiting**: events that failed during the outage go to the dead-letter queues after their retries. The count comes from the morning's usage alarm run, which records it for the dashboard but doesn't raise an alarm for it, and it covers the outbox and import queues only, not `managemind-purge-dlq` (check that one in the Cloudflare dashboard, under Queues).
- Sentry groups the errors by provider; resolve them once the provider is back.
