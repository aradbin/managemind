// The tenant-jobs workflow's loop (phase-5b-plan §3.9): claim a pending job
// (or one whose runner was lost), run it, and write its result, with the
// event that tells the Worker to email the owners. A failed run goes back to
// pending until its third attempt.
import {
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

/** A running job not touched for this long lost its runner and is claimed again. */
const STALE_MINUTES = 90;
const MAX_ATTEMPTS = 3;

/** The kinds this runner knows; others stay pending for the runner that does. */
export const RUNNABLE: readonly JobKind[] = ['export'];

export interface ClaimedJob {
  id: string;
  tenantId: string;
  kind: JobKind;
  attempts: number;
}

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
  }>(
    `update platform.tenant_jobs j
        set status = 'running', started_at = coalesce(started_at, now()),
            attempts = attempts + 1, error = null
      where j.id = (
        select id from platform.tenant_jobs
         where kind = any($1::text[])
           and (status = 'pending'
                or (status = 'running' and updated_at < now() - make_interval(mins => $3)))
           and ($2::uuid is null or id = $2::uuid)
         order by created_at
         limit 1
         for update skip locked)
      returning j.id, j.tenant_id, j.kind, j.attempts`,
    [kinds, jobId ?? null, STALE_MINUTES],
  );
  const row = rows[0];
  return row
    ? { id: row.id, tenantId: row.tenant_id, kind: row.kind, attempts: row.attempts }
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
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  const final = job.attempts >= MAX_ATTEMPTS;
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
  sink: EventSink | null;
  log?: (message: string) => void;
}

export interface RunSummary {
  succeeded: string[];
  retried: string[];
  failed: string[];
}

/** Runs pending jobs until none is left, or until the time budget is spent. */
export async function runJobs(
  deps: RunDeps,
  options: { jobId?: string; budgetMs?: number } = {},
): Promise<RunSummary> {
  const log = deps.log ?? console.log;
  const summary: RunSummary = { succeeded: [], retried: [], failed: [] };
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
      summary.succeeded.push(job.id);
    } catch (e) {
      const outcome = await failJob(deps.client, job, e);
      log(`  ${outcome === 'failed' ? 'failed' : 'will retry'}: ${String(e)}`);
      (outcome === 'failed' ? summary.failed : summary.retried).push(job.id);
    }
    if (options.jobId) break;
  }
  return summary;
}
