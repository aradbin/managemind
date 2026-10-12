# @managemind/providers

Adapters for outside services, each behind a small interface so a new vendor is a new adapter, never a change to the code that uses it (PLAN.md, pluggable providers).

| Entry | Interface | Adapters |
| --- | --- | --- |
| `@managemind/providers/email` | `EmailProvider` | `resend` (production), `capture` (everywhere else; ADR 0015) |

Payment, courier and SMS adapters arrive with Phases 5A and 7.
