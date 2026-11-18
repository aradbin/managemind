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
- **Phone bottom bar (Home, Categories, Cart, Account)** on every phone page except product, cart and checkout, which have their own pinned buy, checkout or pay bar. Two bars stacked at the bottom would take too much of the screen.
- **Brand on cards follows the theme's `card.showBrand`.** It is off in the `general` preset, so general stores don't show it; grocery and electronics stores can turn it on.
- **Recently viewed** on the home pages and the product page, with a "Clear history" button. In the real storefront it lives in the browser's own storage (no account, no platform work) and only appears once the shopper has viewed something.
- **Grids, not sideways sliders, for products.** Shoppers rarely swipe sideways rows, so products past the first one or two go unseen. Deals, New arrivals and "You may also like" are grids with a "See all" link. Sideways scrolling is kept only for small chip rows (subcategories, search category filters, quick filters), where the next chip visibly peeks in.
- **Trust near the top.** Cash on delivery, delivery times, 7-day returns and online payment options sit right under the hero, and again on product, cart and checkout.
- **The top bar is the theme's announcement slot,** not a repeat of the delivery promise.
- **Bangla.** The phone header and footer switch language; the Bangla home board uses the store's existing translations and Bengali numerals.
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
- Minimal header (store name, "Secure checkout", back to cart), no site navigation.
- Mobile number first. Division starts on "Choose": delivery shows as "Choose your division" and the total as "Total before delivery" until picked. Terms box starts unticked.
- Errors: a summary at the top plus a message on each field.
- Cash on delivery is the first payment option; online payment and "delivery charge now, rest on delivery" follow.

**Order tracking**
- Order number and mobile number; not-found and field errors; a five-step progress line from the store's status names; items, total, payment, address; cancel with confirmation.

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

## Still to design

- Account pages (sign in, orders, addresses) and returns requests.
- The grocery and fashion presets in the new layout.
- Bangla versions of pages beyond home.
