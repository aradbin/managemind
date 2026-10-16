# ADR 0012: Dependency choices

- Status: Accepted
- Date: 2026-10-09

## Context

`docs/PLAN.md` requires an ADR for every new dependency and asks for small dependencies only. This ADR is the running list. Each pull request that adds a dependency adds a row here; a choice that changes later gets a superseding ADR.

## Decision

| Dependency | Version | Where | Why | Alternatives considered |
| --- | --- | --- | --- | --- |
| pnpm (workspaces, catalog) | 10.28 | Root | Fast, strict dependency isolation; the `catalog:` protocol keeps one version of each shared dependency across packages | npm workspaces (no catalogs, looser isolation) |
| Turborepo | 2.11 | Root (dev) | Task pipeline and caching across packages, as the plan specifies. Its `agentGuidance` option is turned off so it does not write an `AGENTS.md` file into the repository | Plain pnpm `-r` scripts (no caching) |
| Biome | 2.5 | Root (dev) | One tool for lint and format, as the plan specifies | ESLint + Prettier (two tools, slower) |
| TypeScript | 6.0 | All packages (dev) | TypeScript 7.0 (the native compiler) is out, but `@astrojs/check` declares a peer range of `^5.0.0 \|\| ^6.0.0`, and TypeScript 7.0.2 exposes its programmatic API only under `unstable/*`, which Astro's Volar-based checker does not use. Staying on 6.0 keeps one compiler for every package; revisit when `@astrojs/check` accepts 7 (checked 2026-10-09) | TypeScript 7.0 |
| Vitest | 5.0 | Packages (dev) | Unit and integration tests, as the plan specifies | — |
| pg (node-postgres) | 8.23 | `packages/db` (dev, tests only for now) | Test client for the local database check. The runtime driver for Workers is decided by the database-path spike (ADR 0002) | postgres.js |
| (none) for money and UUIDv7 | — | `packages/shared` | Money is about 140 lines on integers and BigInt, and UUIDv7 about 40 lines on `crypto.getRandomValues`. Both are small, fully tested and free of runtime dependencies, which keeps Worker bundles lean | dinero.js; the `uuidv7` package |
| drizzle-orm, drizzle-kit | 0.45, 0.31 | `packages/db` | Typed SQL and generated migrations, as the plan specifies. drizzle-kit generates tables and RLS policies; `FORCE RLS`, roles and grants are hand-written custom migrations (ADR 0009) | Kysely; raw SQL migrations only |
| tsx | 4.23 | `packages/db` (dev) | Runs TypeScript scripts (migrate, seed) in Node without a build step | Node's type stripping (needs `.ts` import extensions throughout) |
| @sentry/cloudflare, @sentry/react | 11.6 | `apps/api`, `apps/storefront`; `apps/admin` | Error reports, as the plan specifies (phase-0-plan §9). Errors only, no tracing, and no personal data (`dataCollection` off). The storefront wraps Astro's handler itself instead of using `@sentry/astro`, so shoppers download no Sentry code | `@sentry/astro` (adds a browser bundle to every shopper page); Workers Logs alone (no alerts or grouping) |
| @sentry/cli | 3.8 | `scripts` (dev) | Injects debug IDs into the built Workers and admin, and uploads their source maps from the deploy workflow. The API is bundled with a wrangler dry run and then deployed with `--no-bundle`, so the uploaded maps match the deployed file exactly | Sentry's Vite plugin (the API is not built with Vite); release-name matching (fragile with Workers' file paths) |
| (none) for Resend | — | `packages/providers` | One `fetch` call to Resend's HTTP API is all the adapter needs, so there is no SDK in the Worker bundle (ADR 0014) | The `resend` npm package |
| (none) instead of Mailpit | — | `packages/providers` | The `capture` adapter saves emails to the database outside production, for local development, previews and Playwright alike (ADR 0014) | Mailpit (one more thing to install and run) |
| better-auth | 1.7 | `apps/api` | Staff identity: email sign-in codes, sessions and cookies, and TOTP two-factor login, as the plan specifies (ADR 0005). Only the core and the `emailOTP` and `twoFactor` plugins are used; memberships and roles are ours (phase-1-plan §3.3). Adds about 330 KiB gzipped to the API bundle (354 to 679 KiB) | Our own sessions and TOTP (more security-sensitive code to own); Lucia (no longer maintained) |
| openapi-typescript | 7.13 | `packages/sdk` (dev) | Generates the admin's API types from the API's own OpenAPI document; CI fails when the committed types are out of date. It declares a TypeScript 5 peer but generates correctly under 6.0 (pnpm only warns) | Hand-written types (drift); orval (heavier, generates code) |
| openapi-fetch | 0.17 | `packages/sdk` | A typed `fetch` over those types, about 6 KB in the admin bundle, with no runtime code generation | Hono's RPC client (needs the app's types at build time, tying the admin to the Worker's code); ky or plain fetch (untyped) |
| @tanstack/react-router, @tanstack/router-plugin | 1.170, 1.168 | `apps/admin` | Type-checked routes and search params, file-based routing with automatic code splitting (each screen is its own chunk), and `beforeLoad` guards for sign-in, as the plan specifies. The plugin generates `src/routeTree.gen.ts` at build time; it is committed and excluded from Biome | React Router (weaker typing of params and search) |
| @tanstack/react-query | 5.104 | `apps/admin` | Server state: caching, retries and invalidation after writes, as the plan specifies | SWR (no mutations model); hand-written fetch state |
| tailwindcss, @tailwindcss/vite | 4.3 | `apps/admin` | Styling with design tokens in CSS (`@theme`), as the plan specifies. Only the classes used ship; the admin's CSS is about 4 KB gzipped | CSS modules (no shared scale) |
| @radix-ui/react-dialog, -dropdown-menu, -slot | 1.1, 2.1, 1.3 | `apps/admin` | Accessible primitives (focus trapping, keyboard, ARIA) behind the shadcn/ui components, which are copied into `src/components/ui` rather than installed. Each primitive is added only when a component needs it | Headless UI; writing the ARIA ourselves |
| class-variance-authority, clsx, tailwind-merge | 0.7, 2.1, 3.7 | `apps/admin` | The small helpers shadcn/ui components use for variants and class merging (`cn()`) | Template strings (conflicting classes win by source order) |
| lucide-react | 1.49 | `apps/admin` | Icons, imported one by one so only the used ones ship | Inline SVGs (no consistent set) |
| @fontsource/noto-sans-bengali | 5.3 | `apps/admin` | Self-hosted Noto Sans Bengali (400 and 600), so Bangla renders the same on every phone and no font request leaves for Google; the Bengali and Latin subsets load only when text needs them (`unicode-range`) | Google Fonts (a third-party request); system fonts (Bangla support varies by phone) |
| vite-plugin-pwa, workbox-window | 1.3, 7.4 | `apps/admin` (dev; workbox-window at runtime) | Installable admin with a precached app shell, and a service worker that never caches API responses (`runtimeCaching` is empty and `/api`, `/v1` are excluded from the navigation fallback). Updates wait for the user (an "update available" prompt), so a form is never reloaded under them | Hand-written service worker (more code to own); no PWA (the plan asks for one) |
| lean-qr | 2.7 | `apps/admin` | Draws the authenticator setup QR code as an SVG path, about 4 KB gzipped, loaded only with the account page. Chosen by size, as the plan asks: `uqr` is the same size but less maintained; `qrcode` is several times larger | `qrcode`; `uqr`; showing only the key (typing 32 characters on a phone) |
| react-hook-form, @hookform/resolvers | 7.89, 5.9 | `apps/admin` | Forms with uncontrolled inputs (no re-render per keystroke on slow phones) validated by zod schemas, as the plan specifies. Field components in `src/components/form.tsx` translate zod's issue codes into the admin's Bangla and English messages and put the API's 422 field errors on their fields. Loaded only with the screens that have forms, not with sign-in | Formik (larger, re-renders); hand-rolled state per form |
| @axe-core/playwright | 4.13 | `e2e` (dev) | Runs axe on every screen of the E2E flows and fails on serious or critical WCAG 2.1 A/AA violations, as the plan specifies (§7.3) | Lighthouse CI (one page at a time, no signed-in flows); manual audits only |
| papaparse | 5.7 | `apps/admin` | Reads and writes the catalog import's CSV files in the browser (quoted fields, Bangla, a byte-order mark from Excel), about 7 KB gzipped, loaded only with the import screen (phase-2-plan §3.7) | A hand-written CSV parser (quoting and line endings are easy to get wrong); `csv-parse` (Node-first) |
| read-excel-file, write-excel-file | 9.3, 4.1 | `apps/admin` | Reads and writes `.xlsx` for the import and export in the browser, so the Worker spends no CPU on files. Together about 33 KB gzipped, loaded only when an Excel file is read or written. Values only: no formulas, styles or macros | SheetJS (`xlsx`; its npm releases stopped, and it is several times larger); ExcelJS (larger, Node-first) |
| @tiptap/react, @tiptap/starter-kit, @tiptap/pm | 3.31 | `apps/admin` | The description editor (phase-2-plan §3.5), limited to paragraphs, headings 2–3, bold, italic, lists and http(s)/mailto links; its JSON is fitted to the stored whitelist before saving. About 127 KB gzipped, in its own chunk loaded only where a description is edited. A "Plain text" switch falls back to a Markdown text area if a Bangla keyboard misbehaves | Lexical (its own document format, not ProseMirror JSON); a Markdown text area only (harder for shop staff) |

All versions are pinned exactly in `pnpm-workspace.yaml`; Renovate (added with CI) proposes upgrades.

## Consequences

- Upgrading a shared dependency is a one-line change in the catalog.
- TypeScript 7 is a later, deliberate upgrade, not an accident of `latest`.
