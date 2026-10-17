// Store data: everything a client creates or collects. Every table starts
// with tenantColumns() and tenantPolicy() (tenant_id + FORCE RLS). tenant_id is the first column of every
// index, except the documented system-sweep index on outbox (ADR 0010).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  inet,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/** Domain events written in the same transaction as the change (outbox pattern). */
export const outbox = store.table(
  'outbox',
  {
    ...tenantColumns(),
    id: id(),
    eventType: text().notNull(),
    aggregateType: text().notNull(),
    aggregateId: uuid(),
    payload: jsonb().notNull(),
    requestId: text(),
    dispatchedAt: timestamp({ withTimezone: true }),
    attempts: smallint().notNull().default(0),
    lastError: text(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    index('outbox_tenant_created_idx').on(t.tenantId, t.createdAt),
    // Exception to "tenant_id first": the dispatcher sweeps across tenants.
    index('outbox_pending_idx').on(t.createdAt).where(sql`dispatched_at is null`),
  ],
);

/** `shopper`: a shopper acting on their own order (Phase 4). */
export const ACTOR_TYPES = ['staff', 'platform', 'system', 'shopper'] as const;

/** Append-only record of staff actions: the app role may insert and read only. */
export const auditLog = store.table(
  'audit_log',
  {
    ...tenantColumns(),
    id: id(),
    actorType: text({ enum: ACTOR_TYPES }).notNull(),
    actorId: uuid(),
    action: text().notNull(),
    entityType: text(),
    entityId: uuid(),
    before: jsonb(),
    after: jsonb(),
    requestId: text(),
    ip: inet(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    index('audit_log_tenant_created_idx').on(t.tenantId, sql`created_at desc`),
    index('audit_log_tenant_entity_idx').on(
      t.tenantId,
      t.entityType,
      t.entityId,
      sql`created_at desc`,
    ),
    check(
      'audit_log_actor_type_valid',
      sql`actor_type in (${sql.raw(ACTOR_TYPES.map((a) => `'${a}'`).join(', '))})`,
    ),
  ],
);

export const IDEMPOTENCY_STATES = ['in_progress', 'completed'] as const;

/** First result of a retryable write, replayed for repeats of the same key. */
export const idempotencyKeys = store.table(
  'idempotency_keys',
  {
    ...tenantColumns(),
    scope: text().notNull(),
    key: text().notNull(),
    requestHash: text().notNull(),
    state: text({ enum: IDEMPOTENCY_STATES }).notNull().default('in_progress'),
    responseStatus: smallint(),
    responseBody: jsonb(),
    lockedUntil: timestamp({ withTimezone: true }).notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull().default(sql`now() + interval '2 days'`),
    createdAt: createdAt(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.scope, t.key] }),
    index('idempotency_keys_tenant_expires_idx').on(t.tenantId, t.expiresAt),
    check('idempotency_keys_key_length', sql`char_length(key) between 8 and 255`),
    check('idempotency_keys_state_valid', sql`state in ('in_progress', 'completed')`),
  ],
);
