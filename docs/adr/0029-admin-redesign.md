# ADR 0029: The admin's redesign: colour tokens, cards on a canvas, Inter, and a five-tab phone bar

- Status: Accepted
- Date: 2026-10-24
- Design: the approved canvas "ManageMind Admin Redesign" (18 screens, desktop and phone). Code: `apps/admin/src/styles.css`, `apps/admin/src/components/ui/`, `apps/admin/src/routes/_shell.tsx`
- Amends: phase-1-plan §7.3 (the shell and the colour tokens)

## Context

The admin works, but it reads as a developer tool: one blue on white, content straight on the page, and a phone bar with seven or eight columns whose labels barely fit. Merchants open it many times a day, mostly on phones, to see what is waiting and act on it. The owner approved a redesign built on established admin patterns (Shopify's Polaris for commerce, Stripe and Linear for density and restraint) after reviewing every screen.

## Decision

1. **Colour tokens, not raw colours.** The token names stay (`background`, `foreground`, `muted`, `primary`, `danger`, `warning`, `success`, `border`), so every existing screen picks up the new look. New ones are added:
   - `canvas`: the grey page behind the cards;
   - `input`: the field borders;
   - `primary-soft`, `danger-soft`, `success-soft`;
   - `info` and `shipped`, for status chips.

   One accent, a deep green (#0E7A5A), replaces the blue. Each text and background pair passes 4.5:1, in the light theme and the dark one.
2. **Cards on a canvas.** Screens group their content into white cards (`Card`, `CardSection`) on the grey canvas. Corners are 8 px on controls and 12 px on cards. Buttons and fields stay at least 44 px tall.
3. **Status chips have five tones, each with its word:**
   - waiting: amber;
   - in progress: blue;
   - shipped: violet;
   - done: green;
   - a problem: red.

   Cancelled and refunded are grey. The tones also differ in lightness, so no status depends on hue alone.
4. **Inter for Latin text, Noto Sans Bengali for Bangla.**
   - The dependency is `@fontsource-variable/inter` (5.3.0, SIL Open Font License), self-hosted like Noto Sans Bengali.
   - The browser downloads only the files whose glyphs a page uses: about 48 KB for Latin, plus 85 KB more for extended Latin, which is rarely needed.
   - The Greek, Cyrillic and Vietnamese files stay out of the service worker's precache.
   - No JavaScript is added, so the 150 KiB budget before sign-in is unchanged.
5. **The shell.**
   - **Desktop:** the sidebar is grouped. The store switcher sits at its top, then the selling pages, then a "Store" group.
   - **Top bar:** search first, then View store, the language switch, help and the account menu.
   - **Phone:** the bar holds five tabs: Home, Orders, Products, Customers and More. More is a page with the rest of the navigation, the account, the store switch, help and sign-out, so the header keeps only the store, search and language.
   - **Platform area:** it keeps the same frame.

## Options considered

- **Keep the look and fix only the phone bar.** Cheaper, but the owner asked for a redesign and approved it screen by screen.
- **A component library** (shadcn/ui in full, Mantine). We already follow shadcn's patterns on Radix. A library would add JavaScript and churn without changing what the owner approved.
- **The system font for Latin text.** No download, but it differs on each platform (Roboto, Segoe UI, San Francisco), and the approved screens were drawn with Inter.

## Consequences

- Every screen changes colour at once. Screens not yet rebuilt still read well on the new tokens, but sit on the grey canvas without cards until their turn.
- The status colours change meaning: "confirmed" is now blue (in progress), no longer green.
- E2E selectors keep working: the store switcher's and the language switch's accessible names are unchanged, and navigation is still links named by `nav.*`.
