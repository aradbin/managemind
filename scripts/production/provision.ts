// Creates or updates everything production needs. Idempotent: deploy.yml runs
// it before every deploy, and provision.yml runs it by hand (with --rotate to
// give mm_app a new password).
//
//   tsx production/provision.ts [--rotate]
//
// - Queues: the outbox (ADR 0010), import chunks (phase-2-plan §3.7) and
//   cache purges (ADR 0018), each with its dead-letter queue.
// - KV: the edge namespace for the domain-to-store map and cache versions
//   (ADR 0006; bound to Workers from Phase 1).
// - R2: the files buckets, with lifecycle rules (phase-0-plan §8).
// - Database, as the migration role from DATABASE_URL_MIGRATIONS: the
//   migrations, then the mm_app login role and its Hyperdrive config. The
//   password is generated here and stored only in the role and the config.
import { runMigrations } from '@managemind/db/migrate';
import pg from 'pg';
import { mask, notice, parseArgs, requireEnv, setOutput } from '../lib/actions';
import { APP_ROLE, newPassword, setAppRole } from '../lib/app-role';
import { Cloudflare, type LifecycleRule } from '../lib/cloudflare';

const HYPERDRIVE = 'managemind-production';
const QUEUES = [
  'managemind-outbox',
  'managemind-outbox-dlq',
  'managemind-imports',
  'managemind-imports-dlq',
  'managemind-purge',
  'managemind-purge-dlq',
];
const KV_NAMESPACE = 'managemind-edge';
const BUCKETS = ['managemind-files', 'managemind-files-preview'];
const LIFECYCLE: LifecycleRule[] = [
  { id: 'exports-7d', prefix: 'exports/', deleteAfterDays: 7 },
  { id: 'tmp-uploads-1d', prefix: 'tmp-uploads/', deleteAfterDays: 1 },
  { id: 'backups-daily-8d', prefix: 'backups/daily/', deleteAfterDays: 8 },
  { id: 'backups-weekly-35d', prefix: 'backups/weekly/', deleteAfterDays: 35 },
  { id: 'abort-incomplete-uploads-1d', prefix: '', abortUploadsAfterDays: 1 },
];
/** Serializes provisioning runs (a manual run during a deploy). */
const PROVISION_LOCK = 72_616_003;

const args = parseArgs(process.argv.slice(2));
const cf = new Cloudflare(requireEnv('CLOUDFLARE_API_TOKEN'), requireEnv('CLOUDFLARE_ACCOUNT_ID'));
const ownerUrl = requireEnv('DATABASE_URL_MIGRATIONS');
mask(ownerUrl);
const origin = new URL(ownerUrl);
if (origin.password) mask(decodeURIComponent(origin.password));
if (origin.hostname.includes('-pooler')) {
  throw new Error('DATABASE_URL_MIGRATIONS must be the direct (unpooled) connection string');
}

for (const queue of QUEUES) await cf.ensureQueue(queue);
const kv = await cf.ensureKvNamespace(KV_NAMESPACE);
for (const bucket of BUCKETS) await cf.ensureBucket(bucket, LIFECYCLE);
notice(`Queues, KV namespace ${KV_NAMESPACE} (${kv}) and R2 buckets are in place`);

const owner = new pg.Client({ connectionString: ownerUrl });
await owner.connect();
try {
  await owner.query('select pg_advisory_lock($1)', [PROVISION_LOCK]);
  await runMigrations(ownerUrl);
  notice('Migrations applied');

  const existing = await cf.findHyperdrive(HYPERDRIVE);
  let id = existing?.id;
  if (!existing || args.has('rotate')) {
    const password = newPassword();
    await setAppRole(owner, password);
    const target = {
      host: origin.hostname,
      database: decodeURIComponent(origin.pathname.slice(1)),
      user: APP_ROLE,
      password,
    };
    if (existing) await cf.updateHyperdrive(existing.id, target);
    else id = (await cf.createHyperdrive(HYPERDRIVE, target)).id;
    notice(
      existing ? `Rotated the ${APP_ROLE} password` : `Created Hyperdrive config ${HYPERDRIVE}`,
    );
  }
  setOutput('hyperdrive_id', id as string);
  setOutput('kv_id', kv);
} finally {
  await owner.end();
}
