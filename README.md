# managemind

Multi-tenant commerce platform for Bangladeshi SMEs on Cloudflare Workers and Neon Postgres.

- Plan: [`docs/PLAN.md`](docs/PLAN.md)
- Current phase: [`docs/phases/phase-0-plan.md`](docs/phases/phase-0-plan.md)
- Decisions: [`docs/adr/`](docs/adr/)

## Development

Requirements: Node 22.12+, pnpm 10, Postgres 18.

In a Claude Code cloud session, `.claude/hooks/session-start.sh` installs and starts Postgres 18, creates the databases, sets `DATABASE_URL` and `TEST_DATABASE_URL`, and installs dependencies (see [ADR 0008](docs/adr/0008-local-postgres.md)). Elsewhere, run Postgres 18 yourself and set those two variables.

```sh
pnpm install
pnpm lint        # Biome lint and format check
pnpm typecheck   # TypeScript in every package
pnpm test        # Vitest in every package
pnpm check       # all of the above

# Apply database migrations (uses DATABASE_URL_MIGRATIONS or DATABASE_URL)
pnpm --filter @managemind/db db:migrate
# After changing packages/db/src/schema: generate a migration, then review the SQL
pnpm --filter @managemind/db db:generate --name <change>
```
