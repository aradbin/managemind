# Runbook: restoring from a backup

Two kinds of restore exist:

- **Neon's own history** (minutes or hours back): restore the `production` branch to a point in time in the Neon console. Use this first when the mistake is recent. See `rollback.md` §3.
- **Our nightly backup** (days back, or a lost project): this page. Backups are `backups/daily/<date>.dump.age` (a week of them) and `backups/weekly/<date>.dump.age` (a month) in the `managemind-files` R2 bucket, encrypted with age (ADR 0028).

You need the age private key: the `BACKUP_AGE_KEY` secret's value, or the owner's offline copy.

## 1. Restore into a new branch, never over production

```sh
# Postgres 18's client and age
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-client-18 age

# The copy to restore (or download it from the R2 dashboard)
pnpm --filter @managemind/scripts exec tsx backup/cli.ts latest --out db.dump.age
age --decrypt --identity backup.key --output db.dump db.dump.age
```

In the Neon console, create a branch from `production` (for example `restore-2026-11-02`), and on it an empty database:

```sh
psql "<the branch's owner URL>" -c 'create database restored'
pg_restore --no-owner --exit-on-error --dbname="<the branch URL, database restored>" db.dump
```

## 2. Check it

```sh
DATABASE_URL_MIGRATIONS="<production URL>" \
  pnpm --filter @managemind/scripts exec tsx backup/cli.ts check --restored "<restored URL>"
```

It compares every table's rows with production's and reports the newest order. Look at the store you care about, too.

## 3a. The whole database is lost or wrong

1. Make the restored database the one production uses. In the Neon console, the simplest way is to restore the `production` branch from the new branch, then check `/health/deep`.
2. Re-run **Actions → Provision**, so the `mm_app` role and Hyperdrive match.
3. Orders placed between the backup and now are not in it. List them from the old branch (if it still exists) before you switch, and re-enter them by hand.

## 3b. One store's rows are wrong

Copy that store's rows from the restored database, table by table in the order in `packages/db/src/registry.ts` (`STORE_TABLES`, reversed), each `where tenant_id = '<store id>'`, after deleting its current rows in `STORE_TABLES` order. Do it in one transaction as the migration role, and test it on another branch first.

## 4. Clean up

Delete the branch and the plain `db.dump` file. The dump holds every store's shoppers' data.
