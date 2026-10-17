// An order's history (phase-4-plan §3.6): every status change and edit, with
// the machine, from, to, the actor and the reason. Append-only for the app.
import { schema } from '@managemind/db';
import type { HistoryMachine } from '@managemind/shared/orders';
import { type Actor, auditActor } from '../access';
import type { TenantTx } from '../tenant';

export interface HistoryEntry {
  orderId: string;
  machine: HistoryMachine;
  from: string | null;
  to: string | null;
  event: string;
  reason?: string | null | undefined;
  data?: unknown;
}

export async function recordHistory(
  tx: TenantTx,
  actor: Actor,
  entry: HistoryEntry,
): Promise<void> {
  const who = auditActor(actor, 'staff');
  await tx.db.insert(schema.orderHistory).values({
    orderId: entry.orderId,
    machine: entry.machine,
    fromStatus: entry.from,
    toStatus: entry.to,
    event: entry.event,
    actorType: who.actorType,
    actorId: who.actorId ?? null,
    reason: entry.reason ?? null,
    data: entry.data ?? null,
  });
}
