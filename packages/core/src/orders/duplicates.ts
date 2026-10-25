// Duplicate orders (phase-6-plan §3.4): placeOrder flags an order from the
// same phone with the same variants as a recent one. Staff act on the newer
// order: merge it into the older one, cancel it as a duplicate (the cancel
// route with the code `duplicate`), or say it isn't one. Merging moves the
// newer order's lines into the older one through the order edit, so
// totals, promotions, the COD amount and reservations follow, and cancels
// the newer one, in one transaction. The shopper hears about neither.
import { AppError } from '@managemind/shared';
import { formatOrderNumber } from '@managemind/shared/orders';
import { sql } from 'drizzle-orm';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { orderSettings } from '../pricing/quote';
import type { TenantTx } from '../tenant';
import { editOrder } from './edit';
import { recordHistory } from './history';
import { cancelOrder, lockOrder, type OrderRow } from './lifecycle';

interface DuplicatePair {
  newer: OrderRow;
  older: OrderRow;
}

/** The newer order and the one it may duplicate, both locked, older first. */
async function lockPair(tx: TenantTx, newerId: string): Promise<DuplicatePair> {
  const { rows } = await tx.db.execute<{ duplicate_of: string | null; flags: string[] }>(sql`
    select duplicate_of, flags from store.orders where id = ${newerId}`);
  const row = rows[0];
  if (!row) throw new AppError('not_found');
  if (!row.duplicate_of || !row.flags.includes('possible_duplicate')) {
    throw new AppError('conflict', {
      detail: 'This order is not flagged as a possible duplicate',
      extensions: { reason: 'not_duplicate' },
    });
  }
  // Older first: two merges can't lock the same pair in opposite orders.
  const older = await lockOrder(tx, row.duplicate_of);
  const newer = await lockOrder(tx, newerId);
  return { newer, older };
}

/** Why a pair can't be merged, or null: both open, nothing shipped, nothing paid on the newer. */
async function mergeBlocker(tx: TenantTx, { newer, older }: DuplicatePair): Promise<string | null> {
  const { rows } = await tx.db.execute<{ shipped: boolean; paid: boolean }>(sql`
    select exists (select 1 from store.shipments
                    where order_id in (${newer.id}, ${older.id})) as shipped,
           exists (select 1 from store.payments
                    where order_id = ${newer.id} and provider <> 'cod'
                      and status in ('pending', 'paid')) as paid`);
  if (rows[0]?.shipped) return 'shipped';
  const open = (status: string) => status === 'pending' || status === 'confirmed';
  if (!open(newer.status) || !open(older.status)) return 'not_open';
  if (rows[0]?.paid) return 'paid';
  return null;
}

/**
 * Merges a possible duplicate into the order it duplicates: the newer
 * order is cancelled as `duplicate` (releasing its stock), then the older
 * one gets its lines, quantities added, through the order edit. Existing
 * lines keep their prices, and the older order's delivery charge stays.
 */
export async function mergeDuplicate(
  tx: TenantTx,
  actor: Actor,
  newerId: string,
): Promise<{ orderId: string }> {
  authorize(actor, 'orders.write');
  const pair = await lockPair(tx, newerId);
  const blocker = await mergeBlocker(tx, pair);
  if (blocker) {
    throw new AppError('illegal_transition', {
      detail:
        blocker === 'paid'
          ? 'The newer order has a payment; cancel it as a duplicate instead'
          : blocker === 'shipped'
            ? 'Something is already shipped'
            : 'Both orders must be pending or confirmed',
      extensions: { reason: blocker },
    });
  }
  const { newer, older } = pair;
  const { checkout } = await orderSettings(tx);
  const display = (n: number) => formatOrderNumber(checkout.orderNumberPrefix, n);
  const { rows: lines } = await tx.db.execute<{ variant_id: string; quantity: number }>(sql`
    select variant_id, sum(quantity)::int as quantity from store.order_lines
     where order_id in (${older.id}, ${newer.id})
     group by variant_id order by min(position)`);

  await cancelOrder(tx, actor, newer.id, {
    reason: `Merged into ${display(older.number)}`,
    code: 'duplicate',
  });
  await editOrder(tx, actor, older.id, {
    lines: lines.map((l) => ({ variantId: l.variant_id, quantity: l.quantity })),
    reason: `Merged ${display(newer.number)}`,
  });
  await recordHistory(tx, actor, {
    orderId: newer.id,
    machine: 'edit',
    from: null,
    to: null,
    event: 'merged_into',
    data: { orderId: older.id, number: older.number },
  });
  await recordHistory(tx, actor, {
    orderId: older.id,
    machine: 'edit',
    from: null,
    to: null,
    event: 'merged_from',
    data: { orderId: newer.id, number: newer.number },
  });
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'order.merged',
    entityType: 'order',
    entityId: older.id,
    after: { mergedOrderId: newer.id },
  });
  return { orderId: older.id };
}

/** "Not a duplicate": the flag goes, the link to the older order stays for the report. */
export async function dismissDuplicate(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  authorize(actor, 'orders.write');
  const { newer, older } = await lockPair(tx, id);
  await tx.db.execute(sql`
    update store.orders set flags = array_remove(flags, 'possible_duplicate') where id = ${newer.id}`);
  await recordHistory(tx, actor, {
    orderId: newer.id,
    machine: 'edit',
    from: null,
    to: null,
    event: 'duplicate_dismissed',
    data: { orderId: older.id, number: older.number },
  });
}
