// Append-only audit trail of staff actions (the app role can insert and read
// store.audit_log, never change it). Written in the same transaction as the
// change it describes.
import { schema } from '@managemind/db';
import type { TenantTx } from './tenant';

export interface AuditEntry {
  actorType: (typeof schema.ACTOR_TYPES)[number];
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
}

export async function recordAudit(tx: TenantTx, entry: AuditEntry): Promise<void> {
  await tx.db.insert(schema.auditLog).values({
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: entry.ip ?? null,
    requestId: tx.requestId ?? null,
  });
}
