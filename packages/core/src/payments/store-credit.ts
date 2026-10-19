// Store credit (phase-5a-plan §3.13, Q11): a refund as a single-use code for
// the customer's phone, which is an amount-off promotion marked as credit. It
// goes through the promotion engine like any code; what an order leaves
// unused comes back as a new code, so no balance ledger is needed.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { eq, sql } from 'drizzle-orm';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function creditCodeText(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `CR${[...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`;
}

/**
 * A single-use code for the order's phone, worth `amount` off a future
 * order: an amount-off promotion marked as store credit. `parentId` is the
 * credit this one is the unused remainder of.
 */
export async function issueStoreCredit(
  tx: TenantTx,
  orderId: string,
  amount: number,
  parentId: string | null = null,
): Promise<{ id: string; code: string }> {
  const [order] = await tx.db
    .select({ phone: schema.orders.phone })
    .from(schema.orders)
    .where(eq(schema.orders.id, orderId));
  if (!order) throw new AppError('not_found');
  const [promotion] = await tx.db
    .insert(schema.promotions)
    .values({
      title: { en: 'Store credit', bn: 'স্টোর ক্রেডিট' },
      kind: 'code',
      status: 'active',
      usageLimit: 1,
      conditions: { customerPhones: [order.phone] },
      action: { type: 'amount_off_order', amount },
      storeCredit: true,
      creditOrderId: orderId,
      creditParentId: parentId,
    })
    .returning({ id: schema.promotions.id });
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = creditCodeText();
    const [row] = await tx.db
      .insert(schema.promotionCodes)
      .values({ promotionId: promotion?.id as string, code, usageLimit: 1 })
      .onConflictDoNothing()
      .returning({ id: schema.promotionCodes.id });
    if (row) return { id: row.id, code };
  }
  throw new AppError('internal', { detail: 'could not pick a unique credit code' });
}

/**
 * After an order used a store credit code: what it didn't use comes back as
 * a new code for the same phone (§3.13), and the shopper is told.
 */
export async function reissueCreditRemainder(
  tx: TenantTx,
  orderId: string,
  promotionId: string,
  used: number,
): Promise<{ code: string; amount: number } | null> {
  const [promotion] = await tx.db
    .select({ action: schema.promotions.action, storeCredit: schema.promotions.storeCredit })
    .from(schema.promotions)
    .where(eq(schema.promotions.id, promotionId));
  if (!promotion?.storeCredit) return null;
  const left = Number((promotion.action as { amount?: number }).amount ?? 0) - used;
  if (left <= 0) return null;
  const credit = await issueStoreCredit(tx, orderId, left, promotionId);
  await emit(tx, 'store_credit.issued', {
    aggregateType: 'order',
    aggregateId: orderId,
    payload: { orderId, amount: left, creditCode: credit.code },
  });
  return { code: credit.code, amount: left };
}

/**
 * When an order that used a credit code is cancelled, or an edit drops the
 * code: the remainder it was given must not outlive the original's use
 * coming back, or each cancel would mint credit. An unused remainder is
 * ended (its uses spent in the same statement, so a checkout racing for it
 * fails) and the original gets its use back. A remainder already spent can't
 * be taken back, so the original stays used and what the order took from it
 * comes back as a new code. Returns whether the original's use is given back.
 */
export async function revokeCreditRemainder(
  tx: TenantTx,
  orderId: string,
  promotionId: string,
  used: number,
): Promise<boolean> {
  const { rows } = await tx.db.execute<{ id: string; usage_count: number }>(sql`
    select id, usage_count from store.promotions
     where credit_parent_id = ${promotionId} and credit_order_id = ${orderId}
     for update`);
  const remainder = rows[0];
  if (!remainder) return true;
  if (remainder.usage_count === 0) {
    await tx.db.execute(sql`
      update store.promotions set status = 'ended', usage_count = usage_limit, updated_at = now()
       where id = ${remainder.id}`);
    await tx.db.execute(sql`
      update store.promotion_codes set usage_count = coalesce(usage_limit, usage_count + 1)
       where promotion_id = ${remainder.id}`);
    return true;
  }
  if (used > 0) {
    const credit = await issueStoreCredit(tx, orderId, used);
    await emit(tx, 'store_credit.issued', {
      aggregateType: 'order',
      aggregateId: orderId,
      payload: { orderId, amount: used, creditCode: credit.code },
    });
  }
  return false;
}
