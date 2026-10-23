// The platform's view of stores (phase-1-plan §7.1, platform routes):
// registry data only, never a store's own records. Support and super admins
// read it; nothing here reaches into the store schema.
import { schema } from '@managemind/db';
import { AppError } from '@managemind/shared';
import { and, asc, count, desc, eq, gt, ilike, lt, or, sql } from 'drizzle-orm';
import { type Actor, requirePlatformRole } from '../access';
import type { PlatformTx } from '../platform';

const t = schema.tenants;

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: (typeof schema.TENANT_STATUSES)[number];
  /** The subscription's plan code, or the Phase 1 label for stores without one. */
  plan: string;
  kind: (typeof schema.TENANT_KINDS)[number];
  statusReason: (typeof schema.SUSPENSION_REASONS)[number] | null;
  closedAt: Date | null;
  purgeAfter: Date | null;
  /** Setup checklist progress as of the last health check (phase-5b-plan §3.2); null before one. */
  setup: { done: number; total: number } | null;
  createdAt: Date;
}

const summary = {
  id: t.id,
  slug: t.slug,
  name: t.name,
  status: t.status,
  plan: sql<string>`coalesce(${schema.plans.code}, ${t.plan})`,
  kind: t.kind,
  statusReason: t.statusReason,
  closedAt: t.closedAt,
  purgeAfter: t.purgeAfter,
  setup: sql<{ done: number; total: number } | null>`case
    when ${schema.storeHealth.checklist} ? 'total'
    then jsonb_build_object('done', ${schema.storeHealth.checklist}->'done', 'total', ${schema.storeHealth.checklist}->'total')
  end`,
  createdAt: t.createdAt,
};

/** The tenant row with its plan and last health check. */
const fromTenants = (tx: PlatformTx) =>
  tx.db
    .select(summary)
    .from(t)
    .leftJoin(schema.subscriptions, eq(schema.subscriptions.tenantId, t.id))
    .leftJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .leftJoin(schema.storeHealth, eq(schema.storeHealth.tenantId, t.id));

/** Stores by slug, filtered by a search on slug or name and by status. */
export async function listTenants(
  tx: PlatformTx,
  actor: Actor,
  query: { q?: string; status?: TenantSummary['status']; after?: string; limit?: number } = {},
): Promise<TenantSummary[]> {
  requirePlatformRole(actor, 'support');
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const q = query.q?.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return fromTenants(tx)
    .where(
      and(
        q ? or(ilike(t.slug, `%${q}%`), ilike(t.name, `%${q}%`)) : undefined,
        query.status ? eq(t.status, query.status) : undefined,
        query.after ? gt(t.slug, query.after) : undefined,
      ),
    )
    .orderBy(asc(t.slug))
    .limit(limit);
}

export interface TenantDetail extends TenantSummary {
  defaultLocale: 'bn' | 'en';
  domains: { hostname: string; status: string; isPrimary: boolean }[];
  owners: { userId: string; name: string; email: string }[];
  memberCount: number;
}

export async function getTenantDetail(
  tx: PlatformTx,
  actor: Actor,
  tenantId: string,
): Promise<TenantDetail> {
  requirePlatformRole(actor, 'support');
  const [found] = await fromTenants(tx).where(eq(t.id, tenantId));
  const [locale] = await tx.db
    .select({ defaultLocale: t.defaultLocale })
    .from(t)
    .where(eq(t.id, tenantId));
  const tenant = found && locale ? { ...found, defaultLocale: locale.defaultLocale } : undefined;
  if (!tenant) throw new AppError('not_found');
  const d = schema.tenantDomains;
  const m = schema.memberships;
  const u = schema.users;
  const [domains, owners, [members]] = await Promise.all([
    tx.db
      .select({ hostname: d.hostname, status: d.status, isPrimary: d.isPrimary })
      .from(d)
      .where(eq(d.tenantId, tenantId))
      .orderBy(asc(d.hostname)),
    tx.db
      .select({ userId: u.id, name: u.name, email: u.email })
      .from(m)
      .innerJoin(u, eq(u.id, m.userId))
      .where(and(eq(m.tenantId, tenantId), eq(m.role, 'owner')))
      .orderBy(asc(u.name)),
    tx.db.select({ n: count() }).from(m).where(eq(m.tenantId, tenantId)),
  ]);
  return { ...tenant, domains, owners, memberCount: members?.n ?? 0 };
}

export interface PlatformAuditRow {
  id: string;
  tenantId: string | null;
  actorType: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  before: unknown;
  after: unknown;
  createdAt: Date;
}

/** The platform audit log, newest first (super admins). Pass the last id as `before`. */
export async function listPlatformAudit(
  tx: PlatformTx,
  actor: Actor,
  page: { before?: string; limit?: number } = {},
): Promise<PlatformAuditRow[]> {
  requirePlatformRole(actor, 'super_admin');
  const a = schema.platformAuditLog;
  const limit = Math.min(Math.max(page.limit ?? 50, 1), 100);
  // Ids are uuidv7, so they sort by time.
  return tx.db
    .select({
      id: a.id,
      tenantId: a.tenantId,
      actorType: a.actorType,
      actorId: a.actorId,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
      before: a.before,
      after: a.after,
      createdAt: a.createdAt,
    })
    .from(a)
    .where(page.before ? lt(a.id, page.before) : undefined)
    .orderBy(desc(a.id))
    .limit(limit);
}
