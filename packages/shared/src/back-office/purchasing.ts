// Purchasing (phase-8-plan §3.1–§3.3, §3.7): suppliers, purchase orders and
// their machine, goods receipts, supplier payments, and the inputs the API,
// the admin and the imports share. Money is integer poisha; the services
// compute every total again and never trust the client's.
import { z } from 'zod';
import { cleanString } from '../catalog/schemas';
import { cleanText } from '../catalog/text';
import { defineMachine } from '../state-machine';
import { phoneNumber } from '../tenant-settings';
import { BACK_OFFICE_LIMITS } from './limits';

/** How the store paid: a supplier, or an expense (§3.6, §3.7). */
export const SPEND_METHODS = ['cash', 'bank', 'bkash', 'nagad', 'card', 'other'] as const;
export type SpendMethod = (typeof SPEND_METHODS)[number];

/** Where a variant's cost came from (§3.3). */
export const COST_SOURCES = ['receipt', 'return', 'manual', 'import'] as const;
export type CostSource = (typeof COST_SOURCES)[number];

// ---- Purchase orders (§3.2) ----------------------------------------------------------

export const PURCHASE_ORDER_STATUSES = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'closed',
  'cancelled',
] as const;
export type PurchaseOrderStatus = (typeof PURCHASE_ORDER_STATUSES)[number];

/**
 * `receive` leaves something still to come; `receive_all` receives the last
 * of it. `receiveEvent` picks one from what remains after the receipt.
 */
export type PurchaseOrderEvent = 'place' | 'receive' | 'receive_all' | 'close' | 'cancel';

export const purchaseOrderMachine = defineMachine<PurchaseOrderStatus, PurchaseOrderEvent>({
  name: 'purchase_order',
  initial: 'draft',
  states: PURCHASE_ORDER_STATUSES,
  transitions: {
    draft: { place: { to: 'ordered' }, cancel: { to: 'cancelled' } },
    ordered: {
      receive: { to: 'partially_received', effects: ['goods_receipt'] },
      receive_all: { to: 'received', effects: ['goods_receipt'] },
      cancel: { to: 'cancelled' },
    },
    partially_received: {
      receive: { to: 'partially_received', effects: ['goods_receipt'] },
      receive_all: { to: 'received', effects: ['goods_receipt'] },
      close: { to: 'closed' },
    },
  },
});

/** The event a receipt fires, from the units still to come after it. */
export const receiveEvent = (remainingAfter: number): PurchaseOrderEvent =>
  remainingAfter > 0 ? 'receive' : 'receive_all';

/** Lines, quantities and costs can still change: a draft, or what isn't received of an ordered PO. */
export const isEditablePurchaseOrder = (status: PurchaseOrderStatus) =>
  status === 'draft' || status === 'ordered' || status === 'partially_received';

/** `PO-0001`, `GR-0001`, `SC-0001`: a per-store sequence, padded to four digits. */
export const documentNumber = (prefix: 'PO' | 'GR' | 'SC', n: number) =>
  `${prefix}-${String(n).padStart(4, '0')}`;

// ---- Inputs ----------------------------------------------------------------------------

const amount = z.int().min(0).max(BACK_OFFICE_LIMITS.maxAmount);
const quantity = z.int().min(1).max(BACK_OFFICE_LIMITS.maxQuantity);
const date = z.iso.date();

/** Optional text that may be cleared: '' and whitespace become null. */
export const optionalNote = (max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(max))
    .transform((s) => s || null)
    .nullable()
    .optional();

export const otherCost = z
  .object({ label: cleanString(100), amount: amount.refine((a) => a > 0, 'more than zero') })
  .strict();
export type OtherCost = z.infer<typeof otherCost>;
const otherCosts = z.array(otherCost).max(BACK_OFFICE_LIMITS.otherCosts);

const supplierAddress = z
  .object({
    line1: cleanString(200),
    line2: cleanString(200).optional(),
    city: cleanString(100).optional(),
  })
  .strict();

const supplierFields = {
  name: cleanString(200),
  contactName: optionalNote(200),
  phones: z
    .array(phoneNumber())
    .max(BACK_OFFICE_LIMITS.phonesPerSupplier)
    .transform((list) => [...new Set(list)])
    .optional(),
  email: z.email().max(254).nullable().optional(),
  address: supplierAddress.nullable().optional(),
  note: optionalNote(1000),
  /** What the store already owed the supplier when it started here (§3.1); negative is an advance. */
  openingBalance: z
    .int()
    .min(-BACK_OFFICE_LIMITS.maxAmount)
    .max(BACK_OFFICE_LIMITS.maxAmount)
    .optional(),
};

export const supplierInput = z.object(supplierFields).strict();
export type SupplierInput = z.infer<typeof supplierInput>;

export const supplierPatch = z
  .object({ ...supplierFields, archived: z.boolean().optional() })
  .partial()
  .strict();
export type SupplierPatch = z.infer<typeof supplierPatch>;

const uniqueVariants = <T extends { variantId: string }>(lines: T[]) =>
  new Set(lines.map((l) => l.variantId)).size === lines.length;

export const purchaseOrderLineInput = z
  .object({
    variantId: z.uuid(),
    quantity,
    /** Prefilled from the variant's cost; left out, the service uses that cost. */
    unitCost: amount.optional(),
  })
  .strict();

const purchaseOrderFields = {
  supplierId: z.uuid(),
  /** The store's default location when left out. */
  locationId: z.uuid().optional(),
  expectedOn: date.nullable().optional(),
  supplierRef: optionalNote(100),
  note: optionalNote(1000),
  lines: z
    .array(purchaseOrderLineInput)
    .min(1)
    .max(BACK_OFFICE_LIMITS.linesPerPurchaseOrder)
    .refine(uniqueVariants, 'each variant once'),
};

export const purchaseOrderInput = z
  .object({ ...purchaseOrderFields, otherCosts: otherCosts.default([]) })
  .strict();
export type PurchaseOrderInput = z.infer<typeof purchaseOrderInput>;

/**
 * A draft changes freely; an ordered PO only in what isn't received yet
 * (§3.2). `lines` replaces the PO's lines: a line left out is removed.
 */
export const purchaseOrderPatch = z
  .object({ ...purchaseOrderFields, otherCosts })
  .partial()
  .strict();
export type PurchaseOrderPatch = z.infer<typeof purchaseOrderPatch>;

export const supplierPaymentInput = z
  .object({
    supplierId: z.uuid(),
    paidOn: date,
    amount: amount.refine((a) => a > 0, 'more than zero'),
    method: z.enum(SPEND_METHODS),
    /** A bKash transaction ID, a cheque number. */
    reference: optionalNote(100),
    note: optionalNote(500),
  })
  .strict();
export type SupplierPaymentInput = z.infer<typeof supplierPaymentInput>;

export const supplierPaymentPatch = supplierPaymentInput
  .omit({ supplierId: true })
  .partial()
  .strict();

export const goodsReceiptLineInput = z
  .object({
    variantId: z.uuid(),
    quantity,
    /** As entered; left out (staff without catalog.cost), the PO's or the variant's cost. */
    unitCost: amount.optional(),
  })
  .strict();

export const goodsReceiptInput = z
  .object({
    /** Receiving an ordered PO; left out, a direct receipt (Q5). */
    purchaseOrderId: z.uuid().optional(),
    /** A direct receipt may name a supplier or none; a PO's receipt takes the PO's. */
    supplierId: z.uuid().optional(),
    locationId: z.uuid().optional(),
    /** Today in Dhaka when left out. */
    receivedOn: date.optional(),
    supplierInvoice: optionalNote(100),
    note: optionalNote(1000),
    lines: z
      .array(goodsReceiptLineInput)
      .min(1)
      .max(BACK_OFFICE_LIMITS.linesPerReceipt)
      .refine(uniqueVariants, 'each variant once'),
    /** This delivery's own costs (its transport), on top of its share of the PO's. */
    otherCosts: otherCosts.default([]),
    /** Paid on the spot (§3.7): needs a supplier and purchasing.pay. */
    payment: z
      .object({
        amount: amount.refine((a) => a > 0, 'more than zero'),
        method: z.enum(SPEND_METHODS),
        reference: optionalNote(100),
      })
      .strict()
      .optional(),
  })
  .strict();
export type GoodsReceiptInput = z.infer<typeof goodsReceiptInput>;
