// withTenant: the only way to get a tenant-scoped transaction (ADR 0002,
// ADR 0009). It opens the transaction and sets the tenant in one round trip,
// runs `fn`, commits, and only then hands the events emitted inside it to
// `afterCommit` (the outbox relay, ADR 0010).
import { createDb, type Db } from '@managemind/db';
import { AppError, isUuid } from '@managemind/shared';
import type pg from 'pg';
import type { OutboxEvent } from './outbox';

declare const tenantTxBrand: unique symbol;

/** A transaction with a tenant set. Repositories accept only this type. */
export interface TenantTx {
  readonly [tenantTxBrand]: true;
  readonly db: Db;
  readonly tenantId: string;
  readonly requestId: string | undefined;
  /** Events emitted in this transaction, relayed after commit. */
  readonly events: OutboxEvent[];
}

export type DbClient = pg.Client | pg.PoolClient;

export interface WithTenantOptions {
  requestId?: string;
  /** Runs after a successful commit, with the events emitted inside. */
  afterCommit?: (events: readonly OutboxEvent[]) => void | Promise<void>;
}

const busy = new WeakSet<DbClient>();

export async function withTenant<T>(
  client: DbClient,
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options: WithTenantOptions = {},
): Promise<T> {
  // The tenant ID goes into the SQL text (one round trip for BEGIN and the
  // settings), so nothing but a canonical UUID may pass.
  if (typeof tenantId !== 'string' || !isUuid(tenantId)) {
    throw new AppError('tenant_context_missing', { detail: 'withTenant needs a tenant UUID' });
  }
  if (busy.has(client)) {
    throw new AppError('internal', { detail: 'withTenant is already running on this connection' });
  }
  busy.add(client);
  const tx = {
    db: createDb(client),
    tenantId,
    requestId: options.requestId,
    events: [] as OutboxEvent[],
  } as unknown as TenantTx;
  try {
    await client.query(
      `begin; select set_config('app.tenant_id', '${tenantId}', true), set_config('app.tenant_at', now()::text, true)`,
    );
    let result: T;
    try {
      result = await fn(tx);
      await client.query('commit');
    } catch (e) {
      await client.query('rollback').catch(() => {});
      throw e;
    }
    if (options.afterCommit && tx.events.length > 0) await options.afterCommit(tx.events);
    return result;
  } finally {
    busy.delete(client);
  }
}
