# Storefront redesign: decisions and open work

What the redesign canvas decided, why, and what the storefront still needs before it can ship. Boards are in `canvas/project/`; how to republish them is in [README.md](README.md).

## Research it rests on

- Baymard Institute: [product list and filtering](https://baymard.com/research-articles/current-state-product-list-and-filtering), [PLP UX](https://baymard.com/blog/product-listing-page-plp-ux), [what to show on list items](https://baymard.com/blog/product-listing-information), [filter UI](https://baymard.com/blog/ecommerce-filter-ui), [filter counts](https://baymard.com/guidelines/467-indicating-the-number-of-matches-for-filtering-options), [items loaded by default](https://baymard.com/research-articles/number-of-items-loaded-by-default), [load more vs pagination](https://baymard.com/blog/external-load-more-vs-pagination-vs-infinite-scrolling), [mobile UX 2026](https://baymard.com/blog/mobile-ux-ecommerce), [product page 2026](https://baymard.com/research-articles/current-state-ecommerce-product-page-ux), [homepage and categories](https://baymard.com/homepage-and-category-usability/articles).
- [Shopify storefront filtering guidelines](https://shopify.dev/docs/storefronts/themes/navigation-search/filtering/storefront-filtering/storefront-filtering-ux).
- Large general stores (Amazon, Walmart, Target, Daraz) and catalogue themes (Shopify Dawn, Empire).
- Bangladesh context: cash on delivery dominates, and reviews and ratings strongly shape trust on Daraz ([BAUET journal study](https://journal.bauet.ac.bd/wp-content/uploads/2024/12/V4-I2-Article-21.pdf)).

## Visual system

- Theme tokens of the `general` preset: primary `#1f4e8c`, text `#1a1f29`, surface `#f4f6f9`, accent `#f59e0b` (cart badge only), sale `#b42318`. Muted text `#545b69` (passes 4.5:1 on white and on the surface colour). Success green `#1d6b3a`.
- Hind Siliguri for both languages. Bangla text gets line height 1.6 (English 1.45 to 1.5).
- Corner radii: 8 px for controls and images; 12 px for panels and sections; 4 px for small badges. Matches the theme's `small` and `large` radius tokens.
- Section headings 24 px on desktop, 20 px on phone. Page titles 32 px desktop, 22 to 24 px phone.
- Every tap target is at least 44 px. Inputs on phone use 16 px text so iOS does not zoom.
- Keyboard focus: every page shows `:focus-visible` as a 3 px primary-colour outline, 2 px offset, with a 2 px white ring inside it, so it shows on white, grey and the blue hero alike.
- Colour roles: sale red only for sale prices and discount badges (the header's "Today's deals" link is normal text with a small red "Sale" tag); amber only for the cart count; primary blue for actions and links.
- Section rhythm: on the home pages, Today's deals and New arrivals sit on full-width pale grey bands (`#f4f6f9`) between white sections, so the page reads in clear blocks.
- Image placeholders are labelled grey boxes; no stock photos.

## Decisions that apply everywhere

- **Shared components.** Desktop header and footer, phone header, footer and bottom bar, the product card and the quick-add picker are components every page mounts, so they cannot drift apart.
- **Desktop and phone match.** Same sections in the same order, same copy, same button order and styling (filled Add to cart, outlined Buy now). Layout adapts (grids reflow, filters move into a sheet); content does not.
- **Search is the main header element** on every page, with a Search button on desktop and phone. Typing in the desktop header shows suggestions (categories and products).
- **Phone header pins a slim search bar.** Once the shopper scrolls past the full header (about 140 px), a 60 px bar fixed at the top keeps the menu or back button, the search field and the cart. The announcement and store name scroll away. It is a separate fixed bar, not the header shrinking, so nothing on the page jumps.
- **Desktop header pins a slim bar too.** Past the full header (about 176 px) a 64 px bar fixed at the top keeps the store name, an All categories button (it scrolls back up and opens the menu), the search field, Account and Cart. The announcement bar and category links scroll away.
- **Phone bottom bar (Home, Categories, Cart, Account)** on every phone page except product, cart and checkout, which have their own pinned buy, checkout or pay bar. Two bars stacked at the bottom would take too much of the screen. It highlights the tab the page belongs to and nothing on pages that belong to none (order tracking).
- **Brand on cards follows the theme's `card.showBrand`.** It is off in the `general` preset, so general stores don't show it; grocery and electronics stores can turn it on.
- **Recently viewed** on the home pages and the product page, with a "Clear history" button. In the real storefront it lives in the browser's own storage (no account, no platform work) and only appears once the shopper has viewed something.
- **Grids, not sideways sliders, for products.** Shoppers rarely swipe sideways rows, so products past the first one or two go unseen. Deals, New arrivals and "You may also like" are grids with a "See all" link. Sideways scrolling is kept only for small chip rows (subcategories, search category filters, quick filters), where the next chip visibly peeks in.
- **Trust near the top.** Cash on delivery, delivery times, 7-day returns and online payment options sit right under the hero, and again on product, cart and checkout.
- **The top bar is the theme's announcement slot,** not a repeat of the delivery promise.
- **Bangla.** Every page has Bangla boards, desktop and phone, in the store's existing translations with Bengali numerals and a taller line height (1.6). The language link in the desktop header, desktop footer and phone header goes to the same page in the other language. In Bangla, search matches anywhere in a product's name (Bangla has no word starts to anchor on), and "From ৳990" reads "৳৯৯০ থেকে".
- **Store copy first.** Messages reuse the storefront's own strings (`apps/storefront/src/i18n.ts`) wherever one exists, so the boards show what shoppers will actually read.
- **Placeholders, not invented facts:** `[Announcement]`, `[hotline number]`, `[opening hours]`, `[Warranty terms]`, `[number]`, `[date]`. The ৳60 / ৳120 delivery charges, Brand A–D and all prices are samples.

## Page decisions

**Home**
- Order: hero with two offer tiles beside it (under it on phone), trust promises, Shop by category (grid), Today's deals (grid of 4, grey band), collection block (image with text), New arrivals (grid, grey band), Recently viewed, help strip (WhatsApp and phone), footer.
- The offer tiles each carry a product photo (beside the text on desktop, above it on phone), so they don't read as unfinished text blocks.
- One fixed hero, not an auto-rotating carousel.
- Phone has a bottom bar: Home, Categories, Cart, Account.

**Category listing**
- Load more (24 at a time, the platform's page size) with "Showing 24 of 132 products" and a progress bar, instead of page numbers, on desktop and phone.
- Back to top button appears after about two screens of scrolling or after loading more. On phone it sits above the bottom bar.
- A short category introduction (2–3 lines) sits under the grid, from the category's existing translated `description` field. It helps search engines without pushing products down.
- Filters: Price (one-tap ranges with counts, plus min and max), Availability, Brand, Colour (swatches), Material. Every value shows its product count; values with no matches are greyed and disabled. Lists longer than 4 collapse behind "Show all".
- Applied filters show as removable chips with Clear all. With no results, the page suggests the filters whose removal brings products back ("Remove 'Brand C' (4 products)").
- Phone: the Filters and Sort bar stays pinned while scrolling; quick filter chips (In stock, On sale, Under ৳500) sit above the grid; the filter sheet has Clear all in its header (away from the main button) and one "Show N products" button.

**Product card**
- Two-line title (cut with an ellipsis), price ("From ৳990" when sizes differ in price), compare-at price and percentage badge; brand only when the theme turns it on.
- Desktop cards keep a full-width "Add to cart" button. Phone cards replace it with a 44 px round "+" on the photo's bottom-right corner (a green tick once added), which cuts a card from about 380 px to about 270 px: roughly 6 products per screen instead of 4.
- Colour dots and "4 sizes · 3 colours" when the product has options.
- Products with options show "Choose options": on listing and search pages it opens the quick-add picker (centred dialog on desktop, bottom sheet on phone); elsewhere it links to the product page. This prevents wrong-size orders, which are costly with cash on delivery.

**Search results**
- Uses the header's search field (no second field on the page). Results narrow by category chips with counts and sort.
- No results: tips, popular searches, "Did you mean…?" for common misspellings, category links, popular products.

**Product**
- Size and colour pickers change price and stock; sold-out sizes disable both buy buttons.
- Phone: Add to cart and Buy now sit under the quantity like desktop, and a bottom bar repeats them. In the real storefront the bar should appear only after the in-page buttons scroll off screen.
- "Order on WhatsApp" right under the buy buttons; delivery charges and times by zone; cash on delivery and returns.
- Phone: "About this product" starts open and "Specifications" starts collapsed, to keep the page shorter.
- Recently viewed under "You may also like".
- Desktop Add to cart opens a mini-cart panel (Checkout, View cart, Continue shopping).

**Cart**
- Quantity and Remove per item, empty state, delivery note, promo code, suggestions that add straight to the cart. Phone keeps Checkout pinned at the bottom.

**Checkout**
- Minimal header (store name, "Secure checkout", back to cart), no site navigation. A "Have an account? Sign in to fill this in faster." link under the title; ordering as a guest stays the default.
- Mobile number first.
- **One searchable Area field instead of three dropdowns.** The shopper types a few letters of the thana, upazila or district (in English or Bangla) and picks from a list that shows the district, division and the delivery charge for each match (two Mirpurs, in Dhaka and Kushtia, are told apart by their district). The pick shows as a card with Change. Until an area is chosen, delivery shows "Choose your area" and the total "Total before delivery". The storefront already loads every division, district and area with both names (`/geo/bd.json`), so the search runs in the browser.
- Terms box starts unticked.
- **Phone: the order summary starts collapsed,** showing the item count and total, so the form starts near the top of the screen. It opens by itself when prices change.
- **Desktop: the order summary, with Place order, stays pinned** beside the form while the shopper scrolls it.
- **Errors:** a summary at the top that lists each problem as a link to its field, a message on each field, and the focus moves to the first invalid field.
- Cash on delivery is the first payment option; online payment and "delivery charge now, rest on delivery" follow.
- **Trust line under Place order:** details used only for this order and its delivery; returns within 7 days; the hotline. On phone it is one line in the pinned pay bar.
- **When the store or server says no** (the Scenario tweak shows each):
  - *Phone code:* a dialog (bottom sheet on phone) with the store's SMS text, the number it went to with "Change number", a one-time-code field that confirms by itself once all 6 digits are in, "Confirm and place order", and "Send a new code" that waits 45 seconds first ("Send a new code in 0:45"), since the store allows only a few codes an hour.
  - *Delivery charge first:* cash on delivery disappears, "delivery charge online" is chosen, and a notice explains why.
  - *No payment the order can use* and *store paused (holiday):* the form is replaced by a panel with the store's message, WhatsApp and Back to cart.
  - *Area not served:* the area card turns red with the store's message as soon as it is picked, so the shopper never fills the rest first. The delivery box under it gives the next step ("Ask the store whether they can deliver here" and a WhatsApp link) instead of repeating the message.
  - *Too many orders from this number:* an error notice with WhatsApp and call links.
  - *Price changed:* a notice, the changed line marked "Was ৳590, now ৳620", the new total, then Place order again.

**Thank-you page** (its own boards, as in the storefront, which moves to its thank-you page after the order)
- The store's words: "Thank you for your order", the order number with a Copy button, "Please keep ৳2,490 ready for the courier" (or "Payment received", or "Delivery charge paid. Please keep ৳2,430 ready"), "The store will call or message you to confirm…", what was ordered, where it goes and the delivery estimate.
- Continue shopping is the main button and Track your order the second, on desktop and phone alike. No "Back to cart": the cart is empty now.
- **Order faster next time:** an offer to save the details with a code by email, no password. Asking after the order gets accounts without slowing guest checkout.

**Order tracking**
- Order number and mobile number; not-found, "too many tries" and field errors; a five-step progress line from the store's status names; items, total, payment, address; cancel with confirmation while the order hasn't left.
- **One headline status** instead of the platform's two (order "Being prepared" next to delivery "On the way" read as a contradiction): the order's status until it leaves, then the parcel's, with the expected delivery date under it ("Delivered on [date]" once it arrives).
- **Parcels:** once shipped, each parcel shows its status, courier and tracking number, a "Track with the courier" link, and the courier's updates (newest first, open by default).
- **Returns:** once delivered, "Request a return" with the deadline. The form asks how many of each item (up to the number bought), why (the store's six reasons), an optional note and up to 3 photos, lists anything not returnable, checks the items and reason, then confirms "Return [number] requested. The store will let you know."
- Desktop puts the order on the left and payment, address and actions on the right; the return form opens in the left column, under the order. On phone it opens as a bottom sheet.

**Account**
- Sign in with a 6-digit code sent to the email address (or by SMS, "Sign in with your mobile number instead"); no password. "Use another email" goes back a step. Beside it (below on phone): why sign in, and a link to track a guest order.
- Signed in: Orders, Saved addresses and Your details, as a side menu on desktop and three tabs on phone; "Signed in as …" and Sign out at the top.
- Orders: number, date, item count, status label, total and small photos; each opens tracking. A note that guest orders aren't listed. Empty state with Start shopping.
- Saved addresses: label, Default badge, Make default, Delete with Undo; Add an address uses the same searchable Area field as checkout.
- Your details: name and mobile number (with why the store needs it), email shown read-only, Save with "Saved.".

**States**
- Loading skeleton, "Adding…", "Placing your order…", page failed to load, stock changed before checkout, online payment failed or cancelled (using the store's existing payment messages).

## Photo guidelines (for the admin)

Mixed seller photos make even a good grid look messy, and most small stores here upload whatever they have. The admin's product photo uploader should show a short guideline next to the upload area, and the storefront crops to it:

- Square (1:1), at least 1000 × 1000 px.
- Plain white or very light background, no props, no text or logos on the photo.
- The product centred, filling about 80% of the frame.
- The first photo is the product on its own; later photos can show it in use, details and size.

This needs admin work (the guideline text in the uploader, and optionally a warning for photos that aren't square); it is not on the storefront canvas.

## Mapping to the current `classic` theme

Already supported: hero, category grid, product grid and carousel, image with text, rich text, trust badges, announcement, the colour, font, radius and card tokens, the bn/en switch, the checkout fields and payment options, listing price and stock filters, attribute and option facets with counts, the four sorts, order tracking.

New, needs building in the theme:
- Offer tiles beside the hero (a hero option or a new section).
- Help strip section (WhatsApp and phone).
- Product card: options summary, "Choose options" and the quick-add picker, Add to cart on the card.
- Listing: Load more, quick filter chips, one-tap price ranges, greyed zero-count values, collapsible facet lists, the no-results suggestions, back to top.
- Header search suggestions, desktop mini-cart, phone bottom bar, phone footer, delivery-estimate box on the product page.
- Phone: the pinned slim search bar on scroll, the round "+" on cards, collapsed specifications.
- Recently viewed (browser storage), the category introduction under the grid, grey section bands, photos in the offer tiles, the focus ring.
- Desktop: the pinned slim header.
- Checkout: the searchable Area field, the linked error summary and focus on the first invalid field, the trust line, the phone-code dialog, the blocked-checkout panel, the price-changed line marks, the thank-you payment box and Copy button.
- Tracking: the parcel card layout, the headline status. Account: tabs on phone, the address Undo.
- Thank-you: the "Order faster next time" card. Checkout: the code resend countdown and auto-confirm, the pinned desktop summary.
- Bangla on every page (the storefront already switches language; the theme templates need the new strings).

## Needs platform work

1. **Remember the place in the list.** After opening a product and going back, restore the scroll position and the products already loaded. Load more should be a real link to `?page=N` (the listing already supports `page`), so it works without JavaScript and crawlers can follow it.
2. **Best selling sort.** `LISTING_SORTS` has featured, newest and both price sorts. Best selling needs sales counts per product. Rating sort needs reviews (next item).
3. **Product reviews and ratings.** There are none today. Proposal: ask for a star rating and short review on WhatsApp after an order is delivered (the store already sends WhatsApp order updates), then show stars on cards and product pages and add a "Top rated" sort.
4. **Bangla and Banglish search.** Synonyms and transliteration so "korai", "kadai" and "কড়াই" find the same product; a "Did you mean" from real misspellings.
5. **Search suggestions endpoint** for the header's type-ahead (categories and products), cached like the listing.
6. **Option data on list cards.** `ProductCard` in `packages/core/src/catalog/published.ts` has price range, compare-at, availability, brand and image, but no option summary. Quick add needs the option names and values (or a lightweight fetch of the variants when the picker opens).
7. **Page size.** Keep 24 per load on phone (`LISTING_LIMITS.pageSize`); consider 48 on desktop.
8. **Delivery charges on product and cart pages** should come from the store's delivery settings, not the samples.
9. **Sticky buy bar on phone** should show only when the in-page buy buttons are off screen (IntersectionObserver).
10. **Stock urgency** ("Only 2 left") is deliberately left out: the storefront does not expose stock counts.
11. **Photo guidelines in the admin uploader** (see "Photo guidelines" above).
12. **Delivery charge in the area list.** The area search itself needs nothing new (the geo file is already loaded), but showing each match's delivery charge before it is picked needs the store's zone of every area in the checkout state. Without it, show the charge only after the pick, as today.
13. **Photos on account orders.** The account's order list shows small item photos; if the orders endpoint doesn't return an image per line, it needs one (or the list goes without photos).
14. **Expected delivery date on tracking.** The order view has no estimate. It can come from the delivery zone's days and the date the parcel was booked, or from the courier where its API gives one.
15. **Saving details from the thank-you page.** An account created there by email code should take in the order just placed and its address. Today a guest order stays a guest order.

## Still to design

- The grocery and fashion presets in the new layout.
- A Bangla version of the loading and error states board.
