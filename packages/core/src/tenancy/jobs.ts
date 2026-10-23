// A store's long jobs (phase-5b-plan §3.9): export, purge and reset run in
// GitHub Actions, not in the Worker. Asking for one writes a pending row;
// the tenant-jobs workflow claims it (scripts/jobs), writes its progress
// and its result. One open job of each kind per store (a unique index).
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { type Actor, requirePlatformRole } from '../access';
import type { TenantTx } from '../tenant';

const j = schema.tenantJobs;

export type JobKind = (typeof schema.JOB_KINDS)[number];
export type JobStatus = (typeof schema.JOB_STATUSES)[number];

export interface TenantJob {
  id: string;
  tenantId: string;
  kind: JobKind;
  status: JobStatus;
  requestedBy: string | null;
  progress: unknown;
  result: unknown;
  fileKey: string | null;
  error: string | null;
  attempts: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

const columns = {
  id: j.id,
  tenantId: j.tenantId,
  kind: j.kind,
  status: j.status,
  requestedBy: j.requestedBy,
  progress: j.progress,
  result: j.result,
  fileKey: j.fileKey,
  error: j.error,
  attempts: j.attempts,
  startedAt: j.startedAt,
  finishedAt: j.finishedAt,
  createdAt: j.createdAt,
};

/** How long an export's link and file last (the R2 rule deletes exports/ after 7 days). */
export const EXPORT_DAYS = 7;
/** An owner asks for an export at most once a day (Q13). */
const OWNER_EXPORT_HOURS = 24;

/**
 * Writes a pending job, or returns the store's open one of that kind.
 * Inside the caller's transaction, so closing a store and its export
 * commit together.
 */
export async function queueJob(
  tx: { db: TenantTx['db'] },
  tenantId: string,
  kind: JobKind,
  requestedBy: string | null,
): Promise<{ job: TenantJob; created: boolean }> {
  const [row] = await tx.db
    .insert(j)
    .values({ tenantId, kind, requestedBy })
    .onConflictDoNothing()
    .returning(columns);
  if (row) return { job: row as TenantJob, created: true };
  const [open] = await tx.db
    .select(columns)
    .from(j)
    .where(
      and(eq(j.tenantId, tenantId), eq(j.kind, kind), inArray(j.status, ['pending', 'running'])),
    );
  if (!open) throw new AppError('conflict', { detail: 'the job could not be queued' });
  return { job: open as TenantJob, created: false };
}

/**
 * An export, asked for by a super admin (any time) or the store's owner (at
 * most once a day, Q13). A closed store's export is queued by closing it.
 */
export async function requestExport(
  tx: TenantTx,
  actor: Actor,
): Promise<{ job: TenantJob; created: boolean }> {
  if (actor.platformRole) requirePlatformRole(actor, 'super_admin');
  else {
    if (actor.storeRole !== 'owner' || actor.tenantId !== tx.tenantId) {
      throw new AppError('forbidden', { detail: 'only an owner can export the store' });
    }
    const [recent] = await tx.db
      .select({ id: j.id })
      .from(j)
      .where(
        and(
          eq(j.tenantId, tx.tenantId),
          eq(j.kind, 'export'),
          sql`${j.status} <> 'failed'`,
          gt(j.createdAt, sql`now() - make_interval(hours => ${OWNER_EXPORT_HOURS})`),
        ),
      )
      .limit(1);
    if (recent) {
      const open = await listJobs(tx, tx.tenantId, { kind: 'export', limit: 1 });
      const job = open[0];
      if (job && (job.status === 'pending' || job.status === 'running')) {
        return { job, created: false };
      }
      throw new AppError('rate_limited', { detail: 'one export a day' });
    }
  }
  return queueJob(tx, tx.tenantId, 'export', actor.userId);
}

export async function listJobs(
  tx: { db: TenantTx['db'] },
  tenantId: string,
  filter: { kind?: JobKind; limit?: number } = {},
): Promise<TenantJob[]> {
  const rows = await tx.db
    .select(columns)
    .from(j)
    .where(and(eq(j.tenantId, tenantId), filter.kind ? eq(j.kind, filter.kind) : undefined))
    .orderBy(desc(j.createdAt))
    .limit(Math.min(Math.max(filter.limit ?? 20, 1), 100));
  return rows as TenantJob[];
}

export async function getJob(tx: { db: TenantTx['db'] }, id: string): Promise<TenantJob | null> {
  const [row] = await tx.db.select(columns).from(j).where(eq(j.id, id));
  return (row as TenantJob | undefined) ?? null;
}

/** When a finished export's link and file expire. */
export const exportExpiry = (finishedAt: Date) =>
  new Date(finishedAt.getTime() + EXPORT_DAYS * 86_400_000);
