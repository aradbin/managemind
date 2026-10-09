# ADR 0008: Native Postgres 18 for local development and session tests

- Status: Accepted
- Date: 2026-10-09

## Context

`docs/PLAN.md` puts local development on Postgres in Docker. Development happens in Claude Code cloud sessions, which have the Docker CLI but no Docker daemon, so containers cannot run there. The session image ships Postgres 16 binaries, while Neon production runs Postgres 18. The schema relies on Postgres 18 features, notably the built-in `uuidv7()` used as the default for every ID.

## Options

1. **Postgres 16 from the image.** No install time, but tests would run on a different major version than production, and `uuidv7()` would need a polyfill that production does not use.
2. **A Neon branch for session tests.** The same engine as production, but every test run wakes Neon compute (shared 100 CU-hours a month), adds network latency to each query, and puts branch credentials in the session.
3. **Native Postgres 18 from the PostgreSQL apt repository (PGDG), installed by a SessionStart hook.** About 9 seconds on a fresh container and nothing after that, because the container is cached once the hook finishes.

## Decision

Option 3. `.claude/hooks/session-start.sh` runs at the start of every cloud session. It:

- installs `postgresql-18` from `apt.postgresql.org` if missing;
- moves any other preinstalled cluster off port 5432 and stops it from auto-starting;
- creates and starts cluster `18/main` on port 5432 (peer auth locally, SCRAM over TCP);
- creates the `managemind` and `managemind_test` databases;
- exports `DATABASE_URL` and `TEST_DATABASE_URL` for the session;
- runs `pnpm install`.

The local `postgres` superuser password is a fixed, local-only value. It protects nothing outside the container and is not a secret. CI uses a `postgres:18` service container, so every environment runs the same major version. A test in `packages/db` fails if the test database is older than Postgres 18 or lacks `uuidv7()`.

A developer on a laptop can still run Postgres 18 in Docker or natively; only the two connection strings matter.

## Consequences

- Tests in sessions and in CI run on the same major version as production.
- Session start depends on `apt.postgresql.org` being reachable when the container is not cached yet.
- The hook runs as root and changes system Postgres configuration inside the throwaway container only. It does nothing outside cloud sessions (`CLAUDE_CODE_REMOTE` unset).
