// Wrangler configs for deployed Workers, generated from the checked-in ones so
// that no environment's IDs or domains live in the repository. Run after the
// apps are built: the storefront's config is the Astro adapter's output.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export interface WorkerTarget {
  environment: 'preview' | 'production';
  api: string;
  storefront: string;
  hyperdriveId: string;
  platformDomain: string;
  storeDomain: string;
  commit: string;
  /** Previews: no Cron Trigger, and outbox events go to this queue, which nothing consumes. */
  previewQueue?: string;
}

type Config = Record<string, unknown> & { vars?: Record<string, string> };

/** Writes apps/api/wrangler.<environment>.json and rewrites the storefront's generated config. */
export function writeWorkerConfigs(t: WorkerTarget): void {
  const vars = (base: Record<string, string> | undefined) => ({
    ...base,
    ENVIRONMENT: t.environment,
    STORE_DOMAIN: t.storeDomain,
  });

  // Written next to the checked-in config so its relative paths still hold.
  const apiDir = join(root, 'apps/api');
  const api = readJsonc(join(apiDir, 'wrangler.jsonc'));
  api.name = t.api;
  api.workers_dev = true;
  api.preview_urls = false;
  api.hyperdrive = [{ binding: 'HYPERDRIVE', id: t.hyperdriveId }];
  api.vars = { ...vars(api.vars), PLATFORM_DOMAIN: t.platformDomain, COMMIT_SHA: t.commit };
  if (t.previewQueue) {
    api.queues = { producers: [{ binding: 'OUTBOX', queue: t.previewQueue }] };
    api.triggers = { crons: [] };
  }
  writeJson(join(apiDir, `wrangler.${t.environment}.json`), api);

  // `wrangler deploy` in apps/storefront follows the adapter's redirect to this file.
  const storefrontConfig = join(root, 'apps/storefront/dist/server/wrangler.json');
  const storefront = JSON.parse(readFileSync(storefrontConfig, 'utf8')) as Config;
  storefront.name = t.storefront;
  storefront.workers_dev = true;
  storefront.preview_urls = false;
  storefront.services = [{ binding: 'API', service: t.api }];
  storefront.vars = vars(storefront.vars);
  writeJson(storefrontConfig, storefront);
}

function readJsonc(path: string): Config {
  const { config, error } = ts.parseConfigFileTextToJson(path, readFileSync(path, 'utf8'));
  if (error || !config) throw new Error(`cannot parse ${path}`);
  return config as Config;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
