// The tenant-jobs workflow's loop (phase-5b-plan §3.9): claim a pending job
// (or one whose runner was lost), run it, and write its result, with the
// event that tells the Worker to email the owners. A failed run goes back to
// pending until its third attempt.
import {
  type BackfillProgress,
  backfillReports,
  type EventSink,
  EXPORT_DAYS,
  emit,
  exportExpiry,
  type JobKind,
  relayEvents,
  withTenant,
} from '@managemind/core';
import type pg from 'pg';
import { type ExportResult, exportStore, type ObjectStore } from './export';
import { dryRun, JobRefused, type KvStore, purgeStore } from './purge';
import { resetStore } from './reset';

/** A running job not touched for this long lost its runner and is claimed again. */
const STALE_MINUTES = 90;
const MAX_ATTEMPTS = 3;

/** The kinds this runner knows; others stay pending for the runner that does. */
export const RUNNABLE: readonly JobKind[] = ['export', 'purge', 'reset', 'reports_backfill'];

export interface ClaimedJob {
  id: string;
  tenantId: string;
  kind: JobKind;
  attempts: number;
  progress: unknown;
}

/**
 * Jobs that can run now: pending, or running with a lost runner. A purge
 * runs twice, for its dry run and once approved; in between it waits.
 */
export const RUNNABLE_NOW = `(status = 'pending'
    or (status = 'running' and updated_at < now() - interval '${STALE_MINUTES} minutes'))
  and (kind <> 'purge' or exists (select 1 from platform.tenant_purges p
        where p.job_id = tenant_jobs.id and (p.dry_run is null or p.approved_at is not null)))`;

export async function claimJob(
  client: pg.Client,
  kinds: readonly JobKind[] = RUNNABLE,
  jobId?: string,
): Promise<ClaimedJob | null> {
  const { rows } = await client.query<{
    id: string;
    tenant_id: string;
    kind: JobKind;
    attempts: number;
    progress: unknown;
  }>(
    `update platform.tenant_jobs j
        set status = 'running', started_at = coalesce(started_at, now()),
            attempts = attempts + 1, error = null
      where j.id = (
        select id from platform.tenant_jobs
         where kind = any($1::text[]) and ${RUNNABLE_NOW}
           and ($2::uuid is null or id = $2::uuid)
         order by created_at
         limit 1
         for update skip locked)
      returning j.id, j.tenant_id, j.kind, j.attempts, j.progress`,
    [kinds, jobId ?? null],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        tenantId: row.tenant_id,
        kind: row.kind,
        attempts: row.attempts,
        progress: row.progress,
      }
    : null;
}

async function saveProgress(client: pg.Client, id: string, progress: object): Promise<void> {
  await client.query('update platform.tenant_jobs set progress = $2 where id = $1', [id, progress]);
}

/** A finished export: the row, and `tenant.exported` for the owners' email, in one commit. */
async function finishExport(
  client: pg.Client,
  job: ClaimedJob,
  result: ExportResult,
  sink: EventSink | null,
): Promise<void> {
  await withTenant(
    client,
    job.tenantId,
    async (tx) => {
      const { rows } = await client.query<{ finished_at: Date }>(
        `update platform.tenant_jobs
            set status = 'succeeded', finished_at = now(), file_key = $2, result = $3,
                progress = '{"step":"done"}'
          where id = $1 returning finished_at`,
        [job.id, result.fileKey, result],
      );
      const finishedAt = rows[0]?.finished_at ?? new Date();
      await emit(tx, 'tenant.exported', {
        aggregateType: 'tenant_job',
        aggregateId: job.id,
        payload: { jobId: job.id, expiresAt: exportExpiry(finishedAt).toISOString() },
      });
    },
    // Straight to the outbox queue when we can; the Worker's daily sweep otherwise.
    sink ? { afterCommit: (events) => relayEvents(client, events, sink).then(() => {}) } : {},
  );
}

async function failJob(
  client: pg.Client,
  job: ClaimedJob,
  error: unknown,
): Promise<'retry' | 'failed'> {
  const detail = (error as { detail?: unknown } | null)?.detail;
  const base = error instanceof Error ? error.message : String(error);
  const message = (typeof detail === 'string' ? `${base}: ${detail}` : base).slice(0, 1000);
  const final = error instanceof JobRefused || job.attempts >= MAX_ATTEMPTS;
  await client.query(
    `update platform.tenant_jobs
        set status = $2, error = $3, finished_at = case when $2 = 'failed' then now() end
      where id = $1`,
    [job.id, final ? 'failed' : 'pending', message],
  );
  return final ? 'failed' : 'retry';
}

export interface RunDeps {
  client: pg.Client;
  files: ObjectStore;
  kv: KvStore;
  storeDomain: string;
  sink: EventSink | null;
  log?: (message: string) => void;
  /** Called after each saved purge step; tests stop a run here. */
  onStep?: (step: string) => Promise<void> | void;
}

export interface RunSummary {
  succeeded: string[];
  /** Purges whose dry run is done, waiting for approval. */
  waiting: string[];
  retried: string[];
  failed: string[];
}

/** Runs pending jobs until none is left, or until the time budget is spent. */
export async function runJobs(
  deps: RunDeps,
  options: { jobId?: string; budgetMs?: number } = {},
): Promise<RunSummary> {
  const log = deps.log ?? console.log;
  const summary: RunSummary = { succeeded: [], waiting: [], retried: [], failed: [] };
  const until = Date.now() + (options.budgetMs ?? 50 * 60_000);
  while (Date.now() < until) {
    const job = await claimJob(deps.client, RUNNABLE, options.jobId);
    if (!job) break;
    log(`${job.kind} ${job.id} (attempt ${job.attempts})`);
    try {
      if (job.kind === 'export') {
        const result = await exportStore(deps.client, deps.files, job.tenantId, job.id, (p) =>
          saveProgress(deps.client, job.id, p),
        );
        await finishExport(deps.client, job, result, deps.sink);
        log(`  ${result.bytes} bytes, ${result.files} files, link for ${EXPORT_DAYS} days`);
      }
      if (job.kind === 'reset') {
        const result = await resetStore(deps, job, (step) =>
          saveProgress(deps.client, job.id, { phase: 'reset', step }),
        );
        await finishReset(deps.client, job, result);
        log(
          `  ${result.deleted.rows} rows and ${result.deleted.files} files deleted, ${result.orders} sample orders`,
        );
      }
      if (job.kind === 'reports_backfill') {
        // Each chunk commits with its progress; a lost runner's retry carries on.
        // The core runs as app_rw, as in the API, so row-level security applies.
        await deps.client.query('grant app_rw to current_user with set true, inherit false');
        const result = await backfillReports(
          deps.client,
          job.tenantId,
          (job.progress ?? {}) as BackfillProgress,
          (p) => saveProgress(deps.client, job.id, p),
        );
        await deps.client.query(
          `update platform.tenant_jobs set status = 'succeeded', finished_at = now(), result = $2
            where id = $1`,
          [job.id, result],
        );
        log(
          `  ${result.days} days and ${result.months} month ends from ${result.from ?? 'nothing'}`,
        );
      }
      if (job.kind === 'purge' && (await runPurge(deps, job)) === 'waiting') {
        summary.waiting.push(job.id);
        log('  dry run saved; waiting for approval');
        if (options.jobId) break;
        continue;
      }
      summary.succeeded.push(job.id);
    } catch (e) {
      const outcome = await failJob(deps.client, job, e);
      log(
        `  ${outcome === 'failed' ? 'failed' : 'will retry'}: ${String(e)} ${(e as { detail?: string }).detail ?? ''}`,
      );
      (outcome === 'failed' ? summary.failed : summary.retried).push(job.id);
    }
    if (options.jobId) break;
  }
  return summary;
}

/** The dry run, or the approved purge and its record. */
async function runPurge(deps: RunDeps, job: ClaimedJob): Promise<'waiting' | 'purged'> {
  const { client } = deps;
  const { rows } = await client.query<{ id: string; dry_run: unknown; approved_at: Date | null }>(
    'select id, dry_run, approved_at from platform.tenant_purges where job_id = $1',
    [job.id],
  );
  const purge = rows[0];
  if (!purge) throw new JobRefused('the purge record is missing');
  if (!purge.dry_run) {
    const report = await dryRun(deps, job.tenantId);
    await client.query('begin');
    await client.query('update platform.tenant_purges set dry_run = $2 where id = $1', [
      purge.id,
      report,
    ]);
    // Back to pending: the claim skips it until a super admin approves.
    await client.query(
      `update platform.tenant_jobs
          set status = 'pending', attempts = 0, progress = '{"phase":"awaiting_approval"}'
        where id = $1`,
      [job.id],
    );
    await client.query('commit');
    return 'waiting';
  }
  if (!purge.approved_at) throw new JobRefused('the purge is not approved');
  // Checked again here, whatever the job row says: an approval from before
  // the store was last closed, or a grace period not over, purges nothing.
  const { rows: checks } = await client.query<{ since_close: boolean; due: boolean }>(
    `select t.closed_at is not null and p.approved_at >= t.closed_at as since_close,
            t.purge_after is null or t.purge_after <= now() as due
       from platform.tenants t join platform.tenant_purges p on p.tenant_id = t.id
      where p.id = $1`,
    [purge.id],
  );
  if (!checks[0]?.since_close) {
    throw new JobRefused('the purge was approved before the store was last closed');
  }
  if (!checks[0].due) throw new JobRefused("the store's grace period is not over");
  const { deleted, verification } = await purgeStore(deps, job);
  await client.query('begin');
  try {
    await client.query(
      `update platform.tenants set status = 'purged', purged_at = now()
        where id = $1 and status = 'closed'`,
      [job.tenantId],
    );
    await client.query(
      `update platform.tenant_purges set deleted = $2, verification = $3, finished_at = now()
        where id = $1`,
      [purge.id, deleted, verification],
    );
    await client.query(
      `update platform.tenant_jobs
          set status = 'succeeded', finished_at = now(), result = $2, progress = '{"phase":"done"}'
        where id = $1`,
      [job.id, verification],
    );
    await client.query(
      `insert into platform.audit_log (tenant_id, actor_type, action, entity_type, entity_id, after)
       values ($1, 'system', 'tenant.purged', 'tenant_purge', $2, $3)`,
      [job.tenantId, purge.id, { deleted, verification }],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
  return 'purged';
}

async function finishReset(client: pg.Client, job: ClaimedJob, result: object): Promise<void> {
  await client.query('begin');
  try {
    await client.query(
      `update platform.tenant_jobs
          set status = 'succeeded', finished_at = now(), result = $2, progress = '{"phase":"done"}'
        where id = $1`,
      [job.id, result],
    );
    await client.query(
      `insert into platform.audit_log (tenant_id, actor_type, action, entity_type, entity_id, after)
       values ($1, 'system', 'tenant.reset', 'tenant_job', $2, $3)`,
      [job.tenantId, job.id, result],
    );
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
}

/** The weekly reset of the demo stores (Friday mornings in Dhaka): their jobs, queued. */
export async function queueDemoResets(
  client: pg.Client,
  slugs: readonly string[],
): Promise<number> {
  const { rowCount } = await client.query(
    `insert into platform.tenant_jobs (tenant_id, kind)
     select id, 'reset' from platform.tenants
      where slug = any($1::text[]) and kind = 'demo' and status in ('active', 'suspended')
     on conflict do nothing`,
    [slugs],
  );
  return rowCount ?? 0;
}
