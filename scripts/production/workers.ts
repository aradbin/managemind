// Writes the production wrangler configs.
//
//   tsx production/workers.ts --hyperdrive <id> --commit <sha>
//
// Domains come from the PLATFORM_DOMAIN and STORE_DOMAIN repository
// variables; until those are set, both Workers stay on workers.dev.
import { parseArgs, requireEnv, setOutput } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { writeWorkerConfigs } from '../lib/workers';

const args = parseArgs(process.argv.slice(2));
const hyperdrive = args.get('hyperdrive');
if (!hyperdrive || !/^[0-9a-f]{32}$/.test(hyperdrive)) {
  throw new Error('--hyperdrive <id> is required');
}
const commit = args.get('commit');
if (!commit) throw new Error('--commit <sha> is required');

const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));
const workersDev = `${await cf.workersSubdomain()}.workers.dev`;

const api = 'managemind-api';
const storefront = 'managemind-storefront';
writeWorkerConfigs({
  environment: 'production',
  api,
  storefront,
  hyperdriveId: hyperdrive,
  platformDomain: process.env.PLATFORM_DOMAIN || workersDev,
  storeDomain: process.env.STORE_DOMAIN || workersDev,
  // The admin is served by the API Worker until it moves to admin.<domain> (PR 17).
  adminHost: `${api}.${workersDev}`,
  emailProvider: 'resend',
  commit,
});

setOutput('api_url', `https://${api}.${workersDev}`);
setOutput('storefront_url', `https://${storefront}.${workersDev}`);
