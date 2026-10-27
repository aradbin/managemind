// A store's report history (phase-8-plan §3.9): the summaries for every day
// since its first order or stock movement, and the stock value at each past
// month's end, filled by the Store jobs workflow (ADR 0027) in Actions, not
// in a Worker. Each 31 days, and each month end, commit on their own with
// the progress, so a stopped run resumes where it was.
import { AppError } from '@managemind/shared';
import { sql } from 'drizzle-orm';
import { type Actor, auditActor, requirePlatformRole } from '../access';
import { recordAudit } from '../audit';
import { requireBackOffice, today } from '../purchasing/common';
import { queueJob, type TenantJob } from '../tenancy/jobs';
import { type DbClient, type TenantTx, withTenant } from '../tenant';
import { monthEnd, refreshSummaries, writeMonthEndValues } from './summaries';

const DAY_MS = 86_400_000;
const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const nextMonth = (date: string) => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

/** Days refreshed per transaction. */
export const BACKFILL_CHUNK_DAYS = 31;

export interface BackfillProgress {
  phase?: 'days' | 'months' | 'done';
  /** The last day (or month end) written. */
  through?: string;
}

export interface BackfillResult {
  from: string | null;
  to: string;
  days: number;
  months: number;
}

/**
 * A transaction in the store as app_rw, so row-level security applies even
 * on the migration role the Store jobs workflow connects with (the runner
 * grants it app_rw first, as the reset does).
 */
const inStore = <T>(client: DbClient, tenantId: string, fn: (tx: TenantTx) => Promise<T>) =>
  withTenant(client, tenantId, async (tx) => {
    await tx.db.execute(sql`set local role app_rw`);
    return fn(tx);
  });

/** The store's first Dhaka day with an order or a stock movement; null for an empty store. */
async function firstDay(tx: TenantTx): Promise<string | null> {
  const { rows } = await tx.db.execute<{ day: string | null }>(sql`
    select ((least((select min(placed_at) from store.orders),
                   (select min(created_at) from store.stock_movements))
             at time zone 'Asia/Dhaka')::date)::text as day`);
  return rows[0]?.day ?? null;
}

/**
 * Fills every summary from the first day to yesterday, then every past
 * month's end. `save` records the progress after each commit; a run given
 * that progress carries on from it.
 */
export async function backfillReports(
  client: DbClient,
  tenantId: string,
  progress: BackfillProgress,
  save: (p: BackfillProgress) => Promise<void>,
  on = today(),
): Promise<BackfillResult> {
  const first = await inStore(client, tenantId, firstDay);
  const to = addDays(on, -1);
  const result: BackfillResult = { from: first, to, days: 0, months: 0 };
  if (!first || first > to) {
    await save({ phase: 'done' });
    return result;
  }
  let day = progress.phase === 'days' && progress.through ? addDays(progress.through, 1) : first;
  if (progress.phase !== 'months' && progress.phase !== 'done') {
    while (day <= to) {
      const last = [addDays(day, BACKFILL_CHUNK_DAYS - 1), to].sort()[0] as string;
      await inStore(client, tenantId, (tx) => refreshSummaries(tx, day, last));
      await save({ phase: 'days', through: last });
      result.days += Math.round((Date.parse(last) - Date.parse(day)) / DAY_MS) + 1;
      day = addDays(last, 1);
    }
  }
  // Month ends before this month; values rebuilt from today's stock and the
  // movements since, at the cost then (§3.9).
  let month =
    progress.phase === 'months' && progress.through
      ? nextMonth(progress.through)
      : `${first.slice(0, 8)}01`;
  const thisMonth = `${on.slice(0, 8)}01`;
  if (progress.phase !== 'done') {
    while (month < thisMonth) {
      const end = monthEnd(month);
      await inStore(client, tenantId, (tx) => writeMonthEndValues(tx, month));
      await save({ phase: 'months', through: end });
      result.months += 1;
      month = nextMonth(month);
    }
  }
  await save({ phase: 'done', through: to });
  return result;
}

/**
 * POST /platform/tenants/{id}/reports/rebuild: queues the backfill, after a
 * fix or when a store turns the back office on (super_admin).
 */
export async function requestReportsRebuild(
  tx: TenantTx,
  actor: Actor,
): Promise<{ job: TenantJob; created: boolean }> {
  requirePlatformRole(actor, 'super_admin');
  await requireBackOffice(tx);
  const queued = await queueJob(tx, tx.tenantId, 'reports_backfill', actor.userId);
  if (queued.created) {
    await recordAudit(tx, {
      ...auditActor(actor, 'platform'),
      action: 'reports.rebuild_requested',
      entityType: 'tenant_job',
      entityId: queued.job.id,
    });
  }
  return queued;
}

/**
 * Queues the backfill for a store that has history before the nightly
 * window and has never had one: a store that just turned the back office
 * on. Called by the nightly refresh; true when it queued one.
 */
export async function queueBackfillIfNeeded(tx: TenantTx, before: string): Promise<boolean> {
  const { rows } = await tx.db.execute<{ needed: boolean }>(sql`
    select (exists (select 1 from store.orders
                     where placed_at < (${before}::date)::timestamp at time zone 'Asia/Dhaka')
            or exists (select 1 from store.stock_movements
                        where created_at < (${before}::date)::timestamp at time zone 'Asia/Dhaka'))
       and not exists (select 1 from platform.tenant_jobs
                        where tenant_id = ${tx.tenantId} and kind = 'reports_backfill'
                          and status <> 'failed') as needed`);
  if (!rows[0]?.needed) return false;
  const { created } = await queueJob(tx, tx.tenantId, 'reports_backfill', null);
  if (!created) throw new AppError('conflict', { detail: 'a backfill is already open' });
  return true;
}
