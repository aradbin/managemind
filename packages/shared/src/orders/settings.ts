// Checkout, cash-on-delivery, fraud and return settings (phase-4-plan §4,
// phase-5a-plan §3.4, §3.10, §3.11, §3.14), and sales recovery's
// (phase-6-plan §3.1): stored as `checkout`, `cod`, `fraud`, `returns`,
// `confirmation` and `recovery` in the store's settings JSON.
import { z } from 'zod';
import { CATALOG_LIMITS } from '../catalog/limits';
import {
  DEFAULT_ORDER_PREFIX,
  OFFERED_REFUND_METHODS,
  RETURN_REASONS,
  STORE_FAULT_REASONS,
} from './machines';
import { RECOVERY_LIMITS, unknownScriptVariables } from './recovery';

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

/**
 * When a phone is risky (phase-5a-plan §3.11, Q12; phase-6-plan §3.3): risky
 * phones are asked for the advance or the OTP. No score threshold until the
 * pilot's data (phase-6-plan Q4).
 */
export const fraudSettings = z
  .object({
    flagAfterFailed: z.int().min(1).max(20).default(1),
    /** Phones scoring under this are risky; null for no threshold. */
    minScore: z.int().min(0).max(100).nullable().default(null),
    /** Decided orders a phone needs before its score counts. */
    minDecided: z.int().min(1).max(20).default(2),
    /** Minutes in which the same items from the same phone are a possible duplicate; 0 turns it off. */
    duplicateMinutes: z.int().min(0).max(1440).default(30),
  })
  .strict();
export type FraudSettings = z.infer<typeof fraudSettings>;

const scriptText = z
  .string()
  .trim()
  .max(2000)
  .refine((text) => unknownScriptVariables(text).length === 0, 'unknown placeholder');

export const AUTO_CONFIRM_RULES = ['never', 'trusted'] as const;

/** The confirmation queue (phase-6-plan §3.5–§3.7). */
export const confirmationSettings = z
  .object({
    /** New COD orders wait in the confirmation queue. */
    queue: z.boolean().default(true),
    /** Orders paid in full online wait in the queue too. */
    includePaid: z.boolean().default(false),
    /** Unanswered calls before an order is marked unreachable. */
    maxAttempts: z.int().min(1).max(10).default(3),
    /** When an unanswered order is due again. */
    retryAfterMinutes: z.int().min(5).max(1440).default(60),
    /** Cancel an order at maxAttempts (Q8). */
    cancelUnreachable: z.boolean().default(false),
    /** Text new COD orders a link to confirm or cancel; needs the store's SMS gateway (Q9). */
    smsLink: z.boolean().default(false),
    /** A risky phone's order stays in the queue after the shopper confirms by link (Q9). */
    callRisky: z.boolean().default(true),
    /** Confirm trusted phones' orders at placement (Q10). */
    autoConfirm: z.enum(AUTO_CONFIRM_RULES).default('never'),
    /** The call script; an empty language uses the default, which the code keeps (Q3). */
    script: z.object({ bn: scriptText.optional(), en: scriptText.optional() }).strict().default({}),
  })
  .strict();
export type ConfirmationSettings = z.infer<typeof confirmationSettings>;

/** Incomplete orders (phase-6-plan §3.2, Q5). */
export const recoverySettings = z
  .object({
    /** Save incomplete checkouts, with the notice at the phone field. */
    incomplete: z.boolean().default(true),
    /** Minutes after the shopper's last change before staff see it. */
    showAfterMinutes: z.int().min(0).max(1440).default(30),
    /** Days a record is kept after its last change. */
    keepDays: z.int().min(1).max(RECOVERY_LIMITS.keepDaysMax).default(RECOVERY_LIMITS.keepDaysMax),
  })
  .strict();
export type RecoverySettings = z.infer<typeof recoverySettings>;

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
export const defaultConfirmationSettings = (): ConfirmationSettings =>
  confirmationSettings.parse({});
export const defaultRecoverySettings = (): RecoverySettings => recoverySettings.parse({});

/** Cart limits that are not settings (§3.4). */
export const CART_LIMITS = {
  lines: 50,
  /** Days a cart is kept after its last change. */
  keepDays: 30,
  /** Days a converted cart is kept. */
  keepConvertedDays: 7,
} as const;
