// Sales channel settings (phase-9-plan §3.1.4, §3.1.6): the store's product
// feed for Meta and how its purchases are reported to Meta's Conversions API.
// Stored as `meta` in the store's settings JSON. The pixel ID stays in
// `storefront.tracking`, where the browser pixel reads it.
import { z } from 'zod';

/** When a website purchase reaches Meta (Q5): as the pixel does, or once confirmed. */
export const META_PURCHASE_AT = ['placed', 'confirmed'] as const;
export type MetaPurchaseAt = (typeof META_PURCHASE_AT)[number];

/** The feed's key: made by the server, changeable, never typed by staff. */
export const feedKey = z.string().regex(/^[A-Za-z0-9_-]{24,64}$/);

export const metaSettings = z
  .object({
    feed: z
      .object({
        /** Off until the owner turns it on: the feed URL answers 404 until then. */
        enabled: z.boolean().default(false),
        key: feedKey.optional(),
      })
      .strict()
      .default({ enabled: false }),
    purchaseAt: z.enum(META_PURCHASE_AT).default('placed'),
    /** A custom `Delivered` event with the delivered value (§3.1.6). */
    deliveredEvent: z.boolean().default(false),
  })
  .strict();
export type MetaSettings = z.infer<typeof metaSettings>;
export const defaultMetaSettings = (): MetaSettings => metaSettings.parse({});
