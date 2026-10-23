# Runbook: a free-tier limit runs out

The platform runs on free plans. The daily usage alarm (**Actions → Usage alarm**, 08:07 in Dhaka) opens an issue when any limit passes 70%, and Platform → Dashboard shows the same numbers. This page says what happens at 100% and how to get out.

| Limit | Resets | At 100% | First aid | Upgrade |
| --- | --- | --- | --- | --- |
| **Hyperdrive queries** (100,000 a day) | 00:00 UTC | **Every database connection is refused: admin and checkout are down; cached store pages stay up.** This happened on Oct 18 (phase-4-report §4), from preview runs | Stop previews (remove `full-preview` labels, cancel running Preview workflows). Nothing else helps until the reset | Workers Paid ($5 a month) includes 10 million queries a month |
| **Worker requests** (100,000 a day, account-wide) | 00:00 UTC | Requests fail with Cloudflare's error page | Stop previews; check for a bot in the WAF events | Workers Paid |
| **Worker CPU** (10 ms a request) | Per request | That request is stopped (an error for that shopper) | The alarm lists the routes; a slow route is a bug to fix | Workers Paid raises it to 30 s |
| **Queue operations** (10,000 a day) | 00:00 UTC | Events stop flowing: no emails, cache purges or KV updates | Events stay in the outbox; the daily sweep relays them after the reset | Workers Paid |
| **KV writes** (1,000 a day) | 00:00 UTC | Host changes (new stores, domains, closing) don't reach the edge | After the reset, **Actions → Platform → kv:sync** | Workers Paid |
| **Email** (Resend, 100 a day) | 00:00 UTC | Staff sign-in codes stop; shopper email is skipped from 70% | Wait for the reset; staff already signed in keep working | Resend's paid plan, or Brevo for shoppers |
| **Neon compute** (100 CU-hours a month) | Monthly | The database suspends until the next period | Delete idle preview branches; check nothing polls the database | Neon Launch |
| **Neon storage** (0.5 GB, all branches) | — | Writes fail | Delete old preview branches; the E2E cleanup purges old test stores | Neon Launch |
| **Actions minutes** (2,000 a month, private repository) | Monthly | Every workflow stops: no deploys, backups, jobs | Cancel preview runs; set a small spending limit as a safety net (Q10) | Pay as you go |

## Upgrading to Workers Paid

The owner's decision (Q2): at the first pilot client. In the Cloudflare dashboard, **Workers & Pages → Plans → Workers Paid**. Nothing in the code changes. The alarm's limits are then too low; update them in `scripts/monitor/usage.ts`.
