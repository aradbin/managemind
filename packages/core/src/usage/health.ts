// Store health (phase-5b-plan §3.3): what the platform screens show per
// store, written into platform.store_health so they never read the store
// schema. The daily job and a Refresh on one store write it.
import { schema } from '@managemind/db';
import { sql } from 'drizzle-orm';
import { type Actor, requirePlatformRole } from '../access';
import { type Checklist, setupChecklist } from '../tenancy/checklist';
import { type DbClient, type TenantTx, withTenant } from '../tenant';

export interface StoreHealth {
  checkedAt: Date;
  checklist: Checklist | Record<string, never>;
  payments: Record<string, unknown>;
  email: Record<string, unknown>;
  sms: Record<string, unknown>;
  domains: Record<string, unknown>;
  activity: Record<string, unknown>;
}

/** Computes and writes the store's health row, in the caller's tenant transaction. */
export async function writeStoreHealth(tx: TenantTx): Promise<{ checklist: Checklist }> {
  const checklist = await setupChecklist(tx);
  const h = schema.storeHealth;
  await tx.db
    .insert(h)
    .values({ tenantId: tx.tenantId, checklist, checkedAt: sql`now()` })
    .onConflictDoUpdate({ target: h.tenantId, set: { checklist, checkedAt: sql`now()` } });
  return { checklist };
}

/** Refresh on one store (support): the same checks as the daily job, for that store only. */
export async function refreshStoreHealth(
  client: DbClient,
  actor: Actor,
  tenantId: string,
): Promise<StoreHealth> {
  requirePlatformRole(actor, 'support');
  return withTenant(client, tenantId, async (tx) => {
    await writeStoreHealth(tx);
    return (await readStoreHealth(tx, tenantId)) as StoreHealth;
  });
}

/** The last health row of a store, or null before its first check. */
export async function readStoreHealth(
  tx: { db: TenantTx['db'] },
  tenantId: string,
): Promise<StoreHealth | null> {
  const h = schema.storeHealth;
  const [row] = await tx.db
    .select({
      checkedAt: h.checkedAt,
      checklist: h.checklist,
      payments: h.payments,
      email: h.email,
      sms: h.sms,
      domains: h.domains,
      activity: h.activity,
    })
    .from(h)
    .where(sql`${h.tenantId} = ${tenantId}`);
  return (row as StoreHealth | undefined) ?? null;
}
