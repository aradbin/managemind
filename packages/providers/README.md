# @managemind/providers

Adapters for outside services, each behind a small interface so a new vendor is a new adapter, never a change to the code that uses it (PLAN.md, pluggable providers).

| Entry | Interface | Adapters |
| --- | --- | --- |
| `@managemind/providers/email` | `EmailProvider` | `resend` (staff email, and shopper email until Brevo's key exists), `brevo` (shopper email from the store domain; ADR 0022), `capture` (everywhere but production; ADR 0014); also the email templates and sending with retries |
| `@managemind/providers/hostnames` | `CustomHostnameProvider` | `cloudflare` (Cloudflare for SaaS on the store zone; ADR 0019), `fake` (tests and previews) |
| `@managemind/providers/sms` | `SmsProvider` | `sms.net.bd`, BulkSMSBD, and a generic HTTP gateway; each store uses its own gateway (phase-5a-plan §3.14) |
| `@managemind/providers/couriers` | `CourierProvider` | `steadfast`, `pathao`, `redx`, and `fake`, the test courier for previews (ADR 0030) |
| `@managemind/providers/sslcommerz` | — | SSLCommerz v4: sessions, validation, the transaction query and refunds, on each store's own merchant account (phase-5a-plan §3.3) |
| `@managemind/providers/push` | — | Web Push to staff browsers, signed with the platform's VAPID key (phase-5a-plan §3.9) |
| `@managemind/providers/turnstile` | — | A Turnstile widget's hostname list, kept in step with stores' custom domains (ADR 0023) |
