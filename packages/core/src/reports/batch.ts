// The reports' part of the daily batch (phase-8-plan §3.9): each active
// store with the back office refreshes its last week, and a store with older
// history and no backfill yet (it just turned the back office on) gets one
// queued for the Store jobs workflow.
import { createDb, schema } from '@managemind/db';
import { eq } from 'drizzle-orm';
import { storeEntitlements } from '../billing/entitlements';
import { type DbClient, withTenant } from '../tenant';
import { queueBackfillIfNeeded } from './backfill';
import { refreshStoreReports } from './summaries';

const shiftDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Every active store with the back office (`on` is today in Dhaka). */
export async function runReportRefresh(
  client: DbClient,
  on: string,
): Promise<{ stores: number; backfills: number; failed: { tenantId: string; error: string }[] }> {
  const t = schema.tenants;
  const stores = await createDb(client).select({ id: t.id }).from(t).where(eq(t.status, 'active'));
  const result = { stores: 0, backfills: 0, failed: [] as { tenantId: string; error: string }[] };
  for (const store of stores) {
    try {
      const done = await withTenant(client, store.id, async (tx) => {
        if (!(await storeEntitlements(tx)).features.backOffice) return null;
        await refreshStoreReports(tx, on);
        return queueBackfillIfNeeded(tx, shiftDays(on, -7));
      });
      if (done !== null) result.stores += 1;
      if (done) result.backfills += 1;
    } catch (e) {
      result.failed.push({ tenantId: store.id, error: String(e) });
    }
  }
  return result;
}
