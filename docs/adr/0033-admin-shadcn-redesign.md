# ADR 0033: The admin on shadcn/ui's neutral theme, one sidebar that lists every page, no section tabs

- Status: Accepted. Built in steps 1–9: the frame, the list pattern, every list page, side panels, save bars and form controls.
- Date: 2026-10-31
- Design: the canvas in `design/admin-redesign/` (desktop and phone boards for every admin page, and its "Design rules" board). Code: `apps/admin/src/styles.css`, `apps/admin/src/components/ui/`, `apps/admin/src/components/nav.tsx`, `apps/admin/src/routes/_shell.tsx`, `apps/admin/src/routes/_shell/more.tsx`
- Amends: [ADR 0029](0029-admin-redesign.md) §1 (colours), §2 (sizes), §3 (status chips), §5 (the shell)
- Phase: 5C, its second redesign: [phase-5c-report.md](../phases/phase-5c-report.md) §7
- Amended by: [ADR 0034](0034-admin-matches-the-boards.md) (every page to its board; the boards' pager)

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
  - short selects (`components/ui/select.tsx`) are shadcn/ui's Select on Radix on desktops, so their open list is drawn in the admin's colours in both themes (native lists were unreadable in the dark theme), and stay native on phones, so phones keep their own picker; the native options take the popover colours;
  - checkboxes and radios are 16 px;
  - `SwitchField` and `Switch` are drawn as switches; `SwitchField` stays a checkbox to assistive tech, so its forms and the E2E keep working;
  - the বাংলা | English tabs are a segmented control.
- Searchable selects (`components/ui/combobox.tsx`, on Radix Popover) replace native selects where people pick names from long lists:
  - places, categories, suppliers and expense categories;
  - a product's choice specifications and "Add a specification";
  - collection rules and the theme editor's link target.

  Typing matches either language's name. Short fixed lists use `Select`, native on phones. The E2E picks through a `choose()` helper, which also picks from a native select.
- Filters pick several values (design rule 4). The list endpoints read a comma-separated filter as "any of these" (`oneOrMany` in `@managemind/shared/query`), for:
  - orders' payment, source, zone and flag;
  - products' category and brand;
  - customers' tag, returns' reason, purchase orders' supplier and adjustments' reason.

  One value still works as before.
- Expenses compare the month with last month, or with the same days of last month while the month is still going, from the expenses endpoint's totals.
- Long lists say how many match and page by device (`lib/paged.ts`, the pager in `components/data-list.tsx`):
  - desktops get numbered pages ("101–150 of 1,234", Previous, 1 … 3 4 5 … 25, Next): people there jump between pages and share a page's address;
  - phones keep "Load more" under "Showing 100 of 1,234": scrolling on is easier there than aiming at small numbers, and a row already shown isn't shown twice when new orders shift the list;
  - orders, products, customers and inventory keep the page in the address (`?page=3`), Back returns to it, and a new filter starts at page 1.

  The list endpoints answer with `total` and take `offset` for this; the cursor still works for the exports.
- Filter choices have no count beside them, as the boards draw: the owner decided they aren't needed.
- The E2E no longer looks for the reports' section tabs; it checks each report's title instead.
- Settings forms follow design rule 1 too: the keys and accounts on Couriers, Payments, Notifications (email sender, SMS gateway) and Facebook and Instagram (Conversions API) open in side panels from Connect or Change, and the cards only show their state. Delivery zones, Connect a domain, Invite someone and Change role moved from dialogs to side panels, as their boards draw them. The Payments board now draws its panel as well. Disconnecting the Conversions API asks first (design rule 7).
- Dates are picked on a calendar (`components/ui/calendar.tsx`, shadcn/ui's Calendar on react-day-picker) from a box showing the date day first (`components/ui/date-picker.tsx`); date-and-time values add a time box. Values stay the strings native inputs gave. The calendar loads only with the pages that ask for a date.
- The header's language and theme buttons open menus. The account menu and the phone's Menu show Appearance on one row of three icons (device, light, dark); the device's setting is the default, and choices saved by the old one-press toggle were dropped once (`mm.theme.v2`).
