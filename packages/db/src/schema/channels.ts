// Sales channels (phase-9-plan §3.1.4, §3.1.6, §4): the state of each store's
// product feed for Meta, and the server-side events sent to Meta's
// Conversions API, one row per order and event so a redelivered outbox event
// never reports a purchase twice.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { orders } from './orders';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const FEED_KINDS = ['meta'] as const;
export const META_EVENT_NAMES = ['Purchase', 'Delivered'] as const;
export const META_EVENT_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;

const ts = () => timestamp({ withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in (${inList(values)})`);

/**
 * A store's feed (§3.1.4): marked dirty by catalog and stock changes, rebuilt
 * as chunks in R2 by the delayed-work queue, and served by streaming them.
 */
export const feeds = store.table(
  'feeds',
  {
    ...tenantColumns(),
    kind: text({ enum: FEED_KINDS }).notNull(),
    /** Set by the first change since the last build; null when the feed is current. */
    dirtySince: ts(),
    builtAt: ts(),
    /** Chunks per locale in the last build, e.g. { en: 3, bn: 3 }. */
    chunks: jsonb().notNull().default({}),
    rows: integer().notNull().default(0),
    /** Variants left out, by reason: { no_image: 4, no_price: 1 }. */
    skipped: jsonb().notNull().default({}),
    etag: text(),
    lastError: text(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.kind] }),
    oneOf('feeds_kind_valid', t.kind, FEED_KINDS),
    check('feeds_rows_non_negative', sql`${t.rows} >= 0`),
    check(
      'feeds_text_lengths',
      sql`char_length(${t.etag}) <= 100 and char_length(${t.lastError}) <= 300`,
    ),
  ],
);

/** One Conversions API event per order and name (§3.1.6). */
export const metaEvents = store.table(
  'meta_events',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    orderId: uuid().notNull(),
    name: text({ enum: META_EVENT_NAMES }).notNull(),
    status: text({ enum: META_EVENT_STATUSES }).notNull().default('queued'),
    /** Why it was skipped or failed: no_consent, no_token, or Meta's error. */
    reason: text(),
    attempts: smallint().notNull().default(0),
    sentAt: ts(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('meta_events_order_name_unique').on(t.tenantId, t.orderId, t.name),
    foreignKey({
      name: 'meta_events_order_fk',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }).onDelete('restrict'),
    index('meta_events_tenant_created_idx').on(t.tenantId, sql`created_at desc`),
    oneOf('meta_events_name_valid', t.name, META_EVENT_NAMES),
    oneOf('meta_events_status_valid', t.status, META_EVENT_STATUSES),
    check('meta_events_reason_length', sql`char_length(${t.reason}) <= 300`),
  ],
);
