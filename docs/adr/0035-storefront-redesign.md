# ADR 0035: The storefront follows the general-store redesign boards

- Status: Proposed. Steps 1 (the frame, the product card and the home page) and 2 (the home page's new sections) are built on the branch `ccr-5ed5b400-cybnlp` (Nov 20); steps 3–7 are to come.
- Date: 2026-11-20
- Design: the canvas in `design/storefront-redesign/canvas/project/` (desktop and phone boards for every shopper page, in English and Bangla, on the `classic` theme's `general` preset), with its reasons in [DECISIONS.md](../../design/storefront-redesign/DECISIONS.md). Code: `apps/storefront/src/themes/classic/`

## Context

The storefront redesign canvas is finished: home, category listing, search, product, cart, checkout, thank-you, tracking and account, each at 1440 px and 390 px, plus the shared header, footer, product card, quick-add picker, bottom bar and states. DECISIONS.md lists what the `classic` theme has to build and what needs platform work.

The canvas is large, and much of it needs new data (offer tiles, the area search's delivery charges, search suggestions, reviews). Building it in one change would leave the storefront half-done for a long time. Building it in steps keeps every step shippable.

## Decision

1. **The boards are the specification**, as for the admin (ADR 0034): sizes, colours, corners, type and the order of things come from the boards. Where the platform lacks the data a board shows, the step says so below, and DECISIONS.md's "Needs platform work" item is the follow-up.
2. **One theme, in place.** The `classic` theme takes the new look. Stores keep their tokens: the boards' colours are the `general` preset's, and other presets keep their own colours, font and corners.
3. **Shared parts first.** The header, footer, bottom bar and product card are built once and used by every page, as on the canvas.
4. **The order of the steps:**

| Step | Pages and parts | New data or settings |
| --- | --- | --- |
| 1 (built) | Tokens, focus ring, top bar, header, category row, footer, phone bottom bar, product card with Add to cart, home sections restyled (hero, trust strip, category tiles, grey bands with "View all", image with text) | The card's only variant and its options (`ProductCard.variantId`, `options`) |
| 2 (built) | Home: offer tiles beside the hero, the help strip, Recently viewed (browser storage, also on product pages), a second hero button and a line above its heading, a line beside product grid headings | Theme sections and fields, and their editor in the admin |
| 3 | Listing and search: Load more as `?page=N` links, quick filter chips, one-tap price ranges, greyed zero counts, collapsing facet lists, removable chips, no-results suggestions, back to top, category introduction, the quick-add picker | A light variants fetch for the picker |
| 4 | Product: the option pickers and buy buttons, Order on WhatsApp, the delivery box, collapsed specifications, the phone's buy bar (shown once the in-page buttons scroll away), the desktop mini-cart, Recently viewed | Delivery charges from the store's settings |
| 5 | Cart and checkout: the searchable Area field, the linked error summary, the trust line, the phone-code dialog with its resend countdown, the blocked-checkout panel, the price-changed marks, the collapsed phone summary, the pinned desktop summary | Optionally each area's delivery charge |
| 6 | Thank-you, tracking and account: payment box with Copy, "Order faster next time", the headline status, parcels, returns, account tabs and the address Undo | The expected delivery date; photos on account orders |
| 7 | The pinned slim headers (desktop and phone), header search suggestions, the loading and error states | A cached search-suggestions endpoint |

## Step 1

- **Tokens.** `--radius` (controls, images) and the new `--radius-lg` (panels) come from `RADIUS_CSS` in `packages/shared`, which the admin's live preview uses too. The `small` radius is now 8 / 12 px (was 6 px) and `large` 12 / 16 px (was 14 px). Muted text and borders are mixed from the text, background and surface colours, so every preset gets them. Bangla pages get line height 1.6. Focus shows a primary ring with a white ring inside.
- **Header.** One header for both sizes, so a page keeps one search form and one menu. Desktop: a dark top bar (announcement or holiday notice, Track order, Help with the store's phone, language), store name, search, Account, Cart, then All categories and the top-level categories (those that don't fit one row are in All categories). Phone: the announcement, menu, store name, language, cart, then the search field. The cart count is amber.
- **Bottom bar** on phones: Home, Categories (opens the menu), Cart, Account (only with shopper accounts). Product, cart and checkout pages leave it out for their own pinned bars; order tracking, pages and the 404 highlight no tab. Chat buttons sit above it.
- **Footer.** Store name and contact, Shop (top-level categories), Help (tracking, account, the store's pages), business details, then the legal pages, cookie settings and the language link.
- **Product card.** Discount badge (−17%) or Out of stock, a two-line title, the options line ("4 sizes · 3 colours", colour dots from common colour names), the price. A product with one variant gets Add to cart, which adds it on the spot and turns into "Added · View cart"; one with several gets Choose options, a link to its product page until step 3's picker. Desktop shows a full-width outlined button; phones a round cart button on the photo. The title link covers the card.
- **Home sections.** The hero puts its text on the primary colour beside the photo (under it on phones). Product grids sit on full-width grey bands, with "View all" when they show a collection, and are grids even when set to "carousel" (DECISIONS.md: grids, not sideways sliders). Trust badges are one bordered strip on desktop and a 2 × 2 grid on phones; category tiles are 8 across on desktop and 4 on phones.

## Step 2

- **Theme schema** (all additive and optional, so every saved theme stays valid): a hero slide's `eyebrow` and `secondaryButton`, the hero's `tiles` (up to two: photo, heading, line, button), a product grid's `subheading`, and two section types:
  - `help_strip`: heading and text; its buttons are the store's WhatsApp (from the chat settings, unless chat is off) and phone (from the profile), and it hides when the store has neither;
  - `recently_viewed`: a heading. Each product page keeps a copy of its card in the browser (`localStorage`, per store and language, the last 12 for 60 days), and the section draws the last four with the card's markup, so Add to cart works there too. The copy is refreshed on every visit; its price is the one seen then. Product pages show the list under "You may also like", without the product on screen.
- **The admin's editor** has the new fields and sections. The product grid's "Layout" choice is gone: product grids are grids (step 1).
- **The `general` preset** follows the boards' order: banner, promises, Shop by category, New arrivals, Recently viewed, the help strip. Stores keep their saved themes; the preset applies when chosen.
- **The eyebrow** is drawn in the button-label colour, not the boards' amber: only that colour is checked against the primary colour, and amber fails on the grocery preset's green.

## Consequences

- **Where step 1 differs from the boards**, until a later step or a platform change:
  - No "Today's deals" link in the header, and no "Ways to pay" in the footer: the store has no deals setting, and the layout doesn't carry the payment methods.
  - The footer shows the store's contact and business details where the board has a one-line description: the store profile has no description, and the business details must stay (phase-3-plan §3.11).
  - The search field says "Search products" on desktop too.
  - Colour dots appear only for colour names in the swatch table (`apps/storefront/src/lib/swatches.ts`); option values have no colour of their own.
  - The `general` preset keeps the system font; the boards are drawn in Hind Siliguri, which stores can choose.
  - Listing, product, cart, checkout and account pages use the new header, footer and cards, but their own layout is the old one until their step.
- **Existing stores look different** after the deploy: new header and footer, cards and slightly rounder corners. Their colours, font, logo and sections are unchanged.
- **E2E:** the language link now appears in the top bar or phone header and in the footer, and a card's Choose options link names its product, so the tests match product links and the product page's Add to cart button exactly.
