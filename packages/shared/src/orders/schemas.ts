// Inputs for carts, checkout, addresses and delivery zones (phase-4-plan
// §3.2–§3.5), shared by the API, the storefront's scripts and the admin.
// The services check everything again; the client never sends a price.
import { z } from 'zod';
import { CATALOG_LIMITS } from '../catalog/limits';
import { cleanString, locale } from '../catalog/schemas';
import { cleanText, normalizeTag } from '../catalog/text';
import { placeNames } from '../geo/index';
import { phoneNumber } from '../tenant-settings';
import { ORDER_SOURCES } from './machines';

const price = z.int().min(0).max(CATALOG_LIMITS.maxPrice);

/** Optional text that may be cleared: '' becomes undefined. */
const optionalText = (max: number) =>
  z
    .string()
    .transform(cleanText)
    .pipe(z.string().max(max))
    .transform((s) => s || undefined)
    .optional();

/** Division, district and area from the list, and the street line (§3.2). */
export const placeInput = z
  .object({
    divisionId: z.int().min(1),
    districtId: z.int().min(1),
    areaId: z.int().min(1),
    /** House, road, landmark: everything the area doesn't say. */
    line: cleanString(250),
  })
  .strict()
  .refine((p) => placeNames(p) !== null, {
    message: 'choose an area from the list',
    path: ['areaId'],
  });
export type PlaceInput = z.infer<typeof placeInput>;

export const contactInput = z
  .object({
    name: cleanString(100),
    phone: phoneNumber(),
    email: z
      .string()
      .trim()
      .transform((s) => s || undefined)
      .pipe(z.email().max(254).optional())
      .optional(),
  })
  .strict();

export const cartLineInput = z
  .object({ variantId: z.uuid(), quantity: z.int().min(1).max(999) })
  .strict();
export const cartQuantityInput = z.object({ quantity: z.int().min(0).max(999) }).strict();
export const cartCodeInput = z.object({ code: z.string().trim().min(1).max(32) }).strict();
export const cartAreaInput = z.object({ areaId: z.int().min(1).nullable() }).strict();

export const checkoutInput = z
  .object({
    contact: contactInput,
    address: placeInput,
    note: optionalText(500),
    paymentMethod: z.literal('cod'),
    /** The total the shopper saw, compared on the server (§3.1). */
    expectedTotal: price,
    saveDetails: z.boolean().optional(),
    acceptTerms: z.boolean().optional(),
    turnstileToken: z.string().max(4096).optional(),
  })
  .strict();
export type CheckoutInput = z.infer<typeof checkoutInput>;

export const DELIVERY_LIMITS = { zones: 20, areasPerZone: 600 } as const;

const localizedName = z
  .partialRecord(locale, cleanString(60))
  .refine((v) => Object.keys(v).length > 0, 'at least one language');
const localizedOptional = z.partialRecord(locale, cleanString(60));

export const deliveryZoneInput = z
  .object({
    name: localizedName,
    fee: price,
    /** Weight included in the fee; with `feePerExtraKg`, each extra kilogram (or part) costs that. */
    freeWeightGrams: z.int().min(0).max(1_000_000).nullable().default(null),
    feePerExtraKg: price.nullable().default(null),
    estimate: localizedOptional.default({}),
    isFallback: z.boolean().default(false),
    districtIds: z.array(z.int().min(1)).max(64).default([]),
    areaIds: z.array(z.int().min(1)).max(DELIVERY_LIMITS.areasPerZone).default([]),
    position: z.int().min(0).max(1000).default(0),
    active: z.boolean().default(true),
  })
  .strict()
  .refine((z) => (z.freeWeightGrams === null) === (z.feePerExtraKg === null), {
    message: 'set both the included weight and the fee per extra kilogram, or neither',
    path: ['feePerExtraKg'],
  })
  .refine((z) => !z.isFallback || (z.districtIds.length === 0 && z.areaIds.length === 0), {
    message: 'the fallback zone covers everywhere else, so it lists no districts or areas',
    path: ['isFallback'],
  });
export type DeliveryZoneInput = z.infer<typeof deliveryZoneInput>;

export const trackInput = z
  .object({ number: z.string().trim().min(1).max(30), phone: phoneNumber() })
  .strict();

export const reasonInput = z.object({ reason: cleanString(300) }).strict();

const customerTags = z
  .array(z.string())
  .max(20)
  .transform((list) => [
    ...new Set(list.map((t) => normalizeTag(t)).filter((t): t is string => t !== null)),
  ]);

export const customerInput = z
  .object({
    phone: phoneNumber(),
    name: cleanString(100),
    email: z
      .string()
      .trim()
      .transform((s) => s || null)
      .pipe(z.email().max(254).nullable())
      .nullable()
      .optional(),
    tags: customerTags.optional(),
    note: z
      .string()
      .transform(cleanText)
      .pipe(z.string().max(2000))
      .transform((s) => s || null)
      .nullable()
      .optional(),
  })
  .strict();
export const customerPatch = customerInput.partial();

export const addressInput = z
  .object({
    name: cleanString(100),
    phone: phoneNumber(),
    divisionId: z.int().min(1),
    districtId: z.int().min(1),
    areaId: z.int().min(1),
    line: cleanString(250),
    label: z
      .string()
      .transform(cleanText)
      .pipe(z.string().max(40))
      .transform((s) => s || null)
      .nullable()
      .optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((p) => placeNames(p) !== null, {
    message: 'choose an area from the list',
    path: ['areaId'],
  });
export type AddressInput = z.infer<typeof addressInput>;

// ---- Staff commands on orders (phase-4-plan §6.2) ---------------------------------

const orderLines = z
  .array(z.object({ variantId: z.uuid(), quantity: z.int().min(1).max(10_000) }).strict())
  .min(1)
  .max(50);

const trackingUrl = z
  .string()
  .trim()
  .max(500)
  .regex(/^https?:\/\//, 'starts with http:// or https://');

export const shipmentInput = z
  .object({
    lines: z
      .array(z.object({ orderLineId: z.uuid(), quantity: z.int().min(1).max(10_000) }).strict())
      .min(1)
      .max(50),
    carrier: optionalText(60),
    trackingNumber: optionalText(100),
    trackingUrl: trackingUrl.optional(),
  })
  .strict();
export const deliverInput = z.object({ cashCollected: z.boolean().default(true) }).strict();
export const failInput = z.object({ reason: cleanString(300) }).strict();

export const MANUAL_METHODS = ['bkash', 'nagad', 'rocket', 'bank', 'cash', 'other'] as const;

export const manualPaymentInput = z
  .object({
    method: z.enum(MANUAL_METHODS),
    amount: z.int().min(1).max(CATALOG_LIMITS.maxPrice),
    reference: optionalText(100),
  })
  .strict();

export const deliveryFeeOverride = z.object({ amount: price, reason: cleanString(200) }).strict();

export const orderEditInput = z
  .object({
    lines: orderLines,
    address: placeInput.nullable().optional(),
    /** Another zone than the area's, or "none" for no delivery. */
    zoneId: z
      .union([z.uuid(), z.literal('none')])
      .nullable()
      .optional(),
    deliveryFee: deliveryFeeOverride.nullable().optional(),
    reason: optionalText(300),
  })
  .strict();
export type OrderEditInput = z.infer<typeof orderEditInput>;

export const noteInput = z.object({ body: cleanString(2000) }).strict();
export const orderTagsInput = z.object({ tags: customerTags }).strict();

export const manualDiscountInput = z
  .object({
    amount: price.optional(),
    percentBp: z.int().min(1).max(10_000).optional(),
    reason: cleanString(200),
  })
  .strict()
  .refine((d) => (d.amount === undefined) !== (d.percentBp === undefined), {
    message: 'an amount or a percentage',
    path: ['amount'],
  });

/** A manual order (§3.12): Facebook, phone and walk-in orders. */
export const manualOrderInput = z
  .object({
    source: z.enum(ORDER_SOURCES),
    lines: orderLines,
    contact: contactInput,
    /** Null for a walk-in with no delivery. */
    address: placeInput.nullable(),
    zoneId: z
      .union([z.uuid(), z.literal('none')])
      .nullable()
      .optional(),
    deliveryFee: deliveryFeeOverride.optional(),
    code: z.string().trim().min(1).max(32).optional(),
    manualDiscount: manualDiscountInput.optional(),
    /** A payment already received; the rest is cash on delivery. */
    payment: manualPaymentInput.optional(),
    note: optionalText(500),
    tags: customerTags.optional(),
    locale: locale.optional(),
    confirm: z.boolean().default(false),
    /** A walk-in sale that leaves the shop at once: shipped and delivered in one step. */
    completeNow: z.boolean().default(false),
    allowBlocked: z.boolean().default(false),
  })
  .strict();
export type ManualOrderInput = z.infer<typeof manualOrderInput>;

export const orderListQuery = z.object({
  status: z.enum(['pending', 'confirmed', 'processing', 'completed', 'cancelled']).optional(),
  paymentStatus: z.enum(['unpaid', 'partially_paid', 'paid']).optional(),
  deliveryStatus: z
    .enum(['not_shipped', 'partially_shipped', 'shipped', 'delivered', 'failed'])
    .optional(),
  zoneId: z.uuid().optional(),
  source: z.enum(ORDER_SOURCES).optional(),
  tag: z.string().max(50).optional(),
  /** Cancelled by the shopper (§3.9). */
  cancelledByShopper: z.coerce.boolean().optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  q: z.string().trim().max(100).optional(),
  after: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
export type OrderListQuery = z.infer<typeof orderListQuery>;
