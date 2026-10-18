# ADR 0022: Shopper email from the store domain

- Status: Accepted. Production needs the Brevo API key from the owner (phase-4-plan §1); until then shopper accounts stay off.
- Date: 2026-10-17
- Plan: phase-4-plan §1, §3.11, Q2. Code: `packages/providers/src/email/brevo.ts`, `apps/api/src/auth/email.ts`
- Builds on: ADR 0014 (staff email through Resend)

## Context

Phase 4's first shopper email is the account sign-in code. It must come from the store, not from the platform's staff address. Resend's free plan allows one domain, and that is the platform's main domain (ADR 0014).

## Decision

1. **Brevo's free plan** (300 emails a day) sends shopper email from `no-reply@{STORE_DOMAIN}` (`managemind.store`), with the store's name as the sender's name and the store's contact email, when it has one, as Reply-To.
2. **The `brevo` adapter** is one `fetch` to Brevo's transactional API, beside `resend` and `capture` behind the same `EmailProvider` interface. Brevo has no idempotency key, so a retry after a timeout can send a second copy; for a sign-in code that is harmless.
3. **`SHOPPER_EMAIL_PROVIDER`:** `brevo` in production once `BREVO_API_KEY` exists; `capture` (the dev mailbox) locally and on previews; `none` otherwise, the production default. Production refuses `capture`.
4. **With `none`, accounts can't be on:** the admin's switch is refused with a clear message, and every account route answers 404.
5. **Templates** stay code, in Bangla and English, in the store's language; the code is never in the subject. Editable per-store templates arrive with Phase 5A's shopper notifications.

## Consequences

- The owner creates the Brevo account, verifies `managemind.store` (Brevo shows the DKIM and SPF records; the provisioning step can add them through the Cloudflare API), adds DMARC at `p=none`, and sets `BREVO_API_KEY` as a Worker secret with `SHOPPER_EMAIL_PROVIDER=brevo`.
- 300 a day is plenty for sign-in codes; order notifications (Phase 5A) will need the paid tier or a second provider, decided then.
