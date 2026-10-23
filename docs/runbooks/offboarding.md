# Runbook: offboarding a client

When a client leaves, or stops paying and a super admin decides to close the store. Closing is never automatic.

## 1. Before closing

- Outstanding invoices: record what was paid, or void what won't be (Platform → Billing). The billing history stays after the purge either way.
- Tell the owner: the store goes offline at once, they get their data by email, and it is deleted for good 30 days later.

## 2. Close the store

Platform → the store → **Close store**: type its address, give a reason, and enter your two-factor code.

At once:
- the storefront answers "This store has closed" (410) and stops taking orders; staff can't open its admin;
- its custom domains are released at Cloudflare, so the client can point them elsewhere;
- its **export** is queued. The owners get an email with a download link, valid for 7 days, within minutes (or after the daily run, without `GITHUB_DISPATCH_TOKEN`). The store page's *Exports and jobs* shows its progress.

## 3. Changed their mind?

Until the purge, **Reopen** brings the store back as it was. Its custom domains must be added again.

## 4. The purge, after 30 days

1. The store page's **Purge** section: **Count what would be deleted**. The dry run takes a few minutes.
2. Read the report: store rows, files, staff accounts in no other store, custom domains not released (should be 0), exports kept until their link expires.
3. **Purge the store**: type its address and your two-factor code. The purge runs in a few minutes, resumes by itself if stopped, and verifies that nothing is left.
4. The section then says when it was purged and what the verification found.

What stays: the store's record (marked purged), its subscription, invoices and payments, usage, terms acceptances, the audit log and the purge record.

## A shopper asks the store to delete their data

That's the store's job, not a closure: the owner or a manager opens the customer and uses **Delete personal data**.
