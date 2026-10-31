// Delivery zones, carts and orders (phase-4-plan §3.3–§3.9, §4): an order
// with its lines and snapshots, discounts allocated per line, history,
// notes, shipments and payments, including online ones (phase-5a-plan §3.2). Orders, payments and shipments are never
// soft-deleted (PLAN.md); history is append-only for the app.
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  inet,
  integer,
  jsonb,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { products, variants } from './catalog';
import { customers, shopperUsers } from './customers';
import { promotionCodes, promotions } from './promotions';
import { areas, districts } from './ref';
import { ACTOR_TYPES } from './store';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const CART_STATUSES = ['active', 'converted'] as const;
export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'processing',
  'completed',
  'cancelled',
] as const;
export const PAYMENT_STATUSES = [
  'unpaid',
  'partially_paid',
  'paid',
  'partially_refunded',
  'refunded',
] as const;
export const DELIVERY_STATUSES = [
  'not_shipped',
  'partially_shipped',
  'shipped',
  'delivered',
  'failed',
] as const;
export const RETURN_STATUSES = ['none', 'requested', 'partially_returned', 'returned'] as const;
export const ORDER_SOURCES = [
  'website',
  'facebook',
  'phone',
  'walk_in',
  'other',
  'exchange',
  'whatsapp',
  'messenger',
  'instagram',
] as const;
export const ORDER_FLAGS = [
  'payment_risk',
  'late_payment',
  'flagged_phone',
  'possible_duplicate',
  'unreachable',
  'cod_difference',
  'partial_delivery',
] as const;
export const CANCEL_CODES = [
  'shopper_request',
  'no_answer',
  'wrong_number',
  'fake',
  'duplicate',
  'out_of_stock',
  'payment_expired',
  'other',
] as const;
export const ADJUSTMENT_KINDS = ['promotion', 'manual'] as const;
export const ADJUSTMENT_TARGETS = ['items', 'order', 'delivery'] as const;
export const HISTORY_MACHINES = [
  'order',
  'payment',
  'delivery',
  'shipment',
  'edit',
  'return',
  'refund',
  'confirmation',
] as const;
export const SHIPMENT_STATUSES = [
  'pending',
  'booked',
  'shipped',
  'in_transit',
  'delivered',
  'failed',
  'returned',
] as const;
export const COURIERS = ['steadfast', 'pathao', 'redx', 'fake'] as const;
export const BOOKING_STATES = ['booking', 'unsure'] as const;
export const COURIER_UPDATES = [
  'booked',
  'picked_up',
  'in_transit',
  'on_hold',
  'delivered',
  'partial_delivered',
  'returning',
  'returned',
  'cancelled',
  'paid_out',
  'unknown',
] as const;
export const EVENT_SOURCES = ['booking', 'webhook', 'poll', 'staff'] as const;
export const PAYMENT_PROVIDERS = ['cod', 'manual', 'sslcommerz'] as const;
export const PAYMENT_METHODS = [
  'cod',
  'bkash',
  'nagad',
  'rocket',
  'bank',
  'cash',
  'other',
  'online',
] as const;
export const PAYMENT_RECORD_STATUSES = ['pending', 'paid', 'voided', 'failed', 'expired'] as const;

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const ts = () => timestamp({ withTimezone: true });
const createdAt = () => ts().notNull().defaultNow();
const updatedAt = () => ts().notNull().defaultNow();
const money = () => bigint({ mode: 'number' });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in (${inList(values)})`);
const tenantIdUnique = (table: string, t: { tenantId: AnyPgColumn; id: AnyPgColumn }) =>
  unique(`${table}_tenant_id_unique`).on(t.tenantId, t.id);
function ref(
  name: string,
  columns: [AnyPgColumn, ...AnyPgColumn[]],
  foreignColumns: [AnyPgColumn, ...AnyPgColumn[]],
  onDelete: 'cascade' | 'restrict' | 'set null' = 'cascade',
) {
  return foreignKey({ name, columns, foreignColumns }).onDelete(onDelete);
}

// ---- Delivery zones (§3.3) -------------------------------------------------------------

export const deliveryZones = store.table(
  'delivery_zones',
  {
    ...tenantColumns(),
    id: id(),
    /** { bn?, en? } */
    name: jsonb().notNull(),
    fee: money().notNull(),
    /** With fee_per_extra_kg: the weight the fee includes. */
    freeWeightGrams: integer(),
    /** Each extra kilogram or part of one. */
    feePerExtraKg: money(),
    /** { bn?, en? }: "1–2 days". */
    estimate: jsonb().notNull().default({}),
    /** "Everywhere else": the zone of any area no other zone covers. */
    isFallback: boolean().notNull().default(false),
    position: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('delivery_zones', t),
    uniqueIndex('delivery_zones_one_fallback').on(t.tenantId).where(sql`is_fallback`),
    index('delivery_zones_tenant_position_idx').on(t.tenantId, t.position),
    check(
      'delivery_zones_amounts',
      sql`${t.fee} >= 0 and coalesce(${t.feePerExtraKg}, 0) >= 0 and coalesce(${t.freeWeightGrams}, 0) >= 0`,
    ),
    check(
      'delivery_zones_weight_rule',
      sql`(${t.freeWeightGrams} is null) = (${t.feePerExtraKg} is null)`,
    ),
  ],
);

/** A zone covers districts or single areas; each at most once per store. */
export const deliveryZoneAreas = store.table(
  'delivery_zone_areas',
  {
    ...tenantColumns(),
    id: id(),
    zoneId: uuid().notNull(),
    districtId: smallint().references(() => districts.id),
    areaId: integer().references(() => areas.id),
  },
  (t) => [
    tenantPolicy(t),
    ref(
      'delivery_zone_areas_zone_fk',
      [t.tenantId, t.zoneId],
      [deliveryZones.tenantId, deliveryZones.id],
    ),
    index('delivery_zone_areas_zone_idx').on(t.tenantId, t.zoneId),
    uniqueIndex('delivery_zone_areas_district_unique')
      .on(t.tenantId, t.districtId)
      .where(sql`district_id is not null`),
    uniqueIndex('delivery_zone_areas_area_unique')
      .on(t.tenantId, t.areaId)
      .where(sql`area_id is not null`),
    check('delivery_zone_areas_one_place', sql`num_nonnulls(${t.districtId}, ${t.areaId}) = 1`),
  ],
);

// ---- Carts (§3.4) ------------------------------------------------------------------

export const carts = store.table(
  'carts',
  {
    ...tenantColumns(),
    id: id(),
    /** SHA-256 of the cookie's token, hex: a database leak hands out no carts. */
    tokenHash: text().notNull(),
    shopperUserId: uuid(),
    status: text({ enum: CART_STATUSES }).notNull().default('active'),
    orderId: uuid(),
    locale: text().notNull().default('bn'),
    /** The area chosen for delivery, so totals follow it. */
    areaId: integer().references(() => areas.id),
    /** The one code applied (§3.13). */
    code: text(),
    /** The shopper chose "Don't save": no incomplete order from this cart (phase-6-plan §3.2). */
    recoveryOptOut: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('carts', t),
    unique('carts_token_unique').on(t.tenantId, t.tokenHash),
    ref(
      'carts_shopper_fk',
      [t.tenantId, t.shopperUserId],
      [shopperUsers.tenantId, shopperUsers.id],
      'set null',
    ),
    index('carts_tenant_updated_idx').on(t.tenantId, t.updatedAt),
    index('carts_shopper_idx')
      .on(t.tenantId, t.shopperUserId)
      .where(sql`shopper_user_id is not null`),
    oneOf('carts_status_valid', t.status, CART_STATUSES),
    check('carts_locale_valid', sql`${t.locale} in ('bn', 'en')`),
    check('carts_token_hash_format', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check('carts_code_length', sql`char_length(${t.code}) between 1 and 32`),
  ],
);

export const cartLines = store.table(
  'cart_lines',
  {
    ...tenantColumns(),
    cartId: uuid().notNull(),
    variantId: uuid().notNull(),
    quantity: integer().notNull(),
    addedAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.cartId, t.variantId] }),
    ref('cart_lines_cart_fk', [t.tenantId, t.cartId], [carts.tenantId, carts.id]),
    ref('cart_lines_variant_fk', [t.tenantId, t.variantId], [variants.tenantId, variants.id]),
    index('cart_lines_variant_idx').on(t.tenantId, t.variantId),
    check('cart_lines_quantity_range', sql`${t.quantity} between 1 and 999`),
  ],
);

// ---- Counters ----------------------------------------------------------------------

/** Per-store sequences: `order_number` now, return numbers in Phase 5A. */
/** Per-store sequences: orders, returns, and the back office's documents (phase-8-plan §3.2). */
export const COUNTER_NAMES = [
  'order_number',
  'return_number',
  'purchase_order_number',
  'goods_receipt_number',
  'stock_count_number',
] as const;

export const counters = store.table(
  'counters',
  {
    ...tenantColumns(),
    name: text().notNull(),
    value: bigint({ mode: 'number' }).notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.name] }),
    check('counters_name_valid', sql`${t.name} in (${inList(COUNTER_NAMES)})`),
  ],
);

// ---- Orders (§3.6) -----------------------------------------------------------------

export const orders = store.table(
  'orders',
  {
    ...tenantColumns(),
    id: id(),
    number: bigint({ mode: 'number' }).notNull(),
    status: text({ enum: ORDER_STATUSES }).notNull().default('pending'),
    paymentStatus: text({ enum: PAYMENT_STATUSES }).notNull().default('unpaid'),
    deliveryStatus: text({ enum: DELIVERY_STATUSES }).notNull().default('not_shipped'),
    returnStatus: text({ enum: RETURN_STATUSES }).notNull().default('none'),
    source: text({ enum: ORDER_SOURCES }).notNull(),
    customerId: uuid().notNull(),
    shopperUserId: uuid(),
    /** The phone typed at checkout, E.164, for lookup and tracking. */
    phone: text().notNull(),
    /** { name, phone, email? } as typed (§3.10, Q15). */
    contact: jsonb().notNull(),
    /** { divisionId, districtId, areaId, line, names: { division, district, area } }; null for walk-ins. */
    address: jsonb(),
    zoneId: uuid(),
    zoneName: jsonb(),
    currency: text().notNull().default('BDT'),
    subtotal: money().notNull(),
    discountTotal: money().notNull().default(0),
    deliveryFee: money().notNull().default(0),
    deliveryDiscount: money().notNull().default(0),
    vatTotal: money().notNull().default(0),
    /** Prices included VAT: invoices show it as "of which VAT". */
    vatIncluded: boolean().notNull().default(true),
    rounding: money().notNull().default(0),
    total: money().notNull(),
    /** Settled payments. */
    paidTotal: money().notNull().default(0),
    /** Succeeded refunds (phase-5a-plan §3.13). */
    refundedTotal: money().notNull().default(0),
    /** For staff: payment_risk, late_payment, flagged_phone (§3.5, §3.11). */
    flags: text().array().notNull().default(sql`'{}'::text[]`),
    locale: text().notNull(),
    customerNote: text(),
    tags: text().array().notNull().default(sql`'{}'::text[]`),
    metadata: jsonb().notNull().default({}),
    /** For the blocklist and Phase 6; cleared after 90 days. */
    ip: inet(),
    userAgent: text(),
    /**
     * Ad attribution with the shopper's consent (phase-9-plan §3.1.6): { fbp?, fbc?,
     * utm?, cartOrigin?, consentedAt }. Null without consent; cleared after 30 days.
     */
    attribution: jsonb(),
    /** Staff who entered a manual order. */
    createdBy: uuid(),
    placedAt: ts().notNull().defaultNow(),
    confirmedAt: ts(),
    completedAt: ts(),
    cancelledAt: ts(),
    cancelReason: text(),
    cancelledBy: text({ enum: ACTOR_TYPES }),
    /** Why, as a code (phase-6-plan §3.5); null on older orders, which count as other. */
    cancelCode: text({ enum: CANCEL_CODES }),
    /** The phone's delivery success score at placement; null for a new phone (§3.3). */
    phoneScore: smallint(),
    /** The earlier order this one may duplicate (§3.4). */
    duplicateOf: uuid(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('orders', t),
    unique('orders_number_unique').on(t.tenantId, t.number),
    ref(
      'orders_customer_fk',
      [t.tenantId, t.customerId],
      [customers.tenantId, customers.id],
      'restrict',
    ),
    ref(
      'orders_shopper_fk',
      [t.tenantId, t.shopperUserId],
      [shopperUsers.tenantId, shopperUsers.id],
      'set null',
    ),
    ref(
      'orders_zone_fk',
      [t.tenantId, t.zoneId],
      [deliveryZones.tenantId, deliveryZones.id],
      'set null',
    ),
    ref('orders_duplicate_of_fk', [t.tenantId, t.duplicateOf], [t.tenantId, t.id], 'set null'),
    index('orders_tenant_placed_idx').on(t.tenantId, sql`placed_at desc`),
    index('orders_tenant_status_idx').on(t.tenantId, t.status, sql`placed_at desc`),
    index('orders_tenant_delivery_idx').on(t.tenantId, t.deliveryStatus, sql`placed_at desc`),
    index('orders_tenant_customer_idx').on(t.tenantId, t.customerId, sql`placed_at desc`),
    index('orders_tenant_phone_idx').on(t.tenantId, t.phone, sql`placed_at desc`),
    index('orders_shopper_idx')
      .on(t.tenantId, t.shopperUserId, sql`placed_at desc`)
      .where(sql`shopper_user_id is not null`),
    index('orders_tags_idx').using('gin', t.tenantId, t.tags),
    oneOf('orders_status_valid', t.status, ORDER_STATUSES),
    oneOf('orders_payment_status_valid', t.paymentStatus, PAYMENT_STATUSES),
    oneOf('orders_delivery_status_valid', t.deliveryStatus, DELIVERY_STATUSES),
    oneOf('orders_return_status_valid', t.returnStatus, RETURN_STATUSES),
    oneOf('orders_source_valid', t.source, ORDER_SOURCES),
    oneOf('orders_cancelled_by_valid', t.cancelledBy, ACTOR_TYPES),
    oneOf('orders_cancel_code_valid', t.cancelCode, CANCEL_CODES),
    check('orders_phone_score_range', sql`${t.phoneScore} between 0 and 100`),
    check('orders_duplicate_of_other', sql`${t.duplicateOf} <> ${t.id}`),
    check('orders_number_positive', sql`${t.number} > 0`),
    check('orders_attribution_size', sql`octet_length(${t.attribution}::text) <= 2000`),
    check('orders_locale_valid', sql`${t.locale} in ('bn', 'en')`),
    check(
      'orders_amounts_non_negative',
      sql`${t.subtotal} >= 0 and ${t.discountTotal} >= 0 and ${t.deliveryFee} >= 0 and ${t.deliveryDiscount} >= 0
        and ${t.vatTotal} >= 0 and ${t.total} >= 0 and ${t.paidTotal} >= 0
        and ${t.discountTotal} <= ${t.subtotal} and ${t.deliveryDiscount} <= ${t.deliveryFee}`,
    ),
    check(
      'orders_refunded_within_paid',
      sql`${t.refundedTotal} >= 0 and ${t.refundedTotal} <= ${t.paidTotal}`,
    ),
    check('orders_flags_valid', sql`${t.flags} <@ array[${inList(ORDER_FLAGS)}]::text[]`),
    check('orders_customer_note_length', sql`char_length(${t.customerNote}) <= 500`),
    check('orders_cancel_reason_length', sql`char_length(${t.cancelReason}) <= 300`),
    check('orders_tags_count', sql`cardinality(${t.tags}) <= 20`),
  ],
);

export const orderLines = store.table(
  'order_lines',
  {
    ...tenantColumns(),
    id: id(),
    orderId: uuid().notNull(),
    variantId: uuid().notNull(),
    productId: uuid().notNull(),
    // Snapshots, frozen at placement (§3.6).
    /** { bn?, en? } */
    title: jsonb().notNull(),
    /** [{ bn?, en? }], in option order. */
    optionLabels: jsonb().notNull().default([]),
    sku: text(),
    /** The image's file name and size, as the catalog served it. */
    image: jsonb(),
    unitPrice: money().notNull(),
    compareAtPrice: money(),
    /** For Phase 8's profit reports; shown only with catalog.cost. */
    costPrice: money(),
    weightGrams: integer(),
    vatCategory: text(),
    vatRateBp: integer().notNull().default(0),
    quantity: integer().notNull(),
    lineSubtotal: money().notNull(),
    discountTotal: money().notNull().default(0),
    vatAmount: money().notNull().default(0),
    lineTotal: money().notNull(),
    shippedQuantity: integer().notNull().default(0),
    position: smallint().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('order_lines', t),
    ref('order_lines_order_fk', [t.tenantId, t.orderId], [orders.tenantId, orders.id]),
    // An ordered variant can't be deleted; the catalog archives it instead.
    ref(
      'order_lines_variant_fk',
      [t.tenantId, t.variantId],
      [variants.tenantId, variants.id],
      'restrict',
    ),
    ref(
      'order_lines_product_fk',
      [t.tenantId, t.productId],
      [products.tenantId, products.id],
      'restrict',
    ),
    index('order_lines_order_idx').on(t.tenantId, t.orderId, t.position),
    index('order_lines_variant_idx').on(t.tenantId, t.variantId),
    check('order_lines_quantity_positive', sql`${t.quantity} > 0`),
    check('order_lines_shipped_range', sql`${t.shippedQuantity} between 0 and ${t.quantity}`),
    check(
      'order_lines_amounts',
      sql`${t.unitPrice} >= 0 and ${t.lineSubtotal} >= 0 and ${t.discountTotal} between 0 and ${t.lineSubtotal}
        and ${t.vatAmount} >= 0 and ${t.lineTotal} >= 0 and ${t.vatRateBp} between 0 and 10000`,
    ),
  ],
);

export const orderAdjustments = store.table(
  'order_adjustments',
  {
    ...tenantColumns(),
    id: id(),
    orderId: uuid().notNull(),
    kind: text({ enum: ADJUSTMENT_KINDS }).notNull(),
    target: text({ enum: ADJUSTMENT_TARGETS }).notNull(),
    promotionId: uuid(),
    /** The code typed, and its row, so a cancellation gives the use back. */
    code: text(),
    codeId: uuid(),
    /** { bn?, en? }: the promotion's title, or the manual discount's label. */
    title: jsonb().notNull(),
    amount: money().notNull(),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('order_adjustments', t),
    ref('order_adjustments_order_fk', [t.tenantId, t.orderId], [orders.tenantId, orders.id]),
    ref(
      'order_adjustments_promotion_fk',
      [t.tenantId, t.promotionId],
      [promotions.tenantId, promotions.id],
      'restrict',
    ),
    ref(
      'order_adjustments_code_fk',
      [t.tenantId, t.codeId],
      [promotionCodes.tenantId, promotionCodes.id],
      'restrict',
    ),
    index('order_adjustments_order_idx').on(t.tenantId, t.orderId),
    index('order_adjustments_promotion_idx')
      .on(t.tenantId, t.promotionId)
      .where(sql`promotion_id is not null`),
    oneOf('order_adjustments_kind_valid', t.kind, ADJUSTMENT_KINDS),
    oneOf('order_adjustments_target_valid', t.target, ADJUSTMENT_TARGETS),
    check('order_adjustments_amount_positive', sql`${t.amount} > 0`),
    check(
      'order_adjustments_promotion_kind',
      sql`(${t.kind} = 'promotion') = (${t.promotionId} is not null)`,
    ),
  ],
);

/** Each line's share of each adjustment (§3.1), so a return refunds exactly what was paid. */
export const orderLineAdjustments = store.table(
  'order_line_adjustments',
  {
    ...tenantColumns(),
    orderLineId: uuid().notNull(),
    adjustmentId: uuid().notNull(),
    amount: money().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.orderLineId, t.adjustmentId] }),
    ref(
      'order_line_adjustments_line_fk',
      [t.tenantId, t.orderLineId],
      [orderLines.tenantId, orderLines.id],
    ),
    ref(
      'order_line_adjustments_adjustment_fk',
      [t.tenantId, t.adjustmentId],
      [orderAdjustments.tenantId, orderAdjustments.id],
    ),
    index('order_line_adjustments_adjustment_idx').on(t.tenantId, t.adjustmentId),
    check('order_line_adjustments_amount_positive', sql`${t.amount} > 0`),
  ],
);

/** Every status change and edit, with who and why: append-only for the app. */
export const orderHistory = store.table(
  'order_history',
  {
    ...tenantColumns(),
    id: id(),
    orderId: uuid().notNull(),
    machine: text({ enum: HISTORY_MACHINES }).notNull(),
    fromStatus: text(),
    toStatus: text(),
    event: text().notNull(),
    actorType: text({ enum: ACTOR_TYPES }).notNull(),
    actorId: uuid(),
    reason: text(),
    data: jsonb(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    ref(
      'order_history_order_fk',
      [t.tenantId, t.orderId],
      [orders.tenantId, orders.id],
      'restrict',
    ),
    index('order_history_order_idx').on(t.tenantId, t.orderId, t.createdAt),
    oneOf('order_history_machine_valid', t.machine, HISTORY_MACHINES),
    oneOf('order_history_actor_type_valid', t.actorType, ACTOR_TYPES),
    check('order_history_event_length', sql`char_length(${t.event}) between 1 and 50`),
    check('order_history_reason_length', sql`char_length(${t.reason}) <= 300`),
  ],
);

/** Internal notes: never shown to the shopper. */
export const orderNotes = store.table(
  'order_notes',
  {
    ...tenantColumns(),
    id: id(),
    orderId: uuid().notNull(),
    authorId: uuid(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    ref('order_notes_order_fk', [t.tenantId, t.orderId], [orders.tenantId, orders.id], 'restrict'),
    index('order_notes_order_idx').on(t.tenantId, t.orderId, t.createdAt),
    check('order_notes_body_length', sql`char_length(${t.body}) between 1 and 2000`),
  ],
);

// ---- Shipments (§3.7) --------------------------------------------------------------

export const shipments = store.table(
  'shipments',
  {
    ...tenantColumns(),
    id: id(),
    orderId: uuid().notNull(),
    status: text({ enum: SHIPMENT_STATUSES }).notNull().default('pending'),
    /** The carrier's name: free text for a manual shipment, the courier's name for a booked one. */
    carrier: text(),
    trackingNumber: text(),
    trackingUrl: text(),
    shippedAt: ts(),
    deliveredAt: ts(),
    failedAt: ts(),
    failedReason: text(),
    returnedAt: ts(),
    /** What the failed delivery cost the store (phase-5a-plan §3.11). */
    returnCost: money(),
    metadata: jsonb().notNull().default({}),
    // A courier's parcel (phase-7-plan §3.1, §4); all null for a manual shipment.
    courier: text({ enum: COURIERS }),
    /** Our invoice for the parcel, unique per store and courier. */
    courierRef: text(),
    consignmentId: text(),
    trackingCode: text(),
    /** The courier's own latest status and message, as it said them. */
    courierStatus: text(),
    courierStatusAt: ts(),
    courierMessage: text(),
    bookingState: text({ enum: BOOKING_STATES }),
    bookingError: text(),
    bookedAt: ts(),
    inTransitAt: ts(),
    /** The courier says the parcel came back; staff confirm it arrived (§3.5, Q9). */
    courierReturnedAt: ts(),
    lastSyncedAt: ts(),
    /** What the courier was asked to collect, and what it says it collected. */
    codAmount: money(),
    codCollected: money(),
    /** Delivery plus the COD charge, and the return charge, as the courier gives them. */
    courierFee: money(),
    returnCharge: money(),
    /** The courier's area IDs and names used for the booking. */
    courierArea: jsonb(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('shipments', t),
    oneOf('shipments_courier_valid', t.courier, COURIERS),
    oneOf('shipments_booking_state_valid', t.bookingState, BOOKING_STATES),
    uniqueIndex('shipments_courier_ref_unique')
      .on(t.tenantId, t.courier, t.courierRef)
      .where(sql`courier_ref is not null`),
    uniqueIndex('shipments_consignment_unique')
      .on(t.tenantId, t.courier, t.consignmentId)
      .where(sql`consignment_id is not null`),
    index('shipments_courier_open_idx')
      .on(t.lastSyncedAt)
      .where(sql`courier is not null and status in ('booked', 'shipped', 'in_transit', 'failed')`),
    check(
      'shipments_courier_fields',
      sql`${t.courier} is not null or (${t.courierRef} is null and ${t.consignmentId} is null and ${t.bookingState} is null)`,
    ),
    check('shipments_courier_ref_length', sql`char_length(${t.courierRef}) <= 60`),
    check('shipments_consignment_length', sql`char_length(${t.consignmentId}) <= 100`),
    check('shipments_tracking_code_length', sql`char_length(${t.trackingCode}) <= 100`),
    check('shipments_courier_status_length', sql`char_length(${t.courierStatus}) <= 60`),
    check('shipments_courier_message_length', sql`char_length(${t.courierMessage}) <= 500`),
    check('shipments_booking_error_length', sql`char_length(${t.bookingError}) <= 300`),
    check(
      'shipments_courier_money',
      sql`coalesce(${t.codAmount}, 0) >= 0 and coalesce(${t.codCollected}, 0) >= 0
          and coalesce(${t.courierFee}, 0) >= 0 and coalesce(${t.returnCharge}, 0) >= 0`,
    ),
    check('shipments_courier_area_size', sql`octet_length(${t.courierArea}::text) <= 1000`),
    ref('shipments_order_fk', [t.tenantId, t.orderId], [orders.tenantId, orders.id], 'restrict'),
    index('shipments_order_idx').on(t.tenantId, t.orderId),
    index('shipments_tenant_status_idx').on(t.tenantId, t.status),
    oneOf('shipments_status_valid', t.status, SHIPMENT_STATUSES),
    check('shipments_carrier_length', sql`char_length(${t.carrier}) <= 60`),
    check('shipments_return_cost_non_negative', sql`${t.returnCost} >= 0`),
    check('shipments_tracking_number_length', sql`char_length(${t.trackingNumber}) <= 100`),
    check(
      'shipments_tracking_url_format',
      sql`char_length(${t.trackingUrl}) <= 500 and ${t.trackingUrl} ~ '^https?://'`,
    ),
    check('shipments_failed_reason_length', sql`char_length(${t.failedReason}) <= 300`),
  ],
);

export const shipmentLines = store.table(
  'shipment_lines',
  {
    ...tenantColumns(),
    shipmentId: uuid().notNull(),
    orderLineId: uuid().notNull(),
    quantity: integer().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.shipmentId, t.orderLineId] }),
    ref(
      'shipment_lines_shipment_fk',
      [t.tenantId, t.shipmentId],
      [shipments.tenantId, shipments.id],
    ),
    ref(
      'shipment_lines_line_fk',
      [t.tenantId, t.orderLineId],
      [orderLines.tenantId, orderLines.id],
      'restrict',
    ),
    index('shipment_lines_line_idx').on(t.tenantId, t.orderLineId),
    check('shipment_lines_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

// ---- Payments (§3.8) ---------------------------------------------------------------

export const payments = store.table(
  'payments',
  {
    ...tenantColumns(),
    id: id(),
    orderId: uuid().notNull(),
    provider: text({ enum: PAYMENT_PROVIDERS }).notNull(),
    method: text({ enum: PAYMENT_METHODS }).notNull(),
    status: text({ enum: PAYMENT_RECORD_STATUSES }).notNull().default('pending'),
    amount: money().notNull(),
    reference: text(),
    recordedBy: uuid(),
    settledAt: ts(),
    voidedAt: ts(),
    // SSLCommerz (phase-5a-plan §3.2): our tran_id is the payment's ID.
    gatewayValId: text(),
    gatewayBankTranId: text(),
    /** SSLCommerz's risk_level: 1 is risky. */
    riskLevel: smallint(),
    metadata: jsonb().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('payments', t),
    // A validation replayed, from the IPN, the return page or the delayed check, settles once.
    uniqueIndex('payments_gateway_val_id_unique')
      .on(t.tenantId, t.provider, t.gatewayValId)
      .where(sql`gateway_val_id is not null`),
    ref('payments_order_fk', [t.tenantId, t.orderId], [orders.tenantId, orders.id], 'restrict'),
    index('payments_order_idx').on(t.tenantId, t.orderId),
    oneOf('payments_provider_valid', t.provider, PAYMENT_PROVIDERS),
    oneOf('payments_method_valid', t.method, PAYMENT_METHODS),
    oneOf('payments_status_valid', t.status, PAYMENT_RECORD_STATUSES),
    check('payments_amount_non_negative', sql`${t.amount} >= 0`),
    check('payments_reference_length', sql`char_length(${t.reference}) <= 100`),
    check('payments_cod_method', sql`(${t.provider} = 'cod') = (${t.method} = 'cod')`),
    check('payments_online_method', sql`(${t.provider} = 'sslcommerz') = (${t.method} = 'online')`),
    check(
      'payments_gateway_fields_length',
      sql`char_length(${t.gatewayValId}) <= 100 and char_length(${t.gatewayBankTranId}) <= 100`,
    ),
  ],
);
