// Inputs for carts, checkout, addresses and delivery zones (phase-4-plan
// §3.2–§3.5), shared by the API, the storefront's scripts and the admin.
// The services check everything again; the client never sends a price.
import { z } from 'zod';
import { CATALOG_LIMITS } from '../catalog/limits';
import { cleanString, locale } from '../catalog/schemas';
import { cleanText } from '../catalog/text';
import { placeNames } from '../geo/index';
import { phoneNumber } from '../tenant-settings';

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
