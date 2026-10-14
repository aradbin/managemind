# ADR 0014: Email provider for staff email

- Status: Accepted
- Date: 2026-10-11
- Plan: phase-1-plan §3.8, §5.7 (Q1 and Q9, decided Oct 11)

## Context

Phase 1 sends the platform's first emails: staff sign-in codes, invitations and support-access notices, all from the main domain. Staff can't sign in without them. PLAN.md requires a free tier, a provider behind an interface, and SPF, DKIM and DMARC on the sending domain.

The options checked on 2026-10-11:

| Option | Free allowance | Fit |
| --- | --- | --- |
| Cloudflare Email Service | Sending to arbitrary recipients needs **Workers Paid**; then 3,000 emails a month are included, $0.35 per 1,000 after that | No HTTP call and no API key, but not on the free plan |
| Resend | 3,000 a month, 100 a day; one domain on the free plan (sources differ) | HTTP API that fits Workers; Tokyo sending region |
| Brevo | 300 a day | Free-plan API and domain limits unclear |

Local development, previews and Playwright also need the emails, mainly to read sign-in codes. The Phase 0 plan proposed Mailpit, a local mail catcher.

## Decision

1. **Resend's free plan in production**, sending from `no-reply@<PLATFORM_DOMAIN>`. The owner chose Resend on Oct 11. *Amended Oct 13:* the plan proposed verifying only a `notify.` subdomain, so a deliverability problem would never reach the main domain; the owner verified the main domain instead. The free plan allows one domain, and staff email is tens a day, so the main domain stays. DMARC starts at `p=none`.
2. **`packages/providers/email`** holds the `EmailProvider` interface and the adapters:
   - **`resend`:** one `fetch` call to Resend's HTTP API; no SDK.
   - **`capture`:** everywhere except production. It hands each message to a `save` function; the API saves to `platform.dev_emails`, where the dev mailbox endpoint and Playwright read it. **Mailpit is dropped**: one mechanism serves local development, previews and tests, with nothing to install.
3. **Retries:** `sendEmail` makes up to 3 attempts (200 ms, then 400 ms) for errors Resend marks as transient (5xx, locks, per-second rate limits) and for network failures, always with the same `Idempotency-Key`, so a lost response never causes a second email. Quota errors are not retried.
4. **No recipient in errors or logs.** `EmailError` carries only a stable code, the HTTP status and whether to retry.
5. **Templates** for staff emails are code, in Bangla and English, with every interpolated value escaped. Sign-in codes are never in the subject, because subjects show on lock screens. Editable per-store templates come with shopper notifications in Phase 5A.

## Consequences

- 100 emails a day is plenty for staff email in Phases 1–3. From Phase 4, shopper emails share the cap and need the store domain, which may need a second sending domain. The Phase 4 plan decides between Workers Paid with Cloudflare Email Service and a paid Resend plan, using the volume measured until then.
- **At the Workers Paid switch** (ADR 0013 checklist), a `cloudflare` adapter becomes the natural default. It is written then, not now.
- Emails that hold secrets (sign-in codes, invitation links) are sent right after the response with `waitUntil`, not through the outbox, so no live code sits in the database for 7 days (phase-1-plan §5.7).
