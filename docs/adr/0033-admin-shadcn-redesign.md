# ADR 0033: The admin on shadcn/ui's neutral theme, one sidebar that lists every page, no section tabs

- Status: Accepted. Built in steps 1–9: the frame, the list pattern, every list page, side panels, save bars and form controls.
- Date: 2026-10-31
- Design: the canvas in `design/admin-redesign/` (desktop and phone boards for every admin page, and its "Design rules" board). Code: `apps/admin/src/styles.css`, `apps/admin/src/components/ui/`, `apps/admin/src/components/nav.tsx`, `apps/admin/src/routes/_shell.tsx`, `apps/admin/src/routes/_shell/more.tsx`
- Amends: [ADR 0029](0029-admin-redesign.md) §1 (colours), §2 (sizes), §3 (status chips), §5 (the shell)

## Context

The owner had every admin page redrawn on shadcn/ui's default theme, compact, with one layout and one way to do each thing. The design rules board on the canvas lists those ways: where a form opens, names in two languages, choosing options, filters, lists and row actions, reordering, saving and deleting, messages, badges, sizes, one layout and dates.

The build comes in steps. This first step changes what every page shares, so every screen takes the new look at once. Later steps change each page's own structure to the boards.

## Decision

1. **shadcn/ui's neutral theme.** The token names stay, so no page needed a new class to take the new look. The values change:
   - near-black `primary` (near-white in the dark theme) replaces the green;
   - grey `muted` and `border`, `ring` for focus;
   - a new `sidebar` token for the frame behind the page, and `card` for cards.

   Status tones stay five (waiting, in progress, shipped, done, a problem) plus grey. Each is now a soft tint with darker text of its own hue. Every text and background pair still passes 4.5:1 in both themes; the danger red and its tint were darkened a little to get there.
2. **Compact sizes.**
   - Buttons are 32 px in headers and toolbars on desktops and 36 px on phones; `size="lg"` (36 px) is for panel and dialog footers.
   - Inputs and selects are 36 px with 14 px text on desktops, and 40 px with 16 px text on phones, so focusing one doesn't zoom the page.
   - Corners are 8 px on controls, 10 px on inner boxes and 14 px on cards.

   This replaces ADR 0029's 44 px minimum. The boards keep phone controls at 36–40 px and phone rows at 44 px or more.
3. **One layout.**
   - **Desktop:** the sidebar sits on the grey frame and the page sits in a white inset panel beside it. The sidebar has the store at the top, then the selling areas, then "Store" and "Platform". Orders, Catalog, Inventory, Reports, Online store and Platform open into their pages; the area of the page you are on is open. The sidebar can be hidden from the header, and the choice is remembered on the device (`mm.sidebar`).
   - **Header:** it shows "Area › Page" on the left. On the right: search (Ctrl K), Create, View store, the language, light or dark, help, and the account behind the person's initials.
   - **Phone:** the header holds the store, search, the language and Create. The tab bar holds Home, Orders, Products, Customers and Menu. Menu (the old More page, still at `/more`) lists every area; an area opens into its pages.
4. **No section tabs.** The Catalog, Inventory and Reports tab rows and the platform area's dark band are gone: the sidebar and Menu list those pages. Billing stays in Settings only.
5. **Create** offers the records that have their own page: order, promotion, product and purchase order, as far as the person may make them. The boards also list customers, expenses, categories, collections, suppliers, stock counts and store pages. Those open in a panel on their list page, so they join the menu when the list pages can open their panel from the address.
6. **Shared parts follow the rules:**
   - A page under another starts with a back arrow to it, since the header now says where the page is.
   - A list shows its frame with grey rows while it loads, and the failed and empty states sit in its card.
   - Toasts appear at the bottom right (above the tab bar on phones).
   - Notes are grey boxes and alerts are red outlined boxes.
   - Status chips are 22 px tall with 8 px corners.

## Options considered

- **Pull in shadcn/ui's components wholesale** (its Sidebar, Select, Sheet). The admin already follows their patterns on Radix. Copying each one in would add JavaScript to the sign-in budget and churn every page at once, for the same look.
- **Keep the section tabs beside the new sidebar.** The design rules drop them: two navigations for the same pages, and on phones a strip that scrolls sideways.

## Consequences

- The sign-in JavaScript grows by about 2 KiB gzip (137 to 139 KiB of the 150 KiB budget), for the sidebar's areas and the Create menu.
- Area and page names in the navigation live in the base messages (`nav.*`), because the sidebar and Menu show an area's pages before that area's own messages load.
- Step 2 built the list pattern once (`components/list-tools.tsx`, `components/data-list.tsx`) and put Products and Orders on it:
  - stage tabs with counts where Home's numbers know them;
  - dashed filter buttons whose list has a search box and "Clear filter", and one Filters drawer on phones;
  - rows that open the record from anywhere, a ⋯ menu per row, and the selection bar at the bottom of the screen;
  - phone lists as one card of divided rows.

  The API takes one value per filter, so each filter's list picks one (the boards draw several). No API gives a count per choice, so the lists show none. An order stage that no tab shows, such as a link from Home to failed deliveries, reads as a "Status: …" button that removes it.
- Step 3 put Customers, Promotions, Expenses, Inventory and Returns on the list pattern, and moved their forms into side panels (`components/ui/sheet.tsx`: from the right on desktops, 92% tall from the bottom on phones, Delete at the footer's left):
  - customers and addresses;
  - expenses, recurring expenses and expense categories (a category's two names share one field with বাংলা | English tabs);
  - stock adjustments and stock history.

  Promotions pause, resume and end from a row's menu. Recurring expenses pause and resume there too. Forms follow design rule 3: choice buttons for how an expense was paid and for the weekday, a segmented control for how often, a switch for on and off, chips for Today and Yesterday.

  Dates are now day first everywhere the admin's `dateOnly` and `dateTime` format them, with the year only when it isn't this one.

  Where the API falls short of the boards:
  - customers' Tag filter lists the tags on the customers loaded so far;
  - expenses are searched and filtered within the month already loaded;
  - returns have a tab per status (the board's "In progress" covers several, and the API takes one), and show units instead of value.
- Steps 4–9 put the remaining lists on the pattern:
  - catalog: categories as a tree table with one side panel for names, place, descriptions, specifications and web addresses; attributes with a side panel; collections;
  - inventory: suppliers (side panel), purchase orders, stock counts (radio cards to start one), adjustments;
  - orders: incomplete orders and courier returns, and the confirm queue's tabs;
  - the online store's pages, and the platform's stores and billing.

  The full-page editors (product, promotion, collection) end in a save bar (`components/save-bar.tsx`): Discard · Save once something changes, Cancel · Create … for a new record. Delete and archive sit in the header's ⋯. Date presets are one shared filter (`dateRangeFilter`).
- Form controls follow design rules 3 and 10:
  - native selects are drawn like the design's select, with the up-down chevron, and stay native, so phones keep their own picker;
  - checkboxes and radios are 16 px;
  - `SwitchField` and `Switch` are drawn as switches; `SwitchField` stays a checkbox to assistive tech, so its forms and the E2E keep working;
  - the বাংলা | English tabs are a segmented control.
- Not built:
  - **Searchable selects** for 8 or more options (design rule 3). The admin keeps native selects: 31 E2E steps choose with them, and a phone's own picker is easier to use. A searchable select is worth it where people type names, such as the place picker and the category and supplier choices; that is a decision for the owner.
  - **Some board details the API doesn't support:** counts beside each filter choice, page numbers instead of "Load more", a filter that picks several values at once, and comparison with last month on expenses.
- The E2E no longer looks for the reports' section tabs; it checks each report's title instead.
