// Store credit (phase-5a-plan §3.13, Q11): a refund as a single-use code for
// the customer's phone, which is an amount-off promotion marked as credit. It
// goes through the promotion engine like any code; what an order leaves
// unused comes back as a new code, so no balance ledger is needed.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { eq } from 'drizzle-orm';
import { emit } from '../outbox';
import type { TenantTx } from '../tenant';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function creditCodeText(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `CR${[...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')}`;
}

/**
 * A single-use code for the order's phone, worth `amount` off a future
 * order: an amount-off promotion marked as store credit.
 */
export async function issueStoreCredit(
  tx: TenantTx,
  orderId: string,
  amount: number,
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
  const credit = await issueStoreCredit(tx, orderId, left);
  await emit(tx, 'store_credit.issued', {
    aggregateType: 'order',
    aggregateId: orderId,
    payload: { orderId, amount: left, creditCode: credit.code },
  });
  return { code: credit.code, amount: left };
}
