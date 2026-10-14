// Access to platform tables outside a store (phase-1-plan §6.2). These
// tables have no RLS: grants limit what the app role can do, and every
// query that reads one store's rows filters by tenant in code. Only the
// tenancy and identity modules use PlatformTx.
import { createDb, type Db, schema } from '@managemind/db';
import type { DbClient } from './tenant';

declare const platformTxBrand: unique symbol;

export interface PlatformTx {
  readonly [platformTxBrand]: true;
  readonly db: Db;
  readonly requestId: string | undefined;
}

export async function withPlatform<T>(
  client: DbClient,
  fn: (tx: PlatformTx) => Promise<T>,
  options: { requestId?: string } = {},
): Promise<T> {
  const tx = { db: createDb(client), requestId: options.requestId } as unknown as PlatformTx;
  await client.query('begin');
  try {
    const result = await fn(tx);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  }
}

export interface PlatformAuditEntry {
  tenantId?: string;
  actorType: (typeof schema.PLATFORM_ACTOR_TYPES)[number];
  actorId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
}

/** Appends to platform.audit_log, in the caller's transaction (tenant-scoped or not). */
export async function recordPlatformAudit(
  tx: { db: Db; requestId: string | undefined },
  entry: PlatformAuditEntry,
): Promise<void> {
  await tx.db.insert(schema.platformAuditLog).values({
    tenantId: entry.tenantId ?? null,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    requestId: tx.requestId ?? null,
  });
}
