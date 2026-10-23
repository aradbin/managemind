// The tenant-jobs workflow's entry point (phase-5b-plan §3.9):
//   pnpm --filter @managemind/scripts jobs [--job <id>]
// Connects to Neon directly with the migration role, as the Platform
// workflow does; files go through Cloudflare's R2 API; the owners' email
// event goes straight to the outbox queue.
import type { OutboxEvent } from '@managemind/core';
import pg from 'pg';
import { notice, parseArgs, requireEnv, warning } from '../lib/actions';
import { Cloudflare } from '../lib/cloudflare';
import type { ObjectStore } from './export';
import { runJobs } from './runner';

const args = parseArgs(process.argv.slice(2));
const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));
const bucket = process.env.R2_BUCKET || 'managemind-files';
const files: ObjectStore = {
  list: (prefix) => cf.r2List(bucket, prefix),
  get: (key) => cf.r2Get(bucket, key),
  put: (key, body, type) => cf.r2Put(bucket, key, body, type),
  delete: (keys) => cf.r2Delete(bucket, keys),
};
const kvNamespace = await cf.kvNamespaceId(process.env.KV_NAMESPACE || 'managemind-edge');
const kv = {
  list: (prefix: string) => cf.kvList(kvNamespace, prefix),
  delete: (keys: readonly string[]) => cf.kvDeleteMany(kvNamespace, keys),
};
const queue = process.env.OUTBOX_QUEUE || 'managemind-outbox';
const queueId = await cf.queueId(queue).catch((e: unknown) => {
  warning(
    `outbox queue ${queue} not reachable (${String(e)}): the Worker's daily sweep sends the emails`,
  );
  return null;
});

const client = new pg.Client({ connectionString: requireEnv('DATABASE_URL_MIGRATIONS') });
await client.connect();
try {
  const summary = await runJobs(
    {
      client,
      files,
      kv,
      storeDomain: process.env.STORE_DOMAIN || 'managemind.store',
      sink: queueId
        ? { send: (events: readonly OutboxEvent[]) => cf.sendToQueue(queueId, events) }
        : null,
    },
    args.get('job') ? { jobId: args.get('job') as string } : {},
  );
  notice(
    `jobs: ${summary.succeeded.length} done, ${summary.waiting.length} waiting for approval, ${summary.retried.length} to retry, ${summary.failed.length} failed`,
  );
  if (summary.failed.length) process.exitCode = 1;
} finally {
  await client.end();
}
