// Promotions (phase-4-plan §3.13): conditions and one action, as typed JSON
// validated here, so a new option is code and settings, never a migration
// (after Vendure). The engine in core reads these shapes.
import { z } from 'zod';
import { CATALOG_LIMITS } from '../catalog/limits';
import { cleanString, locale } from '../catalog/schemas';
import { normalizeTag } from '../catalog/text';
import { phoneNumber } from '../tenant-settings';

const ids = z.array(z.uuid()).max(500);
const positivePrice = z.int().min(1).max(CATALOG_LIMITS.maxPrice);
/** Basis points: 1500 = 15%; 10000 = all of it. */
const percent = z.int().min(1).max(10_000);

/** Which items a condition or an action is about: any match counts. */
export const itemSelection = z
  .object({
    productIds: ids.optional(),
    variantIds: ids.optional(),
    categoryIds: ids.optional(),
    collectionIds: ids.optional(),
  })
  .strict()
  .refine(
    (s) => Object.values(s).some((list) => list && list.length > 0),
    'choose at least one product, variant, category or collection',
  );
export type ItemSelection = z.infer<typeof itemSelection>;

export const PAYMENT_METHODS = ['cod', 'manual', 'online'] as const;

const tagList = z
  .array(z.string())
  .max(20)
  .transform((list) => [
    ...new Set(list.map((t) => normalizeTag(t)).filter((t): t is string => t !== null)),
  ]);

/** All conditions must match. */
export const promotionConditions = z
  .object({
    /** The cart's subtotal (or, with `items`, the matching items' subtotal), before discounts. */
    minSubtotal: positivePrice.optional(),
    /** Units in the cart (or, with `items`, matching units). */
    minQuantity: z.int().min(1).max(1000).optional(),
    /** The cart holds at least one of these. */
    items: itemSelection.optional(),
    /** The address is in one of these delivery zones. */
    zoneIds: z.array(z.uuid()).min(1).max(20).optional(),
    /** No earlier order from this phone that wasn't cancelled. */
    firstOrder: z.literal(true).optional(),
    customerPhones: z.array(phoneNumber()).min(1).max(500).optional(),
    /** Customer groups (tags such as "wholesale"). */
    customerTags: tagList.optional(),
    paymentMethods: z.array(z.enum(PAYMENT_METHODS)).min(1).optional(),
  })
  .strict();
export type PromotionConditions = z.infer<typeof promotionConditions>;

/** One action per promotion. */
export const promotionAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('percent_off_order'), percentBp: percent }).strict(),
  z
    .object({ type: z.literal('percent_off_items'), percentBp: percent, target: itemSelection })
    .strict(),
  z.object({ type: z.literal('amount_off_order'), amount: positivePrice }).strict(),
  /** A fixed amount off each targeted unit. */
  z
    .object({ type: z.literal('amount_off_items'), amount: positivePrice, target: itemSelection })
    .strict(),
  /**
   * Buy `buy.quantity` from one set, get `get.quantity` from another (or the
   * same, when `get.items` is left out) at `get.percentBp` off; the cheapest
   * qualifying units are discounted.
   */
  z
    .object({
      type: z.literal('buy_x_get_y'),
      buy: z.object({ quantity: z.int().min(1).max(100), items: itemSelection }).strict(),
      get: z
        .object({
          quantity: z.int().min(1).max(100),
          items: itemSelection.optional(),
          percentBp: percent,
        })
        .strict(),
      /** How many times it applies in one order; no limit when left out. */
      maxUses: z.int().min(1).max(100).optional(),
    })
    .strict(),
  /** Free delivery is 10000. */
  z.object({ type: z.literal('delivery_percent_off'), percentBp: percent }).strict(),
  z.object({ type: z.literal('delivery_amount_off'), amount: positivePrice }).strict(),
]);
export type PromotionAction = z.infer<typeof promotionAction>;
export type PromotionActionType = PromotionAction['type'];

export const ACTION_TARGET: Record<PromotionActionType, 'items' | 'order' | 'delivery'> = {
  percent_off_order: 'order',
  percent_off_items: 'items',
  amount_off_order: 'order',
  amount_off_items: 'items',
  buy_x_get_y: 'items',
  delivery_percent_off: 'delivery',
  delivery_amount_off: 'delivery',
};

export const PROMOTION_KINDS = ['automatic', 'code'] as const;
export const PROMOTION_STATUSES = ['draft', 'active', 'paused', 'ended'] as const;
export type PromotionKind = (typeof PROMOTION_KINDS)[number];
export type PromotionStatus = (typeof PROMOTION_STATUSES)[number];

/** A code: letters, digits and - or _, matched without regard to case. */
export const promotionCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, '3 to 32 letters, digits, - or _');

export const PROMOTION_LIMITS = {
  codesPerBatch: 5_000,
  /** Automatic promotions active at once: the engine checks each on every cart change. */
  activeAutomatic: 50,
} as const;

const title = z
  .partialRecord(locale, cleanString(100))
  .refine((v) => Object.keys(v).length > 0, 'at least one language');

export const promotionInput = z
  .object({
    title,
    kind: z.enum(PROMOTION_KINDS),
    status: z.enum(PROMOTION_STATUSES).default('draft'),
    startsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    priority: z.int().min(0).max(1000).default(0),
    exclusive: z.boolean().default(false),
    maxDiscount: positivePrice.nullable().default(null),
    usageLimit: z.int().min(1).max(10_000_000).nullable().default(null),
    perCustomerLimit: z.int().min(1).max(1000).nullable().default(null),
    conditions: promotionConditions.default({}),
    action: promotionAction,
    /** For a code promotion: one shared code ("EID500"); batches are generated separately. */
    code: promotionCode.optional(),
  })
  .strict()
  .refine((p) => !p.startsAt || !p.endsAt || Date.parse(p.endsAt) > Date.parse(p.startsAt), {
    message: 'must end after it starts',
    path: ['endsAt'],
  })
  .refine((p) => p.kind === 'code' || p.code === undefined, {
    message: 'only code promotions have a code',
    path: ['code'],
  });
export type PromotionInput = z.infer<typeof promotionInput>;

export const codeBatchInput = z
  .object({
    count: z.int().min(1).max(PROMOTION_LIMITS.codesPerBatch),
    prefix: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{0,10}$/)
      .default(''),
    /** Uses per code; 1 for single-use codes. */
    usageLimit: z.int().min(1).max(1000).default(1),
  })
  .strict();
