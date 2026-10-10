// Writes the wrangler configs for a PR's preview Workers and prints their URLs.
//
//   tsx preview/workers.ts --pr 12 --hyperdrive <id> --commit <sha>
//
// Run after the apps are built. Each PR gets its own pair of Workers
// (ADR 0011): the storefront's service binding points at its own PR's API,
// which a version preview alias cannot do. Preview Workers have no cron and
// no queue consumer; outbox events go to a queue nothing consumes.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseArgs, prNumber, requireEnv, setOutput } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import { apiWorker, PREVIEW_QUEUE, storefrontWorker } from './names';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const args = parseArgs(process.argv.slice(2));
const pr = prNumber(args);
const hyperdrive = args.get('hyperdrive');
if (!hyperdrive || !/^[0-9a-f]{32}$/.test(hyperdrive))
  throw new Error('--hyperdrive <id> is required');
const commit = args.get('commit') ?? 'preview';

const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));
const domain = `${await cf.workersSubdomain()}.workers.dev`;
await cf.ensureQueue(PREVIEW_QUEUE);

type Config = Record<string, unknown> & { vars?: Record<string, string> };
const preview = (vars: Record<string, string> | undefined) => ({
  ...vars,
  ENVIRONMENT: 'preview',
  STORE_DOMAIN: domain,
});

// The API: from its wrangler.jsonc, written next to it so relative paths hold.
const apiDir = join(root, 'apps/api');
const api = readJsonc(join(apiDir, 'wrangler.jsonc'));
api.name = apiWorker(pr);
api.workers_dev = true;
api.preview_urls = false;
api.hyperdrive = [{ binding: 'HYPERDRIVE', id: hyperdrive }];
api.queues = { producers: [{ binding: 'OUTBOX', queue: PREVIEW_QUEUE }] };
api.triggers = { crons: [] };
api.vars = { ...preview(api.vars), PLATFORM_DOMAIN: domain, COMMIT_SHA: commit };
writeFileSync(join(apiDir, 'wrangler.preview.json'), `${JSON.stringify(api, null, 2)}\n`);

// The storefront: the Astro adapter's generated config, edited in place
// (wrangler deploy in apps/storefront follows its redirect to this file).
const storefrontConfig = join(root, 'apps/storefront/dist/server/wrangler.json');
const storefront = JSON.parse(readFileSync(storefrontConfig, 'utf8')) as Config;
storefront.name = storefrontWorker(pr);
storefront.workers_dev = true;
storefront.preview_urls = false;
storefront.services = [{ binding: 'API', service: apiWorker(pr) }];
storefront.vars = preview(storefront.vars);
writeFileSync(storefrontConfig, `${JSON.stringify(storefront, null, 2)}\n`);

setOutput('api_url', `https://${apiWorker(pr)}.${domain}`);
setOutput('storefront_url', `https://${storefrontWorker(pr)}.${domain}`);

function readJsonc(path: string): Config {
  const { config, error } = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (error || !config) throw new Error(`cannot parse ${path}`);
  return config as Config;
}
