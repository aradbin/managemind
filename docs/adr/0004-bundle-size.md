# ADR 0004: Worker bundle size

- Status: Accepted
- Date: 2026-10-09
- Spike code: `spikes/cpu-api/`, `spikes/cpu-store/` (deleted after Phase 1)

## Context

The Workers Free plan limits each Worker to 3 MiB after compression (10 MiB on Workers Paid). The plan's stack is heavier on the API side (Hono, zod and OpenAPI, Drizzle, pg, Better Auth, Sentry) than on the storefront (Astro). Large bundles also slow cold starts, because the whole script is parsed when an isolate starts.

## Method

- Built each spike Worker with the real dependencies:
  - **API:** `@hono/zod-openapi` routes, Better Auth (core only, no plugins), Drizzle with node-postgres, `@sentry/cloudflare`;
  - **storefront:** Astro 7 SSR with `@astrojs/cloudflare` 14, `session: false`, `imageService: 'passthrough'`.
- Read sizes and startup times from `wrangler deploy`.
- Built an esbuild metafile (`wrangler deploy --dry-run --metafile`) for the per-package breakdown.

## Results (2026-10-09)

| Worker | Raw | Gzip | Free limit used | Startup time |
| --- | --- | --- | --- | --- |
| API spike | 3,657 KiB | **645 KiB** | 21% | **94 ms** |
| Storefront spike | 683 KiB | **175 KiB** | 6% | **21 ms** |
| Auth spike (Better Auth with organization and email-code plugins) | 3,247 KiB | 538 KiB | 18% | — |
| Database spike (four drivers) | 694 KiB | 155 KiB | 5% | — |

Largest packages in the API bundle (raw):

| Package | KiB | Share |
| --- | --- | --- |
| zod | 829 | 23.5% |
| kysely | 604 | 17.1% |
| better-auth + @better-auth/core | 602 | 17.1% |
| @sentry/core + @sentry/cloudflare + OpenTelemetry | 557 | 15.8% |
| drizzle-orm | 227 | 6.4% |
| pg | 94 | 2.7% |
| hono | 62 | 1.7% |

Kysely is not used by our code. Better Auth's main entry imports its Kysely adapter, so the bundler cannot remove it.

## Decision

1. **No size work is needed now.** The API uses about a fifth of the free limit and the storefront about a twentieth.
2. **A CI check** runs in the build step for both Workers (PR 16): a warning at 2.5 MiB gzip and a failure at 3 MiB. Startup time is printed in the job log.
3. **Known trims, kept in reserve and applied only if the check warns or startup time passes 200 ms:**
   - import Better Auth through a slimmer entry, if one exists, to drop Kysely (about 600 KiB raw);
   - drop Sentry's OpenTelemetry integration (about 180 KiB);
   - move the OpenAPI document to a build step (zod-to-openapi, about 64 KiB).
4. **Sentry stays in both Workers.** Its size is affordable, and errors in production matter more.

## Consequences

- Phase 1 adds the organization plugin and more routes to the API; the auth spike suggests plugins add little.
- The storefront stays small, so themes and islands have plenty of room.
- On Workers Paid the limit becomes 10 MiB, but startup time still matters, so the CI warning stays at 2.5 MiB.
