// Sales recovery (phase-6-plan §4): incomplete checkouts saved for staff to
// call, and each COD order's place in the confirmation queue. Both are store
// tables with the tenant policy; the confirmation's calls are order history.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { carts, orders } from './orders';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const INCOMPLETE_ORDER_STATUSES = [
  'open',
  'contacted',
  'converted',
  'recovered',
  'dismissed',
] as const;
export const CONFIRMATION_OUTCOMES = [
  'confirmed',
  'no_answer',
  'call_back',
  'wrong_number',
  'cancelled',
] as const;
export const CONFIRMED_VIA = ['call', 'link', 'staff', 'auto'] as const;
export const LINK_ANSWERS = ['confirm', 'cancel'] as const;

const ts = () => timestamp({ withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in (${inList(values)})`);

/** A checkout the shopper left after typing a valid phone (§3.2): one per cart. */
export const incompleteOrders = store.table(
  'incomplete_orders',
  {
    ...tenantColumns(),
    id: uuid().primaryKey().default(sql`uuidv7()`),
    /** Null once the cart is cleaned up; the record keeps its own copy of the lines. */
    cartId: uuid(),
    phone: text().notNull(),
    name: text(),
    email: text(),
    /** The address fields typed so far: { divisionId?, districtId?, areaId?, line? }. */
    address: jsonb().notNull().default({}),
    /** [{ variantId, quantity, title, price }], as the checkout showed them. */
    lines: jsonb().notNull(),
    subtotal: bigint({ mode: 'number' }).notNull(),
    locale: text().notNull(),
    status: text({ enum: INCOMPLETE_ORDER_STATUSES }).notNull().default('open'),
    note: text(),
    contactedBy: uuid(),
    contactedAt: ts(),
    /** The order staff made from it, or the one the shopper placed. */
    orderId: uuid(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('incomplete_orders_tenant_id_unique').on(t.tenantId, t.id),
    uniqueIndex('incomplete_orders_cart_unique')
      .on(t.tenantId, t.cartId)
      .where(sql`cart_id is not null`),
    foreignKey({
      name: 'incomplete_orders_cart_fk',
      columns: [t.tenantId, t.cartId],
      foreignColumns: [carts.tenantId, carts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'incomplete_orders_order_fk',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }).onDelete('restrict'),
    index('incomplete_orders_status_idx').on(t.tenantId, t.status, sql`updated_at desc`),
    index('incomplete_orders_phone_idx').on(t.tenantId, t.phone),
    oneOf('incomplete_orders_status_valid', t.status, INCOMPLETE_ORDER_STATUSES),
    check('incomplete_orders_phone_format', sql`${t.phone} ~ '^\\+8801[3-9][0-9]{8}$'`),
    check('incomplete_orders_locale_valid', sql`${t.locale} in ('bn', 'en')`),
    check('incomplete_orders_name_length', sql`char_length(${t.name}) <= 100`),
    check('incomplete_orders_email_length', sql`char_length(${t.email}) <= 254`),
    check('incomplete_orders_note_length', sql`char_length(${t.note}) <= 500`),
    check('incomplete_orders_subtotal', sql`${t.subtotal} >= 0`),
    check(
      'incomplete_orders_lines',
      sql`jsonb_typeof(${t.lines}) = 'array' and jsonb_array_length(${t.lines}) between 1 and 50`,
    ),
    check('incomplete_orders_address_size', sql`octet_length(${t.address}::text) <= 2000`),
    check(
      'incomplete_orders_order_status',
      sql`(${t.status} = 'converted') <= (${t.orderId} is not null)`,
    ),
  ],
);

/**
 * A COD order's place in the confirmation queue (§3.5), made at its first
 * call, claim or SMS link. The link's code is kept only as a SHA-256 hash.
 */
export const orderConfirmations = store.table(
  'order_confirmations',
  {
    ...tenantColumns(),
    orderId: uuid().notNull(),
    /** Unanswered calls. */
    attempts: smallint().notNull().default(0),
    lastOutcome: text({ enum: CONFIRMATION_OUTCOMES }),
    lastNote: text(),
    /** When the order is due to be called again; null when it is due now. */
    dueAt: ts(),
    claimedBy: uuid(),
    claimedUntil: ts(),
    /** SHA-256 of the link's code, hex. */
    linkHash: text(),
    linkSends: smallint().notNull().default(0),
    linkSentAt: ts(),
    linkExpiresAt: ts(),
    linkAnswer: text({ enum: LINK_ANSWERS }),
    linkAnsweredAt: ts(),
    confirmedVia: text({ enum: CONFIRMED_VIA }),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.orderId] }),
    foreignKey({
      name: 'order_confirmations_order_fk',
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }).onDelete('restrict'),
    uniqueIndex('order_confirmations_link_unique')
      .on(t.tenantId, t.linkHash)
      .where(sql`link_hash is not null`),
    index('order_confirmations_due_idx').on(t.tenantId, t.dueAt),
    oneOf('order_confirmations_outcome_valid', t.lastOutcome, CONFIRMATION_OUTCOMES),
    oneOf('order_confirmations_via_valid', t.confirmedVia, CONFIRMED_VIA),
    oneOf('order_confirmations_answer_valid', t.linkAnswer, LINK_ANSWERS),
    check('order_confirmations_attempts_range', sql`${t.attempts} between 0 and 100`),
    check('order_confirmations_link_sends_range', sql`${t.linkSends} between 0 and 10`),
    check('order_confirmations_note_length', sql`char_length(${t.lastNote}) <= 500`),
    check('order_confirmations_link_hash_format', sql`${t.linkHash} ~ '^[0-9a-f]{64}$'`),
    check('order_confirmations_claim', sql`(${t.claimedBy} is null) = (${t.claimedUntil} is null)`),
  ],
);
