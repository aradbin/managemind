# ADR 0028: Nightly encrypted backups in R2, and a monthly restore test

- Status: Accepted
- Date: 2026-10-24
- Plan: phase-5b-plan §3.14, Q15. Code: `.github/workflows/backup.yml`, `.github/workflows/restore-test.yml`, `scripts/backup/`
- Builds on: ADR 0027 (jobs in GitHub Actions), the R2 lifecycle rules (`scripts/production/provision.ts`)

## Context

Neon's free plan keeps a short history for point-in-time restore, which covers a mistake noticed within hours, not one noticed next week, nor a lost project. Paying clients need a copy of their data that we hold ourselves, that we have restored at least once, and that nobody who gets into a CI runner can read.

## Decision

1. **A nightly dump, in GitHub Actions**, at 03:17 in Dhaka. `pg_dump --format=custom` with Postgres 18's client (the server's version), connecting straight to Neon as the migration role. That uses no Hyperdrive queries.
2. **Encrypted before it touches the disk.** The dump is piped into `age`, encrypted to the public key in the `BACKUP_AGE_RECIPIENT` variable. The runner never holds the private key, so a leaked runner or token can't read any backup.
3. **Kept in R2:** `backups/daily/<Dhaka date>.dump.age`, and on Sundays also `backups/weekly/`. The bucket's lifecycle rules delete daily copies after 8 days and weekly ones after 35. The run's summary records each copy's size and SHA-256.
4. **A monthly restore test**, on the first Sunday:
   - the newest daily copy is decrypted with the private key in the `BACKUP_AGE_KEY` secret;
   - it is restored into an empty database on a new Neon branch, `restore-test`;
   - checks: every production table is there, each table's rows are within a day's growth of production's (10%, or 100 rows), and the newest order is under 48 hours old when production has taken one in that time;
   - the branch is deleted whatever happens, and the result goes in the run's summary.
5. **The same checks in CI.** Every run dumps the test database, encrypts it to a fresh key, decrypts it, restores it into another database and runs the checks. CI uses the Postgres 18 tools from its service's image, since the runner's client is older.
6. **The keys are the owner's** (Q15). The owner makes the pair once with `age-keygen -o backup.key`, sets the public key (`age1…`) as the `BACKUP_AGE_RECIPIENT` repository variable and the whole key file as the `BACKUP_AGE_KEY` secret, and keeps a copy offline with the copy of `CREDENTIALS_KEY`. Until then both workflows skip with a warning.

## Consequences

- A lost Neon project or a mistake found days later can be restored from our own copy, with a week of daily and a month of weekly points.
- Each night costs about two Actions minutes, and the restore test about five a month.
- The dumps are a small part of R2's free 10 GB: production's database is about 100 MiB on all branches, and eleven compressed copies stay far below that.
- A lost private key makes every backup unreadable: it is kept offline as well as in the secret. Rotating it means a new pair; older backups stay readable only with the old key until they expire.
- A restore of the whole database is one runbook (`docs/runbooks/restore-backup.md`); one store's rows can be copied from a restored branch the same way.
