// The shopper's cart as the API answers it: shared by the cart, checkout and
// account routes (its own module, as the account and commerce routes import
// each other).
import { z } from '@hono/zod-openapi';

export const Localized = z.object({ bn: z.string().optional(), en: z.string().optional() });
const Image = z
  .object({
    width: z.number(),
    height: z.number(),
    files: z.array(z.object({ width: z.number(), file: z.string() })),
    alt: z.string().nullable(),
  })
  .nullable();
const Totals = z.object({
  subtotal: z.number().int(),
  discountTotal: z.number().int(),
  deliveryFee: z.number().int(),
  deliveryDiscount: z.number().int(),
  vatTotal: z.number().int(),
  vatIncluded: z.boolean(),
  rounding: z.number().int(),
  total: z.number().int(),
});
export const ShopperCart = z
  .object({
    itemCount: z.number().int(),
    areaId: z.number().int().nullable(),
    ready: z.boolean(),
    maxQuantityPerLine: z.number().int(),
    lines: z.array(
      z.object({
        variantId: z.uuid(),
        productId: z.string(),
        title: Localized,
        slugs: Localized,
        optionLabels: z.array(Localized),
        sku: z.string().nullable(),
        image: Image,
        unitPrice: z.number().int(),
        compareAtPrice: z.number().int().nullable(),
        quantity: z.number().int(),
        total: z.number().int(),
        maxQuantity: z.number().int().nullable(),
        problem: z.enum(['unavailable', 'insufficient_stock', 'over_limit']).nullable(),
      }),
    ),
    zone: z.object({ name: Localized, estimate: Localized }).nullable(),
    deliveryFrom: z.number().int().nullable(),
    totals: Totals,
    promotions: z.array(
      z.object({
        title: Localized,
        amount: z.number().int(),
        target: z.string(),
        code: z.string().optional(),
      }),
    ),
    code: z.object({ code: z.string(), status: z.string() }).nullable(),
    freeDelivery: z.object({ threshold: z.number().int(), remaining: z.number().int() }).nullable(),
  })
  .openapi('ShopperCart');
export type ShopperCart = z.infer<typeof ShopperCart>;
