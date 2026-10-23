// Checkout, cash-on-delivery, fraud and return settings (phase-4-plan §4,
// phase-5a-plan §3.4, §3.10, §3.11, §3.14): stored as `checkout`, `cod`,
// `fraud` and `returns` in the store's settings JSON.
import { z } from 'zod';
import { CATALOG_LIMITS } from '../catalog/limits';
import {
  DEFAULT_ORDER_PREFIX,
  OFFERED_REFUND_METHODS,
  RETURN_REASONS,
  STORE_FAULT_REASONS,
} from './machines';

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
export const COD_OTP_RULES = ['off', 'always', 'flagged', 'first_order'] as const;

export const codSettings = z
  .object({
    enabled: z.boolean().default(true),
    /** Above this total (poisha) COD isn't offered; null for no limit. */
    maxOrderValue: z.int().min(0).max(CATALOG_LIMITS.maxPrice).nullable().default(null),
    /**
     * An advance of the delivery charge, paid online (phase-5a-plan §3.4):
     * from every shopper, from flagged phones, or never. Needs SSLCommerz.
     */
    advance: z.enum(COD_ADVANCE_RULES).default('never'),
    /** A code by SMS before a COD order (§3.14, Q13); needs the store's SMS gateway. */
    otp: z.enum(COD_OTP_RULES).default('off'),
  })
  .strict();
export type CodSettings = z.infer<typeof codSettings>;

/** When a phone is flagged (§3.11, Q12): flags ask for the advance or the OTP. */
export const fraudSettings = z
  .object({
    flagAfterFailed: z.int().min(1).max(20).default(1),
  })
  .strict();
export type FraudSettings = z.infer<typeof fraudSettings>;

const DEFAULT_SHOPPER_PAYS_FOR = RETURN_REASONS.filter((r) => !STORE_FAULT_REASONS.includes(r));

/** The return policy (§3.10, Q9 and Q10). */
export const returnSettings = z
  .object({
    /** Shoppers can ask for a return from the tracking page. */
    shopperRequests: z.boolean().default(true),
    /** Days after delivery a shopper can ask; staff can create returns any time. */
    windowDays: z.int().min(1).max(90).default(7),
    excludedCategoryIds: z.array(z.uuid()).max(50).default([]),
    /** Reasons for which the shopper pays the return delivery; the store pays for the rest. */
    shopperPaysFor: z
      .array(z.enum(RETURN_REASONS))
      .max(RETURN_REASONS.length)
      .default(() => [...DEFAULT_SHOPPER_PAYS_FOR]),
    refundMethods: z
      .array(z.enum(OFFERED_REFUND_METHODS))
      .min(1)
      .max(OFFERED_REFUND_METHODS.length)
      .default(() => [...OFFERED_REFUND_METHODS]),
    /** Refund the delivery fee when the whole order comes back for a reason the store pays for (Q10). */
    refundDeliveryFee: z.boolean().default(true),
  })
  .strict();
export type ReturnSettings = z.infer<typeof returnSettings>;

export const defaultCheckoutSettings = (): CheckoutSettings => checkoutSettings.parse({});
export const defaultCodSettings = (): CodSettings => codSettings.parse({});
export const defaultFraudSettings = (): FraudSettings => fraudSettings.parse({});
export const defaultReturnSettings = (): ReturnSettings => returnSettings.parse({});

/** Cart limits that are not settings (§3.4). */
export const CART_LIMITS = {
  lines: 50,
  /** Days a cart is kept after its last change. */
  keepDays: 30,
  /** Days a converted cart is kept. */
  keepConvertedDays: 7,
} as const;
