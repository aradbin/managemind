# Runbook: rotating a secret

Rotate a secret when it may have leaked (a laptop lost, a token pasted somewhere), when someone with access leaves, or once a year. Repository secrets and variables are in **GitHub → Settings → Secrets and variables → Actions**; a change reaches the Workers at the next deploy (re-run the last **Deploy**, or push).

| Secret | Protects | To rotate | Meanwhile |
| --- | --- | --- | --- |
| `AUTH_SECRET` | Staff and shopper sessions, two-factor secrets' encryption, export links | 32 random bytes in base64 (`openssl rand -base64 32`), then deploy | **Everyone is signed out**, two-factor must be set up again, and export links stop working. Rotate only when it leaked |
| `CREDENTIALS_KEY` | Stores' SSLCommerz, SMS and email credentials | `pnpm --filter @managemind/scripts keys`; keep a copy offline | **Every saved credential becomes unreadable**: each store saves its credentials again. The vault records a key version, but reading old versions is not built yet. Rotate only when it leaked |
| `RESEND_API_KEY`, `BREVO_API_KEY` | Sending email as us | Create a new key with sending access only, update, deploy, delete the old key | Email fails between deleting the old key and the deploy: deploy first |
| `CF_STORE_TOKEN` | Cache purges, custom hostnames, the Turnstile list | New token with the same permissions (README), update, deploy, revoke the old one | Purges fail until the deploy |
| `CLOUDFLARE_API_TOKEN` | Every deploy and workflow | New token with the same permissions, update, revoke the old one | Workflows fail until updated |
| `DATABASE_URL_MIGRATIONS` | The migration role (`neondb_owner`) | Reset the role's password in the Neon console, update the secret | Deploys, the Platform CLI, jobs and backups fail until updated |
| `mm_app` password | The Workers' database role | **Actions → Provision** with *rotate* checked | A few seconds of failed requests |
| `TURNSTILE_SECRET_KEY` | Turnstile checks | Rotate the widget's secret in the Cloudflare dashboard, update, deploy | Checks fail until the deploy: do it when stores are quiet |
| `VAPID_PRIVATE_KEY` | Web push | A new pair from the keys command; update both | Staff must turn push on again |
| `PLATFORM_SSLCOMMERZ_PASSWORD` | Our merchant account | From the SSLCommerz merchant panel | The pay-online button fails until the deploy |
| `GITHUB_DISPATCH_TOKEN` | Starting the Store jobs workflow | A new fine-grained token (Actions read and write, this repository only), update, deploy, delete the old one | Jobs start at the daily run instead |
| `BACKUP_AGE_KEY` (and `BACKUP_AGE_RECIPIENT`) | Reading backups | `age-keygen -o backup.key`; set both; keep the key offline. **Keep the old key** until its last backup expires (35 days) | Old backups need the old key |
| `NEON_API_KEY`, `SENTRY_AUTH_TOKEN` | Previews, the alarm and the monthly restore test; source maps | New key, update, revoke the old one | Those workflows fail until updated |
| `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`, `PATHAO_USERNAME`, `PATHAO_PASSWORD`, `REDX_TOKEN` | The platform's own courier accounts, used only by the weekly **Courier areas** workflow | New credentials in the courier's merchant panel, update, revoke the old ones | That courier's area list isn't refreshed; nothing else depends on them |
| `AUTH_SECRET_PREVIEW`, `CREDENTIALS_KEY_PREVIEW` | Previews only: their sessions, two-factor setups and saved test credentials | `openssl rand -base64 32` and the keys command; update, then push to an open PR | Preview sign-ins and saved test credentials stop working. Without these secrets each preview deploy makes fresh keys |

After any rotation: check the next deploy's warnings (`deploy.md`) and `/health/deep`.
