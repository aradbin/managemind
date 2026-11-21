# Storefront redesign (design canvas)

The source of the general-store storefront redesign: desktop and phone boards for every shopper-facing page, built on the `classic` theme's `general` preset. The published canvas is a private claude.ai artifact (Design type): https://claude.ai/artifact/4FbGnnuZvYhJXKHWHpkJwt. Its owner shares it from the page's Share menu. This folder is what the canvas is built from, so it can be republished or rebuilt in any session.

Why each choice was made, and what still needs platform work, is in [DECISIONS.md](DECISIONS.md).

The storefront is built to these boards in steps; the order, and where each step still differs from its boards, is in [ADR 0035](../../docs/adr/0035-storefront-redesign.md).

## Layout

- `canvas/project/` – what gets published. Each `*.dc.html` file is one board; `canvas.json` places them on the canvas (one row per page: desktop on the left, phone beside it).
- `files-map.mjs` – prints the `files` map a publish call needs (see below).
- `build-boards.mjs` – regenerates the boards that are copies: the desktop listing, search, checkout, thank-you, tracking and account boards take their script from their phone board, and every `…Bn.dc.html` board is its English board with the Bangla switch on. Run it after changing any board, before checking and publishing.
- `check-board.mjs` – checks a board without the canvas: runs its script, can press its buttons in order, and lists any `{{hole}}` left empty. Run it on every board you change, with `'{}'` and `'{"bn":true}'`.
- `render-board.mjs` – renders a board to a PNG with a stand-in for the canvas runtime, or (with `NATURAL=1`) prints its content height. Use it to look at a change and to size frames.

| Row | Desktop | Phone | Phone, Bangla | Desktop, Bangla |
| --- | --- | --- | --- | --- |
| Home | `Main` | `HomePhone` | `HomePhoneBn` | `MainBn` |
| Category listing | `Listing` | `ListingPhone` | `ListingPhoneBn` | `ListingBn` |
| Search results | `Search` | `SearchPhone` | `SearchPhoneBn` | `SearchBn` |
| Product | `Product` | `ProductPhone` | `ProductPhoneBn` | `ProductBn` |
| Cart | `Cart` | `CartPhone` | `CartPhoneBn` | `CartBn` |
| Checkout | `Checkout` | `CheckoutPhone` | `CheckoutPhoneBn` | `CheckoutBn` |
| Thank-you page | `Thanks` | `ThanksPhone` | `ThanksPhoneBn` | `ThanksBn` |
| Order tracking | `Track` | `TrackPhone` | `TrackPhoneBn` | `TrackBn` |
| Account | `Account` | `AccountPhone` | `AccountPhoneBn` | `AccountBn` |
| Shared components and states | `SiteHeader`, `SiteFooter`, `ProductCard`, `QuickAdd` | `PhoneHeader`, `PhoneFooter`, `PhoneTabBar`, `States` | `StatesBn` | |

Every Bangla board is generated, and so is the script of the desktop listing, search, checkout, thank-you, tracking and account boards: edit the English board (the phone board, for a shared script), then run `node design/storefront-redesign/build-boards.mjs`.

The component boards are mounted by the pages with `<dc-import name="…">`. Change a component once and every page that uses it changes.

## The board format, in short

Each board is a Design Component page:

- markup inside `<x-dc>`, with inline styles (the canvas's properties panel edits those);
- `{{name}}` holes filled from `renderVals()` in the `<script type="text/x-dc" data-dc-script>` block at the bottom: dotted lookups only, no expressions;
- `<sc-for list="{{items}}" as="item">` for lists, `<sc-if value="{{flag}}">` for branches, `onClick="{{handler}}"` for events;
- `<dc-import name="ProductCard" item="{{p}}" on-add="{{addOne}}">` mounts `ProductCard.dc.html`; kebab-case attributes arrive as camelCase props;
- `data-props` on the script tag declares the canvas tweaks: `primary` (the theme's primary colour) on every board, `bn` (Bangla copy) on every page, shared component and the states board, `scenario` on the checkout, tracking and account boards, and `payment` on the thank-you boards.

Each board's copy lives in its script: a `T0` table of `[English, Bangla]` pairs for the fixed text in the markup (shown through `{{t.key}}`), and a `TR` table that translates text in the sample data (`tr('Cookware')`). Numbers and prices go through `num()` / `fmt()`, which switch to Bengali digits.

## Scenario tweaks

The checkout, tracking and account boards switch between the states the store and the server can produce with a `scenario` tweak in the canvas's properties panel (each also has a sticky note beside its row):

- Checkout: `normal`, `phone_code` (the SMS code step), `advance_required` (cash on delivery refused until the delivery charge is paid online), `cod_unavailable`, `no_delivery`, `store_paused`, `too_many_orders`, `price_changed`. Every scenario but `normal` starts filled in, so pressing Place order shows the answer.
- Tracking: `waiting_for_store`, `being_prepared`, `on_the_way` (parcels and courier updates), `delivered` (request a return), `too_many_tries`.
- Account: `signed_out`, `signed_in`, `new_account`.
- Thank-you page: `payment` is `cod`, `online` or `cod_with_advance`. Placing an order on a checkout board opens the thank-you board with the payment chosen there.

Each board keeps its state per scenario, so changing the tweak starts that scenario afresh. The copy comes from the storefront's own strings in `apps/storefront/src/i18n.ts` wherever one exists.

Sample products, prices and copy live in each board's `renderVals()`. Phone boards are 390 px wide and fill their frame (`min-height: 100vh`), so the pinned bottom bars sit at the frame's bottom. Each frame in `canvas.json` is the height of the board's longest state (measured with `render-board.mjs`, plus about 40 px): clipped content is worse than some empty space in shorter states.

A component that must stick to the bottom of the screen (the phone bottom bar) is wrapped in a `<div style="position: sticky; bottom: 0">` in the page itself: sticky positioning only works when the sticky box sits directly in the tall page, not inside the component's own wrapper.

## Republishing in a later session

Ask Claude to republish this folder to the canvas. The publish call is the Artifact tool with:

- `url`: `https://claude.ai/artifact/4FbGnnuZvYhJXKHWHpkJwt`
- `root`: `design/storefront-redesign/canvas`
- `file_path`: `design/storefront-redesign/canvas/project/canvas.json` (absolute path)
- `files`: the output of `node design/storefront-redesign/files-map.mjs --except=canvas.json`

Before republishing, read the live canvas first (Artifact `read` on `project/canvas.json` and the boards you will overwrite): people can edit boards in the page, and a publish over a newer edit is refused. Merge their changes into these files, publish, then commit the merged files here.

To start a fresh canvas instead (another account, or a clean copy), create a new artifact from the Design type (Artifact `quickstart` with intent `design`, then publish with the type's `type_url` and a title), then publish these files to the new URL the same way and update the link above.

## Pulling canvas edits back into the repo

If someone edits the canvas in the browser, read the changed files with the Artifact tool (`read` with `paths`), copy them over `canvas/project/`, and commit. The canvas and this folder should always match.

This folder is excluded from Biome: the board scripts are fragments that only run inside the canvas runtime.
