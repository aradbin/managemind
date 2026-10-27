# Runbook: a free-tier limit runs out

The platform runs on free plans. The daily usage alarm (**Actions → Usage alarm**, 08:07 in Dhaka) opens an issue when Worker requests, Hyperdrive queries, queue operations, KV writes, or Neon compute or storage pass 70%, and Platform → Dashboard shows the same numbers. It doesn't check the email quota or the Actions minutes: the rows below say how to see those. This page says what happens at 100% and how to get out.

| Limit | Resets | At 100% | First aid | Upgrade |
| --- | --- | --- | --- | --- |
| **Hyperdrive queries** (100,000 a day) | 00:00 UTC | **Every database connection is refused: admin and checkout are down; cached store pages stay up.** This happened on Oct 18 (phase-4-report §4), from preview runs | Stop previews (remove `full-preview` labels, cancel running Preview workflows). Nothing else helps until the reset | Workers Paid ($5 a month) includes 10 million queries a month |
| **Worker requests** (100,000 a day, account-wide) | 00:00 UTC | Requests fail with Cloudflare's error page | Stop previews; check for a bot in the WAF events | Workers Paid |
| **Worker CPU** (10 ms a request) | Per request | That request is stopped (an error for that shopper) | The alarm lists the routes; a slow route is a bug to fix | Workers Paid raises it to 30 s |
| **Queue operations** (10,000 a day) | 00:00 UTC | Events stop flowing: no emails, cache purges or KV updates | Events stay in the outbox; the daily sweep relays them after the reset | Workers Paid |
| **KV writes** (1,000 a day) | 00:00 UTC | Host changes (new stores, domains, closing) don't reach the edge | After the reset, **Actions → Platform → kv:sync** | Workers Paid |
| **Email** (Resend, 100 a day; not in the alarm: the API logs a warning in Workers Logs from 70%) | 00:00 UTC | Staff sign-in codes stop; shoppers' order updates after "order placed" are skipped from 70% | Wait for the reset; staff already signed in keep working | Resend's paid plan, or Brevo for shoppers |
| **Neon compute** (100 CU-hours a month) | Monthly | The database suspends until the next period | Delete idle preview branches; check nothing polls the database | Neon Launch |
| **Neon storage** (0.5 GB, all branches) | — | Writes fail | Delete old preview branches; the E2E cleanup purges old test stores | Neon Launch |
| **Actions minutes** (none used while the repository is public; 2,000 a month if it is private again; not in the alarm) | Monthly, on the account's billing date | Every workflow stops (see below). This happened on Oct 24, while the repository was private | Cancel preview runs and push nothing until the reset | A budget above $0 for Actions (pay as you go) |

## When the Actions minutes run out

This applies only while the repository is private. It is public for now (since Oct 24), and GitHub-hosted runners cost public repositories no minutes.

**The sign:** every job fails within two seconds with no steps, and the run's *Annotations* say "The job was not started because recent account payments have failed or your spending limit needs to be increased". To tell the two apart, open **Settings → Billing and licensing → Usage** (github.com/settings/billing/usage) and filter by Actions: 2,000 minutes used means the minutes ran out. The same page shows when the next period starts.

**What keeps working:** production. The Workers serve shoppers and staff, and the Worker's own nightly cron (usage rollup, billing and reminders, domain checks) runs on Cloudflare, not GitHub.

**What stops until the reset:**

- CI and previews on pull requests. A merge to `master` **doesn't deploy**: the deploy is a workflow too. It deploys at the first push to `master` after the reset, or from **Actions → Deploy → Run workflow**.
- The daily usage alarm (`monitor.yml`).
- Store jobs (`tenant-jobs.yml`): exports, purges and the Friday demo reset. They wait in `platform.tenant_jobs` and run at the first daily run after the reset.
- The nightly backup and the monthly restore test. Neon's own history is then the only backup.

**What each run costs:** a push to a pull request about 10 minutes (CI and the preview's smoke test), a `full-preview` run about 37, a deploy about 2, and the scheduled workflows about 150 a month. Add `full-preview` once, when a PR is ready, and push fewer, larger commits.

## Upgrading to Workers Paid

The owner's decision (Q2): at the first pilot client. In the Cloudflare dashboard, **Workers & Pages → Plans → Workers Paid**. Nothing in the code changes. The alarm's limits are then too low; update them in `scripts/monitor/usage.ts`.
