# ADR 0034: The admin matches the redesign boards exactly

- Status: Accepted. Built in steps 1–8 on the branch `ccr-4fa9341c-4i6fgp` (Nov 2–7).
- Date: 2026-11-07
- Design: the canvas in `design/admin-redesign/canvas/project/` (about 100 desktop boards at 1440 × 900, each with a phone twin at 390 × 844). Code: `apps/admin/src/`
- Amends: [ADR 0033](0033-admin-shadcn-redesign.md) §2 (sizes), §5 (Create), §6 (shared parts) and the pager of [phase-5c-report.md](../phases/phase-5c-report.md) §7
- Phase: 5C, its second redesign, finished: [phase-5c-report.md](../phases/phase-5c-report.md) §8

## Context

ADR 0033 put the admin on shadcn/ui's neutral theme, but the pages only approximated their boards. A side-by-side comparison of every board with its page, on desktops and phones, found about 60 differences in the shared frame and controls. The list pattern differed too: paddings, row heights, states, the pager, sorting and phone rows. Nearly every non-list page differed in structure, such as one 760 px column against two columns, one action plus ⋯ against rows of buttons, and missing charts and stat strips.

The owner asked for an exact match. They decided:
- the boards' hues and tints, nudged only as far as AA needs;
- the boards' pager;
- every board, with the API pieces the boards need;
- no counts beside filter choices;
- old shapes removed rather than kept beside the new ones.

## Decision

1. **The boards are the specification.** Sizes, paddings, corners, type sizes and the order of things come from the boards' `.mm-*` CSS. A comparison harness renders each board and its page and puts them side by side. Remaining differences are data only, or listed below.
2. **Colours: the boards' tints, text darkened for AA.** Status tones mix their hue into the background as drawn (16, 12, 12, 14 and 12 %). Their text shades were darkened until every pair passes 4.5:1 on white and on muted rows:
   - light: warn .514, info .518, violet .534, danger .487, success .473;
   - dark: danger .724, violet .716.
3. **The boards' pager replaces numbered pages and Load more.**
   - Desktops: "Showing 1–10 · Rows per page [10] · Page N · « ‹ ›". The rows per page are 10, 20, 50 or 100 and are remembered on the device.
   - Phones: "‹ Previous · Page N · Next ›".
   - `usePagedList` keeps `?page=` and adds the size.
4. **One shape per kind of page:**
   - **Editors and records:**
     - one 760 px column, or the record board's two columns;
     - the dark save bar for unsaved changes;
     - one primary action plus a ⋯ menu.
   - **Settings:** a 200 px list of settings pages beside a 780 px column.
   - **Phones:** record pages, settings, the online store and every platform page have their own header with a back arrow, and no tab bar.
   - **Confirmations:** alert dialogs.
   - **Choices:**
     - a few short ones are chips;
     - choices with a second line are radio cards;
     - on/off settings are switch rows.
   - **⋯ menus:** a popover on desktops, a drawer of 44 px rows on phones (design rule 5).
   - **Platform pages:** a dark "Platform" mark before their title.
5. **New shared parts:**
   - `SettingsFrame`, `SwitchRow`, `ChoiceChips`, `ToggleChips`, `RadioCard`;
   - `BarChart`, `StatRow`, `report-table`, `ImportFrame` (step dots, drop zone, sample file), `PrintBar` (the paper sheet);
   - `AuthLayout`, a 380 px card with the languages as a footer;
   - `useRecordPage` and `PhoneRecordHeader`.
6. **The API grows where a board shows data it didn't have.** All changes are additive; existing callers are unchanged, and the SDK is regenerated.
   - **Lists:** `sort`, `size`/`offset`, filter-aware tab `counts`, and summaries such as the orders' value and the inventory's figures.
   - **Products:** a product's recent orders and 30-day activity.
   - **Orders, customers and returns:** the customer's total spend, and the return's customer phone and line SKUs and values.
   - **Reports:** totals and the previous period, COD outstanding's oldest parcels, and collected and fee on unpaid parcels.
   - **Message log:** each message's order number.
   - **Audit log:** a search, action and store filters, offset, and the person's and store's names, with the total and the filter choices.
   - **Terms versions:** how many open stores were asked.

## Consequences

- **Where the build still differs from the boards:**
  - **Filter choices have no counts**, as the owner decided.
  - **Returns don't record what the shopper wants back**, so the return page has no "They asked for".
  - **The stock report has no per-location variant rows.**
  - **Print shows only what the store profile holds.** A store with no address prints none.
  - **An invitation can't name its store before it is accepted.**
  - **Texts stay in both languages where the board draws one field.** Examples are the cookie banner and theme texts, which have a field per language.
- **The full-height Theme editor breaks out of the page padding** on desktops, as drawn.
- **The design boards stay in the repository** as the reference for later changes.
