// The back office (phase-8-plan §4): suppliers, purchase orders, goods
// receipts and supplier payments; each variant's cost history; stock counts;
// expenses with categories and recurring entries; and the reports' summary
// tables, which only the nightly refresh writes (§3.9).
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
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
import { stockLocations } from './inventory';
import { ACTOR_TYPES } from './store';
import { store, tenantColumns, tenantPolicy } from './tenant-table';

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export const STOCK_COUNT_STATUSES = [
  'counting',
  'review',
  'applying',
  'applied',
  'cancelled',
] as const;
export const SPEND_METHODS = ['cash', 'bank', 'bkash', 'nagad', 'card', 'other'] as const;
export const COST_SOURCES = ['receipt', 'return', 'manual', 'import'] as const;
export const EXPENSE_CADENCES = ['monthly', 'weekly'] as const;

const id = () => uuid().primaryKey().default(sql`uuidv7()`);
const ts = () => timestamp({ withTimezone: true });
const createdAt = () => ts().notNull().defaultNow();
const updatedAt = () => ts().notNull().defaultNow();
const money = () => bigint({ mode: 'number' });
const day = () => date({ mode: 'string' });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const oneOf = (name: string, column: AnyPgColumn, values: readonly string[]) =>
  check(name, sql`${column} in (${inList(values)})`);
const tenantIdUnique = (table: string, t: { tenantId: AnyPgColumn; id: AnyPgColumn }) =>
  unique(`${table}_tenant_id_unique`).on(t.tenantId, t.id);
const maxLength = (name: string, column: AnyPgColumn, max: number) =>
  check(name, sql`char_length(${column}) <= ${sql.raw(String(max))}`);
function ref(
  name: string,
  columns: [AnyPgColumn, ...AnyPgColumn[]],
  foreignColumns: [AnyPgColumn, ...AnyPgColumn[]],
  onDelete: 'cascade' | 'restrict' = 'cascade',
) {
  return foreignKey({ name, columns, foreignColumns }).onDelete(onDelete);
}
/** Other costs: `[{ label, amount }]`, at most 10 (§3.2). */
const otherCostsCheck = (name: string, column: AnyPgColumn) =>
  check(
    name,
    sql`jsonb_typeof(${column}) = 'array' and jsonb_array_length(${column}) <= 10 and octet_length(${column}::text) <= 2000`,
  );

// ---- Suppliers (§3.1) ------------------------------------------------------------------

export const suppliers = store.table(
  'suppliers',
  {
    ...tenantColumns(),
    id: id(),
    name: text().notNull(),
    contactName: text(),
    /** E.164, normalized as shoppers' are. */
    phones: text().array().notNull().default(sql`'{}'::text[]`),
    email: text(),
    /** { line1, line2?, city? } */
    address: jsonb(),
    note: text(),
    /** What the store owed on the day it started here; negative is an advance. */
    openingBalance: money().notNull().default(0),
    archivedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('suppliers', t),
    index('suppliers_name_trgm_idx').using(
      'gin',
      t.tenantId,
      sql`app.search_text(${t.name}) gin_trgm_ops`,
    ),
    check('suppliers_name_length', sql`char_length(${t.name}) between 1 and 200`),
    maxLength('suppliers_contact_name_length', t.contactName, 200),
    check('suppliers_phones_count', sql`cardinality(${t.phones}) <= 3`),
    maxLength('suppliers_email_length', t.email, 254),
    check('suppliers_address_size', sql`octet_length(${t.address}::text) <= 1000`),
    maxLength('suppliers_note_length', t.note, 1000),
  ],
);

// ---- Purchase orders (§3.2) ------------------------------------------------------------

export const purchaseOrders = store.table(
  'purchase_orders',
  {
    ...tenantColumns(),
    id: id(),
    number: integer().notNull(),
    supplierId: uuid().notNull(),
    locationId: uuid().notNull(),
    status: text({ enum: PURCHASE_ORDER_STATUSES }).notNull().default('draft'),
    expectedOn: day(),
    /** The supplier's own reference for the order. */
    supplierRef: text(),
    note: text(),
    /** Transport, labour, an agent's fee: `[{ label, amount }]`. */
    otherCosts: jsonb().notNull().default([]),
    subtotal: money().notNull().default(0),
    otherCostTotal: money().notNull().default(0),
    total: money().notNull().default(0),
    placedAt: ts(),
    closedAt: ts(),
    cancelledAt: ts(),
    createdBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('purchase_orders', t),
    uniqueIndex('purchase_orders_number_unique').on(t.tenantId, t.number),
    index('purchase_orders_status_idx').on(t.tenantId, t.status, sql`created_at desc`),
    index('purchase_orders_supplier_idx').on(t.tenantId, t.supplierId),
    ref(
      'purchase_orders_supplier_fk',
      [t.tenantId, t.supplierId],
      [suppliers.tenantId, suppliers.id],
      'restrict',
    ),
    ref(
      'purchase_orders_location_fk',
      [t.tenantId, t.locationId],
      [stockLocations.tenantId, stockLocations.id],
      'restrict',
    ),
    oneOf('purchase_orders_status_valid', t.status, PURCHASE_ORDER_STATUSES),
    check('purchase_orders_number_positive', sql`${t.number} > 0`),
    maxLength('purchase_orders_supplier_ref_length', t.supplierRef, 100),
    maxLength('purchase_orders_note_length', t.note, 1000),
    otherCostsCheck('purchase_orders_other_costs_valid', t.otherCosts),
    check(
      'purchase_orders_money',
      sql`${t.subtotal} >= 0 and ${t.otherCostTotal} >= 0 and ${t.total} = ${t.subtotal} + ${t.otherCostTotal}`,
    ),
  ],
);

export const purchaseOrderLines = store.table(
  'purchase_order_lines',
  {
    ...tenantColumns(),
    id: id(),
    purchaseOrderId: uuid().notNull(),
    variantId: uuid().notNull(),
    quantity: integer().notNull(),
    unitCost: money().notNull(),
    receivedQuantity: integer().notNull().default(0),
    position: smallint().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('purchase_order_lines', t),
    uniqueIndex('purchase_order_lines_variant_unique').on(
      t.tenantId,
      t.purchaseOrderId,
      t.variantId,
    ),
    ref(
      'purchase_order_lines_order_fk',
      [t.tenantId, t.purchaseOrderId],
      [purchaseOrders.tenantId, purchaseOrders.id],
    ),
    ref(
      'purchase_order_lines_variant_fk',
      [t.tenantId, t.variantId],
      [variants.tenantId, variants.id],
      'restrict',
    ),
    index('purchase_order_lines_variant_idx').on(t.tenantId, t.variantId),
    check('purchase_order_lines_quantity', sql`${t.quantity} > 0 and ${t.receivedQuantity} >= 0`),
    check('purchase_order_lines_cost', sql`${t.unitCost} >= 0`),
  ],
);

// ---- Goods receipts (§3.3) -------------------------------------------------------------

/** A delivery received: with a PO or without (a market purchase, Q5). Never edited. */
export const goodsReceipts = store.table(
  'goods_receipts',
  {
    ...tenantColumns(),
    id: id(),
    number: integer().notNull(),
    supplierId: uuid(),
    purchaseOrderId: uuid(),
    locationId: uuid().notNull(),
    /** The Dhaka day it arrived. */
    receivedOn: day().notNull(),
    supplierInvoice: text(),
    /** This delivery's own costs, on top of its share of the PO's. */
    otherCosts: jsonb().notNull().default([]),
    /** The goods at their entered costs. */
    subtotal: money().notNull(),
    /** Its share of the PO's other costs, plus its own. */
    otherCostTotal: money().notNull().default(0),
    /** Landed: what the supplier is owed for it (§3.7). */
    total: money().notNull(),
    note: text(),
    receivedBy: uuid(),
    idempotencyKey: text(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('goods_receipts', t),
    uniqueIndex('goods_receipts_number_unique').on(t.tenantId, t.number),
    uniqueIndex('goods_receipts_idempotency_unique')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`idempotency_key is not null`),
    index('goods_receipts_supplier_idx').on(t.tenantId, t.supplierId, t.receivedOn),
    index('goods_receipts_order_idx')
      .on(t.tenantId, t.purchaseOrderId)
      .where(sql`purchase_order_id is not null`),
    index('goods_receipts_received_idx').on(t.tenantId, sql`received_on desc`),
    ref(
      'goods_receipts_supplier_fk',
      [t.tenantId, t.supplierId],
      [suppliers.tenantId, suppliers.id],
      'restrict',
    ),
    ref(
      'goods_receipts_order_fk',
      [t.tenantId, t.purchaseOrderId],
      [purchaseOrders.tenantId, purchaseOrders.id],
      'restrict',
    ),
    ref(
      'goods_receipts_location_fk',
      [t.tenantId, t.locationId],
      [stockLocations.tenantId, stockLocations.id],
      'restrict',
    ),
    check('goods_receipts_number_positive', sql`${t.number} > 0`),
    maxLength('goods_receipts_invoice_length', t.supplierInvoice, 100),
    maxLength('goods_receipts_note_length', t.note, 1000),
    check(
      'goods_receipts_idempotency_key_length',
      sql`char_length(${t.idempotencyKey}) between 1 and 255`,
    ),
    otherCostsCheck('goods_receipts_other_costs_valid', t.otherCosts),
    check(
      'goods_receipts_money',
      sql`${t.subtotal} >= 0 and ${t.otherCostTotal} >= 0 and ${t.total} = ${t.subtotal} + ${t.otherCostTotal}`,
    ),
    check(
      'goods_receipts_order_has_supplier',
      sql`${t.purchaseOrderId} is null or ${t.supplierId} is not null`,
    ),
  ],
);

export const goodsReceiptLines = store.table(
  'goods_receipt_lines',
  {
    ...tenantColumns(),
    goodsReceiptId: uuid().notNull(),
    purchaseOrderLineId: uuid(),
    variantId: uuid().notNull(),
    quantity: integer().notNull(),
    /** As entered. */
    unitCost: money().notNull(),
    /** With its share of the other costs (§3.3): what moves the average. */
    landedUnitCost: money().notNull(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.goodsReceiptId, t.variantId] }),
    ref(
      'goods_receipt_lines_receipt_fk',
      [t.tenantId, t.goodsReceiptId],
      [goodsReceipts.tenantId, goodsReceipts.id],
    ),
    ref(
      'goods_receipt_lines_order_line_fk',
      [t.tenantId, t.purchaseOrderLineId],
      [purchaseOrderLines.tenantId, purchaseOrderLines.id],
      'restrict',
    ),
    ref(
      'goods_receipt_lines_variant_fk',
      [t.tenantId, t.variantId],
      [variants.tenantId, variants.id],
      'restrict',
    ),
    index('goods_receipt_lines_variant_idx').on(t.tenantId, t.variantId),
    check('goods_receipt_lines_quantity_positive', sql`${t.quantity} > 0`),
    check('goods_receipt_lines_cost', sql`${t.unitCost} >= 0 and ${t.landedUnitCost} >= 0`),
  ],
);

// ---- Supplier payments (§3.7) ----------------------------------------------------------

export const supplierPayments = store.table(
  'supplier_payments',
  {
    ...tenantColumns(),
    id: id(),
    supplierId: uuid().notNull(),
    paidOn: day().notNull(),
    amount: money().notNull(),
    method: text({ enum: SPEND_METHODS }).notNull(),
    /** A bKash transaction ID, a cheque number. */
    reference: text(),
    note: text(),
    /** Paid on the spot with this receipt (§3.7). */
    goodsReceiptId: uuid(),
    recordedBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('supplier_payments', t),
    index('supplier_payments_supplier_idx').on(t.tenantId, t.supplierId, t.paidOn),
    ref(
      'supplier_payments_supplier_fk',
      [t.tenantId, t.supplierId],
      [suppliers.tenantId, suppliers.id],
      'restrict',
    ),
    ref(
      'supplier_payments_receipt_fk',
      [t.tenantId, t.goodsReceiptId],
      [goodsReceipts.tenantId, goodsReceipts.id],
      'restrict',
    ),
    oneOf('supplier_payments_method_valid', t.method, SPEND_METHODS),
    check('supplier_payments_amount_positive', sql`${t.amount} > 0`),
    maxLength('supplier_payments_reference_length', t.reference, 100),
    maxLength('supplier_payments_note_length', t.note, 500),
  ],
);

// ---- Cost history (§3.3) ---------------------------------------------------------------

/** Every change of a variant's cost, with why: append-only for the app role. */
export const costChanges = store.table(
  'cost_changes',
  {
    ...tenantColumns(),
    id: id(),
    variantId: uuid().notNull(),
    oldCost: money(),
    newCost: money(),
    /** On hand across locations when it changed. */
    onHand: integer().notNull(),
    source: text({ enum: COST_SOURCES }).notNull(),
    referenceType: text(),
    referenceId: uuid(),
    actorType: text({ enum: ACTOR_TYPES }).notNull(),
    actorId: uuid(),
    createdAt: createdAt(),
  },
  (t) => [
    tenantPolicy(t),
    index('cost_changes_variant_idx').on(t.tenantId, t.variantId, sql`created_at desc`),
    ref(
      'cost_changes_variant_fk',
      [t.tenantId, t.variantId],
      [variants.tenantId, variants.id],
      'restrict',
    ),
    oneOf('cost_changes_source_valid', t.source, COST_SOURCES),
    oneOf('cost_changes_actor_type_valid', t.actorType, ACTOR_TYPES),
    check(
      'cost_changes_money',
      sql`coalesce(${t.oldCost}, 0) >= 0 and coalesce(${t.newCost}, 0) >= 0`,
    ),
    maxLength('cost_changes_reference_type_length', t.referenceType, 50),
  ],
);

// ---- Stock counts (§3.5) ---------------------------------------------------------------

export const stockCounts = store.table(
  'stock_counts',
  {
    ...tenantColumns(),
    id: id(),
    number: integer().notNull(),
    locationId: uuid().notNull(),
    status: text({ enum: STOCK_COUNT_STATUSES }).notNull().default('counting'),
    /** { kind: all | category | tag | variants, … } */
    scope: jsonb().notNull(),
    note: text(),
    lineCount: integer().notNull().default(0),
    startedBy: uuid(),
    submittedAt: ts(),
    appliedAt: ts(),
    appliedBy: uuid(),
    /** Why the queued apply stopped (§7); cleared by the next apply. */
    applyError: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('stock_counts', t),
    uniqueIndex('stock_counts_number_unique').on(t.tenantId, t.number),
    index('stock_counts_status_idx').on(t.tenantId, t.status, sql`created_at desc`),
    ref(
      'stock_counts_location_fk',
      [t.tenantId, t.locationId],
      [stockLocations.tenantId, stockLocations.id],
      'restrict',
    ),
    oneOf('stock_counts_status_valid', t.status, STOCK_COUNT_STATUSES),
    check('stock_counts_number_positive', sql`${t.number} > 0`),
    check('stock_counts_scope_size', sql`octet_length(${t.scope}::text) <= 80000`),
    maxLength('stock_counts_note_length', t.note, 500),
    maxLength('stock_counts_apply_error_length', t.applyError, 500),
    check('stock_counts_line_count', sql`${t.lineCount} between 0 and 2000`),
  ],
);

export const stockCountLines = store.table(
  'stock_count_lines',
  {
    ...tenantColumns(),
    stockCountId: uuid().notNull(),
    variantId: uuid().notNull(),
    /** Null until counted. */
    counted: integer(),
    countedAt: ts(),
    countedBy: uuid(),
    // Written at apply (§3.5).
    /** What the ledger held at `counted_at`: on hand then, less the movements after it. */
    expectedAtCount: integer(),
    difference: integer(),
    unitCost: money(),
    appliedAt: ts(),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.stockCountId, t.variantId] }),
    ref(
      'stock_count_lines_count_fk',
      [t.tenantId, t.stockCountId],
      [stockCounts.tenantId, stockCounts.id],
    ),
    ref(
      'stock_count_lines_variant_fk',
      [t.tenantId, t.variantId],
      [variants.tenantId, variants.id],
      'restrict',
    ),
    check(
      'stock_count_lines_counted',
      sql`(${t.counted} is null) = (${t.countedAt} is null) and coalesce(${t.counted}, 0) >= 0`,
    ),
    check('stock_count_lines_cost', sql`coalesce(${t.unitCost}, 0) >= 0`),
  ],
);

// ---- Expenses (§3.6) -------------------------------------------------------------------

export const expenseCategories = store.table(
  'expense_categories',
  {
    ...tenantColumns(),
    id: id(),
    /** The default category it was seeded from; null for one staff added. */
    key: text(),
    /** { bn, en } */
    name: jsonb().notNull(),
    position: smallint().notNull().default(0),
    archivedAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('expense_categories', t),
    uniqueIndex('expense_categories_key_unique').on(t.tenantId, t.key).where(sql`key is not null`),
    check('expense_categories_name_size', sql`octet_length(${t.name}::text) <= 1000`),
    maxLength('expense_categories_key_length', t.key, 50),
  ],
);

export const recurringExpenses = store.table(
  'recurring_expenses',
  {
    ...tenantColumns(),
    id: id(),
    categoryId: uuid().notNull(),
    amount: money().notNull(),
    method: text({ enum: SPEND_METHODS }).notNull(),
    payee: text(),
    note: text(),
    cadence: text({ enum: EXPENSE_CADENCES }).notNull(),
    /** Monthly: 1–28, or 0 for the last day. Weekly: 1 (Monday) to 7 (Sunday). */
    day: smallint().notNull(),
    startsOn: day().notNull(),
    endsOn: day(),
    /** The next day it posts; null when it has ended. */
    nextOn: day(),
    active: boolean().notNull().default(true),
    createdBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('recurring_expenses', t),
    index('recurring_expenses_next_idx').on(t.tenantId, t.nextOn).where(sql`active`),
    ref(
      'recurring_expenses_category_fk',
      [t.tenantId, t.categoryId],
      [expenseCategories.tenantId, expenseCategories.id],
      'restrict',
    ),
    oneOf('recurring_expenses_method_valid', t.method, SPEND_METHODS),
    oneOf('recurring_expenses_cadence_valid', t.cadence, EXPENSE_CADENCES),
    check(
      'recurring_expenses_day_valid',
      sql`case ${t.cadence} when 'monthly' then ${t.day} between 0 and 28
                            when 'weekly' then ${t.day} between 1 and 7 else false end`,
    ),
    check('recurring_expenses_amount_positive', sql`${t.amount} > 0`),
    check('recurring_expenses_dates', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
    maxLength('recurring_expenses_payee_length', t.payee, 200),
    maxLength('recurring_expenses_note_length', t.note, 1000),
  ],
);

export const expenses = store.table(
  'expenses',
  {
    ...tenantColumns(),
    id: id(),
    /** The Dhaka day it was spent: the day net profit books it on (§3.8). */
    spentOn: day().notNull(),
    categoryId: uuid().notNull(),
    amount: money().notNull(),
    method: text({ enum: SPEND_METHODS }).notNull(),
    payee: text(),
    note: text(),
    /** The receipt photo: { key, mimeType, bytes }, under the store's R2 prefix. */
    receiptMedia: jsonb(),
    /** Posted by this recurring entry; once per entry and day. */
    recurringExpenseId: uuid(),
    recordedBy: uuid(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    tenantPolicy(t),
    tenantIdUnique('expenses', t),
    index('expenses_spent_idx').on(t.tenantId, sql`spent_on desc`),
    index('expenses_category_idx').on(t.tenantId, t.categoryId, t.spentOn),
    uniqueIndex('expenses_recurring_unique')
      .on(t.tenantId, t.recurringExpenseId, t.spentOn)
      .where(sql`recurring_expense_id is not null`),
    ref(
      'expenses_category_fk',
      [t.tenantId, t.categoryId],
      [expenseCategories.tenantId, expenseCategories.id],
      'restrict',
    ),
    ref(
      'expenses_recurring_fk',
      [t.tenantId, t.recurringExpenseId],
      [recurringExpenses.tenantId, recurringExpenses.id],
      'restrict',
    ),
    oneOf('expenses_method_valid', t.method, SPEND_METHODS),
    check('expenses_amount_positive', sql`${t.amount} > 0`),
    maxLength('expenses_payee_length', t.payee, 200),
    maxLength('expenses_note_length', t.note, 1000),
    check(
      'expenses_receipt_valid',
      sql`${t.receiptMedia} is null or (octet_length(${t.receiptMedia}::text) <= 500
          and (${t.receiptMedia}->>'bytes')::int between 1 and 2097152
          and ${t.receiptMedia}->>'mimeType' in ('image/jpeg', 'image/png', 'image/webp'))`,
    ),
  ],
);

// ---- Summary tables (§3.9) -------------------------------------------------------------
// Each fact is booked on its own Dhaka day: a sale on its delivery day, a
// return on its return day. The nightly refresh replaces the last 7 days.

export const dailySales = store.table(
  'daily_sales',
  {
    ...tenantColumns(),
    day: day().notNull(),
    ordersDelivered: integer().notNull().default(0),
    units: integer().notNull().default(0),
    grossSales: money().notNull().default(0),
    discounts: money().notNull().default(0),
    /** Gross less discounts, without VAT (§3.8). */
    netSales: money().notNull().default(0),
    vat: money().notNull().default(0),
    deliveryIncome: money().notNull().default(0),
    courierFees: money().notNull().default(0),
    failedDeliveryCosts: money().notNull().default(0),
    returnedUnits: integer().notNull().default(0),
    /** Returns at their net sale value, and refunds that aren't returns. */
    returns: money().notNull().default(0),
    cogs: money().notNull().default(0),
    returnedCogs: money().notNull().default(0),
    /** Delivered units whose line had no cost: profit is overstated by them. */
    missingCostUnits: integer().notNull().default(0),
    /** Damaged, lost, expired and sample adjustments and count differences at their value; gains lower it. */
    stockLosses: money().notNull().default(0),
    refreshedAt: ts().notNull().defaultNow(),
  },
  (t) => [tenantPolicy(t), primaryKey({ columns: [t.tenantId, t.day] })],
);

export const dailyProductSales = store.table(
  'daily_product_sales',
  {
    ...tenantColumns(),
    day: day().notNull(),
    variantId: uuid().notNull(),
    productId: uuid().notNull(),
    units: integer().notNull().default(0),
    netSales: money().notNull().default(0),
    cogs: money().notNull().default(0),
    returnedUnits: integer().notNull().default(0),
    returns: money().notNull().default(0),
    returnedCogs: money().notNull().default(0),
    missingCostUnits: integer().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.day, t.variantId] }),
    index('daily_product_sales_variant_idx').on(t.tenantId, t.variantId, t.day),
    ref(
      'daily_product_sales_variant_fk',
      [t.tenantId, t.variantId],
      [variants.tenantId, variants.id],
    ),
    ref(
      'daily_product_sales_product_fk',
      [t.tenantId, t.productId],
      [products.tenantId, products.id],
    ),
  ],
);

/** Stock at the end of each month: the valuation report's past months. */
export const monthlyStockValues = store.table(
  'monthly_stock_values',
  {
    ...tenantColumns(),
    /** The month's last day. */
    month: day().notNull(),
    variantId: uuid().notNull(),
    locationId: uuid().notNull(),
    onHand: integer().notNull(),
    /** The variant's weighted average then; null when it had none. */
    unitCost: money(),
    /** On hand above zero × cost; negative on hand is kept, never netted (§3.8). */
    value: money().notNull().default(0),
  },
  (t) => [
    tenantPolicy(t),
    primaryKey({ columns: [t.tenantId, t.month, t.variantId, t.locationId] }),
    ref(
      'monthly_stock_values_variant_fk',
      [t.tenantId, t.variantId],
      [variants.tenantId, variants.id],
    ),
    ref(
      'monthly_stock_values_location_fk',
      [t.tenantId, t.locationId],
      [stockLocations.tenantId, stockLocations.id],
    ),
  ],
);
