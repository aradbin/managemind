// Helpers shared by the back office's services (phase-8-plan §3.11): the
// plan feature, per-store document numbers, Dhaka's today, and who sees
// costs. Costs are left out of a response without catalog.cost, not blanked.
import { AppError } from '@managemind/shared';
import { dhakaDate } from '@managemind/shared/billing';
import { sql } from 'drizzle-orm';
import type { Actor } from '../access';
import { requireFeature } from '../billing/entitlements';
import type { TenantTx } from '../tenant';

/** Purchasing, counts, expenses and the new reports need the plan's `backOffice` (Q13). */
export const requireBackOffice = (tx: TenantTx) => requireFeature(tx, 'backOffice');

export const seesCost = (actor: Actor) => actor.permissions.has('catalog.cost');

/** Refuses forbidden unless the actor may see and set costs. */
export function requireCost(actor: Actor): void {
  if (!seesCost(actor)) {
    throw new AppError('forbidden', { detail: 'costs need the cost permission' });
  }
}

export type CounterName = 'purchase_order_number' | 'goods_receipt_number' | 'stock_count_number';

/** The next number of a per-store sequence, from 1 (§3.2). */
export async function nextNumber(tx: TenantTx, name: CounterName): Promise<number> {
  const { rows } = await tx.db.execute<{ value: string }>(sql`
    insert into store.counters (name, value) values (${name}, 1)
    on conflict (tenant_id, name) do update set value = store.counters.value + 1
    returning value`);
  return Number(rows[0]?.value);
}

/** Today in Dhaka, as YYYY-MM-DD. */
export const today = (now = new Date()) => dhakaDate(now);

/** A raw query's bigint column (pg returns int8 as text). */
export const money = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

export const isUniqueViolation = (e: unknown, constraint?: string) => {
  const cause = (e as { cause?: { code?: string; constraint?: string } }).cause;
  return cause?.code === '23505' && (!constraint || cause.constraint === constraint);
};
