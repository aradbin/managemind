// Writes the wrangler configs for a PR's preview Workers and prints their URLs.
//
//   tsx preview/workers.ts --pr 12 --hyperdrive <id> --commit <sha>
//
// The API's main config has no Hyperdrive binding: it connects to the Neon
// branch directly (its DATABASE_URL secret). wrangler.preview-hyperdrive.json
// is the same Worker bound to the PR's Hyperdrive config, deployed for a
// full run's E2E flows, Lighthouse and CPU step, then replaced by the direct
// one again (ADR 0011, amended Oct 23 and Oct 25).
//
// Each PR gets its own pair of Workers (ADR 0011): the storefront's service
// binding points at its own PR's API, which a version preview alias cannot do.
import { parseArgs, prNumber, requireEnv, setOutput } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { writeWorkerConfigs } from '../lib/workers';
import { apiWorker, importDeadLetters, importQueue, outboxQueue, storefrontWorker } from './names';

const args = parseArgs(process.argv.slice(2));
const pr = prNumber(args);
const hyperdrive = args.get('hyperdrive');
if (!hyperdrive || !/^[0-9a-f]{32}$/.test(hyperdrive)) {
  throw new Error('--hyperdrive <id> is required');
}

const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));
const domain = `${await cf.workersSubdomain()}.workers.dev`;
await cf.ensureQueue(outboxQueue(pr));
await cf.ensureQueue(importQueue(pr));
await cf.ensureQueue(importDeadLetters(pr));

writeWorkerConfigs({
  environment: 'preview',
  api: apiWorker(pr),
  storefront: storefrontWorker(pr),
  cpuHyperdriveId: hyperdrive,
  platformDomain: domain,
  storeDomain: domain,
  adminHost: `${apiWorker(pr)}.${domain}`,
  storefrontOrigin: `https://${storefrontWorker(pr)}.${domain}`,
  emailProvider: 'capture',
  commit: args.get('commit') ?? 'preview',
  previewQueue: outboxQueue(pr),
  previewImportQueue: importQueue(pr),
});

setOutput('api_url', `https://${apiWorker(pr)}.${domain}`);
setOutput('storefront_url', `https://${storefrontWorker(pr)}.${domain}`);
