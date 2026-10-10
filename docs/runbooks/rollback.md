# Runbook: rolling back production

Use this when a deploy breaks production: the deploy's smoke test failed, or errors started after it.

## 1. Roll back the Workers (about 1 minute)

Workers keep their previous versions, so a rollback is instant and touches no data. Roll back the Worker that broke. If you aren't sure, roll back the storefront first, then the API.

**Dashboard:**
1. Go to Cloudflare → Workers & Pages → `managemind-api` (or `managemind-storefront`) → **Deployments**.
2. Pick the last good version and choose **Rollback**.

**Command line** (GitHub Actions, or a session with a Workers token):

```sh
pnpm --filter @managemind/api exec wrangler deployments list --name managemind-api
pnpm --filter @managemind/api exec wrangler rollback <version-id> --name managemind-api \
  --message "Roll back <commit>: <reason>"
# The same for the storefront, with --name managemind-storefront
```

Without a version ID, `wrangler rollback` goes back one version.

Then confirm that `https://managemind-api.<subdomain>.workers.dev/health` reports the old commit, and that `/health/deep` answers `ok`.

## 2. Stop the next deploy from bringing it back

`master` still contains the bad commit, so the next push deploys it again.

- Open a PR that reverts the commit, and merge it once CI passes. Its deploy replaces the rolled-back version with a fixed one.
- Do not re-run the failed Deploy workflow, because that would deploy the bad commit again.

## 3. The database

Migrations run before the Workers deploy and are **forward only**: there are no down migrations.

- **Rule for every migration:** the previous release must keep working against the new schema (expand, then contract). For example, add a column in one release, and drop the old one only in a later release once nothing reads it. Under this rule, rolling back the Workers never needs a schema rollback.
- **A broken migration** is fixed with a new migration (fix forward), never by editing an applied one.
- **Lost or damaged data:**
  1. In the Neon console, restore the `production` branch to a point in time before the deploy. Check the console for the current restore window.
  2. Re-run **Provision** (`provision.yml`) afterwards, so that the `mm_app` role and the Hyperdrive config match the restored branch.

## 4. Credentials

- **Rotate the `mm_app` password:** run **Actions → Provision → Run workflow** with *rotate* checked. It sets a new password and updates the Hyperdrive config to match. Expect a few seconds of failed database requests between those two steps.
- **The migration role (`neondb_owner`):** reset its password in the Neon console, then update the `DATABASE_URL_MIGRATIONS` secret in GitHub. Deploys fail at "Provision and migrate" until the secret matches.
