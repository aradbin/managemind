// Entitlement checks in the core services (phase-5b-plan §3.5), next to the
// permission checks. The effective set is on the tenant row, written when
// the subscription changes; empty is unlimited.
//
// - Hard limits refuse a staff action with plan_limit (402).
// - Features refuse turning a setting on (feature_not_in_plan, 402); a setting
//   already on stays on after a downgrade, so nothing breaks for shoppers.
// - Soft limits (orders, emails) are never checked here: shoppers never see a
//   plan limit. They're counted, warned and billed as overage.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  checkLimit,
  type Entitlements,
  type Feature,
  type LimitName,
  readEntitlements,
} from '@managemind/shared/billing';
import { eq } from 'drizzle-orm';
import type { TenantTx } from '../tenant';

/** The store's effective entitlements (one read of its tenant row). */
export async function storeEntitlements(tx: TenantTx): Promise<Entitlements> {
  const [row] = await tx.db
    .select({ entitlements: schema.tenants.entitlements })
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tx.tenantId));
  return readEntitlements(row?.entitlements);
}

/**
 * Refuses with plan_limit unless `adding` more fits the store's plan.
 * `used` is read only when the plan has a limit, so unlimited stores pay
 * nothing for the check.
 */
export async function requireWithinLimit(
  tx: TenantTx,
  name: LimitName,
  used: () => Promise<number>,
  adding = 1,
): Promise<void> {
  const e = await storeEntitlements(tx);
  if (e.limits[name] === null) return;
  const result = checkLimit(e, name, await used(), adding);
  if (!result.ok) {
    throw new AppError('plan_limit', {
      detail: `the plan allows ${result.limit} ${name}`,
      extensions: { limit: name, max: result.limit, used: result.used },
    });
  }
}

/** Refuses with feature_not_in_plan unless the store's plan has the feature. */
export async function requireFeature(tx: TenantTx, feature: Feature): Promise<void> {
  const e = await storeEntitlements(tx);
  if (!e.features[feature]) {
    throw new AppError('feature_not_in_plan', {
      detail: `${feature} is not in the store's plan`,
      extensions: { feature },
    });
  }
}
