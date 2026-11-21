# ADR 0035: The storefront follows the general-store redesign boards

- Status: Proposed. Steps 1–7 are built on the branch `ccr-5ed5b400-cybnlp` (Nov 20). What still differs from the boards is listed under each step and waits on the platform work in DECISIONS.md.
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
| 3 (built) | Listing and search: Load more as `?page=N` links, quick filter chips, one-tap price ranges, greyed zero counts, collapsing facet lists, removable chips, no-results suggestions, back to top, category introduction, the quick-add picker | An On sale filter, price-range and stock and sale counts |
| 4 (built) | Product: the option pickers and buy buttons, Order on WhatsApp, the delivery box, collapsed specifications, the phone's buy bar (shown once the in-page buttons scroll away), the desktop mini-cart, Recently viewed | Delivery zones, COD and the return window in the product page's data |
| 5 (built) | Cart and checkout: the searchable Area field, the linked error summary, the trust line, the phone-code dialog with its resend countdown, the blocked-checkout panel, the price-changed marks, the collapsed phone summary, the pinned desktop summary | A `shop` page endpoint: the layout and the store's facts |
| 6 (built) | Thank-you, tracking and account: payment box with Copy, "Order faster next time", the headline status, parcels, returns, account tabs and the address Undo | The expected delivery date; photos on account orders |
| 7 (built) | The pinned slim headers (desktop and phone), header search suggestions, the loading and error states | A cached search-suggestions endpoint |

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

## Step 3

- **Core** (additive): an On sale filter (`sale=1`: a live variant with a sale price now, or a compare-at price above what it costs), and three more facets: one-tap price ranges with counts (four round ranges from the shared `priceRanges`, counted before the price filter), and how many of the listing are in stock and on sale.
- **Categories and collections:** filters in a sidebar on desktop, applied as they are ticked; on phones a full-screen sheet behind a pinned Filters and Sort bar, applied with "Show products", and quick filter chips (In stock, On sale, the cheapest range) with counts. Price ranges are links styled as radio buttons, plus min and max with Go. Filter lists longer than four collapse behind "Show all N"; colour values show swatches. Applied filters show as chips that remove them, with Clear all; with no results the page offers to remove each one.
- **Load more** is a link to `?page=N` that the script follows in place: "Showing 24 of 132 products", a progress bar, focus on the first new product. Without scripts, page N shows "Showing 25–48 of 132" and a link to the earlier products. Back to top appears after two screens (on the left when the store's chat buttons hold the right corner).
- **The category's description** moved under the products as "About …".
- **Search:** category chips with counts (All, then each category) and sort ("Best match" for featured), no sidebar. With no results: tips and the categories.
- **Quick add:** Choose options on listing and search cards opens a dialog (a bottom sheet on phones) with the product's options, from the product page data the storefront already proxies (`/api/pages/products/{slug}`), so no new endpoint. Choices that can't be bought with the others chosen are struck through; Add to cart adds the matching variant and the card turns into "Added · View cart". Without scripts, or if the data can't be had, it is a link to the product page.
- **Where step 3 differs from the boards:** "Show N products" in the sheet reads "Show products" (the count would need a request per tick); "Did you mean" and popular searches wait for platform work (DECISIONS.md items 4 and 5).
- **Fixed on the way:** `.wrap`'s padding shorthand was zeroing `main`'s top padding since step 1.

## Step 4

- **Core:** the product page's data has the store's `facts` (active delivery zones with charge and time, cash on delivery, online payment, the return window), from the same `shopFacts` the legal pages use, and product pages carry the `legal` cache tag, which zone, COD and return-policy changes already purge.
- **The page:** the gallery (edge to edge with a counter and dots on phones, thumbnails on desktop) beside brand, title, SKU, the price with "Save ৳240 (16%)", "In stock, ready to ship", option pickers whose legend names the choice ("Size: L"), colour swatches, and choices that can't be bought with the others struck through; quantity, Add to cart and Buy now (adds, then checkout); Order on WhatsApp; the delivery, COD and returns box with a link to the store's returns page; About this product beside Specifications (folding rows on phones, Specifications folded); You may also like (four, with "See more in" the category); Recently viewed.
- **After Add to cart:** desktops get the mini-cart panel (the line, the cart subtotal, Checkout, View cart, Continue shopping) from the cart API's answer; phones get a note above the buy bar.
- **Phones:** a buy bar (Add to cart with the price, Buy now) pins to the bottom once the in-page buttons have scrolled up out of view, and the header's menu becomes a back arrow to the product's category.
- **Where step 4 differs from the boards:** the in-page Add to cart on phones doesn't repeat the price (the pinned bar does); share links stay under the box.

## Step 5

- **API:** `/v1/store/pages/shop` answers the cart and checkout shells with the layout and the store's facts (delivery zones, COD, online payment, return window), under the store and legal cache tags; the SDK is regenerated. Other shells keep `/v1/store/pages/layout`.
- **Cart:** "Your cart" with the item count; rows with photo, title, options, "৳1,250 each", Remove, a stepper and the line total; Continue shopping; an Order summary card (Subtotal (3 items), "Added at checkout"), the delivery note from the store's zones, "Have a promo code?" folded, Go to checkout, Order on WhatsApp and the promises (cash on delivery, the return window, online payment). Phones get the summary flat under the rows and a pinned bar with the subtotal and Checkout.
- **Checkout:** its own header (store name, "Secure checkout", Back to cart; a back arrow on phones) and footer (the legal pages and Help), on the surface colour with the form in white cards; mobile number first; one searchable Area field over the geography file (thana, upazila or district, either language, with district and division in each match; arrow keys and Enter; the pick as a card with Change) in place of the three dropdowns; the delivery note; "Add a note for the store" folded; payment as radio cards; a summary of problems at the top, each a link to its field, with errors clearing as fields are fixed. The order summary (photos with quantity badges, "Total before delivery" until an area is chosen) is pinned beside the form on desktop and folds at the top on phones, where "Pay on delivery ৳…" and Place order pin to the bottom with a one-line promise.
- **Fixed on the way:** shopper-page scripts got plural messages pre-rendered in their plural form ("1 items"); they now get both forms and choose by the count.
- **Where step 5 differs from the boards:** the cart has no "You may also like" (the cart page has no products to suggest from); the area list shows each match's district and division but not its delivery charge (DECISIONS.md item 12); the terms box stays under the payment choices on desktop too. (The checkout states and the promo code came after step 7, below.)

## Step 6

- **Thank-you page:** its own header (store name, Help) and footer; a tick, "Thank you for your order", the order number with Copy; what to pay and when (cash on delivery, the delivery charge paid and the rest due, paid online, or Pay now while an online payment is due) with what happens next; What you ordered and Delivery to as cards; Continue shopping and Track your order; and, where the store has shopper accounts, "Order faster next time".
- **Tracking:** the form as a card with where to find the number; once found, it gives way to the order: "Order #1002", one headline status (the order's until it ships, then the parcel's), the five-step progress line, parcels with their courier link and updates, the items and totals; beside it payment, the address, Message us on WhatsApp (when the store's chat is on), Cancel this order and Track another order.
- **Account:** signed out, the sign-in card beside "Why sign in?" and "Ordered without an account?"; signed in, the greeting with Sign out, and Your orders, Saved addresses and Your details as a side menu on desktop and tabs on phones; orders as cards with number, date, item count, a status chip and the total, each opening tracking.
- **Where step 6 differs from the boards:** "Order faster next time" links to the account page's email sign-in instead of sending the code in place, and doesn't attach the order just placed (DECISIONS.md item 15); tracking has no order date or expected delivery date (item 14) and no order photos on account orders (item 13). (The saved-address cards, their form and Undo came after step 7, below.)

## Step 7

- **The slim bar:** once the full header scrolls away, a separate fixed bar pins to the top (so nothing on the page jumps): on phones the menu (or the product page's back arrow), the search field and the cart; on desktop the store name, an All categories button (it goes back up and opens the menu), search, Account and Cart. The phone listing's pinned Filters and Sort bar moves down under it. Checkout and the thank-you page, with their own headers, have none.
- **Search suggestions:** two letters in the header's field list the store's categories that match (from the layout, no request) and "See all results for …", with arrow keys and Enter.
- **Loading:** the cart shows grey rows where its lines will be while it loads.
- **Where step 7 differs from the boards:** suggestions have no products yet: that needs a cached suggestions endpoint (DECISIONS.md item 5), as typing would otherwise run a full search per keystroke. The other states on the States board (Adding…, Placing your order…, payment failed) were already in the pages' scripts.
- **Fixed on the way:** grid items honour z-index even when static, so the open desktop filter sidebar painted over the pinned bar; it has none on desktop now.

## After step 7: what the boards had left

- **Checkout's states** (the Checkout boards' Scenario tweak): a notice above the form for a price change (amber, with each changed line marked "Was ৳590, now ৳620" and the summary opened on phones), too many orders from the number (with WhatsApp and Call links) and cash on delivery refused for this order when online payment is there; focus moves to it. The phone code is a dialog (a bottom sheet on phones): the number it went to with Change number, the code field that confirms by itself at 6 digits, and "Send a new code in 0:45" before another can go. A paused store, no way to pay and an empty cart replace the form with a panel (the store's holiday message, WhatsApp, Back to cart).
- **An area the store doesn't serve** shows as soon as it is picked: the cart's answer for the area has no zone, so the area card turns red with "The store doesn't deliver to this area", the delivery box asks the store with WhatsApp and Call links, and Delivery reads "Not available". With a served area the box shows that zone's charge and time instead of every zone.
- **The promo code** is in checkout's summary too, the cart page's form shared (`codeForm` in `cart-view.ts`; inside the checkout form it is a group that applies on Enter, as forms can't nest).
- **Saved addresses** in the account: cards with the label and Default, the name and number and the address, Make default (`PATCH`) and Delete; Delete offers "Address deleted." with Undo, which saves the address again. A dashed card opens the form, which now has checkout's searchable Area field (`AreaField.astro` and `scripts/area-field.ts`, shared by both pages) and Cancel.
- **Filter values with no products** under the other filters (in stock, on sale, the price) are listed greyed and can't be ticked, rather than dropped: the core's facet query now takes every value in the scope and counts only the products the other filters keep. A group with one value left to choose still goes, as before, unless one of its values is ticked.
- **The place in a listing:** Load more keeps, per address, how many pages it added and how far down the shopper was (sessionStorage, written as the page is left); Back from a product loads those pages again and scrolls there. A fresh visit or a reload starts at the top. The demo catalog has no category big enough for Load more, so this was checked locally, not in E2E.
- **Design: the states board in Bangla** (`StatesBn`, generated by `build-boards.mjs` like the other Bangla boards and published to the canvas), its copy from the storefront's own Bangla strings where they exist.
- **E2E:** "checkout when the store or the server says no" walks these states with the API's answers stood in for, as the demo stores must stay open and serve everywhere for the other tests. The orders flow, which turns accounts on and signs a shopper in, now saves an address with the Area field, deletes it and undoes that.

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
