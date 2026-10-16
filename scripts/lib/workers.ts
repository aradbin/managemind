// Wrangler configs for deployed Workers, generated from the checked-in ones so
// that no environment's IDs or domains live in the repository. Run after the
// apps are built: the storefront's config is the Astro adapter's output.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { sentry } from './sentry';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

export interface WorkerTarget {
  environment: 'preview' | 'production';
  api: string;
  storefront: string;
  hyperdriveId: string;
  /** The managemind-edge KV namespace; previews have none (no consumer writes it). */
  kvNamespaceId?: string;
  platformDomain: string;
  storeDomain: string;
  /** The admin's host: sign-in cookies and CSRF checks are bound to it. */
  adminHost: string;
  /** `resend` in production; previews capture emails for the dev mailbox. */
  emailProvider: 'resend' | 'capture';
  commit: string;
  /** Previews: no Cron Trigger, and outbox events go to this queue, which nothing consumes. */
  previewQueue?: string;
  /** Previews: the PR's own import queue (its dead-letter queue is this name + `-dlq`). */
  previewImportQueue?: string;
  /**
   * Production on its own domains (phase-1-plan §10): admin.<platform> as the
   * API Worker's custom domain, api.<platform> routes for health checks and
   * webhooks only, and every <slug>.<store> to the storefront.
   */
  routes?: boolean;
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
  // Production's files bucket, or the shared preview bucket (phase-0-plan §8).
  api.r2_buckets = [
    {
      binding: 'FILES',
      bucket_name: t.environment === 'production' ? 'managemind-files' : 'managemind-files-preview',
    },
  ];
  if (t.kvNamespaceId) api.kv_namespaces = [{ binding: 'EDGE', id: t.kvNamespaceId }];
  else delete api.kv_namespaces;
  api.vars = {
    ...vars(api.vars),
    PLATFORM_DOMAIN: t.platformDomain,
    ADMIN_HOST: t.adminHost,
    EMAIL_PROVIDER: t.emailProvider,
    COMMIT_SHA: t.commit,
    SENTRY_DSN: sentry.projects.api.dsn,
  };
  if (t.routes) {
    api.routes = [
      { pattern: t.adminHost, custom_domain: true },
      { pattern: `api.${t.platformDomain}/health*`, zone_name: t.platformDomain },
      { pattern: `api.${t.platformDomain}/v1/webhooks/*`, zone_name: t.platformDomain },
    ];
  }
  if (t.previewQueue) {
    const imports = t.previewImportQueue ?? 'managemind-imports-preview';
    api.queues = {
      producers: [
        { binding: 'OUTBOX', queue: t.previewQueue },
        { binding: 'IMPORTS', queue: imports },
      ],
      // Imports run on previews too, so the E2E flow can import a file.
      consumers: [
        {
          queue: imports,
          max_batch_size: 1,
          max_batch_timeout: 1,
          max_retries: 3,
          dead_letter_queue: `${imports}-dlq`,
        },
        { queue: `${imports}-dlq`, max_batch_size: 10, max_batch_timeout: 5 },
      ],
    };
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
  if (t.routes) storefront.routes = [{ pattern: `*.${t.storeDomain}/*`, zone_name: t.storeDomain }];
  if (t.kvNamespaceId) storefront.kv_namespaces = [{ binding: 'EDGE', id: t.kvNamespaceId }];
  storefront.vars = {
    ...vars(storefront.vars),
    COMMIT_SHA: t.commit,
    SENTRY_DSN: sentry.projects.storefront.dsn,
  };
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
