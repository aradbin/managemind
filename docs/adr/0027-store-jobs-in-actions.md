# ADR 0027: Store exports, purges and resets run in GitHub Actions

- Status: Accepted
- Date: 2026-10-23
- Plan: phase-5b-plan §3.9–§3.12, Q10, Q13. Code: `packages/core/src/tenancy/jobs.ts`, `apps/api/src/tenant-jobs.ts`, `scripts/jobs/`, `.github/workflows/tenant-jobs.yml`
- Builds on: ADR 0010 (outbox), ADR 0011 (previews), the Platform workflow (phase-1-plan §5.3)

## Context

A store's export reads every row it has and every file it stored. A purge deletes all of that, resumably, and a reset does the same and then reseeds. On the Workers Free plan each invocation has 10 ms of CPU: phase-2-report §3 measured a 500-product import at about 50 minutes, chunked through a queue. An export or a purge of a real store would take hours that way, and each Hyperdrive query counts against the daily allowance that ran out on Oct 18.

GitHub Actions already runs the Platform CLI with the migration role. A private repository on a free personal account gets 2,000 minutes a month (Q10).

## Decision

1. **A job is a row.** The platform screen, an owner's Settings, or closing a store writes a pending row in `platform.tenant_jobs` (kind `export`, `purge` or `reset`). A unique index allows one open job of each kind per store. The app role can only insert and read these rows; the workflow, as the migration role, claims and updates them.
2. **The Worker starts the workflow; a schedule backs it up.**
   - In production the API calls GitHub's `workflow_dispatch` for `tenant-jobs.yml` with `GITHUB_DISPATCH_TOKEN`, a fine-grained token limited to Actions on this repository, after the response.
   - The workflow also runs daily at 02:37 in Dhaka. It checks for work with the runner's `psql` before installing anything, so a day with nothing to do costs well under a minute.
   - Without the token, or when GitHub doesn't answer, the job waits for that daily run.
3. **The runner claims with `for update skip locked`.** A claimed job is `running`. A running job untouched for 90 minutes lost its runner and is claimed again. A failure goes back to `pending` with the error, and the third failure is final (`failed`). The workflow's concurrency group runs one at a time.
4. **Progress is saved on the row** after each table and each 50 files, so the platform screen shows it. An export only reads, so a resumed export starts again. A purge (PR 12) resumes from its last finished batch.
5. **The export** is one zip in R2, `exports/<tenant>/<job>.zip`, which the bucket's rule deletes after 7 days. It holds:
   - every store table as JSON lines, in insert order (the reverse of the purge order);
   - spreadsheets (CSV, UTF-8 with a byte order mark) of the lists a person opens;
   - the store's platform rows: the tenant record, domains, members (name, email and role only), subscription, issued invoices and payments, terms acceptances;
   - its files, from `tenants/<id>/`;
   - a manifest with the schema version (the last migration), the row counts and each entry's SHA-256.

   Sealed credentials, sign-in sessions and codes, push keys, idempotency records and delivered outbox events are left out, and the manifest says why.
6. **The link is signed and short-lived.** `/v1/exports/<job>?expires=…&token=…` on the API's host: an HMAC-SHA-256, keyed from `AUTH_SECRET`, over the job and its expiry. It is checked in constant time and lasts 7 days, like the file. The Worker streams the file from R2, which costs little CPU. The response is `no-store`, with no referrer.
7. **The owners hear by email.**
   - Finishing an export writes `tenant.exported` to the outbox in the same commit as the job's result.
   - The runner sends the event straight to the outbox queue through Cloudflare's API; if it can't, the Worker's daily sweep does.
   - The outbox consumer emails each owner the signed link, in their language, saying it holds shoppers' personal data.
8. **Who may ask:**
   - an owner, at most once a day (Q13), from Settings, and not through a support grant;
   - a super admin, at any time;
   - closing a store queues its export.

## Consequences

- Exports and purges cost Actions minutes, not Worker CPU or Hyperdrive queries. A pilot store's export takes a few minutes. The daily check is under a minute, about 30 minutes a month.
- Production database credentials stay in GitHub, as they do for the Platform CLI and migrations.
- Jobs run only for production. A preview's jobs would need its own database URL, so the preview E2E (PR 18) runs the script directly against the preview's branch.
- The zip is built in memory and uploaded through Cloudflare's API, which suits stores of pilot size: hundreds of megabytes, not tens of gigabytes. A larger store would need a streamed, multipart upload with R2 access keys.
- An export link is a bearer secret for 7 days: anyone holding the email can download it. Rotating `AUTH_SECRET` voids every outstanding link, as it does every session.
