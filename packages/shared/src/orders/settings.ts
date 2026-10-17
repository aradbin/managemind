// Checkout and cash-on-delivery settings (phase-4-plan §4, "Settings"):
// stored as `checkout` and `cod` in the store's settings JSON.
import { z } from 'zod';
import { CATALOG_LIMITS } from '../catalog/limits';
import { DEFAULT_ORDER_PREFIX } from './machines';

export const EMAIL_FIELD_MODES = ['optional', 'required', 'hidden'] as const;

/** An order number prefix: "#", "AR-", or nothing. */
export const ORDER_PREFIX = /^[A-Za-z0-9#-]{0,8}$/;

export const rateLimitSettings = z
  .object({
    perPhoneHour: z.int().min(1).max(100).default(3),
    perPhoneDay: z.int().min(1).max(500).default(10),
    perIpHour: z.int().min(1).max(500).default(10),
  })
  .strict();
export type RateLimitSettings = z.infer<typeof rateLimitSettings>;

export const checkoutSettings = z
  .object({
    email: z.enum(EMAIL_FIELD_MODES).default('optional'),
    /** Units of one variant in a cart (§3.4). */
    maxQuantityPerLine: z.int().min(1).max(999).default(10),
    orderNumberPrefix: z
      .string()
      .regex(ORDER_PREFIX, 'letters, digits, # and -')
      .default(DEFAULT_ORDER_PREFIX),
    rateLimits: rateLimitSettings.default(() => rateLimitSettings.parse({})),
    /** Shopper accounts, off by default (Q3). */
    accounts: z.boolean().default(false),
    /** A terms checkbox linking to the terms page, once one is published. */
    termsCheckbox: z.boolean().default(false),
  })
  .strict();
export type CheckoutSettings = z.infer<typeof checkoutSettings>;

export const COD_ADVANCE_RULES = ['never', 'always', 'flagged'] as const;

export const codSettings = z
  .object({
    enabled: z.boolean().default(true),
    /** Above this total (poisha) COD isn't offered; null for no limit. */
    maxOrderValue: z.int().min(0).max(CATALOG_LIMITS.maxPrice).nullable().default(null),
    /**
     * An advance delivery charge. Saved now, enforced on the storefront once
     * online payment exists (Phase 5A); until then staff record advances.
     */
    advance: z.enum(COD_ADVANCE_RULES).default('never'),
  })
  .strict();
export type CodSettings = z.infer<typeof codSettings>;

export const defaultCheckoutSettings = (): CheckoutSettings => checkoutSettings.parse({});
export const defaultCodSettings = (): CodSettings => codSettings.parse({});

/** Cart limits that are not settings (§3.4). */
export const CART_LIMITS = {
  lines: 50,
  /** Days a cart is kept after its last change. */
  keepDays: 30,
  /** Days a converted cart is kept. */
  keepConvertedDays: 7,
} as const;
