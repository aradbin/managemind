// Staff push devices (phase-5a-plan §3.9): a staff member's browsers that
// subscribed to this store's alerts. The sender reads them; a push service
// answering "gone" deletes one.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, authorize } from '../access';
import { parseInput } from '../catalog/common';
import type { TenantTx } from '../tenant';

const s = schema.pushSubscriptions;

export const pushSubscriptionInput = z
  .object({
    endpoint: z.url({ protocol: /^https$/ }).max(1000),
    keys: z
      .object({
        p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
        auth: z.string().regex(/^[A-Za-z0-9_-]{16,30}$/),
      })
      .strict(),
    userAgent: z.string().max(300).optional(),
  })
  .strict();

export interface PushDevice {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function staffUser(actor: Actor): string {
  authorize(actor, 'orders.read');
  if (!actor.userId) throw new AppError('forbidden');
  return actor.userId;
}

/** Saves this browser's subscription for the signed-in staff member (a re-subscribe updates it). */
export async function addPushDevice(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<PushDevice> {
  const userId = staffUser(actor);
  const v = parseInput(pushSubscriptionInput, input);
  const values = {
    userId,
    p256dh: v.keys.p256dh,
    auth: v.keys.auth,
    userAgent: v.userAgent ?? null,
  };
  const [row] = await tx.db
    .insert(s)
    .values({ endpoint: v.endpoint, ...values })
    .onConflictDoUpdate({ target: [s.tenantId, s.endpoint], set: values })
    .returning();
  if (!row) throw new AppError('internal');
  return {
    id: row.id,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

export async function listPushDevices(tx: TenantTx, actor: Actor): Promise<PushDevice[]> {
  const userId = staffUser(actor);
  const rows = await tx.db.select().from(s).where(eq(s.userId, userId));
  return rows.map((r) => ({
    id: r.id,
    userAgent: r.userAgent,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Removes one of the signed-in staff member's own devices. */
export async function removePushDevice(tx: TenantTx, actor: Actor, id: string): Promise<void> {
  const userId = staffUser(actor);
  const deleted = await tx.db
    .delete(s)
    .where(and(eq(s.id, id), eq(s.userId, userId)))
    .returning({ id: s.id });
  if (!deleted.length) throw new AppError('not_found');
}

export interface PushTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** A staff member's devices in this store, for the sender. */
export async function pushTargets(tx: TenantTx, userId: string): Promise<PushTarget[]> {
  return tx.db
    .select({ id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth })
    .from(s)
    .where(eq(s.userId, userId));
}

/** After sending: devices that took the message are marked used, gone ones deleted. */
export async function settlePushTargets(
  tx: TenantTx,
  used: readonly string[],
  gone: readonly string[],
): Promise<void> {
  if (used.length) await tx.db.update(s).set({ lastUsedAt: new Date() }).where(inArray(s.id, used));
  if (gone.length) await tx.db.delete(s).where(inArray(s.id, gone));
}
