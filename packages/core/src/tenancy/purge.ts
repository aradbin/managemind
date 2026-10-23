// A closed store's purge (phase-5b-plan §3.11). A super admin asks for it
// once the grace period is over; the tenant-jobs workflow counts what would
// go (the dry run) and waits; the super admin reads the report, types the
// store's slug and confirms with a fresh two-factor code (the API checks
// that); then the workflow deletes, verifies and marks the store purged.
// The purge record stays with the tenant record.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import { type Actor, auditActor, requirePlatformRole } from '../access';
import { type PlatformTx, recordPlatformAudit } from '../platform';
import { getJob, queueJob, type TenantJob } from './jobs';

const p = schema.tenantPurges;

export interface PurgeRecord {
  id: string;
  tenantId: string;
  jobId: string;
  dryRun: unknown;
  approvedBy: string | null;
  approvedAt: Date | null;
  deleted: unknown;
  verification: unknown;
  finishedAt: Date | null;
  createdAt: Date;
}

const columns = {
  id: p.id,
  tenantId: p.tenantId,
  jobId: p.jobId,
  dryRun: p.dryRun,
  approvedBy: p.approvedBy,
  approvedAt: p.approvedAt,
  deleted: p.deleted,
  verification: p.verification,
  finishedAt: p.finishedAt,
  createdAt: p.createdAt,
};

async function closedStore(tx: PlatformTx, tenantId: string) {
  const [store] = await tx.db
    .select({
      slug: schema.tenants.slug,
      status: schema.tenants.status,
      purgeAfter: schema.tenants.purgeAfter,
    })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId));
  if (!store) throw new AppError('store_not_found');
  if (store.status !== 'closed') {
    throw new AppError('illegal_transition', { detail: `the store is ${store.status}, not closed` });
  }
  return store;
}

/** The store's latest purge, with its job. */
export async function getPurge(
  tx: PlatformTx,
  actor: Actor,
  tenantId: string,
): Promise<{ purge: PurgeRecord; job: TenantJob | null } | null> {
  requirePlatformRole(actor, 'support');
  const [purge] = await tx.db
    .select(columns)
    .from(p)
    .where(eq(p.tenantId, tenantId))
    .orderBy(desc(p.createdAt))
    .limit(1);
  if (!purge) return null;
  return { purge: purge as PurgeRecord, job: await getJob(tx, purge.jobId) };
}

/**
 * Starts a purge: its job and record, for the workflow's dry run. A closed
 * store only, once its grace period is over (at once for demo and test
 * stores). Asking again while one is open answers with that one.
 */
export async function requestPurge(
  tx: PlatformTx,
  actor: Actor,
  tenantId: string,
): Promise<{ purge: PurgeRecord; job: TenantJob; created: boolean }> {
  requirePlatformRole(actor, 'super_admin');
  const store = await closedStore(tx, tenantId);
  if (store.purgeAfter && store.purgeAfter.getTime() > Date.now()) {
    throw new AppError('illegal_transition', {
      detail: `the grace period ends ${store.purgeAfter.toISOString()}`,
    });
  }
  const { job, created } = await queueJob(tx, tenantId, 'purge', actor.userId);
  if (!created) {
    const [open] = await tx.db.select(columns).from(p).where(eq(p.jobId, job.id));
    if (!open) throw new AppError('conflict', { detail: 'another purge job is open' });
    return { purge: open as PurgeRecord, job, created };
  }
  const [purge] = await tx.db.insert(p).values({ tenantId, jobId: job.id }).returning(columns);
  if (!purge) throw new AppError('internal');
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    tenantId,
    action: 'tenant.purge_requested',
    entityType: 'tenant_purge',
    entityId: purge.id,
  });
  return { purge: purge as PurgeRecord, job, created };
}

/**
 * The super admin's approval of a dry run: the slug typed, on a closed
 * store, once. The fresh two-factor code is the API's check. The dry run's
 * counts go into the audit entry with who approved.
 */
export async function approvePurge(
  tx: PlatformTx,
  actor: Actor,
  tenantId: string,
  input: { purgeId: string; slug: string },
): Promise<PurgeRecord> {
  requirePlatformRole(actor, 'super_admin');
  if (!actor.userId) throw new AppError('forbidden', { detail: 'a person approves a purge' });
  const store = await closedStore(tx, tenantId);
  if (input.slug.trim().toLowerCase() !== store.slug) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'slug', code: 'mismatch', message: "type the store's address to confirm" }],
    });
  }
  const [purge] = await tx.db
    .select(columns)
    .from(p)
    .where(and(eq(p.id, input.purgeId), eq(p.tenantId, tenantId)));
  if (!purge) throw new AppError('not_found');
  if (!purge.dryRun) throw new AppError('conflict', { detail: 'the dry run has not finished' });
  if (purge.approvedAt) throw new AppError('conflict', { detail: 'already approved' });
  const job = await getJob(tx, purge.jobId);
  if (job?.status !== 'pending') {
    throw new AppError('conflict', { detail: `the purge job is ${job?.status ?? 'missing'}` });
  }
  const [approved] = await tx.db
    .update(p)
    .set({ approvedBy: actor.userId, approvedAt: sql`now()` })
    .where(and(eq(p.id, purge.id), sql`${p.approvedAt} is null`))
    .returning(columns);
  if (!approved) throw new AppError('conflict', { detail: 'already approved' });
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    tenantId,
    action: 'tenant.purge_approved',
    entityType: 'tenant_purge',
    entityId: purge.id,
    after: { dryRun: purge.dryRun },
  });
  return approved as PurgeRecord;
}
