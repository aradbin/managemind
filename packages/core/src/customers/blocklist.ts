// The per-store phone blocklist (phase-4-plan §3.15): a blocked phone gets
// the same refusal as a rate limit at checkout, so a fraudster learns
// nothing; staff are warned and can still enter a manual order.
import { schema } from '@managemind/db';
import { AppError, normalizePhone } from '@managemind/shared';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, auditActor, authorize } from '../access';
import { recordAudit } from '../audit';
import { parseInput } from '../catalog/common';
import type { TenantTx } from '../tenant';

export interface BlockedPhone {
  phone: string;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

const blockInput = z
  .object({ phone: z.string().max(32), reason: z.string().trim().min(1).max(300) })
  .strict();

export async function listBlockedPhones(tx: TenantTx, actor: Actor): Promise<BlockedPhone[]> {
  authorize(actor, 'settings.read');
  const b = schema.blockedPhones;
  const rows = await tx.db
    .select({ phone: b.phone, reason: b.reason, createdBy: b.createdBy, createdAt: b.createdAt })
    .from(b)
    .orderBy(sql`${b.createdAt} desc`)
    .limit(1000);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

export async function blockPhone(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<BlockedPhone> {
  authorize(actor, 'settings.write');
  const v = parseInput(blockInput, input);
  const phone = normalizePhone(v.phone);
  if (!phone) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'phone', code: 'invalid', message: 'must be a Bangladeshi mobile number' }],
    });
  }
  const b = schema.blockedPhones;
  const [row] = await tx.db
    .insert(b)
    .values({ phone, reason: v.reason, createdBy: actor.userId })
    .onConflictDoUpdate({ target: [b.tenantId, b.phone], set: { reason: v.reason } })
    .returning();
  if (!row) throw new AppError('internal');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'blocklist.added',
    entityType: 'blocked_phone',
    after: { phone, reason: v.reason },
  });
  return {
    phone,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function unblockPhone(tx: TenantTx, actor: Actor, phoneInput: string): Promise<void> {
  authorize(actor, 'settings.write');
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new AppError('not_found');
  const b = schema.blockedPhones;
  const deleted = await tx.db.delete(b).where(eq(b.phone, phone)).returning({ phone: b.phone });
  if (!deleted.length) throw new AppError('not_found');
  await recordAudit(tx, {
    ...auditActor(actor, 'staff'),
    action: 'blocklist.removed',
    entityType: 'blocked_phone',
    before: { phone },
  });
}

/** Whether a phone is blocked: the manual order screen warns staff. */
export async function isBlocked(tx: TenantTx, phone: string): Promise<boolean> {
  const { rows } = await tx.db.execute(
    sql`select 1 from store.blocked_phones where phone = ${phone}`,
  );
  return rows.length > 0;
}
