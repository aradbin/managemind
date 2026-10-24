# Phase 5C report: Admin redesign

- Date: 2026-10-24
- Plan: the owner's brief (a modern, clean admin that is responsive and easier to use on phones), then the design canvas "ManageMind Admin Redesign". The owner approved its 18 screens before any code was written.
- Decision: [ADR 0029](../adr/0029-admin-redesign.md)
- Pull request: #69, one commit per step (§1). Merged and deployed on Oct 24: the deploy's smoke, shop API and cache checks passed

> Phase 5C sits between launch readiness (5B) and the pilot. The pilot's clients use the admin every day, mostly on phones. No data model, API or storefront change: the admin's look, layout and navigation only.

## Summary

Every screen of the admin is redesigned, in both languages and both themes, at phone and desktop sizes. That covers the 18 drawn on the canvas, and every other screen built from the same parts.

- **One look.**
  - Colour tokens: one green accent on a grey canvas, with white cards.
  - The Inter font beside Noto Sans Bengali.
  - Five status tones, each with its word.
  - Every text and background pair passes AA contrast, in the light theme and the dark one.
- **A new frame.**
  - **Desktop:** a grouped sidebar with the store switcher as a card, and a badge for orders to confirm. The top bar leads with search (Ctrl+K or ⌘K).
  - **Phones:** five tabs (Home, Orders, Products, Customers, More). The More page holds the account, the store switch, help and sign-out.
  - **Platform area:** a dark band, so it is never mistaken for a store's admin.
- **Screens rebuilt to the approved designs.** Home, the orders list and an order, a customer, the product editor, a manual order, settings, delivery zones, the theme editor, sign-in, More, and the platform's store page.
- **The same patterns everywhere else:**
  - a breadcrumb above the title;
  - forms and sections in cards;
  - lists in a card, with their own phone cards;
  - the main action pinned within thumb reach on phones where a screen has one.

**What the owner should know:**

1. **Nothing changes for shoppers, the API or the data.** The admin's JavaScript before sign-in is 134 KiB, within its 150 KiB budget (133 KiB before).
2. **Five existing bugs were found and fixed on the way** (§3). The most visible: every product counted as changed as soon as it opened, so Save was always on.
3. **A few details differ from the approved screens** (§4). The main reasons: the API doesn't have the data, or the E2E depends on a control.
4. **The redesign is in production since Oct 24.** CI and the preview's smoke test passed on GitHub, and the E2E passes locally at both viewports, every suite. The `full-preview` run failed twice, on 2 of 27 flows each time, all on requests Cloudflare stopped at the Free plan's CPU limit; none touched by this change (§5). The owner chose to merge.

## 1. What was built

| Step | Commit | What |
| --- | --- | --- |
| 1 | `d9fd148` | Colour tokens for both themes, Inter, cards, status chips, buttons and fields (ADR 0029) |
| 2 | `a345835` | The shell: grouped sidebar, top bar with search, five phone tabs, the More page |
| 3 | `5638777` | Home |
| 4 | `8c35407` | Orders list and order detail; cards, list cards and fields on every screen |
| 5 | `c8643ce`, `0624bae` | Settings home; sign-in, two-factor and invitations |
| 6 | `406b830` | A customer; delivery zones; "Settings ›" breadcrumbs |
| 7 | `1a0e360` | Product editor; manual order |
| 8 | `0f04bfa`, `fafd9ef` | Platform area and a store's page; theme editor |
| 9 | `c5882c4` | ADR 0029: where the build differs from the approved screens |
| 10 | `00eb8db` | Every remaining screen |
| 11 | `e8c6e7d` | This report; PLAN.md, the README and ADR 0029 |

### Screens

| Screen | Approved on the canvas | Built |
| --- | --- | --- |
| Frame: sidebar, top bar, phone tabs | Yes | As drawn; the phone header keeps the language switch (§4) |
| More (account, store switch, help, sign-out) | Yes | As drawn |
| Home | Yes | As drawn, 7 days only (§4) |
| Orders list | Yes | As drawn |
| Order detail | Yes, desktop and phone | As drawn; the next step is pinned above the tab bar on phones |
| New manual order | Yes, phone | As drawn; the total and the main action pinned on phones |
| Product editor | Yes, desktop and phone | As drawn; the save bar appears only with unsaved changes |
| Customer | Yes | As drawn; the delivery record comes from the latest 50 orders |
| Settings home | Yes, desktop and phone | As drawn; status lines where the setup checklist knows them |
| Delivery zones | Yes | List and calculator as drawn; a zone is edited in its dialog (§4) |
| Theme editor | Yes | As drawn, with the Desktop/Phone preview switch |
| Sign-in | Yes | As drawn, with two steps; two-factor and invitations share the frame |
| Platform: a store | Yes | As drawn, under a dark band rather than a dark sidebar (§4) |
| Component kit | Yes | Buttons, fields, chips, banners, dialogs, toasts, empty, loading and error states |
| Products, categories, collections, attributes, inventory, catalog import | No | The patterns: list cards, phone cards for products, catalog tabs as pills on phones |
| Customers list, customer import, promotions and a promotion, returns and a return, reports | No | The patterns: breadcrumbs, cards, phone cards for customers; report tables scroll inside their card on phones |
| Every settings page, account, our billing, online store and its pages, storefront settings | No | The patterns: "Settings ›" breadcrumbs, forms in cards |
| Platform: stores, dashboard, new store, billing, an invoice, terms, staff, audit, status | No | The patterns, under the platform band |
| Printed invoice and packing slip; the dev mailbox | No | Unchanged: laid out for paper, or never in production |

## 2. Acceptance criteria

The brief set three, which the owner checked screen by screen on the canvas:

| Criterion | Status |
| --- | --- |
| Modern but clean, following current admin practice | **Met:**<br>- built to the approved screens;<br>- the research and references are in ADR 0029: Shopify's Polaris for commerce, Stripe and Linear for density and restraint |
| Responsive and phone-friendly | **Met.** Every screen was checked by screenshot at 390 × 844 and 1280 × 800, in Bangla and English, and Home also in the dark theme. The E2E runs every flow at both viewports. Touch targets stay at least 44 px |
| Better usability | **Met in the designs and the build:**<br>- five tabs, not eight;<br>- search from anywhere;<br>- what waits comes first on Home and in the order tabs;<br>- the next step is pinned on phones;<br>- breadcrumbs everywhere;<br>- unsaved changes are shown only when there are some.<br>**Not yet measured with merchants:** the pilot will say |

Accessibility holds the existing bar. The E2E runs axe on every screen it visits, and its CSP check passes. Every text colour pair passes 4.5:1, computed for both themes.

## 3. Bugs found and fixed

| Bug | Where | Fix |
| --- | --- | --- |
| Every product counted as changed on opening, so Save was enabled before anything was typed | The description editor | Tiptap's `setEditable` emits an update unless told not to; it now passes `false` |
| The Returns button on Orders showed `orders.returns` until a returns screen had been opened | Orders | The page loads the returns messages it uses |
| Green and red buttons faded on hover to 4.4:1 | Buttons | Hover darkens instead (`primary-hover`, `danger-hover`) |
| Translucent tints failed contrast on the grey canvas | Return steps and others | Solid "soft" tokens instead of `/10` tints |
| A report table that scrolls on phones couldn't be scrolled from the keyboard | Reports | The scrolling box can be focused |

## 4. Where the build differs from the approved screens

- **The phone header keeps the language switch.** The E2E uses it at the phone viewport. The More page doesn't repeat it.
- **Home shows 7 days, without "Best sellers" or a returns count.** The dashboard endpoint has neither a 30-day series nor those figures. Each would need an endpoint.
- **Delivery zones keep their edit dialog** (a sheet on phones), rather than an editor beside the list.
- **The platform area is marked by a dark band, not a dark sidebar.** A second frame would double the shell's code for the same signal.
- **Settings cards show a status only where the setup checklist knows it:** store profile, delivery, payments, domains and email.

## 5. Tests and measurements

| Check | Result |
| --- | --- |
| Lint (Biome), typecheck, admin unit tests | Pass; 18 admin tests, unchanged |
| E2E, run locally against `wrangler dev` with a local seed, at 390 × 844 and 1280 × 800 | All pass: flows, launch, catalog, online store, orders, returns, storefront and smoke, with axe and the CSP check |
| Admin JavaScript before sign-in | 134 KiB (Phase 5B: 133); budget 150 KiB |
| Fonts | Inter's Latin file is about 48 KB, loaded only where Latin text shows; its Greek, Cyrillic and Vietnamese files stay out of the precache |
| API and storefront Workers | Unchanged |
| CI on GitHub (#69, `ff3999d`) | Pass: lint, typecheck and test; build and bundle size; the preview's smoke test |
| `full-preview` on GitHub, twice | 22 and 23 of 27 flows passed; the rest failed or didn't run (see below) |
| Production deploy (`6e09c46`) | Pass: both Workers deployed (no new migrations), smoke test, shop API, storefront cache hit |

**The `full-preview` failures.** Each run failed 2 flows, different ones each time: creating a store page, a stock adjustment, a sign-in code, the storefront's checkout. Each failure was an empty 503. The preview API Worker's logs show the cause: 9 requests stopped at the Free plan's 10 ms CPU limit (`exceededCpu`) under the E2E's load. The redesign changes no API, storefront or E2E code, and the same flows passed at the other viewport and locally. Earlier previews were stopped too (#56: 240 requests, #66: more than 1,000 in its earlier runs), and production had none. ADR 0013's trigger for Workers Paid is the first stop in production, so the plan stays as it is; until then a full preview can fail this way.

## 6. Known gaps and follow-ups

- **Endpoints for Home's missing figures:**
  - 30 days of sales;
  - best sellers;
  - returns waiting.

  Small queries, in a later phase if the pilot wants them.
- **Delivery zones' editor beside the list**, if staff find the dialog slow with many zones.
- **Lighthouse on the next green `full-preview` run.** Neither run reached it (§5). The storefront is unchanged, so its budgets should hold.
- **Workers Paid**, if full previews keep failing on CPU stops (§5). Its trigger in ADR 0013 is the first stop in production.
- **The pilot's feedback** on the phone layout, especially the five tabs and the pinned actions.
