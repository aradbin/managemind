// Flagged phones (phase-5a-plan §3.11): a customer whose deliveries came back
// undelivered as often as the store's setting allows, or whom staff flagged.
// A flag never refuses an order (the blocklist does that); it asks for the
// delivery charge in advance, or a code by SMS, as the store chose.
import type { TenantSettings } from '@managemind/shared/settings';
import { sql } from 'drizzle-orm';
import type { TenantTx } from '../tenant';

export async function phoneFlagged(
  tx: TenantTx,
  phone: string,
  settings: Pick<TenantSettings, 'fraud'>,
): Promise<boolean> {
  const { rows } = await tx.db.execute<{ failed: number; flagged: boolean }>(sql`
    select failed_deliveries as failed, flagged from store.customers
     where phone = ${phone} and deleted_at is null`);
  const c = rows[0];
  return Boolean(c && (c.flagged || c.failed >= settings.fraud.flagAfterFailed));
}
