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

All versions are pinned exactly in `pnpm-workspace.yaml`; Renovate (added with CI) proposes upgrades.

## Consequences

- Upgrading a shared dependency is a one-line change in the catalog.
- TypeScript 7 is a later, deliberate upgrade, not an accident of `latest`.
