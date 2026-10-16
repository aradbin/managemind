// Writes the production wrangler configs.
//
//   tsx production/workers.ts --hyperdrive <id> --kv <id> --commit <sha>
//
// With PLATFORM_DOMAIN and STORE_DOMAIN set (deploy.yml passes them), the
// Workers serve admin.<platform>, api.<platform> and *.<store>; without
// them (a fork, a fresh account) they stay on workers.dev. workers.dev stays
// on as well until the uptime monitor has moved (phase-1-plan §10).
import { parseArgs, requireEnv, setOutput } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { writeWorkerConfigs } from '../lib/workers';

const args = parseArgs(process.argv.slice(2));
const hyperdrive = args.get('hyperdrive');
if (!hyperdrive || !/^[0-9a-f]{32}$/.test(hyperdrive)) {
  throw new Error('--hyperdrive <id> is required');
}
const kv = args.get('kv');
if (!kv || !/^[0-9a-f]{32}$/.test(kv)) throw new Error('--kv <namespace id> is required');
const commit = args.get('commit');
if (!commit) throw new Error('--commit <sha> is required');

const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));
const workersDev = `${await cf.workersSubdomain()}.workers.dev`;

const api = 'managemind-api';
const storefront = 'managemind-storefront';
const platformDomain = process.env.PLATFORM_DOMAIN;
const storeDomain = process.env.STORE_DOMAIN;
const routes = Boolean(platformDomain && storeDomain);
// Purges and custom hostnames work on the store zone (ADR 0018, 0019).
const storeZoneId = routes ? await cf.zoneId(storeDomain as string) : undefined;
writeWorkerConfigs({
  environment: 'production',
  api,
  storefront,
  hyperdriveId: hyperdrive,
  kvNamespaceId: kv,
  platformDomain: platformDomain || workersDev,
  storeDomain: storeDomain || workersDev,
  adminHost: routes ? `admin.${platformDomain}` : `${api}.${workersDev}`,
  ...(storeZoneId ? { storeZoneId } : {}),
  emailProvider: 'resend',
  commit,
  routes,
});

// The smoke test's targets. A random store subdomain must answer the
// storefront's own "store not found" page.
const probe = `smoke-${commit.slice(0, 7)}`;
setOutput('api_url', routes ? `https://api.${platformDomain}` : `https://${api}.${workersDev}`);
setOutput('admin_url', routes ? `https://admin.${platformDomain}` : `https://${api}.${workersDev}`);
setOutput(
  'storefront_url',
  routes ? `https://${probe}.${storeDomain}` : `https://${storefront}.${workersDev}`,
);
