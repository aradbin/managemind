# @managemind/providers

Adapters for outside services, each behind a small interface so a new vendor is a new adapter, never a change to the code that uses it (PLAN.md, pluggable providers).

| Entry | Interface | Adapters |
| --- | --- | --- |
| `@managemind/providers/email` | `EmailProvider` | `resend` (production), `capture` (everywhere else; ADR 0015) |
| `@managemind/providers/hostnames` | `CustomHostnameProvider` | `cloudflare` (Cloudflare for SaaS on the store zone; ADR 0019), `fake` (tests and previews) |

Payment, courier and SMS adapters arrive with Phases 5A and 7.
