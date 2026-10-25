// Returns and refunds (phase-5a-plan §3.12, §3.13): a return covers lines of
// one order and restocks by inspected condition; a refund pays back part of
// what was paid, by the gateway, by hand or as store credit, with its share
// per order line so later returns refund exactly the rest.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { orderLines, orders, payments } from './orders';
import { promotionCodes } from './promotions';
import { ACTOR_TYPES } from './store';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const RETURN_RECORD_STATUSES = [
  'requested',
  'approved',
  'rejected',
  'in_transit',
  'received',
  'inspected',
  'resolved',
] as const;
export const RETURN_REASONS = [
  'wrong_size',
  'damaged',
  'wrong_item',
  'not_as_described',
  'changed_mind',
  'other',
  'refused_at_door',
] as const;
export const RETURN_RESOLUTIONS = ['refunded', 'exchanged', 'store_credit', 'rejected'] as const;
export const REFUND_METHODS = [
  'gateway',
  'gateway_manual',
  'bkash',
  'nagad',
  'rocket',
  'bank',
  'cash',
  'store_credit',
] as const;
export const REFUND_STATUSES = ['pending', 'processing', 'succeeded', 'failed'] as const;

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const ts = () => timestamp({ withTimezone: true });
const money = () => bigint({ mode: 'number' });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in (${inList(values)})`);
const ref = (
  name: string,
  columns: [AnyPgColumn, ...AnyPgColumn[]],
  foreignColumns: [AnyPgColumn, ...AnyPgColumn[]],
  onDelete: 'cascade' | 'restrict' = 'cascade',
) => foreignKey({ name, columns, foreignColumns }).onDelete(onDelete);

export const returns = store.table(
  'returns',
  {
    ...tenantColumns(),
    id: id(),
    /** From the store's `return_number` counter: R1001. */
    number: bigint({ mode: 'number' }).notNull(),
    orderId: uuid().notNull(),
    status: text({ enum: RETURN_RECORD_STATUSES }).notNull().default('requested'),
    reason: text({ enum: RETURN_REASONS }).notNull(),
    /** What the shopper wrote, or staff's note when they create it. */
    note: text(),
    requestedBy: text({ enum: ACTOR_TYPES }).notNull(),
    /** The staff user who created it, when staff did. */
    createdBy: uuid(),
    /** From the policy when the return is approved (Q9); staff can change it. */
    shopperPaysReturn: boolean(),
    resolution: text({ enum: RETURN_RESOLUTIONS }),
    rejectReason: text(),
    /** The replacement order, for an exchange. */
    exchangeOrderId: uuid(),
    /** For an exchange: the credit taken off the replacement order; only the rest can be refunded. */
    exchangeCredit: money(),
    approvedAt: ts(),
    receivedAt: ts(),
    inspectedAt: ts(),
    resolvedAt: ts(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('returns_tenant_id_unique').on(t.tenantId, t.id),
    unique('returns_number_unique').on(t.tenantId, t.number),
    ref('returns_order_fk', [t.tenantId, t.orderId], [orders.tenantId, orders.id], 'restrict'),
    ref(
      'returns_exchange_order_fk',
      [t.tenantId, t.exchangeOrderId],
      [orders.tenantId, orders.id],
      'restrict',
    ),
    index('returns_order_idx').on(t.tenantId, t.orderId),
    index('returns_tenant_status_idx').on(t.tenantId, t.status, sql`created_at desc`),
    oneOf('returns_status_valid', t.status, RETURN_RECORD_STATUSES),
    oneOf('returns_reason_valid', t.reason, RETURN_REASONS),
    oneOf('returns_requested_by_valid', t.requestedBy, ACTOR_TYPES),
    oneOf('returns_resolution_valid', t.resolution, RETURN_RESOLUTIONS),
    check('returns_number_positive', sql`${t.number} > 0`),
    check('returns_note_length', sql`char_length(${t.note}) <= 500`),
    check('returns_reject_reason_length', sql`char_length(${t.rejectReason}) <= 300`),
    check('returns_resolved', sql`(${t.status} = 'resolved') = (${t.resolution} is not null)`),
  ],
);

export const returnLines = store.table(
  'return_lines',
  {
    ...tenantColumns(),
    returnId: uuid().notNull(),
    orderLineId: uuid().notNull(),
    quantity: integer().notNull(),
    /** This line's reason, when it differs from the return's. */
    reason: text({ enum: RETURN_REASONS }),
    // After inspection (§3.12): sellable units go back to stock, damaged ones are written off.
    restocked: integer().notNull().default(0),
    writtenOff: integer().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.returnId, t.orderLineId] }),
    ref('return_lines_return_fk', [t.tenantId, t.returnId], [returns.tenantId, returns.id]),
    ref(
      'return_lines_line_fk',
      [t.tenantId, t.orderLineId],
      [orderLines.tenantId, orderLines.id],
      'restrict',
    ),
    index('return_lines_line_idx').on(t.tenantId, t.orderLineId),
    oneOf('return_lines_reason_valid', t.reason, RETURN_REASONS),
    check(
      'return_lines_quantities',
      sql`${t.quantity} > 0 and ${t.restocked} >= 0 and ${t.writtenOff} >= 0
        and ${t.restocked} + ${t.writtenOff} <= ${t.quantity}`,
    ),
  ],
);

/** Up to 3 per return, in R2 under the store's `returns/` prefix; staff only. */
export const returnPhotos = store.table(
  'return_photos',
  {
    ...tenantColumns(),
    id: id(),
    returnId: uuid().notNull(),
    /** The R2 key, `<tenant>/returns/<sha256>.<ext>`. */
    objectKey: text().notNull(),
    mimeType: text().notNull(),
    bytes: integer().notNull(),
    createdAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    ref('return_photos_return_fk', [t.tenantId, t.returnId], [returns.tenantId, returns.id]),
    index('return_photos_return_idx').on(t.tenantId, t.returnId),
    check(
      'return_photos_mime_valid',
      sql`${t.mimeType} in ('image/jpeg', 'image/png', 'image/webp')`,
    ),
    check('return_photos_bytes', sql`${t.bytes} between 1 and 2097152`),
    check('return_photos_key_length', sql`char_length(${t.objectKey}) <= 200`),
  ],
);

export const refunds = store.table(
  'refunds',
  {
    ...tenantColumns(),
    id: id(),
    orderId: uuid().notNull(),
    /** The return it comes from; none for an edit that left the order overpaid. */
    returnId: uuid(),
    /** The payment refunded, for gateway refunds. */
    paymentId: uuid(),
    method: text({ enum: REFUND_METHODS }).notNull(),
    status: text({ enum: REFUND_STATUSES }).notNull().default('pending'),
    amount: money().notNull(),
    /** The part of the amount that refunds the delivery fee (Q10). */
    deliveryAmount: money().notNull().default(0),
    /** The bKash or bank transaction, or the gateway panel's reference. */
    reference: text(),
    /** Why staff lowered the computed amount, when they did. */
    reason: text(),
    /** SSLCommerz's refund_ref_id, polled while processing. */
    gatewayRefundRef: text(),
    gatewayError: text(),
    /** The store credit code issued, for `store_credit`. */
    creditCodeId: uuid(),
    recordedBy: uuid(),
    processedAt: ts(),
    createdAt: ts().notNull().defaultNow(),
    updatedAt: ts().notNull().defaultNow(),
  },
  (t) => [
    tenantPolicy(t),
    unique('refunds_tenant_id_unique').on(t.tenantId, t.id),
    ref('refunds_order_fk', [t.tenantId, t.orderId], [orders.tenantId, orders.id], 'restrict'),
    ref('refunds_return_fk', [t.tenantId, t.returnId], [returns.tenantId, returns.id], 'restrict'),
    ref(
      'refunds_payment_fk',
      [t.tenantId, t.paymentId],
      [payments.tenantId, payments.id],
      'restrict',
    ),
    ref(
      'refunds_credit_code_fk',
      [t.tenantId, t.creditCodeId],
      [promotionCodes.tenantId, promotionCodes.id],
      'restrict',
    ),
    index('refunds_order_idx').on(t.tenantId, t.orderId),
    index('refunds_processing_idx').on(t.tenantId).where(sql`status = 'processing'`),
    oneOf('refunds_method_valid', t.method, REFUND_METHODS),
    oneOf('refunds_status_valid', t.status, REFUND_STATUSES),
    check(
      'refunds_amounts',
      sql`${t.amount} > 0 and ${t.deliveryAmount} >= 0 and ${t.deliveryAmount} <= ${t.amount}`,
    ),
    check(
      'refunds_gateway_payment',
      sql`(${t.method} in ('gateway', 'gateway_manual')) = (${t.paymentId} is not null)`,
    ),
    check('refunds_reference_length', sql`char_length(${t.reference}) <= 100`),
    check('refunds_reason_length', sql`char_length(${t.reason}) <= 300`),
    check(
      'refunds_gateway_text_length',
      sql`char_length(${t.gatewayRefundRef}) <= 100 and char_length(${t.gatewayError}) <= 300`,
    ),
  ],
);

export const refundLines = store.table(
  'refund_lines',
  {
    ...tenantColumns(),
    refundId: uuid().notNull(),
    orderLineId: uuid().notNull(),
    quantity: integer().notNull(),
    /** This line's share (§3.13), from refundShare. */
    amount: money().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.refundId, t.orderLineId] }),
    ref('refund_lines_refund_fk', [t.tenantId, t.refundId], [refunds.tenantId, refunds.id]),
    ref(
      'refund_lines_line_fk',
      [t.tenantId, t.orderLineId],
      [orderLines.tenantId, orderLines.id],
      'restrict',
    ),
    index('refund_lines_line_idx').on(t.tenantId, t.orderLineId),
    check('refund_lines_quantities', sql`${t.quantity} > 0 and ${t.amount} >= 0`),
  ],
);
