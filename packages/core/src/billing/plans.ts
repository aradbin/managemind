// Plans and subscriptions (phase-5b-plan §3.5). Plans are data a super admin
// edits; a store's effective entitlements (plan + override) are written to
// its tenant row whenever its subscription changes, so a check reads the row
// the request already loaded.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import {
  type EntitlementOverride,
  type Entitlements,
  entitlementOverride,
  entitlements,
  mergeEntitlements,
  PLACEHOLDER_PLANS,
  type PlanInput,
  planInput,
  type SubscriptionStatus,
  subscriptionInput,
} from '@managemind/shared/billing';
import { asc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { type Actor, auditActor, requirePlatformRole } from '../access';
import { emit } from '../outbox';
import { type PlatformTx, recordPlatformAudit } from '../platform';
import type { DbClient, TenantTx, WithTenantOptions } from '../tenant';
import { withTenant } from '../tenant';

const p = schema.plans;
const s = schema.subscriptions;

export interface Plan {
  id: string;
  code: string;
  name: { bn: string; en: string };
  monthlyPrice: number;
  setupFee: number;
  overagePrices: Partial<Record<'orders' | 'emails', number>>;
  entitlements: Entitlements;
  offered: boolean;
}

const planColumns = {
  id: p.id,
  code: p.code,
  name: p.name,
  monthlyPrice: p.monthlyPrice,
  setupFee: p.setupFee,
  overagePrices: p.overagePrices,
  entitlements: p.entitlements,
  offered: p.offered,
};

const toPlan = (row: Record<string, unknown>): Plan => ({
  ...(row as Omit<Plan, 'entitlements'>),
  entitlements: entitlements.parse(row.entitlements),
});

type Tx = PlatformTx | TenantTx;

function parse<T>(schemaOf: z.ZodType<T>, input: unknown): T {
  const result = schemaOf.safeParse(input);
  if (result.success) return result.data;
  throw new AppError('validation_failed', {
    fields: result.error.issues.map((i) => ({
      path: i.path.join('.'),
      code: i.code,
      message: i.message,
    })),
  });
}

/** Every plan, offered first (support). */
export async function listPlans(tx: Tx, actor: Actor): Promise<Plan[]> {
  requirePlatformRole(actor, 'support');
  const rows = await tx.db.select(planColumns).from(p).orderBy(asc(p.monthlyPrice), asc(p.code));
  return rows.map(toPlan).sort((a, b) => Number(b.offered) - Number(a.offered));
}

async function planById(tx: Tx, id: string): Promise<Plan> {
  const [row] = await tx.db.select(planColumns).from(p).where(eq(p.id, id));
  if (!row) throw new AppError('not_found', { detail: 'no such plan' });
  return toPlan(row);
}

/** A new plan (super_admin). */
export async function createPlan(tx: PlatformTx, actor: Actor, input: unknown): Promise<Plan> {
  requirePlatformRole(actor, 'super_admin');
  const data = parse(planInput, input);
  const [row] = await tx.db
    .insert(p)
    .values(data)
    .onConflictDoNothing({ target: p.code })
    .returning(planColumns);
  if (!row) throw new AppError('conflict', { detail: 'a plan with this code exists' });
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    action: 'plan.created',
    entityType: 'plan',
    entityId: row.id,
    after: data,
  });
  return toPlan(row);
}

/**
 * Changes a plan (super_admin). Its subscribers' effective entitlements are
 * rewritten in the same transaction; a feature a store already uses stays on
 * until staff change it (§3.5), so nothing breaks for shoppers.
 */
export async function updatePlan(
  tx: PlatformTx,
  actor: Actor,
  id: string,
  input: unknown,
): Promise<Plan> {
  requirePlatformRole(actor, 'super_admin');
  const before = await planById(tx, id);
  const data = parse(planInput.omit({ code: true }).partial(), input);
  const [row] = await tx.db.update(p).set(data).where(eq(p.id, id)).returning(planColumns);
  const plan = toPlan(row as Record<string, unknown>);
  const subscribers = await tx.db
    .select({ tenantId: s.tenantId, override: s.entitlementOverride })
    .from(s)
    .where(eq(s.planId, id));
  for (const sub of subscribers) {
    await tx.db
      .update(schema.tenants)
      .set({
        entitlements: mergeEntitlements(
          plan.entitlements,
          sub.override as EntitlementOverride | null,
        ),
      })
      .where(eq(schema.tenants.id, sub.tenantId));
  }
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    action: 'plan.updated',
    entityType: 'plan',
    entityId: id,
    before,
    after: plan,
  });
  return plan;
}

/** Adds the placeholder plans (Q5) when there are none; safe to rerun. */
export async function seedPlans(tx: Tx, plans: readonly PlanInput[] = PLACEHOLDER_PLANS) {
  const [any] = await tx.db.select({ id: p.id }).from(p).limit(1);
  if (any) return [];
  return tx.db
    .insert(p)
    .values(plans.map((plan) => ({ ...plan })))
    .onConflictDoNothing({ target: p.code })
    .returning({ code: p.code });
}

export interface Subscription {
  plan: Plan;
  priceOverride: number | null;
  setupFeeOverride: number | null;
  entitlementOverride: EntitlementOverride | null;
  billingDay: number;
  trialEndsOn: string | null;
  status: SubscriptionStatus;
  holdUntil: string | null;
  holdReason: string | null;
}

export type SubscriptionInput = z.input<typeof subscriptionInput>;

/** A store's subscription, or null for stores without one (demo, test, from before plans). */
export async function getSubscription(tx: Tx, tenantId: string): Promise<Subscription | null> {
  const [row] = await tx.db
    .select({
      planId: s.planId,
      priceOverride: s.priceOverride,
      setupFeeOverride: s.setupFeeOverride,
      entitlementOverride: s.entitlementOverride,
      billingDay: s.billingDay,
      trialEndsOn: s.trialEndsOn,
      status: s.status,
      holdUntil: s.holdUntil,
      holdReason: s.holdReason,
    })
    .from(s)
    .where(eq(s.tenantId, tenantId));
  if (!row) return null;
  const { planId, ...rest } = row;
  return {
    ...rest,
    entitlementOverride: row.entitlementOverride as EntitlementOverride | null,
    plan: await planById(tx, planId),
  };
}

/**
 * Creates or replaces a store's subscription in the caller's transaction,
 * and writes the store's effective entitlements. A change takes effect on
 * the next invoice; there is no proration (§2). A trial makes it `trialing`.
 */
export async function writeSubscription(
  tx: TenantTx,
  actor: Actor,
  input: unknown,
): Promise<Subscription> {
  requirePlatformRole(actor, 'super_admin');
  const data = parse(subscriptionInput, input);
  const override = data.entitlementOverride
    ? parse(entitlementOverride, data.entitlementOverride)
    : null;
  const plan = await planById(tx, data.planId);
  const before = await getSubscription(tx, tx.tenantId);
  const status: SubscriptionStatus = data.trialEndsOn
    ? 'trialing'
    : before && before.status !== 'trialing'
      ? before.status
      : 'active';
  const values = {
    planId: plan.id,
    priceOverride: data.priceOverride,
    setupFeeOverride: data.setupFeeOverride,
    entitlementOverride: override,
    billingDay: data.billingDay,
    trialEndsOn: data.trialEndsOn,
    status,
  };
  await tx.db
    .insert(s)
    .values({ tenantId: tx.tenantId, ...values })
    .onConflictDoUpdate({ target: s.tenantId, set: values });
  await tx.db
    .update(schema.tenants)
    .set({ entitlements: mergeEntitlements(plan.entitlements, override) })
    .where(eq(schema.tenants.id, tx.tenantId));
  await recordPlatformAudit(tx, {
    ...auditActor(actor, 'platform'),
    tenantId: tx.tenantId,
    action: before ? 'subscription.changed' : 'subscription.created',
    entityType: 'subscription',
    entityId: tx.tenantId,
    before: before ? { ...before, plan: before.plan.code } : null,
    after: { ...values, plan: plan.code },
  });
  await emit(tx, 'subscription.changed', {
    aggregateType: 'tenant',
    aggregateId: tx.tenantId,
    payload: { planCode: plan.code, status },
  });
  return (await getSubscription(tx, tx.tenantId)) as Subscription;
}

/** PUT /tenants/{id}/subscription (super_admin). */
export async function setSubscription(
  client: DbClient,
  actor: Actor,
  tenantId: string,
  input: unknown,
  options: WithTenantOptions = {},
): Promise<Subscription> {
  requirePlatformRole(actor, 'super_admin');
  return withTenant(client, tenantId, (tx) => writeSubscription(tx, actor, input), options);
}

/**
 * Holds reminders and suspension for one store until a date, with a reason
 * ("paying next week, agreed by phone"; §3.8). A null date ends the hold.
 */
export async function holdSubscription(
  client: DbClient,
  actor: Actor,
  tenantId: string,
  input: { until: string | null; reason?: string },
  options: WithTenantOptions = {},
): Promise<Subscription> {
  requirePlatformRole(actor, 'super_admin');
  const reason = input.reason?.trim() ?? '';
  if (input.until && reason.length < 3) {
    throw new AppError('validation_failed', {
      fields: [{ path: 'reason', code: 'required', message: 'a reason is required' }],
    });
  }
  return withTenant(
    client,
    tenantId,
    async (tx) => {
      const current = await getSubscription(tx, tenantId);
      if (!current) throw new AppError('not_found', { detail: 'the store has no subscription' });
      await tx.db
        .update(s)
        .set({ holdUntil: input.until, holdReason: input.until ? reason : null })
        .where(eq(s.tenantId, tenantId));
      await recordPlatformAudit(tx, {
        ...auditActor(actor, 'platform'),
        tenantId,
        action: input.until ? 'subscription.held' : 'subscription.hold_ended',
        entityType: 'subscription',
        entityId: tenantId,
        before: { holdUntil: current.holdUntil, holdReason: current.holdReason },
        after: { holdUntil: input.until, holdReason: input.until ? reason : null },
      });
      return (await getSubscription(tx, tenantId)) as Subscription;
    },
    options,
  );
}
