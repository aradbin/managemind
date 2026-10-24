// What a plan allows (phase-5b-plan §3.5, after Chargebee's and Lago's
// entitlements): typed limits and feature flags, attached to a plan, with an
// optional per-store override. The effective set (plan + override) is written
// to platform.tenants.entitlements whenever the subscription changes, so a
// check reads the tenant row the request already has.
import { z } from 'zod';

/** A count a plan allows; null is unlimited. */
const limit = z.int().min(0).max(10_000_000).nullable();

export const LIMITS = [
  'products',
  'staff',
  'ordersPerMonth',
  'emailsPerMonth',
  'storageMb',
  'customDomains',
] as const;
export type LimitName = (typeof LIMITS)[number];

/**
 * Hard limits refuse a staff action with `plan_limit`; soft limits are only
 * counted, warned and billed as overage, because a shopper never sees a
 * plan limit (PLAN.md).
 */
export const HARD_LIMITS = ['products', 'staff', 'customDomains'] as const satisfies LimitName[];
export const SOFT_LIMITS = [
  'ordersPerMonth',
  'emailsPerMonth',
  'storageMb',
] as const satisfies LimitName[];

export const FEATURES = [
  'sslcommerz',
  'sms',
  'shopperAccounts',
  'promotionCoupons',
  'promotionAutomatic',
  'promotionBuyXGetY',
  'promotionFreeDelivery',
  'reports',
  'customEmailKey',
] as const;
export type Feature = (typeof FEATURES)[number];

export const entitlements = z
  .object({
    limits: z
      .object(Object.fromEntries(LIMITS.map((l) => [l, limit])) as Record<LimitName, typeof limit>)
      .strict(),
    features: z
      .object(
        Object.fromEntries(FEATURES.map((f) => [f, z.boolean()])) as Record<Feature, z.ZodBoolean>,
      )
      .strict(),
  })
  .strict();
export type Entitlements = z.infer<typeof entitlements>;

/** A store's exceptions to its plan, e.g. "10 more staff for this client". */
export const entitlementOverride = z
  .object({
    limits: z
      .object(
        Object.fromEntries(LIMITS.map((l) => [l, limit.optional()])) as Record<
          LimitName,
          z.ZodOptional<typeof limit>
        >,
      )
      .strict()
      .optional(),
    features: z
      .object(
        Object.fromEntries(FEATURES.map((f) => [f, z.boolean().optional()])) as Record<
          Feature,
          z.ZodOptional<z.ZodBoolean>
        >,
      )
      .strict()
      .optional(),
  })
  .strict();
export type EntitlementOverride = z.infer<typeof entitlementOverride>;

/** Everything unlimited and on: demo and test stores, and stores from before plans. */
export const UNLIMITED: Entitlements = {
  limits: Object.fromEntries(LIMITS.map((l) => [l, null])) as Entitlements['limits'],
  features: Object.fromEntries(FEATURES.map((f) => [f, true])) as Entitlements['features'],
};

/** The plan's entitlements with the store's override on top. */
export function mergeEntitlements(
  plan: Entitlements,
  override: EntitlementOverride | null | undefined,
): Entitlements {
  const limits = { ...plan.limits };
  for (const l of LIMITS) {
    const v = override?.limits?.[l];
    if (v !== undefined) limits[l] = v;
  }
  const features = { ...plan.features };
  for (const f of FEATURES) {
    const v = override?.features?.[f];
    if (v !== undefined) features[f] = v;
  }
  return { limits, features };
}

/**
 * The effective entitlements stored on a tenant row. An empty or unreadable
 * value (a store from before Phase 5B, before its subscription exists) is
 * unlimited, so a migration never takes a feature away.
 */
export function readEntitlements(value: unknown): Entitlements {
  const parsed = entitlements.safeParse(value);
  return parsed.success ? parsed.data : UNLIMITED;
}

export type LimitCheck =
  | { ok: true; limit: number | null }
  | { ok: false; limit: number; used: number };

/** Whether `adding` more of a hard limit fits: `used + adding <= limit`. */
export function checkLimit(e: Entitlements, name: LimitName, used: number, adding = 1): LimitCheck {
  const max = e.limits[name];
  if (max === null) return { ok: true, limit: null };
  return used + adding <= max ? { ok: true, limit: max } : { ok: false, limit: max, used };
}

/** A soft limit's level for the owner's meters: warned at 80% and at 100%. */
export function usageLevel(used: number, max: number | null): 'ok' | 'warn' | 'over' {
  if (max === null) return 'ok';
  if (used >= max) return 'over';
  return used >= max * 0.8 ? 'warn' : 'ok';
}
